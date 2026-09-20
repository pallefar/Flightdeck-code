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

import { afterEach, describe, expect, it } from "vitest";

import { effectiveGrant } from "../decision";
import { GrantStoreCorruptError, createFileGrantStore } from "../file-store";
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
