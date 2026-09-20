/** What actually crosses the capability adapter, over real HTTP.
 *
 * ⭐ THE ADAPTER TRANSCRIPT IS THE EVIDENCE. A sub-app route reaches the world
 * only through `readContracts` / `writeInboxProposal` / `listOwnInboxProposals`
 * / `auditAppend` / `resolveSigningAuthority`, so a fake adapter that records
 * every call IS a complete account of everything these routes did outside
 * themselves. "A refused bundle wrote nothing" is then a statement about that
 * transcript rather than about a mock's expectations.
 *
 * ⭐ AND THE BUNDLES ARE REAL. `support.ts` builds them by running Studio's
 * actual conversion over a workflow, so these tests exercise the wire contract
 * end to end: a change to what Studio emits that the host would refuse turns
 * this file red in the one place both halves are importable at once. */
import { afterEach, describe, expect, it } from "vitest";
import type { StudioBundle } from "../server/subapps/studio/service/bundle.js";
import { STUDIO_PROPOSAL_KIND, proposalPrefixFor } from "../server/subapps/studio/service/proposal.js";
import { BUNDLE_AT, buildHarness, fakeCapabilities, studioBundle, type Harness } from "./support.js";

let harness: Harness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

const BUNDLE = studioBundle({ source: "skills/works-council-clock/SKILL.md" });
const SUBAPP_ID = BUNDLE.subAppId;

/** A copy with one thing changed. `structuredClone` rather than a spread so a
 * nested edit in one test cannot leak into the next. */
function mutate(change: (bundle: StudioBundle) => void): StudioBundle {
  const copy = structuredClone(BUNDLE) as StudioBundle;
  change(copy);
  return copy;
}

describe("an admissible bundle files exactly one proposal", () => {
  it("writes one file, audits once, and answers with the path", async () => {
    harness = await buildHarness();
    const res = await harness.app.inject({ method: "POST", url: "/api/apps/studio/proposals", payload: BUNDLE });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("proposed");
    expect(body.proposalPath).toMatch(new RegExp(`^memory/proposals/${proposalPrefixFor(SUBAPP_ID)}\\d+\\.json$`));
    expect(body.installs).toBe(false);
    expect(body.note).toContain("installed nothing");

    expect(harness.caps.written.size).toBe(1);
    expect(harness.caps.calls.filter((call) => call.method === "writeInboxProposal")).toHaveLength(1);
    expect(harness.caps.calls.filter((call) => call.method === "auditAppend")).toHaveLength(1);
    // Never a contract read: Studio does not declare read:contracts.
    expect(harness.caps.calls.filter((call) => call.method === "readContracts")).toHaveLength(0);
  });

  it("keeps the host's verdict and the bundle's self-report apart, by name, inside the artefact", async () => {
    harness = await buildHarness();
    await harness.app.inject({ method: "POST", url: "/api/apps/studio/proposals", payload: BUNDLE });
    const written = [...harness.caps.written.values()][0] as Record<string, unknown>;

    expect(written.kind).toBe(STUDIO_PROPOSAL_KIND);
    const admission = written.admission as { ok: boolean; checks: string[] };
    const gate = written.gate as { ok: boolean; checks: string[]; reportedBy: string; reportedAt: string };

    // The host's own conclusion, reached here, from these bytes.
    expect(admission.ok).toBe(true);
    expect(admission.checks).toContain("file-containment");
    expect(admission.checks).toContain("guard-first");

    // The claim that travelled with the bundle, labelled as a claim.
    expect(gate.ok).toBe(true);
    expect(gate.reportedBy).toBe("flightdeck-studio/0.1.0");
    expect(gate.reportedAt).toBe(BUNDLE_AT);
    // Whoever opens this in the Inbox has to be able to tell which is which.
    expect(String(written.appliedBy)).toContain("what this host checked for itself");
  });

  it("carries the generated FILES and the registry edit a human still has to make", async () => {
    harness = await buildHarness();
    await harness.app.inject({ method: "POST", url: "/api/apps/studio/proposals", payload: BUNDLE });
    const written = [...harness.caps.written.values()][0] as Record<string, unknown>;

    const files = written.files as Array<{ path: string; contents: string }>;
    expect(files.length).toBe(BUNDLE.files.length);
    expect(files.every((file) => file.contents.length > 0)).toBe(true);
    expect(files.some((file) => file.path === `server/subapps/${SUBAPP_ID}/manifest.ts`)).toBe(true);

    const registry = written.registry as { file: string; importLine: string; entryLines: string[] };
    expect(registry.file).toBe("server/subapps/registry.ts");
    expect(registry.importLine).toContain(`./${SUBAPP_ID}/manifest.js`);
    expect(registry.entryLines.length).toBeGreaterThan(0);
  });

  it("names FIELDS in the audit event, never the source text or the person's name", async () => {
    harness = await buildHarness();
    await harness.app.inject({ method: "POST", url: "/api/apps/studio/proposals", payload: BUNDLE });

    const audit = harness.caps.calls.find((call) => call.method === "auditAppend");
    const event = audit?.args[0] as Record<string, unknown>;
    expect(event.event).toBe("studio.mini-app-proposed");
    expect(event.subAppId).toBe(SUBAPP_ID);
    expect(typeof event.fileCount).toBe("number");
    expect(typeof event.admissionChecks).toBe("number");
    expect(event.proposedBy).toBe("ada");

    // Contract rule 8: an audit names fields, never PII values — and never a
    // blob of generated source either.
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("Ada L");
    expect(serialized).not.toContain("SubAppManifest");
    expect(serialized.length).toBeLessThan(600);
    // Never constructs a hash: the adapter does that.
    expect(serialized).not.toContain("hash");
  });

  it("names the proposer from the session principal, never from the body", async () => {
    harness = await buildHarness({ principal: null });
    const res = await harness.app.inject({ method: "POST", url: "/api/apps/studio/proposals", payload: BUNDLE });
    // Null with auth off, because no person exists — never a literal stand-in.
    expect(res.json().proposedBy).toBeNull();
  });
});

describe("a bundle this host refuses writes nothing", () => {
  it("refuses a path that escapes the sub-app's directories, and never reaches the adapter", async () => {
    harness = await buildHarness();
    const escaping = mutate((bundle) => {
      bundle.files.push({ path: "scripts/gate.sh", kind: "script", contents: "#!/bin/sh\nrm -rf /\n" });
    });
    const res = await harness.app.inject({ method: "POST", url: "/api/apps/studio/proposals", payload: escaping });

    expect(res.statusCode).toBe(422);
    expect(res.json().status).toBe("not_admissible");
    expect(res.json().admission.errors.some((f: { rule: string }) => f.rule === "ADM-020")).toBe(true);
    // Not one call, not even a read: the admission runs before the adapter is
    // resolved, so "wrote nothing" is a property of the control flow.
    expect(harness.caps.calls).toEqual([]);
    expect(harness.adapterRequests).toEqual([]);
  });

  it("refuses a bundle whose own report is clean but whose code reaches a disk", async () => {
    harness = await buildHarness();
    const escaping = mutate((bundle) => {
      const routes = bundle.files.find((file) => file.path.endsWith("/routes/index.ts"));
      if (routes === undefined) throw new Error("fixture has no routes file");
      Object.assign(routes, { contents: `import fs from "node:fs";\n${routes.contents}` });
    });
    const res = await harness.app.inject({ method: "POST", url: "/api/apps/studio/proposals", payload: escaping });

    expect(escaping.gate.ok).toBe(true);
    expect(res.statusCode).toBe(422);
    expect(res.json().admission.errors.some((f: { rule: string }) => f.rule === "ADM-040")).toBe(true);
    expect(harness.caps.calls).toEqual([]);
  });

  it("refuses a bundle that reports its own gate as blocked", async () => {
    harness = await buildHarness();
    const blocked = mutate((bundle) => {
      bundle.gate.ok = false;
    });
    const res = await harness.app.inject({ method: "POST", url: "/api/apps/studio/proposals", payload: blocked });
    expect(res.statusCode).toBe(422);
    expect(res.json().admission.errors.some((f: { rule: string }) => f.rule === "ADM-070")).toBe(true);
    expect(harness.caps.written.size).toBe(0);
  });

  it("refuses a body that is not a bundle at all with 400, not 422", async () => {
    harness = await buildHarness();
    const res = await harness.app.inject({ method: "POST", url: "/api/apps/studio/proposals", payload: { hello: "world" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid bundle");
    expect(harness.caps.calls).toEqual([]);
  });
});

describe("a second identical proposal is a no-op", () => {
  it("files once, then answers already_proposed with the first path and writes nothing", async () => {
    harness = await buildHarness();
    const first = await harness.app.inject({ method: "POST", url: "/api/apps/studio/proposals", payload: BUNDLE });
    const path = first.json().proposalPath as string;

    const second = await harness.app.inject({ method: "POST", url: "/api/apps/studio/proposals", payload: BUNDLE });
    expect(second.json().status).toBe("already_proposed");
    expect(second.json().proposalPath).toBe(path);
    expect(second.json().installs).toBe(false);
    expect(harness.caps.written.size).toBe(1);
    expect(harness.caps.calls.filter((call) => call.method === "writeInboxProposal")).toHaveLength(1);
  });

  it("matches the EXACT filename shape, so a longer id is not mistaken for this one", async () => {
    // `<id>-` is a prefix of `<id>-2-…`, and a bare prefix test would report
    // the wrong app as already proposed.
    harness = await buildHarness({ caps: fakeCapabilities([`${proposalPrefixFor(`${SUBAPP_ID}-2`)}17.json`]) });
    const res = await harness.app.inject({ method: "POST", url: "/api/apps/studio/proposals", payload: BUNDLE });
    expect(res.json().status).toBe("proposed");
  });

  it("survives a restart: the answer comes from the proposals on disk, not from process memory", async () => {
    const seeded = fakeCapabilities([`${proposalPrefixFor(SUBAPP_ID)}1700000000000.json`]);
    harness = await buildHarness({ caps: seeded });
    const res = await harness.app.inject({ method: "POST", url: "/api/apps/studio/proposals", payload: BUNDLE });
    expect(res.json().status).toBe("already_proposed");
    expect(seeded.written.size).toBe(1);
  });
});

describe("the dry run cannot write, structurally", () => {
  it("runs the whole admission and never resolves a capability adapter", async () => {
    harness = await buildHarness();
    const res = await harness.app.inject({ method: "POST", url: "/api/apps/studio/admit", payload: BUNDLE });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("admissible");
    expect(res.json().admission.ok).toBe(true);
    expect(res.json().installs).toBe(false);
    // There is no adapter in scope in that handler at all, so there is nothing
    // to write THROUGH. Not a flag somebody remembered to check.
    expect(harness.adapterRequests).toEqual([]);
    expect(harness.caps.calls).toEqual([]);
  });

  it("answers 422 for a bundle it would refuse, and still writes nothing", async () => {
    harness = await buildHarness();
    const bad = mutate((bundle) => {
      bundle.spec.navSection = "Contract Pipeline";
    });
    const res = await harness.app.inject({ method: "POST", url: "/api/apps/studio/admit", payload: bad });
    expect(res.statusCode).toBe(422);
    expect(res.json().status).toBe("not_admissible");
    expect(harness.caps.calls).toEqual([]);
  });

  it("describes the same bundle the same way as the filing route does", async () => {
    harness = await buildHarness();
    const dry = await harness.app.inject({ method: "POST", url: "/api/apps/studio/admit", payload: BUNDLE });
    const filed = await harness.app.inject({ method: "POST", url: "/api/apps/studio/proposals", payload: BUNDLE });
    for (const key of ["subAppId", "label", "fileSummaries", "registry", "warnings"]) {
      expect(filed.json()[key]).toEqual(dry.json()[key]);
    }
    expect(filed.json().admission.checks).toEqual(dry.json().admission.checks);
  });
});

describe("a denied scope is a 403, not a 500", () => {
  it("maps the adapter's refusal to capability_denied and names the scope", async () => {
    const caps = fakeCapabilities();
    caps.denied.add("write:inbox-proposal");
    harness = await buildHarness({ caps });

    const res = await harness.app.inject({ method: "POST", url: "/api/apps/studio/proposals", payload: BUNDLE });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "capability_denied", scope: "write:inbox-proposal" });
    expect(caps.written.size).toBe(0);
  });

  it("does the same on the listing route, which is gated by the same scope", async () => {
    const caps = fakeCapabilities();
    caps.denied.add("write:inbox-proposal");
    harness = await buildHarness({ caps });

    const res = await harness.app.inject({ method: "GET", url: "/api/apps/studio/proposals" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "capability_denied" });
  });
});
