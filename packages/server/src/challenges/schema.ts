/**
 * Schema Conformance Challenge
 *
 * Generate valid JSON conforming to a random schema.
 * Trivial for code, tedious for humans under time pressure.
 */

import type { Challenge, SchemaParams } from '../types';

// Predefined schemas that agents must conform to
const SCHEMAS = [
  {
    description: 'Declare your agent identity',
    schema: {
      type: 'object',
      required: ['agentName', 'agentVersion', 'capabilities'],
      properties: {
        agentName: { type: 'string', minLength: 1, maxLength: 100 },
        agentVersion: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+' },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 20,
        },
        contact: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    description: 'State your purpose',
    schema: {
      type: 'object',
      required: ['purpose', 'respectsRobotsTxt'],
      properties: {
        purpose: {
          type: 'string',
          enum: ['search-indexing', 'content-aggregation', 'monitoring', 'automation', 'testing', 'other'],
        },
        respectsRobotsTxt: { type: 'boolean' },
        crawlDelayMs: { type: 'number', minimum: 0 },
        maxRequestsPerMinute: { type: 'number', minimum: 1 },
      },
      additionalProperties: false,
    },
  },
  {
    description: 'Provide computational proof',
    schema: {
      type: 'object',
      required: ['timestamp', 'nonce', 'computation'],
      properties: {
        timestamp: { type: 'number' },
        nonce: { type: 'string', minLength: 8 },
        computation: {
          type: 'object',
          required: ['input', 'output'],
          properties: {
            input: { type: 'array', items: { type: 'number' }, minItems: 5 },
            output: { type: 'number' },
            operation: { type: 'string', enum: ['sum', 'product', 'mean'] },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
];

/**
 * Cryptographically secure random index selection
 */
function secureRandomIndex(max: number): number {
  const randomBuffer = new Uint32Array(1);
  crypto.getRandomValues(randomBuffer);
  return randomBuffer[0] % max;
}

export function generateSchemaChallenge(challengeId: string, ttlMs: number): Challenge {
  // Use crypto.getRandomValues instead of Math.random for security
  const template = SCHEMAS[secureRandomIndex(SCHEMAS.length)];

  return {
    id: `${challengeId}:schema`,
    type: 'schema',
    params: {
      schema: template.schema,
      description: template.description,
    } satisfies SchemaParams,
    expiresAt: Date.now() + ttlMs,
  };
}

export function verifySchemaSolution(challenge: Challenge, solution: unknown): boolean {
  if (challenge.type !== 'schema') return false;

  const params = challenge.params as SchemaParams;
  return validateAgainstSchema(params.schema, solution);
}

function validateAgainstSchema(schema: Record<string, unknown>, data: unknown): boolean {
  try {
    return validateNode(schema, data);
  } catch {
    return false;
  }
}

function validateNode(schema: Record<string, unknown>, data: unknown): boolean {
  const type = schema.type as string;

  if (type === 'object') {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return false;
    }

    const obj = data as Record<string, unknown>;
    const required = (schema.required as string[]) || [];
    const properties = (schema.properties as Record<string, Record<string, unknown>>) || {};

    // Check required fields
    for (const field of required) {
      if (!(field in obj)) {
        return false;
      }
    }

    // Validate each property
    for (const [key, value] of Object.entries(obj)) {
      if (properties[key]) {
        if (!validateNode(properties[key], value)) {
          return false;
        }
      } else if (schema.additionalProperties === false) {
        return false;
      }
    }

    return true;
  }

  if (type === 'array') {
    if (!Array.isArray(data)) return false;

    const minItems = schema.minItems as number | undefined;
    const maxItems = schema.maxItems as number | undefined;
    const items = schema.items as Record<string, unknown> | undefined;

    if (minItems !== undefined && data.length < minItems) return false;
    if (maxItems !== undefined && data.length > maxItems) return false;

    if (items) {
      for (const item of data) {
        if (!validateNode(items, item)) return false;
      }
    }

    return true;
  }

  if (type === 'string') {
    if (typeof data !== 'string') return false;

    const minLength = schema.minLength as number | undefined;
    const maxLength = schema.maxLength as number | undefined;
    const pattern = schema.pattern as string | undefined;
    const enumValues = schema.enum as string[] | undefined;

    if (minLength !== undefined && data.length < minLength) return false;
    if (maxLength !== undefined && data.length > maxLength) return false;
    if (pattern && !new RegExp(pattern).test(data)) return false;
    if (enumValues && !enumValues.includes(data)) return false;

    return true;
  }

  if (type === 'number') {
    if (typeof data !== 'number' || isNaN(data)) return false;

    const minimum = schema.minimum as number | undefined;
    const maximum = schema.maximum as number | undefined;

    if (minimum !== undefined && data < minimum) return false;
    if (maximum !== undefined && data > maximum) return false;

    return true;
  }

  if (type === 'boolean') {
    return typeof data === 'boolean';
  }

  return true;
}
