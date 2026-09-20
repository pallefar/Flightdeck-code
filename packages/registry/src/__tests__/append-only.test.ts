/**
 * "EVERY TRANSITION IS AN APPEND-ONLY AUDIT ENTRY" — measured three ways,
 * because one way would only prove that one way works.
 *
 *   A. THE VALUES REFUSE. Entries and logs are frozen; in strict mode (which
 *      every ES module is) `push`, assignment and `delete` THROW.
 *   B. THE OLD LOG SURVIVES. Transitions are pure, so a caller holding a
 *      pre-transition ledger can compare rather than take the new one's word.
 *   C. THE WRITE PATH CHECKS. `commit()` runs `assertAppendOnly` on every
 *      transition, so a rewrite would throw where it happened.
 *
 * ⚠ WHAT IS DELIBERATELY NOT TESTED HERE: a hash chain. Sub-app contract §5
 * rule 5 — "Never construct an audit hash. Only `appendFlightdeckAudit()` /
 * `caps.auditAppend()`" — means tamper EVIDENCE belongs to the host's
 * GENESIS-rooted chain, computed against the real tail of the real file. This
 * package produces the bodies that go into it (asserted at the bottom) and
 * tamper RESISTANCE within one process. Building a second chain here is the
 * fork the rule exists to prevent.
 */

import { describe, expect, it } from "vitest";

import { toFlightdeckAuditBody, HISTORY_ENTRY_FIELDS, historyEntry } from "../audit";
import {
  HistoryRewriteError,
  appendHistory,
  assertAppendOnly,
  entriesSince,
  isAppendOnly,
} from "../history";
import { approve, auditBodies, createLedger, enableFunctionWide, propose, register, retire } from "../ledger";
import { ADMIN, AGENT, APPROVER, T, miniApp, mustOk } from "./support";
import type { HistoryEntry } from "../audit";

function walkedLedger() {
  const p = mustOk(propose(createLedger(), { artifact: miniApp(), workflowId: "orchestrate-workflow", by: AGENT, at: T.proposed }));
  const a = mustOk(approve(p.ledger, { artifactId: "wc-clock", contentHash: p.entry.contentHash, by: APPROVER, at: T.approved }));
  const r = mustOk(register(a.ledger, { artifactId: "wc-clock", contentHash: p.entry.contentHash, by: ADMIN, at: T.registered }));
  const e = mustOk(enableFunctionWide(r.ledger, { artifactId: "wc-clock", by: ADMIN, at: T.enabled }));
  return { p, a, r, e, hash: p.entry.contentHash };
}

describe("A. the values themselves refuse to be edited", () => {
  it("the log cannot be pushed to, spliced or reassigned", () => {
    const { e } = walkedLedger();
    const log = e.ledger.history as HistoryEntry[];

    expect(Object.isFrozen(log)).toBe(true);
    expect(() => log.push(log[0] as HistoryEntry)).toThrow(TypeError);
    expect(() => log.splice(0, 1)).toThrow(TypeError);
    expect(() => {
      log[0] = log[1] as HistoryEntry;
    }).toThrow(TypeError);
    expect(log).toHaveLength(4);
  });

  it("an individual entry cannot be rewritten in place", () => {
    const { e } = walkedLedger();
    const first = e.ledger.history[0] as unknown as Record<string, unknown>;

    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      first["by"] = "somebody-else";
    }).toThrow(TypeError);
    expect(() => {
      delete first["event"];
    }).toThrow(TypeError);
    expect(e.ledger.history[0]?.by).toBe("studio-codegen");
  });

  it("the scope list inside an entry is frozen too — the consent screen is not editable", () => {
    const { e } = walkedLedger();
    const scoped = e.ledger.history.find((h) => h.grantedScopes !== undefined);
    const scopes = scoped?.grantedScopes as string[];
    expect(Object.isFrozen(scopes)).toBe(true);
    expect(() => scopes.push("write:inbox-proposal")).toThrow(TypeError);
  });

  it("entries and enablement rows are frozen as well", () => {
    const { e } = walkedLedger();
    expect(Object.isFrozen(e.ledger)).toBe(true);
    expect(Object.isFrozen(e.ledger.entries)).toBe(true);
    expect(Object.isFrozen(e.ledger.entries[0])).toBe(true);
    expect(Object.isFrozen(e.ledger.enablements[0])).toBe(true);
  });
});

describe("B. the old log survives every transition", () => {
  it("each step extends the previous one and rewrites nothing", () => {
    const { p, a, r, e } = walkedLedger();

    expect(p.ledger.history).toHaveLength(1);
    expect(a.ledger.history).toHaveLength(2);
    expect(r.ledger.history).toHaveLength(3);
    expect(e.ledger.history).toHaveLength(4);

    for (const [before, after] of [
      [p.ledger.history, a.ledger.history],
      [a.ledger.history, r.ledger.history],
      [r.ledger.history, e.ledger.history],
      [p.ledger.history, e.ledger.history],
    ] as const) {
      expect(() => assertAppendOnly(before, after)).not.toThrow();
    }

    // Prefix identity is by REFERENCE: the earlier entries are the same objects.
    expect(e.ledger.history[0]).toBe(p.ledger.history[0]);
    expect(e.ledger.history[1]).toBe(a.ledger.history[1]);
  });

  it("`seq` is dense, 1-based and matches position", () => {
    const { e } = walkedLedger();
    expect(e.ledger.history.map((h) => h.seq)).toEqual([1, 2, 3, 4]);
  });

  it("a refusal appends nothing at all", () => {
    const { r } = walkedLedger();
    const refused = register(r.ledger, { artifactId: "wc-clock", contentHash: "0".repeat(64), by: ADMIN, at: T.later });
    expect(refused.ok).toBe(false);
    expect(refused.ledger.history).toBe(r.ledger.history);
  });

  it("retirement appends; it never removes an entry or a history row", () => {
    const { e, hash } = walkedLedger();
    const retired = mustOk(retire(e.ledger, { artifactId: "wc-clock", contentHash: hash, by: ADMIN, at: T.later }));

    expect(() => assertAppendOnly(e.ledger.history, retired.ledger.history)).not.toThrow();
    expect(retired.ledger.history.length).toBeGreaterThan(e.ledger.history.length);
    expect(retired.ledger.entries).toHaveLength(1);
    expect(retired.ledger.history.map((h) => h.event)).toContain("subapp.proposed");
  });
});

describe("C. a rewrite is caught, and named", () => {
  const base = appendHistory(
    appendHistory([], {
      at: T.proposed,
      by: "studio-codegen",
      event: "subapp.proposed",
      subAppId: "wc-clock",
      kind: "mini-app",
      contentHash: "a".repeat(64),
      workflowId: "wf",
    }),
    {
      at: T.approved,
      by: "k.haldan",
      event: "subapp.approved",
      subAppId: "wc-clock",
      kind: "mini-app",
      contentHash: "a".repeat(64),
      workflowId: "wf",
    },
  );

  it("an edited entry is reported by position", () => {
    const forged = [
      base[0] as HistoryEntry,
      historyEntry({
        seq: 2,
        at: T.approved,
        by: "studio-codegen", // the agent, written in over the human
        event: "subapp.approved",
        subAppId: "wc-clock",
        kind: "mini-app",
        contentHash: "a".repeat(64),
        workflowId: "wf",
      }),
    ];
    expect(() => assertAppendOnly(base, forged)).toThrow(HistoryRewriteError);
    try {
      assertAppendOnly(base, forged);
    } catch (err) {
      expect((err as HistoryRewriteError).at).toBe(1);
      expect((err as HistoryRewriteError).message).toContain("rewritten");
    }
    expect(isAppendOnly(base, forged)).toBe(false);
  });

  it("a truncation is reported as a shrink, not as an edit", () => {
    const truncated = base.slice(0, 1);
    try {
      assertAppendOnly(base, truncated);
      throw new Error("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HistoryRewriteError);
      expect((err as HistoryRewriteError).at).toBe(-1);
      expect((err as HistoryRewriteError).message).toContain("shrank");
    }
  });

  it("a REORDERING is caught even though nothing was added or removed", () => {
    const swapped = [base[1] as HistoryEntry, base[0] as HistoryEntry];
    expect(isAppendOnly(base, swapped)).toBe(false);
  });

  it("`entriesSince` refuses to answer about a tampered log", () => {
    const { p, e } = walkedLedger();
    expect(entriesSince(p.ledger.history, e.ledger.history)).toHaveLength(3);
    expect(() => entriesSince(e.ledger.history, p.ledger.history)).toThrow(HistoryRewriteError);
  });
});

describe("the bodies handed to the host's chain", () => {
  it("carry identifiers only, and never a timestamp of our own", () => {
    const { e } = walkedLedger();
    const bodies = auditBodies(e.ledger.history);

    expect(bodies).toHaveLength(4);
    for (const body of bodies) {
      // The host stamps `at` itself, at second precision, in
      // `appendFlightdeckAudit`. Sending ours would either be overwritten or
      // disagree.
      expect(body).not.toHaveProperty("at");
      expect(body).not.toHaveProperty("prevHash");
      expect(body).not.toHaveProperty("hash");
      expect(body).not.toHaveProperty("note");
      // Host `AuditInput` names the actor `actor`, not `by`.
      expect(typeof body.actor).toBe("string");
      expect(body.event.startsWith("subapp.")).toBe(true);
    }
    expect(bodies[1]?.actor).toBe("k.haldan");
  });

  it("the history record's key set is closed — there is no field a value could arrive in", () => {
    const { e } = walkedLedger();
    for (const row of e.ledger.history) {
      for (const key of Object.keys(row)) {
        expect(HISTORY_ENTRY_FIELDS).toContain(key);
      }
    }
    expect([...HISTORY_ENTRY_FIELDS]).toEqual([
      "seq",
      "at",
      "by",
      "event",
      "subAppId",
      "kind",
      "contentHash",
      "workflowId",
      "projectId",
      "grantedScopes",
    ]);
  });

  it("an audit body is frozen once built", () => {
    const { e } = walkedLedger();
    const body = toFlightdeckAuditBody(e.ledger.history[0] as HistoryEntry);
    expect(Object.isFrozen(body)).toBe(true);
  });
});
