/** The conversion, tested without HTTP in the way — Studio's half of the line.
 *
 * `guard-first.test.ts` and `propose.test.ts` drive the real routes and read
 * the adapter transcript. This file asks the narrower questions those cannot:
 * whether the gate that gates the write actually RAN all its checks, whether
 * the mini-app floor holds on both sides of the generator, and whether the
 * idempotency key means what its filename shape says it means.
 *
 * ⚠ ONE COVERAGE GAP, STATED RATHER THAN PAPERED OVER. The `gate_blocked` arm
 * is not reachable from any workflow this package can construct: `@codegen`
 * runs its own invariant check over the emitted text and throws before
 * returning, so text that would fail the conformance gate never gets as far as
 * the gate. What IS proven here is that the gate ran, which checks it ran, and
 * that its verdict is what the route branches on — plus, in `propose.test.ts`,
 * that every refusal arm returns before an adapter is ever resolved, which is
 * the code path `gate_blocked` would take. */
import { describe, expect, it } from "vitest";
import {
  findFiledProposal,
  proposalFileNameFor,
  proposalPrefixFor,
} from "../server/subapps/studio/service/proposal.js";
import { convertWorkflow } from "../studio/conversion.js";
import {
  PROPOSAL_TEMPLATES,
  templateContentHash,
  type ProposalTemplate,
} from "@codegen/pure";
import { ANSWERS, AUTO_ADVANCING_WORKFLOW, CONVERTIBLE_WORKFLOW } from "./support.js";

const ready = convertWorkflow({ workflow: CONVERTIBLE_WORKFLOW, answers: ANSWERS, source: "skills/wc/SKILL.md" });

describe("the gate that gates the write", () => {
  it("ran, and reports every check it ran by name", () => {
    expect(ready.status).toBe("ready");
    if (ready.status !== "ready") return;
    // A gate that quietly skipped half its rules and reported "no findings"
    // would be worse than no gate, so the checks are named, not counted.
    for (const check of [
      "manifest",
      "import-closure",
      "capability-escape",
      "guard-first",
      "no-cached-boolean",
      "table-prefix",
      "mount",
    ]) {
      expect(ready.gate.checks, `the "${check}" check did not run`).toContain(check);
    }
    expect(ready.gate.ok).toBe(true);
    expect(ready.gate.errors).toEqual([]);
    expect(ready.gate.filesChecked).toBe(ready.files.length);
  });

  it("still reports its advisory findings — a warning is not a silence", () => {
    if (ready.status !== "ready") throw new Error("expected ready");
    // Studio cannot edit the host's `registry.ts`, so the gate's "nothing here
    // edits registry.ts" warning is expected and must SURVIVE to the human.
    expect(ready.gate.warnings.length).toBeGreaterThan(0);
    expect(ready.gate.warnings.every((f) => f.severity === "warning")).toBe(true);
  });
});

describe("the mini-app floor", () => {
  it("emits the shell-reference shape and nothing database-shaped", () => {
    if (ready.status !== "ready") throw new Error("expected ready");
    const paths = ready.files.map((f) => f.path);
    expect(paths).toContain("server/subapps/works-council-clock/manifest.ts");
    expect(paths).toContain("server/subapps/works-council-clock/guard.ts");
    expect(paths).toContain("server/subapps/works-council-clock/routes/index.ts");
    expect(paths).toContain("web/src/subapps/works-council-clock/index.tsx");
    expect(paths.filter((p) => /schema|migration|\.sql$/.test(p))).toEqual([]);
  });

  it("emits an initSchema that does nothing at all", () => {
    if (ready.status !== "ready") throw new Error("expected ready");
    const manifest = ready.files.find((f) => f.path.endsWith("/manifest.ts"));
    expect(manifest?.contents).toMatch(/initSchema:\s*\(\)\s*=>\s*\{\s*\}/);
  });

  it("emits no stylesheet and no dictionary with the page", () => {
    if (ready.status !== "ready") throw new Error("expected ready");
    expect(ready.files.some((f) => f.path.endsWith(".css"))).toBe(false);
    expect(ready.files.some((f) => /i18n/.test(f.path))).toBe(false);
  });

  it("carries the registry edit as data, because it cannot make it", () => {
    if (ready.status !== "ready") throw new Error("expected ready");
    expect(ready.registry.file).toBe("server/subapps/registry.ts");
    expect(ready.registry.importLine).toBe(
      'import { worksCouncilClockManifest } from "./works-council-clock/manifest.js";',
    );
    expect(ready.registry.entryLines.join("\n")).toContain("worksCouncilClockManifest,");
  });

  it("is byte-deterministic — the same workflow twice is the same files", () => {
    const again = convertWorkflow({ workflow: CONVERTIBLE_WORKFLOW, answers: ANSWERS, source: "skills/wc/SKILL.md" });
    if (ready.status !== "ready" || again.status !== "ready") throw new Error("expected ready");
    expect(again.files).toEqual(ready.files);
  });
});

describe("the workflow's own procedure survives the conversion", () => {
  it("keeps the document's numbering and its own words", () => {
    if (ready.status !== "ready") throw new Error("expected ready");
    expect(ready.spec.steps.map((s) => s.ordinal)).toEqual(["1", "2", "3", "4"]);
    expect(ready.spec.steps.map((s) => s.title)).toEqual([
      "Read state",
      "Check the clock",
      "Notify the liaison",
      "Record the outcome",
    ]);
  });

  it("narrows a step that would write host state, and says so", () => {
    if (ready.status !== "ready") throw new Error("expected ready");
    // "Record the outcome — write the consultation result…" cannot be
    // performed by a mini-app. It becomes a proposal step — and, until the
    // owner approves the `step` template (ruling 8), a proposal step the app
    // shows and does not file. Both narrowings are reported, not done quietly.
    const record = ready.spec.steps.find((s) => s.title === "Record the outcome");
    expect(record?.kind).toBe("propose");
    expect(ready.warnings.some((w) => w.includes("ruling 2026-09-22 (8)"))).toBe(true);
  });

  it("declares no capability it cannot ground in the document's own sentences", () => {
    if (ready.status !== "ready") throw new Error("expected ready");
    for (const capability of ready.spec.capabilities) {
      expect(["read:contracts", "write:inbox-proposal"]).toContain(capability);
    }
  });
});

/* ── Owner ruling 2026-09-22 (8) ──────────────────────────────────────────
 * "Proposing apps are generated ONLY from a closed catalogue of proposal
 * templates the owner approves … generation refuses unapproved ones." The
 * conversion used to write its own `step` proposal in code, outside the
 * catalogue. It now resolves the catalogue's `step` template, which carries no
 * approval, so the conversion files nothing until the owner approves it. */
describe("⭐ ruling 8: the conversion's proposal comes from the approved catalogue, or not at all", () => {
  const routesOf = (conversion: typeof ready) =>
    conversion.status === "ready" ? conversion.files.find((f) => f.path.endsWith("/routes/workflow.ts"))?.contents ?? "" : "";
  const manifestOf = (conversion: typeof ready) =>
    conversion.status === "ready" ? conversion.files.find((f) => f.path.endsWith("/manifest.ts"))?.contents ?? "" : "";

  it("⛔ files no proposal while the `step` template is unapproved — no route writes one", () => {
    expect(ready.status).toBe("ready");
    const routes = routesOf(ready);
    expect(routes).not.toContain("writeInboxProposal");
    expect(routes).not.toContain("listOwnInboxProposals");
    expect(routes).not.toContain("step-proposed");
    expect(routes).not.toMatch(/app\.post\(/);
  });

  it("⛔ and drops write:inbox-proposal: a consent line for a write the app cannot make is not least privilege", () => {
    if (ready.status !== "ready") throw new Error("expected ready");
    expect(manifestOf(ready)).not.toContain("write:inbox-proposal");
    // The review screen says what the manifest says, not what the plan wanted.
    expect(ready.spec.capabilities).not.toContain("write:inbox-proposal");
    expect(ready.spec.capabilities).toContain("read:contracts");
  });

  it("says so by name — the ruling, the template, and what would change it", () => {
    if (ready.status !== "ready") throw new Error("expected ready");
    const said = ready.warnings.join("\n");
    expect(said).toContain("owner ruling 2026-09-22 (8)");
    expect(said).toContain("`step` proposal template");
    expect(said).toMatch(/dropped the POST \/proposals route/);
    expect(said).toMatch(/dropped write:inbox-proposal/);
  });

  it("⭐ once the `step` template carries a valid approval, the proposing route is built FROM it", () => {
    const approved = approvedStepCatalogue();
    const conversion = convertWorkflow({ workflow: CONVERTIBLE_WORKFLOW, answers: ANSWERS }, { catalogue: approved });
    expect(conversion.status).toBe("ready");
    if (conversion.status !== "ready") return;
    const routes = routesOf(conversion);
    expect(routes).toContain("writeInboxProposal");
    expect(routes).toContain('kind: "works-council-clock-step"');
    expect(routes).toContain('event: "works-council-clock.step-proposed"');
    expect(routes).toContain("step: z.string().min(1).max(48)");
    expect(manifestOf(conversion)).toContain("write:inbox-proposal");
    expect(conversion.spec.capabilities).toContain("write:inbox-proposal");
    expect(conversion.warnings.join("\n")).not.toContain("ruling 2026-09-22 (8)");
  });

  it("⛔ a workflow whose every route files a proposal is rejected by name, not generated empty", () => {
    const proposeOnly = `---
name: liaison-handoff
description: >
  Hand off to the liaison when a person is needed.
---

# liaison-handoff

## Procedure
1. **Notify the liaison** — at every hand-off that needs a human, draft the ping for the wc_liaison to review.
2. **Record the outcome** — write the consultation result to the folder audit entries.
`;
    const refused = convertWorkflow({ workflow: proposeOnly, answers: ANSWERS });
    expect(refused.status).toBe("rejected");
    if (refused.status !== "rejected") return;
    expect(refused.issues.join("\n")).toContain("owner ruling 2026-09-22 (8)");
    expect(refused.issues.join("\n")).toContain("`step` proposal template");
    // And the same document converts once the template is approved.
    expect(convertWorkflow({ workflow: proposeOnly, answers: ANSWERS }, { catalogue: approvedStepCatalogue() }).status).toBe("ready");
  });

  it("⛔ an approval that no longer covers the template (edited after approval) is refused like none", () => {
    const widened = approvedStepCatalogue().map((t) =>
      t.id === "step" ? { ...t, fields: [...t.fields, { name: "salary", type: "number" as const }] } : t,
    );
    const conversion = convertWorkflow({ workflow: CONVERTIBLE_WORKFLOW, answers: ANSWERS }, { catalogue: widened });
    expect(conversion.status).toBe("ready");
    expect(routesOf(conversion)).not.toContain("writeInboxProposal");
    expect(routesOf(conversion)).not.toContain("salary");
  });
});

/** The real catalogue with the `step` template approved — test-only, so the
 * approved path is exercised without the production catalogue approving it. */
function approvedStepCatalogue(): ProposalTemplate[] {
  return PROPOSAL_TEMPLATES.map((template) => {
    if (template.id !== "step") return template;
    const unsigned: ProposalTemplate = { ...template, approval: null };
    return {
      ...unsigned,
      approval: { approvedBy: "Test Approver", approvedAt: "2026-09-22", contentHash: templateContentHash(unsigned) },
    };
  });
}

describe("refusals", () => {
  it("refuses an auto-advancing step outright, naming the sentence", () => {
    const blocked = convertWorkflow({ workflow: AUTO_ADVANCING_WORKFLOW, answers: ANSWERS });
    expect(blocked.status).toBe("blocked");
    if (blocked.status !== "blocked") return;
    expect(blocked.evidence).toContain("automatically approve");
    expect(blocked.evidenceGrounded).toBe(true);
    expect(blocked.contractRule).toBeTruthy();
  });

  it("asks rather than guesses when the document names no nav section", () => {
    const asked = convertWorkflow({ workflow: CONVERTIBLE_WORKFLOW });
    expect(asked.status).toBe("needs_input");
    if (asked.status !== "needs_input") return;
    expect(asked.questions.map((q) => q.id)).toContain("navSection");
  });

  it("refuses markdown with no procedure to convert", () => {
    const nothing = convertWorkflow({ workflow: "---\nname: x\ndescription: y\n---\n\n# x\n\nNo procedure here." });
    expect(["unreadable", "rejected"]).toContain(nothing.status);
  });
});

describe("the idempotency key", () => {
  const name = proposalFileNameFor("wc-clock", 1_700_000_000_000);

  it("round-trips: what the route writes is what the route finds", () => {
    expect(findFiledProposal([name], "wc-clock")).toBe(name);
  });

  it("matches the exact filename shape, not a bare prefix", () => {
    // Every one of these STARTS WITH `studio-mini-app-wc-clock-`, and a
    // `startsWith` test alone would report the wrong app as already proposed.
    const traps = [
      proposalFileNameFor("wc-clock-2", 1_700_000_000_000),
      `${proposalPrefixFor("wc-clock")}draft.json`,
      `${proposalPrefixFor("wc-clock")}12ab.json`,
      `${proposalPrefixFor("wc-clock")}1700000000000.json.bak`,
    ];
    for (const trap of traps) {
      expect(findFiledProposal([trap], "wc-clock"), `"${trap}" should not match`).toBeNull();
    }
    // And the real one still matches when it sits among them.
    expect(findFiledProposal([...traps, name], "wc-clock")).toBe(name);
  });

  it("does not match another sub-app's proposals at all", () => {
    expect(findFiledProposal([proposalFileNameFor("other-app", 1)], "wc-clock")).toBeNull();
    expect(findFiledProposal(["shell-reference-flag-DE-2026-9001-1.json"], "wc-clock")).toBeNull();
  });

  it("is empty-safe: nothing on file means nothing found", () => {
    expect(findFiledProposal([], "wc-clock")).toBeNull();
  });
});
