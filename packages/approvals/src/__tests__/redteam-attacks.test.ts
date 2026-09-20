/**
 * RED TEAM — attacks against @approvals, run against the real code.
 *
 * Nothing here fixes anything. Each `it()` name states the attack; the
 * expectation states what the code ACTUALLY does. Cases that once recorded a
 * bypass now record the refusal CODE, which is the stronger assertion: a
 * refusal that cannot name its reason is one `if` away from being a refusal
 * that does not happen.
 */
import { describe, expect, it } from "vitest";
import { decisionIsUsable, effectiveGrant, verifyDecision, type GrantDecision } from "../decision";
import { intersectGrant, intersectGrantRows } from "../grant";
import { admitApproval } from "../approval";
import { classify } from "../../../guardrails/src/classify";
import type { GrantRow } from "../grant";
import type { ApprovalRecord } from "../approval";
import type { GrantStore } from "../store";
import { createMemoryGrantStore } from "../store";
import { CEILING_PROJECT_ID } from "../identity";
import { classifyEveryRepresentation } from "../../../guardrails/src/representations";
import {
  APPROVER, AT, CONTRACTS_INPUT, HASH_V1, HASH_V2, LATER, M365, OUTLOOK, PROJECT, SHAREPOINT, SOON,
  TOOL, TOOL_V1, TOOL_V2, VAULT,
  approval, ask, ceiling, directory, ds, payloadFor, row, store,
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
    const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4, toolContent: TOOL_V2 }) });
    log("A2.honest", d);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("approval_content_hash_mismatch");
  });

  it("BLOCKED: there is no field left to present a stale hash in", async () => {
    const s = store([ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])], [approval()]);
    // The request carries the tool CONTENT. `contentHash` is computed from it by
    // guardrails' single hasher, so "edit the tool, send the old digest" is not
    // an attack that has an input.
    const edited = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4, toolContent: TOOL_V2 }) });
    log("A2.edited", edited);
    expect(edited.allowed).toBe(false);
    expect(edited.reason).toBe("approval_content_hash_mismatch");
    expect(edited.contentHash).toBe(HASH_V2);

    const unedited = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4, toolContent: TOOL_V1 }) });
    expect(unedited.allowed).toBe(true);
    expect(unedited.contentHash).toBe(HASH_V1);
  });

  it("BLOCKED: one changed byte of tool content changes the computed hash", async () => {
    const s = store([ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])], [approval()]);
    const oneByte = { ...TOOL_V1, files: [{ path: "report.ts", text: "export const rows = 1; " }] };
    const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4, toolContent: oneByte }) });
    log("A2.onebyte", d);
    expect(d.reason).toBe("approval_content_hash_mismatch");
  });

  it("key order in the tool content is not a second tool", async () => {
    const reordered = { files: TOOL_V1.files, id: TOOL_V1.id };
    const s = store([ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])], [approval()]);
    const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4, toolContent: reordered }) });
    expect(d.allowed).toBe(true);
  });
});

/* ── A3 — who may approve ────────────────────────────────────────────────── */
describe("A3 approver identity", () => {
  const base = [ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])];
  const tryApprover = async (approvedBy: ApprovalRecord["approvedBy"]) => {
    const s = store(base, [approval({ approvedBy })]);
    return effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
  };

  it("agent", async () => { const d = await tryApprover({ kind: "agent", id: "crew.contract-auditor", displayName: "Auditor" }); log("A3.agent", d); expect(d.reason).toBe("approval_actor_not_human"); });
  it("system", async () => { const d = await tryApprover({ kind: "system", id: "scheduler", displayName: "System" }); log("A3.system", d); expect(d.reason).toBe("approval_actor_not_human"); });
  it("tool", async () => { const d = await tryApprover({ kind: "tool", id: "some-tool", displayName: "T" }); log("A3.tool", d); expect(d.reason).toBe("approval_identity_unknown"); });
  it("empty id", async () => { const d = await tryApprover({ kind: "human", id: "", displayName: "X" }); log("A3.emptyid", d); expect(d.reason).toBe("approval_actor_missing"); });
  it("whitespace id", async () => { const d = await tryApprover({ kind: "human", id: "   ", displayName: "X" }); log("A3.wsid", d); expect(d.reason).toBe("approval_actor_missing"); });
  it("no display name", async () => { const d = await tryApprover({ kind: "human", id: "u_81f3" }); log("A3.noname", d); expect(d.reason).toBe("approval_actor_missing"); });
  it("the tool's own id", async () => { const d = await tryApprover({ kind: "human", id: TOOL, displayName: "WC Gap Report" }); log("A3.self", d); expect(d.reason).toBe("approval_self_approved"); });
  it("the tool's own id, cased differently", async () => { const d = await tryApprover({ kind: "human", id: TOOL.toUpperCase(), displayName: "x" }); log("A3.selfcase", d); expect(d.reason).toBe("approval_self_approved"); });

  it("BLOCKED: a SERVICE ACCOUNT that declares itself human", async () => {
    // The row says `kind: "human"`. Nothing reads it: the directory says the
    // subject `svc-ci-runner` is a system account, and the directory is the
    // authority on what a subject IS.
    const d = await tryApprover({ kind: "human", id: "svc-ci-runner", displayName: "CI Runner (service)" });
    log("A3.svc", d);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("approval_actor_not_human");
    expect(d.approval).toBeNull();
  });

  it("BLOCKED: a human named 'system'", async () => {
    const d = await tryApprover({ kind: "human", id: "system", displayName: "system" });
    log("A3.humansystem", d);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("approval_actor_not_human");
  });

  it("BLOCKED: a subject the directory has never heard of", async () => {
    const d = await tryApprover({ kind: "human", id: "ghost.approver", displayName: "Ghost" });
    log("A3.ghost", d);
    expect(d.reason).toBe("approval_identity_unknown");
  });

  it("BLOCKED: a human who has left — the signature stays readable, not usable", async () => {
    const d = await tryApprover({ kind: "human", id: "r.retired", displayName: "Rita Retired" });
    log("A3.retired", d);
    expect(d.reason).toBe("approval_identity_inactive");
  });

  it("BLOCKED: the AGENT that requested it also 'approves', under kind human", async () => {
    const s = store(base, [approval({ approvedBy: { kind: "human", id: "crew.contract-auditor", displayName: "Contract Auditor" } })]);
    const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4, requestedBy: { kind: "agent", id: "crew.contract-auditor" } }) });
    log("A3.requester-approves", d);
    expect(d.allowed).toBe(false);
    // Two independent reasons, and the more fundamental one is reported: the
    // directory says `crew.contract-auditor` is an AGENT, whatever the row
    // claims. Four eyes is demonstrated on a real human below, where "not a
    // human" cannot be doing the work.
    expect(d.reason).toBe("approval_actor_not_human");
  });

  it("BLOCKED: a human requester signing their own request", async () => {
    const s = store(base, [approval({ approvedBy: { kind: "human", id: "m.keller", displayName: "Maren Keller" } })]);
    const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4, requestedBy: { kind: "human", id: "M.Keller" } }) });
    log("A3.human-self", d);
    expect(d.reason).toBe("approval_requester_is_approver");
  });

  it("a DIFFERENT named human still signs it off", async () => {
    const s = store(base, [approval({ approvedBy: { kind: "human", id: "j.oduya" } })]);
    const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
    log("A3.four-eyes-ok", d);
    expect(d.allowed).toBe(true);
    // The NAME comes from the directory, never from the row.
    expect(d.approval?.approverName).toBe("Joseph Oduya");
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
  it("an APPROVAL for SharePoint is not a candidate for Outlook", async () => {
    const v = await admitApproval(
      [approval({ datasource: SHAREPOINT })],
      { toolId: TOOL, contentHash: HASH_V1, projectId: PROJECT, datasource: OUTLOOK, tier: 4, requestedById: "crew.contract-auditor" },
      directory(),
    );
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
  it("BLOCKED: `..` is refused in the id as well as in the scope", async () => {
    // The same screen on both of the two fields a consumer would join to a
    // filesystem path. It was on one of them, which is a guard anchored on one
    // representation of the same hazard.
    const weird = ds("repo-path", "obsidian-vault..contracts");
    const s2 = store([ceiling([[weird, 4]]), row(PROJECT, [[weird, 4]])]);
    const d = await effectiveGrant({ store: s2, ...ask({ datasource: weird, tier: 1 }) });
    log("A5.dotdot-in-id", d);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("invalid_datasource");
    for (const id of ["a..b", "..", "x..", "..y", "obsidian-vault..", "a.b..c"]) {
      const probe = await effectiveGrant({ store: s2, ...ask({ datasource: ds("repo-path", id), tier: 1 }) });
      expect(probe.reason).toBe("invalid_datasource");
    }
    // and a single dot in an id is still an ordinary id
    const dotted = ds("repo-path", "obsidian-vault.archive");
    const s3 = store([ceiling([[dotted, 4]]), row(PROJECT, [[dotted, 4]])]);
    expect((await effectiveGrant({ store: s3, ...ask({ datasource: dotted, tier: 1 }) })).allowed).toBe(true);
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

  it("PARTLY BLOCKED: a held decision expires, and says when it stopped describing anything", async () => {
    const s = store([ceiling([[CONTRACTS_INPUT, 2]]), row(PROJECT, [[CONTRACTS_INPUT, 2]])]);
    const held = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 2 }) });
    s.revokeGrantRow(CEILING_PROJECT_ID, TOOL, AT);
    s.revokeGrantRow(PROJECT, TOOL, AT);
    console.log("[A6.held]", held.allowed, held.reason, "issued:", held.issuedAt, "expires:", held.expiresAt);

    // The field still reads true — it is a RECORD of a past answer, and no
    // object can retract itself. What changed is that reading it that way is no
    // longer the supported route, and the supported route knows about time.
    expect(held.allowed).toBe(true);
    expect(decisionIsUsable(held, SOON)).toEqual({ ok: true });
    expect(decisionIsUsable(held, LATER)).toEqual({ ok: false, problem: "expired" });

    // ⚠ STATED RESIDUAL: within the window, a held decision is still wrong
    // about a revocation that has since landed. Only asking again fixes that,
    // and asking again is cheap.
    const again = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 2 }) });
    expect(again.reason).toBe("ceiling_revoked");
  });

  it("BLOCKED: a forged GrantDecision does not verify", async () => {
    const real = await effectiveGrant({ store: store([]), ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
    expect(verifyDecision(real)).toBe(true);

    // The seal is non-enumerable, so the spread does not carry it; and its
    // value is an HMAC over the fields it was taken from, so a seal copied on
    // purpose stops describing them the moment one is edited. Two defences,
    // because a brand valued `true` would have survived the spread.
    const forged: GrantDecision = { ...real, allowed: true, reason: "allowed", effectiveTiers: [1, 2, 3, 4], approval: { approverId: "nobody", approverName: "Nobody", approvedAt: AT, tier: 4 } };
    console.log("[A6.forged]", forged.allowed, forged.reason, "verifies:", verifyDecision(forged));
    expect(forged.allowed).toBe(true); // the field is still a boolean someone wrote
    expect(verifyDecision(forged)).toBe(false); // but it is not an answer
    expect(decisionIsUsable(forged, SOON)).toEqual({ ok: false, problem: "forged" });
  });

  it("BLOCKED: no copy verifies — not a spread, not a reflected one, not an edited one", async () => {
    // A REFUSAL is the base, so every edit below is a real change: flipping
    // `allowed` on a decision that already allows would test nothing.
    const s = store([]);
    const real = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
    expect(real.allowed).toBe(false);
    expect(real.tier).toBe(4);
    expect(real.requiresNamedApproval).toBe(true);
    expect(verifyDecision(real)).toBe(true);

    // Defence 1: the seal is NON-ENUMERABLE, so a spread does not carry it.
    // Even a faithful copy fails, which is correct — `verifyDecision` answers
    // "did this package mint this object", and a copy was minted by the copier.
    expect(verifyDecision({ ...real })).toBe(false);

    // Defence 2: copy it ON PURPOSE, the way an attacker would, and the HMAC
    // catches the edit because it describes the fields it was taken from.
    const carried = (source: GrantDecision, edit: Partial<GrantDecision>): GrantDecision => {
      const copy: Record<PropertyKey, unknown> = { ...source, ...edit };
      for (const sym of Object.getOwnPropertySymbols(source)) {
        copy[sym] = Reflect.get(source, sym);
      }
      return copy as unknown as GrantDecision;
    };
    expect(verifyDecision(carried(real, {}))).toBe(true); // the seal really did travel
    const edits: Array<Partial<GrantDecision>> = [
      { allowed: true }, { reason: "allowed" }, { tier: 1 }, { requiresNamedApproval: false },
      { effectiveTiers: [1, 2, 3, 4] }, { ceilingMaxTier: 4 }, { projectMaxTier: 4 },
      { contentHash: HASH_V2 }, { expiresAt: "2099-01-01T00:00:00.000Z" },
      { approval: { approverId: "x", approverName: "X", approvedAt: AT, tier: 4 } },
    ];
    for (const edit of edits) {
      expect(verifyDecision(carried(real, edit))).toBe(false);
      expect(verifyDecision({ ...real, ...edit } as GrantDecision)).toBe(false);
    }
  });

  it("BLOCKED: a decision written from scratch carries no seal at all", () => {
    const scratch = {
      allowed: true, reason: "allowed", tier: 4, classification: [], contentHash: HASH_V1,
      requiresNamedApproval: false, ceilingGranted: true, projectGranted: true,
      ceilingMaxTier: 4, projectMaxTier: 4, effectiveTiers: [1, 2, 3, 4], approval: null,
      issuedAt: AT, expiresAt: "2099-01-01T00:00:00.000Z", audit: {},
    };
    // It cannot even be TYPED as a GrantDecision: the seal is keyed by a symbol
    // this module cannot name. The cast is what an attacker would write.
    expect(verifyDecision(scratch as unknown as GrantDecision)).toBe(false);
    expect(verifyDecision(JSON.parse(JSON.stringify(scratch)))).toBe(false);
  });

  it("a decision does not survive serialization, and should not", async () => {
    const s = store([ceiling([[CONTRACTS_INPUT, 2]]), row(PROJECT, [[CONTRACTS_INPUT, 2]])]);
    const real = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 2 }) });
    const roundTripped = JSON.parse(JSON.stringify(real));
    console.log("[A6.wire] seal survives JSON:", verifyDecision(roundTripped));
    expect(verifyDecision(roundTripped)).toBe(false);
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

/* ── A7 — THE DECLARED TIER, WHICH NO LONGER EXISTS ──────────────────── */
describe("A7 request tier-4 data while declaring tier 2", () => {
  const PERSON_BEARING = { employee: { name: "Maren Keller", iban: "DE89370400440532013000", salary_eur: 84000 } };
  const INNOCENT = { headline: "Quarterly overview", count: 12 };
  const rows = [ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])];

  it("guardrails computes tier 4 for the payload", () => {
    const c = classify(PERSON_BEARING);
    console.log("[A7.computed]", c.tier, c.findings.map((f) => `${f.class}:${f.tier}`).join(","));
    expect(c.tier).toBe(4);
  });

  it("BLOCKED: there is no `tier` field to declare", async () => {
    const d = await effectiveGrant({ store: store(rows), ...ask({ datasource: CONTRACTS_INPUT, tier: 4, payload: PERSON_BEARING }) });
    log("A7.truthful", d);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("approval_required");
    expect(d.tier).toBe(4);
    expect(d.requiresNamedApproval).toBe(true);
    // and the audit body records the COMPUTED tier, so the append-only log
    // cannot memorialise a tier nobody checked
    expect(d.audit.tier).toBe(4);
  });

  it("BLOCKED: the identical payload cannot be presented as anything else", async () => {
    // The old attack was `ask({tier: 2})` with this payload. `ask` now selects
    // the payload FROM the tier, so the only way to express the attack is to
    // send the tier-4 data under a request that wants a tier-2 answer — which
    // is what this is. The answer is derived from the bytes, not from the ask.
    const lying = await effectiveGrant({ store: store(rows), ...ask({ datasource: CONTRACTS_INPUT, tier: 2, payload: PERSON_BEARING }) });
    log("A7.lying", lying);
    expect(lying.tier).toBe(4);
    expect(lying.allowed).toBe(false);
    expect(lying.reason).toBe("approval_required");
    expect(lying.requiresNamedApproval).toBe(true);
    expect(lying.approval).toBeNull();
    expect(lying.audit.tier).toBe(4);
  });

  it("BLOCKED: and not by over-classifying — innocent data is still tier 1", async () => {
    const d = await effectiveGrant({ store: store(rows), ...ask({ datasource: CONTRACTS_INPUT, tier: 1, payload: INNOCENT }) });
    log("A7.innocent", d);
    expect(d.tier).toBe(1);
    expect(d.allowed).toBe(true);
    expect(d.requiresNamedApproval).toBe(false);
  });

  it("BLOCKED IN EVERY REPRESENTATION: the same record as a string, a wrapper, base64", async () => {
    // The class, not the instance: a control that reads ONE representation is a
    // control the same bytes walk around. `classify()` alone scores the JSON
    // string at 3 and the base64 at 1.
    const shapes: Array<[string, unknown]> = [
      ["structured", PERSON_BEARING],
      ["json string", JSON.stringify(PERSON_BEARING)],
      ["wrapped in a field", { blob: JSON.stringify(PERSON_BEARING) }],
      ["base64 of the json", Buffer.from(JSON.stringify(PERSON_BEARING)).toString("base64")],
      ["prose labels", "Name: Maren Keller\nIBAN: DE89370400440532013000\nSalary: 84000 EUR"],
      ["array of one", [PERSON_BEARING]],
      ["nested twice", { a: { b: JSON.stringify({ c: PERSON_BEARING }) } }],
    ];
    for (const [shape, payload] of shapes) {
      const naive = classify(payload).tier;
      const every = classifyEveryRepresentation(payload).tier;
      const d = await effectiveGrant({ store: store(rows), ...ask({ datasource: CONTRACTS_INPUT, tier: 1, payload }) });
      console.log(`[A7.${shape}] classify=${naive} everyRepresentation=${every} decision.tier=${d.tier} ${d.reason}`);
      expect(d.tier).toBe(4);
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe("approval_required");
    }
  });

  it("and a named human on the true tier does allow it", async () => {
    const s = store(rows, [approval({ tier: 4, approvedBy: { kind: "human", id: "j.oduya" } })]);
    const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 2, payload: PERSON_BEARING }) });
    log("A7.approved", d);
    expect(d.allowed).toBe(true);
    expect(d.tier).toBe(4);
  });
});

/* ── A8 — races ──────────────────────────────────────────────────────────── */
describe("A8 concurrent / conflicting writes", () => {
  it("BLOCKED: array order no longer decides which approval answers", async () => {
    const narrow = approval({ tier: 3, approvedBy: { kind: "human", id: "a.narrow" } });
    const wide = approval({ tier: 4, approvedBy: { kind: "human", id: "b.wide" } });
    const q = { toolId: TOOL, contentHash: HASH_V1, projectId: PROJECT, datasource: CONTRACTS_INPUT, tier: 3 as const, requestedById: "crew.contract-auditor" };
    const a = await admitApproval([narrow, wide], q, directory());
    const b = await admitApproval([wide, narrow], q, directory());
    console.log("[A8.order]", a.ok && a.approval.approvedBy.id, b.ok && b.approval.approvedBy.id);
    // The NARROWEST signature that reaches the question, in both orders.
    expect(a.ok && a.approval.approvedBy.id).toBe("a.narrow");
    expect(b.ok && b.approval.approvedBy.id).toBe("a.narrow");
  });

  it("BLOCKED: the choice is total — same width, most recent, then id", async () => {
    const older = approval({ tier: 4, approvedAt: "2026-09-19T09:00:00Z", approvedBy: { kind: "human", id: "a.narrow" } });
    const newer = approval({ tier: 4, approvedAt: "2026-09-20T09:00:00Z", approvedBy: { kind: "human", id: "b.wide" } });
    const q = { toolId: TOOL, contentHash: HASH_V1, projectId: PROJECT, datasource: CONTRACTS_INPUT, tier: 4 as const, requestedById: "crew.contract-auditor" };
    for (const order of [[older, newer], [newer, older]]) {
      const v = await admitApproval(order, q, directory());
      expect(v.ok && v.approval.approvedBy.id).toBe("b.wide");
    }
  });

  it("STATED RESIDUAL: adding a narrower approval does not retract a wider one", async () => {
    const wide = approval({ tier: 4 });
    const narrow = approval({ tier: 3 });
    const v = await admitApproval(
      [wide, narrow],
      { toolId: TOOL, contentHash: HASH_V1, projectId: PROJECT, datasource: CONTRACTS_INPUT, tier: 4, requestedById: "crew.contract-auditor" },
      directory(),
    );
    console.log("[A8.widest-wins]", JSON.stringify(v.ok));
    // Both records are true statements and neither retracts the other.
    // Narrowing an approval means REVOKING the wide one — a supersession rule
    // the STORE owns, which this package cannot invent for itself.
    expect(v.ok).toBe(true);
  });

  // ⚠ STILL OPEN AT THE ROW LEVEL, and narrowed at the FILE level.
  //
  // `createFileGrantStore` now serialises read-modify-write across processes
  // with a lock and abandons a write whose file moved underneath it, so one
  // process can no longer erase another's whole ledger. That is a different
  // failure from this one: two sequential `putGrantRow` calls still overwrite
  // by primary key, because the row carries no version to compare. Closing
  // THIS needs a version on `GrantRow` and a compare-and-swap on the port,
  // which every store would have to implement.
  it("STILL OPEN: grant rows are last-write-wins, no version / CAS", async () => {
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
    // The allowance is CONFIRMED before it is returned: everything it rests on
    // is read again, and a difference throws the answer away rather than
    // serving it. There is no transaction available on this port, so the honest
    // instrument is a confirmation, not a claim of atomicity.
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("store_changed_during_decision");
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
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("store_changed_during_decision");
  });

  it("BLOCKED: an approval revoked during the decision is caught by the confirmation", async () => {
    const mem = createMemoryGrantStore({ rows: [ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])], approvals: [approval({ approvedBy: { kind: "human", id: "j.oduya" } })] });
    let reads = 0;
    const racing: GrantStore = {
      readGrantRow: mem.readGrantRow,
      async readApprovals(p, t) {
        const out = await mem.readApprovals(p, t);
        if (++reads === 1) mem.revokeApproval(0, AT);
        return out;
      },
    };
    const d = await effectiveGrant({ store: racing, ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
    log("A8.toctou-approval-revoke", d);
    expect(d.reason).toBe("store_changed_during_decision");
  });

  it("a store that holds still is not punished for it", async () => {
    const s = store([ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])], [approval({ approvedBy: { kind: "human", id: "j.oduya" } })]);
    const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }) });
    expect(d.allowed).toBe(true);
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
  it("BLOCKED: a narrowed project cannot declare projectId='*' and get the ceiling", async () => {
    const s = store([ceiling([[CONTRACTS_INPUT, 2]]), row(PROJECT, [[CONTRACTS_INPUT, 1]])]);
    const narrowed = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 2 }) });
    log("A10.as-project", narrowed);
    expect(narrowed.allowed).toBe(false);
    expect(narrowed.reason).toBe("tier_above_project");

    const asCeiling = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 2, projectId: "*" }) });
    log("A10.as-star", asCeiling);
    expect(asCeiling.allowed).toBe(false);
    // Not "invalid": the id is perfectly well-formed, it is simply not a scope a
    // REQUEST may name. A row may live at '*'; a question may not be asked from
    // there. The read path and the write path have different predicates.
    expect(asCeiling.reason).toBe("ceiling_not_requestable");
  });

  it("a project id is otherwise uncollidable with '*'", async () => {
    for (const pid of ["*", "**", "%2A", "＊", "-star", "Rhineland", "rhine_land", "a".repeat(65)]) {
      const d = await effectiveGrant({ store: store([]), ...ask({ datasource: CONTRACTS_INPUT, tier: 1, projectId: pid }) });
      console.log(`[A10.pid:${pid}]`, d.reason);
      expect(d.allowed).toBe(false);
      expect(d.reason).toBe(pid === "*" ? "ceiling_not_requestable" : "invalid_project_id");
    }
  });

  it("tier 3 at '*' is refused before the approval question is even reached", async () => {
    const s = store([ceiling([[CONTRACTS_INPUT, 4]])], [approval({ projectId: PROJECT })]);
    const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 3, projectId: "*" }) });
    log("A10.star-tier3", d);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("ceiling_not_requestable");
    // refused before the store was touched at all
    expect(s.counts.grantRows).toBe(0);
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

/* ── A12 — THE SECOND IMPLEMENTATION OF THE NAMED-HUMAN RULE ─────────── */
import { checkApproval, isNamedHuman, contentHash as guardrailsHash } from "../../../guardrails/src/approval";
import { identityDefect } from "../actor";
import { toolContentHash } from "../identity";
import { createMemoryDirectory } from "../directory";

describe("A12 there is now ONE 'named human' rule, and ONE hasher", () => {
  const base = [ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])];

  it("BLOCKED: every approver guardrails calls UNNAMED is refused by approvals too", async () => {
    // The two used to disagree on all seven of these, and which gate a caller
    // routed through decided the answer. `actor.ts` now IMPORTS guardrails'
    // `isNamedHuman`; the weaker "any non-blank string" rule is deleted, so
    // there is one NON_NAMES list in the repository.
    for (const name of ["system", "automation", "agent", "studio", "admin", "unknown", "the approver"]) {
      expect(isNamedHuman(name)).toBe(false); // guardrails refuses it
      // Even with the directory CONFIRMING an active human of that name.
      const dir = createMemoryDirectory([
        { id: "crew.contract-auditor", kind: "agent", displayName: "Contract Auditor", active: true },
        { id: name, kind: "human", displayName: name, active: true },
      ]);
      const s = store(base, [approval({ approvedBy: { kind: "human", id: name, displayName: name } })]);
      const d = await effectiveGrant({ store: s, ...ask({ datasource: CONTRACTS_INPUT, tier: 4 }), directory: dir });
      console.log(`[A12.${name}] guardrails=refuse approvals=${d.allowed ? "ALLOW" : "refuse"} (${d.reason})`);
      expect(d.allowed).toBe(false);
      expect(identityDefect({ id: name, kind: "human", displayName: name, active: true })).toBe("unnamed");
    }
  });

  it("BLOCKED: both gates now recompute the hash, and they agree byte for byte", () => {
    const proposal = { id: "wc-gap-report", files: [{ path: "a.ts", text: "export const x = 1;" }] };
    const edited = { id: "wc-gap-report", files: [{ path: "a.ts", text: "export const x = 2;" }] };
    const signed = { approver: "Maren Keller", contentHash: guardrailsHash(proposal), at: AT, scope: "registration" as const };
    const g = checkApproval(edited, "registration", signed);
    console.log("[A12.hash] guardrails on edited content:", g.ok, g.problem);
    expect(g.ok).toBe(false);
    // ONE hasher: approvals' `toolContentHash` IS guardrails' `contentHash`.
    expect(toolContentHash(proposal)).toBe(guardrailsHash(proposal));
    expect(toolContentHash(edited)).toBe(g.expectedHash);
    expect(toolContentHash(proposal)).not.toBe(toolContentHash(edited));
  });

  it("⭐ CLOSED: effectiveGrant() is wired into a route", async () => {
    // This case used to be `expect(true).toBe(true)` under a console line
    // reading "effectiveGrant() still has zero call sites outside its own
    // tests". It was accurate: 176 tests, a ceiling/project intersection, a
    // directory, revocation and sealed decisions all decided NOTHING,
    // because nothing asked them.
    //
    // The call site is `server/index.ts`, at INTAKE — before a model call is
    // spent on data the project may not use. Asserted from the file on disk
    // so that deleting the wiring fails HERE, where the claim is made,
    // rather than silently returning this package to decoration.
    const fs = await import("node:fs");
    const source = fs.readFileSync(new URL("../../../../server/index.ts", import.meta.url), "utf8");
    expect(source).toContain("effectiveGrant");
    // And it is reached from the request path, not merely imported.
    expect(source).toMatch(/await effectiveGrant\(\{/);
    // The tier must not be declarable by the caller — it is derived from the
    // payload, which is the property the whole package rests on.
    expect(source).not.toMatch(/tier:\s*(?:parsed|request|body)\./);
  });
});
