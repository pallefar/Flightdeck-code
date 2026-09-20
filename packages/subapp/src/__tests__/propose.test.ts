/** Propose, don't mutate — as a statement about what the routes actually did.
 *
 * The fake adapter records every call, so each claim below is read off that
 * transcript rather than out of a mock's expectations:
 *
 *   • a clean gate files exactly ONE proposal and audits it once;
 *   • a blocked gate files NOTHING — the transcript is empty;
 *   • a second identical conversion files nothing either, and says so;
 *   • `POST /preview` never resolves an adapter at all, so it structurally
 *     cannot write;
 *   • the audit event names fields, never the workflow's or the person's words.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  ANSWERS,
  AUTO_ADVANCING_WORKFLOW,
  CONVERTIBLE_WORKFLOW,
  buildHarness,
  fakeCapabilities,
  type Harness,
} from "./support.js";

let harness: Harness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

/** The one thing the adapter was asked to write. Reading it as "the only
 * entry" rather than "the first entry" is deliberate: a second write would
 * fail here instead of being quietly ignored. */
function onlyProposal(h: Harness): unknown {
  const entries = [...h.caps.written.entries()];
  expect(entries).toHaveLength(1);
  return entries[0]?.[1];
}

async function fileIt(h: Harness, workflow = CONVERTIBLE_WORKFLOW, source = "skills/works-council-clock/SKILL.md") {
  return h.app.inject({
    method: "POST",
    url: "/api/apps/studio/proposals",
    payload: { workflow, answers: ANSWERS, source },
  });
}

describe("a clean gate files exactly one proposal", () => {
  it("writes one file, audits once, and answers with the path and the findings", async () => {
    harness = await buildHarness();
    const res = await fileIt(harness);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("proposed");
    expect(body.subAppId).toBe("works-council-clock");
    expect(body.proposalPath).toMatch(/^memory\/proposals\/studio-mini-app-works-council-clock-\d+\.json$/);
    expect(body.installs).toBe(false);
    expect(body.note).toContain("installed nothing");

    // Exactly one write, and exactly one audit append.
    const writes = harness.caps.calls.filter((c) => c.method === "writeInboxProposal");
    const audits = harness.caps.calls.filter((c) => c.method === "auditAppend");
    expect(writes).toHaveLength(1);
    expect(audits).toHaveLength(1);
    expect(harness.caps.written.size).toBe(1);

    // And it checked what was already on file BEFORE writing, not after.
    const order = harness.caps.calls.map((c) => c.method);
    expect(order).toEqual(["listOwnInboxProposals", "writeInboxProposal", "auditAppend"]);
  });

  it("the gate that let it through is reported, so a clean run is never confused with a skipped one", async () => {
    harness = await buildHarness();
    const body = (await fileIt(harness)).json();
    expect(body.gate.ok).toBe(true);
    expect(body.gate.checks.length).toBeGreaterThan(0);
    expect(body.gate.errors).toEqual([]);
    expect(body.gate.filesChecked).toBeGreaterThan(0);
  });

  it("the proposal carries the generated FILES and the registry edit a human still has to make", async () => {
    harness = await buildHarness();
    await fileIt(harness);
    const content = onlyProposal(harness);
    const proposal = content as {
      kind: string;
      subAppId: string;
      files: Array<{ path: string; contents: string }>;
      registry: { file: string; importLine: string; entryLines: string[] };
      appliedBy: string;
    };

    expect(proposal.kind).toBe("studio-mini-app");
    const paths = proposal.files.map((f) => f.path);
    expect(paths).toContain("server/subapps/works-council-clock/manifest.ts");
    expect(paths).toContain("server/subapps/works-council-clock/guard.ts");
    expect(paths).toContain("server/subapps/works-council-clock/routes/index.ts");
    expect(paths).toContain("web/src/subapps/works-council-clock/index.tsx");
    // ⛔ The mini-app floor: database-free. No schema, no DDL, no migration.
    expect(paths.some((p) => p.endsWith("schema.ts"))).toBe(false);
    for (const file of proposal.files) expect(file.contents.length).toBeGreaterThan(0);

    expect(proposal.registry.file).toBe("server/subapps/registry.ts");
    expect(proposal.registry.importLine).toContain("works-council-clock/manifest.js");
    expect(proposal.appliedBy).toContain("a human");
  });

  it("the generated manifest is the shell-reference floor: initSchema is a no-op", async () => {
    harness = await buildHarness();
    await fileIt(harness);
    const content = onlyProposal(harness);
    const files = (content as { files: Array<{ path: string; contents: string }> }).files;
    const manifest = files.find((f) => f.path.endsWith("/manifest.ts"));
    expect(manifest?.contents).toContain("initSchema");
    expect(manifest?.contents).toContain('minHostVersion: "5.0.0"');
    expect(manifest?.contents).not.toMatch(/applyWorksCouncilClockSchema|CREATE TABLE/);
  });

  it("the audit event names fields, never the workflow's text or the person's name", async () => {
    harness = await buildHarness();
    await fileIt(harness);
    const audit = harness.caps.calls.find((c) => c.method === "auditAppend");
    const event = audit?.args[0] as Record<string, unknown>;

    expect(event.event).toBe("studio.mini-app-proposed");
    expect(event.actor).toBe("studio");
    expect(event.subAppId).toBe("works-council-clock");
    expect(event.proposedBy).toBe("ada");
    expect(typeof event.fileCount).toBe("number");

    // Contract rule 8, checked rather than asserted in prose: nothing in the
    // event carries a value from the document or a person's display name.
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("works-council consultation clock");
    expect(serialized).not.toContain("Ada L");
    expect(serialized).not.toContain("initSchema");
  });

  it("names the proposer from the session principal, never from the body", async () => {
    harness = await buildHarness({ principal: null });
    const body = (await fileIt(harness)).json();
    expect(body.proposedBy).toBeNull();
    const content = onlyProposal(harness);
    expect((content as { proposedBy: unknown }).proposedBy).toBeNull();
  });
});

describe("a blocked gate writes nothing", () => {
  it("refuses an auto-advancing workflow and never reaches the adapter at all", async () => {
    harness = await buildHarness();
    const res = await fileIt(harness, AUTO_ADVANCING_WORKFLOW);

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.status).toBe("blocked");
    expect(body.evidence.toLowerCase()).toContain("automatically approve");
    expect(body.contractRule).toBeTruthy();

    // The whole transcript. Nothing was written, nothing was listed, nothing
    // was audited — and no adapter was even resolved.
    expect(harness.caps.calls).toEqual([]);
    expect(harness.adapterRequests).toEqual([]);
    expect(harness.caps.written.size).toBe(0);
  });

  it("refuses markdown that is not a workflow, and still writes nothing", async () => {
    harness = await buildHarness();
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/apps/studio/proposals",
      payload: { workflow: "# just a readme\n\nNo frontmatter, no procedure." },
    });

    expect(res.statusCode).toBe(422);
    expect(["unreadable", "rejected"]).toContain(res.json().status);
    expect(harness.caps.calls).toEqual([]);
    expect(harness.caps.written.size).toBe(0);
  });

  it("asks rather than guesses when the document does not name a nav section — and writes nothing meanwhile", async () => {
    harness = await buildHarness();
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/apps/studio/proposals",
      payload: { workflow: CONVERTIBLE_WORKFLOW },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("needs_input");
    expect(body.questions.map((q: { id: string }) => q.id)).toContain("navSection");
    expect(harness.caps.calls).toEqual([]);
    expect(harness.caps.written.size).toBe(0);
  });
});

describe("a second identical proposal is a no-op", () => {
  it("files once, then answers already_proposed with the first path and writes nothing", async () => {
    harness = await buildHarness();
    const first = await fileIt(harness);
    const firstPath = first.json().proposalPath as string;
    const writesAfterFirst = harness.caps.calls.filter((c) => c.method === "writeInboxProposal").length;

    const second = await fileIt(harness);
    expect(second.statusCode).toBe(200);
    const body = second.json();
    expect(body.status).toBe("already_proposed");
    expect(body.proposalPath).toBe(firstPath);
    expect(body.installs).toBe(false);
    expect(body.note).toContain("Nothing was written");

    expect(harness.caps.calls.filter((c) => c.method === "writeInboxProposal")).toHaveLength(writesAfterFirst);
    expect(harness.caps.written.size).toBe(1);
    // No second audit event either: nothing happened, so nothing is recorded.
    expect(harness.caps.calls.filter((c) => c.method === "auditAppend")).toHaveLength(1);
  });

  it("matches the EXACT filename shape, so a longer id is not mistaken for this one", async () => {
    // `works-council-clock-v2-…` starts with `…works-council-clock-`, and a
    // bare prefix test would report the wrong app as already proposed.
    harness = await buildHarness({
      caps: fakeCapabilities(["studio-mini-app-works-council-clock-v2-1700000000000.json"]),
    });
    const res = await fileIt(harness);
    expect(res.json().status).toBe("proposed");
    expect(harness.caps.written.size).toBe(2);
  });

  it("survives a restart: the answer comes from the proposals on disk, not from process memory", async () => {
    // A fresh harness with the SAME proposal already on file is exactly what a
    // restarted server sees. A mini-app stores nothing, so this listing is the
    // only durable state it has.
    harness = await buildHarness({
      caps: fakeCapabilities(["studio-mini-app-works-council-clock-1700000000000.json"]),
    });
    const res = await fileIt(harness);
    expect(res.json().status).toBe("already_proposed");
    expect(res.json().proposalPath).toBe("memory/proposals/studio-mini-app-works-council-clock-1700000000000.json");
    expect(harness.caps.calls.some((c) => c.method === "writeInboxProposal")).toBe(false);
  });
});

describe("preview cannot write, structurally", () => {
  it("runs the whole pipeline and never resolves a capability adapter", async () => {
    harness = await buildHarness();
    const res = await harness.app.inject({
      method: "POST",
      url: "/api/apps/studio/preview",
      payload: { workflow: CONVERTIBLE_WORKFLOW, answers: ANSWERS },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ready");
    expect(body.gate.ok).toBe(true);
    expect(body.installs).toBe(false);
    // The paths and sizes are there; the file bodies are not echoed back.
    expect(body.fileSummaries.length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty("files");

    expect(harness.adapterRequests).toEqual([]);
    expect(harness.caps.calls).toEqual([]);
  });

  it("reports what it narrowed instead of quietly doing it", async () => {
    harness = await buildHarness();
    const body = (
      await harness.app.inject({
        method: "POST",
        url: "/api/apps/studio/preview",
        payload: { workflow: CONVERTIBLE_WORKFLOW, answers: ANSWERS },
      })
    ).json();

    // "Record the outcome" asks to write host state. The mini-app files a
    // proposal instead, and says so.
    expect(body.spec.steps).toHaveLength(4);
    expect(body.spec.capabilities).toContain("write:inbox-proposal");
  });
});

describe("a denied scope is a 403, not a 500", () => {
  it("maps the adapter's refusal to capability_denied and names the scope", async () => {
    const caps = fakeCapabilities();
    caps.denied.add("write:inbox-proposal");
    harness = await buildHarness({ caps });

    const res = await fileIt(harness);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "capability_denied" });
    expect(harness.caps.written.size).toBe(0);
  });
});
