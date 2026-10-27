import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { readHostManifestContract, readHostManifestMetadata } from "../testing/readHostManifestMetadata";
import { readEmittedManifest } from "../testing/readEmittedManifest";
import ts from "typescript";
import { assertManifestWouldBoot } from "../manifest-rules";
import { HOST_ROOT } from "../../../guardrails/src/host-source";

const local = fs.readFileSync(new URL("../manifest-rules.ts", import.meta.url), "utf8");
const spec = fs.readFileSync(new URL("../spec-contract.ts", import.meta.url), "utf8");
const typesPath = `${HOST_ROOT}/flightdeck/server/subapps/types.ts`;
const available = fs.existsSync(typesPath);
if (process.env.FLIGHTDECK_HOST_ROOT && !available) throw new Error(`Missing explicit host source: ${typesPath}`);
const base = { id: "demo", label: "Demo", version: "0.1.0", minHostVersion: "5.0.0", icon: "X", navSection: "Admin", routePrefix: "/api/apps/demo", webModuleId: "demo", capabilities: [], visibleToRoles: ["admin"] };
const source = (tail = "") => `export const demo: SubAppManifest = {${JSON.stringify(base).slice(1,-1)}, ${tail}};`;

describe.skipIf(!available)("bounded live host metadata projection", () => {
  const host = available ? fs.readFileSync(typesPath, "utf8") : "";
  const contract = () => readHostManifestContract(host, local, spec);
  it("projects core literals with explicit source-position omissions without executing callbacks", () => {
    const text = source('contributions: { callback: () => { throw new Error("import(never)"); } }, initSchema: sentinel(), registerRoutes: sentinel');
    const result = readHostManifestMetadata(text, contract());
    expect(result.metadata).toEqual(base);
    expect(result.omittedMembers.map(m => m.name)).toEqual(["contributions", "initSchema", "registerRoutes"]);
    for (const member of result.omittedMembers) expect(text.slice(member.start, member.end)).toContain(member.name);
    expect(() => readEmittedManifest(text)).toThrow();
  });

  it.each([
    ['id: derive()', /literal/], ['id: otherId', /literal/],
    ['id: `demo${sentinel()}`', /literal/], ['["id"]: "demo"', /computed/],
    ['...other', /spreads/], ['get id() { return "demo" }', /accessors/],
    ['id: "demo"', /duplicate/], ['settingsPanel: { ...other }', /spreads/],
    ['settingsPanel: { label: "a", label: "b" }', /duplicate/],
    ['settingsPanel: { ["label"]: "a" }', /computed/],
    ['settingsPanel: { __proto__: null }', /unsafe/],
    ['unrecognised: sentinel()', /undeclared/],
  ])("refuses nonliteral/ambiguous core or structure: %s", (tail, message) => {
    const text = /^id: (derive|otherId|`)/.test(tail) ? source(tail).replace('"id":"demo",', '') : source(tail);
    expect(() => readHostManifestMetadata(text, contract())).toThrow(message);
  });

  it("rejects spreads before as well as after metadata", () => {
    expect(() => readHostManifestMetadata(source().replace('{"id"', '{...other, "id"'), contract())).toThrow(/spreads/);
  });

  it.each([
    ['const SUBAPP_ID_RE = /^[a-z0-9][a-z0-9-]*$/', 'const SUBAPP_ID_RE = /^[A-Z]+$/'],
    [String.raw`const ROUTE_PREFIX_RE = /^\/api\/apps\/[a-z0-9-]+$/`, String.raw`const ROUTE_PREFIX_RE = /^\/anything$/`],
    ['label: z.string().min(1)', 'label: z.string().min(2)'],
    ['version: z.string()', 'version: z.string().default("1.0.0")'],
    ['capabilities: z.array(z.enum(CAPABILITY_SCOPES))', 'capabilities: z.array(z.string())'],
    ['visibleToRoles: z.array(z.enum(WORKSPACE_ROLE_VALUES)).min(1)', 'visibleToRoles: z.array(z.enum(WORKSPACE_ROLE_VALUES))'],
    ['"System apps"]', '"Other apps"]'],
    ['"write:inbox-proposal"]', '"other:scope"]'],
    ['"legal", "admin"]', '"legal", "super_admin"]'],
    ['tier: z.enum(["workspace-admin", "super-admin"])', 'tier: z.enum(["super-admin"])'],
    ['settingsPanel: settingsPanelSchema.optional()', 'settingsPanel: settingsPanelSchema'],
    ['generatedBy: z.literal("flightdeck-studio").optional()', 'generatedBy: z.literal("flightdeck-studio")'],
    ['id: z.string().regex(SUBAPP_ID_RE)', 'newRequired: z.string(), id: z.string().regex(SUBAPP_ID_RE)'],
    ['contributions?: SubAppContributions', 'contributions: SubAppContributions'],
    ['initSchema(db: Db)', 'newRequiredCallback(): void; initSchema(db: Db)'],
    ['subAppManifestSchema = z.object({', 'subAppManifestSchema = z.strictObject({'],
  ])("fails closed on authoritative host drift: %s", (before, after) => {
    expect(host).toContain(before);
    expect(() => readHostManifestContract(host.replaceAll(before, after), local, spec)).toThrow();
  });

  it("detects drift in local rules independently of host examples", () => {
    expect(() => readHostManifestContract(host, local.replace('visibleToRoles: z.array(z.enum(WORKSPACE_ROLES)).min(1)', 'visibleToRoles: z.array(z.enum(WORKSPACE_ROLES))'), spec)).toThrow(/drift/);
  });

  it.each(['id', 'navSection', 'visibleToRoles', 'routePrefix'])('checks malformed %s against the boot metadata rules', (name) => {
    const bad = { ...base, [name]: name === 'visibleToRoles' ? [] : 'INVALID' };
    const text = `const demo: SubAppManifest = ${JSON.stringify(bad)};`;
    expect(() => assertManifestWouldBoot(readHostManifestMetadata(text, contract()).metadata)).toThrow();
  });

  it("preserves strict generated admission with only the two existing function exceptions", () => {
    const emitted = `export const generated: SubAppManifest = {\n${Object.entries(base).map(([name, value]) => `${name}: ${JSON.stringify(value)},`).join('\n')}\ninitSchema: (db) => init(db),\nregisterRoutes: (app, ctx) => register(app, ctx),\n};`;
    expect(readEmittedManifest(emitted)).toEqual(base);
    for (const member of ['widgets: computedWidgets,', 'contributions: computedContributions,', 'firstObject: () => ({ exists: false }),']) {
      expect(() => readEmittedManifest(emitted.replace('\n};', `\n${member}\n};`))).toThrow(/JSON literals/);
    }
  });

  it("does not pretend omissions validate optional additive schemas", () => {
    const result = readHostManifestMetadata(source('widgets: arbitraryFunction(), contributions: arbitraryFunction()'), contract());
    expect(result.omittedMembers.map(m => [m.name, m.reason])).toEqual([
      ['widgets', 'optional-schema'], ['contributions', 'schema-stripped-callback'],
    ]);
    expect(() => readEmittedManifest(source('widgets: arbitraryFunction()'))).toThrow();
    expect(() => readEmittedManifest(source('firstObject: () => ({ exists: false })'))).toThrow();
  });

  it("bounds bytes and nesting, refuses multiple declarations and nonconst initializers", () => {
    const c = contract();
    expect(() => readHostManifestMetadata(' '.repeat(1_048_577), c)).toThrow(/1 MiB/);
    expect(() => readHostManifestMetadata(source('settingsPanel: ' + '['.repeat(65) + '0' + ']'.repeat(65)), c)).toThrow(/nesting/);
    expect(() => readHostManifestMetadata(source() + source(), c)).toThrow(/exactly one/);
    expect(() => readHostManifestMetadata(source().replace('const demo', 'let demo'), c)).toThrow(/const/);
    expect(() => readHostManifestMetadata('const demo: SubAppManifest = factory();', c)).toThrow(/object literal/);
    expect(() => readHostManifestMetadata(source().slice(0, -3), c)).toThrow(/syntax/);
  });

  it("returns inert import-shaped string data without execution or lexical confusion", () => {
    const text = source().replace('"Demo"', JSON.stringify('import("never"); require("never"); // { }'));
    expect(readHostManifestMetadata(text, contract()).metadata.label).toBe('import("never"); require("never"); // { }');
  });

  it("bounds AST expression depth even without nested delimiters", () => {
    expect(() => readHostManifestMetadata(source('contributions: ' + '!'.repeat(100) + 'false'), contract())).toThrow(/nesting/);
  });

  it("rejects negative nonfinite numeric metadata", () => {
    expect(() => readHostManifestMetadata(source('settingsPanel: { label: -1e999 }'), contract())).toThrow(/nonfinite/);
  });

  it("requires static const schema aliases and preserves required callback declarations", () => {
    expect(() => readHostManifestContract(host.replace('const SUBAPP_ID_RE', 'let SUBAPP_ID_RE'), local, spec)).toThrow(/const/);
    expect(() => readHostManifestContract(host.replace('initSchema(db: Db)', 'initSchema?(db: Db)'), local, spec)).toThrow(/callback/);
  });

  it("refuses destructuring declarations rather than guessing the manifest identity", () => {
    expect(() => readHostManifestMetadata(source().replace('const demo:', 'const { demo }:'), contract())).toThrow(/identifier/);
  });

  it("discovers and accounts for every member of all four actual manifests", () => {
    for (const id of ['shell-reference', 'docusign', 'maps', 'advantage']) {
      const text = fs.readFileSync(`${HOST_ROOT}/flightdeck/server/subapps/${id}/manifest.ts`, 'utf8');
      const parsed = ts.createSourceFile('manifest.ts', text, ts.ScriptTarget.Latest, true);
      const members: string[] = [];
      for (const statement of parsed.statements) if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) if (declaration.type?.getText(parsed) === 'SubAppManifest' && declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer)) {
          for (const member of declaration.initializer.properties) if (member.name) members.push(member.name.getText(parsed));
        }
      }
      const c = contract();
      const result = readHostManifestMetadata(text, c);
      expect(result.metadata.id).toBe(id);
      expect(() => assertManifestWouldBoot(result.metadata)).not.toThrow();
      for (const mutation of [{ id: 'INVALID' }, { navSection: 'INVALID' }, { routePrefix: '/invalid' }, { capabilities: ['invalid:scope'] }, { visibleToRoles: [] }, { minHostVersion: '99.0.0' }]) {
        expect(() => assertManifestWouldBoot({ ...result.metadata, ...mutation })).toThrow();
      }
      expect([...Object.keys(result.metadata), ...result.omittedMembers.map(m => m.name)].sort()).toEqual(members.sort());
      expect(result.omittedMembers.map(m => m.name).sort()).toEqual(members.filter(m => !c.coreFields.has(m)).sort());
      for (const m of result.omittedMembers) expect(text.slice(m.start, m.end)).toContain(m.name);
    }
  });
});
