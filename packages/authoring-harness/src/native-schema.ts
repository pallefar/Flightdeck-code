import { z } from 'zod';
import { fail } from './internal';

/** Linear projection of a required-field subset, not an optional-key powerset.
 * Runtime Zod refinements stay authoritative. No open objects, defaults or optionals.
 */
export function nativeRequiredSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodEffects) return nativeRequiredSchema(schema.innerType());
  if (schema instanceof z.ZodObject) {
    if (schema._def.unknownKeys !== 'strict') fail('invalid');
    const properties = Object.fromEntries(Object.entries(schema.shape as Record<string, z.ZodTypeAny>).map(([key, child]) => [key, nativeRequiredSchema(child)]));
    return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
  }
  if (schema instanceof z.ZodUnion) return { anyOf: schema.options.map((option: z.ZodTypeAny) => nativeRequiredSchema(option)) };
  if (schema instanceof z.ZodArray) {
    if (!schema._def.maxLength) fail('invalid');
    return { type: 'array', items: nativeRequiredSchema(schema.element), minItems: schema._def.minLength?.value ?? 0, maxItems: schema._def.maxLength.value };
  }
  if (schema instanceof z.ZodString) {
    if (schema.maxLength === null) fail('invalid');
    const result: Record<string, unknown> = { type: 'string', maxLength: schema.maxLength };
    for (const check of schema._def.checks) {
      if (check.kind === 'min') result.minLength = check.value;
      if (check.kind === 'regex') result.pattern = check.regex.source;
    }
    return result;
  }
  if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema.options, maxLength: Math.max(...schema.options.map((value: string) => value.length)) };
  if (schema instanceof z.ZodLiteral && typeof schema.value === 'string') return { type: 'string', enum: [schema.value], maxLength: schema.value.length };
  if (schema instanceof z.ZodNumber && schema.minValue !== null && schema.maxValue !== null) return { type: schema.isInt ? 'integer' : 'number', minimum: schema.minValue, maximum: schema.maxValue };
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  fail('invalid');
}
