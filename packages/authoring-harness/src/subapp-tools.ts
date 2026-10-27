import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { domainSpecSchema, fieldSpecSchema, miniAppSpecSchema, routeSpecSchema } from '../../codegen/src/spec-contract';
import { freeze } from './internal';
import { nativeRequiredSchema } from './native-schema';
import { safeMappingKey } from '../../workflow/data';

const fieldName = fieldSpecSchema.innerType().shape.name.max(64).refine(safeMappingKey);
const fieldCommon = { name: fieldName, optional: z.boolean() };
const field = z.union([
  z.object({ ...fieldCommon, type: z.enum(['string', 'integer', 'number', 'boolean']) }).strict(),
  z.object({ ...fieldCommon, type: z.literal('enum'), values: z.array(z.string().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/)).min(1).max(20) }).strict(),
]);
const readOperation = z.union([
  z.object({ kind: z.literal('list-contracts') }).strict(),
  z.object({ kind: z.literal('list-proposals') }).strict(),
]);
const proposeOperation = z.object({
  kind: z.literal('propose'), proposalKind: z.string().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
  ticketField: fieldName, fields: z.array(field).min(1).max(20),
  auditEvent: z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9.-]*$/),
}).strict();
const routeCommon = { path: routeSpecSchema.shape.path, summary: routeSpecSchema.shape.summary.unwrap() };
const route = z.union([
  z.object({ ...routeCommon, method: z.literal('GET'), operation: readOperation }).strict(),
  z.object({ ...routeCommon, method: z.literal('POST'), operation: proposeOperation }).strict(),
]);
const domain = z.object({ name: domainSpecSchema.shape.name.max(40), title: domainSpecSchema.shape.title.unwrap(), routes: z.array(route).min(1).max(12) }).strict();
/** Generator-native required-field subset. No table/source/file/settings/credential surface. */
export const subappSpecInputSchema = miniAppSpecSchema.pick({ id: true, label: true, icon: true, navSection: true }).extend({
  profile: z.literal('mini-app'), summary: miniAppSpecSchema.shape.summary.unwrap(),
  capabilities: miniAppSpecSchema.shape.capabilities.max(2), visibleToRoles: miniAppSpecSchema.shape.visibleToRoles.max(5),
  domains: z.array(domain).min(1).max(6),
}).strict();
export type SubappDraftSpec = z.infer<typeof subappSpecInputSchema>;
export const subappToolInputs = Object.freeze({
  read_subapp_contract: z.object({}).strict(),
  propose_subapp_spec: z.object({ spec: subappSpecInputSchema, understanding: z.string().min(1).max(4000) }).strict(),
});
export const subappNativeTools: Anthropic.Tool[] = freeze(Object.entries(subappToolInputs).map(([name, schema]) => ({
  name, strict: true, input_schema: nativeRequiredSchema(schema) as Anthropic.Tool.InputSchema,
  description: name === 'read_subapp_contract'
    ? 'Read the actual bounded mini-app proposal schema and static generator vocabulary. This is not host authority or a capability grant.'
    : 'Propose only an inert mini-app spec and understanding. No code generation, files, execution, independent approval, persistence or deployment. Audience/capability declarations require separate trusted evidence and consent validation.',
})));
