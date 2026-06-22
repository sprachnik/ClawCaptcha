import { describe, it, expect } from 'vitest';
import { TokenService } from '../src/tokens';
import type { Env } from '../src/types';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    CHALLENGE_TTL_MS: '300000',
    POW_DIFFICULTY: '8',
    TOKEN_EXPIRES_IN: '900',
    ...overrides,
  };
}

describe('TokenService', () => {
  describe('constructor', () => {
    it('creates service with default dev secret', () => {
      expect(() => new TokenService(makeEnv())).not.toThrow();
    });

    it('throws in production without JWT_SECRET', () => {
      expect(() => new TokenService(makeEnv({ ENVIRONMENT: 'production' }))).toThrow('JWT_SECRET is required');
    });

    it('throws in production with short JWT_SECRET', () => {
      expect(() => new TokenService(makeEnv({
        ENVIRONMENT: 'production',
        JWT_SECRET: 'tooshort',
      }))).toThrow('at least 32 characters');
    });

    it('accepts valid production secret', () => {
      expect(() => new TokenService(makeEnv({
        ENVIRONMENT: 'production',
        JWT_SECRET: 'a'.repeat(32),
      }))).not.toThrow();
    });
  });

  describe('issue + verify round-trip', () => {
    it('issues and verifies a bot token', async () => {
      const service = new TokenService(makeEnv());

      const token = await service.issue({
        verifiedAs: 'bot',
        score: 0.85,
        challenges: ['pow', 'schema'],
        challengeId: 'test-challenge-1',
      });

      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts

      const payload = await service.verify(token);
      expect(payload.clw.verified).toBe('bot');
      expect(payload.clw.score).toBe(0.85);
      expect(payload.clw.challenges).toEqual(['pow', 'schema']);
      expect(payload.clw.challengeId).toBe('test-challenge-1');
      expect(payload.iss).toBe('clawcaptcha.com');
      expect(payload.aud).toBe('clawcaptcha');
      expect(payload.sub).toBeDefined();
      expect(payload.jti).toBeDefined();
      expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('issues and verifies a human token', async () => {
      const service = new TokenService(makeEnv());

      const token = await service.issue({
        verifiedAs: 'human',
        score: 0.3,
        challenges: ['pow'],
      });

      const payload = await service.verify(token);
      expect(payload.clw.verified).toBe('human');
      expect(payload.clw.score).toBe(0.3);
    });

    it('uses provided clientId as sub claim', async () => {
      const service = new TokenService(makeEnv());

      const token = await service.issue({
        clientId: 'my-client-id',
        verifiedAs: 'bot',
        score: 0.9,
        challenges: ['pow'],
      });

      const payload = await service.verify(token);
      expect(payload.sub).toBe('my-client-id');
    });
  });

  describe('verify failures', () => {
    it('rejects a tampered token', async () => {
      const service = new TokenService(makeEnv());

      const token = await service.issue({
        verifiedAs: 'bot',
        score: 0.85,
        challenges: ['pow'],
      });

      // Tamper with the payload
      const parts = token.split('.');
      parts[1] = parts[1] + 'TAMPERED';
      const tampered = parts.join('.');

      await expect(service.verify(tampered)).rejects.toThrow();
    });

    it('rejects a token signed with a different secret', async () => {
      const issuer = new TokenService(makeEnv({ JWT_SECRET: 'a'.repeat(32) }));
      const verifier = new TokenService(makeEnv({ JWT_SECRET: 'b'.repeat(32) }));

      const token = await issuer.issue({
        verifiedAs: 'bot',
        score: 0.9,
        challenges: ['pow'],
      });

      await expect(verifier.verify(token)).rejects.toThrow();
    });

    it('rejects completely invalid string', async () => {
      const service = new TokenService(makeEnv());
      await expect(service.verify('not-a-jwt')).rejects.toThrow();
    });

    it('rejects expired token', async () => {
      const service = new TokenService(makeEnv({ TOKEN_EXPIRES_IN: '0' }));

      const token = await service.issue({
        verifiedAs: 'bot',
        score: 0.9,
        challenges: ['pow'],
      });

      // Token expires immediately (exp = now + 0)
      // Wait a tick to ensure it's past
      await new Promise(r => setTimeout(r, 1100));
      await expect(service.verify(token)).rejects.toThrow();
    });
  });

  describe('token uniqueness', () => {
    it('issues tokens with unique jti claims', async () => {
      const service = new TokenService(makeEnv());

      const params = { verifiedAs: 'bot' as const, score: 0.9, challenges: ['pow' as const] };
      const token1 = await service.issue(params);
      const token2 = await service.issue(params);

      const payload1 = await service.verify(token1);
      const payload2 = await service.verify(token2);

      expect(payload1.jti).not.toBe(payload2.jti);
    });
  });
});
