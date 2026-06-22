import { describe, it, expect } from 'vitest';
import { collectSignals, calculateBotScore } from '../src/signals';

// Helper to create Headers from an object
function makeHeaders(obj: Record<string, string>): Headers {
  return new Headers(obj);
}

describe('collectSignals', () => {
  it('captures user agent', () => {
    const signals = collectSignals(makeHeaders({ 'user-agent': 'curl/7.0' }));
    expect(signals.headers?.userAgent).toBe('curl/7.0');
  });

  it('detects missing user agent', () => {
    const signals = collectSignals(makeHeaders({}));
    expect(signals.headers?.userAgent).toBeNull();
  });

  it('detects sec-fetch headers', () => {
    const signals = collectSignals(makeHeaders({
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
    }));
    expect(signals.headers?.hasSecFetchHeaders).toBe(true);
  });

  it('detects missing sec-fetch headers', () => {
    const signals = collectSignals(makeHeaders({ 'user-agent': 'bot' }));
    expect(signals.headers?.hasSecFetchHeaders).toBe(false);
  });

  it('counts non-infrastructure headers', () => {
    const signals = collectSignals(makeHeaders({
      'user-agent': 'test',
      'accept': '*/*',
      'content-type': 'application/json',
      'cf-connecting-ip': '1.2.3.4',   // excluded (cf-)
      'x-request-id': 'abc',            // excluded (x-)
    }));
    // Only user-agent, accept, content-type should count
    expect(signals.headers?.headerCount).toBe(3);
  });

  it('includes timing when durationMs is provided', () => {
    const signals = collectSignals(makeHeaders({}), 150);
    expect(signals.timing).toBeDefined();
    expect(signals.timing?.durationMs).toBe(150);
  });

  it('omits timing when durationMs is not provided', () => {
    const signals = collectSignals(makeHeaders({}));
    expect(signals.timing).toBeUndefined();
  });
});

describe('calculateBotScore', () => {
  it('scores very fast solve as high bot probability', () => {
    const { score, factors } = calculateBotScore({
      timing: { challengeIssuedAt: 0, solutionSubmittedAt: 100, durationMs: 100 },
      headers: { userAgent: 'curl/7.0', hasSecFetchHeaders: false, headerCount: 2 },
    });

    expect(score).toBeGreaterThan(0.9);
    expect(factors.veryFastSolve).toBeDefined();
    expect(factors.botLikeUserAgent).toBeDefined();
  });

  it('scores slow solve with browser headers as low bot probability', () => {
    const { score, factors } = calculateBotScore({
      timing: { challengeIssuedAt: 0, solutionSubmittedAt: 35000, durationMs: 35000 },
      headers: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
        hasSecFetchHeaders: true,
        headerCount: 12,
      },
    });

    expect(score).toBeLessThan(0.5);
    expect(factors.slowSolve).toBeDefined();
  });

  it('penalizes missing user agent', () => {
    const { factors } = calculateBotScore({
      headers: { userAgent: null, hasSecFetchHeaders: true, headerCount: 10 },
    });
    expect(factors.missingUserAgent).toBeDefined();
  });

  it('penalizes low header count', () => {
    const { factors } = calculateBotScore({
      headers: { userAgent: 'Mozilla/5.0 Chrome', hasSecFetchHeaders: true, headerCount: 3 },
    });
    expect(factors.lowHeaderCount).toBeDefined();
  });

  it('recognizes bot-like user agents', () => {
    const botUAs = ['curl/7.0', 'python-requests/2.31', 'axios/1.6', 'Scrapy/2.11', 'MyBot spider'];

    for (const ua of botUAs) {
      const { factors } = calculateBotScore({
        headers: { userAgent: ua, hasSecFetchHeaders: false, headerCount: 3 },
      });
      expect(factors.botLikeUserAgent).toBeDefined();
    }
  });

  it('does not flag normal browser user agents as bot-like', () => {
    const { factors } = calculateBotScore({
      headers: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        hasSecFetchHeaders: true,
        headerCount: 10,
      },
    });
    expect(factors.botLikeUserAgent).toBeUndefined();
  });

  it('returns 0.5 with no signals', () => {
    // With no timing and no headers, logOdds = 0, sigmoid(0) = 0.5
    const { score } = calculateBotScore({});
    expect(score).toBe(0.5);
  });

  it('score is between 0 and 1', () => {
    // Even with all bot signals stacked
    const { score } = calculateBotScore({
      timing: { challengeIssuedAt: 0, solutionSubmittedAt: 10, durationMs: 10 },
      headers: { userAgent: null, hasSecFetchHeaders: false, headerCount: 1 },
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('medium solve speed (2-30s) triggers neither fast nor slow factor', () => {
    const { factors } = calculateBotScore({
      timing: { challengeIssuedAt: 0, solutionSubmittedAt: 5000, durationMs: 5000 },
    });
    expect(factors.veryFastSolve).toBeUndefined();
    expect(factors.fastSolve).toBeUndefined();
    expect(factors.slowSolve).toBeUndefined();
  });

  it('fast solve (500ms-2s) triggers fastSolve factor', () => {
    const { factors } = calculateBotScore({
      timing: { challengeIssuedAt: 0, solutionSubmittedAt: 1000, durationMs: 1000 },
    });
    expect(factors.fastSolve).toBeDefined();
    expect(factors.veryFastSolve).toBeUndefined();
  });
});
