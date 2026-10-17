import { z } from 'zod';

/** Browser-safe data contract only. This module grants no filesystem or host authority. */
export const MAX_SUBAPP_DOCUMENTS = 64;
export const MAX_SUBAPP_FILES = 100;
export const MAX_SUBAPP_SOURCE_BYTES = 200_000;
export const MAX_SUBAPP_SNAPSHOT_BYTES = 2_000_000;
export const MAX_SUBAPP_STORE_BYTES = 32_000_000;
export const projectIdSchema = z.string().max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const draftIdSchema = z.string().uuid();
export const revisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const actorSchema = z.string().min(1).max(200).refine(v => v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v));
const encoder = new TextEncoder();
export function utf8Bytes(value: string): number { return encoder.encode(value).byteLength; }

/** Descriptor-first bounded native JSON admission. No getters or toJSON hooks are called.
 * All DTO fields are required: even own undefined is rejected (not silently omitted).
 * Proxies are outside the trusted native-object contract; reflective failures fail closed.
 */
export function safeSubappValue(value: unknown, maxBytes: number, maxDepth = 24): boolean {
  try {
    const ancestors = new Set<object>();
    const stack: { value: unknown; depth: number; exit?: boolean }[] = [{ value, depth: 0 }];
    let entries = 0; let bytes = 0;
    const addString = (v: string) => {
      if (v.length > maxBytes - bytes) return false;
      bytes += utf8Bytes(JSON.stringify(v)); return bytes <= maxBytes;
    };
    while (stack.length) {
      const item = stack.pop()!; const v = item.value;
      if (item.exit) { ancestors.delete(v as object); continue; }
      if (++entries > 500_000 || item.depth > maxDepth) return false;
      if (typeof v === 'string') { if (!addString(v)) return false; }
      else if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) bytes += JSON.stringify(v).length;
      else if (typeof v === 'object') {
        const array = Array.isArray(v); const prototype = Object.getPrototypeOf(v);
        if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) return false;
        if (ancestors.has(v) || Object.getOwnPropertySymbols(v).length) return false;
        const keys = Object.getOwnPropertyNames(v);
        if (keys.length > (array ? 10_001 : 10_000) || entries + stack.length + keys.length > 500_000) return false;
        const descriptors = Object.getOwnPropertyDescriptors(v);
        if (array) {
          const length: unknown = descriptors.length?.value;
          if (typeof length !== 'number' || length > 10_000 || keys.length !== length + 1) return false;
          for (let i = 0; i < length; i++) if (!Object.hasOwn(descriptors, String(i))) return false;
        }
        ancestors.add(v); stack.push({ value: v, depth: item.depth, exit: true });
        const count = keys.length - (array ? 1 : 0); bytes += 2 + Math.max(0, count - 1);
        for (const key of keys) {
          if (array && key === 'length') continue;
          const descriptor = descriptors[key]!;
          if (!('value' in descriptor) || !descriptor.enumerable || ['__proto__', 'prototype', 'constructor'].includes(key)) return false;
          if (array && !/^(0|[1-9][0-9]*)$/.test(key)) return false;
          if (!array) { if (!addString(key)) return false; bytes++; }
          stack.push({ value: descriptor.value, depth: item.depth + 1 });
        }
      } else return false;
      if (bytes > maxBytes) return false;
    }
    return true;
  } catch { return false; }
}

/** Collapse schema details so private caller-controlled keys/values never reach errors. */
export function boundedSubappSchema<T extends z.ZodTypeAny>(schema: T, maxBytes: number) {
  return z.unknown().transform((value, ctx): z.output<T> => {
    if (safeSubappValue(value, maxBytes)) {
      const parsed = schema.safeParse(value);
      if (parsed.success) return parsed.data as z.output<T>;
    }
    ctx.addIssue({ code: 'custom', message: 'Invalid sub-app data' }); return z.NEVER;
  });
}
const text = z.string().max(2_000);
/** Artifact labels only, never filesystem targets. No normalization is performed. */
export const artifactPathSchema = z.string().min(1).max(240).refine(path =>
  /^(server\/|web\/src\/|tests\/|standalone\/)/.test(path) &&
  path.split('/').every(segment => segment !== '.' && segment !== '..' && /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(segment))
);
export const generatedFileSchema = z.object({
  path: artifactPathSchema, contents: z.string().max(MAX_SUBAPP_SOURCE_BYTES).refine(v => utf8Bytes(v) <= MAX_SUBAPP_SOURCE_BYTES),
  kind: z.enum(['manifest', 'guard', 'routes-index', 'routes-domain', 'schema', 'web-module', 'host-test', 'patch', 'standalone', 'unknown']),
}).strict();
const manifestSchema = z.object({
  id: text, label: text, version: text, summary: text.nullable(), icon: text, navSection: text,
  routePrefix: text, webModuleId: text, capabilities: z.array(text).max(100), visibleToRoles: z.array(text).max(100), envVar: text, tablePrefix: text,
}).strict();
const findingSchema = z.object({
  rule: text, severity: z.enum(['error', 'warning']), file: z.union([z.literal('(candidate)'), artifactPathSchema]), line: z.number().int().min(0).max(10_000_000),
  column: z.number().int().min(0).max(10_000_000), message: text, evidence: text.nullable(),
}).strict();
const baselineSchema = z.object({
  manifest: manifestSchema, files: z.array(generatedFileSchema).min(1).max(MAX_SUBAPP_FILES),
  findings: z.array(findingSchema).max(1_000), rulesRun: z.array(text).max(1_000), notes: z.array(text).max(1_000),
}).strict();
const snapshotShape = z.object({ baseline: baselineSchema, files: z.array(generatedFileSchema).min(1).max(MAX_SUBAPP_FILES) }).strict().superRefine((snapshot, ctx) => {
  const originals = new Map(snapshot.baseline.files.map(file => [file.path, file.kind]));
  if (originals.size !== snapshot.baseline.files.length || new Set(snapshot.files.map(f => f.path)).size !== snapshot.files.length ||
      snapshot.files.length !== originals.size || snapshot.files.some(f => originals.get(f.path) !== f.kind)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid artifact inventory' });
  }
});
export const snapshotSchema = boundedSubappSchema(snapshotShape, MAX_SUBAPP_SNAPSHOT_BYTES);
export type SubappSnapshot = z.infer<typeof snapshotSchema>;
const metadata = {
  id: draftIdSchema, projectId: projectIdSchema, revision: revisionSchema, status: z.literal('draft'),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), createdBy: actorSchema, updatedBy: actorSchema,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
};
export const documentSchema = boundedSubappSchema(z.object({ ...metadata, snapshot: snapshotSchema }).strict().refine(d => d.updatedAt >= d.createdAt), MAX_SUBAPP_SNAPSHOT_BYTES + 8_000);
export type SubappDocument = z.infer<typeof documentSchema>;
export const summarySchema = boundedSubappSchema(z.object({ ...metadata, label: text, subappId: text, fileCount: z.number().int().min(1).max(MAX_SUBAPP_FILES) }).strict().refine(d => d.updatedAt >= d.createdAt), 32_000);
export type SubappSummary = z.infer<typeof summarySchema>;
