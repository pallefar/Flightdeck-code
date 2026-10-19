/**
 * Pure planning boundary, grounded in the read-only ROI source audit (2026-10-18).
 * References below pin inspected code bytes, NOT a deployment, grant or live fact.
 * No existing source GET is a Studio evidence export; some reads seed/recover state.
 */
function freeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Inert metadata only: no source client, URL, credentials or host authority. */
export const ROI_SOURCE_CONNECTORS = freeze([
  { id: 'maps', label: 'Flightdeck Maps', availability: 'unavailable', requires: 'host-owned-aggregate-export' },
  { id: 'teoa-advantage', label: 'TEOA / Advantage', availability: 'unavailable', requires: 'host-owned-aggregate-export' },
  { id: 'os', label: 'Flightdeck OS', availability: 'unavailable', requires: 'host-owned-aggregate-export' },
] as const);

export type RoiSourceId = typeof ROI_SOURCE_CONNECTORS[number]['id'];

/** Proposed wire contract only. This module neither mounts nor calls a host API. */
export const ROI_EVIDENCE_PROPOSAL = freeze({
  schema: 'studio-roi-aggregate-proposal/1', status: 'proposal-not-current-host-api',
  maxSerializedBytes: 32_768, maxObservations: 32, maxManualAssumptions: 16,
} as const);

/** Allowlisted aggregate semantics; callers cannot relabel elapsed as human labor. */
export const ROI_SOURCE_CONTRACTS = freeze({
  maps: {
    sourceSchemas: ['signavio-map/1'],
    metrics: {
      'maps-stopwatch-mean-ms': { basis: 'manual-stopwatch-elapsed-unspecified', unit: 'ms' },
      'maps-authored-estimate-min': { basis: 'authored-estimate', unit: 'min' },
      'maps-all-step-timing-sum-ms': { basis: 'mixed-map-model-total', unit: 'ms' },
    },
    gaps: ['sample-period-and-cohort-unknown', 'not-end-to-end-labor', 'ci-reads-can-seed-settings',
      'workspace-map-list-not-project-evidence', 'missing-gate-flags-are-unknown'],
    references: [
      { path: 'flightdeck/server/subapps/maps/lib/model.ts', lines: '29-78', sha256: '59805b5df0767fac68d6fb9feacd87edfafef7c094213a81199da44c8ac4fc04' },
      { path: 'flightdeck/web/src/subapps/maps/Editor.tsx', lines: '2562-2616', sha256: '3192dfa7992edbff3fede834616a49ae138611279bdb0b2ec90f571a17e6fe72' },
      { path: 'flightdeck/server/subapps/maps/lib/lint.ts', lines: '63-75,443-454', sha256: '3c74bb8c4a414101d5754f08f1bafeff06667c1aa0606712d4fd1b9b0a8f6c2f' },
      { path: 'flightdeck/server/subapps/maps/store.ts', lines: '1278-1307', sha256: '354a69be6614aa281a932c7002d50c6a384e4dc8c4d34ee45d822754b9833c49' },
    ],
  },
  'teoa-advantage': {
    sourceSchemas: ['teoa-process/1', 'advantage-process-kpis/1', 'advantage-opportunities/1'],
    metrics: {
      'advantage-ticket-lead-median-days': { basis: 'ticket-calendar-elapsed', unit: 'days' },
      'advantage-review-weekday-days': { basis: 'weekday-elapsed-not-workdays', unit: 'days' },
      'advantage-card-lead-ms': { basis: 'improvement-card-elapsed', unit: 'ms' },
      'advantage-completed-card-count': { basis: 'improvement-card-throughput', unit: 'count' },
      'advantage-recorded-value': { basis: 'manual-period-measurement', unit: 'framework-defined' },
    },
    gaps: ['process-kpis-currently-contracts-de', 'recorded-values-are-manual', 'card-flow-is-not-case-throughput',
      'priority-is-not-roi', 'history-and-read-failures-limit-coverage', 'statutory-gates-remain-human',
      'cross-app-source-policy-required', 'maps-lineage-may-overlap'],
    references: [
      { path: 'docs/SCHEMA-teoa-process.md', lines: '12-37', sha256: '48fd595fe9b405dfc74f712f05fd01ec34d6769fe5d15d376790c581bfe8fa5c' },
      { path: 'flightdeck/server/subapps/advantage/routes/process.ts', lines: '113-185', sha256: '46a67540e124866fb11e500ebfc499a52f4139092054e8f84d6a572b92f771b3' },
      { path: 'flightdeck/server/subapps/advantage/processKpis.ts', lines: '170-240,322-345,431-474', sha256: '718891e7541b18a6786ad237048f17b8c1456369fa0733f5cf7c9f4fc33041fb' },
      { path: 'flightdeck/server/subapps/advantage/benefitMeasurement.ts', lines: '13-69', sha256: '5fde371fdfdd4927d77268d8a0fd1e363ae41a43ad9910a37bfcadd21ea04dc5' },
      { path: 'flightdeck/server/subapps/advantage/flow.ts', lines: '43-125', sha256: 'b6753b7486f5d07cdb18d4741385d391fe543afe2919e17d6b2b10aa13e94dad' },
    ],
  },
  os: {
    sourceSchemas: [], // Sessions/Ops are not a versioned aggregate-only ROI contract.
    metrics: {
      'os-queue-count': { basis: 'queue-stock-not-annual-volume', unit: 'count' },
      'os-self-reported-saved-hours': { basis: 'human-authored-time-saved', unit: 'hours' },
      'os-machine-attempt-elapsed-ms': { basis: 'machine-wall-elapsed', unit: 'ms' },
      'os-seed-cost-usd': { basis: 'configured-seed-estimate-not-billing', unit: 'USD' },
    },
    gaps: ['session-savings-are-self-reported', 'ops-window-not-applied', 'runtime-timing-not-in-current-instance-dto',
      'sessions-not-project-scoped', 'seed-cost-not-metered', 'queue-stock-not-annual-volume'],
    references: [
      { path: 'flightdeck/server/services/activityParser.ts', lines: '94-138', sha256: 'f4c8122a6087084f75e3905b22280694c0fc17d38cee0ef5a985cd684799f338' },
      { path: 'flightdeck/server/services/ops/aggregate.ts', lines: '68-108,151-187', sha256: '45a9d201f655f1e6614b723ff7143b72e553eefdd5f879563f05884d4793e6a2' },
      { path: 'flightdeck/server/workflowRuntime/schema.ts', lines: '35-88', sha256: 'b81259b166e506f8773765ac3e718a51b176e39ac593e09f97b7ff6f7e0cc755' },
    ],
  },
} as const);

export type SourceMetricId = keyof typeof ROI_SOURCE_CONTRACTS.maps.metrics
  | keyof typeof ROI_SOURCE_CONTRACTS['teoa-advantage']['metrics']
  | keyof typeof ROI_SOURCE_CONTRACTS.os.metrics;
export interface EvidenceScope {
  readonly instanceKey: string; readonly workspaceKey: string; readonly projectKey: string;
  readonly processKey: string | null;
}
export type EvidenceState = 'recorded' | 'no-data' | 'awaiting-source' | 'suppressed' | 'exempt' | 'out-of-scope';
export interface AggregateObservation {
  readonly metric: SourceMetricId; readonly state: EvidenceState;
  readonly value: number | null; readonly sampleCount: number | null;
}
export type ManualAssumptionKey = 'annualVolume' | 'baselineSeconds' | 'targetSeconds' | 'adoptionBasisPoints'
  | 'loadedHourlyCostCents' | 'cashRealizationBasisPoints' | 'annualRecurringCostCents' | 'initialCostCents';
export interface ManualSourceAssumption { readonly key: ManualAssumptionKey; readonly value: number | null }
/** All provenance is DECLARED, never verified by this pure parser. */
export interface SourceEvidenceSnapshot {
  readonly schema: typeof ROI_EVIDENCE_PROPOSAL.schema;
  readonly source: RoiSourceId;
  /** Host-owned opaque SHA-256 namespace tokens; linkable, NOT anonymization. */
  readonly requestedScope: EvidenceScope; readonly resolvedScope: EvidenceScope;
  readonly provenance: {
    readonly sourceRevision: string | null; readonly configurationDigest: string | null;
    readonly eventSetDigest: string | null; readonly cohortDigest: string | null;
    readonly retrievedAt: string | null; readonly observedAt: string | null;
    readonly window: {
      readonly from: string; readonly to: string;
      readonly calendar: 'gregorian-utc' | 'fiscal-version-bound' | 'weekday-utc-no-holidays';
    } | null;
    readonly coverage: 'unknown' | 'complete' | 'partial' | 'suppressed' | 'stale' | 'changed';
    readonly cohortCount: number | null;
  };
  readonly gates: { readonly humanOnly: boolean | null; readonly statutory: boolean | null; readonly qcRequired: boolean | null };
  readonly observations: readonly AggregateObservation[];
  readonly manualAssumptions: readonly ManualSourceAssumption[];
}
export type SourceEvidenceAdmission = { readonly status: 'invalid'; readonly reason: 'invalid-evidence' }
  | { readonly status: 'admitted-unverified'; readonly snapshot: SourceEvidenceSnapshot };

function refuse(): never { throw new Error('invalid-evidence'); }

/**
 * Bound UTF-8 bytes BEFORE JSON.parse constructs objects or key arrays. Counting
 * uses constant auxiliary space, not an input-sized TextEncoder allocation. UTF-8
 * uses 4 bytes for surrogate pairs and 3 replacement bytes for lone surrogates.
 * The code-unit check bounds the scan itself; no slicing, coercion or reviver.
 * The caller already owns the input string: this does not bound its creation or
 * promise process/CPU isolation from hostile JavaScript or modified intrinsics.
 */
function decodeBoundedEvidence(input: unknown): unknown {
  const max = ROI_EVIDENCE_PROPOSAL.maxSerializedBytes;
  if (typeof input !== 'string' || input.length > max) return refuse();
  let bytes = 0;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code <= 0x7f) bytes++;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff
      && input.charCodeAt(i + 1) >= 0xdc00 && input.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4; i++;
    } else bytes += 3;
    if (bytes > max) return refuse();
  }
  return JSON.parse(input) as unknown;
}

/** Private, byte-bounded decoder output only; fixed-depth, no unknown subtrees. */
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return refuse();
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) return refuse();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== names.length || keys.some(k => typeof k !== 'string' || !names.includes(k))) return refuse();
  const out: Record<string, unknown> = Object.create(null);
  for (const name of names) {
    const d = Object.getOwnPropertyDescriptor(value, name);
    if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) return refuse();
    out[name] = d.value;
  }
  return out;
}
function list<T>(value: unknown, max: number, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return refuse();
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as unknown;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > max) return refuse();
  if (Reflect.ownKeys(value).length !== length + 1) return refuse();
  const out: T[] = [];
  for (let i = 0; i < length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) return refuse();
    out.push(parse(d.value));
  }
  return out;
}
function member<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) return refuse();
  return value;
}
function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null ? null : parse(value);
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return refuse();
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000) return refuse();
  return value;
}
function nonnegative(value: unknown): number {
  const n = number(value); if (n < 0) return refuse(); return n;
}
function count(value: unknown): number {
  const n = nonnegative(value); if (!Number.isSafeInteger(n) || n > 1_000_000_000) return refuse(); return n;
}
function instant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return refuse();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) return refuse();
  return value;
}
function readScope(input: unknown): EvidenceScope {
  const v = fields(input, ['instanceKey', 'workspaceKey', 'projectKey', 'processKey']);
  return { instanceKey: digest(v.instanceKey), workspaceKey: digest(v.workspaceKey),
    projectKey: digest(v.projectKey), processKey: nullable(v.processKey, digest) };
}
function readProvenance(input: unknown): SourceEvidenceSnapshot['provenance'] {
  const v = fields(input, ['sourceRevision', 'configurationDigest', 'eventSetDigest', 'cohortDigest',
    'retrievedAt', 'observedAt', 'window', 'coverage', 'cohortCount']);
  const window = nullable(v.window, input => {
    const w = fields(input, ['from', 'to', 'calendar']);
    return { from: instant(w.from), to: instant(w.to),
      calendar: member(w.calendar, ['gregorian-utc', 'fiscal-version-bound', 'weekday-utc-no-holidays']) };
  });
  return { sourceRevision: nullable(v.sourceRevision, digest), configurationDigest: nullable(v.configurationDigest, digest),
    eventSetDigest: nullable(v.eventSetDigest, digest), cohortDigest: nullable(v.cohortDigest, digest),
    retrievedAt: nullable(v.retrievedAt, instant), observedAt: nullable(v.observedAt, instant), window,
    coverage: member(v.coverage, ['unknown', 'complete', 'partial', 'suppressed', 'stale', 'changed']),
    cohortCount: nullable(v.cohortCount, count) };
}
function readGates(input: unknown): SourceEvidenceSnapshot['gates'] {
  const v = fields(input, ['humanOnly', 'statutory', 'qcRequired']);
  const flag = (v: unknown) => { if (typeof v !== 'boolean') return refuse(); return v; };
  return { humanOnly: nullable(v.humanOnly, flag), statutory: nullable(v.statutory, flag), qcRequired: nullable(v.qcRequired, flag) };
}
const manualKeys = ['annualVolume', 'baselineSeconds', 'targetSeconds', 'adoptionBasisPoints', 'loadedHourlyCostCents',
  'cashRealizationBasisPoints', 'annualRecurringCostCents', 'initialCostCents'] as const;

/**
 * Intentional API change: primitive serialized JSON only, not native DTOs.
 * Native objects (including boxed strings and proxies) are refused without reads,
 * enumeration, getters, coercion or JSON.stringify. No public native parser exists.
 * At most maxSerializedBytes UTF-8 bytes are decoded; only then may the private
 * schema parser enumerate keys. Schema/cardinality checks are not width bounds.
 * No raw source DTOs, personal labels or free text are accepted by the schema.
 * Opaque tokens/digests remain linkable: host privacy/suppression review is required.
 * This is not an arbitrary-object/Proxy sandbox and establishes no trust or grants.
 */
export function admitSourceEvidence(input: unknown): SourceEvidenceAdmission {
  try {
    const decoded = decodeBoundedEvidence(input);
    const v = fields(decoded, ['schema', 'source', 'requestedScope', 'resolvedScope', 'provenance', 'gates', 'observations', 'manualAssumptions']);
    const schema = member(v.schema, [ROI_EVIDENCE_PROPOSAL.schema]);
    const source = member(v.source, ['maps', 'teoa-advantage', 'os']);
    const observations = list(v.observations, ROI_EVIDENCE_PROPOSAL.maxObservations, input => {
      const o = fields(input, ['metric', 'state', 'value', 'sampleCount']);
      if (typeof o.metric !== 'string' || !Object.hasOwn(ROI_SOURCE_CONTRACTS[source].metrics, o.metric)) return refuse();
      const unit = (ROI_SOURCE_CONTRACTS[source].metrics as Readonly<Record<string, { readonly unit: string }>>)[o.metric]!.unit;
      const parseValue = o.metric === 'advantage-recorded-value' ? number : unit === 'count' ? count : nonnegative;
      return { metric: o.metric as SourceMetricId, state: member(o.state, ['recorded', 'no-data', 'awaiting-source', 'suppressed', 'exempt', 'out-of-scope']),
        value: nullable(o.value, parseValue), sampleCount: nullable(o.sampleCount, count) };
    });
    const manualAssumptions = list(v.manualAssumptions, ROI_EVIDENCE_PROPOSAL.maxManualAssumptions, input => {
      const a = fields(input, ['key', 'value']);
      const key = member(a.key, manualKeys);
      const value = nullable(a.value, nonnegative);
      const max = key === 'annualVolume' ? 1_000_000_000 : key === 'baselineSeconds' || key === 'targetSeconds' ? 31_536_000
        : key === 'adoptionBasisPoints' || key === 'cashRealizationBasisPoints' ? 10_000 : 1_000_000_000_000;
      if (value !== null && (!Number.isSafeInteger(value) || value > max)) return refuse();
      return { key, value };
    });
    const requestedScope = readScope(v.requestedScope), resolvedScope = readScope(v.resolvedScope);
    // Coherence only: two caller-declared matching scopes still establish no grant.
    for (const key of ['instanceKey', 'workspaceKey', 'projectKey', 'processKey'] as const) {
      if (requestedScope[key] !== resolvedScope[key]) return refuse();
    }
    const snapshot = freeze({ schema, source, requestedScope, resolvedScope,
      provenance: readProvenance(v.provenance), gates: readGates(v.gates), observations, manualAssumptions });
    if (new Set(observations.map(o => o.metric)).size !== observations.length
      || new Set(manualAssumptions.map(a => a.key)).size !== manualAssumptions.length) return refuse();
    const sampled = ['maps-stopwatch-mean-ms', 'advantage-ticket-lead-median-days', 'advantage-review-weekday-days',
      'advantage-card-lead-ms', 'os-machine-attempt-elapsed-ms'];
    for (const o of observations) {
      if ((o.state === 'recorded') !== (o.value !== null)) return refuse();
      if (o.state === 'recorded' && sampled.includes(o.metric) && o.sampleCount === 0) return refuse();
      if (o.state === 'suppressed' && o.sampleCount !== null) return refuse();
    }
    const p = snapshot.provenance;
    if (p.coverage === 'suppressed' && (p.cohortCount !== null || observations.some(o => o.state !== 'suppressed'))) return refuse();
    if (p.window && p.window.from >= p.window.to) return refuse();
    if (p.observedAt !== null && p.retrievedAt !== null && p.observedAt > p.retrievedAt) return refuse();
    return freeze({ status: 'admitted-unverified', snapshot });
  } catch { return freeze({ status: 'invalid', reason: 'invalid-evidence' }); }
}

export type SourceEvidenceAssessment = Extract<SourceEvidenceAdmission, { status: 'invalid' }> | {
  readonly status: 'unavailable'; readonly reason: 'requires-host-owned-aggregate-export';
  readonly connectors: typeof ROI_SOURCE_CONNECTORS;
} | {
  readonly status: 'assessment-only'; readonly source: RoiSourceId;
  readonly connectorAvailability: 'unavailable'; readonly authority: 'not-established';
  readonly valuation: 'unknown'; readonly automation: 'not-authorized';
  readonly control: 'unknown' | 'protected' | 'human-review-required';
  readonly declaredScope: EvidenceScope;
  readonly provenance: SourceEvidenceSnapshot['provenance']; readonly gates: SourceEvidenceSnapshot['gates'];
  readonly observations: readonly (AggregateObservation & { readonly basis: string; readonly unit: string; readonly trust: 'declared-unverified' })[];
  readonly manualAssumptions: readonly ManualSourceAssumption[];
  readonly gaps: readonly string[];
};

/** Serialized JSON only, as for admission; null/undefined still mean unavailable.
 * Local assessment only; absent host authority cannot be supplied by an input flag. */
export function assessSourceEvidence(input: unknown): SourceEvidenceAssessment {
  if (input === null || input === undefined) return freeze({
    status: 'unavailable', reason: 'requires-host-owned-aggregate-export', connectors: ROI_SOURCE_CONNECTORS,
  } as const);
  const admission = admitSourceEvidence(input);
  if (admission.status === 'invalid') return admission;
  const s = admission.snapshot, p = s.provenance;
  const gaps = ['host-owned-aggregate-export-required', 'host-authority-not-established', 'source-specific-current-policy-required',
    'minimum-cohort-policy-required', 'declared-provenance-not-verified', 'freshness-not-verified',
    'active-human-baseline-missing', 'applicable-volume-and-horizon-unverified', 'cost-currency-and-cash-realization-unverified',
    'causal-comparison-missing', 'cross-source-overlap-unresolved', 'algorithm-not-bound'];
  if (s.resolvedScope.processKey === null) gaps.push('missing-process-binding');
  if (p.sourceRevision === null) gaps.push('missing-source-revision');
  if (p.configurationDigest === null) gaps.push('missing-configuration-digest');
  if (p.eventSetDigest === null) gaps.push('missing-event-set-digest');
  if (p.observedAt === null) gaps.push('missing-observation-time');
  if (p.retrievedAt === null) gaps.push('missing-retrieval-time');
  if (p.window === null) gaps.push('missing-period-calendar');
  if (p.cohortCount === null || p.cohortDigest === null) gaps.push('missing-cohort');
  if (p.coverage === 'unknown') gaps.push('unknown-coverage');
  else if (p.coverage !== 'complete') gaps.push(`coverage-${p.coverage}`);
  if (s.observations.length === 0) gaps.push('no-observations');
  if (s.observations.some(o => o.state === 'recorded' && o.sampleCount === null)) gaps.push('missing-sample-count');
  for (const state of new Set(s.observations.map(o => o.state))) {
    if (state !== 'recorded') gaps.push(`observation-${state}`);
  }
  if (Object.values(s.gates).includes(null)) gaps.push('missing-gate-classification');
  const control = Object.values(s.gates).includes(true) ? 'protected'
    : Object.values(s.gates).includes(null) ? 'unknown' : 'human-review-required';
  if (s.gates.statutory === true && s.gates.humanOnly === false) gaps.push('statutory-human-flag-conflict');
  const metrics: Readonly<Record<string, { readonly basis: string; readonly unit: string }>> = ROI_SOURCE_CONTRACTS[s.source].metrics;
  return freeze({
    status: 'assessment-only', source: s.source, connectorAvailability: 'unavailable', authority: 'not-established',
    valuation: 'unknown', automation: 'not-authorized', control, declaredScope: s.resolvedScope,
    provenance: p, gates: s.gates,
    observations: s.observations.map(o => ({ ...o, ...metrics[o.metric]!, trust: 'declared-unverified' as const })),
    manualAssumptions: s.manualAssumptions, gaps,
  } as const);
}
