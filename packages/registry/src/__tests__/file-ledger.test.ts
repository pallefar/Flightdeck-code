/**
 * The registry that survives a restart.
 *
 * `createLedger()` returns an empty value and every operation returns a NEW
 * one — the right shape for a pure core, and it meant nothing persisted.
 * Every approval, registration and enablement vanished when the process
 * ended, in the package whose whole job is "approve it once, use it for
 * future projects".
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileStoreBusyError } from "../../../store/src/atomic-file";
import { LedgerRewriteError, LedgerStoreCorruptError, loadLedger, updateLedger } from "../file-ledger";
import { approve, currentRegistered, enableFunctionWide, propose, register } from "../ledger";
import { ADMIN, AGENT, APPROVER, T, miniApp, mustOk } from "./support";

const made: string[] = [];
function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  made.push(dir);
  return path.join(dir, "registry.json");
}
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Walk a tool all the way to enabled, each step its own durable write. */
function walk(file: string): string {
  const proposed = mustOk(
    updateLedger(file, (l) =>
      propose(l, { artifact: miniApp(), workflowId: "orchestrate-workflow", by: AGENT, at: T.proposed }),
    ),
  );
  const hash = proposed.entry.contentHash;
  mustOk(
    updateLedger(file, (l) => approve(l, { artifactId: "wc-clock", contentHash: hash, by: APPROVER, at: T.approved })),
  );
  mustOk(
    updateLedger(file, (l) => register(l, { artifactId: "wc-clock", contentHash: hash, by: ADMIN, at: T.registered })),
  );
  mustOk(updateLedger(file, (l) => enableFunctionWide(l, { artifactId: "wc-clock", by: ADMIN, at: T.enabled })));
  return hash;
}

describe("it survives the process that wrote it", () => {
  it("⭐ a tool approved in one run is still approved in the next", () => {
    const file = tempFile();
    const hash = walk(file);

    // A fresh read, as a restarted process would do.
    const reloaded = loadLedger(file);
    const registered = currentRegistered(reloaded, "wc-clock");
    expect(registered?.contentHash).toBe(hash);
    expect(registered?.state).toBe("registered");
    expect(registered?.approval?.approver.displayName).toBe("Karsten Haldan");
  });

  it("the history is carried whole, in order", () => {
    const file = tempFile();
    walk(file);
    const events = loadLedger(file).history.map((h) => h.event);
    expect(events).toEqual([
      "subapp.proposed",
      "subapp.approved",
      "subapp.registered",
      "subapp.enabled",
    ]);
    expect(loadLedger(file).history.map((h) => h.seq)).toEqual([1, 2, 3, 4]);
  });

  it("⭐ a refusal writes NOTHING — the ledger answers no as a value", () => {
    const file = tempFile();
    walk(file);
    const before = fs.readFileSync(file, "utf8");
    // Enabling twice is `already_enabled`.
    const result = updateLedger(file, (l) => enableFunctionWide(l, { artifactId: "wc-clock", by: ADMIN, at: T.enabled }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("already_enabled");
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("⭐ a refusal against an ABSENT file does not create one", () => {
    // The decisive form. Comparing bytes before and after cannot catch a
    // write on the refusal path, because a refusal returns the caller's
    // ledger unchanged and serialising it reproduces the same bytes — a
    // mutation that wrote anyway stayed green. An absent file is different:
    // writing it is visible.
    const file = tempFile();
    const result = updateLedger(file, (l) =>
      approve(l, { artifactId: "nothing", contentHash: "a".repeat(64), by: APPROVER, at: T.approved }),
    );
    expect(result.ok).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("what it refuses", () => {
  it("⭐ a history that does not EXTEND the one on disk", () => {
    // The durable append-only check. `assertAppendOnly` compares by
    // reference, which cannot survive a reload, so this compares by value —
    // and dropping the check entirely is the easy mistake, because the
    // reference version fails closed on every legitimate append.
    const file = tempFile();
    walk(file);
    expect(() =>
      updateLedger(file, (l) => ({
        ok: true,
        reason: "ok",
        ledger: { ...l, history: l.history.slice(0, 2) },
        entry: l.entries[0] as never,
        events: [],
      })),
    ).toThrow(LedgerRewriteError);
    // ⚠ AND IT IS THE LENGTH CHECK THAT FIRES, `at: -1`. Asserting only the
    // error TYPE let a mutation delete the length check and stay green: the
    // loop below it also throws, because `next[i]` is undefined past the end
    // — same exception, different index, and a message that says an entry
    // "differs" when the truth is the history got shorter.
    const error = (() => {
      try {
        updateLedger(file, (l) => ({
          ok: true,
          reason: "ok",
          ledger: { ...l, history: l.history.slice(0, 2) },
          entry: l.entries[0] as never,
          events: [],
        }));
        return null;
      } catch (e: unknown) {
        return e as LedgerRewriteError;
      }
    })();
    expect(error?.at).toBe(-1);
    expect(error?.message).toContain("SHORTER");
    // And the four entries are still there.
    expect(loadLedger(file).history).toHaveLength(4);
  });

  it("⭐ an EDITED entry inside the common prefix", () => {
    const file = tempFile();
    walk(file);
    expect(() =>
      updateLedger(file, (l) => ({
        ok: true,
        reason: "ok",
        ledger: {
          ...l,
          history: [{ ...(l.history[0] as object), by: "someone-else" } as never, ...l.history.slice(1)],
        },
        entry: l.entries[0] as never,
        events: [],
      })),
    ).toThrow(LedgerRewriteError);
    // And the file is untouched.
    expect(loadLedger(file).history[0]?.by).toBe("studio-codegen");
  });

  it("⭐ a file it cannot parse — never treated as empty", () => {
    const file = tempFile();
    fs.writeFileSync(file, "{ truncated");
    expect(() => loadLedger(file)).toThrow(LedgerStoreCorruptError);
    // And a write through it refuses too, leaving the bytes as they were.
    expect(() => updateLedger(file, (l) => propose(l, { artifact: miniApp(), workflowId: "orchestrate-workflow", by: AGENT, at: T.proposed }))).toThrow(
      LedgerStoreCorruptError,
    );
    expect(fs.readFileSync(file, "utf8")).toBe("{ truncated");
  });

  it("an unknown version, and a history entry missing its seq", () => {
    for (const bad of [
      '{"version":2,"entries":[],"enablements":[],"history":[]}',
      '{"version":1,"entries":[],"enablements":[],"history":[{"event":"x"}]}',
      '{"version":1,"entries":{},"enablements":[],"history":[]}',
    ]) {
      const file = tempFile();
      fs.writeFileSync(file, bad);
      expect(() => loadLedger(file), bad).toThrow(LedgerStoreCorruptError);
    }
  });

  it("⛔ but an ABSENT file is an empty registry, not a corrupt one", () => {
    const ledger = loadLedger(tempFile());
    expect(ledger.entries).toEqual([]);
    expect(ledger.history).toEqual([]);
  });

  it("a held lock refuses the write rather than racing it", () => {
    const file = tempFile();
    walk(file);
    const before = fs.readFileSync(file, "utf8");
    fs.writeFileSync(`${file}.lock`, "", { flag: "wx" });
    try {
      expect(() =>
        updateLedger(file, (l) => propose(l, { artifact: miniApp(), workflowId: "orchestrate-workflow", by: AGENT, at: T.proposed })),
      ).toThrow(FileStoreBusyError);
      expect(fs.readFileSync(file, "utf8")).toBe(before);
    } finally {
      fs.unlinkSync(`${file}.lock`);
    }
  });
});
