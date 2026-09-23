/** Red-team the gate: take REAL generator output, plant one violation at a
 * time, and demand the gate BLOCKS each. A gate that only passes clean
 * input proves nothing. Severity matters: FD-X001 (registry.ts not yet
 * edited) is a warning the clean output legitimately carries, so a catch
 * means a NEW BLOCKING finding, not merely one more line in the report. */
import { generateSubApp } from "../packages/codegen/src/generate";
import { wcClockSpec } from "../packages/codegen/src/fixtures/specs";
import { runConformanceGate } from "../packages/conformance/src/gate";

const g: any = generateSubApp(wcClockSpec as any);
const files: Record<string, string> = {};
for (const f of g.files) files[f.path] = f.contents;
const cand = (m: Record<string, string>) => ({ files: Object.entries(m).map(([path, contents]) => ({ path, contents })) });
const blocking = (r: any) => r.findings.filter((f: any) => f.severity !== "warning");

const base: any = runConformanceGate(cand(files) as any);
console.log(`baseline: ${base.ok === false ? "BLOCKED" : "PASS"} — ${blocking(base).length} blocking, ${base.findings.length - blocking(base).length} warning\n`);

const route = Object.keys(files).find((p) => /routes\/(?!index)/.test(p))!;
const guard = Object.keys(files).find((p) => /guard\.ts$/.test(p))!;
const man = Object.keys(files).find((p) => /manifest\.ts$/.test(p))!;
const schema = Object.keys(files).find((p) => /schema\.ts$/.test(p))!;
// wcClockSpec is the table-backed fixture: its schema.ts holds the DDL and
// the first route holds the queries. Drop the `subapp_` from the prefix in
// both, as an emitter that got the prefix wrong would.
const unprefix = (src: string) => src.split("subapp_wc_clock_").join("wc_clock_");
const contributions =
  `  contributions: {\n` +
  `    stateFlags: () => ({ esign: { enabled: true } }),\n` +
  `    ticketSigning: async (db, root, ticket) => ({ status: "signed", signedCount: 1, totalCount: 1 }),\n` +
  `  },\n`;

// [name, mutated files, rules that MUST be among the blocking findings]
const ATTACKS: Array<[string, Record<string, string>, string[]]> = [
  ["capability escape — node:fs in a route", { ...files, [route]: 'import fs from "node:fs";\n' + files[route]! }, ["FD-C001"]],
  ["sibling import — ../registry.js from guard", { ...files, [guard]: files[guard]!.replace('from "../installRow.js"', 'from "../registry.js"') }, ["FD-I002"]],
  ["routePrefix with two segments", { ...files, [man]: files[man]!.replace('"/api/apps/wc-clock"', '"/api/apps/wc-clock/v2"') }, ["FD-M003"]],
  ["empty visibleToRoles", { ...files, [man]: files[man]!.replace(/visibleToRoles: \[[^\]]*\]/, "visibleToRoles: []") }, ["FD-M003"]],
  ["minHostVersion above the ceiling", { ...files, [man]: files[man]!.replace('minHostVersion: "5.0.0"', 'minHostVersion: "9.9.9"') }, ["FD-M004"]],
  ["guard bypassed in a handler", { ...files, [route]: files[route]!.replace(/await requireWcClockEnabled\(req\)/g, "req.workspace") }, ["FD-G001"]],
  ["capabilities widened past the enum", { ...files, [man]: files[man]!.replace('capabilities: ["read:contracts", "write:inbox-proposal"]', 'capabilities: ["read:contracts", "admin:everything"]') }, ["FD-M003"]],
  ["table prefix not subapp_<id>_", { ...files, [schema]: unprefix(files[schema]!), [route]: unprefix(files[route]!) }, ["FD-S001", "FD-S002"]],
  ["host-surface contributions in the manifest", { ...files, [man]: files[man]!.replace(/\n};\s*$/, `\n${contributions}};\n`) }, ["FD-M008"]],
];

let caught = 0, real = 0;
for (const [name, mutated, expected] of ATTACKS) {
  if (mutated === files || JSON.stringify(mutated) === JSON.stringify(files)) { console.log(`  SKIP    ${name} (mutation was a no-op — not a real test)`); continue; }
  real++;
  let r: any;
  try { r = runConformanceGate(cand(mutated) as any); } catch (e) { console.log(`  THREW   ${name}`); continue; }
  const nb = blocking(r);
  // Blocked for the RIGHT reason: a new blocking finding that includes every
  // rule this case plants. Blocking on something else is not a catch.
  const absent = expected.filter((rule) => !nb.some((f: any) => f.rule === rule));
  const hit = nb.length > blocking(base).length && absent.length === 0;
  if (hit) caught++;
  console.log(`  ${hit ? "BLOCKED" : "MISSED "} ${name}${hit ? `  -> ${nb.map((f: any) => f.rule).join(", ")}` : absent.length ? `  (no ${absent.join(", ")})` : ""}`);
}
console.log(`\n${caught}/${real} planted violations produced a BLOCKING finding`);
