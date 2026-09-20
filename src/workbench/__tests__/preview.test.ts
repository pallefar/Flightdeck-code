import { describe, expect, it } from "vitest";
import { MockCapabilityHost, bodySchema, routeKey, scanScopes } from "../preview/adapter";
import { RUNTIME_MARKERS, parseLiteralAfter, readWebModule } from "../preview/descriptor";
import { buildLedger } from "../preview/fidelity";
import { BLOCKING_RULES, attach, buildPreview, findingsFor, isReady } from "../preview/state";
import { ALL_ENABLED, type EnableLayers } from "../types";
import { candidate, fixture, finding, wcClockFiles } from "./fixtures";

const WEB = fixture("wc-clock.web-module.txt");

// ─────────────────────── the literal parser ──────────────────────────────

describe("parseLiteralAfter", () => {
  it("reads the emitter's grammar: bare keys, trailing commas, comments", () => {
    const src = `const X = [
      // a comment the emitter writes
      { id: "one", n: -2.5, ok: true, nothing: null, list: ["a", "b",], },
    ];`;
    expect(parseLiteralAfter(src, "const X =")).toEqual([
      { id: "one", n: -2.5, ok: true, nothing: null, list: ["a", "b"] },
    ]);
  });

  it("resolves the escapes JSON.stringify produces, which is how the emitter writes strings", () => {
    const src = 'const X = "line\\nbreak \\" quote \\u00e9";';
    expect(parseLiteralAfter(src, "const X =")).toBe('line\nbreak " quote é');
  });

  it("refuses an expression instead of silently accepting it", () => {
    // Anything but a literal means the file did not come from this
    // emitter — which is the `renderer-drift` answer, not a value to guess.
    expect(() => parseLiteralAfter("const X = compute();", "const X =")).toThrow();
    expect(() => parseLiteralAfter("const Y = 1;", "const X =")).toThrow(/no .*const X/);
  });

  it("never evaluates what it reads", () => {
    // The whole security position: `index.tsx` is text a model wrote. If
    // this parser ran it, a generated page would execute in Studio's own
    // origin. A payload that would throw if executed must parse to inert
    // data or be refused — never run.
    const hostile = 'const X = { id: "ok" };';
    expect(parseLiteralAfter(hostile, "const X =")).toEqual({ id: "ok" });
    expect(() => parseLiteralAfter('const X = (() => { throw 1 })();', "const X =")).toThrow();
  });
});

// ──────────────────── reading the real generated page ────────────────────

describe("readWebModule, against real generator output", () => {
  it("reads the panels, forms and fields the emitter actually wrote", () => {
    const read = readWebModule(WEB);
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    expect(read.module.routePrefix).toBe("/api/apps/wc-clock");
    expect(read.module.title).toBe("Works Council Clock");
    expect(read.module.panels.map((p) => p.id)).toEqual(["clocks", "review"]);

    const clocks = read.module.panels[0];
    expect(clocks?.list?.path).toBe("/clocks");
    expect(clocks?.forms[0]).toMatchObject({ method: "POST", path: "/clocks" });
    expect(clocks?.forms[0]?.fields.map((f) => `${f.name}:${f.control}`)).toEqual([
      "ticket:text",
      "startedAt:text",
      "state:select",
      "days:number",
      "statutory:checkbox",
      "note:text",
    ]);
    // `optional` has to survive, or the preview's Zod schema requires a
    // field the real route does not.
    expect(clocks?.forms[0]?.fields.find((f) => f.name === "note")?.optional).toBe(true);
    expect(clocks?.forms[0]?.fields.find((f) => f.name === "state")?.options).toBeTruthy();
  });

  it("refuses with renderer-drift when a behaviour the mirror copies is gone", () => {
    // This is the check that stops the mirror silently showing last
    // month's behaviour after the emitter changes.
    const drifted = WEB.replace('r.status === 403 && r.code === "capability_denied"', "false");
    const read = readWebModule(drifted);
    expect(read.ok).toBe(false);
    if (read.ok || read.reason !== "renderer-drift") throw new Error("expected drift");
    expect(read.missing).toContain("refusal-capability");
  });

  it("checks drift BEFORE parsing, so a parsable PANELS cannot mask it", () => {
    const drifted = WEB.replace("class ApiRefusal", "class SomethingElse");
    const read = readWebModule(drifted);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toBe("renderer-drift");
  });

  it("reports unparsable separately from drift", () => {
    const broken = WEB.replace("const PANELS: PanelDescriptor[] = [", "const PANELS: PanelDescriptor[] = [ {{{");
    const read = readWebModule(broken);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toBe("unparsable");
  });

  it("every marker it claims is genuinely present in real output", () => {
    // Guards against a marker that is aspirational — one that would make
    // the drift check fire on every healthy file.
    for (const marker of RUNTIME_MARKERS) {
      expect(WEB.includes(marker.needle), `${marker.id}: ${marker.needle}`).toBe(true);
    }
  });
});

// ─────────────────────────── scope scanning ──────────────────────────────

describe("scanScopes, against real generator output", () => {
  const sources = wcClockFiles()
    .filter((f) => f.kind === "routes-domain" || f.kind === "routes-index")
    .map((f) => f.contents);

  it("reads each route's capability from the server source", () => {
    const scopes = scanScopes(sources, "/api/apps/wc-clock");
    expect(scopes.get(routeKey("GET", "/contracts"))).toBe("read:contracts");
    expect(scopes.get(routeKey("POST", "/flag"))).toBe("write:inbox-proposal");
  });

  it("inverts the naive method heuristic, which is why it scans at all", () => {
    const scopes = scanScopes(sources, "/api/apps/wc-clock");
    // A POST into the sub-app's OWN table needs no capability…
    expect(scopes.get(routeKey("POST", "/clocks"))).toBeNull();
    // …while a GET that lists contracts needs one. "GET reads, POST
    // writes" would show a refusal on the first and miss the second —
    // exactly inverting the §9 least-privilege question.
    expect(scopes.get(routeKey("GET", "/contracts"))).toBe("read:contracts");
  });

  it("returns an empty map rather than guessing when it can read nothing", () => {
    expect(scanScopes(["// hand-written, no registrations"], "/api/apps/x").size).toBe(0);
  });
});

// ──────────────────────── the capability adapter ─────────────────────────

function host(layers: () => EnableLayers, capabilities = ["read:contracts", "write:inbox-proposal"]) {
  const read = readWebModule(WEB);
  if (!read.ok) throw new Error("fixture no longer readable");
  const sources = wcClockFiles()
    .filter((f) => f.kind === "routes-domain")
    .map((f) => f.contents);
  return new MockCapabilityHost({
    subAppId: "wc-clock",
    capabilities,
    panels: read.module.panels,
    scopes: scanScopes(sources, read.module.routePrefix),
    layers,
  });
}

describe("enable-state, contract §4", () => {
  it("serves a route when all three layers are on", () => {
    expect(host(() => ALL_ENABLED).handle({ method: "GET", path: "/clocks" }).status).toBe(200);
  });

  it.each([["killSwitch"], ["ceiling"], ["project"]] as const)(
    "refuses with subapp_disabled when %s alone is off",
    (layer) => {
      const h = host(() => ({ ...ALL_ENABLED, [layer]: false }));
      const res = h.handle({ method: "GET", path: "/clocks" });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "subapp_disabled" });
    },
  );

  it("guards BEFORE the route table, so a disabled app does not admit which routes exist", () => {
    const h = host(() => ({ ...ALL_ENABLED, project: false }));
    // An unknown path would be a 404 if routing came first. Guard first
    // (§5.1) means it is a 403, same as any other path.
    expect(h.handle({ method: "GET", path: "/does-not-exist" }).status).toBe(403);
  });

  it("re-reads the layers on every call and never caches them (§5.2)", () => {
    let enabled = true;
    const h = host(() => ({ ...ALL_ENABLED, killSwitch: enabled }));
    expect(h.handle({ method: "GET", path: "/clocks" }).status).toBe(200);
    enabled = false;
    // No remount, no new adapter — the very next request must refuse.
    expect(h.handle({ method: "GET", path: "/clocks" }).status).toBe(403);
    enabled = true;
    expect(h.handle({ method: "GET", path: "/clocks" }).status).toBe(200);
  });
});

describe("capabilities, contract §9 and §4", () => {
  it("denies a scope the manifest does not declare, and names it", () => {
    const h = host(() => ALL_ENABLED, []);
    const res = h.handle({ method: "GET", path: "/contracts" });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "capability_denied", scope: "read:contracts" });
  });

  it("still serves routes that need no capability", () => {
    const h = host(() => ALL_ENABLED, []);
    expect(h.handle({ method: "GET", path: "/clocks" }).status).toBe(200);
  });

  it("takes granted scopes ONLY from the ceiling row", () => {
    // §4: a project row may turn a sub-app off, never widen consent — and
    // the ceiling is the only source of scopes. With the ceiling off the
    // app is disabled outright, so the refusal is the disable, not the
    // scope; the scope path is what the pane explains.
    const h = host(() => ({ ...ALL_ENABLED, ceiling: false }));
    expect(h.handle({ method: "GET", path: "/contracts" }).body).toMatchObject({
      code: "subapp_disabled",
    });
  });
});

describe("Zod at the boundary, contract §5.6", () => {
  it("refuses a blank required field with real Zod issues", () => {
    const h = host(() => ALL_ENABLED);
    const res = h.handle({ method: "POST", path: "/clocks", body: { ticket: "" } });
    expect(res.status).toBe(400);
    const body = res.body as { issues: Array<{ path: string[]; message: string }> };
    expect(body.issues.some((i) => i.path[0] === "ticket")).toBe(true);
  });

  it("is strict — an unknown key is a silent widening and must refuse", () => {
    const h = host(() => ALL_ENABLED);
    const res = h.handle({
      method: "POST",
      path: "/flag",
      body: { ticket: "T-1", note: "x", isAdmin: true },
    });
    expect(res.status).toBe(400);
  });

  it("accepts a well-formed body", () => {
    const h = host(() => ALL_ENABLED);
    const res = h.handle({
      method: "POST",
      path: "/clocks",
      body: { ticket: "T-1", startedAt: "2026-01-01", state: "running", days: 30, statutory: true },
    });
    expect(res.status).toBe(200);
  });

  it("checks the body AFTER the guard, never before (§5.1)", () => {
    const h = host(() => ({ ...ALL_ENABLED, killSwitch: false }));
    // A malformed body on a disabled app must still be a 403. A 400 here
    // would mean the handler parsed input before checking enable-state.
    expect(h.handle({ method: "POST", path: "/clocks", body: { nope: 1 } }).status).toBe(403);
  });
});

describe("bodySchema", () => {
  it("makes an empty string fail a required text field", () => {
    // The generated page posts "" for a blank required field, so this is
    // what turns an empty form into the server's real 400.
    expect(bodySchema([{ name: "a", label: "A", control: "text", options: null, optional: false }])
      .safeParse({ a: "" }).success).toBe(false);
    expect(bodySchema([{ name: "a", label: "A", control: "text", options: null, optional: true }])
      .safeParse({}).success).toBe(true);
  });

  it("enforces enum options", () => {
    const schema = bodySchema([
      { name: "s", label: "S", control: "select", options: ["a", "b"], optional: false },
    ]);
    expect(schema.safeParse({ s: "a" }).success).toBe(true);
    expect(schema.safeParse({ s: "z" }).success).toBe(false);
  });

  it("does not crash on a select with no options", () => {
    expect(bodySchema([{ name: "s", label: "S", control: "select", options: [], optional: true }])
      .safeParse({}).success).toBe(true);
  });
});

describe("propose, don't mutate — contract §7 and §8", () => {
  it("routes a write capability into memory/proposals/ and advances nothing", () => {
    const h = host(() => ALL_ENABLED);
    const res = h.handle({ method: "POST", path: "/flag", body: { ticket: "T-9", note: "please look" } });
    expect(res.status).toBe(200);

    const { proposals } = h.snapshot();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.path.startsWith("memory/proposals/")).toBe(true);
  });

  it("audits field NAMES and never a submitted value", () => {
    const h = host(() => ALL_ENABLED);
    h.handle({ method: "POST", path: "/flag", body: { ticket: "T-9", note: "Anna Schmidt, 1981-03-02" } });

    const { audit } = h.snapshot();
    expect(audit[0]?.fields).toContain("note");
    // §8 checked rather than asserted: the PII value must not be in the
    // event. `leak` is how the inspector would surface it if it were.
    expect(audit[0]?.leak).toBeNull();
    expect(JSON.stringify(audit)).not.toContain("Anna Schmidt");
  });

  it("logs every request with the reason, in the contract's language", () => {
    const h = host(() => ({ ...ALL_ENABLED, project: false }));
    h.handle({ method: "GET", path: "/clocks" });
    const entry = h.snapshot().log[0];
    expect(entry).toMatchObject({ status: 403, code: "subapp_disabled" });
    expect(entry?.why).toMatch(/install row/);
  });
});

describe("fabricated rows", () => {
  it("are deterministic, so two rounds can be compared without mock noise", () => {
    const a = host(() => ALL_ENABLED).handle({ method: "GET", path: "/clocks" });
    const b = host(() => ALL_ENABLED).handle({ method: "GET", path: "/clocks" });
    expect(a.body).toEqual(b.body);
  });

  it("carry the real column names even though every cell is invented", () => {
    const res = host(() => ALL_ENABLED).handle({ method: "GET", path: "/clocks" });
    const rows = (res.body as { rows: Array<Record<string, unknown>> }).rows;
    expect(Object.keys(rows[0] ?? {})).toEqual(
      expect.arrayContaining(["ticket", "startedAt", "state", "days", "statutory"]),
    );
  });

  it("show a row that was just submitted, so a form round-trip is visible", () => {
    const h = host(() => ALL_ENABLED);
    h.handle({
      method: "POST",
      path: "/clocks",
      body: { ticket: "T-NEW", startedAt: "2026-01-01", state: "running", days: 1, statutory: false },
    });
    const rows = (h.handle({ method: "GET", path: "/clocks" }).body as { rows: Array<Record<string, unknown>> }).rows;
    expect(rows[0]?.ticket).toBe("T-NEW");
  });
});

// ───────────────────────── the preview ladder ────────────────────────────

describe("buildPreview", () => {
  const layers = () => ALL_ENABLED;

  it("is ready for a healthy candidate", () => {
    const state = buildPreview({ candidate: candidate(), layers });
    expect(isReady(state)).toBe(true);
    if (isReady(state)) {
      expect(state.module.panels).toHaveLength(2);
      expect(state.sourcePath).toBe("web/src/subapps/wc-clock/index.tsx");
    }
  });

  it("says no-candidate rather than rendering an empty frame", () => {
    const state = buildPreview({ candidate: null, layers });
    expect(state).toMatchObject({ kind: "blocked", block: { kind: "no-candidate" } });
  });

  it("names the path it expected when there is no web module", () => {
    const state = buildPreview({
      candidate: candidate({ files: wcClockFiles().filter((f) => f.kind !== "web-module") }),
      layers,
    });
    expect(state).toMatchObject({
      kind: "blocked",
      block: { kind: "no-web-module", expected: "web/src/subapps/wc-clock/index.tsx" },
    });
  });

  it("blocks ONLY on the findings that truly make a preview impossible", () => {
    const blocked = buildPreview({
      candidate: candidate({
        findings: [finding("FD-X003", "web/src/subapps/wc-clock/index.tsx", 1, "no default export")],
      }),
      layers,
    });
    expect(blocked).toMatchObject({ kind: "blocked", block: { kind: "gate-blocked" } });
    expect(BLOCKING_RULES).toEqual(["FD-X002", "FD-X003"]);
  });

  it("does NOT block on a server-side error, and shows it attributed instead", () => {
    // The tempting rule — any gate error, no preview — hides the only
    // working half of the screen for a fault that does not stop the page
    // from rendering.
    const state = buildPreview({
      candidate: candidate({
        findings: [
          finding("FD-G001", "server/subapps/wc-clock/routes/clocks.ts", 14, "handler skips the guard"),
        ],
      }),
      layers,
    });
    expect(isReady(state)).toBe(true);
    if (isReady(state)) {
      expect(findingsFor(state.attributed, "clocks")).toHaveLength(1);
      expect(findingsFor(state.attributed, "review")).toHaveLength(0);
    }
  });

  it("degrades honestly when capability scopes cannot be read", () => {
    const state = buildPreview({
      candidate: candidate({ files: wcClockFiles().filter((f) => !f.path.includes("/routes/")) }),
      layers,
    });
    expect(isReady(state)).toBe(true);
    if (isReady(state)) {
      const row = state.ledger.find((r) => r.aspect.startsWith("Capability"));
      // Not silently "real" — the pane must say no capability is enforced.
      expect(row?.fidelity).toBe("absent");
    }
  });
});

describe("attach", () => {
  const panels = new Set(["clocks", "review"]);

  it("pins a routes finding to the panel that calls it", () => {
    expect(attach(finding("FD-G001", "server/subapps/wc-clock/routes/clocks.ts", 1, "x"), panels))
      .toEqual({ target: "panel", panelId: "clocks" });
  });

  it("puts the manifest and the page on the page itself", () => {
    expect(attach(finding("FD-M003", "server/subapps/wc-clock/manifest.ts", 1, "x"), panels))
      .toEqual({ target: "page" });
    expect(attach(finding("FD-X003", "web/src/subapps/wc-clock/index.tsx", 1, "x"), panels))
      .toEqual({ target: "page" });
  });

  it("falls through to the app for files that are not one panel's", () => {
    expect(attach(finding("FD-I002", "server/subapps/wc-clock/routes/index.ts", 1, "x"), panels))
      .toEqual({ target: "server" });
    expect(attach(finding("FD-B001", "server/subapps/wc-clock/guard.ts", 1, "x"), panels))
      .toEqual({ target: "server" });
    // A routes file whose domain has no panel — a route set with no GET —
    // is about the app, not about a panel that is not on screen.
    expect(attach(finding("FD-S002", "server/subapps/wc-clock/routes/hidden.ts", 1, "x"), panels))
      .toEqual({ target: "server" });
  });
});

describe("the fidelity ledger", () => {
  it("names what is absent, not just what works", () => {
    const rows = buildLedger({ scopesScanned: true, hasCapabilities: true });
    const absent = rows.filter((r) => r.fidelity === "absent").map((r) => r.aspect);
    // The three a green preview must never be read as evidence of.
    expect(absent).toContain("SQL and initSchema");
    expect(absent).toContain("Host shell");
    expect(absent).toContain("Fastify lifecycle");
  });

  it("every row says something specific", () => {
    for (const row of buildLedger({ scopesScanned: false, hasCapabilities: false })) {
      expect(row.note.length).toBeGreaterThan(40);
    }
  });
});
