/**
 * APPROVING v1 DOES NOT BLESS v2.
 *
 * The mechanism under test is not a check, it is a KEY: a ledger entry is
 * `(artifactId, contentHash)`, so changed content is a different row and there
 * is no write anywhere in the package that moves a signature between rows. The
 * tests below try to get v2 into production on v1's approval by every route the
 * API offers, and then confirm the legitimate route — a new proposal, a new
 * signature — still works and retires v1 cleanly.
 *
 * The second half of the file pins down what "changed" MEANS, because a digest
 * that moves when it should not trains people to click through re-approvals,
 * and one that sits still when it should move is the bug this file is named
 * after.
 */

import { describe, expect, it } from "vitest";

import { artifactHash, hashedShape, HASHED_ARTIFACT_FIELDS } from "../hash";
import {
  approve,
  createLedger,
  currentRegistered,
  enableForProject,
  enableFunctionWide,
  propose,
  register,
  reuseDecision,
  revisionsOf,
} from "../ledger";
import { ADMIN, AGENT, APPROVER, SECOND_APPROVER, T, miniApp, miniAppV2, mustOk } from "./support";

function throughRegistration(artifact = miniApp(), at = T.proposed) {
  const p = mustOk(propose(createLedger(), { artifact, workflowId: "orchestrate-workflow", by: AGENT, at }));
  const a = mustOk(
    approve(p.ledger, { artifactId: artifact.id, contentHash: p.entry.contentHash, by: APPROVER, at: T.approved }),
  );
  const r = mustOk(
    register(a.ledger, { artifactId: artifact.id, contentHash: p.entry.contentHash, by: ADMIN, at: T.registered }),
  );
  return { ...r, v1Hash: p.entry.contentHash };
}

describe("changed content cannot ride the old approval", () => {
  it("the two revisions have different hashes", () => {
    expect(artifactHash(miniApp())).not.toBe(artifactHash(miniAppV2()));
  });

  it("approving by quoting the NEW hash is refused: nothing was proposed under it", () => {
    const live = throughRegistration();
    const v2Hash = artifactHash(miniAppV2());

    const result = approve(live.ledger, {
      artifactId: "wc-clock",
      contentHash: v2Hash,
      by: SECOND_APPROVER,
      at: T.later,
    });
    // The id exists, the content moved — a different sentence from "never heard
    // of it", and a different next action.
    expect(result.reason).toBe("content_hash_mismatch");
  });

  it("registering the new hash is refused: there is no entry to register", () => {
    const live = throughRegistration();
    const result = register(live.ledger, {
      artifactId: "wc-clock",
      contentHash: artifactHash(miniAppV2()),
      by: ADMIN,
      at: T.later,
    });
    expect(result.reason).toBe("unknown_revision");
  });

  it("running v2 against v1's registration reports content drift, not 'not enabled'", () => {
    const live = throughRegistration();
    const ceiling = mustOk(enableFunctionWide(live.ledger, { artifactId: "wc-clock", by: ADMIN, at: T.enabled }));
    const project = mustOk(
      enableForProject(ceiling.ledger, { artifactId: "wc-clock", projectId: "bensheim", by: ADMIN, at: T.project }),
    );

    const drifted = reuseDecision(project.ledger, {
      artifactId: "wc-clock",
      projectId: "bensheim",
      artifact: miniAppV2(),
    });
    expect(drifted.allowed).toBe(false);
    expect(drifted.reason).toBe("content_drift");
    expect(drifted.verifiedAgainstContent).toBe(true);
    // No scopes leak out of a refusal.
    expect(drifted.grantedScopes).toEqual([]);

    // The approved bytes still pass, through the same call.
    const fine = reuseDecision(project.ledger, {
      artifactId: "wc-clock",
      projectId: "bensheim",
      artifact: miniApp(),
    });
    expect(fine.allowed).toBe(true);
  });

  it("a decision made without the bytes says so rather than implying it checked", () => {
    const live = throughRegistration();
    const ceiling = mustOk(enableFunctionWide(live.ledger, { artifactId: "wc-clock", by: ADMIN, at: T.enabled }));
    const project = mustOk(
      enableForProject(ceiling.ledger, { artifactId: "wc-clock", projectId: "bensheim", by: ADMIN, at: T.project }),
    );
    const blind = reuseDecision(project.ledger, { artifactId: "wc-clock", projectId: "bensheim" });
    expect(blind.allowed).toBe(true);
    expect(blind.verifiedAgainstContent).toBe(false);
  });
});

describe("the legitimate route: a NEW proposal", () => {
  it("v2 enters as `proposed` while v1 stays registered and keeps its approver", () => {
    const live = throughRegistration();
    const v2 = mustOk(
      propose(live.ledger, { artifact: miniAppV2(), workflowId: "orchestrate-workflow", by: AGENT, at: T.later }),
    );

    expect(v2.entry.state).toBe("proposed");
    expect(v2.entry.approval).toBeNull();
    expect(revisionsOf(v2.ledger, "wc-clock")).toHaveLength(2);
    expect(currentRegistered(v2.ledger, "wc-clock")?.contentHash).toBe(live.v1Hash);

    // And it still cannot be registered without its own signature.
    expect(
      register(v2.ledger, { artifactId: "wc-clock", contentHash: v2.entry.contentHash, by: ADMIN, at: T.latest })
        .reason,
    ).toBe("not_approved");
  });

  it("approving and registering v2 supersedes v1 without erasing it", () => {
    const live = throughRegistration();
    const v2 = mustOk(
      propose(live.ledger, { artifact: miniAppV2(), workflowId: "orchestrate-workflow", by: AGENT, at: T.later }),
    );
    const signed = mustOk(
      approve(v2.ledger, {
        artifactId: "wc-clock",
        contentHash: v2.entry.contentHash,
        by: SECOND_APPROVER,
        at: T.latest,
      }),
    );
    const promoted = mustOk(
      register(signed.ledger, { artifactId: "wc-clock", contentHash: v2.entry.contentHash, by: ADMIN, at: T.latest }),
    );

    expect(currentRegistered(promoted.ledger, "wc-clock")?.contentHash).toBe(v2.entry.contentHash);

    const old = promoted.ledger.entries.find((e) => e.contentHash === live.v1Hash);
    expect(old?.state).toBe("superseded");
    expect(old?.supersededBy).toBe(v2.entry.contentHash);
    // v1's signature is untouched: the trail keeps naming who approved what.
    expect(old?.approval?.approver.displayName).toBe("Karsten Haldan");
    expect(promoted.ledger.entries.find((e) => e.contentHash === v2.entry.contentHash)?.approval?.approver.displayName)
      .toBe("Mia Brandt");

    // Both signatures, and the supersession, are in the one trail.
    expect(promoted.ledger.history.filter((h) => h.event === "subapp.approved").map((h) => h.contentHash)).toEqual([
      live.v1Hash,
      v2.entry.contentHash,
    ]);
    expect(promoted.ledger.history.filter((h) => h.event === "subapp.superseded")[0]?.contentHash).toBe(live.v1Hash);
  });

  it("projects already enabled follow the newly approved revision without re-consenting", () => {
    const live = throughRegistration();
    const ceiling = mustOk(enableFunctionWide(live.ledger, { artifactId: "wc-clock", by: ADMIN, at: T.enabled }));
    const project = mustOk(
      enableForProject(ceiling.ledger, { artifactId: "wc-clock", projectId: "bensheim", by: ADMIN, at: T.project }),
    );
    const v2 = mustOk(
      propose(project.ledger, { artifact: miniAppV2(), workflowId: "orchestrate-workflow", by: AGENT, at: T.later }),
    );
    const signed = mustOk(
      approve(v2.ledger, { artifactId: "wc-clock", contentHash: v2.entry.contentHash, by: SECOND_APPROVER, at: T.latest }),
    );
    const promoted = mustOk(
      register(signed.ledger, { artifactId: "wc-clock", contentHash: v2.entry.contentHash, by: ADMIN, at: T.latest }),
    );

    // v2 now runs there — but only because a human signed v2, which is the
    // whole difference between this and "silently blessing v2".
    expect(reuseDecision(promoted.ledger, { artifactId: "wc-clock", projectId: "bensheim", artifact: miniAppV2() }).allowed)
      .toBe(true);
    // And the OLD bytes are now the drifted ones.
    expect(reuseDecision(promoted.ledger, { artifactId: "wc-clock", projectId: "bensheim", artifact: miniApp() }).reason)
      .toBe("content_drift");
  });
});

describe("what the digest covers, exactly", () => {
  it("covers the five things a human was shown, and nothing else", () => {
    expect([...HASHED_ARTIFACT_FIELDS]).toEqual(["id", "kind", "version", "capabilities", "files"]);
    expect(Object.keys(hashedShape(miniApp())).sort()).toEqual(
      ["capabilities", "files", "id", "kind", "version"],
    );
  });

  it("moves when the consent screen widens", () => {
    const narrow = miniApp({ capabilities: ["read:contracts"] });
    const wide = miniApp({ capabilities: ["read:contracts", "write:inbox-proposal"] });
    expect(artifactHash(narrow)).not.toBe(artifactHash(wide));
  });

  it("moves when the version label moves", () => {
    expect(artifactHash(miniApp({ version: "0.1.0" }))).not.toBe(artifactHash(miniApp({ version: "0.2.0" })));
  });

  it("moves when the id or the kind changes", () => {
    expect(artifactHash(miniApp())).not.toBe(artifactHash(miniApp({ id: "wc-clock-2" })));
    expect(artifactHash(miniApp())).not.toBe(artifactHash(miniApp({ kind: "script" })));
  });

  it("does NOT move for file order or capability order — those are not changes", () => {
    const forward = miniApp();
    const shuffled = miniApp({ files: [...forward.files].reverse() });
    expect(artifactHash(shuffled)).toBe(artifactHash(forward));

    const a = miniApp({ capabilities: ["read:contracts", "write:inbox-proposal"] });
    const b = miniApp({ capabilities: ["write:inbox-proposal", "read:contracts"] });
    expect(artifactHash(a)).toBe(artifactHash(b));
  });

  it("does not move when provenance or the proposer changes: those are process, not content", () => {
    const one = mustOk(propose(createLedger(), { artifact: miniApp(), workflowId: "orchestrate-workflow", by: AGENT, at: T.proposed }));
    const two = mustOk(propose(createLedger(), { artifact: miniApp(), workflowId: "quality-check", by: ADMIN, at: T.later }));
    expect(one.entry.contentHash).toBe(two.entry.contentHash);
  });
});
