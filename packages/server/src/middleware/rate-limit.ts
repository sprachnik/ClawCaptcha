/**
 * Rate Limiting Middleware
 *
 * Simple in-memory rate limiter for challenge issuance.
 * Uses Cloudflare KV in production for distributed limiting.
 */

import type { Context, Next } from 'hono';
import type { Env } from '../types';

interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
  keyPrefix: string;     // Key prefix for storage
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60_000,      // 1 minute
  maxRequests: 10,       // 10 requests per minute
  keyPrefix: 'ratelimit:',
};

// In-memory store for development
const memoryStore = new Map<string, { count: number; resetAt: number }>();

/**
 * Get client identifier from request
 */
function getClientId(c: Context<{ Bindings: Env }>): string {
  // Cloudflare provides real IP via header
  const cfIp = c.req.header('cf-connecting-ip');
  if (cfIp) return cfIp;

  // Fallback for local dev
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();

  // Last resort
  return 'unknown';
}

/**
 * Rate limit middleware factory
 */
export function rateLimit(config: Partial<RateLimitConfig> = {}) {
  const { windowMs, maxRequests, keyPrefix } = { ...DEFAULT_CONFIG, ...config };

  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const clientId = getClientId(c);
    const key = `${keyPrefix}${clientId}`;
    const now = Date.now();

    // Try KV storage first (production)
    if (c.env.RATE_LIMITS) {
      const stored = await c.env.RATE_LIMITS.get(key, 'json') as { count: number; resetAt: number } | null;

      if (stored && now < stored.resetAt) {
        if (stored.count >= maxRequests) {
          c.header('X-RateLimit-Limit', String(maxRequests));
          c.header('X-RateLimit-Remaining', '0');
          c.header('X-RateLimit-Reset', String(Math.ceil(stored.resetAt / 1000)));
          c.header('Retry-After', String(Math.ceil((stored.resetAt - now) / 1000)));

          return c.json({
            error: 'rate_limit_exceeded',
            message: 'Too many requests. Please try again later.',
            retryAfter: Math.ceil((stored.resetAt - now) / 1000),
          }, 429);
        }

        // Increment count
        await c.env.RATE_LIMITS.put(key, JSON.stringify({
          count: stored.count + 1,
          resetAt: stored.resetAt,
        }), { expirationTtl: Math.ceil(windowMs / 1000) + 10 });

        c.header('X-RateLimit-Limit', String(maxRequests));
        c.header('X-RateLimit-Remaining', String(maxRequests - stored.count - 1));
        c.header('X-RateLimit-Reset', String(Math.ceil(stored.resetAt / 1000)));
      } else {
        // New window
        const resetAt = now + windowMs;
        await c.env.RATE_LIMITS.put(key, JSON.stringify({
          count: 1,
          resetAt,
        }), { expirationTtl: Math.ceil(windowMs / 1000) + 10 });

        c.header('X-RateLimit-Limit', String(maxRequests));
        c.header('X-RateLimit-Remaining', String(maxRequests - 1));
        c.header('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
      }
    } else {
      // Fallback to in-memory for development
      const stored = memoryStore.get(key);

      if (stored && now < stored.resetAt) {
        if (stored.count >= maxRequests) {
          c.header('X-RateLimit-Limit', String(maxRequests));
          c.header('X-RateLimit-Remaining', '0');
          c.header('X-RateLimit-Reset', String(Math.ceil(stored.resetAt / 1000)));

          return c.json({
            error: 'rate_limit_exceeded',
            message: 'Too many requests. Please try again later.',
            retryAfter: Math.ceil((stored.resetAt - now) / 1000),
          }, 429);
        }

        stored.count++;
        c.header('X-RateLimit-Limit', String(maxRequests));
        c.header('X-RateLimit-Remaining', String(maxRequests - stored.count));
        c.header('X-RateLimit-Reset', String(Math.ceil(stored.resetAt / 1000)));
      } else {
        const resetAt = now + windowMs;
        memoryStore.set(key, { count: 1, resetAt });

        c.header('X-RateLimit-Limit', String(maxRequests));
        c.header('X-RateLimit-Remaining', String(maxRequests - 1));
        c.header('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));

        // Cleanup old entries periodically
        if (memoryStore.size > 10000) {
          for (const [k, v] of memoryStore) {
            if (now > v.resetAt) memoryStore.delete(k);
          }
        }
      }
    }

    return next();
  };
}
