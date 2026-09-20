/**
 * ⭐ WIDENING CONSENT IS A GUARDRAIL-4 MOMENT.
 *
 * `stampDefect` checks only that `by` is AN actor, so an agent could enable a
 * tool Function-wide or for a project. That is not a neutral toggle: the
 * event body carries the full `grantedScopes` set — D-05's "durable proof of
 * consent (not just `enabled: true`)" — so enabling GRANTS CAPABILITIES, and
 * `boot.json` guardrail 4 reserves exactly that for a person: "Security,
 * access, and connector permissions require explicit human approval."
 *
 * The approval path was guarded; the enable path was not, and the registry is
 * what makes an approved tool reusable by later projects.
 *
 * ⛔ AND ONLY IN THE WIDENING DIRECTION. Disabling emits no scopes and is
 * refused to nobody. A kill switch that waits for a person to be available is
 * not a kill switch.
 */
import { describe, expect, it } from "vitest";

import {
  approve,
  disableForProject,
  disableFunctionWide,
  enableForProject,
  enableFunctionWide,
  propose,
  register,
} from "../ledger";
import { createLedger } from "../ledger";
import { ADMIN, AGENT, APPROVER, SYSTEM, T, miniApp, mustOk } from "./support";

const UNNAMED = { kind: "human", id: "system", displayName: "system" } as const;

/** A registered revision, which is the precondition for enabling anything. */
function registered() {
  const proposed = mustOk(
    propose(createLedger(), { artifact: miniApp(), workflowId: "orchestrate-workflow", by: AGENT, at: T.proposed }),
  );
  const approved = mustOk(
    approve(proposed.ledger, {
      artifactId: "wc-clock",
      contentHash: proposed.entry.contentHash,
      by: APPROVER,
      at: T.approved,
    }),
  );
  return mustOk(
    register(approved.ledger, {
      artifactId: "wc-clock",
      contentHash: proposed.entry.contentHash,
      by: ADMIN,
      at: T.registered,
    }),
  );
}

describe("who may widen consent", () => {
  it("⭐ an agent cannot enable Function-wide", () => {
    const live = registered();
    const result = enableFunctionWide(live.ledger, { artifactId: "wc-clock", by: AGENT, at: T.enabled });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("enable_actor_not_human");
    // Refused means UNCHANGED, by reference — the ledger is a value.
    expect(result.ledger).toBe(live.ledger);
  });

  it("⭐ nor the system, nor a 'human' with a role for a name", () => {
    const live = registered();
    for (const by of [SYSTEM, UNNAMED]) {
      const result = enableFunctionWide(live.ledger, { artifactId: "wc-clock", by, at: T.enabled });
      expect(result.ok, JSON.stringify(by)).toBe(false);
      if (!result.ok) expect(result.reason).toBe("enable_actor_not_human");
    }
  });

  it("⭐ nor enable it for a PROJECT — a project row records grantedScopes too", () => {
    const live = registered();
    const ceiling = mustOk(enableFunctionWide(live.ledger, { artifactId: "wc-clock", by: APPROVER, at: T.enabled }));
    const result = enableForProject(ceiling.ledger, {
      artifactId: "wc-clock",
      projectId: "rhineland",
      by: AGENT,
      at: T.enabled,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("enable_actor_not_human");
  });

  it("⛔ but a named human can — this is a check, not a wall", () => {
    const live = registered();
    const ceiling = enableFunctionWide(live.ledger, { artifactId: "wc-clock", by: APPROVER, at: T.enabled });
    expect(ceiling.ok).toBe(true);
    if (!ceiling.ok) return;
    const project = enableForProject(ceiling.ledger, {
      artifactId: "wc-clock",
      projectId: "rhineland",
      by: APPROVER,
      at: T.enabled,
    });
    expect(project.ok).toBe(true);
  });
});

describe("who may NARROW it", () => {
  it("⭐ anyone — a kill switch that waits for a person is not a kill switch", () => {
    const live = registered();
    const ceiling = mustOk(enableFunctionWide(live.ledger, { artifactId: "wc-clock", by: APPROVER, at: T.enabled }));
    const project = mustOk(
      enableForProject(ceiling.ledger, {
        artifactId: "wc-clock",
        projectId: "rhineland",
        by: APPROVER,
        at: T.enabled,
      }),
    );

    // An AGENT turns both off. Both must be allowed.
    const offProject = disableForProject(project.ledger, {
      artifactId: "wc-clock",
      projectId: "rhineland",
      by: AGENT,
      at: T.enabled,
    });
    expect(offProject.ok, "an agent must be able to disable a project").toBe(true);
    if (!offProject.ok) return;

    const offCeiling = disableFunctionWide(offProject.ledger, {
      artifactId: "wc-clock",
      by: AGENT,
      at: T.enabled,
    });
    expect(offCeiling.ok, "an agent must be able to close the ceiling").toBe(true);
  });
});
