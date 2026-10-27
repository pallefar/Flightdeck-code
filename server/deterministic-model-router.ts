import { isProxy } from 'node:util/types';
import type { ModelConnectionId } from './model-connections';

export type ModelRouteCapability = 'structured-json' | 'native-tools' | 'vision';
export type ModelRouteTask = 'classify' | 'prd' | 'workflow' | 'subapp' | 'widget' | 'report';
export type ModelRouteLocality = 'device' | 'private-host' | 'cloud';
export type ModelRouteQualityTier = 1 | 2 | 3;
export interface ModelRoutePricing {
  readonly inputMicrosPerMillion: number;
  readonly outputMicrosPerMillion: number;
}
export interface ModelRouteProfile {
  readonly id: string;
  readonly connectionId: ModelConnectionId;
  readonly model: string;
  readonly bindingId: string;
  readonly locality: ModelRouteLocality;
  readonly capabilities: readonly ModelRouteCapability[];
  readonly contextTokens: number;
  readonly qualityTier: ModelRouteQualityTier;
  readonly pricing: ModelRoutePricing | null;
  readonly configured: boolean;
  readonly evaluationPassed: boolean;
}
export interface ModelRouteRequest {
  readonly task: ModelRouteTask;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly localOnly: boolean;
  readonly requiredQualityTier: ModelRouteQualityTier;
  readonly requiredCapabilities: readonly ModelRouteCapability[];
  /** A request ceiling only: never establishes actor/project permission. */
  readonly approvedProfileIds: readonly string[];
  readonly maxCostMicros: number;
}
export interface ModelRoutePolicy {
  readonly version: string;
  /** Server-derived actor/project ceiling; this module does not authenticate. */
  readonly allowedProfileIds: readonly string[];
  readonly allowCloud: boolean;
}
export interface ModelRouteProposal {
  readonly status: 'proposed';
  readonly profileId: string;
  readonly connectionId: ModelConnectionId;
  readonly model: string;
  readonly bindingId: string;
  readonly estimatedCostMicros: number;
  readonly policyVersion: string;
  readonly reasonCodes: readonly string[];
}
export interface ModelRouteBlocked {
  readonly status: 'blocked';
  readonly reasonCodes: readonly string[];
}
export type ModelRouteDecision = ModelRouteProposal | ModelRouteBlocked;

export const MODEL_ROUTE_LIMITS = Object.freeze({
  maxProfiles: 64, maxIds: 64, maxCapabilities: 3,
  maxIdLength: 128, maxModelLength: 128, maxPolicyVersionLength: 128,
  maxTokens: 16_000_000,
});

function integer(value: unknown, max = Number.MAX_SAFE_INTEGER, min = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max && !Object.is(value, -0);
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MODEL_ROUTE_LIMITS.maxIdLength
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
    && !['__proto__', 'constructor', 'prototype'].includes(value);
}
function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}
function tier(value: unknown): value is ModelRouteQualityTier { return value === 1 || value === 2 || value === 3; }

// Read exact native data descriptors, not properties, then work only on copies.
// The existing boundedJson helper stringifies the original and only bounds bytes
// afterward; fixed-shape readers here bound strings/arrays before any traversal.
function record(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || isProxy(value) || Array.isArray(value)) return undefined;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return undefined;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) return undefined;
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return undefined;
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}
function array(value: unknown, max: number): unknown[] | undefined {
  if (isProxy(value) || !Array.isArray(value)) return undefined;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Array.prototype && proto !== null) return undefined;
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!integer(length, max) || Reflect.ownKeys(value).length !== length + 1) return undefined;
  const snapshot: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return undefined;
    snapshot.push(descriptor.value);
  }
  return snapshot;
}
function unique<T>(value: unknown, max: number, guard: (item: unknown) => item is T): T[] | undefined {
  const items = array(value, max);
  if (!items || !items.every(guard) || new Set(items).size !== items.length) return undefined;
  return items;
}
function capabilities(value: unknown): ModelRouteCapability[] | undefined {
  return unique(value, MODEL_ROUTE_LIMITS.maxCapabilities, (item): item is ModelRouteCapability => oneOf(item, ['structured-json', 'native-tools', 'vision']));
}
function parseRequest(value: unknown): ModelRouteRequest | undefined {
  const r = record(value, ['task', 'inputTokens', 'outputTokens', 'localOnly', 'requiredQualityTier', 'requiredCapabilities', 'approvedProfileIds', 'maxCostMicros']);
  if (!r || !oneOf(r.task, ['classify', 'prd', 'workflow', 'subapp', 'widget', 'report'])
    || !integer(r.inputTokens, MODEL_ROUTE_LIMITS.maxTokens) || !integer(r.outputTokens, MODEL_ROUTE_LIMITS.maxTokens)
    || r.inputTokens + r.outputTokens > MODEL_ROUTE_LIMITS.maxTokens
    || typeof r.localOnly !== 'boolean' || !tier(r.requiredQualityTier) || !integer(r.maxCostMicros)) return undefined;
  const requiredCapabilities = capabilities(r.requiredCapabilities);
  const approvedProfileIds = unique(r.approvedProfileIds, MODEL_ROUTE_LIMITS.maxIds, identifier);
  if (!requiredCapabilities || !approvedProfileIds) return undefined;
  return {
    task: r.task, inputTokens: r.inputTokens, outputTokens: r.outputTokens, localOnly: r.localOnly,
    requiredQualityTier: r.requiredQualityTier, requiredCapabilities, approvedProfileIds, maxCostMicros: r.maxCostMicros,
  };
}

function parseProfile(value: unknown): ModelRouteProfile | undefined {
  const p = record(value, ['id', 'connectionId', 'model', 'bindingId', 'locality', 'capabilities', 'contextTokens', 'qualityTier', 'pricing', 'configured', 'evaluationPassed']);
  if (!p || !identifier(p.id) || !oneOf(p.connectionId, ['codex-chatgpt', 'flightdeck', 'local', 'anthropic'])
    || typeof p.model !== 'string' || p.model.length > MODEL_ROUTE_LIMITS.maxModelLength
    || !/^[A-Za-z0-9][A-Za-z0-9._/@:+-]*$/.test(p.model) || p.model.includes('://')
    || !identifier(p.bindingId) || !oneOf(p.locality, ['device', 'private-host', 'cloud'])
    || !integer(p.contextTokens, MODEL_ROUTE_LIMITS.maxTokens, 1) || !tier(p.qualityTier)
    || typeof p.configured !== 'boolean' || typeof p.evaluationPassed !== 'boolean') return undefined;
  const admittedCapabilities = capabilities(p.capabilities);
  if (!admittedCapabilities) return undefined;
  let pricing: ModelRoutePricing | null = null;
  if (p.pricing !== null) {
    const prices = record(p.pricing, ['inputMicrosPerMillion', 'outputMicrosPerMillion']);
    if (!prices || !integer(prices.inputMicrosPerMillion) || !integer(prices.outputMicrosPerMillion)) return undefined;
    pricing = { inputMicrosPerMillion: prices.inputMicrosPerMillion, outputMicrosPerMillion: prices.outputMicrosPerMillion };
  }
  return {
    id: p.id, connectionId: p.connectionId, model: p.model, bindingId: p.bindingId, locality: p.locality,
    capabilities: admittedCapabilities, contextTokens: p.contextTokens, qualityTier: p.qualityTier,
    pricing, configured: p.configured, evaluationPassed: p.evaluationPassed,
  };
}
function parseCatalog(value: unknown): ModelRouteProfile[] | undefined {
  const entries = array(value, MODEL_ROUTE_LIMITS.maxProfiles);
  if (!entries) return undefined;
  const profiles: ModelRouteProfile[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    const profile = parseProfile(entry);
    if (!profile || ids.has(profile.id)) return undefined;
    ids.add(profile.id);
    profiles.push(profile);
  }
  return profiles;
}

function parsePolicy(value: unknown): ModelRoutePolicy | undefined {
  const p = record(value, ['version', 'allowedProfileIds', 'allowCloud']);
  if (!p || !identifier(p.version) || p.version.length > MODEL_ROUTE_LIMITS.maxPolicyVersionLength || typeof p.allowCloud !== 'boolean') return undefined;
  const allowedProfileIds = unique(p.allowedProfileIds, MODEL_ROUTE_LIMITS.maxIds, identifier);
  if (!allowedProfileIds) return undefined;
  return { version: p.version, allowedProfileIds, allowCloud: p.allowCloud };
}
function blocked(reason: 'invalid-request' | 'invalid-catalog' | 'invalid-policy' | 'no-eligible-profile'): ModelRouteBlocked {
  return Object.freeze({ status: 'blocked', reasonCodes: Object.freeze([reason]) });
}

/**
 * Server-only MODEL-ROUTE PROPOSAL. Catalog and policy must come from trusted
 * server configuration/current actor+project policy, never the request body.
 * Defensive validation is NOT provenance or authentication. approvedProfileIds
 * only narrows that ceiling. Task names imply no additional authority.
 *
 * No consent, authorization, financial cap, model resolution, automatic failover,
 * session mutation, model call or evaluation happens here. Costs are estimates;
 * real sends still need exact-context review and current policy/binding checks.
 * Identifiers/model/binding metadata must be nonsecret; destinations have no field.
 */
export function chooseModelRoute(requestValue: unknown, catalogValue: unknown, policyValue: unknown): ModelRouteDecision {
  const request = parseRequest(requestValue);
  if (!request) return blocked('invalid-request');
  const catalog = parseCatalog(catalogValue);
  if (!catalog) return blocked('invalid-catalog');
  const policy = parsePolicy(policyValue);
  if (!policy) return blocked('invalid-policy');
  const knownIds = new Set(catalog.map(profile => profile.id));
  if (policy.allowedProfileIds.some(id => !knownIds.has(id))) return blocked('invalid-policy');
  if (request.approvedProfileIds.some(id => !knownIds.has(id))) return blocked('invalid-request');
  let best: { profile: ModelRouteProfile; cost: bigint } | undefined;
  for (const selected of catalog) {
    if (!selected.configured || !selected.evaluationPassed
      || !policy.allowedProfileIds.includes(selected.id) || !request.approvedProfileIds.includes(selected.id)
      || (request.localOnly && selected.locality !== 'device') || (!policy.allowCloud && selected.locality === 'cloud')
      || selected.qualityTier < request.requiredQualityTier
      || !request.requiredCapabilities.every(capability => selected.capabilities.includes(capability))
      || selected.contextTokens < request.inputTokens + request.outputTokens || selected.pricing === null) continue;
    const cost = (BigInt(request.inputTokens) * BigInt(selected.pricing.inputMicrosPerMillion) + 999_999n) / 1_000_000n
      + (BigInt(request.outputTokens) * BigInt(selected.pricing.outputMicrosPerMillion) + 999_999n) / 1_000_000n;
    if (cost > BigInt(Number.MAX_SAFE_INTEGER) || cost > BigInt(request.maxCostMicros)) continue;
    if (!best || cost < best.cost || (cost === best.cost && (selected.qualityTier > best.profile.qualityTier
      || (selected.qualityTier === best.profile.qualityTier && selected.id < best.profile.id)))) best = { profile: selected, cost };
  }
  if (!best) return blocked('no-eligible-profile');
  return Object.freeze({
    status: 'proposed', profileId: best.profile.id, connectionId: best.profile.connectionId,
    model: best.profile.model, bindingId: best.profile.bindingId, estimatedCostMicros: Number(best.cost),
    policyVersion: policy.version, reasonCodes: Object.freeze(['eligible-lowest-cost']),
  });
}
