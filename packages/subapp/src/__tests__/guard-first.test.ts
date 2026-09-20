/** The guard runs FIRST, in every handler, on every request.
 *
 * ⭐ WHY THIS IS THE MOST LOAD-BEARING TEST IN THE PACKAGE. The shell's
 * manifest-derived RBAC rule (`deriveSubAppExtraRules`) enforces ROLES ONLY.
 * Nothing in the host checks enable-state for a sub-app's own routes. So a
 * Studio handler that parsed a body before calling `requireStudioEnabled`, or
 * that called it in only two handlers out of three, would run the whole
 * conversion pipeline with the kill switch off — and the kill switch is the
 * operational control somebody reaches for when a sub-app is misbehaving in
 * production.
 *
 * "First" is tested as an OBSERVABLE property rather than by reading the
 * source: with the sub-app disabled, the adapter transcript must be empty and
 * a body that could not possibly parse must still produce the 403 rather than
 * a 400. If the guard ran second, one or the other would differ. */
import { afterEach, describe, expect, it } from "vitest";
import { standInAuditEntries } from "../server/lib/flightdeckAudit.js";
import type { StudioBundle } from "../server/subapps/studio/service/bundle.js";
import { buildHarness, studioBundle, type Harness } from "./support.js";

let harness: Harness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

const BUNDLE = studioBundle();

interface RouteCase {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly payload?: StudioBundle;
}

const ROUTES: readonly RouteCase[] = [
  { method: "GET", url: "/api/apps/studio/proposals" },
  { method: "POST", url: "/api/apps/studio/admit", payload: BUNDLE },
  { method: "POST", url: "/api/apps/studio/proposals", payload: BUNDLE },
];

describe("every handler refuses before it does anything, layer 1 (the kill switch)", () => {
  for (const route of ROUTES) {
    it(`${route.method} ${route.url} answers 403 subapp_disabled and touches no capability`, async () => {
      harness = await buildHarness({ killSwitch: false });
      const res = await harness.app.inject({
        method: route.method,
        url: route.url,
        ...(route.payload === undefined ? {} : { payload: route.payload }),
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: "subapp_disabled" });
      // The whole transcript of what the route touched. Empty.
      expect(harness.caps.calls).toEqual([]);
      // And it never even asked for an adapter — `capabilitiesFor` is resolved
      // after the guard, not before it.
      expect(harness.adapterRequests).toEqual([]);
      expect(harness.caps.written.size).toBe(0);
    });
  }
});

describe("every handler refuses before it does anything, layers 2 and 3 (the install row)", () => {
  for (const route of ROUTES) {
    it(`${route.method} ${route.url} answers 403 with the kill switch ON but no install row`, async () => {
      harness = await buildHarness({ killSwitch: true, installed: false });
      const res = await harness.app.inject({
        method: route.method,
        url: route.url,
        ...(route.payload === undefined ? {} : { payload: route.payload }),
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: "subapp_disabled" });
      expect(harness.caps.calls).toEqual([]);
      expect(harness.adapterRequests).toEqual([]);
    });
  }
});

describe("first means FIRST, not first-among-the-interesting-statements", () => {
  it("a body that cannot pass the schema still answers 403, never 400", async () => {
    harness = await buildHarness({ killSwitch: false });
    // No `bundle` discriminator, no `spec`, no `files`, and an unknown key —
    // four separate reasons the Zod schema would refuse this. If the body were
    // parsed before the guard, this would be a 400.
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/apps/studio/proposals",
      payload: { profile: "table-backed", files: 7 },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "subapp_disabled" });
    expect(res.json()).not.toHaveProperty("issues");
  });

  it("an enabled sub-app DOES answer 400 for that same body — so the 403 above was the guard, not the parser", async () => {
    harness = await buildHarness();
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/apps/studio/proposals",
      payload: { profile: "table-backed", files: 7 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid bundle" });
    expect(harness.caps.written.size).toBe(0);
  });

  it("an unknown body key is refused rather than ignored — .strict() is not decoration", async () => {
    harness = await buildHarness();
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/apps/studio/proposals",
      // A caller who sent `install: true` must be told the host did not read
      // that, instead of getting a 200 and believing something was installed.
      payload: { ...BUNDLE, install: true },
    });

    expect(res.statusCode).toBe(400);
    const issues = res.json().issues as Array<{ code?: string }>;
    expect(issues.some((issue) => issue.code === "unrecognized_keys")).toBe(true);
    expect(harness.caps.written.size).toBe(0);
  });
});

describe("the refusal is audited, and never cached", () => {
  it("records WHY it refused, distinguishing the kill switch from the install row", async () => {
    harness = await buildHarness({ killSwitch: false });
    await harness.app.inject({ method: "GET", url: "/api/apps/studio/proposals" });
    expect(standInAuditEntries().map((e) => e.input)).toEqual([
      { event: "studio.access.refused", actor: "ada", reason: "kill-switch-off" },
    ]);

    await harness.close();
    harness = await buildHarness({ killSwitch: true, installed: false });
    await harness.app.inject({ method: "GET", url: "/api/apps/studio/proposals" });
    expect(standInAuditEntries().map((e) => e.input)).toEqual([
      { event: "studio.access.refused", actor: "ada", reason: "not-installed-or-disabled" },
    ]);
  });

  it("names the principal as anonymous with auth off, never a stand-in person", async () => {
    harness = await buildHarness({ killSwitch: false, principal: null });
    await harness.app.inject({ method: "GET", url: "/api/apps/studio/proposals" });
    expect(standInAuditEntries()[0]?.input.actor).toBe("anonymous");
  });

  it("refuses without auditing when there is no workspace to audit INTO", async () => {
    harness = await buildHarness({ workspace: false });
    const res = await harness.app.inject({ method: "GET", url: "/api/apps/studio/proposals" });
    expect(res.statusCode).toBe(403);
    expect(standInAuditEntries()).toEqual([]);
  });

  it("re-reads the kill switch per request — flipping it mid-life changes the answer with no restart", async () => {
    harness = await buildHarness({ killSwitch: true });
    const allowed = await harness.app.inject({
      method: "POST",
      url: "/api/apps/studio/admit",
      payload: BUNDLE,
    });
    expect(allowed.statusCode).toBe(200);

    // Nothing is restarted, nothing is re-registered. A cached boolean would
    // keep answering 200 here, which is exactly the defect this asserts away.
    delete process.env.SUBAPP_STUDIO_ENABLED;
    const refused = await harness.app.inject({
      method: "POST",
      url: "/api/apps/studio/admit",
      payload: BUNDLE,
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: "subapp_disabled" });
  });
});
