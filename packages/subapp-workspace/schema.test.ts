import { describe, expect, it } from 'vitest';
import { snapshotSchema, documentSchema, summarySchema, safeSubappValue } from './schema';
import { snapshotFixture } from './testing';
import type { Candidate } from '../../src/workbench/types';

describe('private sub-app shared DTO', () => {
  it('enforces the exact 10000 object-property ceiling without counting array length as an element', () => {
    const object = Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`p${i}`, 0]));
    expect(safeSubappValue(object, 500_000)).toBe(true);
    Object.assign(object, { extra: 0 }); expect(safeSubappValue(object, 500_000)).toBe(false);
    expect(safeSubappValue(Array(10_000).fill(0), 500_000)).toBe(true);
    expect(safeSubappValue(Array(10_001).fill(0), 500_000)).toBe(false);
  });
  it('retains exact generated baseline and independently edited private source bytes', () => {
    const input = snapshotFixture();
    input.files[0]!.contents = '\r\n  const token = "key";\t\n';
    const parsed = snapshotSchema.parse(input);
    const compatible: Candidate = parsed.baseline;
    expect(compatible).toEqual(input.baseline);
    expect(parsed).toEqual(input);
    expect(parsed.files[0]!.contents).toBe(input.files[0]!.contents);
    expect(parsed.baseline.files[0]!.contents).not.toBe(parsed.files[0]!.contents);
    expect(snapshotSchema.safeParse({ ...input, permissions: ['deploy'] }).success).toBe(false);
    expect(typeof documentSchema.safeParse).toBe('function');
    expect(typeof summarySchema.safeParse).toBe('function');
  });

  it('rejects unsafe native objects before recursive parsing without evaluating accessors', () => {
    let reads = 0;
    const accessor = Object.defineProperty(snapshotFixture(), 'files', { enumerable: true, get: () => { reads++; throw new Error('PRIVATE_SENTINEL'); } });
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    let deep: unknown = {}; for (let i = 0; i < 100; i++) deep = { child: deep };
    const symbol = snapshotFixture(); Object.defineProperty(symbol, Symbol('private'), { value: true });
    const hidden = snapshotFixture(); Object.defineProperty(hidden, 'hidden', { value: true });
    const inherited = Object.assign(Object.create({ ignored: 'PRIVATE_SENTINEL' }), snapshotFixture());
    const sparse = snapshotFixture(); delete sparse.files[0];
    const decorated = snapshotFixture(); Object.assign(decorated.files, { extra: true });
    for (const value of [accessor, cyclic, deep, symbol, hidden, inherited, sparse, decorated, { ...snapshotFixture(), optional: undefined }, JSON.parse('{"__proto__":{"private":"PRIVATE_SENTINEL"}}')]) {
      let result: ReturnType<typeof snapshotSchema.safeParse> | undefined;
      expect(() => { result = snapshotSchema.safeParse(value); }).not.toThrow();
      expect(result?.success).toBe(false);
      if (result && !result.success) expect(JSON.stringify(result.error.issues)).not.toContain('PRIVATE_SENTINEL');
    }
    expect(reads).toBe(0);
  });

  it('bounds UTF-8 source/snapshot bytes and accepts only unique canonical matching artifact inventories', () => {
    const input = snapshotFixture();
    for (const path of ['/etc/passwd', '../host.ts', 'server/../host.ts', 'server//host.ts', 'server/./host.ts', 'server/a\\b.ts', 'C:/host.ts', 'server/%2e%2e/host.ts', 'other/host.ts']) {
      expect(snapshotSchema.safeParse({ ...input, files: [{ ...input.files[0]!, path }] }).success).toBe(false);
    }
    expect(snapshotSchema.safeParse({ ...input, files: [input.files[0]!, input.files[0]!] }).success).toBe(false);
    expect(snapshotSchema.safeParse({ ...input, files: [{ ...input.files[0]!, kind: 'guard' }] }).success).toBe(false);
    expect(snapshotSchema.safeParse({ ...input, files: [{ ...input.files[0]!, contents: 'é'.repeat(100_001) }] }).success).toBe(false);
    const huge = snapshotFixture(); huge.baseline.notes = Array(1_000).fill('x'.repeat(2_000));
    expect(snapshotSchema.safeParse(huge).success).toBe(false);
    expect(snapshotSchema.safeParse({ ...input, baseline: { ...input.baseline, findings: [{ rule: 'r', severity: 'error', file: '../escape', line: 0, column: 0, message: 'PRIVATE_SENTINEL', evidence: null }] } }).success).toBe(false);
  });
});
