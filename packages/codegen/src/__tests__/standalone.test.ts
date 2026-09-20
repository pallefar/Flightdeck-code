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

  it("⭐ every CSS VARIABLE the page reads is defined by the stylesheet", () => {
    // THE TEST THAT WAS MISSING, AND THE ONE THAT MATTERED MOST.
    //
    // The class-coverage test above passed while five of the page's nine
    // colour tokens were undefined: `--muted`, `--te`, `--amber`, `--green`
    // and `--red`. Every one resolved to its INLINE FALLBACK instead — and
    // those fallbacks are the host's DARK palette, so #8b96a5 labels sat on a
    // #f7f8fa page at about 2.9:1. The page's form labels and step numbers
    // were the least legible text on it.
    //
    // A stylesheet can satisfy every SELECTOR the page uses and still not give
    // it one correct colour. Classes and custom properties are two different
    // contracts, and only one of them was being checked.
    const page = host.find((f) => f.kind === "web-module");
    const theme = harness.find((f) => f.path === "standalone/theme.css");
    expect(page).toBeDefined();
    expect(theme).toBeDefined();
    if (page === undefined || theme === undefined) return;

    const read = new Set<string>();
    for (const match of page.contents.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
      const name = match[1] as string;
      // `--token` is the literal placeholder in the emitter's own prose.
      if (name !== "--token") read.add(name);
    }
    expect(read.size).toBeGreaterThan(4); // else the regex stopped matching

    const declared = new Set<string>();
    for (const match of theme.contents.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) {
      declared.add(match[1] as string);
    }

    const undeclared = [...read].filter((name) => !declared.has(name)).sort();
    expect(undeclared, "the page reads tokens the standalone theme never defines").toEqual([]);
  });

  it("the tokens are ALIASED to the harness's own, so dark mode follows them", () => {
    // Copying the literals would have produced a second palette that silently
    // stops tracking the first the next time somebody edits one of them.
    // Aliasing means the `prefers-color-scheme: dark` override of
    // `--muted-ink` reaches `--muted` with no second declaration.
    const theme = harness.find((f) => f.path === "standalone/theme.css");
    expect(theme?.contents).toContain("--muted: var(--muted-ink)");
    expect(theme?.contents).toContain("--te: var(--accent)");
  });

  it("⭐ the bare ELEMENTS the page renders are styled, not just its classes", () => {
    // The page's forms are plain <input>, <select> and <button> with no
    // className between them and the UA default. Same blind spot as the
    // tokens: "is every className covered?" cannot ask this question.
    const page = host.find((f) => f.kind === "web-module");
    const theme = harness.find((f) => f.path === "standalone/theme.css");
    if (page === undefined || theme === undefined) return;

    // The INTERACTIVE elements only. A <table> inherits its colours and is
    // fine unpainted — its real defect is overflow, which has its own test
    // below. These three are the ones that arrive as OS widgets if nothing
    // claims them, which is the failure visible in the dark-mode screenshots.
    const needed: string[] = [];
    if (/<input\b/.test(page.contents)) needed.push("input");
    if (/<select\b/.test(page.contents)) needed.push("select");
    if (/<button\b/.test(page.contents)) needed.push("button");
    expect(needed.length).toBeGreaterThan(0);

    // ⚠ "IS THE ELEMENT MENTIONED" IS NOT THE QUESTION. The first version of
    // this loop asked exactly that, and passed with every text-input rule
    // DELETED — because `input[type="checkbox"]` and `input:focus-visible`
    // still mention `input`. A UA-default text field on a dark card would have
    // sailed through the check written to catch it.
    //
    // What actually goes wrong is a control keeping the BROWSER's colours, so
    // the check is: some rule matching this element must set both a background
    // and a colour. That is the difference between styled and merely named.
    const rules = theme.contents
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("}")
      .map((chunk) => {
        const at = chunk.indexOf("{");
        return at === -1 ? null : { selector: chunk.slice(0, at), body: chunk.slice(at + 1) };
      })
      .filter((r): r is { selector: string; body: string } => r !== null);

    for (const element of needed) {
      const selects = new RegExp(`(^|[,\\s>])${element}\\b(?![-\\w])`, "m");
      const painted = rules.filter(
        (r) => selects.test(r.selector) && /background\s*:/.test(r.body) && /(^|[;\s])color\s*:/.test(r.body),
      );
      expect(
        painted.length,
        `<${element}> keeps the browser's own colours — no rule matching it sets both background and color`,
      ).toBeGreaterThan(0);
    }

    // And a focus style, because nothing in the page defines one.
    expect(theme.contents).toContain(":focus-visible");
  });

  it("long unbreakable strings cannot force a table past its card", () => {
    // Every app renders a table and one of its columns is an absolute
    // filesystem path. At 390px all three burst their card and scrolled the
    // page sideways. `anywhere` is load-bearing: `break-word` does NOT reduce
    // the intrinsic min-content width, so `width: 100%` keeps losing.
    const theme = harness.find((f) => f.path === "standalone/theme.css");
    // ⚠ COMMENTS STRIPPED FIRST. This assertion failed on a correct stylesheet
    // because the RULE's own comment says "AND NOT `table-layout: fixed`" and
    // the test was reading the prose. That is the third time this session a
    // check of mine has matched the explanation instead of the code; the shape
    // is always the same, and so is the fix.
    const css = (theme?.contents ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).not.toMatch(/table-layout:\s*fixed/);
    expect(css).toMatch(/@media\s*\(max-width/);
  });

  it("the standalone bar does not reprint the app's own title", () => {
    const main = harness.find((f) => f.path === "standalone/main.tsx");
    expect(main).toBeDefined();
    if (main === undefined) return;
    // The page renders its icon and title ~70px below this bar.
    expect(main.contents).not.toContain("standalone-mark\">${plan.manifestData.icon}");
    expect(main.contents).toContain("no RBAC, no kill switch, no audit chain");
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
