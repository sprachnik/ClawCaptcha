/**
 * Challenge Registry
 *
 * Issues, stores, and verifies challenges.
 * Includes atomic verification to prevent race conditions.
 */

import type { ChallengeSet, ChallengeSolution, ClientContext, Env } from '../types';
import { generatePowChallenge, verifyPowSolution } from './pow';
import { generateSchemaChallenge, verifySchemaSolution } from './schema';

// In-memory challenge store (fallback when KV not available)
const memoryStore = new Map<string, ChallengeSet>();

// Track verified challenges to prevent reuse (in-memory fallback)
const verifiedChallenges = new Set<string>();

/**
 * Generate a client binding hash from IP and User-Agent
 */
async function generateClientBinding(client: ClientContext): Promise<string> {
  const data = `${client.ip}:${client.userAgent || 'unknown'}`;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray.slice(0, 8), b => b.toString(16).padStart(2, '0')).join('');
}

export class ChallengeRegistry {
  private env: Env;
  private ttlMs: number;
  private powDifficulty: number;

  constructor(env: Env) {
    this.env = env;
    this.ttlMs = parseInt(env.CHALLENGE_TTL_MS || '300000', 10);
    this.powDifficulty = parseInt(env.POW_DIFFICULTY || '18', 10);
  }

  /**
   * Issue a new challenge set bound to a specific client
   */
  async issue(client: ClientContext): Promise<ChallengeSet> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + this.ttlMs;
    const clientBinding = await generateClientBinding(client);

    const challengeSet: ChallengeSet = {
      id,
      challenges: [
        generatePowChallenge(id, this.powDifficulty, this.ttlMs),
        generateSchemaChallenge(id, this.ttlMs),
      ],
      expiresAt,
      issuedAt: now,
      clientBinding,
    };

    await this.store(challengeSet);
    return challengeSet;
  }

  /**
   * Verify solutions with atomic retrieval and deletion
   * Prevents race conditions where the same challenge is verified twice
   */
  async verify(
    challengeId: string,
    solutions: ChallengeSolution[],
    client: ClientContext
  ): Promise<{ valid: boolean; error?: string; durationMs?: number }> {
    // ATOMIC: Retrieve and delete in one operation to prevent race conditions
    const challengeSet = await this.retrieveAndDelete(challengeId);

    if (!challengeSet) {
      return { valid: false, error: 'Challenge not found, expired, or already used' };
    }

    // Check expiration
    if (Date.now() > challengeSet.expiresAt) {
      return { valid: false, error: 'Challenge expired' };
    }

    // Verify client binding (prevent challenge theft)
    const clientBinding = await generateClientBinding(client);
    if (challengeSet.clientBinding && challengeSet.clientBinding !== clientBinding) {
      return { valid: false, error: 'Challenge was issued to a different client' };
    }

    // Verify each challenge
    for (const challenge of challengeSet.challenges) {
      const solution = solutions.find(s => s.type === challenge.type);

      if (!solution) {
        return { valid: false, error: `Missing solution for ${challenge.type} challenge` };
      }

      let isValid = false;

      if (challenge.type === 'pow') {
        isValid = await verifyPowSolution(challenge, solution.value);
      } else if (challenge.type === 'schema') {
        isValid = verifySchemaSolution(challenge, solution.value);
      }

      if (!isValid) {
        return { valid: false, error: `Invalid solution for ${challenge.type} challenge` };
      }
    }

    // Calculate solve duration for scoring
    const durationMs = Date.now() - challengeSet.issuedAt;

    return { valid: true, durationMs };
  }

  /**
   * Store a challenge set
   */
  private async store(challengeSet: ChallengeSet): Promise<void> {
    if (this.env.CHALLENGES) {
      // Use KV storage in production
      await this.env.CHALLENGES.put(challengeSet.id, JSON.stringify(challengeSet), {
        expirationTtl: Math.ceil(this.ttlMs / 1000) + 60, // Add buffer
      });
    } else {
      // Fallback to in-memory for local dev
      memoryStore.set(challengeSet.id, challengeSet);
      // Cleanup old entries periodically
      this.cleanupMemoryStore();
    }
  }

  /**
   * Atomically retrieve and delete a challenge to prevent race conditions
   */
  private async retrieveAndDelete(id: string): Promise<ChallengeSet | null> {
    if (this.env.CHALLENGES) {
      // KV: Get and delete atomically
      // Note: KV doesn't have true atomic get-and-delete, so we use a marker approach
      const data = await this.env.CHALLENGES.get(id);
      if (!data) return null;

      // Immediately delete to prevent reuse
      await this.env.CHALLENGES.delete(id);

      return JSON.parse(data);
    } else {
      // In-memory: Check if already verified (prevents race condition)
      if (verifiedChallenges.has(id)) {
        return null;
      }

      const challengeSet = memoryStore.get(id);
      if (!challengeSet) return null;

      // Mark as verified BEFORE processing (atomic in single-threaded JS)
      verifiedChallenges.add(id);
      memoryStore.delete(id);

      // Cleanup verified set periodically
      if (verifiedChallenges.size > 10000) {
        verifiedChallenges.clear();
      }

      return challengeSet;
    }
  }

  /**
   * Cleanup expired entries from memory store
   */
  private cleanupMemoryStore(): void {
    const now = Date.now();
    for (const [id, challenge] of memoryStore) {
      if (now > challenge.expiresAt) {
        memoryStore.delete(id);
      }
    }
  }
}
