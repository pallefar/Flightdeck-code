import { expect, it } from 'vitest';
import Fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
import { createNativeContextAdapter, type SubAppProjectDirectory } from './native';

const directory: SubAppProjectDirectory = { workspace: { id: 'alpha', label: 'Alpha' }, selectedProjectId: 'general', projects: [{ id: 'general', label: 'General', enabled: true, isDefault: true, application: { openable: true, blockedReason: null, nextStep: 'open' }, contractDesk: { openable: false, blockedReason: 'unavailable', nextStep: 'none' } }] };
it('reuses the actual live host method ABI by non-executing AST extraction and strict type projection', async () => {
  const hostRoot = process.env.FLIGHTDECK_HOST_ROOT ?? '/Users/te451223/FlightDeck OS/wt-integration';
  const actual = ts.createSourceFile('types.ts', await readFile(resolve(hostRoot, 'flightdeck/server/subapps/types.ts'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const local = ts.createSourceFile('native.ts', await readFile(resolve('packages/host-bridge/native.ts'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  function iface(source: ts.SourceFile, name: string) { const i = source.statements.find((n): n is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(n) && n.name.text === name); if (!i) throw new Error('host ABI missing interface: ' + name); return i; }
  const members = iface(actual, 'RegisterRoutesCtx').members;
  function method(name: string) { const m = members.find(n => n.name?.getText(actual) === name); if (!m || !ts.isMethodSignature(m)) throw new Error('host ABI missing method'); return m; }
  const normalize = (text: string) => text.replace(/\s+/g, '');
  for (const name of ['projectDirectory', 'reauthorizeRequest']) {
    const native = iface(local, 'NativeHostContext').members.find(n => n.name?.getText(local) === name); expect(native).toBeDefined();
    expect(normalize(native!.getText(local))).toBe(normalize(method(name).getText(actual)));
  }
  expect(normalize(method('capabilitiesFor').getText(actual))).toBe('capabilitiesFor(workspaceId:string,req:FastifyRequest):Promise<SubAppCapabilities>;');
  const file = resolve('packages/host-bridge/__abi_virtual.ts');
  const projection = `import type { FastifyRequest } from 'fastify';\nimport type { NativeHostContext } from './native';\n${iface(actual, 'SubAppProjectAvailability').getText(actual)}\n${iface(actual, 'SubAppProjectDirectory').getText(actual)}\ninterface RegisterRoutesCtx { ${method('projectDirectory').getText(actual)} ${method('reauthorizeRequest').getText(actual)} }\ndeclare const host: RegisterRoutesCtx; const native: NativeHostContext = host; void native;`;
  const options: ts.CompilerOptions = { strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: ['node'] };
  const compiler = ts.createCompilerHost(options); const originalRead = compiler.readFile.bind(compiler); const originalExists = compiler.fileExists.bind(compiler);
  compiler.readFile = p => p === file ? projection : originalRead(p); compiler.fileExists = p => p === file || originalExists(p);
  const program = ts.createProgram([file], options, compiler);
  expect(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
});
it('native adapter passes the actual server request to awaited native seams, requires trusted epochs and does not infer Studio grants from directory/app availability', async () => {
  const seen: object[] = [];
  const context = { reauthorizeRequest: async (req: Parameters<ReturnType<typeof createNativeContextAdapter>['current']>[0]) => { seen.push(req); return { actor: 'alice', effectiveRole: 'member' }; }, projectDirectory: async (req: Parameters<ReturnType<typeof createNativeContextAdapter>['current']>[0]) => { seen.push(req); return directory; } };
  const view = () => ({ principal: { username: 'alice', displayName: 'Mutable label' }, workspace: { id: 'alpha', enabled: true }, project: { id: 'general', enabled: true } });
  const adapter = createNativeContextAdapter({ authRequired: true, workspacesEnabled: true, context, view, epochs: async () => ({ sessionVersion: 'NONSECRET-host-fixture-session-epoch', authorityVersion: 'NONSECRET-host-fixture-context-epoch' }) });
  const missing = createNativeContextAdapter({ authRequired: true, workspacesEnabled: true, context, view });
  const app = Fastify({ logger: false });
  app.get('/', async req => { expect(await missing.current(req)).toBeNull(); const state = await adapter.current(req); expect(seen.every(r => r === req)).toBe(true); return { state }; });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  try { const response = await fetch(origin); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ state: { actorId: 'alice', member: true, workspaceId: 'alpha', projectId: 'general' } }); expect(seen.length).toBeGreaterThanOrEqual(3); }
  finally { await app.close(); }
});
