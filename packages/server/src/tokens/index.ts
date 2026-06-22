/**
 * JWT Token Service
 *
 * Issues and verifies ClawCaptcha tokens using jose library.
 * Uses HS256 with a secret for simplicity (RS256/ES256 for production).
 */

import * as jose from 'jose';
import type { ClawCaptchaTokenPayload, ChallengeType, Env } from '../types';

// Minimum secret length for security
const MIN_SECRET_LENGTH = 32;

export class TokenService {
  private secret: Uint8Array;
  private issuer: string;
  private audience: string;
  private expiresIn: number;

  constructor(env: Env) {
    const secretString = env.JWT_SECRET;

    // SECURITY: Require JWT_SECRET in production
    if (!secretString) {
      if (env.ENVIRONMENT === 'production') {
        throw new Error('JWT_SECRET is required in production');
      }
      // Only allow default in development with explicit warning
      console.warn('[ClawCaptcha] WARNING: Using insecure default JWT secret. Set JWT_SECRET in production.');
    }

    const secret = secretString || 'clawcaptcha-dev-secret-DO-NOT-USE-IN-PRODUCTION';

    // Validate secret strength
    if (secret.length < MIN_SECRET_LENGTH && env.ENVIRONMENT === 'production') {
      throw new Error(`JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
    }

    this.secret = new TextEncoder().encode(secret);
    this.issuer = 'clawcaptcha.com';
    this.audience = 'clawcaptcha';
    this.expiresIn = parseInt(env.TOKEN_EXPIRES_IN || '900', 10); // 15 min default
  }

  async issue(params: {
    clientId?: string;
    verifiedAs: 'bot' | 'human';
    score: number;
    challenges: ChallengeType[];
    challengeId?: string;
  }): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    // Build custom claims (jose will add standard claims via setters)
    const customClaims = {
      sub: params.clientId || crypto.randomUUID(),
      jti: crypto.randomUUID(),
      clw: {
        verified: params.verifiedAs,
        score: params.score,
        challenges: params.challenges,
        // Include challenge ID for audit trail
        challengeId: params.challengeId,
      },
    };

    const token = await new jose.SignJWT(customClaims)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt(now)
      .setExpirationTime(now + this.expiresIn)
      .sign(this.secret);

    return token;
  }

  async verify(token: string): Promise<ClawCaptchaTokenPayload> {
    const { payload } = await jose.jwtVerify(token, this.secret, {
      issuer: this.issuer,
      audience: this.audience,
    });

    return payload as unknown as ClawCaptchaTokenPayload;
  }
}
