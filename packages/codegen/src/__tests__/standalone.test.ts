/**
 * ⭐ EVERY SUB-APP ALSO RUNS STANDALONE, AND THIS IS WHERE THAT IS TRUE OR NOT.
 *
 * The harness was built by supplying what the sub-app imports. The first
 * attempt supplied two type-only imports and stopped, because reading the
 * emitted page suggested that was the whole coupling. It was not. Booting it
 * found `../../capabilities.js`, then `../../lib/flightdeckAudit.js`, then
 * `../installRow.js`, `../killSwitch.js`, `../../project/types.js` and
 * `../../workspace/types.js` — four rounds of MODULE_NOT_FOUND, each one a gap
 * that reading had missed.
 *
 * So the coverage test below does not check a list somebody maintains. It
 * reads the imports the emitted files ACTUALLY contain and requires each one
 * to resolve inside the standalone tree. A new emitter that reaches for a
 * seventh host module fails here, at generate time, instead of at somebody
 * else's `npm run dev`.
 */
import { describe, expect, it } from "vitest";
import { generateSubApp } from "../generate";
import { stripComments } from "../invariants";
import { CHIP_TONES, HOST_CLASS_NAMES } from "../emitters/standalone";
import { contractRunSpec, minimalSpec, registryFixture, wcClockSpec } from "../fixtures/specs";

const apps = [
  { name: "contract-run", app: generateSubApp(contractRunSpec, { registrySource: registryFixture }) },
  { name: "wc-clock", app: generateSubApp(wcClockSpec, { registrySource: registryFixture }) },
  { name: "shift-notes", app: generateSubApp(minimalSpec) },
];

/** `a/b/../c` -> `a/c`, so an import can be resolved against the tree. */
function normalise(p: string): string {
  const out: string[] = [];
  for (const segment of p.split("/")) {
    if (segment === "..") out.pop();
    else if (segment !== "." && segment !== "") out.push(segment);
  }
  return out.join("/");
}

const IMPORT_RE = /^\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?)\s*from\s+"([^"]+)";?\s*$/gm;

describe.each(apps)("$name runs standalone", ({ app }) => {
  const host = app.files.filter((f) => f.kind !== "standalone" && f.kind !== "patch");
  const harness = app.files.filter((f) => f.kind === "standalone");
  const treePaths = new Set([...host, ...harness].map((f) => f.path));

  it("emits a harness at all", () => {
    expect(harness.length).toBeGreaterThanOrEqual(10);
    for (const needed of ["standalone/server.ts", "standalone/main.tsx", "standalone/package.json"]) {
      expect(harness.map((f) => f.path)).toContain(needed);
    }
  });

  it("⭐ every relative import in every emitted file resolves inside the standalone tree", () => {
    // THE TEST THAT WOULD HAVE FOUND ALL FOUR MISSING SHIMS IN ONE RUN.
    const missing: string[] = [];
    for (const file of [...host, ...harness]) {
      const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
      IMPORT_RE.lastIndex = 0;
      for (const match of file.contents.matchAll(IMPORT_RE)) {
        const specifier = match[1] as string;
        if (!specifier.startsWith(".")) continue; // a package, npm's problem
        const resolved = normalise(`${dir}/${specifier}`).replace(/\.js$/, "");
        const found = [resolved, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}/index.ts`, `${resolved}/index.tsx`]
          .some((candidate) => treePaths.has(candidate));
        if (!found) missing.push(`${file.path} imports "${specifier}" -> ${resolved}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("⭐ the sub-app's OWN files are byte-identical in both modes", () => {
    // There is one copy, emitted once, written to both roots. If this ever
    // needed a diff, "standalone" would mean a second app that drifts — which
    // is the thing the whole harness exists NOT to be.
    const harnessPaths = new Set(harness.map((f) => f.path));
    for (const file of host) {
      // No host file may be shadowed by a harness file of the same path.
      expect(harnessPaths.has(file.path), `${file.path} is emitted twice`).toBe(false);
    }
    // And the harness supplies only files the host tree does NOT contain.
    for (const file of harness) {
      expect(host.some((h) => h.path === file.path)).toBe(false);
    }
  });

  it("⭐ the stylesheet covers every class the page actually renders", () => {
    // Extracted from the emitted page, not from memory of it.
    const page = host.find((f) => f.kind === "web-module");
    expect(page).toBeDefined();
    if (page === undefined) return;
    const theme = harness.find((f) => f.path === "standalone/theme.css");
    expect(theme).toBeDefined();
    if (theme === undefined) return;

    const used = new Set<string>();
    for (const match of page.contents.matchAll(/className="([^"]*)"/g)) {
      for (const cls of (match[1] as string).split(/\s+/)) if (cls !== "") used.add(cls);
    }
    // The dynamic one: `className={tone ? "chip " + tone : "chip"}`.
    for (const match of page.contents.matchAll(/className=\{[^}]*"([a-z-]+)\s*"/g)) {
      used.add((match[1] as string).trim());
    }

    const uncovered = [...used].filter((cls) => !theme.contents.includes(`.${cls}`));
    expect(uncovered, `page renders classes the standalone theme does not define`).toEqual([]);

    // And the constant the emitter advertises must not drift from the page.
    const notAdvertised = [...used].filter((cls) => !HOST_CLASS_NAMES.includes(cls));
    expect(notAdvertised).toEqual([]);
    for (const tone of CHIP_TONES) expect(theme.contents).toContain(`.chip.${tone}`);
  });

  it("the guard's enablement gate is still in the standalone tree, not stubbed out", () => {
    const installRow = harness.find((f) => f.path.endsWith("server/subapps/installRow.ts"));
    expect(installRow).toBeDefined();
    if (installRow === undefined) return;
    // ⛔ THE TEMPTING SHIM IS `enabled: true`. It deletes the gate rather than
    // standing in for it, and an app developed against a deleted gate meets
    // the real one for the first time in production.
    // ⚠ STRIPPED FIRST. The first version of this assertion matched the shim's
    // OWN comment — "the tempting shim is `enabled: true`" — and failed a file
    // that was correct. A check that reads prose is checking the wrong text.
    expect(stripComments(installRow.contents)).not.toMatch(/enabled:\s*true/);
    expect(installRow.contents).toContain("subAppKillSwitchEnabled");
    expect(installRow.contents).toContain("ceilingEnabled: false");
    expect(installRow.contents).toContain("projectConsented: false");
    expect(installRow.contents).toContain("absentLayers");
  });

  it("the local adapter throws the error the ROUTES catch, so a refusal is a 403 in both modes", () => {
    const caps = harness.find((f) => f.path === "standalone/capabilities.ts");
    expect(caps).toBeDefined();
    if (caps === undefined) return;
    // Every emitted route does `err instanceof CapabilityDeniedError` and
    // answers 403; an unrelated class falls through to the rethrow and becomes
    // a 500 in standalone only.
    expect(caps.contents).toContain("extends CapabilityDeniedError");
    // Not every profile's routes reach a capability — the table path talks to
    // its own tables. Where they DO, the mapping must match; where they do
    // not, requiring it would be asserting a coincidence.
    const domains = host.filter((f) => f.kind === "routes-domain");
    const mapping = domains.filter((f) => f.contents.includes("CapabilityDeniedError"));
    for (const file of mapping) expect(file.contents).toContain("capability_denied");
  });

  it("the harness says what it does NOT provide, where somebody will read it", () => {
    const readme = harness.find((f) => f.path === "standalone/README.md");
    expect(readme).toBeDefined();
    if (readme === undefined) return;
    for (const absent of ["RBAC", "Kill switch", "Audit", "Inbox"]) {
      expect(readme.contents).toContain(absent);
    }
    // And the server refuses to start without the operator saying so.
    const server = harness.find((f) => f.path === "standalone/server.ts");
    expect(server?.contents).toContain("allowAnonymous");
  });
});
