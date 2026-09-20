/**
 * RED TEAM — attacks against @approvals, run against the real code.
 * Nothing here fixes anything. Each `it()` name states the attack; the
 * expectation states what the code ACTUALLY does today.
 */
import { describe, expect, it } from "vitest";
import { effectiveGrant, type GrantDecision } from "../decision";
import { intersectGrant, intersectGrantRows } from "../grant";
import { admitApproval } from "../approval";
import { classify } from "../../../guardrails/src/classify";
import type { GrantRow } from "../grant";
import type { ApprovalRecord } from "../approval";
import type { GrantStore } from "../store";
import { createMemoryGrantStore } from "../store";
import { CEILING_PROJECT_ID } from "../identity";
import {
  APPROVER, AT, CONTRACTS_INPUT, HASH_V1, HASH_V2, M365, OUTLOOK, PROJECT, SHAREPOINT, TOOL, VAULT,
  approval, ask, ceiling, ds, row, store,
} from "./support";

const log = (tag: string, d: GrantDecision) =>
  console.log(`[${tag}] allowed=${d.allowed} reason=${d.reason} tiers=[${d.effectiveTiers}] approval=${d.approval?.approverId ?? "-"}`);

/* ── A1 — project row claims MORE than the ceiling ───────────────────────── */
describe("A1 project row granting more than the ceiling", () => {
  it("tier: project claims 4 under a tier-2 ceiling", async () => {
    const s = store([ceiling([[CONTRACTS_INPUT, 2]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])]);
    const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
    log("A1.tier", d);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("tier_above_ceiling");
    expect(d.effectiveTiers).toEqual([1, 2]);
  });

  it("datasource: project names a datasource the ceiling never named", async () => {
    const s = store([ceiling([[SHAREPOINT, 4]]), row(PROJECT, [[SHAREPOINT, 4], [OUTLOOK, 4]])]);
    const d = await effectiveGrant({ store: s, ...ask({ datasource: OUTLOOK, tier: 1 }) });
    log("A1.ds", d);
    expect(d.allowed).toBe(false);
    const view = intersectGrantRows(
      { projectId: "*", toolId: TOOL, datasources: [{ datasource: SHAREPOINT, maxTier: 2 }] },
      { projectId: PROJECT, toolId: TOOL, datasources: [{ datasource: OUTLOOK, maxTier: 4 }] },
    );
    console.log("[A1.rows]", JSON.stringify(view));
    expect(view).toHaveLength(1);
    expect(view[0]!.datasource).toBe(SHAREPOINT);
  });

  it("the ceiling object reference is what is minted (no project value copied)", () => {
    const c: GrantRow = { projectId: "*", toolId: TOOL, datasources: [{ datasource: SHAREPOINT, maxTier: 2 }] };
    const p: GrantRow = { projectId: PROJECT, toolId: TOOL, datasources: [{ datasource: { ...SHAREPOINT }, maxTier: 4 }] };
    const r = intersectGrant(c, p, SHAREPOINT);
    expect(r.outcome).toBe("granted");
    if (r.outcome === "granted") expect(r.grant.datasource).toBe(SHAREPOINT);
  });
});

/* ── A2 — content hash: one byte changed ─────────────────────────────────── */
describe("A2 approve a tool, change one byte, reuse the approval", () => {
  it("honest caller presenting the NEW hash is refused", async () => {
    const s = store([ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])], [approval()]);
    const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4, contentHash: HASH_V2 }) });
    log("A2.honest", d);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("approval_content_hash_mismatch");
  });

  it("ATTACK: caller edits the tool and presents the OLD hash anyway", async () => {
    const s = store([ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])], [approval()]);
    // The package never computes a hash; contentHash is whatever the caller says.
    const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4, contentHash: HASH_V1 }) });
    log("A2.lying", d);
    expect(d.allowed).toBe(true); // <= NOT BLOCKED inside this package
  });
});

/* ── A3 — who may approve ────────────────────────────────────────────────── */
describe("A3 approver identity", () => {
  const base = [ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])];
  const tryApprover = async (approvedBy: ApprovalRecord["approvedBy"]) => {
    const s = store(base, [approval({ approvedBy })]);
    return effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
  };

  it("agent", async () => { const d = await tryApprover({ kind: "agent", id: "crew.auditor", displayName: "Auditor" }); log("A3.agent", d); expect(d.reason).toBe("approval_actor_not_human"); });
  it("system", async () => { const d = await tryApprover({ kind: "system", id: "system", displayName: "System" }); log("A3.system", d); expect(d.reason).toBe("approval_actor_not_human"); });
  it("tool", async () => { const d = await tryApprover({ kind: "tool", id: "some-tool", displayName: "T" }); log("A3.tool", d); expect(d.reason).toBe("approval_actor_not_human"); });
  it("empty id", async () => { const d = await tryApprover({ kind: "human", id: "", displayName: "X" }); log("A3.emptyid", d); expect(d.reason).toBe("approval_actor_missing"); });
  it("whitespace id", async () => { const d = await tryApprover({ kind: "human", id: "   ", displayName: "X" }); log("A3.wsid", d); expect(d.reason).toBe("approval_actor_missing"); });
  it("no display name", async () => { const d = await tryApprover({ kind: "human", id: "u_81f3" }); log("A3.noname", d); expect(d.reason).toBe("approval_actor_missing"); });
  it("the tool's own id", async () => { const d = await tryApprover({ kind: "human", id: TOOL, displayName: "WC Gap Report" }); log("A3.self", d); expect(d.reason).toBe("approval_self_approved"); });
  it("the tool's own id, cased differently", async () => { const d = await tryApprover({ kind: "human", id: TOOL.toUpperCase(), displayName: "x" }); log("A3.selfcase", d); expect(d.reason).toBe("approval_self_approved"); });

  it("ATTACK: a SERVICE ACCOUNT that declares itself human", async () => {
    const d = await tryApprover({ kind: "human", id: "svc-ci-runner", displayName: "CI Runner (service)" });
    log("A3.svc", d);
    expect(d.allowed).toBe(true); // <= NOT BLOCKED
    expect(d.approval?.approverId).toBe("svc-ci-runner");
  });

  it("ATTACK: a human named 'system'", async () => {
    const d = await tryApprover({ kind: "human", id: "system", displayName: "system" });
    log("A3.humansystem", d);
    expect(d.allowed).toBe(true); // <= NOT BLOCKED
  });

  it("ATTACK: the AGENT that requested it also 'approves', under kind human", async () => {
    const s = store(base, [approval({ approvedBy: { kind: "human", id: "crew.contract-auditor", displayName: "Contract Auditor" } })]);
    const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4, requestedBy: { kind: "agent", id: "crew.contract-auditor" } }) });
    log("A3.requester-approves", d);
    expect(d.allowed).toBe(true); // <= NOT BLOCKED: requester === approver
  });
});

/* ── A4 — connector sub-scope leakage ────────────────────────────────────── */
describe("A4 grant microsoft-365, reach Outlook", () => {
  it("bare connector grant does not reach any sub-scope", async () => {
    const s = store([ceiling([[M365, 4]]), row(PROJECT, [[M365, 4]])]);
    for (const scope of ["SharePoint", "Teams", "Outlook", "Entra"]) {
      const d = await effectiveGrant({ store: s, ...ask({ datasource: ds("connector", "microsoft-365", scope), tier: 1 }) });
      log(`A4.${scope}`, d);
      expect(d.allowed).toBe(false);
    }
  });
  it("SharePoint grant does not reach Outlook", async () => {
    const s = store([ceiling([[SHAREPOINT, 4]]), row(PROJECT, [[SHAREPOINT, 4]])]);
    const d = await effectiveGrant({ store: s, ...ask({ datasource: OUTLOOK, tier: 1 }) });
    log("A4.sp->outlook", d);
    expect(d.allowed).toBe(false);
  });
  it("an APPROVAL for SharePoint is not a candidate for Outlook", () => {
    const v = admitApproval([approval({ datasource: SHAREPOINT })], { toolId: TOOL, contentHash: HASH_V1, projectId: PROJECT, datasource: OUTLOOK, tier: 4 });
    console.log("[A4.approval-xscope]", JSON.stringify(v));
    expect(v.ok).toBe(false);
  });
});

/* ── A5 — path traversal to a sibling root ───────────────────────────────── */
describe("A5 obsidian-vault -> contracts", () => {
  const s = () => store([ceiling([[VAULT, 4]]), row(PROJECT, [[VAULT, 4]])]);
  const probes: Array<[string, string, string | undefined]> = [
    ["sibling root", "contracts", undefined],
    ["dotdot scope", "obsidian-vault", "../contracts"],
    ["dotdot deep", "obsidian-vault", "a/../../contracts"],
    ["encoded dotdot", "obsidian-vault", "%2e%2e/contracts"],
    ["backslash", "obsidian-vault", "..\\contracts"],
    ["absolute", "obsidian-vault", "/contracts"],
    ["triple dot", "obsidian-vault", ".../contracts"],
    ["nul-ish", "obsidian-vault", "contracts\u0000x"],
    ["single dot", "obsidian-vault", "./contracts"],
    ["sub-path", "obsidian-vault", "contracts"],
  ];
  for (const [name, id, scope] of probes) {
    it(name, async () => {
      const d = await effectiveGrant({ store: s(), ...ask({ datasource: ds("repo-path", id, scope), tier: 1 }) });
      log(`A5.${name}`, d);
      expect(d.allowed).toBe(false);
    });
  }
  it("id itself cannot carry traversal", async () => {
    for (const id of ["../contracts", "..", "obsidian-vault/../contracts", "/contracts"]) {
      const d = await effectiveGrant({ store: s(), ...ask({ datasource: ds("repo-path", id), tier: 1 }) });
      log(`A5.id:${id}`, d);
      expect(d.reason).toBe("invalid_datasource");
    }
  });
  it("NOTE: `..` is refused in scope but NOT screened in id", async () => {
    const weird = ds("repo-path", "obsidian-vault..contracts");
    const s2 = store([ceiling([[weird, 4]]), row(PROJECT, [[weird, 4]])]);
    const d = await effectiveGrant({ store: s2, ...ask({ datasource: weird, tier: 1 }) });
    log("A5.dotdot-in-id", d);
    expect(d.allowed).toBe(true); // accepted as an id; harmless as a key, a hazard if a consumer joins it to a path
  });
});

/* ── A6 — revoke, then reuse the decision object ─────────────────────────── */
describe("A6 revocation vs a decision already in hand", () => {
  it("the NEXT call sees the revocation immediately", async () => {
    const s = store([ceiling([[CONTRACTS_INPUT, 2]]), row(PROJECT, [[CONTRACTS_INPUT, 2]])]);
    const before = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 2 }) });
    expect(before.allowed).toBe(true);
    s.revokeGrantRow(CEILING_PROJECT_ID, TOOL, AT);
    const after = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 2 }) });
    log("A6.after-revoke", after);
    expect(after.allowed).toBe(false);
    expect(after.reason).toBe("ceiling_revoked");
    expect(s.counts.grantRows).toBeGreaterThanOrEqual(4); // no caching
  });

  it("ATTACK: the OLD decision object still reads allowed=true forever", async () => {
    const s = store([ceiling([[CONTRACTS_INPUT, 2]]), row(PROJECT, [[CONTRACTS_INPUT, 2]])]);
    const held = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 2 }) });
    s.revokeGrantRow(CEILING_PROJECT_ID, TOOL, AT);
    s.revokeGrantRow(PROJECT, TOOL, AT);
    console.log("[A6.held]", held.allowed, held.reason, "no expiry field:", !("expiresAt" in held));
    expect(held.allowed).toBe(true); // <= NOT BLOCKED: nothing in the object goes stale
  });

  it("ATTACK: a GrantDecision can simply be forged — it carries no brand", async () => {
    const real = await effectiveGrant({ store: store([]), ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
    const forged: GrantDecision = { ...real, allowed: true, reason: "allowed", effectiveTiers: [1, 2, 3, 4], approval: { approverId: "nobody", approverName: "Nobody", approvedAt: AT, tier: 4 } };
    console.log("[A6.forged]", forged.allowed, forged.reason, "typechecks:", true);
    expect(forged.allowed).toBe(true); // <= structural type, no unique symbol, no verifier
  });

  it("approval revocation is seen on the next call", async () => {
    const s = store([ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])], [approval()]);
    expect((await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) })).allowed).toBe(true);
    s.revokeApproval(0, AT);
    const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
    log("A6.approval-revoked", d);
    expect(d.reason).toBe("approval_revoked");
  });
});

/* ── A7 — declared tier vs computed tier ─────────────────────────────────── */
describe("A7 request tier 4 data while declaring tier 2", () => {
  const PERSON_BEARING = { employee: { name: "Maren Keller", iban: "DE89370400440532013000", salary_eur: 84000 } };

  it("guardrails computes tier 4 for the payload", () => {
    const c = classify(PERSON_BEARING);
    console.log("[A7.computed]", c.tier, c.findings.map((f) => `${f.class}:${f.tier}`).join(","));
    expect(c.tier).toBe(4);
  });

  it("declaring the true tier 4 needs a named human", async () => {
    const s = store([ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])]);
    const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
    log("A7.truthful", d);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("approval_required");
  });

  it("ATTACK: declare tier 2 for the same tier-4 payload — no approval, allowed", async () => {
    const computed = classify(PERSON_BEARING).tier;
    const s = store([ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])]);
    const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 2 }) });
    log("A7.lying", d);
    console.log("[A7] computed tier:", computed, "declared tier: 2", "requiresNamedApproval:", d.requiresNamedApproval);
    expect(computed).toBe(4);
    expect(d.allowed).toBe(true);           // <= NOT BLOCKED
    expect(d.requiresNamedApproval).toBe(false);
    expect(d.approval).toBeNull();
    expect(d.audit.tier).toBe(2);           // the audit log records the LIE
  });
});

/* ── A8 — races ──────────────────────────────────────────────────────────── */
describe("A8 concurrent / conflicting writes", () => {
  it("two approvals, one narrower: FIRST admissible in array order wins", () => {
    const narrow = approval({ tier: 3, approvedBy: { kind: "human", id: "a.narrow", displayName: "A Narrow" } });
    const wide = approval({ tier: 4, approvedBy: { kind: "human", id: "b.wide", displayName: "B Wide" } });
    const q = { toolId: TOOL, contentHash: HASH_V1, projectId: PROJECT, datasource: CONTRACTS_INPUT, tier: 3 as const };
    const a = admitApproval([narrow, wide], q);
    const b = admitApproval([wide, narrow], q);
    console.log("[A8.order]", a.ok && a.approval.approvedBy.id, b.ok && b.approval.approvedBy.id);
    expect(a.ok && a.approval.approvedBy.id).toBe("a.narrow");
    expect(b.ok && b.approval.approvedBy.id).toBe("b.wide"); // order decides, not narrowness
  });

  it("ATTACK: a tier-4 approval swallows a later narrowing to tier 3", () => {
    const wide = approval({ tier: 4 });
    const narrow = approval({ tier: 3 });
    const v = admitApproval([wide, narrow], { toolId: TOOL, contentHash: HASH_V1, projectId: PROJECT, datasource: CONTRACTS_INPUT, tier: 4 });
    console.log("[A8.widest-wins]", JSON.stringify(v.ok));
    expect(v.ok).toBe(true); // narrowing an approval means REVOKING it; adding a narrow one does nothing
  });

  it("ATTACK: grant rows are last-write-wins, no version / CAS", async () => {
    const s = store([ceiling([[CONTRACTS_INPUT, 2]])]);
    s.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 1]])); // operator A narrows
    s.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 2]])); // operator B widens, unaware
    const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 2 }) });
    log("A8.lww", d);
    expect(d.allowed).toBe(true); // A's narrowing is gone without a trace
  });

  it("ATTACK: TOCTOU — a revoke landing BETWEEN the two row reads is straddled", async () => {
    const mem = createMemoryGrantStore({ rows: [ceiling([[CONTRACTS_INPUT, 2]]), row(PROJECT, [[CONTRACTS_INPUT, 2]])] });
    let n = 0;
    const racing: GrantStore = {
      async readGrantRow(p, t) {
        const r = await mem.readGrantRow(p, t);
        if (++n === 1) mem.revokeGrantRow(CEILING_PROJECT_ID, TOOL, AT); // revoked after the ceiling read
        return r;
      },
      readApprovals: mem.readApprovals,
    };
    const d = await effectiveGrant({ store: racing, ...ask({ datasource: CONTRACTS_INPUT, tier: 2 }) });
    log("A8.toctou", d);
    expect(d.allowed).toBe(true); // <= NOT BLOCKED: the two reads are not one snapshot
    const next = await effectiveGrant({ store: mem, ...ask({ datasource: CONTRACTS_INPUT, tier: 2 }) });
    expect(next.reason).toBe("ceiling_revoked");
  });

  it("ATTACK: approval read is a THIRD read, after both row reads", async () => {
    const mem = createMemoryGrantStore({ rows: [ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])], approvals: [approval()] });
    const racing: GrantStore = {
      readGrantRow: mem.readGrantRow,
      async readApprovals(p, t) { mem.revokeGrantRow(CEILING_PROJECT_ID, TOOL, AT); return mem.readApprovals(p, t); },
    };
    const d = await effectiveGrant({ store: racing, ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
    log("A8.toctou-approval", d);
    expect(d.allowed).toBe(true); // grant revoked mid-decision, decision still allow
  });
});

/* ── A9 — datasource id confusables ──────────────────────────────────────── */
describe("A9 case / trailing slash / unicode lookalikes", () => {
  const granted = [ceiling([[SHAREPOINT, 4]]), row(PROJECT, [[SHAREPOINT, 4]])];
  const probe = async (d: ReturnType<typeof ds>) => effectiveGrant({ store: store(granted), ...ask({ datasource: d, tier: 1 }) });

  it("id in upper case is REFUSED as malformed", async () => {
    const d = await probe(ds("connector", "Microsoft-365", "SharePoint"));
    log("A9.id-upper", d);
    expect(d.reason).toBe("invalid_datasource");
  });
  it("id with a trailing slash is refused", async () => { const d = await probe(ds("connector", "microsoft-365/", "SharePoint")); log("A9.id-slash", d); expect(d.reason).toBe("invalid_datasource"); });
  it("id with a trailing space is refused", async () => { const d = await probe(ds("connector", "microsoft-365 ", "SharePoint")); log("A9.id-space", d); expect(d.reason).toBe("invalid_datasource"); });
  it("cyrillic 'о' lookalike in id is refused", async () => { const d = await probe(ds("connector", "micrоsoft-365", "SharePoint")); log("A9.id-cyr", d); expect(d.reason).toBe("invalid_datasource"); });
  it("fullwidth digit in id is refused", async () => { const d = await probe(ds("connector", "microsoft-3６5", "SharePoint")); log("A9.id-fw", d); expect(d.reason).toBe("invalid_datasource"); });

  it("scope in a different case does NOT match (fail-closed)", async () => { const d = await probe(ds("connector", "microsoft-365", "sharepoint")); log("A9.scope-case", d); expect(d.reason).toBe("no_ceiling_grant_for_datasource"); });
  it("scope with a trailing slash does NOT match (fail-closed)", async () => { const d = await probe(ds("connector", "microsoft-365", "SharePoint/")); log("A9.scope-slash", d); expect(d.reason).toBe("no_ceiling_grant_for_datasource"); });
  it("cyrillic lookalike in scope is refused as malformed", async () => { const d = await probe(ds("connector", "microsoft-365", "ShareРoint")); log("A9.scope-cyr", d); expect(d.reason).toBe("invalid_datasource"); });
  it("a scope that NFKC-normalizes to SharePoint is refused (no normalization happens)", async () => {
    const fullwidthS = "\uFF33harePoint";
    expect(fullwidthS.normalize("NFKC")).toBe("SharePoint");
    const d = await probe(ds("connector", "microsoft-365", fullwidthS));
    log("A9.scope-nfkc", d);
    expect(d.reason).toBe("invalid_datasource");
  });

  it("ATTACK: a GRANT ROW may be WRITTEN with a malformed datasource and is unreachable-but-present", async () => {
    const bad = ds("connector", "Microsoft-365", "SharePoint"); // never validated on write
    const s = store([ceiling([[bad, 4]]), row(PROJECT, [[bad, 4]])]);
    const d = await effectiveGrant({ store: s, ...ask({ datasource: bad, tier: 1 }) });
    log("A9.written-malformed", d);
    expect(d.reason).toBe("invalid_datasource"); // read path refuses; the row still sits in the store
  });
});

/* ── A10 — the '*' escape hatch ──────────────────────────────────────────── */
describe("A10 asking as project '*'", () => {
  it("ATTACK: a narrowed project simply declares projectId='*' and gets the ceiling", async () => {
    const s = store([ceiling([[CONTRACTS_INPUT, 2]]), row(PROJECT, [[CONTRACTS_INPUT, 1]])]);
    const narrowed = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 2 }) });
    log("A10.as-project", narrowed);
    expect(narrowed.allowed).toBe(false);
    expect(narrowed.reason).toBe("tier_above_project");

    const asCeiling = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 2, projectId: "*" }) });
    log("A10.as-star", asCeiling);
    expect(asCeiling.allowed).toBe(true); // <= NOT BLOCKED: the narrowing is opt-in by the caller
  });

  it("a project id is otherwise uncollidable with '*'", async () => {
    for (const pid of ["*", "**", "%2A", "＊", "-star", "Rhineland", "rhine_land", "a".repeat(65)]) {
      const d = await effectiveGrant({ store: store([]), ...ask({ datasource: CONTRACTS_INPUT, tier: 1, projectId: pid }) });
      console.log(`[A10.pid:${pid}]`, d.reason);
      if (pid !== "*") expect(d.reason).toBe("invalid_project_id");
    }
  });

  it("tier 3 at '*' still needs an approval recorded at '*'", async () => {
    const s = store([ceiling([[CONTRACTS_INPUT, 4]])], [approval({ projectId: PROJECT })]);
    const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 3, projectId: "*" }) });
    log("A10.star-tier3", d);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("approval_required");
  });
});

/* ── A11 — audit body leakage ────────────────────────────────────────────── */
describe("A11 audit body", () => {
  it("an approver note never reaches the audit body", async () => {
    const s = store([ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])], [approval({ note: "ok per Maren Keller, IBAN DE89370400440532013000" })]);
    const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
    const json = JSON.stringify(d.audit);
    console.log("[A11.audit]", json);
    expect(json).not.toContain("DE89370400440532013000");
    expect(json).not.toContain("Maren Keller");
  });
  it("but the DECISION object hands the approver's display name to the caller", async () => {
    const s = store([ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])], [approval()]);
    const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
    console.log("[A11.decision-name]", d.approval?.approverName);
    expect(d.approval?.approverName).toBe(APPROVER.displayName);
  });
});

/* ── A12 — TWO approval implementations in one repo ──────────────────────── */
import { checkApproval, isNamedHuman, contentHash as guardrailsHash } from "../../../guardrails/src/approval";

describe("A12 divergence: packages/guardrails also implements 'named human approval'", () => {
  const base = [ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])];

  it("ATTACK: an approver guardrails calls UNNAMED is admitted by approvals", async () => {
    for (const name of ["system", "automation", "agent", "studio", "admin", "unknown", "the approver"]) {
      expect(isNamedHuman(name)).toBe(false); // guardrails refuses it
      const s = store(base, [approval({ approvedBy: { kind: "human", id: name, displayName: name } })]);
      const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
      console.log(`[A12.${name}] guardrails=refuse approvals=${d.allowed ? "ALLOW" : "refuse"} (${d.reason})`);
      expect(d.allowed).toBe(true); // <= the two gates disagree
    }
  });

  it("ATTACK: approvals compares a hash it is HANDED; guardrails computes its own", () => {
    const proposal = { id: "wc-gap-report", files: [{ path: "a.ts", text: "export const x = 1;" }] };
    const edited = { id: "wc-gap-report", files: [{ path: "a.ts", text: "export const x = 2;" }] };
    const signed = { approver: "Maren Keller", contentHash: guardrailsHash(proposal), at: AT, scope: "registration" as const };
    const g = checkApproval(edited, "registration", signed);
    console.log("[A12.hash] guardrails on edited content:", g.ok, g.problem);
    expect(g.ok).toBe(false); // guardrails recomputes and catches the edit
    // approvals cannot: it never sees the content, only a string the caller chose. See A2.lying.
  });

  it("no consumer wires the two together today", () => {
    console.log("[A12.wiring] effectiveGrant() has zero call sites outside its own tests");
    expect(true).toBe(true);
  });
});
