/**
 * ⭐ A GRANT ROW CARRIES A VERSION, AND A STALE WRITE IS REFUSED.
 *
 * Before this, `putGrantRow` replaced a row by its primary key whatever was
 * there. Two operators each read the project row at the same moment; A
 * narrows it, B widens it without having seen A's change — and A's narrowing
 * was gone without a trace. The red-team suite recorded that as STILL OPEN.
 * The file store's lock did not help: it serialises the two writes, and a
 * serialised overwrite is still an overwrite.
 *
 * The rule now, for every store:
 *
 *   - the STORE assigns `rev`. A caller's `rev` is overwritten, never trusted.
 *   - `putGrantRow(row, expectedRev)` lands only when the row is still at the
 *     rev the caller read (`null` = "I saw no row", i.e. create-only).
 *     Anything else is `GrantRowConflictError`, status 409, and the stored
 *     row is left exactly as it was.
 *   - `revokeGrantRow` takes no expected rev and always lands — a kill switch
 *     must never fail on a version — but it BUMPS the rev, so a widening
 *     someone prepared before the revoke cannot land on top of it.
 *
 * Every case runs against both stores: the memory one is the reference, and a
 * rule only the reference obeyed would be decoration.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { effectiveGrant } from "../decision";
import {
  GrantRowConflictError,
  GrantStoreCorruptError,
  createFileGrantStore,
  createMemoryGrantStore,
  grantRowRev,
  type GrantRow,
  type GrantStore,
  type MemoryGrantStore,
} from "../index";
import { CEILING_PROJECT_ID } from "../identity";
import { AT, CONTRACTS_INPUT, PROJECT, TOOL, ask, ceiling, row } from "./support";

const made: string[] = [];
function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grants-rev-"));
  made.push(dir);
  return path.join(dir, "grants.json");
}
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Two handles on ONE store — as two operators (or two processes) would hold. */
type Pair = () => { a: MemoryGrantStore; b: MemoryGrantStore };

const STORES: readonly (readonly [string, Pair])[] = [
  [
    "memory store",
    () => {
      const s = createMemoryGrantStore();
      return { a: s, b: s };
    },
  ],
  [
    "file store",
    () => {
      const file = tempFile();
      return { a: createFileGrantStore(file), b: createFileGrantStore(file) };
    },
  ],
];

const conflictOf = (fn: () => unknown): GrantRowConflictError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof GrantRowConflictError) return error;
    throw error;
  }
  throw new Error("expected a GrantRowConflictError, and the write landed");
};

for (const [name, open] of STORES) {
  describe(`${name}: a grant row is versioned`, () => {
    it("⭐ two writers read the same rev — the second is refused with 409, and the first stands", async () => {
      const { a, b } = open();
      a.putGrantRow(ceiling([[CONTRACTS_INPUT, 2]]), null);
      a.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 2]]), null);

      // Both operators look at the row at the same moment.
      const seenByA = grantRowRev(await a.readGrantRow(PROJECT, TOOL));
      const seenByB = grantRowRev(await b.readGrantRow(PROJECT, TOOL));
      expect(seenByA).toBe(1);
      expect(seenByB).toBe(1);

      // A narrows. It lands, and the rev moves.
      expect(a.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 1]]), seenByA)).toBe(2);

      // B widens, having never seen A's change. Refused.
      const conflict = conflictOf(() => b.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 2]]), seenByB));
      expect(conflict.status).toBe(409);
      expect(conflict.code).toBe("grant_row_conflict");
      expect(conflict.projectId).toBe(PROJECT);
      expect(conflict.toolId).toBe(TOOL);
      expect(conflict.expectedRev).toBe(1);
      expect(conflict.actualRev).toBe(2);

      // ⭐ A's narrowing is what the store holds — and what the decision sees.
      const stored = await b.readGrantRow(PROJECT, TOOL);
      expect(stored?.datasources[0]?.maxTier).toBe(1);
      expect(stored?.rev).toBe(2);
      const d = await effectiveGrant({ store: b, ...ask({ datasource: CONTRACTS_INPUT, tier: 2 }) });
      expect(d.allowed).toBe(false);
    });

    it("the conflict names the key and the revs — never the row's content", () => {
      const { a } = open();
      a.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 2]]), null);
      const conflict = conflictOf(() => a.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 4]]), 7));
      expect(conflict.message).not.toContain("contracts");
      expect(conflict.message).not.toContain("maxTier");
      expect(Object.keys(conflict).sort()).toEqual(["actualRev", "code", "expectedRev", "name", "projectId", "status", "toolId"]);
    });

    it("create-only (expected null) on a row that exists is a conflict", async () => {
      const { a, b } = open();
      a.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 1]]), null);
      const conflict = conflictOf(() => b.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 4]]), null));
      expect(conflict.expectedRev).toBeNull();
      expect(conflict.actualRev).toBe(1);
      expect((await a.readGrantRow(PROJECT, TOOL))?.datasources[0]?.maxTier).toBe(1);
    });

    it("expecting a row that is not there is a conflict too — nobody saw it at that rev", async () => {
      const { a } = open();
      const conflict = conflictOf(() => a.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 2]]), 0));
      expect(conflict.expectedRev).toBe(0);
      expect(conflict.actualRev).toBeNull();
      expect(await a.readGrantRow(PROJECT, TOOL)).toBeNull();
    });

    it("⛔ a caller-supplied rev is overwritten, never trusted", async () => {
      const { a } = open();
      const forged: GrantRow = { ...row(PROJECT, [[CONTRACTS_INPUT, 2]]), rev: 99 };
      expect(a.putGrantRow(forged, null)).toBe(1);
      expect((await a.readGrantRow(PROJECT, TOOL))?.rev).toBe(1);
    });

    it("⭐ revoke always lands, and bumps the rev", async () => {
      const { a, b } = open();
      a.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 2]]), null);
      b.revokeGrantRow(PROJECT, TOOL, AT);
      const stored = await a.readGrantRow(PROJECT, TOOL);
      expect(stored?.revokedAt).toBe(AT);
      expect(stored?.rev).toBe(2);
      // Revoking what is already revoked still lands — no version to fail on.
      a.revokeGrantRow(PROJECT, TOOL, AT);
      expect((await b.readGrantRow(PROJECT, TOOL))?.rev).toBe(3);
    });

    it("⭐ a widening prepared before the revoke is refused after it", async () => {
      const { a, b } = open();
      a.putGrantRow(ceiling([[CONTRACTS_INPUT, 4]]), null);
      a.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 1]]), null);
      const seen = grantRowRev(await a.readGrantRow(PROJECT, TOOL));

      b.revokeGrantRow(PROJECT, TOOL, AT); // the kill switch

      // A's "widen to 4", computed from the pre-revoke row, would have
      // silently un-revoked it — its row carries `revokedAt: null`.
      const conflict = conflictOf(() => a.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 4]]), seen));
      expect(conflict.actualRev).toBe(2);
      const stored = await b.readGrantRow(PROJECT, TOOL);
      expect(stored?.revokedAt).toBe(AT);
      expect(stored?.datasources[0]?.maxTier).toBe(1);
      const d = await effectiveGrant({ store: b, ...ask({ datasource: CONTRACTS_INPUT, tier: 1 }) });
      expect(d.reason).toBe("project_revoked");
    });
  });
}

describe("rows written before the version existed", () => {
  it("a seeded row with no rev counts as rev 0", async () => {
    const s = createMemoryGrantStore({ rows: [row(PROJECT, [[CONTRACTS_INPUT, 2]])] });
    expect(grantRowRev(await s.readGrantRow(PROJECT, TOOL))).toBe(0);
    expect(() => s.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 1]]), null)).toThrow(GrantRowConflictError);
    expect(s.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 1]]), 0)).toBe(1);
  });

  it("⭐ a version-1 grants file whose rows have no rev still loads, and they count as rev 0", async () => {
    const file = tempFile();
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, rows: [row(PROJECT, [[CONTRACTS_INPUT, 2]])], approvals: [] }),
    );
    const s = createFileGrantStore(file);
    expect(grantRowRev(await s.readGrantRow(PROJECT, TOOL))).toBe(0);
    expect(s.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 1]]), 0)).toBe(1);
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { version: number; rows: { rev?: number }[] };
    expect(parsed.version).toBe(1);
    expect(parsed.rows[0]?.rev).toBe(1);
  });

  it("grantRowRev: no row is null, a row without a rev is 0", () => {
    expect(grantRowRev(null)).toBeNull();
    expect(grantRowRev(row(PROJECT, [[CONTRACTS_INPUT, 2]]))).toBe(0);
    expect(grantRowRev({ ...row(PROJECT, [[CONTRACTS_INPUT, 2]]), rev: 5 })).toBe(5);
  });
});

describe("file store: the version on disk", () => {
  it("⭐ a rev that is not a non-negative integer is refused at load — not read as 0", async () => {
    for (const rev of [-1, 1.5, "2", null, true]) {
      const file = tempFile();
      const bad = JSON.stringify({
        version: 1,
        rows: [{ ...row(PROJECT, [[CONTRACTS_INPUT, 2]]), rev }],
        approvals: [],
      });
      fs.writeFileSync(file, bad);
      await expect(createFileGrantStore(file).readGrantRow(PROJECT, TOOL), String(rev)).rejects.toThrow(
        GrantStoreCorruptError,
      );
      // and a write through it leaves the file exactly as it was
      expect(() => createFileGrantStore(file).revokeGrantRow(PROJECT, TOOL, AT)).toThrow(GrantStoreCorruptError);
      expect(fs.readFileSync(file, "utf8")).toBe(bad);
    }
  });

  it("⭐ a refused write leaves the file byte-for-byte unchanged and releases the lock", () => {
    const file = tempFile();
    const s = createFileGrantStore(file);
    s.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 1]]), null);
    const before = fs.readFileSync(file, "utf8");
    expect(() => s.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 4]]), 0)).toThrow(GrantRowConflictError);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  });
});

describe("the decision's confirmation sees a rev bump", () => {
  it("⭐ a rewrite with identical content still moves the store — the allowance is thrown away", async () => {
    // `storeMoved` compares everything it read, rev included. A row rewritten
    // between the first read and the confirmation is a different row even
    // when every datasource is the same, because somebody DECIDED something
    // in between, and the answer must be asked again against that decision.
    const mem = createMemoryGrantStore();
    mem.putGrantRow(ceiling([[CONTRACTS_INPUT, 2]]), null);
    mem.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 2]]), null);
    let n = 0;
    const racing: GrantStore = {
      async readGrantRow(p, t) {
        const r = await mem.readGrantRow(p, t);
        if (++n === 1) mem.putGrantRow(ceiling([[CONTRACTS_INPUT, 2]]), 1); // same content, rev 1 → 2
        return r;
      },
      readApprovals: mem.readApprovals,
    };
    const d = await effectiveGrant({ store: racing, ...ask({ datasource: CONTRACTS_INPUT, tier: 2 }) });
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("store_changed_during_decision");
    expect((await mem.readGrantRow(CEILING_PROJECT_ID, TOOL))?.rev).toBe(2);
  });
});
