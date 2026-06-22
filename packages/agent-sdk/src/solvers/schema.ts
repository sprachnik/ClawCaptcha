/**
 * Schema Conformance Solver
 *
 * Generates valid JSON conforming to the given schema.
 * Uses agent config to populate identity/purpose schemas.
 */

interface SchemaParams {
  schema: Record<string, unknown>;
  description: string;
}

interface AgentConfig {
  agentName: string;
  agentVersion: string;
  capabilities: string[];
  contact?: string;
  purpose?: string;
}

export function solveSchema(params: SchemaParams, agentConfig: AgentConfig): unknown {
  const { schema } = params;
  const required = (schema.required as string[]) || [];

  // Identity schema
  if (required.includes('agentName') && required.includes('agentVersion')) {
    return {
      agentName: agentConfig.agentName,
      agentVersion: agentConfig.agentVersion,
      capabilities: agentConfig.capabilities,
      ...(agentConfig.contact && { contact: agentConfig.contact }),
    };
  }

  // Purpose schema
  if (required.includes('purpose') && required.includes('respectsRobotsTxt')) {
    return {
      purpose: agentConfig.purpose || 'automation',
      respectsRobotsTxt: true,
      crawlDelayMs: 1000,
      maxRequestsPerMinute: 60,
    };
  }

  // Computational proof schema
  if (required.includes('timestamp') && required.includes('computation')) {
    const input = [1, 2, 3, 4, 5];
    return {
      timestamp: Date.now(),
      nonce: crypto.randomUUID().slice(0, 8),
      computation: {
        input,
        output: input.reduce((a, b) => a + b, 0),
        operation: 'sum',
      },
    };
  }

  // Fallback: try to generate something valid
  return generateFromSchema(schema, agentConfig);
}

function generateFromSchema(schema: Record<string, unknown>, agentConfig: AgentConfig): unknown {
  const type = schema.type as string;

  if (type === 'object') {
    const result: Record<string, unknown> = {};
    const properties = (schema.properties as Record<string, Record<string, unknown>>) || {};
    const required = (schema.required as string[]) || [];

    for (const key of required) {
      if (properties[key]) {
        result[key] = generateFromSchema(properties[key], agentConfig);
      }
    }

    return result;
  }

  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    const minItems = (schema.minItems as number) || 1;

    if (items) {
      return Array.from({ length: minItems }, () => generateFromSchema(items, agentConfig));
    }

    return [];
  }

  if (type === 'string') {
    const enumValues = schema.enum as string[] | undefined;
    if (enumValues) return enumValues[0];
    return agentConfig.agentName;
  }

  if (type === 'number') {
    const minimum = (schema.minimum as number) ?? 0;
    return minimum;
  }

  if (type === 'boolean') {
    return true;
  }

  return null;
}
