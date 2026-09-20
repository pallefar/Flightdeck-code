/**
 * The store that survives a restart — and the one property that makes it
 * safe to have written.
 *
 * `createMemoryGrantStore` describes its mutators as what "a test (or a
 * first registry implementation)" drives it with, and nothing was ever that
 * first implementation. So the approval system was complete and correct and
 * forgot every grant when the process ended — in a system whose whole job is
 * recording who allowed what.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { effectiveGrant } from "../decision";
import { GrantStoreBusyError, GrantStoreConflictError, GrantStoreCorruptError, createFileGrantStore } from "../file-store";
import { AT, CONTRACTS_INPUT, PROJECT, TOOL, approval, ask, ceiling, row } from "./support";

const made: string[] = [];
function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grants-"));
  made.push(dir);
  return path.join(dir, "grants.json");
}
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("it survives the process that wrote it", () => {
  it("⭐ a second store over the same file sees what the first wrote", () => {
    const file = tempFile();
    const first = createFileGrantStore(file);
    first.putGrantRow(ceiling([[CONTRACTS_INPUT, 2]]));
    first.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 2]]));
    first.putApproval(approval());

    // A different object, as a restarted process would have.
    const second = createFileGrantStore(file);
    return Promise.all([second.readGrantRow(PROJECT, TOOL), second.readApprovals(PROJECT, TOOL)]).then(
      ([grantRow, approvals]) => {
        expect(grantRow?.projectId).toBe(PROJECT);
        expect(approvals).toHaveLength(1);
      },
    );
  });

  it("⭐ and the REAL decision runs against it — not just its own reads", async () => {
    // The lesson this repo keeps relearning: a store that satisfies its
    // interface and is never handed to the thing that consumes it proves
    // nothing. This drives `effectiveGrant` itself.
    const file = tempFile();
    const store = createFileGrantStore(file);
    store.putGrantRow(ceiling([[CONTRACTS_INPUT, 2]]));
    store.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 2]]));

    const allowed = await effectiveGrant({ store, ...ask({ datasource: CONTRACTS_INPUT, tier: 2 }) });
    expect(allowed.allowed).toBe(true);

    // Tier 3 over the same rows needs a named human, exactly as with the
    // in-memory store — the store is a drop-in, not a variant.
    const needsHuman = await effectiveGrant({ store, ...ask({ datasource: CONTRACTS_INPUT, tier: 3 }) });
    expect(needsHuman.allowed).toBe(false);
  });

  it("⭐ a revocation made by ANOTHER process is seen on the next read", async () => {
    // `GrantStore.readGrantRow` says "MUST reflect the store as it is now: no
    // memoization" — and that is a security property. A cached row is a
    // revocation that has not happened yet.
    const file = tempFile();
    const reader = createFileGrantStore(file);
    reader.putGrantRow(ceiling([[CONTRACTS_INPUT, 2]]));
    reader.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 2]]));
    expect((await reader.readGrantRow(PROJECT, TOOL))?.revokedAt ?? null).toBeNull();

    createFileGrantStore(file).revokeGrantRow(PROJECT, TOOL, AT);

    expect((await reader.readGrantRow(PROJECT, TOOL))?.revokedAt).toBe(AT);
  });

  it("revocation ARCHIVES — the row is still there to answer 'was this ever allowed'", async () => {
    const file = tempFile();
    const store = createFileGrantStore(file);
    store.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 2]]));
    store.putApproval(approval());
    store.revokeGrantRow(PROJECT, TOOL, AT);
    store.revokeApproval(0, AT);

    expect(await store.readGrantRow(PROJECT, TOOL)).not.toBeNull();
    const approvals = await store.readApprovals(PROJECT, TOOL);
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.revokedAt).toBe(AT);
  });
});

describe("what it refuses to read", () => {
  it("⭐ a file it cannot parse is an ERROR, never an empty store", async () => {
    // Reading a corrupt file as empty LOOKS fail-safe — no rows means
    // everything is refused. But the next write persists that emptiness and
    // every approval anyone ever made is gone, destroyed by the control that
    // was protecting it.
    const file = tempFile();
    fs.writeFileSync(file, "{ this is not json");
    const store = createFileGrantStore(file);
    await expect(store.readGrantRow(PROJECT, TOOL)).rejects.toThrow(GrantStoreCorruptError);
  });

  it("⭐ AND THE CORRUPT FILE IS LEFT EXACTLY AS IT WAS", () => {
    // The assertion behind the one above: a write must not be reachable
    // through a failed read.
    const file = tempFile();
    const original = '{ "version": 1, "rows": [ truncated...';
    fs.writeFileSync(file, original);
    const store = createFileGrantStore(file);
    expect(() => store.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 2]]))).toThrow(GrantStoreCorruptError);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });

  it("refuses a version it does not know, and a wrong top-level shape", async () => {
    for (const bad of ['{"version":2,"rows":[],"approvals":[]}', '{"version":1,"rows":{},"approvals":[]}', "[]"]) {
      const file = tempFile();
      fs.writeFileSync(file, bad);
      await expect(createFileGrantStore(file).readApprovals(PROJECT, TOOL), bad).rejects.toThrow(
        GrantStoreCorruptError,
      );
    }
  });

  it("refuses rows and approvals that are missing their primary key", async () => {
    for (const bad of [
      '{"version":1,"rows":[{"projectId":"p"}],"approvals":[]}',
      '{"version":1,"rows":[],"approvals":[{"toolId":"t"}]}',
    ]) {
      const file = tempFile();
      fs.writeFileSync(file, bad);
      await expect(createFileGrantStore(file).readGrantRow(PROJECT, TOOL), bad).rejects.toThrow(
        GrantStoreCorruptError,
      );
    }
  });

  it("⛔ but an ABSENT file is legitimately empty, not corrupt", async () => {
    const store = createFileGrantStore(tempFile());
    expect(await store.readGrantRow(PROJECT, TOOL)).toBeNull();
    expect(await store.readApprovals(PROJECT, TOOL)).toEqual([]);
  });

  it("never puts the file's CONTENT in the error — it holds approval notes", () => {
    const file = tempFile();
    fs.writeFileSync(file, '{ "note": "Anna Sørensen earns 92000 EUR" ');
    try {
      createFileGrantStore(file).putApproval(approval());
      expect.unreachable("should have refused");
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("Anna");
      expect(String((error as Error).message)).not.toContain("92000");
    }
  });
});

describe("how it writes", () => {
  it("leaves no temp file behind", () => {
    const file = tempFile();
    const store = createFileGrantStore(file);
    store.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 2]]));
    expect(fs.readdirSync(path.dirname(file)).filter((f) => f.includes("tmp"))).toEqual([]);
  });

  it("⭐ is not world-readable — it records who approved what", () => {
    const file = tempFile();
    createFileGrantStore(file).putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 2]]));
    // eslint-disable-next-line no-bitwise
    expect(fs.statSync(file).mode & 0o077).toBe(0);
  });

  it("replaces a row by its primary key rather than appending a second one", async () => {
    const file = tempFile();
    const store = createFileGrantStore(file);
    store.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 2]]));
    store.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 4]]));
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { rows: unknown[] };
    expect(parsed.rows).toHaveLength(1);
    expect((await store.readGrantRow(PROJECT, TOOL))?.datasources[0]?.maxTier).toBe(4);
  });
});


/**
 * ⭐ THE FAILURE A FILE STORE INTRODUCES THAT AN IN-MEMORY ONE CANNOT HAVE.
 *
 * One process with one object cannot lose a write to itself. Two processes
 * each reading, modifying and writing the same file can, and the second
 * silently erases the first. `redteam-attacks.test.ts` records the row-level
 * version of this as open ("grant rows are last-write-wins, no version /
 * CAS"); making the store durable without a lock would have widened it from
 * "one operator overwrites another's narrowing" to "one process erases
 * another's entire ledger".
 */
describe("two writers", () => {
  it("⭐ a held lock refuses the write rather than racing it", () => {
    const file = tempFile();
    const store = createFileGrantStore(file);
    store.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 2]]));
    const before = fs.readFileSync(file, "utf8");

    // Another writer holds it. `open(..., "wx")` is atomic create-exclusive,
    // so the lock IS the creation — there is no check-then-take window.
    fs.writeFileSync(`${file}.lock`, "", { flag: "wx" });
    try {
      expect(() => store.putApproval(approval())).toThrow(GrantStoreBusyError);
      // ⭐ AND NOTHING WAS WRITTEN. A refusal that half-applied would be
      // worse than the race it was preventing.
      expect(fs.readFileSync(file, "utf8")).toBe(before);
    } finally {
      fs.unlinkSync(`${file}.lock`);
    }
  });

  it("a lock older than the stale window is taken over — a dead writer cannot brick the store", () => {
    const file = tempFile();
    const store = createFileGrantStore(file);
    const lock = `${file}.lock`;
    fs.writeFileSync(lock, "");
    const longAgo = new Date(Date.now() - 120_000);
    fs.utimesSync(lock, longAgo, longAgo);

    expect(() => store.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 2]]))).not.toThrow();
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("⭐ the lock is released even when the write throws", () => {
    // A store that keeps its lock after an error is a store that is now
    // permanently busy — the corrupt-file refusal would brick it.
    const file = tempFile();
    fs.writeFileSync(file, "{ not json");
    const store = createFileGrantStore(file);
    expect(() => store.putApproval(approval())).toThrow(GrantStoreCorruptError);
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  });

  it("releases the lock after a successful write", () => {
    const file = tempFile();
    createFileGrantStore(file).putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 2]]));
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  });

  it("⭐ a file that moved under the write is abandoned, not overwritten", () => {
    // The belt to the lock's braces: a writer that ignored the lock, or a
    // stale lock taken over from a process that was still alive. Simulated
    // deterministically by changing the file DURING the read-modify-write.
    const file = tempFile();
    const store = createFileGrantStore(file);
    store.putGrantRow(row(PROJECT, [[CONTRACTS_INPUT, 2]]));

    // ⚠ THE COUNTER ONLY COUNTS READS OF THIS FILE.
    //
    // The first version incremented on EVERY `readFileSync` in the process —
    // vitest's own source-map and module reads included — so which call
    // carried the side effect depended on unrelated I/O. It passed alone and
    // failed once in a full-suite run: a flaky test I had just written, and
    // the same "counts the wrong thing" mistake this session keeps finding.
    const real = fs.readFileSync.bind(fs);
    let reads = 0;
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((target: unknown, encoding: unknown) => {
      const result: unknown = real(target as never, encoding as never);
      if (String(target) !== file) return result;
      reads += 1;
      // On the store's SECOND read of THIS file, another writer lands.
      if (reads === 2) fs.writeFileSync(file, JSON.stringify({ version: 1, rows: [], approvals: [] }));
      return result;
    }) as never);
    try {
      expect(() => store.putApproval(approval())).toThrow(GrantStoreConflictError);
      // The side effect must actually have fired, or the case proves nothing.
      expect(reads).toBeGreaterThanOrEqual(2);
    } finally {
      spy.mockRestore();
    }
    // The other writer's content stands. Ours was abandoned.
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { approvals: unknown[] };
    expect(parsed.approvals).toEqual([]);
  });
});
