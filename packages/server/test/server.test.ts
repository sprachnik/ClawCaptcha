import { describe, it, expect } from 'vitest';
import app from '../src/index';

describe('ClawCaptcha Server', () => {
  const env = {
    ENVIRONMENT: 'test',
    CHALLENGE_TTL_MS: '300000',
    POW_DIFFICULTY: '8', // Low difficulty for fast tests
    TOKEN_EXPIRES_IN: '900',
  };

  describe('GET /v1/health', () => {
    it('returns ok status', async () => {
      const res = await app.request('/v1/health', {}, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.version).toBe('0.1.0');
    });
  });

  describe('GET /v1/.well-known/clawcaptcha.json', () => {
    it('returns discovery document', async () => {
      const res = await app.request('/v1/.well-known/clawcaptcha.json', {}, env);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.version).toBe('0.1.0');
      expect(body.challenges).toContain('pow');
      expect(body.challenges).toContain('schema');
      expect(body.endpoints.issue).toBe('/v1/challenge/issue');
    });
  });

  describe('POST /v1/challenge/issue', () => {
    it('issues a challenge set', async () => {
      const res = await app.request('/v1/challenge/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }, env);

      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.challenges).toHaveLength(2);
      expect(body.challenges[0].type).toBe('pow');
      expect(body.challenges[1].type).toBe('schema');
      expect(body.expiresAt).toBeGreaterThan(Date.now());
      // Client binding should NOT be exposed
      expect(body.clientBinding).toBeUndefined();
    });
  });

  describe('POST /v1/challenge/solve', () => {
    it('rejects empty solutions array', async () => {
      const res = await app.request('/v1/challenge/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId: 'invalid-id',
          solutions: [],
        }),
      }, env);

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('empty');
    });

    it('rejects missing challengeId', async () => {
      const res = await app.request('/v1/challenge/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          solutions: [{ type: 'pow', value: '123' }],
        }),
      }, env);

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('challengeId');
    });

    it('rejects missing solutions', async () => {
      const res = await app.request('/v1/challenge/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }, env);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /v1/verify', () => {
    it('rejects invalid token', async () => {
      const res = await app.request('/v1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'invalid-token' }),
      }, env);

      expect(res.status).toBe(401);

      const body = await res.json();
      expect(body.valid).toBe(false);
    });

    it('rejects missing token', async () => {
      const res = await app.request('/v1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }, env);

      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.valid).toBe(false);
      expect(body.error).toContain('Missing');
    });
  });

  describe('Rate limiting', () => {
    it('includes rate limit headers', async () => {
      const res = await app.request('/v1/challenge/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }, env);

      expect(res.status).toBe(200);
      expect(res.headers.get('X-RateLimit-Limit')).toBeDefined();
      expect(res.headers.get('X-RateLimit-Remaining')).toBeDefined();
    });
  });
});
