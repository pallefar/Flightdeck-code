import { expect, it, vi } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import ts from 'typescript';
import { chooseModelRoute as choose, MODEL_ROUTE_LIMITS } from '../deterministic-model-router';
import type {
  ModelRouteProfile, ModelRouteRequest, ModelRoutePolicy,
} from '../deterministic-model-router';

// Any accidental runtime provider import is a failure, not a working mock.
vi.mock('../model-connections', () => { throw new Error('model connections must remain a type-only import'); });

function profile(overrides: Partial<ModelRouteProfile> = {}): ModelRouteProfile {
  return {
    id: 'device-small', connectionId: 'local', model: 'fixture-small', bindingId: 'fixture-binding',
    locality: 'device', capabilities: ['structured-json'], contextTokens: 8192, qualityTier: 2,
    pricing: { inputMicrosPerMillion: 1_000_000, outputMicrosPerMillion: 2_000_000 },
    configured: true, evaluationPassed: true, ...overrides,
  };
}
function request(overrides: Partial<ModelRouteRequest> = {}): ModelRouteRequest {
  return {
    task: 'classify', inputTokens: 5, outputTokens: 2, localOnly: false,
    requiredQualityTier: 1, requiredCapabilities: ['structured-json'],
    approvedProfileIds: ['device-small'], maxCostMicros: 100, ...overrides,
  };
}
function policy(overrides: Partial<ModelRoutePolicy> = {}): ModelRoutePolicy {
  return { version: 'fixture-policy-v1', allowedProfileIds: ['device-small'], allowCloud: true, ...overrides };
}


it.each([
  [1, 1, 1, 1, 2],
  [999_999, 1, 1, 1, 2],
  [0, 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0],
  [1_000_001, 999_999, 1_234_567_890_123_456, 9_876_543_210, 1_234_579_001_224_681],
])('uses exact independently rounded directional cost (%i/%i tokens)', (inputTokens, outputTokens, inputMicrosPerMillion, outputMicrosPerMillion, estimatedCostMicros) => {
  const result = choose(request({ inputTokens, outputTokens, maxCostMicros: Number.MAX_SAFE_INTEGER }), [profile({ contextTokens: 16_000_000, pricing: { inputMicrosPerMillion, outputMicrosPerMillion } })], policy());
  expect(result).toMatchObject({ status: 'proposed', estimatedCostMicros });
});

const noEligible = { status: 'blocked', reasonCodes: ['no-eligible-profile'] };
it.each([
  ['unconfigured', profile({ configured: false }), request(), policy()],
  ['unevaluated', profile({ evaluationPassed: false }), request(), policy()],
  ['capability', profile(), request({ requiredCapabilities: ['native-tools'] }), policy()],
  ['quality', profile({ qualityTier: 1 }), request({ requiredQualityTier: 2 }), policy()],
  ['combined-context', profile({ contextTokens: 6 }), request(), policy()],
  ['request-ceiling', profile(), request({ approvedProfileIds: [] }), policy()],
  ['server-ceiling', profile(), request(), policy({ allowedProfileIds: [] })],
  ['cloud-policy', profile({ locality: 'cloud' }), request(), policy({ allowCloud: false })],
  ['cloud-locality', profile({ locality: 'cloud' }), request({ localOnly: true }), policy()],
  ['private-host-locality', profile({ locality: 'private-host' }), request({ localOnly: true }), policy()],
  ['unknown-price', profile({ pricing: null }), request({ inputTokens: 0, outputTokens: 0 }), policy()],
  ['cost-ceiling', profile(), request({ maxCostMicros: 8 }), policy()],
  ['unrepresentable-cost', profile({ contextTokens: 16_000_000, pricing: { inputMicrosPerMillion: Number.MAX_SAFE_INTEGER, outputMicrosPerMillion: 0 } }), request({ inputTokens: 16_000_000, outputTokens: 0, maxCostMicros: Number.MAX_SAFE_INTEGER }), policy()],
] as const)('refuses every ineligible profile: %s', (_name, p, r, s) => {
  expect(choose(r, [p], s)).toEqual(noEligible);
});

it('intersects trusted actor/project allowed IDs with the request ceiling, never granting from it', () => {
  const denied = profile({ id: 'request-cannot-grant', pricing: { inputMicrosPerMillion: 0, outputMicrosPerMillion: 0 } });
  expect(choose(request({ approvedProfileIds: [denied.id, 'device-small'] }), [denied, profile()], policy())).toMatchObject({ status: 'proposed', profileId: 'device-small' });
  expect(choose(request({ approvedProfileIds: [denied.id] }), [denied, profile()], policy())).toEqual(noEligible);
});

it('permits a private host only without localOnly, independent of the cloud connection label', () => {
  expect(choose(request(), [profile({ locality: 'private-host', connectionId: 'anthropic' })], policy({ allowCloud: false }))).toMatchObject({ status: 'proposed' });
});

it('accepts exact context and estimated-cost boundaries with known zero pricing', () => {
  expect(choose(request({ maxCostMicros: 9 }), [profile({ contextTokens: 7 })], policy())).toMatchObject({ status: 'proposed', estimatedCostMicros: 9 });
  expect(choose(request({ maxCostMicros: 0, localOnly: true }), [profile({ pricing: { inputMicrosPerMillion: 0, outputMicrosPerMillion: 0 } })], policy({ allowCloud: false }))).toMatchObject({ status: 'proposed', estimatedCostMicros: 0 });
});

it('blocks empty or entirely ineligible catalogs without implicit model/connection fallback', () => {
  expect(choose(request({ approvedProfileIds: [] }), [], policy({ allowedProfileIds: [] }))).toEqual(noEligible);
  expect(choose(request(), [profile({ configured: false })], policy())).toEqual(noEligible);
});

function permutations<T>(items: readonly T[]): T[][] {
  return items.length === 0 ? [[]] : items.flatMap((item, index) => permutations(items.filter((_, i) => i !== index)).map(rest => [item, ...rest]));
}

it('orders by exact cost, descending quality, then ASCII profile ID across all permutations', () => {
  const entries = [
    profile({ id: 'Z', qualityTier: 2 }),
    profile({ id: 'a', qualityTier: 3 }),
    profile({ id: 'A', qualityTier: 3 }),
    profile({ id: 'cheap', qualityTier: 1, pricing: { inputMicrosPerMillion: 1, outputMicrosPerMillion: 1 } }),
  ];
  for (const catalog of permutations(entries)) {
    const ids = catalog.map(p => p.id);
    const r = request({ approvedProfileIds: ids, requiredCapabilities: [] });
    const s = policy({ allowedProfileIds: [...ids].reverse() });
    expect(choose(r, catalog, s)).toMatchObject({ status: 'proposed', profileId: 'cheap', estimatedCostMicros: 2 });
    expect(choose({ ...r, requiredQualityTier: 2 }, catalog, s)).toMatchObject({ status: 'proposed', profileId: 'A', estimatedCostMicros: 9 });
  }
});

const invalidRequest = { status: 'blocked', reasonCodes: ['invalid-request'] };
it.each(Object.keys(request()))('rejects a request missing required field %s', key => {
  const r = { ...request() } as Record<string, unknown>;
  delete r[key];
  expect(choose(r, [profile()], policy())).toEqual(invalidRequest);
});

it.each(['actor', 'project', 'allowedProfileIds', 'allowCloud', 'authorization', 'model', 'connectionId', 'bindingId', 'policy', 'maxRetries'])('rejects request-created permission/destination field %s', key => {
  expect(choose({ ...request(), [key]: 'client-cannot-grant' }, [profile()], policy())).toEqual(invalidRequest);
});

it.each(['inputTokens', 'outputTokens', 'maxCostMicros'])('rejects invalid numeric request values for %s', key => {
  for (const bad of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, -1, 0.1, '5', null, undefined, 5n]) {
    expect(choose({ ...request(), [key]: bad }, [profile()], policy()), String(bad)).toEqual(invalidRequest);
  }
});

it.each([
  ['token-limit', { inputTokens: 16_000_001 }],
  ['combined-token-limit', { inputTokens: 16_000_000, outputTokens: 1 }],
  ['output-token-limit', { outputTokens: 16_000_001 }],
  ['task', { task: 'chat' }], ['case-sensitive-task', { task: 'PRD' }],
  ['localOnly', { localOnly: 'true' }], ['quality', { requiredQualityTier: 4 }],
  ['quality-string', { requiredQualityTier: '2' }],
  ['unknown-capability', { requiredCapabilities: ['execute-anything'] }],
  ['duplicate-capability', { requiredCapabilities: ['vision', 'vision'] }],
  ['oversize-capabilities', { requiredCapabilities: Array(4).fill('vision') }],
  ['capability-object', { requiredCapabilities: {} }],
  ['duplicate-id', { approvedProfileIds: ['device-small', 'device-small'] }],
  ['empty-id', { approvedProfileIds: [''] }], ['non-ASCII-id', { approvedProfileIds: ['dévice'] }],
  ['whitespace-id', { approvedProfileIds: [' device-small'] }],
  ['oversize-id', { approvedProfileIds: ['a'.repeat(129)] }],
  ['oversize-ids', { approvedProfileIds: Array.from({ length: 65 }, (_, i) => `p-${i}`) }],
] as const)('rejects malformed or oversized request %s', (_name, changes) => {
  expect(choose({ ...request(), ...changes }, [profile()], policy())).toEqual(invalidRequest);
});

it.each([null, undefined, [], new Date(0), 5, 'request', () => request()])('rejects non-record request %#', r => {
  expect(choose(r, [profile()], policy())).toEqual(invalidRequest);
});

const invalidCatalog = { status: 'blocked', reasonCodes: ['invalid-catalog'] };
it.each(Object.keys(profile()))('rejects a catalog profile missing required field %s', key => {
  const p = { ...profile() } as Record<string, unknown>;
  delete p[key];
  expect(choose(request(), [p], policy())).toEqual(invalidCatalog);
});

it.each([
  ['id', ''], ['id', 'x'.repeat(129)], ['id', 'café'], ['id', 'constructor'],
  ['connectionId', 'invented-provider'], ['connectionId', 'LOCAL'],
  ['model', ''], ['model', 'x'.repeat(129)], ['model', 'https://destination.example/model'],
  ['bindingId', ''], ['bindingId', 'x'.repeat(129)],
  ['locality', 'localhost'], ['capabilities', ['vision', 'vision']],
  ['capabilities', ['unknown-capability']], ['capabilities', Array(4).fill('vision')],
  ['qualityTier', 0], ['qualityTier', 4], ['qualityTier', '2'],
  ['configured', 'true'], ['evaluationPassed', 1], ['contextTokens', 0],
  ['contextTokens', 16_000_001], ['contextTokens', NaN], ['contextTokens', -1],
  ['contextTokens', Infinity], ['contextTokens', 0.5],
  ['pricing', {}], ['pricing', []], ['pricing', undefined], ['pricing', 'unknown'],
  ['pricing', { inputMicrosPerMillion: 1, outputMicrosPerMillion: 1, secret: 'not-allowed' }],
  ['destination', 'https://not-a-profile-field.example'],
] as const)('rejects malformed catalog field %s = %#', (key, value) => {
  expect(choose(request(), [{ ...profile(), [key]: value }], policy())).toEqual(invalidCatalog);
});

it.each(['inputMicrosPerMillion', 'outputMicrosPerMillion'])('rejects invalid exact pricing %s', key => {
  for (const bad of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, -1, -0, 0.1, '1', null, undefined, 1n]) {
    expect(choose(request(), [profile({ pricing: { inputMicrosPerMillion: 1, outputMicrosPerMillion: 1, [key]: bad } as unknown as ModelRouteProfile['pricing'] })], policy())).toEqual(invalidCatalog);
  }
});

it('rejects duplicate or oversized catalogs in their entirety, including malformed ineligible profiles', () => {
  expect(choose(request(), [profile(), profile()], policy())).toEqual(invalidCatalog);
  expect(choose(request(), Array.from({ length: 65 }, (_, i) => profile({ id: `p-${i}` })), policy())).toEqual(invalidCatalog);
  expect(choose(request(), [profile(), { ...profile({ id: 'unavailable', configured: false }), pricing: undefined }], policy())).toEqual(invalidCatalog);
});

it.each([null, undefined, {}, 'catalog', [null], [undefined], [new Date(0)]])('rejects non-catalog input %#', c => {
  expect(choose(request(), c, policy())).toEqual(invalidCatalog);
});

const invalidPolicy = { status: 'blocked', reasonCodes: ['invalid-policy'] };
it.each(Object.keys(policy()))('rejects trusted policy missing field %s', key => {
  const s = { ...policy() } as Record<string, unknown>;
  delete s[key];
  expect(choose(request(), [profile()], s)).toEqual(invalidPolicy);
});
it.each([
  ['empty-version', { version: '' }], ['oversize-version', { version: 'v'.repeat(129) }],
  ['version-object', { version: {} }], ['allowCloud', { allowCloud: 'true' }],
  ['unknown-allowed-id', { allowedProfileIds: ['missing'] }],
  ['duplicate-allowed-id', { allowedProfileIds: ['device-small', 'device-small'] }],
  ['bad-allowed-id', { allowedProfileIds: [' device-small'] }],
  ['oversize-allowed-ids', { allowedProfileIds: Array.from({ length: 65 }, (_, i) => `p-${i}`) }],
  ['extra-key', { authorize: true }],
] as const)('rejects malformed trusted policy %s', (_name, changes) => {
  expect(choose(request(), [profile()], { ...policy(), ...changes })).toEqual(invalidPolicy);
});
it.each([null, undefined, [], new Date(0), 1, 'policy'])('rejects non-policy value %#', s => {
  expect(choose(request(), [profile()], s)).toEqual(invalidPolicy);
});
it('refuses unknown request IDs rather than silently repairing or ignoring them', () => {
  expect(choose(request({ approvedProfileIds: ['device-small', 'missing'] }), [profile()], policy())).toEqual(invalidRequest);
  expect(choose(request(), [], policy({ allowedProfileIds: [] }))).toEqual(invalidRequest);
});

interface UnsafeSlot {
  name: string;
  sample(): object;
  args(value: unknown): [unknown, unknown, unknown];
  refusal: typeof invalidRequest;
}
const unsafeSlots: UnsafeSlot[] = [
  { name: 'request', sample: () => request(), args: value => [value, [profile()], policy()], refusal: invalidRequest },
  { name: 'request-capabilities', sample: () => ['structured-json'], args: value => [{ ...request(), requiredCapabilities: value }, [profile()], policy()], refusal: invalidRequest },
  { name: 'request-ids', sample: () => ['device-small'], args: value => [{ ...request(), approvedProfileIds: value }, [profile()], policy()], refusal: invalidRequest },
  { name: 'catalog', sample: () => [profile()], args: value => [request(), value, policy()], refusal: invalidCatalog },
  { name: 'profile', sample: () => profile(), args: value => [request(), [value], policy()], refusal: invalidCatalog },
  { name: 'profile-capabilities', sample: () => ['structured-json'], args: value => [request(), [{ ...profile(), capabilities: value }], policy()], refusal: invalidCatalog },
  { name: 'pricing', sample: () => ({ inputMicrosPerMillion: 1, outputMicrosPerMillion: 1 }), args: value => [request(), [{ ...profile(), pricing: value }], policy()], refusal: invalidCatalog },
  { name: 'policy', sample: () => policy(), args: value => [request(), [profile()], value], refusal: invalidPolicy },
  { name: 'policy-ids', sample: () => ['device-small'], args: value => [request(), [profile()], { ...policy(), allowedProfileIds: value }], refusal: invalidPolicy },
];

it.each(unsafeSlots)('rejects a proxy at $name without executing traps', slot => {
  let effects = 0;
  const trap = () => { effects++; throw new Error('private trap must not run'); };
  const value = new Proxy(slot.sample(), { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
  expect(choose(...slot.args(value))).toEqual(slot.refusal);
  expect(effects).toBe(0);
});
it.each(unsafeSlots)('rejects a revoked proxy at $name without throwing', slot => {
  const { proxy, revoke } = Proxy.revocable(slot.sample(), {});
  revoke();
  expect(choose(...slot.args(proxy))).toEqual(slot.refusal);
});
it.each(unsafeSlots)('refuses non-JSON descriptors/prototypes at $name without invoking accessors', slot => {
  for (const kind of ['custom-prototype', 'accessor', 'hidden', 'extra-hidden', 'symbol', '__proto__', 'constructor', 'prototype', 'toJSON']) {
    const value = slot.sample();
    let effects = 0;
    const key = Object.keys(value)[0]!;
    if (kind === 'custom-prototype') Object.setPrototypeOf(value, Object.create(Object.getPrototypeOf(value)));
    else if (kind === 'accessor') Object.defineProperty(value, key, { enumerable: true, get() { effects++; throw new Error('private accessor'); } });
    else if (kind === 'hidden') Object.defineProperty(value, key, { enumerable: false });
    else if (kind === 'symbol') Object.defineProperty(value, Symbol('private'), { value: 'private' });
    else Object.defineProperty(value, kind === 'extra-hidden' ? 'extra' : kind, { enumerable: false, get() { effects++; throw new Error('private extra'); } });
    expect(choose(...slot.args(value)), kind).toEqual(slot.refusal);
    expect(effects).toBe(0);
  }
});
it.each(unsafeSlots.filter(slot => Array.isArray(slot.sample())))('rejects sparse and oversized native arrays at $name without traversing them', slot => {
  const sparse = slot.sample() as unknown[];
  delete sparse[0];
  expect(choose(...slot.args(sparse))).toEqual(slot.refusal);
  const oversized = slot.sample() as unknown[];
  let effects = 0;
  oversized.length = 0xffff_ffff;
  Object.defineProperty(oversized, '0', { enumerable: true, get() { effects++; throw new Error('oversize accessor'); } });
  expect(choose(...slot.args(oversized))).toEqual(slot.refusal);
  expect(effects).toBe(0);
});
it('rejects cyclic and deeply nested values without recursive traversal or coercion', () => {
  const r = { ...request() } as Record<string, unknown>;
  r.approvedProfileIds = [r];
  expect(choose(r, [profile()], policy())).toEqual(invalidRequest);
  let deep: unknown = 'device-small';
  for (let i = 0; i < 10_000; i++) deep = [deep];
  expect(choose({ ...request(), approvedProfileIds: deep }, [profile()], policy())).toEqual(invalidRequest);
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
it('snapshots nonsecret proposal metadata and freezes every returned object/array', () => {
  const r = request(), c = [profile()], s = policy();
  const result = choose(r, c, s);
  const saved = structuredClone(result);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.reasonCodes)).toBe(true);
  expect(Reflect.set(result, 'status', 'authorized')).toBe(false);
  expect(Reflect.set(result.reasonCodes, '0', 'permission-granted')).toBe(false);
  Object.assign(c[0]!, { id: 'changed', connectionId: 'anthropic', model: 'changed', bindingId: 'changed', configured: false });
  Object.assign(s, { version: 'changed', allowedProfileIds: [] });
  Object.assign(r, { maxCostMicros: 0, approvedProfileIds: [] });
  expect(result).toEqual(saved);
  expect(Object.keys(result).sort()).toEqual(['status', 'profileId', 'connectionId', 'model', 'bindingId', 'estimatedCostMicros', 'policyVersion', 'reasonCodes'].sort());
  // Do not freeze caller-owned input as a side effect of taking the snapshot.
  expect(Object.isFrozen(r)).toBe(false);
  expect(Object.isFrozen(c[0])).toBe(false);
  expect(Object.isFrozen(s)).toBe(false);
});
it.each([
  [null, [profile()], policy()], [request(), null, policy()],
  [request(), [profile()], null], [request(), [profile({ configured: false })], policy()],
])('returns independent frozen fixed refusals %#', (r, c, s) => {
  const first = choose(r, c, s), second = choose(r, c, s);
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first.reasonCodes)).toBe(true);
  expect(Reflect.set(first.reasonCodes, '0', 'attacker-message')).toBe(false);
  expect(second).toEqual(first);
  expect(second).not.toBe(first);
  expect(second.reasonCodes).not.toBe(first.reasonCodes);
  expect(Object.keys(first).sort()).toEqual(['reasonCodes', 'status']);
});
it('accepts deeply frozen inputs without mutation or hidden session state', () => {
  const r = deepFreeze(request()), c = deepFreeze([profile()]), s = deepFreeze(policy());
  const before = JSON.stringify({ r, c, s });
  for (let i = 0; i < 20; i++) expect(choose(r, c, s)).toMatchObject({ status: 'proposed', estimatedCostMicros: 9 });
  expect(JSON.stringify({ r, c, s })).toBe(before);
});
it.each(unsafeSlots)('accepts native null-prototype data snapshots at $name', slot => {
  const value = slot.sample();
  Object.setPrototypeOf(value, null);
  expect(choose(...slot.args(value))).toMatchObject({ status: 'proposed' });
});
it.each(['classify', 'prd', 'workflow', 'subapp', 'widget', 'report'] as const)('uses explicit requirements for task %s without inventing task permissions', task => {
  expect(choose(request({ task }), [profile()], policy())).toMatchObject({ status: 'proposed' });
});
it.each(['codex-chatgpt', 'flightdeck', 'local', 'anthropic'] as const)('preserves exact configured connection %s without resolving it', connectionId => {
  expect(choose(request(), [profile({ connectionId })], policy())).toMatchObject({ status: 'proposed', connectionId });
});
it('accepts maximum bounded catalogs, IDs, strings, tokens and capability permutations', () => {
  expect(MODEL_ROUTE_LIMITS).toEqual({ maxProfiles: 64, maxIds: 64, maxCapabilities: 3, maxIdLength: 128, maxModelLength: 128, maxPolicyVersionLength: 128, maxTokens: 16_000_000 });
  expect(Object.isFrozen(MODEL_ROUTE_LIMITS)).toBe(true);
  const c = Array.from({ length: 64 }, (_, i) => profile({ id: `p-${String(i).padStart(3, '0')}` }));
  const ids = c.map(p => p.id);
  expect(choose(request({ approvedProfileIds: ids }), c, policy({ allowedProfileIds: [...ids].reverse() }))).toMatchObject({ status: 'proposed', profileId: 'p-000' });
  const id = 'a'.repeat(128), model = 'm'.repeat(128), bindingId = 'b'.repeat(128), version = 'v'.repeat(128);
  const caps = ['vision', 'native-tools', 'structured-json'] as const;
  for (const requiredCapabilities of permutations(caps)) {
    expect(choose(request({ inputTokens: 16_000_000, outputTokens: 0, maxCostMicros: 0, approvedProfileIds: [id], requiredCapabilities, requiredQualityTier: 3 }),
      [profile({ id, model, bindingId, capabilities: [...requiredCapabilities].reverse(), qualityTier: 3, contextTokens: 16_000_000, pricing: { inputMicrosPerMillion: 0, outputMicrosPerMillion: 0 } })],
      policy({ version, allowedProfileIds: [id] }))).toMatchObject({ status: 'proposed', model, bindingId, policyVersion: version });
  }
});
it('accepts the maximum exact safe cost but refuses summed directional overflow', () => {
  const c = [profile({ contextTokens: 16_000_000, pricing: { inputMicrosPerMillion: Number.MAX_SAFE_INTEGER, outputMicrosPerMillion: Number.MAX_SAFE_INTEGER } })];
  expect(choose(request({ inputTokens: 1_000_000, outputTokens: 0, maxCostMicros: Number.MAX_SAFE_INTEGER }), c, policy())).toMatchObject({ status: 'proposed', estimatedCostMicros: Number.MAX_SAFE_INTEGER });
  expect(choose(request({ inputTokens: 1_000_000, outputTokens: 0, maxCostMicros: Number.MAX_SAFE_INTEGER - 1 }), c, policy())).toEqual(noEligible);
  expect(choose(request({ inputTokens: 500_001, outputTokens: 500_001, maxCostMicros: Number.MAX_SAFE_INTEGER }), c, policy())).toEqual(noEligible);
});
it('uses rounded estimated cost ties rather than unrounded rate comparisons', () => {
  const c = [profile({ id: 'a', qualityTier: 1, pricing: { inputMicrosPerMillion: 1, outputMicrosPerMillion: 1 } }), profile({ id: 'z', qualityTier: 3, pricing: { inputMicrosPerMillion: 2, outputMicrosPerMillion: 2 } })];
  const ids = c.map(p => p.id);
  expect(choose(request({ approvedProfileIds: ids }), c, policy({ allowedProfileIds: ids }))).toMatchObject({ status: 'proposed', profileId: 'z', estimatedCostMicros: 2 });
});
it('refuses coercion hooks, negative zero, and huge strings without running caller code', () => {
  let effects = 0;
  const value = { get valueOf() { effects++; throw new Error('private coercion'); }, get toString() { effects++; throw new Error('private coercion'); } };
  expect(choose({ ...request(), inputTokens: value }, [profile()], policy())).toEqual(invalidRequest);
  expect(choose({ ...request(), approvedProfileIds: [value] }, [profile()], policy())).toEqual(invalidRequest);
  expect(choose({ ...request(), inputTokens: -0 }, [profile()], policy())).toEqual(invalidRequest);
  expect(choose({ ...request(), approvedProfileIds: ['x'.repeat(1_000_000)] }, [profile()], policy())).toEqual(invalidRequest);
  expect(effects).toBe(0);
});
it('has only the native proxy check at runtime and a type-only connection dependency', () => {
  const source = ts.createSourceFile('deterministic-model-router.ts', fs.readFileSync(new URL('../deterministic-model-router.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const imports = source.statements.filter(ts.isImportDeclaration);
  const pathOf = (node: ts.ImportDeclaration) => (node.moduleSpecifier as ts.StringLiteral).text;
  expect(imports.filter(node => !node.importClause?.isTypeOnly).map(pathOf)).toEqual(['node:util/types']);
  expect(imports.filter(node => pathOf(node) === './model-connections').map(node => node.importClause?.isTypeOnly)).toEqual([true]);
  const dynamicEffects: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && ['require', 'eval', 'Function'].includes(node.expression.text)))) dynamicEffects.push(node.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(dynamicEffects).toEqual([]);
});
it('makes zero network, file-write, clock, randomness, timer or logging calls on proposal/refusal paths', () => {
  let effects = 0, sensitivity = 0;
  const forbidden = () => { effects++; throw new Error('unexpected router effect'); };
  const spies = [
    vi.spyOn(globalThis, 'fetch').mockImplementation(forbidden),
    vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(forbidden),
    vi.spyOn(tls, 'connect').mockImplementation(forbidden),
    vi.spyOn(fs, 'writeFileSync').mockImplementation(forbidden),
    vi.spyOn(fs, 'appendFileSync').mockImplementation(forbidden),
    vi.spyOn(fs, 'openSync').mockImplementation(forbidden),
    vi.spyOn(Date, 'now').mockImplementation(forbidden),
    vi.spyOn(Math, 'random').mockImplementation(forbidden),
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(forbidden),
    vi.spyOn(console, 'log').mockImplementation(forbidden),
    vi.spyOn(console, 'error').mockImplementation(forbidden),
  ];
  let statuses: string[] = [];
  try {
    // Sensitivity control: the network sentinel really rejects before I/O.
    try { globalThis.fetch('http://127.0.0.1:1'); } catch { sensitivity = effects; }
    effects = 0;
    statuses = [
      choose(request(), [profile()], policy()),
      choose({ ...request(), privateSecret: 'PRIVATE_SENTINEL' }, [profile()], policy()),
      choose(request(), null, policy()),
      choose(request(), [profile()], null),
      choose(request(), [profile({ configured: false })], policy()),
    ].map(result => result.status);
  } finally { for (const spy of spies) spy.mockRestore(); }
  expect(sensitivity).toBe(1);
  expect(effects).toBe(0);
  expect(statuses).toEqual(['proposed', 'blocked', 'blocked', 'blocked', 'blocked']);
});

it('proposes the exact configured catalog binding without authorizing or resolving it', () => {
  expect(choose(request(), [profile()], policy())).toEqual({
    status: 'proposed', profileId: 'device-small', connectionId: 'local', model: 'fixture-small',
    bindingId: 'fixture-binding', estimatedCostMicros: 9, policyVersion: 'fixture-policy-v1',
    reasonCodes: ['eligible-lowest-cost'],
  });
});
