/**
 * Passive Signal Analysis & Scoring
 *
 * Analyzes request characteristics to compute bot probability.
 * Uses weighted logistic regression for scoring.
 */

import type { PassiveSignals } from '../types';

interface ScoringFactors {
  veryFastSolve: number;     // Solved in <500ms (definitely bot)
  fastSolve: number;         // Solved in <2s (likely bot)
  slowSolve: number;         // Solved in >30s (maybe human struggling)
  missingUserAgent: number;
  botLikeUserAgent: number;
  noSecFetchHeaders: number;
  lowHeaderCount: number;
}

const WEIGHTS: ScoringFactors = {
  veryFastSolve: 3.0,
  fastSolve: 1.5,
  slowSolve: -1.0,
  missingUserAgent: 1.5,
  botLikeUserAgent: 2.0,
  noSecFetchHeaders: 0.8,
  lowHeaderCount: 0.5,
};

export function collectSignals(headers: Headers, durationMs?: number): PassiveSignals {
  const userAgent = headers.get('user-agent');
  const hasSecFetch = !!(
    headers.get('sec-fetch-mode') ||
    headers.get('sec-fetch-site') ||
    headers.get('sec-fetch-dest')
  );

  // Count headers (excluding common infrastructure headers)
  let headerCount = 0;
  headers.forEach((_, key) => {
    if (!key.startsWith('cf-') && !key.startsWith('x-')) {
      headerCount++;
    }
  });

  return {
    timing: durationMs
      ? {
          challengeIssuedAt: Date.now() - durationMs,
          solutionSubmittedAt: Date.now(),
          durationMs,
        }
      : undefined,
    headers: {
      userAgent,
      hasSecFetchHeaders: hasSecFetch,
      headerCount,
    },
  };
}

export function calculateBotScore(signals: PassiveSignals): { score: number; factors: Record<string, number> } {
  const factors: Record<string, number> = {};
  let logOdds = 0;

  // Timing analysis
  if (signals.timing) {
    const duration = signals.timing.durationMs;

    if (duration < 500) {
      factors.veryFastSolve = WEIGHTS.veryFastSolve;
      logOdds += WEIGHTS.veryFastSolve;
    } else if (duration < 2000) {
      factors.fastSolve = WEIGHTS.fastSolve;
      logOdds += WEIGHTS.fastSolve;
    } else if (duration > 30000) {
      factors.slowSolve = WEIGHTS.slowSolve;
      logOdds += WEIGHTS.slowSolve;
    }
  }

  // Header analysis
  if (signals.headers) {
    if (!signals.headers.userAgent) {
      factors.missingUserAgent = WEIGHTS.missingUserAgent;
      logOdds += WEIGHTS.missingUserAgent;
    } else if (isBotLikeUserAgent(signals.headers.userAgent)) {
      factors.botLikeUserAgent = WEIGHTS.botLikeUserAgent;
      logOdds += WEIGHTS.botLikeUserAgent;
    }

    if (!signals.headers.hasSecFetchHeaders) {
      factors.noSecFetchHeaders = WEIGHTS.noSecFetchHeaders;
      logOdds += WEIGHTS.noSecFetchHeaders;
    }

    if (signals.headers.headerCount < 5) {
      factors.lowHeaderCount = WEIGHTS.lowHeaderCount;
      logOdds += WEIGHTS.lowHeaderCount;
    }
  }

  // Convert log-odds to probability using sigmoid
  const score = 1 / (1 + Math.exp(-logOdds));

  return { score, factors };
}

function isBotLikeUserAgent(ua: string): boolean {
  const botIndicators = [
    'curl',
    'wget',
    'httpie',
    'python-requests',
    'python-urllib',
    'node-fetch',
    'axios',
    'got/',
    'undici',
    'postman',
    'insomnia',
    'scrapy',
    'bot',
    'crawler',
    'spider',
    'agent-sdk',
    'clawcaptcha',
  ];

  const lowerUa = ua.toLowerCase();
  return botIndicators.some(indicator => lowerUa.includes(indicator));
}
