/**
 * ClawCaptcha Protocol Types
 * https://clawcaptcha.com/protocol
 */

// Challenge Types
export type ChallengeType = 'pow' | 'schema';

export interface PowParams {
  prefix: string;
  difficulty: number;
  algorithm: 'sha256';
}

export interface SchemaParams {
  schema: Record<string, unknown>;
  description: string;
}

export interface Challenge {
  id: string;
  type: ChallengeType;
  params: PowParams | SchemaParams;
  expiresAt: number;
}

export interface ChallengeSet {
  id: string;
  challenges: Challenge[];
  expiresAt: number;
  issuedAt: number;
  // Client binding for security
  clientBinding?: string;
}

// Solution Types
export interface ChallengeSolution {
  type: ChallengeType;
  value: unknown;
}

export interface SolveRequest {
  challengeId: string;
  solutions: ChallengeSolution[];
}

// Token Types
export interface ClawCaptchaTokenPayload {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  jti: string;
  clw: {
    verified: 'bot' | 'human';
    score: number;
    challenges: ChallengeType[];
    challengeId?: string;
  };
}

// Inline Challenge Response (401)
export interface InlineChallengeResponse {
  error: 'clawcaptcha_required';
  challenge: ChallengeSet;
}

// Verification Result
export interface VerifyResult {
  valid: boolean;
  verifiedAs?: 'bot' | 'human';
  score?: number;
  expiresAt?: number;
  error?: string;
}

// Signal Types (for scoring)
export interface PassiveSignals {
  timing?: {
    challengeIssuedAt: number;
    solutionSubmittedAt: number;
    durationMs: number;
  };
  headers?: {
    userAgent: string | null;
    hasSecFetchHeaders: boolean;
    headerCount: number;
  };
}

// Client context for binding
export interface ClientContext {
  ip: string;
  userAgent: string | null;
}

// Environment bindings for Cloudflare Workers
export interface Env {
  ENVIRONMENT: string;
  CHALLENGE_TTL_MS: string;
  POW_DIFFICULTY: string;
  TOKEN_EXPIRES_IN: string;
  JWT_SECRET?: string;
  // KV namespace for challenge storage (optional, falls back to in-memory)
  CHALLENGES?: KVNamespace;
  // KV namespace for rate limiting (optional, falls back to in-memory)
  RATE_LIMITS?: KVNamespace;
}

// Input validation limits
export const LIMITS = {
  MAX_CHALLENGE_ID_LENGTH: 64,
  MAX_SOLUTIONS: 10,
  MAX_SOLUTION_TYPE_LENGTH: 32,
  MAX_SOLUTION_VALUE_SIZE: 10_000, // 10KB
} as const;
