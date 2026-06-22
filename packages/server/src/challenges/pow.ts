/**
 * Proof of Work Challenge
 *
 * Find a nonce where sha256(prefix + nonce) has N leading zero bits.
 * Trivial for code (~1-2s), impractical for humans.
 */

import type { Challenge, PowParams } from '../types';

export function generatePowChallenge(challengeId: string, difficulty: number, ttlMs: number): Challenge {
  // Generate random prefix using Web Crypto API
  const prefixBytes = new Uint8Array(16);
  crypto.getRandomValues(prefixBytes);
  const prefix = Array.from(prefixBytes, b => b.toString(16).padStart(2, '0')).join('');

  return {
    id: `${challengeId}:pow`,
    type: 'pow',
    params: {
      prefix: `clawcaptcha:${prefix}:`,
      difficulty,
      algorithm: 'sha256',
    } satisfies PowParams,
    expiresAt: Date.now() + ttlMs,
  };
}

export async function verifyPowSolution(challenge: Challenge, solution: unknown): Promise<boolean> {
  if (challenge.type !== 'pow') return false;
  if (typeof solution !== 'string') return false;

  const params = challenge.params as PowParams;
  const data = new TextEncoder().encode(params.prefix + solution);

  // Hash using Web Crypto API (available in Workers and browsers)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);

  return hasLeadingZeroBits(hashArray, params.difficulty);
}

function hasLeadingZeroBits(hash: Uint8Array, requiredBits: number): boolean {
  let zeroBits = 0;

  for (const byte of hash) {
    if (byte === 0) {
      zeroBits += 8;
    } else {
      // Count leading zeros in this byte
      zeroBits += Math.clz32(byte) - 24;
      break;
    }

    if (zeroBits >= requiredBits) return true;
  }

  return zeroBits >= requiredBits;
}
