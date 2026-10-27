import { z } from 'zod';
import { configSchemas } from '../../workflow/graph';
import { freeze } from './internal';

/** Structural projection only: effects/refinements remain authoritative in configSchemas/graphSchema. */
function project(schema: z.ZodTypeAny, depth = 0): Record<string, unknown> {
  if (depth > 8) return { description: 'Bounded JSON; validated by the workflow registry at proposal time' };
  const next = (s: z.ZodTypeAny) => project(s, depth + 1);
  if (schema instanceof z.ZodEffects) return { ...next(schema.innerType()), 'x-flightdeck-runtime-refinement': true };
  if (schema instanceof z.ZodDefault) return { ...next(schema.removeDefault()), default: schema._def.defaultValue() };
  if (schema instanceof z.ZodOptional) return next(schema.unwrap());
  if (schema instanceof z.ZodLazy) return next(schema.schema);
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, z.ZodTypeAny> = schema.shape;
    return { type: 'object', additionalProperties: false, properties: Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, next(value)])), required: Object.entries(shape).filter(([, s]) => !s.isOptional()).map(([key]) => key) };
  }
  if (schema instanceof z.ZodRecord) return { type: 'object', additionalProperties: next(schema.valueSchema) };
  if (schema instanceof z.ZodArray) return { type: 'array', items: next(schema.element), ...(schema._def.maxLength ? { maxItems: schema._def.maxLength.value } : {}) };
  if (schema instanceof z.ZodUnion) return { anyOf: schema.options.map(next) };
  if (schema instanceof z.ZodString) {
    const result: Record<string, unknown> = { type: 'string' };
    for (const check of schema._def.checks) {
      if (check.kind === 'max') result.maxLength = check.value;
      if (check.kind === 'min') result.minLength = check.value;
      if (check.kind === 'regex') result.pattern = check.regex.source;
      if (check.kind === 'uuid') result.format = 'uuid';
    }
    return result;
  }
  if (schema instanceof z.ZodNumber) return { type: schema.isInt ? 'integer' : 'number', ...(Number.isFinite(schema.minValue) ? { minimum: schema.minValue } : {}), ...(Number.isFinite(schema.maxValue) ? { maximum: schema.maxValue } : {}) };
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  if (schema instanceof z.ZodNull) return { type: 'null' };
  if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema.options };
  if (schema instanceof z.ZodLiteral) return { const: schema.value };
  // Never imply that an unmodelled registry declaration was faithfully projected.
  throw new Error('authoring invalid');
}
export const registrySchemas = freeze(Object.fromEntries(Object.entries(configSchemas).map(([type, schema]) => [type, project(schema)])));
