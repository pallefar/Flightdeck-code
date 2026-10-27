import { z } from 'zod';
import type { Schema } from './transport';
/** Browser-safe identity/proposal schemas; no destinations, headers, credentials or executable fields. */
export const key = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
export const definitionSchema = z.object({ name: z.string().trim().min(1).max(120), functions: z.array(key).min(1).max(32).refine(v => new Set(v).size === v.length) }).strict();
export type Definition = z.infer<typeof definitionSchema>;
export const resourceSummarySchema = z.object({
  id:z.string().uuid(),projectId:key,revision:z.number().int().positive(),sourceRevision:z.number().int().positive().nullable(),state:z.enum(['draft','active']),definition:definitionSchema,actor:z.string().min(1).max(200),
}).strict();
export type ResourceSummary=z.infer<typeof resourceSummarySchema>;
export interface FunctionSummary {id:string;kind:'rest'|'mcp';input:Schema;output:Schema;effect:'read-only';status:'configured-not-probed'}
export interface ResourceSelection {resourceId:string;revision:number;functionId:string;parameters:unknown}
export interface ResourceExecution {output:unknown;durationMs:number;resourceId:string;revision:number;functionId:string}
