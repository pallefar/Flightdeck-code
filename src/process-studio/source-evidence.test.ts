import { describe, expect, it, vi } from 'vitest';
import * as evidence from './source-evidence';

// Synthetic aggregates only: opaque namespace tokens are not real identities or grants.
const token = 'a'.repeat(64);
const scope = () => ({ instanceKey: token, workspaceKey: 'b'.repeat(64), projectKey: 'c'.repeat(64), processKey: null });
const fixture = () => ({
  schema: 'studio-roi-aggregate-proposal/1', source: 'maps', requestedScope: scope(), resolvedScope: scope(),
  provenance: {
    sourceRevision: null, configurationDigest: null, eventSetDigest: null, cohortDigest: null,
    retrievedAt: null, observedAt: null, window: null, coverage: 'unknown', cohortCount: null,
  },
  gates: { humanOnly: null, statutory: null, qcRequired: null },
  observations: [{ metric: 'maps-stopwatch-mean-ms', state: 'recorded', value: 1200, sampleCount: 5 }],
  manualAssumptions: [{ key: 'annualVolume', value: 120 }],
});

/**
 * TEST-ONLY encoding seam for our small, trusted fixtures, never application input.
 * Unlike JSON.stringify(object), this refuses unrepresentable native semantics:
 * no getters/toJSON, omission of undefined/symbols/extras, nonfinite-to-null, holes,
 * custom prototypes or cycles. JSON.stringify is used ONLY on primitive strings.
 * Native-only cases below still reach the public boundary unchanged and must fail.
 */
function encodeTrustedFixture(input: unknown, ancestors = new Set<object>()): string {
  if (input === null) return 'null';
  if (typeof input === 'string') return JSON.stringify(input);
  if (typeof input === 'boolean') return input ? 'true' : 'false';
  if (typeof input === 'number' && Number.isFinite(input)) return Object.is(input, -0) ? '-0' : String(input);
  if (typeof input !== 'object' || ancestors.has(input)) throw new TypeError('native-only test fixture');
  const array = Array.isArray(input), proto = Object.getPrototypeOf(input);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw new TypeError('native-only test fixture');
  const keys = Reflect.ownKeys(input);
  const data = (key: string) => {
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) throw new TypeError('native-only test fixture');
    return encodeTrustedFixture(d.value, ancestors);
  };
  ancestors.add(input);
  try {
    if (array) {
      const length = Object.getOwnPropertyDescriptor(input, 'length')!.value as number;
      if (keys.length !== length + 1) throw new TypeError('native-only test fixture');
      return '[' + Array.from({ length }, (_, i) => data(String(i))).join(',') + ']';
    }
    return '{' + keys.map(key => {
      if (typeof key !== 'string') throw new TypeError('native-only test fixture');
      return JSON.stringify(key) + ':' + data(key);
    }).join(',') + '}';
  } finally { ancestors.delete(input); }
}
const admitFixture = (input: unknown) => evidence.admitSourceEvidence(encodeTrustedFixture(input));
const assessFixture = (input: unknown) => evidence.assessSourceEvidence(encodeTrustedFixture(input));

it('refuses over-wide native roots and short-array extras before any input enumeration at both entrypoints', () => {
  const root = fixture(), shortArray = fixture();
  for (let i = 0; i < 50_000; i++) {
    Object.defineProperty(root, `extra${i}`, { value: null, enumerable: true });
    Object.defineProperty(shortArray.observations, `extra${i}`, { value: null, enumerable: true });
  }
  let traps = 0;
  const trapped = new Proxy(fixture(), {
    ownKeys() { traps++; throw new Error('native input enumeration'); },
    getPrototypeOf() { traps++; throw new Error('native input prototype'); },
    get() { traps++; throw new Error('native input read'); },
    getOwnPropertyDescriptor() { traps++; throw new Error('native input descriptor'); },
  });
  for (const entry of [evidence.admitSourceEvidence, evidence.assessSourceEvidence]) {
    for (const input of [root, shortArray, trapped, fixture()]) {
      const enumeration = vi.spyOn(Reflect, 'ownKeys');
      let result: ReturnType<typeof entry>, calls: number;
      try { result = entry(input); calls = enumeration.mock.calls.length; }
      finally { enumeration.mockRestore(); }
      expect.soft(result).toEqual({ status: 'invalid', reason: 'invalid-evidence' });
      expect.soft(calls).toBe(0);
    }
  }
  expect.soft(traps).toBe(0);
});

it('enforces the exact 32768 UTF-8 byte ceiling before JSON.parse at both entrypoints', () => {
  const ceiling = 32_768, serialized = encodeTrustedFixture(fixture());
  const inputs: { input: string; bytes: number; valid: boolean }[] = [];
  for (const bytes of [ceiling - 1, ceiling, ceiling + 1]) {
    inputs.push({ input: serialized + ' '.repeat(bytes - serialized.length), bytes, valid: true });
    for (const character of ['a', 'é', '€', '😀', '\ud800', '\udc00', '\ud800😀\udc00', 'aé€😀']) {
      const width = new TextEncoder().encode(character).length;
      const count = Math.floor((bytes - 2) / width);
      const input = '"' + character.repeat(count) + '"' + ' '.repeat(bytes - 2 - count * width);
      expect(new TextEncoder().encode(input).byteLength).toBe(bytes);
      inputs.push({ input, bytes, valid: false });
    }
  }
  const wide = serialized.slice(0, -1) + Array.from({ length: 50_000 }, (_, i) => `,"extra${i}":0`).join('') + '}';
  inputs.push({ input: wide, bytes: new TextEncoder().encode(wide).length, valid: false });
  for (const entry of [evidence.admitSourceEvidence, evidence.assessSourceEvidence]) {
    for (const { input, bytes, valid } of inputs) {
      const parsing = vi.spyOn(JSON, 'parse');
      let result: ReturnType<typeof entry>, calls: number;
      try { result = entry(input); calls = parsing.mock.calls.length; }
      finally { parsing.mockRestore(); }
      expect.soft(calls, `UTF-8 bytes=${bytes}, code units=${input.length}`).toBe(bytes <= ceiling ? 1 : 0);
      expect.soft(result.status).toBe(bytes > ceiling || !valid ? 'invalid'
        : entry === evidence.admitSourceEvidence ? 'admitted-unverified' : 'assessment-only');
    }
  }
  expect(evidence.ROI_EVIDENCE_PROPOSAL).toMatchObject({ maxSerializedBytes: ceiling });
});

it('admits serialized aggregates for every source without establishing authority or valuation', () => {
  for (const source of ['maps', 'teoa-advantage', 'os'] as const) {
    const observations = Object.keys(evidence.ROI_SOURCE_CONTRACTS[source].metrics).map(metric =>
      ({ metric, state: 'recorded', value: 1, sampleCount: 5 }));
    const input = { ...fixture(), source, observations };
    const serialized = encodeTrustedFixture(input);
    for (const wire of [serialized, serialized + ' '.repeat(32_768 - serialized.length)]) {
      const admitted = evidence.admitSourceEvidence(wire);
      expect(admitted).toEqual({ status: 'admitted-unverified', snapshot: input });
      expect(Object.isFrozen(admitted)).toBe(true);
      const assessed = evidence.assessSourceEvidence(wire);
      expect(assessed).toMatchObject({ status: 'assessment-only', source, authority: 'not-established',
        connectorAvailability: 'unavailable', valuation: 'unknown', automation: 'not-authorized' });
      if (assessed.status !== 'assessment-only') throw new Error('expected assessment');
      expect(assessed.observations).toEqual(observations.map(o => ({ ...o,
        ...(evidence.ROI_SOURCE_CONTRACTS[source].metrics as Readonly<Record<string, object>>)[o.metric],
        trust: 'declared-unverified' })));
      for (const value of [assessed, assessed.observations, ...assessed.observations]) expect(Object.isFrozen(value)).toBe(true);
    }
  }
});

it('refuses malformed, deep and oversized serialized inputs with fixed errors at both entrypoints', () => {
  const deep = '['.repeat(12_000) + 'null' + ']'.repeat(12_000);
  const serialized = encodeTrustedFixture(fixture());
  const deepUnknown = serialized.slice(0, -1) + ',"unknown":' + deep + '}';
  expect(new TextEncoder().encode(deepUnknown).length).toBeLessThan(32_768);
  for (const entry of [evidence.admitSourceEvidence, evidence.assessSourceEvidence]) {
    for (const input of ['', '{', '"unterminated', '{}\u0000', 'null', '[]', 'true', '42', 'NaN', 'Infinity',
      deep, deepUnknown, '['.repeat(32_769), ' '.repeat(32_769),
      '{"__proto__":{"polluted":true}}',
      serialized.replace('"value":1200', '"value":1e309'),
      serialized.replace('"value":1200', '"value":NaN')]) {
      const result = entry(input);
      expect(result).toEqual({ status: 'invalid', reason: 'invalid-evidence' });
      expect(Object.isFrozen(result)).toBe(true);
    }
    // The schema rejects unknown keys without recursively walking their decoded
    // values, even when the byte-bounded JSON contains a very deep subtree.
    const enumeration = vi.spyOn(Reflect, 'ownKeys');
    try {
      expect(entry(deepUnknown)).toEqual({ status: 'invalid', reason: 'invalid-evidence' });
      expect(enumeration.mock.calls.length).toBe(1);
      expect(enumeration.mock.results[0]!.value).toHaveLength(9);
    } finally { enumeration.mockRestore(); }
  }
});

it('retains serialized schema refusals independently of the blanket native-object refusal', () => {
  const cases = [null, true, 'raw source text', [], {}, { ...fixture(), schema: 'signavio-map/1' },
    { ...fixture(), source: 'toString' },
    ...['grant', 'verified', 'credentials', 'rawRecords', 'note', 'url'].map(k => ({ ...fixture(), [k]: 'private' })),
    { ...fixture(), gates: { ...fixture().gates, approved: true } },
    { ...fixture(), observations: [{ ...fixture().observations[0], basis: 'human-active-labor' }] },
    { ...fixture(), requestedScope: { ...scope(), workspaceKey: 'person@example.com' } }];
  for (const input of cases) {
    const serialized = encodeTrustedFixture(input);
    for (const entry of [evidence.admitSourceEvidence, evidence.assessSourceEvidence]) {
      expect(entry(serialized)).toEqual({ status: 'invalid', reason: 'invalid-evidence' });
    }
  }
});

it('admits only a proposal copy, with manual assumptions separate from unverified aggregates', () => {
  const input = fixture();
  const result = admitFixture(input);
  expect(result).toEqual({ status: 'admitted-unverified', snapshot: input });
  if (result.status !== 'admitted-unverified') throw new Error('expected admitted proposal');
  expect(result.snapshot).not.toBe(input);
  expect(Object.isFrozen(result.snapshot.observations[0])).toBe(true);
  expect(Object.isFrozen(result.snapshot.provenance)).toBe(true);
  expect(Object.isFrozen(result.snapshot.manualAssumptions[0])).toBe(true);
  input.observations[0]!.value = 999;
  input.manualAssumptions[0]!.value = 999;
  expect(result.snapshot.observations[0]!.value).toBe(1200);
  expect(result.snapshot.manualAssumptions[0]!.value).toBe(120);
  expect(evidence.ROI_SOURCE_CONNECTORS.every(c => c.availability === 'unavailable')).toBe(true);
});

describe('source evidence gap assessment', () => {
  it('assesses missing measurement context as gaps, not annual labor or cash', () => {
    const input = fixture();
    const result = assessFixture(input);
    expect(result).toMatchObject({
      status: 'assessment-only', source: 'maps', connectorAvailability: 'unavailable', authority: 'not-established',
      valuation: 'unknown', automation: 'not-authorized', control: 'unknown',
      observations: [{ ...input.observations[0], basis: 'manual-stopwatch-elapsed-unspecified', unit: 'ms', trust: 'declared-unverified' }],
      manualAssumptions: input.manualAssumptions, provenance: input.provenance, gates: input.gates,
      gaps: expect.arrayContaining([
        'host-owned-aggregate-export-required', 'host-authority-not-established', 'source-specific-current-policy-required',
        'minimum-cohort-policy-required', 'declared-provenance-not-verified', 'freshness-not-verified',
        'active-human-baseline-missing', 'applicable-volume-and-horizon-unverified', 'cost-currency-and-cash-realization-unverified',
        'causal-comparison-missing', 'cross-source-overlap-unresolved', 'missing-process-binding',
        'missing-source-revision', 'missing-configuration-digest', 'missing-event-set-digest',
        'missing-observation-time', 'missing-retrieval-time', 'missing-period-calendar', 'missing-cohort',
        'unknown-coverage', 'missing-gate-classification',
      ]),
    });
    if (result.status !== 'assessment-only') throw new Error('expected gap assessment');
    for (const value of [result, result.observations, result.observations[0], result.manualAssumptions,
      result.provenance, result.gaps, result.gates, result.declaredScope]) expect(Object.isFrozen(value)).toBe(true);
    expect(result.gaps.length).toBe(new Set(result.gaps).size);
    expect(Object.keys(result).sort()).toEqual(['status', 'source', 'connectorAvailability', 'authority', 'valuation',
      'automation', 'control', 'declaredScope', 'provenance', 'gates', 'observations', 'manualAssumptions', 'gaps'].sort());
  });

  it('preserves statutory and human gates even when all provenance is declared complete', () => {
    const complete = {
      ...fixture(), requestedScope: { ...scope(), processKey: token }, resolvedScope: { ...scope(), processKey: token },
      provenance: { sourceRevision: token, configurationDigest: token, eventSetDigest: token, cohortDigest: token,
        retrievedAt: '2026-10-01T00:00:00.000Z', observedAt: '2026-09-30T00:00:00.000Z',
        window: { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z', calendar: 'gregorian-utc' },
        coverage: 'complete', cohortCount: 100 },
    };
    for (const [gates, control] of [
      [{ statutory: true, humanOnly: false, qcRequired: false }, 'protected'],
      [{ statutory: false, humanOnly: true, qcRequired: false }, 'protected'],
      [{ statutory: false, humanOnly: false, qcRequired: true }, 'protected'],
      [{ statutory: false, humanOnly: false, qcRequired: false }, 'human-review-required'],
      [{ statutory: false, humanOnly: null, qcRequired: false }, 'unknown'],
    ] as const) {
      const result = assessFixture({ ...complete, gates });
      expect(result).toMatchObject({ status: 'assessment-only', control, gates, valuation: 'unknown', authority: 'not-established',
        connectorAvailability: 'unavailable', automation: 'not-authorized' });
      if (result.status !== 'assessment-only') throw new Error('expected gap assessment');
      expect(result.gaps).toContain('declared-provenance-not-verified');
      expect(result.gaps).toContain('minimum-cohort-policy-required');
      expect(result.gaps).toContain('source-specific-current-policy-required');
      expect(result.gaps).not.toContain('missing-source-revision');
      expect(result.gaps).not.toContain('missing-cohort');
      expect(result.gaps).not.toContain('missing-process-binding');
      if (gates.statutory && gates.humanOnly === false) expect(result.gaps).toContain('statutory-human-flag-conflict');
    }
  });

  it('reports partial, changed, stale, suppressed and missing-source states without substituting zeros', () => {
    for (const coverage of ['partial', 'stale', 'changed', 'suppressed']) {
      const observations = [{ ...fixture().observations[0], state: coverage === 'suppressed' ? 'suppressed' : 'recorded',
        value: coverage === 'suppressed' ? null : 1200, sampleCount: null }];
      const result = assessFixture({ ...fixture(), provenance: { ...fixture().provenance, coverage }, observations });
      expect(result).toMatchObject({ status: 'assessment-only', valuation: 'unknown', observations,
        provenance: { coverage }, gaps: expect.arrayContaining([`coverage-${coverage}`]) });
    }
    for (const state of ['no-data', 'awaiting-source', 'suppressed', 'exempt', 'out-of-scope']) {
      const observations = [{ ...fixture().observations[0], state, value: null, sampleCount: state === 'suppressed' ? null : 0 }];
      const result = assessFixture({ ...fixture(), observations });
      expect(result).toMatchObject({ status: 'assessment-only', observations,
        gaps: expect.arrayContaining([`observation-${state}`]) });
    }
    expect(assessFixture({ ...fixture(), observations: [], manualAssumptions: [] })).toMatchObject({
      status: 'assessment-only', observations: [], manualAssumptions: [], gaps: expect.arrayContaining(['no-observations']),
    });
    expect(assessFixture({ ...fixture(), observations: [{ ...fixture().observations[0], sampleCount: null }] })).toMatchObject({
      status: 'assessment-only', gaps: expect.arrayContaining(['missing-sample-count', 'algorithm-not-bound']),
    });
  });

  it('leaves absent evidence unavailable without inventing a bridge, metric, permission or valuation', () => {
    for (const input of [undefined, null]) {
      const result = evidence.assessSourceEvidence(input);
      expect(result).toEqual({
        status: 'unavailable', reason: 'requires-host-owned-aggregate-export',
        connectors: evidence.ROI_SOURCE_CONNECTORS,
      });
      expect(Object.isFrozen(result)).toBe(true);
    }
    expect(assessFixture({ verified: true })).toEqual({ status: 'invalid', reason: 'invalid-evidence' });
  });
});

describe('source evidence connector contract', () => {
  it('refuses unsafe or non-aggregate native input with fixed errors and zero accessor calls', () => {
    let reads = 0;
    const accessor = fixture();
    Object.defineProperty(accessor.provenance, 'coverage', { enumerable: true, get() { reads++; return 'complete'; } });
    const hidden = fixture(); Object.defineProperty(hidden, 'hidden', { value: 'private' });
    const cycle = fixture(); Object.assign(cycle.provenance, { window: cycle });
    const toJSON = { ...fixture(), toJSON() { reads++; return fixture(); } };
    const sparse = { ...fixture(), observations: new Array(1) };
    const nestedSymbol = fixture(); Object.assign(nestedSymbol.gates, { [Symbol('authority')]: true });
    const arrayExtra = fixture(); Object.assign(arrayExtra.observations, { private: 'private' });
    const coercion = { ...fixture(), [Symbol.toPrimitive]() { reads++; return encodeTrustedFixture(fixture()); },
      valueOf() { reads++; return 1; }, toString() { reads++; return encodeTrustedFixture(fixture()); } };
    const subtree = new Proxy({}, { ownKeys() { reads++; throw new Error('unknown subtree'); },
      get() { reads++; throw new Error('unknown subtree'); } });
    const denied = [null, undefined, true, 'raw source text', [], {}, accessor, hidden, cycle, toJSON, sparse,
      nestedSymbol, arrayExtra, Object.create(fixture()), new Date(), coercion,
      { ...fixture(), unknown: subtree }, Object(encodeTrustedFixture(fixture())),
      new Proxy({}, { getPrototypeOf() { throw new Error('private host details'); } }),
      { ...fixture(), schema: 'signavio-map/1' }, { ...fixture(), source: 'toString' },
      ...['grant', 'verified', 'credentials', 'rawRecords', 'note', 'url'].map(k => ({ ...fixture(), [k]: 'private' })),
      { ...fixture(), gates: { ...fixture().gates, approved: true } },
      { ...fixture(), observations: [{ ...fixture().observations[0], basis: 'human-active-labor' }] },
      { ...fixture(), requestedScope: { ...scope(), workspaceKey: 'person@example.com' } },
    ];
    for (const input of denied) {
      expect(evidence.admitSourceEvidence(input)).toEqual({ status: 'invalid', reason: 'invalid-evidence' });
      if (input !== null && input !== undefined) {
        expect(evidence.assessSourceEvidence(input)).toEqual({ status: 'invalid', reason: 'invalid-evidence' });
      }
    }
    // Explicitly prove the test seam refuses rather than sanitizes native-only
    // descriptor/prototype cases. These original cases never become innocuous JSON.
    for (const input of [accessor, hidden, cycle, toJSON, sparse, nestedSymbol, arrayExtra,
      Object.create(fixture()), new Date(), coercion]) {
      expect(() => encodeTrustedFixture(input)).toThrow('native-only test fixture');
    }
    expect(reads).toBe(0);
  });

  it('refuses declared scope fallback or a metric borrowed from another source', () => {
    for (const key of ['instanceKey', 'workspaceKey', 'projectKey', 'processKey']) {
      const input = { ...fixture(), resolvedScope: { ...scope(), [key]: 'd'.repeat(64) } };
      expect(admitFixture(input)).toEqual({ status: 'invalid', reason: 'invalid-evidence' });
    }
    expect(admitFixture({ ...fixture(), source: 'os' })).toEqual({ status: 'invalid', reason: 'invalid-evidence' });
    const missing = fixture(); Reflect.deleteProperty(missing.requestedScope, 'projectKey');
    expect(admitFixture(missing)).toEqual({ status: 'invalid', reason: 'invalid-evidence' });
  });

  it('bounds cardinalities and numeric units without coercion or implicit assumptions', () => {
    // JSON has no NaN, Infinity or undefined. Refuse the ORIGINAL native objects;
    // the trusted seam must throw, never serialize these into null/omitted fields.
    for (const value of [NaN, Infinity, -Infinity, undefined]) {
      const input = { ...fixture(), observations: [{ ...fixture().observations[0], value }] };
      expect(() => encodeTrustedFixture(input)).toThrow('native-only test fixture');
      for (const entry of [evidence.admitSourceEvidence, evidence.assessSourceEvidence]) {
        expect(entry(input)).toEqual({ status: 'invalid', reason: 'invalid-evidence' });
      }
    }
    const bad: unknown[] = [
      ...['1', true, -1, 1_000_000_000_001].map(value =>
        ({ ...fixture(), observations: [{ ...fixture().observations[0], value }] })),
      ...[-1, 0.5, 1_000_000_001].flatMap(n => [
        { ...fixture(), observations: [{ ...fixture().observations[0], sampleCount: n }] },
        { ...fixture(), provenance: { ...fixture().provenance, cohortCount: n } },
      ]),
      { ...fixture(), observations: Array.from({ length: 33 }, () => fixture().observations[0]) },
      { ...fixture(), manualAssumptions: Array.from({ length: 17 }, () => fixture().manualAssumptions[0]) },
      { ...fixture(), source: 'os', observations: [{ metric: 'os-queue-count', state: 'recorded', value: 1.5, sampleCount: null }] },
    ];
    for (const [key, max] of [
      ['annualVolume', 1_000_000_000], ['baselineSeconds', 31_536_000], ['targetSeconds', 31_536_000],
      ['adoptionBasisPoints', 10_000], ['cashRealizationBasisPoints', 10_000],
      ['loadedHourlyCostCents', 1_000_000_000_000], ['annualRecurringCostCents', 1_000_000_000_000], ['initialCostCents', 1_000_000_000_000],
    ] as const) {
      for (const value of [-1, 0.5, max + 1]) bad.push({ ...fixture(), manualAssumptions: [{ key, value }] });
      expect(admitFixture({ ...fixture(), manualAssumptions: [{ key, value: max }] }).status).toBe('admitted-unverified');
    }
    for (const input of bad) expect(admitFixture(input)).toEqual({ status: 'invalid', reason: 'invalid-evidence' });
    expect(admitFixture({ ...fixture(), manualAssumptions: [{ key: 'annualVolume', value: null }] }).status).toBe('admitted-unverified');
    expect(admitFixture({ ...fixture(), source: 'teoa-advantage',
      observations: [{ metric: 'advantage-recorded-value', state: 'recorded', value: -1.5, sampleCount: null }] }).status).toBe('admitted-unverified');
  });

  it('preserves no-data and suppression while refusing contradictory or duplicate aggregates', () => {
    const point = fixture().observations[0]!;
    const noData = { ...fixture(), observations: [{ ...point, state: 'no-data', value: null, sampleCount: 0 }] };
    const suppressed = { ...fixture(), provenance: { ...fixture().provenance, coverage: 'suppressed' },
      observations: [{ ...point, state: 'suppressed', value: null, sampleCount: null }] };
    expect(admitFixture(noData)).toEqual({ status: 'admitted-unverified', snapshot: noData });
    expect(admitFixture(suppressed)).toEqual({ status: 'admitted-unverified', snapshot: suppressed });
    const window = { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z', calendar: 'gregorian-utc' };
    const bad = [
      { ...fixture(), observations: [point, { ...point, value: 900 }] },
      { ...fixture(), manualAssumptions: [{ key: 'annualVolume', value: 1 }, { key: 'annualVolume', value: 2 }] },
      { ...fixture(), observations: [{ ...point, state: 'no-data' }] },
      { ...fixture(), observations: [{ ...point, value: null }] },
      { ...fixture(), observations: [{ ...point, sampleCount: 0 }] },
      { ...fixture(), provenance: suppressed.provenance },
      { ...suppressed, observations: [{ ...suppressed.observations[0], sampleCount: 2 }] },
      { ...suppressed, provenance: { ...suppressed.provenance, cohortCount: 2 } },
      { ...fixture(), provenance: { ...fixture().provenance, sourceRevision: 'a'.repeat(16) } },
      { ...fixture(), provenance: { ...fixture().provenance, window: { ...window, from: window.to, to: window.from } } },
      { ...fixture(), provenance: { ...fixture().provenance, window: { ...window, to: window.from } } },
      { ...fixture(), provenance: { ...fixture().provenance, retrievedAt: window.from, observedAt: window.to } },
      { ...fixture(), provenance: { ...fixture().provenance, observedAt: '2026-02-30T00:00:00.000Z' } },
      { ...fixture(), provenance: { ...fixture().provenance, observedAt: '2026-10-01' } },
    ];
    for (const input of bad) expect(admitFixture(input)).toEqual({ status: 'invalid', reason: 'invalid-evidence' });
    const declared = { ...fixture(), provenance: { ...fixture().provenance, retrievedAt: window.to, observedAt: window.from, window } };
    expect(admitFixture(declared)).toEqual({ status: 'admitted-unverified', snapshot: declared });
    const nullPrototype = Object.assign(Object.create(null), noData);
    expect(admitFixture(nullPrototype)).toEqual(admitFixture(noData));
  });

  it('keeps every source unavailable until a host-owned aggregate export exists', () => {
    expect(evidence.ROI_SOURCE_CONNECTORS).toEqual([
      { id: 'maps', label: 'Flightdeck Maps', availability: 'unavailable', requires: 'host-owned-aggregate-export' },
      { id: 'teoa-advantage', label: 'TEOA / Advantage', availability: 'unavailable', requires: 'host-owned-aggregate-export' },
      { id: 'os', label: 'Flightdeck OS', availability: 'unavailable', requires: 'host-owned-aggregate-export' },
    ]);
  });

  it('publishes immutable, source-grounded semantics and gaps rather than a DTO endpoint', () => {
    expect(evidence.ROI_SOURCE_CONTRACTS.maps).toMatchObject({
      sourceSchemas: ['signavio-map/1'],
      metrics: {
        'maps-stopwatch-mean-ms': { basis: 'manual-stopwatch-elapsed-unspecified', unit: 'ms' },
        'maps-authored-estimate-min': { basis: 'authored-estimate', unit: 'min' },
        'maps-all-step-timing-sum-ms': { basis: 'mixed-map-model-total', unit: 'ms' },
      },
      gaps: expect.arrayContaining(['sample-period-and-cohort-unknown', 'not-end-to-end-labor', 'ci-reads-can-seed-settings']),
    });
    expect(evidence.ROI_SOURCE_CONTRACTS['teoa-advantage']).toMatchObject({
      sourceSchemas: ['teoa-process/1', 'advantage-process-kpis/1', 'advantage-opportunities/1'],
      gaps: expect.arrayContaining(['process-kpis-currently-contracts-de', 'recorded-values-are-manual', 'card-flow-is-not-case-throughput', 'priority-is-not-roi']),
    });
    expect(evidence.ROI_SOURCE_CONTRACTS.os.gaps).toEqual(expect.arrayContaining([
      'session-savings-are-self-reported', 'ops-window-not-applied', 'runtime-timing-not-in-current-instance-dto',
    ]));
    for (const value of [evidence.ROI_SOURCE_CONNECTORS, ...evidence.ROI_SOURCE_CONNECTORS,
      evidence.ROI_SOURCE_CONTRACTS, ...Object.values(evidence.ROI_SOURCE_CONTRACTS)]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    for (const contract of Object.values(evidence.ROI_SOURCE_CONTRACTS)) {
      expect(Object.isFrozen(contract.metrics)).toBe(true);
      expect(Object.isFrozen(contract.gaps)).toBe(true);
      expect(contract.references.length).toBeGreaterThan(0);
      for (const ref of contract.references) {
        expect(ref.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(Object.isFrozen(ref)).toBe(true);
      }
    }
    expect(evidence.ROI_EVIDENCE_PROPOSAL).toMatchObject({
      schema: 'studio-roi-aggregate-proposal/1', status: 'proposal-not-current-host-api',
      maxObservations: 32, maxManualAssumptions: 16,
    });
  });
});
