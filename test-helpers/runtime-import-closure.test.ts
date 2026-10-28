import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { runtimeImportClosure } from "./runtime-import-closure";

const cleanup: string[] = [];
afterEach(() => { for (const root of cleanup.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-closure-")); cleanup.push(root);
  const write = (name: string, contents: string) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, contents); };
  write("package.json", JSON.stringify({ dependencies: { "@fixture/shared": "file:packages/shared" } }));
  const metadata = { name: "@fixture/shared", type: "module", exports: { "./data": { types: "./dist/data.d.ts", default: "./dist/data.js" } } };
  write("packages/shared/package.json", JSON.stringify(metadata));
  write("packages/shared/tsconfig.json", JSON.stringify({ compilerOptions: { rootDir: ".", outDir: "dist", module: "NodeNext" } }));
  write("entry.ts", 'export { value } from "@fixture/shared/data";');
  write("packages/shared/data.ts", 'import { helper } from "./nested/helper.js"; export const value = helper;');
  write("packages/shared/nested/helper.ts", 'import { z } from "zod"; export const helper = z.string();');
  write("packages/shared/dist/data.js", 'import { helper } from "./nested/helper.js"; export const value = helper;');
  write("packages/shared/dist/data.d.ts", "export declare const value: unknown;");
  write("packages/shared/dist/nested/helper.js", 'import { z } from "zod"; export const helper = z.string();');
  fs.mkdirSync(path.join(root, "node_modules/@fixture"), { recursive: true });
  fs.symlinkSync("../../packages/shared", path.join(root, "node_modules/@fixture/shared"));
  return { root, write, metadata, scan: () => runtimeImportClosure(root, [path.join(root, "entry.ts")]) };
}

it("inspects the existing literal model-id metadata leaf without treating it as a model adapter", () => {
  const f = fixture();
  f.write("packages/providers/src/models.ts", 'export const DEFAULT_MODEL = "fixture-model";');
  f.write("entry.ts", 'export { DEFAULT_MODEL } from "./packages/providers/src/models"; export * from "@fixture/shared/data";');
  expect(f.scan().seen.has(path.join(f.root, "packages/providers/src/models.ts"))).toBe(true);
});

it.each([
  'export const DEFAULT_MODEL = process.env.MODEL;',
  'export const DEFAULT_MODEL = chooseModel();',
  'export const DEFAULT_MODEL = "fixture-model"; invokeProvider();',
  'export const DEFAULT_MODEL = "fixture-model"; export const run = () => 1;',
  'import "node:fs"; export const DEFAULT_MODEL = "fixture-model";',
])("rejects executable expansion of the literal model-id metadata leaf: %s", contents => {
  const f = fixture(); f.write("packages/providers/src/models.ts", contents);
  f.write("entry.ts", 'export { DEFAULT_MODEL } from "./packages/providers/src/models";');
  expect(() => f.scan()).toThrow();
});

it("follows actual local package exports and both compiled and source transitive closures, with zod the only terminal bare dependency", () => {
  const f = fixture(), result = f.scan();
  expect([...result.bare]).toEqual(["zod"]);
  for (const file of ["data.ts", "nested/helper.ts", "dist/data.js", "dist/nested/helper.js"]) expect(result.seen.has(fs.realpathSync(path.join(f.root, "packages/shared", file)))).toBe(true);
  expect([...result.seen].some(p => p.includes("/node_modules/"))).toBe(false);
});

it("canonicalizes aliases and cycles without confusing emitted .js with source .ts", () => {
  const f = fixture();
  f.write("entry.ts", 'export * from "@fixture/shared/data"; export * from "./packages/shared/data"; export * from "./alias";');
  fs.symlinkSync("packages/shared/data.ts", path.join(f.root, "alias.ts"));
  f.write("packages/shared/nested/helper.ts", 'import type { Buffer } from "node:buffer"; import type { Hidden } from "node:fs"; export type { X } from "unknown-type-only"; export { type Y } from "unknown-type-only"; import { z } from "zod"; export { value } from "../data.js"; export const helper = z.string();');
  const result = f.scan();
  expect([...result.bare]).toEqual(["zod"]);
  expect(result.seen.size).toBe(5);
});

it.each([
  ["source Node import", "packages/shared/nested/helper.ts", 'import "node:fs";'],
  ["compiled Node import", "packages/shared/dist/nested/helper.js", 'import "node:fs";'],
  ["unlisted bare package", "packages/shared/nested/helper.ts", 'export * from "unknown-package";'],
  ["Node without protocol", "packages/shared/nested/helper.ts", 'import "fs";'],
  ["dynamic literal import", "packages/shared/nested/helper.ts", 'const loader = () => import("./other.js");'],
  ["dynamic computed import", "packages/shared/nested/helper.ts", 'const loader = (name: string) => import(name);'],
  ["require", "packages/shared/nested/helper.ts", 'const value = require("./other.js");'],
  ["import equals require", "packages/shared/nested/helper.ts", 'import value = require("./other.js");'],
  ["aliased require", "packages/shared/nested/helper.ts", 'const load = require; load("node:fs");'],
  ["aliased network IO", "packages/shared/nested/helper.ts", 'const send = fetch; send("https://example.test");'],
  ["ambient Node environment", "packages/shared/nested/helper.ts", 'export const value = process.env.PRIVATE;'],
  ["dynamic evaluation", "packages/shared/nested/helper.ts", 'const run = Function; run("return 1");'],
  ["network IO", "packages/shared/nested/helper.ts", 'const value = () => globalThis.fetch("https://example.test");'],
  ["browser storage IO", "packages/shared/nested/helper.ts", 'const value = () => localStorage.getItem("private");'],
  ["invalid source", "packages/shared/nested/helper.ts", 'export {;'],
])("rejects %s in the transitive file package closure", (_name, file, contents) => {
  const f = fixture(); f.write(file, contents); expect(() => f.scan()).toThrow();
});

it.each(["server/io", "providers/model", "host/client", "authoring-harness/api", "packages/codegen/src/apply"])("rejects transitive forbidden module %s", target => {
  const f = fixture(); f.write(`${target}.ts`, "export const value = 1;");
  f.write("packages/shared/nested/helper.ts", `export * from "../../../${target}";`);
  expect(() => f.scan()).toThrow();
});

it.each([
  ["unknown export", "./missing"],
  ["undeclared deep import", "/dist/data.js"],
])("rejects %s rather than bypassing package exports", (_name, subpath) => {
  const f = fixture(); f.write("entry.ts", `export * from "@fixture/shared${subpath.startsWith(".") ? subpath.slice(1) : subpath}";`); expect(() => f.scan()).toThrow();
});

it.each([
  ["node condition", { node: "./dist/data.js", default: "./dist/data.js" }],
  ["import condition", { import: "./dist/data.js", default: "./dist/data.js" }],
  ["conditional array", ["./dist/data.js"]],
  ["escaping export", "../outside.js"],
])("rejects %s without guessing conditional or escaping exports", (_name, target) => {
  const f = fixture(); f.write("packages/shared/package.json", JSON.stringify({ ...f.metadata, exports: { "./data": target } })); expect(() => f.scan()).toThrow();
});

it("rejects mismatched installed package identity", () => {
  const f = fixture(); fs.unlinkSync(path.join(f.root, "node_modules/@fixture/shared"));
  f.write("other/package.json", JSON.stringify(f.metadata)); fs.symlinkSync("../../other", path.join(f.root, "node_modules/@fixture/shared")); expect(() => f.scan()).toThrow();
});

it("rejects a package symlink outside the declared root before reading its source", () => {
  const f = fixture(), outside = fs.mkdtempSync(path.join(os.tmpdir(), "closure-outside-")); cleanup.push(outside);
  fs.writeFileSync(path.join(outside, "entry.ts"), "export const never = 1;");
  fs.unlinkSync(path.join(f.root, "packages/shared/data.ts")); fs.symlinkSync(path.join(outside, "entry.ts"), path.join(f.root, "packages/shared/data.ts"));
  expect(() => f.scan()).toThrow();
});

it("rejects a symlink escaping the file package even when it stays in the repository", () => {
  const f = fixture(); f.write("outside.ts", "export const never = 1;");
  fs.unlinkSync(path.join(f.root, "packages/shared/data.ts")); fs.symlinkSync("../../outside.ts", path.join(f.root, "packages/shared/data.ts")); expect(() => f.scan()).toThrow();
});

it("refuses missing compiled output and source counterparts instead of certifying a partial closure", () => {
  for (const file of ["packages/shared/dist/data.js", "packages/shared/data.ts"]) {
    const f = fixture(); fs.unlinkSync(path.join(f.root, file)); expect(() => f.scan()).toThrow();
  }
});

it.each([
  'export * from "./packages/shared/dist/data.js";export * from "./later";',
  'export * from "./later";export * from "./packages/shared/dist/data.js";',
])("checks every already-seen compiled dependency's source counterpart in either ordering: %s", entry => {
  const f = fixture();
  f.write("entry.ts", entry);
  f.write("later.ts", 'export * from "@fixture/shared/data";');
  // This source entry deliberately does not import the compiled entry's helper:
  // merely revisiting the package export target cannot discover that obligation.
  f.write("packages/shared/data.ts", "export const value = 1;");
  f.write("packages/shared/nested/helper.ts", 'import "node:fs"; export const helper = 1;');
  expect(() => f.scan()).toThrow();
});

it.each([
  'export * from "./packages/shared/dist/data.js";export * from "./later";export * from "./compiled-alias.js";',
  'export * from "./later";export * from "./compiled-alias.js";export * from "./packages/shared/dist/data.js";',
])("bounds real export aliases, physical aliases and source/dist cycles in either ordering: %s", entry => {
  const f = fixture();
  f.write("packages/shared/package.json", JSON.stringify({ ...f.metadata, exports: { ...f.metadata.exports, "./alias": f.metadata.exports["./data"] } }));
  f.write("entry.ts", entry);
  f.write("later.ts", 'export * from "@fixture/shared/data";export * from "@fixture/shared/alias";');
  fs.symlinkSync("packages/shared/dist/data.js", path.join(f.root, "compiled-alias.js"));
  f.write("packages/shared/nested/helper.ts", 'import { z } from "zod"; export { value } from "../data.js"; export const helper = z.string();');
  f.write("packages/shared/dist/nested/helper.js", 'import { z } from "zod"; export { value } from "../data.js"; export const helper = z.string();');
  const result = f.scan();
  expect(result.seen.size).toBe(6);
  expect([...result.bare]).toEqual(["zod"]);
  for (const file of ["data.ts", "nested/helper.ts", "dist/data.js", "dist/nested/helper.js"]) expect(result.seen.has(fs.realpathSync(path.join(f.root, "packages/shared", file)))).toBe(true);
});

it('independent reordered closure must inspect source after compiled file was already seen',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'independent-order-'));
 const write=(n:string,b:string)=>{const p=path.join(root,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b);};
 try {
  write('package.json',JSON.stringify({dependencies:{'@fixture/shared':'file:packages/shared'}}));
  write('packages/shared/package.json',JSON.stringify({name:'@fixture/shared',type:'module',exports:{'./data':{types:'./dist/data.d.ts',default:'./dist/data.js'}}}));
  write('packages/shared/tsconfig.json',JSON.stringify({compilerOptions:{rootDir:'.',outDir:'dist'}}));
  write('packages/shared/data.ts','import "node:fs";export const value=1;');
  write('packages/shared/dist/data.js','export const value=1;');write('packages/shared/dist/data.d.ts','export declare const value:1;');
  write('entry.ts','export * from "./packages/shared/dist/data.js";export * from "./later";');
  write('later.ts','export * from "@fixture/shared/data";');
  fs.mkdirSync(path.join(root,'node_modules/@fixture'),{recursive:true});fs.symlinkSync('../../packages/shared',path.join(root,'node_modules/@fixture/shared'));
  expect(()=>runtimeImportClosure(root,[path.join(root,'entry.ts')])).toThrow();
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});

// Bounded-redesign v1 additions; all preceding source bytes remain unchanged.
function nestedMappingFixture(reversed: boolean) {
  const f = fixture();
  f.write("package.json", JSON.stringify({ dependencies: { "@fixture/a": "file:packages/a", "@fixture/b": "file:packages/a/b" } }));
  f.write("packages/a/package.json", JSON.stringify({ name: "@fixture/a", exports: { "./data": "./b/out/x.js" } }));
  f.write("packages/a/tsconfig.json", JSON.stringify({ compilerOptions: { rootDir: "b/src", outDir: "b/out" } }));
  f.write("packages/a/b/package.json", JSON.stringify({ name: "@fixture/b", exports: { "./data": reversed ? "./src/x.js" : "./other-out/x.js" } }));
  f.write("packages/a/b/tsconfig.json", JSON.stringify({ compilerOptions: { rootDir: reversed ? "out" : "other-src", outDir: reversed ? "src" : "other-out" } }));
  const files = reversed ? ["src/x.js", "src/x.ts", "out/x.js", "out/x.ts"] : ["src/x.ts", "out/x.js", "other-src/x.ts", "other-out/x.js"];
  for (const file of files) f.write(`packages/a/b/${file}`, "export const value = 1;");
  fs.symlinkSync("../../packages/a", path.join(f.root, "node_modules/@fixture/a"));
  fs.symlinkSync("../../packages/a/b", path.join(f.root, "node_modules/@fixture/b"));
  // The walker collects imports in reverse AST order, then pops its queue.
  f.write("entry.ts", (reversed ? 'export * from "./packages/a/b/out/x.ts"; ' : "") + 'export * from "@fixture/a/data"; export * from "@fixture/b/data";');
  return f;
}

it("bounded v1 rejects reversed nested source/output mappings before the dispatch sentinel", () => {
  const f = nestedMappingFixture(true), original = fs.realpathSync;
  let dispatchReads = 0;
  fs.realpathSync = ((...args: Parameters<typeof fs.realpathSync>) => {
    if (++dispatchReads > 160) throw Error("HC01_SENTINEL");
    return Reflect.apply(original, fs, args);
  }) as typeof fs.realpathSync;
  try {
    expect(() => f.scan()).toThrow(/conflicting source\/output mappings/);
    expect(dispatchReads).toBeLessThanOrEqual(160);
  } finally { fs.realpathSync = original; }
});

it("bounded v1 preserves nested disjoint source/output mappings", () => {
  const f = nestedMappingFixture(false), result = f.scan();
  expect(result.seen.size).toBe(5);
  for (const file of ["src/x.ts", "out/x.js", "other-src/x.ts", "other-out/x.js"]) expect(result.seen.has(path.join(f.root, "packages/a/b", file))).toBe(true);
});

it.each([
  ["process constant concatenation", 'const ambient=globalThis["pro"+"cess"];export const value=ambient.env.PRIVATE;'],
  ["fetch parenthesized concatenation", 'const send=globalThis[("fe"+("t"+"ch"))];export const value=()=>send("https://example.invalid");'],
])("bounded v1 refuses %s", (_name, payload) => {
  const f = fixture(); f.write("packages/shared/data.ts", payload);
  expect(() => f.scan()).toThrow(/known ambient capability/);
});

it.each([
  ["global namespace capture", 'const root=globalThis;const ambient=root["process"];export const value=ambient.env.PRIVATE;'],
  ["window namespace capture", 'const root=window;const send=root["fetch"];export const value=()=>send("https://example.invalid");'],
  ["namespace parameter passing", 'const identity=(v:unknown)=>v;export const value=identity(globalThis);'],
  ["namespace object destructuring", 'const {["pro"+"cess"]:ambient}=globalThis;export const value=ambient.env.PRIVATE;'],
  ["namespace array destructuring", 'const [ambient]=globalThis;export const value=ambient;'],
  ["namespace spread", 'export const value={...globalThis};'],
  ["unknown ambient capability key", 'export const value=(key:string)=>globalThis[key];'],
  ["crypto namespace alias", 'const cryptoAlias=globalThis.crypto;export const value=cryptoAlias;'],
  ["subtle namespace alias", 'const subtleAlias=globalThis.crypto.subtle;export const value=subtleAlias;'],
  ["namespace shorthand capture", 'export const value={globalThis};'],
  ["optional root capture", 'export const value=()=>globalThis?.crypto;'],
])("bounded v1 refuses %s", (_name, payload) => {
  const f = fixture(); f.write("packages/shared/data.ts", payload);
  expect(() => f.scan()).toThrow(/known ambient capability/);
});

it("bounded v1 preserves scoped namespace names and data labels", () => {
  const f = fixture();
  f.write("packages/shared/data.ts", 'const window="local";function read(parent:string){return parent+window;}const globalThis={safe:1};export const value={globalThis:globalThis.safe, parent:read("local")};');
  expect(f.scan().seen.has(path.join(f.root, "packages/shared/data.ts"))).toBe(true);
});

it.each(["packages/shared/data.ts", "packages/shared/dist/data.js"])("bounded v1 refuses the exact prototype evaluator in %s", file => {
  const f = fixture();
  f.write(file, 'const make=({}).constructor.constructor;export const value=()=>make("return 1")();');
  expect(() => f.scan()).toThrow(/constructor access/);
});

it("bounded v1 preserves constructor declarations and constructor string data", () => {
  const f = fixture();
  f.write("packages/shared/data.ts", 'class Local { constructor(readonly value:string) {} } const label="constructor";export const value={constructor:label, instance:new Local(label)};');
  expect(f.scan().seen.has(path.join(f.root, "packages/shared/data.ts"))).toBe(true);
});

it.each([
  ["computed constructor evaluator", 'const make=({})["constructor"]["constructor"];export const value=()=>make("return 1")();'],
  ["concatenated constructor evaluator", 'const make=({})["con"+"structor"]["con"+("str"+"uctor")];export const value=()=>make("return 1")();'],
  ["destructured constructor", 'const {constructor:make}={};export const value=()=>make("return 1")();'],
  ["computed destructured constructor", 'const {["con"+"structor"]:make}={};export const value=()=>make("return 1")();'],
  ["direct proto extraction", 'export const value=({}).__proto__;'],
  ["computed proto extraction", 'export const value=({})["__"+"proto__"];'],
  ["unknown destructuring capability key", 'const key=chooseKey();const {[key]:make}={};export const value=()=>make("return 1")();'],
])("bounded v1 refuses %s", (_name, payload) => {
  const f = fixture(); f.write("packages/shared/data.ts", payload);
  expect(() => f.scan()).toThrow(/constructor access|prototype access|unsupported binding key/);
});

it.each([
  ["Object prototype alias", 'const proto=Object.prototype;export const value=proto;'],
  ["computed local prototype alias", 'class Local{}const proto=Local["proto"+"type"];export const value=proto;'],
  ["getPrototypeOf result capture", 'const proto=Object.getPrototypeOf({});export const value=proto;'],
  ["getPrototypeOf method capture", 'const read=Object.getPrototypeOf;export const value=read;'],
  ["writable inspection prototype installation", 'class Vault{}const INSPECT=Symbol.for("nodejs.util.inspect.custom");Object.defineProperty(Vault.prototype,INSPECT,{value:function(){return this.toString();},enumerable:false,writable:true,configurable:false});export const value=1;'],
])("bounded v1 refuses %s", (_name, payload) => {
  const f = fixture(); f.write("packages/shared/data.ts", payload);
  expect(() => f.scan()).toThrow(/prototype access/);
});

const unknownCallableCases = [
  ["direct computed callable", 'const key=chooseKey();export const value=({})[key]("return 1");'],
  ["optional computed callable", 'const key=chooseKey();export const value=({})[key]?.("return 1");'],
  ["computed new alias", 'const key=chooseKey();const make=({})[key];export const value=new make("return 1");'],
  ["computed callable alias", 'const key=chooseKey();const make=({})[key];export const value=()=>make("return 1")();'],
  ["computed callable alias chain", 'const key=chooseKey();const base=({})[key];const make=base;export const value=()=>make("return 1")();'],
  ["computed callable apply alias", 'const key=chooseKey();const make=({})[key];export const value=()=>make.call(null,"return 1");'],
  ["computed reflection method", 'const key=chooseKey();const reflection=Object;export const value=reflection[key]({},"constructor");'],
  ["unknown returned callable", 'export const value=(()=>({})[chooseKey()])()("return 1");'],
] as const;
it.each(unknownCallableCases.flatMap(([name, payload]) => ["packages/shared/data.ts", "packages/shared/dist/data.js"].map(file => [name, file, payload] as const)))("bounded v1 refuses %s in %s", (_name, file, payload) => {
  const f = fixture(); f.write(file, payload);
  expect(() => f.scan()).toThrow(/unsupported callable/);
});

// Pending finite-policy aliases: no implementation beyond the aggregate cap.
it.each([
  ["destructured prototype reflection alias", 'const {getPrototypeOf:read}=Object;export const value=read({});'],
  ["Object root prototype reflection alias", 'const reflection=Object;const read=reflection.getPrototypeOf;export const value=read({});'],
  ["optional prototype reflection alias", 'const read=Object?.getPrototypeOf;export const value=read({});'],
  ["computed prototype reflection capture", 'const read=Object["getPrototypeOf"];export const value=read;'],
])("bounded v1 refuses %s", (_name, payload) => {
  const f = fixture(); f.write("packages/shared/data.ts", payload);
  expect(() => f.scan()).toThrow(/prototype access|unsupported callable/);
});

// Descriptor reflection is admitted for data inspection, not intrinsic capture.
it.each([
  ["descriptor value reflection capture", 'const descriptor=Object.getOwnPropertyDescriptor(Object,"getPrototypeOf");export const value=descriptor.value({});'],
  ["destructured descriptor reflection capture", 'const {getOwnPropertyDescriptor:read}=Object;const descriptor=read(Object,"getPrototypeOf");export const value=descriptor.value({});'],
  ["Object owner descriptor reflection alias", 'const reflection=Object;const read=reflection.getOwnPropertyDescriptor;export const value=read;'],
  ["optional descriptor reflection capture", 'const read=Object?.getOwnPropertyDescriptor;export const value=read;'],
  ["computed descriptor reflection capture", 'const read=Object["getOwnPropertyDescriptor"];export const value=read;'],
  ["plural descriptor reflection capture", 'export const value=Object.getOwnPropertyDescriptors(Object);'],
])("resumed HC02 refuses %s", (_name, payload) => {
  const f = fixture(); f.write("packages/shared/data.ts", payload);
  expect(() => f.scan()).toThrow(/prototype access/);
});

// Erased declarations must not shadow a known ambient root at runtime.
it.each([
  ["declare const", 'declare const globalThis:any;const ambient=globalThis["pro"+"cess"];export const value=ambient.env.PRIVATE;'],
  ["declare let", 'declare let window:any;const ambient=window["pro"+"cess"];export const value=ambient.env.PRIVATE;'],
  ["ambient function", 'declare function globalThis():void;const ambient=globalThis["pro"+"cess"];export const value=ambient.env.PRIVATE;'],
  ["ambient class", 'declare class globalThis{}const ambient=globalThis["pro"+"cess"];export const value=ambient.env.PRIVATE;'],
  ["ambient namespace", 'declare namespace globalThis{const marker:number;}const ambient=globalThis["pro"+"cess"];export const value=ambient.env.PRIVATE;'],
  ["type-only named import", 'import type {Root as globalThis} from "unresolved-type";const ambient=globalThis["pro"+"cess"];export const value=ambient.env.PRIVATE;'],
  ["inline type-only named import", 'import {type Root as globalThis} from "unresolved-type";const ambient=globalThis["pro"+"cess"];export const value=ambient.env.PRIVATE;'],
  ["type-only default import", 'import type globalThis from "unresolved-type";const ambient=globalThis["pro"+"cess"];export const value=ambient.env.PRIVATE;'],
  ["type-only namespace import", 'import type * as globalThis from "unresolved-type";const ambient=globalThis["pro"+"cess"];export const value=ambient.env.PRIVATE;'],
  ["overload without implementation", 'function globalThis():void;const ambient=globalThis["pro"+"cess"];export const value=ambient.env.PRIVATE;'],
  ["interface only", 'interface globalThis{safe:number}const ambient=globalThis["pro"+"cess"];export const value=ambient.env.PRIVATE;'],
  ["type alias only", 'type globalThis={safe:number};const ambient=globalThis["pro"+"cess"];export const value=ambient.env.PRIVATE;'],
])("resumed HC02 refuses erased runtime binding %s", (_name, payload) => {
  const f = fixture(); f.write("packages/shared/data.ts", payload);
  expect(() => f.scan()).toThrow(/known ambient capability/);
});
it.each([
  ["unused ambient declarations", 'declare const globalThis:any;declare let window:any;declare function parent():void;declare class self{}declare namespace top{const marker:number;}export const value=1;'],
  ["unused type-only aliases", 'import type {Root as globalThis} from "unresolved-type";import {type Root as window} from "unresolved-type";export const value=1;'],
  ["overload with runtime body", 'function window():string;function window(){return "local";}export const value=window();'],
  ["value import alias", 'import {z as globalThis} from "zod";export const value=globalThis.string();'],
  ["namespace value import alias", 'import * as window from "zod";export const value=window.z.string();'],
  ["local parameter", 'function read(parent:{safe:number}){return parent.safe;}export const value=read({safe:1});'],
  ["local class", 'class window{}export const value=new window();'],
  ["uninitialized runtime local", 'let window;window="local";export const value=window;'],
  ["runtime namespace", 'namespace globalThis{export const safe=1;}export const value=globalThis.safe;'],
  ["runtime JS local", 'const globalThis={safe:1};export const value=globalThis.safe;'],
])("resumed HC02 preserves actual or unused binding %s", (name, payload) => {
  const f = fixture(); f.write(name === "runtime JS local" ? "packages/shared/dist/data.js" : "packages/shared/data.ts", payload);
  expect(f.scan().seen.size).toBeGreaterThan(0);
});


// Approved finite wrapper/enum pass: all preceding test bytes are retained.
it.each([
  ["stacked satisfies owner", 'const read=(((<any>(Object satisfies any))!) as any).getPrototypeOf;export const value=read({});'],
  ["satisfies optional destructuring owner", 'const reflection=(Object satisfies any)!;const {getPrototypeOf:read}=reflection;export const value=read({});'],
  ["satisfies computed descriptor owner", 'const read=(Object satisfies any)["getOwnPropertyDescriptor"];export const value=read;'],
])("wrapper enum HC02 refuses %s", (_name, payload) => {
  const f = fixture(); f.write("packages/shared/data.ts", payload);
  expect(() => f.scan()).toThrow(/prototype access/);
});
it.each([
  ["erased wrapper family local data", 'const Object={getPrototypeOf:1};export const value=(((<any>(Object satisfies any))!) as any).getPrototypeOf;'],
  ["satisfies guarded prototype contexts", 'const data={};const proto=(Object.getPrototypeOf(data) satisfies unknown);export const value=(proto satisfies unknown)===(Object.prototype satisfies unknown)||(proto satisfies unknown)===null;'],
  ["satisfies readonly descriptor data", 'const data=({safe:1} satisfies {safe:number});const descriptor=Object.getOwnPropertyDescriptor(data,"safe");export const value=descriptor?.value;'],
])("wrapper enum HC02 preserves %s", (_name, payload) => {
  const f = fixture(); f.write("packages/shared/data.ts", payload);
  expect(f.scan().seen.size).toBeGreaterThan(0);
});


// Ordinary emitted enums bind values; erased enum forms cannot hide ambient roots.
it.each([
  ["enum member namespace labels", 'enum Local {window=1,globalThis=window+1}export const value=Local.globalThis;'],
  ["dotted namespace enum", 'namespace globalThis.Local {export enum Mark{safe=1}}export const value=globalThis.Local.Mark.safe;'],
  ["unused erased enum labels", 'const enum globalThis {window=1}export const value=1;'],
  ["namespace Object emitted enum", 'namespace Object {export enum Mark{getPrototypeOf=1}}export const value=Object.Mark.getPrototypeOf;'],
])("wrapper enum HC02 preserves emitted binding %s", (_name, payload) => {
  const f = fixture(); f.write("packages/shared/data.ts", payload);
  expect(f.scan().seen.size).toBeGreaterThan(0);
});
it.each([
  ["declare enum", 'declare enum globalThis{safe=1}const ambient=globalThis["pro"+"cess"];export const value=ambient.env.PRIVATE;'],
  ["const enum", 'const enum globalThis{safe=1}const ambient=globalThis["pro"+"cess"];export const value=ambient.env.PRIVATE;'],
  ["namespace const enum only", 'namespace globalThis{export const enum Mark{safe=1}}const ambient=globalThis["pro"+"cess"];export const value=ambient.env.PRIVATE;'],
  ["namespace declare enum only", 'namespace globalThis{export declare enum Mark{safe=1}}const ambient=globalThis["pro"+"cess"];export const value=ambient.env.PRIVATE;'],
  ["ambient namespace enum ancestor", 'declare namespace globalThis{export namespace Nested{export enum Mark{safe=1}}}const ambient=globalThis["pro"+"cess"];export const value=ambient.env.PRIVATE;'],
  ["declare Object enum reflection", 'declare enum Object{getPrototypeOf=1}const read=Object.getPrototypeOf;export const value=read;'],
  ["const Object enum reflection", 'const enum Object{getPrototypeOf=1}const read=Object.getPrototypeOf;export const value=read;'],
])("wrapper enum HC02 refuses erased enum binding %s", (_name, payload) => {
  const f = fixture(); f.write("packages/shared/data.ts", payload);
  expect(() => f.scan()).toThrow(/known ambient capability|prototype access/);
});
