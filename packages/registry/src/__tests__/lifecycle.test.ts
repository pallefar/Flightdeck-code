/**
 * THE LIFECYCLE, END TO END — and the doors that stay shut along the way.
 *
 *     proposed -> approved (BY A NAMED HUMAN) -> registered -> reusable
 *
 * The second half of the user's sentence is what the "future projects" block
 * measures: an artifact approved once, in the project that needed it, being
 * switched on in two projects that did not build it — through the host's own
 * ceiling-and-narrow rows rather than a Studio-shaped side channel.
 */

import { describe, expect, it } from "vitest";

import {
  createLedger,
  currentRegistered,
  disableFunctionWide,
  enableForProject,
  enableFunctionWide,
  enabledProjectsFor,
  entryView,
  propose,
  register,
  reject,
  retire,
  reusableCatalogue,
  reuseDecision,
} from "../ledger";
import { CEILING_PROJECT_ID, isValidContentHash } from "../identity";
import { LIFECYCLE_STATES, TERMINAL_STATES, TRANSITIONS, canTransition } from "../states";
import { AGENT, APPROVER, ADMIN, T, miniApp, mustOk, script } from "./support";
import { approve } from "../ledger";

describe("the full lifecycle of a generated mini-app", () => {
  const artifact = miniApp();

  function proposed() {
    return mustOk(propose(createLedger(), { artifact, workflowId: "orchestrate-workflow", by: AGENT, at: T.proposed }));
  }

  it("a proposal records provenance, the declared consent screen, and a usable content hash", () => {
    const { ledger, entry } = proposed();

    expect(entry.state).toBe("proposed");
    expect(entry.workflowId).toBe("orchestrate-workflow");
    expect(entry.capabilities).toEqual(["read:contracts"]);
    expect(entry.approval).toBeNull();
    expect(entry.proposedBy).toEqual(AGENT);

    // Bare lowercase sha256 hex — which is also the shape `packages/approvals`'
    // `CONTENT_HASH_RE` (/^[A-Za-z0-9][A-Za-z0-9:_-]{15,127}$/) admits, so a
    // registered artifact can be handed to `effectiveGrant()` with no second
    // spelling of the same digest.
    expect(isValidContentHash(entry.contentHash)).toBe(true);
    expect(entry.contentHash).toMatch(/^[0-9a-f]{64}$/);

    expect(ledger.history).toHaveLength(1);
    expect(ledger.history[0]?.event).toBe("subapp.proposed");
    expect(ledger.history[0]?.seq).toBe(1);
    expect(ledger.history[0]?.grantedScopes).toEqual(["read:contracts"]);
  });

  it("a named human approves that exact revision, and the signature names them", () => {
    const first = proposed();
    const { ledger, entry } = mustOk(
      approve(first.ledger, {
        artifactId: "wc-clock",
        contentHash: first.entry.contentHash,
        by: APPROVER,
        at: T.approved,
        note: "Read the guard and the routes. Fine for Bensheim.",
      }),
    );

    expect(entry.state).toBe("approved");
    expect(entry.approval?.approver).toEqual({
      kind: "human",
      id: "k.haldan",
      displayName: "Karsten Haldan",
    });
    expect(entry.approval?.contentHash).toBe(first.entry.contentHash);
    expect(entry.approval?.at).toBe(T.approved);
    expect(ledger.history.at(-1)?.event).toBe("subapp.approved");
  });

  it("the approver's note stays on the record and never reaches the audit trail", () => {
    const first = proposed();
    const approved = mustOk(
      approve(first.ledger, {
        artifactId: "wc-clock",
        contentHash: first.entry.contentHash,
        by: APPROVER,
        at: T.approved,
        note: "salary band E4 discussed offline",
      }),
    );
    expect(approved.entry.approval?.note).toContain("salary band");
    // Contract §5 rule 8: audit names fields, never PII values.
    for (const row of approved.ledger.history) {
      expect(JSON.stringify(row)).not.toContain("salary");
    }
  });

  it("registering an approved revision puts it in the catalogue", () => {
    const first = proposed();
    const approved = mustOk(
      approve(first.ledger, { artifactId: "wc-clock", contentHash: first.entry.contentHash, by: APPROVER, at: T.approved }),
    );
    const { ledger, entry } = mustOk(
      register(approved.ledger, { artifactId: "wc-clock", contentHash: first.entry.contentHash, by: ADMIN, at: T.registered }),
    );

    expect(entry.state).toBe("registered");
    expect(currentRegistered(ledger, "wc-clock")).toEqual(entry);
    expect(reusableCatalogue(ledger).map((e) => e.artifactId)).toEqual(["wc-clock"]);
  });
});

/* ── the whole thing, once, as a fixture the reuse tests build on ───────── */

function registeredLedger(artifact = miniApp(), workflowId = "orchestrate-workflow") {
  const p = mustOk(propose(createLedger(), { artifact, workflowId, by: AGENT, at: T.proposed }));
  const a = mustOk(
    approve(p.ledger, { artifactId: artifact.id, contentHash: p.entry.contentHash, by: APPROVER, at: T.approved }),
  );
  return mustOk(
    register(a.ledger, { artifactId: artifact.id, contentHash: p.entry.contentHash, by: ADMIN, at: T.registered }),
  );
}

describe("reuse in future projects", () => {
  it("is refused until a Function ceiling is opened, then granted per project", () => {
    const registered = registeredLedger();

    // Registered is not the same as consented. Fail-closed, default OFF.
    expect(reuseDecision(registered.ledger, { artifactId: "wc-clock", projectId: "bensheim" }).reason).toBe(
      "ceiling_not_enabled",
    );

    const ceiling = mustOk(enableFunctionWide(registered.ledger, { artifactId: "wc-clock", by: ADMIN, at: T.enabled }));
    expect(ceiling.ledger.history.at(-1)?.event).toBe("subapp.enabled");
    // D-05: the FULL granted scope set in the event body — durable proof of consent.
    expect(ceiling.ledger.history.at(-1)?.grantedScopes).toEqual(["read:contracts"]);

    // The ceiling alone does not switch a project on.
    expect(reuseDecision(ceiling.ledger, { artifactId: "wc-clock", projectId: "bensheim" }).reason).toBe("not_enabled");

    const bensheim = mustOk(
      enableForProject(ceiling.ledger, { artifactId: "wc-clock", projectId: "bensheim", by: ADMIN, at: T.project }),
    );
    expect(bensheim.ledger.history.at(-1)?.event).toBe("subapp.project-enabled");
    expect(bensheim.ledger.history.at(-1)?.projectId).toBe("bensheim");

    const decision = reuseDecision(bensheim.ledger, { artifactId: "wc-clock", projectId: "bensheim" });
    expect(decision.allowed).toBe(true);
    expect(decision.grantedScopes).toEqual(["read:contracts"]);
  });

  it("a SECOND project enables the same approved artifact without re-approving it", () => {
    const registered = registeredLedger();
    const ceiling = mustOk(enableFunctionWide(registered.ledger, { artifactId: "wc-clock", by: ADMIN, at: T.enabled }));
    const one = mustOk(
      enableForProject(ceiling.ledger, { artifactId: "wc-clock", projectId: "bensheim", by: ADMIN, at: T.project }),
    );
    const two = mustOk(
      enableForProject(one.ledger, { artifactId: "wc-clock", projectId: "hamburg", by: ADMIN, at: T.later }),
    );

    expect(enabledProjectsFor(two.ledger, "wc-clock")).toEqual(["bensheim", "hamburg"]);
    // Exactly one approval in the whole trail: that is what "approve once,
    // reuse everywhere" has to look like in the audit log.
    expect(two.ledger.history.filter((h) => h.event === "subapp.approved")).toHaveLength(1);

    const view = entryView(two.ledger, two.entry);
    expect(view.enabledProjects).toEqual(["bensheim", "hamburg"]);
    expect(view.ceilingEnabled).toBe(true);
  });

  it("a project may narrow a Function's consent, never widen it", () => {
    const registered = registeredLedger();
    // No ceiling at all: a project cannot open one for itself.
    expect(
      enableForProject(registered.ledger, { artifactId: "wc-clock", projectId: "bensheim", by: ADMIN, at: T.project })
        .reason,
    ).toBe("ceiling_not_enabled");

    // And `'*'` is not a project id somebody may pass here.
    expect(
      enableForProject(registered.ledger, {
        artifactId: "wc-clock",
        projectId: CEILING_PROJECT_ID,
        by: ADMIN,
        at: T.project,
      }).reason,
    ).toBe("ceiling_is_not_a_project");
  });

  it("closing the ceiling masks the project rather than deleting its consent", () => {
    const registered = registeredLedger();
    const ceiling = mustOk(enableFunctionWide(registered.ledger, { artifactId: "wc-clock", by: ADMIN, at: T.enabled }));
    const project = mustOk(
      enableForProject(ceiling.ledger, { artifactId: "wc-clock", projectId: "bensheim", by: ADMIN, at: T.project }),
    );
    const closed = mustOk(disableFunctionWide(project.ledger, { artifactId: "wc-clock", by: ADMIN, at: T.later }));

    // The host's masked state: stored consent survives a closed ceiling.
    expect(enabledProjectsFor(closed.ledger, "wc-clock")).toEqual(["bensheim"]);
    expect(reuseDecision(closed.ledger, { artifactId: "wc-clock", projectId: "bensheim" }).reason).toBe(
      "ceiling_not_enabled",
    );

    // Reopening restores it without anyone re-consenting in the project.
    const reopened = mustOk(enableFunctionWide(closed.ledger, { artifactId: "wc-clock", by: ADMIN, at: T.latest }));
    expect(reuseDecision(reopened.ledger, { artifactId: "wc-clock", projectId: "bensheim" }).allowed).toBe(true);
  });
});

describe("doors that stay shut", () => {
  it("registration without an approval is refused, and the ledger is untouched", () => {
    const p = mustOk(propose(createLedger(), { artifact: miniApp(), workflowId: "wf", by: AGENT, at: T.proposed }));
    const result = register(p.ledger, { artifactId: "wc-clock", contentHash: p.entry.contentHash, by: ADMIN, at: T.registered });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_approved");
    // A refusal returns the caller's own ledger, by reference.
    expect(result.ledger).toBe(p.ledger);
  });

  it("approving something nobody proposed is refused", () => {
    const empty = createLedger();
    const result = approve(empty, {
      artifactId: "wc-clock",
      contentHash: "0".repeat(64),
      by: APPROVER,
      at: T.approved,
    });
    expect(result.reason).toBe("unknown_revision");
  });

  it("enabling an artifact with no registered revision is refused", () => {
    const p = mustOk(propose(createLedger(), { artifact: miniApp(), workflowId: "wf", by: AGENT, at: T.proposed }));
    expect(enableFunctionWide(p.ledger, { artifactId: "wc-clock", by: ADMIN, at: T.enabled }).reason).toBe(
      "no_ceiling_row",
    );
    expect(reuseDecision(p.ledger, { artifactId: "wc-clock", projectId: "bensheim" }).reason).toBe("no_ceiling_row");
  });

  it("a rejected proposal cannot be approved, and identical content cannot be resubmitted", () => {
    const p = mustOk(propose(createLedger(), { artifact: miniApp(), workflowId: "wf", by: AGENT, at: T.proposed }));
    const rejected = mustOk(
      reject(p.ledger, { artifactId: "wc-clock", contentHash: p.entry.contentHash, by: ADMIN, at: T.approved }),
    );

    expect(rejected.entry.state).toBe("rejected");
    expect(
      approve(rejected.ledger, { artifactId: "wc-clock", contentHash: p.entry.contentHash, by: APPROVER, at: T.later })
        .reason,
    ).toBe("wrong_state");
    // Overturning a refusal is a conversation, not a state transition.
    expect(
      propose(rejected.ledger, { artifact: miniApp(), workflowId: "wf", by: AGENT, at: T.later }).reason,
    ).toBe("revision_closed");
  });

  it("one id cannot be two kinds of thing — the host derives its namespace from it", () => {
    const registered = registeredLedger();
    const result = propose(registered.ledger, {
      artifact: script({ id: "wc-clock" }),
      workflowId: "wf",
      by: AGENT,
      at: T.later,
    });
    expect(result.reason).toBe("kind_conflict");
  });

  it("refuses malformed input before touching the ledger", () => {
    const empty = createLedger();
    const cases: Array<[string, string]> = [
      [propose(empty, { artifact: miniApp({ id: "WC Clock" }), workflowId: "wf", by: AGENT, at: T.proposed }).reason, "invalid_artifact_id"],
      [propose(empty, { artifact: miniApp({ files: [] }), workflowId: "wf", by: AGENT, at: T.proposed }).reason, "empty_artifact"],
      [
        propose(empty, {
          artifact: miniApp({ files: [{ path: "../../etc/passwd", text: "x" }] }),
          workflowId: "wf",
          by: AGENT,
          at: T.proposed,
        }).reason,
        "unsafe_file_path",
      ],
      [
        propose(empty, {
          artifact: miniApp({ capabilities: ["read:everything"] as never }),
          workflowId: "wf",
          by: AGENT,
          at: T.proposed,
        }).reason,
        "invalid_capability",
      ],
      [propose(empty, { artifact: miniApp(), workflowId: "Not A Slug", by: AGENT, at: T.proposed }).reason, "invalid_workflow_id"],
      [propose(empty, { artifact: miniApp(), workflowId: "wf", by: AGENT, at: "yesterday" }).reason, "invalid_timestamp"],
    ];
    for (const [actual, expected] of cases) expect(actual).toBe(expected);
    expect(empty.history).toHaveLength(0);
  });
});

describe("scripts run the identical lifecycle", () => {
  it("proposed, approved by a named human, registered and enabled per project", () => {
    const artifact = script();
    const registered = registeredLedger(artifact, "quality-check");
    const ceiling = mustOk(
      enableFunctionWide(registered.ledger, { artifactId: artifact.id, by: ADMIN, at: T.enabled }),
    );
    const project = mustOk(
      enableForProject(ceiling.ledger, { artifactId: artifact.id, projectId: "hamburg", by: ADMIN, at: T.project }),
    );

    expect(registered.entry.kind).toBe("script");
    expect(registered.entry.approval?.approver.displayName).toBe("Karsten Haldan");
    expect(reuseDecision(project.ledger, { artifactId: artifact.id, projectId: "hamburg" }).allowed).toBe(true);
    expect(project.ledger.history.map((h) => h.event)).toEqual([
      "subapp.proposed",
      "subapp.approved",
      "subapp.registered",
      "subapp.enabled",
      "subapp.project-enabled",
    ]);
  });

  it("a script cannot skip the human either", () => {
    const artifact = script();
    const p = mustOk(propose(createLedger(), { artifact, workflowId: "quality-check", by: AGENT, at: T.proposed }));
    expect(
      approve(p.ledger, { artifactId: artifact.id, contentHash: p.entry.contentHash, by: AGENT, at: T.approved })
        .reason,
    ).toBe("approval_actor_not_human");
  });
});

describe("the transition table is closed", () => {
  it("every state has an explicit edge list and three of them are terminal", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...LIFECYCLE_STATES].sort());
    expect([...TERMINAL_STATES].sort()).toEqual(["rejected", "retired", "superseded"]);
  });

  it("there is no edge back into `approved` — the way back is a new proposal", () => {
    for (const from of LIFECYCLE_STATES) {
      if (from === "proposed") continue;
      expect(canTransition(from, "approved")).toBe(false);
    }
  });

  it("a retired revision cannot be re-approved or re-registered", () => {
    const registered = registeredLedger();
    const retired = mustOk(
      retire(registered.ledger, { artifactId: "wc-clock", contentHash: registered.entry.contentHash, by: ADMIN, at: T.later }),
    );
    const hash = registered.entry.contentHash;
    expect(approve(retired.ledger, { artifactId: "wc-clock", contentHash: hash, by: APPROVER, at: T.latest }).reason)
      .toBe("wrong_state");
    expect(register(retired.ledger, { artifactId: "wc-clock", contentHash: hash, by: ADMIN, at: T.latest }).reason)
      .toBe("wrong_state");
  });
});

describe("retirement archives rather than deletes", () => {
  it("closes the ceiling in the same call and stops future reuse", () => {
    const registered = registeredLedger();
    const ceiling = mustOk(enableFunctionWide(registered.ledger, { artifactId: "wc-clock", by: ADMIN, at: T.enabled }));
    const project = mustOk(
      enableForProject(ceiling.ledger, { artifactId: "wc-clock", projectId: "bensheim", by: ADMIN, at: T.project }),
    );
    const retired = mustOk(
      retire(project.ledger, { artifactId: "wc-clock", contentHash: registered.entry.contentHash, by: ADMIN, at: T.later }),
    );

    expect(retired.entry.state).toBe("retired");
    expect(retired.events.map((e) => e.event)).toEqual(["subapp.disabled", "subapp.retired"]);
    expect(reuseDecision(retired.ledger, { artifactId: "wc-clock", projectId: "bensheim" }).reason).toBe("no_ceiling_row");

    // The approval and the human who gave it are still on the record.
    const still = retired.ledger.entries.find((e) => e.contentHash === registered.entry.contentHash);
    expect(still?.approval?.approver.displayName).toBe("Karsten Haldan");
    expect(retired.ledger.entries).toHaveLength(1);
  });
});
