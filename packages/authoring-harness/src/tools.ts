import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { configSchemas } from '../../workflow/graph';
import { freeze } from './internal';

const id = z.string().max(64).regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
const scalar = z.union([z.null(), z.boolean(), z.number().finite().min(-1e15).max(1e15), z.string().max(2000)]);
const path = z.array(z.union([z.string().min(1).max(64), z.number().int().min(0).max(99)])).max(16);
const mapping = z.object({ target: id, source: z.union([
  z.object({ kind: z.literal('literal'), value: scalar }).strict(),
  z.object({ kind: z.literal('input'), path }).strict(),
  z.object({ kind: z.literal('node'), nodeId: id, path }).strict(),
]) }).strict();
/** Deliberately narrower than all workflow configs. Unsupported dynamic dictionaries/wrappers deny. */
const proposalConfigs = {
  ...configSchemas,
  http: configSchemas.http.omit({ body: true }),
  llm: configSchemas.llm.omit({ model: true }),
  set: z.object({ fields: z.object({}).strict().optional() }).strict(),
  branch: configSchemas.branch.extend({ value: scalar.optional() }),
};
const nodeSchemas = Object.entries(proposalConfigs).map(([type, config]) => z.object({
  id, type: z.literal(type), label: z.string().min(1).max(100),
  position: z.object({ x: z.number().min(0).max(10000), y: z.number().min(0).max(10000) }).strict(),
  config, inputMappings: z.array(mapping).max(100).optional(),
}).strict());
const proposalGraph = z.object({
  version: z.literal(1), id, name: z.string().min(1).max(120),
  nodes: z.array(z.union(nodeSchemas as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])).min(1).max(100),
  edges: z.array(z.object({ id, source: id, target: id, sourcePort: z.enum(['default', 'true', 'false']).optional() }).strict()).max(100),
  customBlocks: z.array(z.null()).max(0),
}).strict();
const types = Object.keys(configSchemas) as [keyof typeof configSchemas, ...(keyof typeof configSchemas)[]];
export const toolInputs = Object.freeze({
  read_block_catalog: z.object({}).strict(),
  read_block_schema: z.object({ type: z.enum(types) }).strict(),
  propose_workflow_draft: z.object({ graph: proposalGraph }).strict(),
});

/** Every object alternative has no additional properties and all of its own fields required. */
function native(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodDefault) return native(schema.removeDefault());
  if (schema instanceof z.ZodOptional) return native(schema.unwrap());
  if (schema instanceof z.ZodEffects) return native(schema.innerType());
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, z.ZodTypeAny> = schema.shape;
    let variants: Record<string, unknown>[] = [{}];
    for (const [key, child] of Object.entries(shape)) {
      const withKey = variants.map(properties => ({ ...properties, [key]: native(child) }));
      variants = child.isOptional() ? [...variants, ...withKey] : withKey;
    }
    const alternatives = variants.map(properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) }));
    return alternatives.length === 1 ? alternatives[0]! : { anyOf: alternatives };
  }
  if (schema instanceof z.ZodUnion) return { anyOf: schema.options.map((option: z.ZodTypeAny) => native(option)) };
  if (schema instanceof z.ZodArray) return { type: 'array', items: native(schema.element), minItems: schema._def.minLength?.value ?? 0, maxItems: schema._def.maxLength?.value ?? 100 };
  if (schema instanceof z.ZodString) {
    const result: Record<string, unknown> = { type: 'string', maxLength: 2000 };
    for (const check of schema._def.checks) {
      if (check.kind === 'max') result.maxLength = check.value;
      if (check.kind === 'min') result.minLength = check.value;
      if (check.kind === 'regex') result.pattern = check.regex.source;
      if (check.kind === 'uuid') result.format = 'uuid';
    }
    return result;
  }
  if (schema instanceof z.ZodNumber) return { type: schema.isInt ? 'integer' : 'number', minimum: schema.minValue ?? 0, maximum: schema.maxValue ?? Number.MAX_SAFE_INTEGER };
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  if (schema instanceof z.ZodNull) return { type: 'null' };
  if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema.options, maxLength: 2000 };
  if (schema instanceof z.ZodLiteral) return { type: typeof schema.value, enum: [schema.value], ...(typeof schema.value === 'string' ? { maxLength: 2000 } : {}) };
  throw new Error('authoring invalid');
}
export const nativeTools: Anthropic.Tool[] = freeze(Object.entries(toolInputs).map(([name, schema]) => ({
  name, description: name === 'propose_workflow_draft' ? 'Propose an inert workflow DAG using the bounded v1 builtin subset. No execution, approval or persistence.' : 'Read the real registered builtin catalog or structural configuration schema. No adapter probing or execution.',
  strict: true, input_schema: native(schema) as Anthropic.Tool.InputSchema,
})));
