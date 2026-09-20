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

const ATTACKS: Array<[string, Record<string, string>]> = [
  ["capability escape — node:fs in a route", { ...files, [route]: 'import fs from "node:fs";\n' + files[route]! }],
  ["sibling import — ../registry.js from guard", { ...files, [guard]: files[guard]!.replace('from "../installRow.js"', 'from "../registry.js"') }],
  ["routePrefix with two segments", { ...files, [man]: files[man]!.replace('"/api/apps/wc-clock"', '"/api/apps/wc-clock/v2"') }],
  ["empty visibleToRoles", { ...files, [man]: files[man]!.replace(/visibleToRoles: \[[^\]]*\]/, "visibleToRoles: []") }],
  ["minHostVersion above the ceiling", { ...files, [man]: files[man]!.replace('minHostVersion: "5.0.0"', 'minHostVersion: "9.9.9"') }],
  ["guard bypassed in a handler", { ...files, [route]: files[route]!.replace(/await requireWcClockEnabled\(req\)/g, "req.workspace") }],
  ["capabilities widened past the enum", { ...files, [man]: files[man]!.replace('capabilities: ["read:contracts", "write:inbox-proposal"]', 'capabilities: ["read:contracts", "admin:everything"]') }],
  ["table prefix not subapp_<id>_", { ...files, [man]: files[man]! }],
];

let caught = 0, real = 0;
for (const [name, mutated] of ATTACKS) {
  if (mutated === files || JSON.stringify(mutated) === JSON.stringify(files)) { console.log(`  SKIP    ${name} (mutation was a no-op — not a real test)`); continue; }
  real++;
  let r: any;
  try { r = runConformanceGate(cand(mutated) as any); } catch (e) { console.log(`  THREW   ${name}`); continue; }
  const nb = blocking(r);
  const hit = nb.length > blocking(base).length;
  if (hit) caught++;
  console.log(`  ${hit ? "BLOCKED" : "MISSED "} ${name}${hit ? `  -> ${nb.map((f: any) => f.rule).join(", ")}` : ""}`);
}
console.log(`\n${caught}/${real} planted violations produced a BLOCKING finding`);
