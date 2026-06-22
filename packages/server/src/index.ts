/**
 * ClawCaptcha Server
 *
 * Cloudflare Workers compatible verification server.
 * https://clawcaptcha.com
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ChallengeRegistry } from './challenges';
import { TokenService } from './tokens';
import { collectSignals, calculateBotScore } from './signals';
import { rateLimit } from './middleware/rate-limit';
import type { Env, SolveRequest, InlineChallengeResponse, VerifyResult, ClientContext } from './types';

const app = new Hono<{ Bindings: Env }>();

// Input validation limits
const VALIDATION_LIMITS = {
  MAX_CHALLENGE_ID_LENGTH: 64,
  MAX_SOLUTIONS: 10,
  MAX_SOLUTION_TYPE_LENGTH: 32,
  MAX_SOLUTION_VALUE_SIZE: 10_000, // 10KB
  MAX_TOKEN_LENGTH: 4096,
};

/**
 * Extract client context from request for binding
 */
function getClientContext(c: { req: { header: (name: string) => string | undefined } }): ClientContext {
  // Cloudflare provides real IP
  const ip = c.req.header('cf-connecting-ip')
    || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';

  const userAgent = c.req.header('user-agent') || null;

  return { ip, userAgent };
}

/**
 * Validate solve request input
 */
function validateSolveRequest(body: unknown): { valid: true; data: SolveRequest } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Invalid request body' };
  }

  const req = body as Record<string, unknown>;

  // Validate challengeId
  if (typeof req.challengeId !== 'string') {
    return { valid: false, error: 'Missing or invalid challengeId' };
  }
  if (req.challengeId.length > VALIDATION_LIMITS.MAX_CHALLENGE_ID_LENGTH) {
    return { valid: false, error: 'challengeId too long' };
  }

  // Validate solutions array
  if (!Array.isArray(req.solutions)) {
    return { valid: false, error: 'Missing or invalid solutions array' };
  }
  if (req.solutions.length === 0) {
    return { valid: false, error: 'Solutions array is empty' };
  }
  if (req.solutions.length > VALIDATION_LIMITS.MAX_SOLUTIONS) {
    return { valid: false, error: 'Too many solutions' };
  }

  // Validate each solution
  for (let i = 0; i < req.solutions.length; i++) {
    const solution = req.solutions[i] as Record<string, unknown>;

    if (!solution || typeof solution !== 'object') {
      return { valid: false, error: `Invalid solution at index ${i}` };
    }
    if (typeof solution.type !== 'string') {
      return { valid: false, error: `Missing type in solution at index ${i}` };
    }
    if (solution.type.length > VALIDATION_LIMITS.MAX_SOLUTION_TYPE_LENGTH) {
      return { valid: false, error: `Solution type too long at index ${i}` };
    }
    if (solution.value === undefined) {
      return { valid: false, error: `Missing value in solution at index ${i}` };
    }

    // Check solution value size (rough estimate)
    const valueSize = JSON.stringify(solution.value).length;
    if (valueSize > VALIDATION_LIMITS.MAX_SOLUTION_VALUE_SIZE) {
      return { valid: false, error: `Solution value too large at index ${i}` };
    }
  }

  return {
    valid: true,
    data: {
      challengeId: req.challengeId,
      solutions: req.solutions.map((s: Record<string, unknown>) => ({
        type: s.type as 'pow' | 'schema',
        value: s.value,
      })),
    },
  };
}

// CORS for browser widget
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-ClawCaptcha-Solution', 'X-API-Key'],
  exposeHeaders: ['WWW-Authenticate', 'X-ClawCaptcha-Token', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
}));

// Health check
app.get('/v1/health', (c) => {
  return c.json({ status: 'ok', version: '0.1.0' });
});

// Discovery endpoint
app.get('/v1/.well-known/clawcaptcha.json', (c) => {
  return c.json({
    version: '0.1.0',
    protocol: 'https://clawcaptcha.com/protocol',
    endpoints: {
      issue: '/v1/challenge/issue',
      solve: '/v1/challenge/solve',
      verify: '/v1/verify',
    },
    challenges: ['pow', 'schema'],
    pow: {
      algorithm: 'sha256',
      difficulty: parseInt(c.env.POW_DIFFICULTY || '18', 10),
    },
  });
});

// Rate limit challenge issuance (10 per minute per IP)
app.use('/v1/challenge/issue', rateLimit({
  windowMs: 60_000,
  maxRequests: 10,
  keyPrefix: 'ratelimit:issue:',
}));

// Issue a new challenge
app.post('/v1/challenge/issue', async (c) => {
  const client = getClientContext(c);
  const registry = new ChallengeRegistry(c.env);
  const challengeSet = await registry.issue(client);

  // Don't expose client binding in response
  const { clientBinding: _, ...publicChallengeSet } = challengeSet;

  return c.json(publicChallengeSet);
});

// Rate limit solution submission (20 per minute per IP)
app.use('/v1/challenge/solve', rateLimit({
  windowMs: 60_000,
  maxRequests: 20,
  keyPrefix: 'ratelimit:solve:',
}));

// Solve a challenge and get token
app.post('/v1/challenge/solve', async (c) => {
  let rawBody: unknown;

  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  // Validate input
  const validation = validateSolveRequest(rawBody);
  if (!validation.valid) {
    return c.json({ success: false, error: validation.error }, 400);
  }

  const body = validation.data;
  const client = getClientContext(c);

  const registry = new ChallengeRegistry(c.env);
  const result = await registry.verify(body.challengeId, body.solutions, client);

  if (!result.valid) {
    return c.json({ success: false, error: result.error }, 400);
  }

  // Collect signals and calculate score
  const signals = collectSignals(c.req.raw.headers, result.durationMs);
  const { score } = calculateBotScore(signals);

  // High score = bot, low score = human
  const verifiedAs = score > 0.5 ? 'bot' : 'human';

  // Issue token
  const tokenService = new TokenService(c.env);
  const token = await tokenService.issue({
    verifiedAs,
    score,
    challenges: body.solutions.map(s => s.type),
    challengeId: body.challengeId,
  });

  return c.json({
    success: true,
    token,
    verifiedAs,
    score,
  });
});

// Verify a token (for downstream services)
app.post('/v1/verify', async (c) => {
  let body: { token?: unknown };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ valid: false, error: 'Invalid JSON body' } satisfies VerifyResult, 400);
  }

  // Validate token input
  if (typeof body.token !== 'string') {
    return c.json({ valid: false, error: 'Missing or invalid token' } satisfies VerifyResult, 400);
  }
  if (body.token.length > VALIDATION_LIMITS.MAX_TOKEN_LENGTH) {
    return c.json({ valid: false, error: 'Token too long' } satisfies VerifyResult, 400);
  }

  const tokenService = new TokenService(c.env);

  try {
    const payload = await tokenService.verify(body.token);

    return c.json({
      valid: true,
      verifiedAs: payload.clw.verified,
      score: payload.clw.score,
      expiresAt: payload.exp,
    } satisfies VerifyResult);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid token';
    return c.json({ valid: false, error: message } satisfies VerifyResult, 401);
  }
});

// Inline challenge endpoint for protected routes
// Returns 401 with challenge in body (for API-first flow)
app.all('/v1/protected', async (c) => {
  const client = getClientContext(c);

  // Check for solution in header (retry with solution)
  const solutionHeader = c.req.header('X-ClawCaptcha-Solution');

  if (solutionHeader) {
    let rawSolution: unknown;

    try {
      rawSolution = JSON.parse(atob(solutionHeader));
    } catch {
      return c.json({ error: 'Invalid X-ClawCaptcha-Solution header' }, 400);
    }

    // Validate input
    const validation = validateSolveRequest(rawSolution);
    if (!validation.valid) {
      return c.json({ error: validation.error }, 400);
    }

    const solution = validation.data;
    const registry = new ChallengeRegistry(c.env);
    const result = await registry.verify(solution.challengeId, solution.solutions, client);

    if (!result.valid) {
      return c.json({ error: result.error }, 401);
    }

    // Collect signals and calculate score
    const signals = collectSignals(c.req.raw.headers, result.durationMs);
    const { score } = calculateBotScore(signals);
    const verifiedAs = score > 0.5 ? 'bot' : 'human';

    // Issue token
    const tokenService = new TokenService(c.env);
    const token = await tokenService.issue({
      verifiedAs,
      score,
      challenges: solution.solutions.map(s => s.type),
      challengeId: solution.challengeId,
    });

    // Set token in response header
    c.header('X-ClawCaptcha-Token', token);

    return c.json({
      success: true,
      message: 'Verification successful',
      verifiedAs,
      token,
    });
  }

  // Check for existing token
  const authHeader = c.req.header('Authorization');

  if (authHeader?.startsWith('ClawCaptcha ')) {
    const token = authHeader.slice(12);

    // Validate token length
    if (token.length > VALIDATION_LIMITS.MAX_TOKEN_LENGTH) {
      return c.json({ error: 'Token too long' }, 400);
    }

    const tokenService = new TokenService(c.env);

    try {
      const payload = await tokenService.verify(token);

      return c.json({
        success: true,
        message: 'Token valid',
        verifiedAs: payload.clw.verified,
      });
    } catch {
      // Token invalid/expired, fall through to issue new challenge
    }
  }

  // Issue challenge (401 response)
  const registry = new ChallengeRegistry(c.env);
  const challengeSet = await registry.issue(client);

  // Don't expose client binding in response
  const { clientBinding: _, ...publicChallengeSet } = challengeSet;

  const response: InlineChallengeResponse = {
    error: 'clawcaptcha_required',
    challenge: publicChallengeSet,
  };

  c.header('WWW-Authenticate', `ClawCaptcha challenge="${btoa(JSON.stringify(publicChallengeSet))}"`);

  return c.json(response, 401);
});

// Export for Cloudflare Workers
export default app;

// Also export types and classes for library usage
export { ChallengeRegistry } from './challenges';
export { TokenService } from './tokens';
export { collectSignals, calculateBotScore } from './signals';
export { rateLimit } from './middleware/rate-limit';
export * from './types';
