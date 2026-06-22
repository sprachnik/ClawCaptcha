/**
 * ClawCaptcha Agent SDK
 *
 * For AI agents to prove their bot identity.
 * https://clawcaptcha.com
 */

import { solvePow } from './solvers/pow';
import { solveSchema } from './solvers/schema';

export interface AgentConfig {
  /** ClawCaptcha server URL */
  serverUrl: string;
  /** Agent name (e.g., "MyBot") */
  agentName: string;
  /** Agent version (e.g., "1.0.0") */
  agentVersion: string;
  /** Agent capabilities */
  capabilities: string[];
  /** Contact URL or email */
  contact?: string;
  /** Agent purpose */
  purpose?: 'search-indexing' | 'content-aggregation' | 'monitoring' | 'automation' | 'testing' | 'other';
}

export interface SolveResult {
  success: boolean;
  token?: string;
  verifiedAs?: 'bot' | 'human';
  score?: number;
  error?: string;
  durationMs?: number;
}

interface Challenge {
  id: string;
  type: 'pow' | 'schema';
  params: Record<string, unknown>;
  expiresAt: number;
}

interface ChallengeSet {
  id: string;
  challenges: Challenge[];
  expiresAt: number;
}

interface SolveResponse {
  success: boolean;
  token?: string;
  verifiedAs?: 'bot' | 'human';
  score?: number;
  error?: string;
}

interface InlineChallengeBody {
  error?: string;
  challenge?: ChallengeSet;
}

export class ClawCaptchaAgent {
  private config: AgentConfig;
  private baseUrl: string;

  constructor(config: AgentConfig) {
    this.config = config;
    this.baseUrl = config.serverUrl.replace(/\/$/, '');
  }

  /**
   * Solve a ClawCaptcha challenge and get a verification token.
   */
  async solve(): Promise<SolveResult> {
    const startTime = Date.now();

    try {
      // 1. Request challenge
      const issueResponse = await fetch(`${this.baseUrl}/v1/challenge/issue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `${this.config.agentName}/${this.config.agentVersion} (@clawcaptcha/agent-sdk)`,
        },
        body: JSON.stringify({}),
      });

      if (!issueResponse.ok) {
        const error = await issueResponse.text();
        return { success: false, error: `Failed to issue challenge: ${error}` };
      }

      const challengeSet = await issueResponse.json() as ChallengeSet;

      // 2. Solve all challenges
      const solutions = await this.solveChallenges(challengeSet.challenges);

      // 3. Submit solutions
      const solveResponse = await fetch(`${this.baseUrl}/v1/challenge/solve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `${this.config.agentName}/${this.config.agentVersion} (@clawcaptcha/agent-sdk)`,
        },
        body: JSON.stringify({
          challengeId: challengeSet.id,
          solutions,
        }),
      });

      const result = await solveResponse.json() as SolveResponse;
      const durationMs = Date.now() - startTime;

      if (!result.success) {
        return { success: false, error: result.error, durationMs };
      }

      return {
        success: true,
        token: result.token,
        verifiedAs: result.verifiedAs,
        score: result.score,
        durationMs,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Handle inline challenge flow (401 response with challenge).
   * Automatically retries the request with the solution.
   */
  async solveInline(url: string, options: RequestInit = {}): Promise<Response> {
    // First request
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'User-Agent': `${this.config.agentName}/${this.config.agentVersion} (@clawcaptcha/agent-sdk)`,
      },
    });

    // Check if ClawCaptcha challenge required
    if (response.status !== 401) {
      return response;
    }

    const body = await response.json().catch(() => null) as InlineChallengeBody | null;

    if (!body || body.error !== 'clawcaptcha_required' || !body.challenge) {
      // Not a ClawCaptcha challenge, return original response
      return new Response(JSON.stringify(body), {
        status: response.status,
        headers: response.headers,
      });
    }

    const challengeSet = body.challenge;

    // Solve challenges
    const solutions = await this.solveChallenges(challengeSet.challenges);

    // Retry with solution in header
    const solutionPayload = {
      challengeId: challengeSet.id,
      solutions,
    };

    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'User-Agent': `${this.config.agentName}/${this.config.agentVersion} (@clawcaptcha/agent-sdk)`,
        'X-ClawCaptcha-Solution': btoa(JSON.stringify(solutionPayload)),
      },
    });
  }

  private async solveChallenges(challenges: Challenge[]): Promise<{ type: string; value: unknown }[]> {
    const solutions: { type: string; value: unknown }[] = [];

    for (const challenge of challenges) {
      if (challenge.type === 'pow') {
        const params = challenge.params as { prefix: string; difficulty: number; algorithm: 'sha256' };
        const solution = await solvePow(params);
        solutions.push({ type: 'pow', value: solution });
      } else if (challenge.type === 'schema') {
        const params = challenge.params as { schema: Record<string, unknown>; description: string };
        const solution = solveSchema(params, this.config);
        solutions.push({ type: 'schema', value: solution });
      }
    }

    return solutions;
  }
}

// Re-export solvers for advanced usage
export { solvePow } from './solvers/pow';
export { solveSchema } from './solvers/schema';
