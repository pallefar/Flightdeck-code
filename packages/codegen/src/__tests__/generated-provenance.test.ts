import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { generateSubApp } from '../pure';
import { minimalSpec } from '../fixtures/specs';
import { readEmittedManifest } from '../testing/readEmittedManifest';
import { typecheckCandidate } from '../../../conformance/src/verify/typecheck';
import { FLIGHTDECK_HOST_SURFACE } from '../../../conformance/src/verify/host-surface';

it('marks real emitted Studio sub-apps so host defaults cannot treat them as hand-written apps', () => {
  const generated = generateSubApp(minimalSpec);
  const manifest = generated.files.find(file => file.kind === 'manifest');
  expect(manifest).toBeDefined();
  expect(readEmittedManifest(manifest!.contents).generatedBy).toBe('flightdeck-studio');
});

it('compiles the complete unmodified marked host bundle including its emitted assertions', () => {
  const files = generateSubApp(minimalSpec).files.filter(file => file.kind !== 'standalone');
  const result = typecheckCandidate(files);
  expect(result.diagnosticCount, result.output).toBe(0);
  expect(result.ok).toBe(true);
});


it('compiles marked source against the actual emitted standalone SDK projection too', () => {
  const generated = generateSubApp(minimalSpec);
  const shim = generated.files.find(file => file.kind === 'standalone' && file.path === 'server/subapps/types.ts')!;
  expect(shim).toBeDefined();
  const result = typecheckCandidate(generated.files.filter(file => file.kind !== 'standalone'), {
    hostSurface: { ...FLIGHTDECK_HOST_SURFACE, types: { ...FLIGHTDECK_HOST_SURFACE.types, 'server/subapps/types': shim.contents } },
  });
  expect(result.diagnosticCount, result.output).toBe(0);
});


it('standalone boot validation preserves the exact literal marker and rejects misspellings', () => {
  const generated = generateSubApp(minimalSpec);
  const shim = generated.files.find(file => file.kind === 'standalone' && file.path === 'server/subapps/types.ts')!;
  const code = ts.transpileModule(shim.contents, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const exports_: Record<string, unknown> = {};
  new Function('require', 'exports', code)(createRequire(import.meta.url), exports_);
  const schema = exports_.subAppManifestSchema as { safeParse(value: unknown): { success: boolean; data?: Record<string, unknown> } };
  const data = readEmittedManifest(generated.files.find(file => file.kind === 'manifest')!.contents);
  const valid = schema.safeParse(data);
  expect(valid.success).toBe(true);
  expect(valid.data?.generatedBy).toBe('flightdeck-studio');
  for (const marker of ['hand-written', 'flightdeck-studio ', true]) expect(schema.safeParse({ ...data, generatedBy: marker }).success).toBe(false);
});

function provenanceAssertion(marker: unknown): () => void {
  const generated = generateSubApp(minimalSpec);
  const test = generated.files.find(file => file.kind === 'host-test')!;
  const callbacks = new Map<string, () => void>();
  const realRequire = createRequire(import.meta.url);
  const code = ts.transpileModule(test.contents, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  new Function('require', 'exports', code)((name: string) => {
    if (name === 'vitest') return { expect, describe: (_name: string, run: () => void) => run(), it: (name: string, run: () => void) => callbacks.set(name, run) };
    if (name.includes('/manifest.js')) return { [generated.plan.names.manifestConst]: { generatedBy: marker } };
    if (name.startsWith('../../../server/')) return {};
    return realRequire(name);
  }, {});
  const assertion = callbacks.get('retains the Studio-generated host policy marker');
  expect(typeof assertion).toBe('function');
  return assertion!;
}

it('ships an executable marker assertion that refuses missing or altered provenance after manual edits', () => {
  expect(provenanceAssertion('flightdeck-studio')).not.toThrow();
  for (const marker of [undefined, 'hand-written', 'flightdeck-studio ']) expect(provenanceAssertion(marker)).toThrow();
});
