import { describe, it, expect } from 'vitest';
import { solvePow } from '../src/solvers/pow';
import { solveSchema } from '../src/solvers/schema';

describe('PoW Solver', () => {
  it('finds valid nonce for low difficulty', async () => {
    const params = {
      prefix: 'test:',
      difficulty: 8, // Very low for fast test
      algorithm: 'sha256' as const,
    };

    const solution = await solvePow(params);
    expect(solution).toBeDefined();
    expect(typeof solution).toBe('string');

    // Verify the solution
    const data = new TextEncoder().encode(params.prefix + solution);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = new Uint8Array(hashBuffer);

    // Check leading zeros
    let zeroBits = 0;
    for (const byte of hashArray) {
      if (byte === 0) {
        zeroBits += 8;
      } else {
        zeroBits += Math.clz32(byte) - 24;
        break;
      }
      if (zeroBits >= params.difficulty) break;
    }

    expect(zeroBits).toBeGreaterThanOrEqual(params.difficulty);
  });
});

describe('Schema Solver', () => {
  const agentConfig = {
    agentName: 'TestBot',
    agentVersion: '1.0.0',
    capabilities: ['testing'],
  };

  it('solves identity schema', () => {
    const params = {
      schema: {
        type: 'object',
        required: ['agentName', 'agentVersion', 'capabilities'],
        properties: {
          agentName: { type: 'string' },
          agentVersion: { type: 'string' },
          capabilities: { type: 'array', items: { type: 'string' } },
        },
      },
      description: 'Declare your agent identity',
    };

    const solution = solveSchema(params, agentConfig) as Record<string, unknown>;

    expect(solution.agentName).toBe('TestBot');
    expect(solution.agentVersion).toBe('1.0.0');
    expect(solution.capabilities).toEqual(['testing']);
  });

  it('solves purpose schema', () => {
    const params = {
      schema: {
        type: 'object',
        required: ['purpose', 'respectsRobotsTxt'],
        properties: {
          purpose: { type: 'string' },
          respectsRobotsTxt: { type: 'boolean' },
        },
      },
      description: 'State your purpose',
    };

    const solution = solveSchema(params, agentConfig) as Record<string, unknown>;

    expect(solution.purpose).toBeDefined();
    expect(solution.respectsRobotsTxt).toBe(true);
  });

  it('solves computation schema', () => {
    const params = {
      schema: {
        type: 'object',
        required: ['timestamp', 'nonce', 'computation'],
        properties: {
          timestamp: { type: 'number' },
          nonce: { type: 'string' },
          computation: { type: 'object' },
        },
      },
      description: 'Provide computational proof',
    };

    const solution = solveSchema(params, agentConfig) as Record<string, unknown>;

    expect(solution.timestamp).toBeDefined();
    expect(typeof solution.timestamp).toBe('number');
    expect(solution.nonce).toBeDefined();
    expect(solution.computation).toBeDefined();
  });
});
