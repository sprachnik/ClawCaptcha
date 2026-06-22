import { describe, it, expect } from 'vitest';
import { ChallengeRegistry } from '../src/challenges';
import { generatePowChallenge, verifyPowSolution } from '../src/challenges/pow';
import { generateSchemaChallenge, verifySchemaSolution } from '../src/challenges/schema';
import type { Env, ClientContext, Challenge, PowParams } from '../src/types';

// ==================== Test Helpers ====================

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    CHALLENGE_TTL_MS: '300000',
    POW_DIFFICULTY: '8',
    TOKEN_EXPIRES_IN: '900',
    ...overrides,
  };
}

const client: ClientContext = { ip: '127.0.0.1', userAgent: 'test-agent/1.0' };

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

// ==================== PoW Challenge ====================

describe('generatePowChallenge', () => {
  it('returns a challenge with correct structure', () => {
    const challenge = generatePowChallenge('test-id', 16, 300_000);
    expect(challenge.id).toBe('test-id:pow');
    expect(challenge.type).toBe('pow');
    expect(challenge.expiresAt).toBeGreaterThan(Date.now());

    const params = challenge.params as PowParams;
    expect(params.prefix).toMatch(/^clawcaptcha:[0-9a-f]+:$/);
    expect(params.difficulty).toBe(16);
    expect(params.algorithm).toBe('sha256');
  });

  it('generates unique prefixes each time', () => {
    const a = generatePowChallenge('a', 8, 300_000);
    const b = generatePowChallenge('b', 8, 300_000);
    expect((a.params as PowParams).prefix).not.toBe((b.params as PowParams).prefix);
  });
});

describe('verifyPowSolution', () => {
  it('accepts a valid nonce', async () => {
    const challenge = generatePowChallenge('test', 8, 300_000);
    const nonce = await findPowNonce((challenge.params as PowParams).prefix, 8);
    expect(await verifyPowSolution(challenge, nonce)).toBe(true);
  });

  it('rejects an invalid nonce', async () => {
    const challenge = generatePowChallenge('test', 8, 300_000);
    expect(await verifyPowSolution(challenge, 'definitely-wrong')).toBe(false);
  });

  it('rejects non-string solution', async () => {
    const challenge = generatePowChallenge('test', 8, 300_000);
    expect(await verifyPowSolution(challenge, 12345)).toBe(false);
    expect(await verifyPowSolution(challenge, null)).toBe(false);
  });

  it('rejects wrong challenge type', async () => {
    const challenge = generatePowChallenge('test', 8, 300_000);
    challenge.type = 'schema'; // tamper
    expect(await verifyPowSolution(challenge, '0')).toBe(false);
  });
});

// ==================== Schema Challenge ====================

describe('generateSchemaChallenge', () => {
  it('returns a challenge with correct structure', () => {
    const challenge = generateSchemaChallenge('test-id', 300_000);
    expect(challenge.id).toBe('test-id:schema');
    expect(challenge.type).toBe('schema');
    expect(challenge.expiresAt).toBeGreaterThan(Date.now());
    expect((challenge.params as any).schema).toBeDefined();
    expect((challenge.params as any).description).toBeDefined();
  });
});

describe('verifySchemaSolution', () => {
  function makeSchemaChallenge(schema: Record<string, unknown>): Challenge {
    return {
      id: 'test:schema',
      type: 'schema',
      params: { schema, description: 'test' },
      expiresAt: Date.now() + 300_000,
    };
  }

  it('accepts valid identity schema solution', () => {
    const challenge = makeSchemaChallenge({
      type: 'object',
      required: ['agentName', 'agentVersion'],
      properties: {
        agentName: { type: 'string', minLength: 1 },
        agentVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+' },
      },
      additionalProperties: false,
    });

    expect(verifySchemaSolution(challenge, {
      agentName: 'TestBot',
      agentVersion: '1.0.0',
    })).toBe(true);
  });

  it('rejects missing required fields', () => {
    const challenge = makeSchemaChallenge({
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
    });

    expect(verifySchemaSolution(challenge, {})).toBe(false);
  });

  it('rejects additional properties when not allowed', () => {
    const challenge = makeSchemaChallenge({
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
      additionalProperties: false,
    });

    expect(verifySchemaSolution(challenge, { name: 'Bot', extra: 'nope' })).toBe(false);
  });

  it('validates string minLength', () => {
    const challenge = makeSchemaChallenge({
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string', minLength: 3 } },
    });

    expect(verifySchemaSolution(challenge, { name: '' })).toBe(false);
    expect(verifySchemaSolution(challenge, { name: 'abc' })).toBe(true);
  });

  it('validates string pattern', () => {
    const challenge = makeSchemaChallenge({
      type: 'object',
      required: ['version'],
      properties: { version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' } },
    });

    expect(verifySchemaSolution(challenge, { version: '1.0.0' })).toBe(true);
    expect(verifySchemaSolution(challenge, { version: 'nope' })).toBe(false);
  });

  it('validates enum values', () => {
    const challenge = makeSchemaChallenge({
      type: 'object',
      required: ['purpose'],
      properties: { purpose: { type: 'string', enum: ['search-indexing', 'monitoring'] } },
    });

    expect(verifySchemaSolution(challenge, { purpose: 'monitoring' })).toBe(true);
    expect(verifySchemaSolution(challenge, { purpose: 'hacking' })).toBe(false);
  });

  it('validates array minItems and item types', () => {
    const challenge = makeSchemaChallenge({
      type: 'object',
      required: ['tags'],
      properties: {
        tags: { type: 'array', items: { type: 'string' }, minItems: 2 },
      },
    });

    expect(verifySchemaSolution(challenge, { tags: ['a'] })).toBe(false);
    expect(verifySchemaSolution(challenge, { tags: ['a', 'b'] })).toBe(true);
    expect(verifySchemaSolution(challenge, { tags: [1, 2] })).toBe(false);
  });

  it('validates nested objects', () => {
    const challenge = makeSchemaChallenge({
      type: 'object',
      required: ['comp'],
      properties: {
        comp: {
          type: 'object',
          required: ['input', 'output'],
          properties: {
            input: { type: 'array', items: { type: 'number' }, minItems: 1 },
            output: { type: 'number' },
          },
        },
      },
    });

    expect(verifySchemaSolution(challenge, { comp: { input: [1, 2], output: 3 } })).toBe(true);
    expect(verifySchemaSolution(challenge, { comp: { input: [], output: 0 } })).toBe(false);
    expect(verifySchemaSolution(challenge, { comp: { input: [1], output: 'not-a-number' } })).toBe(false);
  });

  it('validates number minimum/maximum', () => {
    const challenge = makeSchemaChallenge({
      type: 'object',
      required: ['count'],
      properties: { count: { type: 'number', minimum: 0, maximum: 100 } },
    });

    expect(verifySchemaSolution(challenge, { count: 50 })).toBe(true);
    expect(verifySchemaSolution(challenge, { count: -1 })).toBe(false);
    expect(verifySchemaSolution(challenge, { count: 101 })).toBe(false);
  });

  it('validates boolean type', () => {
    const challenge = makeSchemaChallenge({
      type: 'object',
      required: ['flag'],
      properties: { flag: { type: 'boolean' } },
    });

    expect(verifySchemaSolution(challenge, { flag: true })).toBe(true);
    expect(verifySchemaSolution(challenge, { flag: 'true' })).toBe(false);
  });

  it('rejects non-object when object expected', () => {
    const challenge = makeSchemaChallenge({
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
    });

    expect(verifySchemaSolution(challenge, 'string')).toBe(false);
    expect(verifySchemaSolution(challenge, null)).toBe(false);
    expect(verifySchemaSolution(challenge, [1, 2])).toBe(false);
  });

  it('rejects wrong challenge type', () => {
    const challenge = makeSchemaChallenge({ type: 'object', properties: {} });
    challenge.type = 'pow'; // tamper
    expect(verifySchemaSolution(challenge, {})).toBe(false);
  });
});

// ==================== ChallengeRegistry ====================

describe('ChallengeRegistry', () => {
  it('issues a challenge set with pow and schema', async () => {
    const registry = new ChallengeRegistry(makeEnv());
    const challengeSet = await registry.issue(client);

    expect(challengeSet.id).toBeDefined();
    expect(challengeSet.challenges).toHaveLength(2);
    expect(challengeSet.challenges[0].type).toBe('pow');
    expect(challengeSet.challenges[1].type).toBe('schema');
    expect(challengeSet.expiresAt).toBeGreaterThan(Date.now());
    expect(challengeSet.issuedAt).toBeLessThanOrEqual(Date.now());
    expect(challengeSet.clientBinding).toBeDefined();
  });

  it('verifies valid solutions from the same client', async () => {
    const registry = new ChallengeRegistry(makeEnv());
    const challengeSet = await registry.issue(client);

    // Solve the PoW challenge
    const powChallenge = challengeSet.challenges.find(c => c.type === 'pow')!;
    const powParams = powChallenge.params as PowParams;
    const nonce = await findPowNonce(powParams.prefix, powParams.difficulty);

    // Solve the schema challenge
    const schemaChallenge = challengeSet.challenges.find(c => c.type === 'schema')!;
    const schemaParams = schemaChallenge.params as any;
    const schemaAnswer = buildSchemaAnswer(schemaParams.schema);

    const result = await registry.verify(challengeSet.id, [
      { type: 'pow', value: nonce },
      { type: 'schema', value: schemaAnswer },
    ], client);

    expect(result.valid).toBe(true);
    expect(result.durationMs).toBeDefined();
  });

  it('rejects replay (same challenge used twice)', async () => {
    const registry = new ChallengeRegistry(makeEnv());
    const challengeSet = await registry.issue(client);

    const powChallenge = challengeSet.challenges.find(c => c.type === 'pow')!;
    const nonce = await findPowNonce((powChallenge.params as PowParams).prefix, 8);
    const schemaChallenge = challengeSet.challenges.find(c => c.type === 'schema')!;
    const schemaAnswer = buildSchemaAnswer((schemaChallenge.params as any).schema);

    const solutions = [
      { type: 'pow' as const, value: nonce },
      { type: 'schema' as const, value: schemaAnswer },
    ];

    const first = await registry.verify(challengeSet.id, solutions, client);
    expect(first.valid).toBe(true);

    // Second attempt should fail (one-time use)
    const second = await registry.verify(challengeSet.id, solutions, client);
    expect(second.valid).toBe(false);
    expect(second.error).toContain('not found');
  });

  it('rejects unknown challenge id', async () => {
    const registry = new ChallengeRegistry(makeEnv());
    const result = await registry.verify('nonexistent', [
      { type: 'pow', value: '0' },
    ], client);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('rejects solution from a different client', async () => {
    const registry = new ChallengeRegistry(makeEnv());
    const challengeSet = await registry.issue(client);

    const powChallenge = challengeSet.challenges.find(c => c.type === 'pow')!;
    const nonce = await findPowNonce((powChallenge.params as PowParams).prefix, 8);
    const schemaChallenge = challengeSet.challenges.find(c => c.type === 'schema')!;
    const schemaAnswer = buildSchemaAnswer((schemaChallenge.params as any).schema);

    const differentClient: ClientContext = { ip: '10.0.0.99', userAgent: 'evil-agent' };

    const result = await registry.verify(challengeSet.id, [
      { type: 'pow', value: nonce },
      { type: 'schema', value: schemaAnswer },
    ], differentClient);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('different client');
  });

  it('rejects missing solution type', async () => {
    const registry = new ChallengeRegistry(makeEnv());
    const challengeSet = await registry.issue(client);

    // Only submit PoW, skip schema
    const powChallenge = challengeSet.challenges.find(c => c.type === 'pow')!;
    const nonce = await findPowNonce((powChallenge.params as PowParams).prefix, 8);

    const result = await registry.verify(challengeSet.id, [
      { type: 'pow', value: nonce },
    ], client);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Missing solution');
  });

  it('rejects wrong PoW nonce', async () => {
    const registry = new ChallengeRegistry(makeEnv());
    const challengeSet = await registry.issue(client);

    const schemaChallenge = challengeSet.challenges.find(c => c.type === 'schema')!;
    const schemaAnswer = buildSchemaAnswer((schemaChallenge.params as any).schema);

    const result = await registry.verify(challengeSet.id, [
      { type: 'pow', value: 'bad-nonce' },
      { type: 'schema', value: schemaAnswer },
    ], client);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid solution for pow');
  });

  it('respects configurable TTL and difficulty', async () => {
    const registry = new ChallengeRegistry(makeEnv({
      CHALLENGE_TTL_MS: '1000',
      POW_DIFFICULTY: '4',
    }));

    const challengeSet = await registry.issue(client);
    // TTL of 1000ms means expiresAt should be close to now + 1000
    expect(challengeSet.expiresAt).toBeLessThanOrEqual(Date.now() + 1100);
    expect(challengeSet.expiresAt).toBeGreaterThan(Date.now());

    // Difficulty should be reflected in the PoW params
    const powChallenge = challengeSet.challenges.find(c => c.type === 'pow')!;
    expect((powChallenge.params as PowParams).difficulty).toBe(4);
  });
});

// ==================== Helper ====================

/**
 * Build a minimal valid answer for any of the 3 predefined schemas.
 */
function buildSchemaAnswer(schema: Record<string, unknown>): Record<string, unknown> {
  const required = (schema.required as string[]) || [];
  const properties = (schema.properties as Record<string, Record<string, unknown>>) || {};
  const result: Record<string, unknown> = {};

  for (const key of required) {
    const prop = properties[key];
    if (!prop) continue;

    if (prop.type === 'string') {
      if (prop.enum) {
        result[key] = (prop.enum as string[])[0];
      } else if (prop.pattern) {
        result[key] = '1.0.0';
      } else if (prop.minLength && (prop.minLength as number) > 0) {
        result[key] = 'a'.repeat(prop.minLength as number);
      } else {
        result[key] = 'test-value';
      }
    } else if (prop.type === 'number') {
      result[key] = prop.minimum !== undefined ? (prop.minimum as number) : Date.now();
    } else if (prop.type === 'boolean') {
      result[key] = true;
    } else if (prop.type === 'array') {
      const minItems = (prop.minItems as number) || 1;
      const itemSchema = prop.items as Record<string, unknown> | undefined;
      if (itemSchema?.type === 'string') {
        result[key] = Array.from({ length: minItems }, (_, i) => `item-${i}`);
      } else if (itemSchema?.type === 'number') {
        result[key] = Array.from({ length: minItems }, (_, i) => i + 1);
      } else {
        result[key] = Array.from({ length: minItems }, () => 'item');
      }
    } else if (prop.type === 'object') {
      result[key] = buildSchemaAnswer(prop);
    }
  }

  return result;
}
