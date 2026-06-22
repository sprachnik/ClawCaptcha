import { describe, it, expect } from 'vitest';
import app from '../src/index';
import type { PowParams } from '../src/types';

/**
 * End-to-end tests: full issue -> solve -> verify flow through HTTP endpoints.
 */

const env = {
  ENVIRONMENT: 'test',
  CHALLENGE_TTL_MS: '300000',
  POW_DIFFICULTY: '8', // Low difficulty for fast tests
  TOKEN_EXPIRES_IN: '900',
};

const headers = {
  'Content-Type': 'application/json',
  'User-Agent': 'clawcaptcha-test-agent/1.0',
};

async function findPowNonce(prefix: string, difficulty: number): Promise<string> {
  const target = '0'.repeat(Math.ceil(difficulty / 4));
  for (let nonce = 0; nonce < 10_000_000; nonce++) {
    const data = new TextEncoder().encode(prefix + nonce);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    if (hex.startsWith(target)) return String(nonce);
  }
  throw new Error('nonce not found');
}

function buildSchemaAnswer(schema: Record<string, unknown>): Record<string, unknown> {
  const required = (schema.required as string[]) || [];
  const properties = (schema.properties as Record<string, Record<string, unknown>>) || {};
  const result: Record<string, unknown> = {};

  for (const key of required) {
    const prop = properties[key];
    if (!prop) continue;

    if (prop.type === 'string') {
      if (prop.enum) result[key] = (prop.enum as string[])[0];
      else if (prop.pattern) result[key] = '1.0.0';
      else if (prop.minLength && (prop.minLength as number) > 0) result[key] = 'a'.repeat(prop.minLength as number);
      else result[key] = 'test-value';
    } else if (prop.type === 'number') {
      result[key] = prop.minimum !== undefined ? (prop.minimum as number) : Date.now();
    } else if (prop.type === 'boolean') {
      result[key] = true;
    } else if (prop.type === 'array') {
      const minItems = (prop.minItems as number) || 1;
      const items = prop.items as Record<string, unknown> | undefined;
      if (items?.type === 'string') result[key] = Array.from({ length: minItems }, (_, i) => `item-${i}`);
      else if (items?.type === 'number') result[key] = Array.from({ length: minItems }, (_, i) => i + 1);
      else result[key] = Array.from({ length: minItems }, () => 'item');
    } else if (prop.type === 'object') {
      result[key] = buildSchemaAnswer(prop);
    }
  }

  return result;
}

describe('E2E: issue -> solve -> verify', () => {
  it('completes the full verification flow', async () => {
    // Step 1: Issue challenge
    const issueRes = await app.request('/v1/challenge/issue', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    }, env);

    expect(issueRes.status).toBe(200);
    const challengeSet = await issueRes.json() as any;

    expect(challengeSet.id).toBeDefined();
    expect(challengeSet.challenges).toHaveLength(2);
    expect(challengeSet.clientBinding).toBeUndefined(); // should be stripped

    // Step 2: Solve challenges
    const powChallenge = challengeSet.challenges.find((c: any) => c.type === 'pow');
    const schemaChallenge = challengeSet.challenges.find((c: any) => c.type === 'schema');

    const nonce = await findPowNonce(powChallenge.params.prefix, powChallenge.params.difficulty);
    const schemaAnswer = buildSchemaAnswer(schemaChallenge.params.schema);

    const solveRes = await app.request('/v1/challenge/solve', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        challengeId: challengeSet.id,
        solutions: [
          { type: 'pow', value: nonce },
          { type: 'schema', value: schemaAnswer },
        ],
      }),
    }, env);

    expect(solveRes.status).toBe(200);
    const solveResult = await solveRes.json() as any;

    expect(solveResult.success).toBe(true);
    expect(solveResult.token).toBeDefined();
    expect(typeof solveResult.token).toBe('string');
    expect(solveResult.verifiedAs).toBeDefined();
    expect(typeof solveResult.score).toBe('number');

    // Step 3: Verify the token
    const verifyRes = await app.request('/v1/verify', {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: solveResult.token }),
    }, env);

    expect(verifyRes.status).toBe(200);
    const verifyResult = await verifyRes.json() as any;

    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.verifiedAs).toBe(solveResult.verifiedAs);
    expect(verifyResult.score).toBe(solveResult.score);
    expect(verifyResult.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects replayed challenge (one-time use)', async () => {
    // Issue
    const issueRes = await app.request('/v1/challenge/issue', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    }, env);
    const challengeSet = await issueRes.json() as any;

    // Solve
    const powChallenge = challengeSet.challenges.find((c: any) => c.type === 'pow');
    const schemaChallenge = challengeSet.challenges.find((c: any) => c.type === 'schema');
    const nonce = await findPowNonce(powChallenge.params.prefix, powChallenge.params.difficulty);
    const schemaAnswer = buildSchemaAnswer(schemaChallenge.params.schema);

    const body = JSON.stringify({
      challengeId: challengeSet.id,
      solutions: [
        { type: 'pow', value: nonce },
        { type: 'schema', value: schemaAnswer },
      ],
    });

    const first = await app.request('/v1/challenge/solve', { method: 'POST', headers, body }, env);
    expect(first.status).toBe(200);

    // Replay the same challenge
    const second = await app.request('/v1/challenge/solve', { method: 'POST', headers, body }, env);
    expect(second.status).toBe(400);

    const result = await second.json() as any;
    expect(result.success).toBe(false);
  });

  it('inline flow: GET /v1/protected returns 401 with challenge', async () => {
    const res = await app.request('/v1/protected', { method: 'GET', headers }, env);
    expect(res.status).toBe(401);

    const body = await res.json() as any;
    expect(body.error).toBe('clawcaptcha_required');
    expect(body.challenge).toBeDefined();
    expect(body.challenge.challenges).toHaveLength(2);

    // WWW-Authenticate header should be set
    expect(res.headers.get('WWW-Authenticate')).toMatch(/^ClawCaptcha challenge="/);
  });

  it('inline flow: solve via X-ClawCaptcha-Solution header', async () => {
    // Get the challenge from 401
    const protectedRes = await app.request('/v1/protected', { method: 'GET', headers }, env);
    const { challenge: challengeSet } = await protectedRes.json() as any;

    // Solve
    const powChallenge = challengeSet.challenges.find((c: any) => c.type === 'pow');
    const schemaChallenge = challengeSet.challenges.find((c: any) => c.type === 'schema');
    const nonce = await findPowNonce(powChallenge.params.prefix, powChallenge.params.difficulty);
    const schemaAnswer = buildSchemaAnswer(schemaChallenge.params.schema);

    const solution = {
      challengeId: challengeSet.id,
      solutions: [
        { type: 'pow', value: nonce },
        { type: 'schema', value: schemaAnswer },
      ],
    };

    // Retry with solution in header
    const retryRes = await app.request('/v1/protected', {
      method: 'GET',
      headers: {
        ...headers,
        'X-ClawCaptcha-Solution': btoa(JSON.stringify(solution)),
      },
    }, env);

    expect(retryRes.status).toBe(200);
    const result = await retryRes.json() as any;
    expect(result.success).toBe(true);
    expect(result.token).toBeDefined();

    // Token should also be in response header
    expect(retryRes.headers.get('X-ClawCaptcha-Token')).toBeDefined();
  });

  it('inline flow: access with valid ClawCaptcha token', async () => {
    // Get a token through the normal flow first
    const issueRes = await app.request('/v1/challenge/issue', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    }, env);
    const challengeSet = await issueRes.json() as any;

    const powChallenge = challengeSet.challenges.find((c: any) => c.type === 'pow');
    const schemaChallenge = challengeSet.challenges.find((c: any) => c.type === 'schema');
    const nonce = await findPowNonce(powChallenge.params.prefix, powChallenge.params.difficulty);
    const schemaAnswer = buildSchemaAnswer(schemaChallenge.params.schema);

    const solveRes = await app.request('/v1/challenge/solve', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        challengeId: challengeSet.id,
        solutions: [
          { type: 'pow', value: nonce },
          { type: 'schema', value: schemaAnswer },
        ],
      }),
    }, env);
    const { token } = await solveRes.json() as any;

    // Use the token on the protected endpoint
    const res = await app.request('/v1/protected', {
      method: 'GET',
      headers: {
        ...headers,
        'Authorization': `ClawCaptcha ${token}`,
      },
    }, env);

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.message).toBe('Token valid');
  });
});
