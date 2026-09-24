/**
 * The Studio's own audit trail: `<STUDIO>/.studio/audit.jsonl`.
 *
 * Nothing recorded who certified or shipped what. `promote.sh` step [6/6]
 * writes a record whose note demands a human sign-off, and nothing captured
 * one. This file pins the trail the runner, ship and retention write into:
 *
 *   - one line per event, appended, never rewritten;
 *   - a CLOSED schema — an extra key (a `prompt`, a `note`) is a throw, so
 *     the prompt text cannot arrive by a field nobody meant to add;
 *   - every value is an identifier shaped by a pattern, so it cannot arrive
 *     inside a field that exists either;
 *   - the operator is a named human, by the same rule approvals use;
 *   - file 600, directory 700, and O_APPEND so concurrent writers never tear.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AUDIT_ACTIONS, DEFAULT_STUDIO_ROOT, appendAudit, auditFileFor, readAudit } from "../audit";
import { STUDIO_ROOT } from "../index";

const OPERATOR = "Karsten Haldan";
const SHA = "a".repeat(64);

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-audit-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const mode = (p: string): number => fs.statSync(p).mode & 0o777;
const lines = (): string[] =>
  fs
    .readFileSync(auditFileFor(root), "utf8")
    .split("\n")
    .filter((l) => l !== "");

describe("where the trail lives", () => {
  it("is <STUDIO>/.studio/audit.jsonl — the same root the server anchors grants to", () => {
    expect(auditFileFor(root)).toBe(path.join(root, ".studio", "audit.jsonl"));
    // Drift fence: the default root is the server's, not cwd and not a copy
    // that could quietly disagree.
    expect(DEFAULT_STUDIO_ROOT).toBe(STUDIO_ROOT);
  });

  it("creates the directory 700 and the file 600", async () => {
    await appendAudit({ action: "promote-start", operator: OPERATOR, runId: "r-1" }, { studioRoot: root });
    expect(mode(path.join(root, ".studio"))).toBe(0o700);
    expect(mode(auditFileFor(root))).toBe(0o600);
  });

  it("tightens an existing, wider directory and file instead of trusting them", async () => {
    fs.mkdirSync(path.join(root, ".studio"), { mode: 0o755 });
    fs.chmodSync(path.join(root, ".studio"), 0o755);
    fs.writeFileSync(auditFileFor(root), "");
    fs.chmodSync(auditFileFor(root), 0o644);
    await appendAudit({ action: "prune", operator: OPERATOR, counts: { runs: 3, worktrees: 0 } }, { studioRoot: root });
    expect(mode(path.join(root, ".studio"))).toBe(0o700);
    expect(mode(auditFileFor(root))).toBe(0o600);
  });

  it("refuses to follow a symlink planted at the audit path", async () => {
    fs.mkdirSync(path.join(root, ".studio"), { mode: 0o700 });
    const elsewhere = path.join(root, "elsewhere.txt");
    fs.writeFileSync(elsewhere, "");
    fs.symlinkSync(elsewhere, auditFileFor(root));
    await expect(appendAudit({ action: "ship", operator: OPERATOR }, { studioRoot: root })).rejects.toThrow();
    expect(fs.readFileSync(elsewhere, "utf8")).toBe("");
  });

  it("never touches the grants file beside it", async () => {
    fs.mkdirSync(path.join(root, ".studio"), { mode: 0o700 });
    const grants = path.join(root, ".studio", "grants.json");
    fs.writeFileSync(grants, '{"rows":[]}\n');
    const before = fs.readFileSync(grants);
    await appendAudit({ action: "signoff", operator: OPERATOR, specSha256: SHA, runId: "r-9" }, { studioRoot: root });
    expect(fs.readFileSync(grants).equals(before)).toBe(true);
  });
});

describe("what one entry is", () => {
  it("appends exactly one parseable line, stamped with the time, carrying what it was given", async () => {
    await appendAudit(
      {
        action: "promote-done",
        operator: OPERATOR,
        specSha256: SHA,
        runId: "2026-09-24T10-00-00Z-promote",
        recordVerdict: "not-certified",
      },
      { studioRoot: root, now: () => new Date("2026-09-24T10:00:00.000Z") },
    );
    const all = lines();
    expect(all).toHaveLength(1);
    expect(JSON.parse(all[0] as string)).toEqual({
      at: "2026-09-24T10:00:00.000Z",
      action: "promote-done",
      operator: OPERATOR,
      specSha256: SHA,
      runId: "2026-09-24T10-00-00Z-promote",
      recordVerdict: "not-certified",
    });
  });

  it("accepts every action the runner, ship and retention name", async () => {
    expect([...AUDIT_ACTIONS]).toEqual([
      "promote-start",
      "promote-done",
      "mount-done",
      "preview-start",
      "ship",
      "signoff",
      "recertify",
      "prune",
    ]);
    for (const action of AUDIT_ACTIONS) {
      await appendAudit({ action, operator: OPERATOR }, { studioRoot: root });
    }
    expect(lines()).toHaveLength(AUDIT_ACTIONS.length);
  });

  it("⭐ a `prompt` key is a THROW, and nothing is written", async () => {
    await expect(
      appendAudit(
        { action: "promote-start", operator: OPERATOR, prompt: "Show Anna's salary" } as never,
        { studioRoot: root },
      ),
    ).rejects.toThrow();
    expect(fs.existsSync(auditFileFor(root))).toBe(false);
  });

  it("⭐ the refusal does not echo the value it refused", async () => {
    const secret = "Anna Kowalski earns 91000";
    let message = "";
    try {
      await appendAudit({ action: "ship", operator: OPERATOR, note: secret } as never, { studioRoot: root });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("Anna");
    expect(message).not.toContain("91000");
  });

  it("⭐ free text cannot ride in a field that exists", async () => {
    const bad: Array<Record<string, unknown>> = [
      { branch: "studio/x Show Anna's salary" },
      { branch: "a".repeat(201) },
      { runId: "run with spaces" },
      { specSha256: "not-a-hash" },
      { commit: "HEAD~1" },
      { recordVerdict: "READY — trust me" },
      { counts: { runs: -1 } },
      { counts: { runs: 1, names: 2 } },
      { action: "delete-everything" },
    ];
    for (const extra of bad) {
      await expect(
        appendAudit({ action: "ship", operator: OPERATOR, ...extra } as never, { studioRoot: root }),
      ).rejects.toThrow();
    }
    expect(fs.existsSync(auditFileFor(root))).toBe(false);
  });

  it("the operator is a named human — a role, a service or an initial is refused", async () => {
    for (const operator of ["", "system", "studio", "bot", "K"]) {
      await expect(appendAudit({ action: "ship", operator }, { studioRoot: root })).rejects.toThrow();
    }
    expect(fs.existsSync(auditFileFor(root))).toBe(false);
  });

  it("an entry names a branch and a commit when a ship produced them", async () => {
    await appendAudit(
      { action: "ship", operator: OPERATOR, specSha256: SHA, branch: "studio/leave-desk-aaaaaaaa", commit: "0123abc" },
      { studioRoot: root },
    );
    expect(JSON.parse(lines()[0] as string)).toMatchObject({ branch: "studio/leave-desk-aaaaaaaa", commit: "0123abc" });
  });
});

describe("append-only under concurrency", () => {
  it("⭐ 50 concurrent appends give 50 parseable lines, none torn, none lost", async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        appendAudit({ action: "preview-start", operator: OPERATOR, runId: `run-${i}` }, { studioRoot: root }),
      ),
    );
    const all = lines();
    expect(all).toHaveLength(50);
    const ids = all.map((l) => (JSON.parse(l) as { runId: string }).runId).sort();
    expect(new Set(ids).size).toBe(50);
  });

  it("never rewrites what is already there", async () => {
    await appendAudit({ action: "promote-start", operator: OPERATOR, runId: "first" }, { studioRoot: root });
    const first = fs.readFileSync(auditFileFor(root), "utf8");
    await appendAudit({ action: "promote-done", operator: OPERATOR, runId: "first" }, { studioRoot: root });
    expect(fs.readFileSync(auditFileFor(root), "utf8").startsWith(first)).toBe(true);
  });
});

describe("reading it back", () => {
  it("readAudit(limit) returns the newest entries, newest first", async () => {
    for (let i = 0; i < 5; i += 1) {
      await appendAudit(
        { action: "preview-start", operator: OPERATOR, runId: `run-${i}` },
        { studioRoot: root, now: () => new Date(Date.UTC(2026, 8, 24, 10, i)) },
      );
    }
    const { entries, unreadable } = await readAudit(3, { studioRoot: root });
    expect(entries.map((e) => e.runId)).toEqual(["run-4", "run-3", "run-2"]);
    expect(unreadable).toBe(0);
  });

  it("an absent trail is empty, not an error", async () => {
    expect(await readAudit(10, { studioRoot: root })).toEqual({ entries: [], unreadable: 0 });
  });

  it("a line that does not parse against the schema is COUNTED, never returned and never silently dropped", async () => {
    await appendAudit({ action: "ship", operator: OPERATOR }, { studioRoot: root });
    fs.appendFileSync(auditFileFor(root), '{"at":"x","action":"ship","operator":"Karsten Haldan","prompt":"p"}\n{torn\n');
    await appendAudit({ action: "signoff", operator: OPERATOR }, { studioRoot: root });
    const { entries, unreadable } = await readAudit(10, { studioRoot: root });
    expect(entries.map((e) => e.action)).toEqual(["signoff", "ship"]);
    expect(unreadable).toBe(2);
  });

  it("refuses a limit that is not a positive integer", async () => {
    await expect(readAudit(0, { studioRoot: root })).rejects.toThrow();
    await expect(readAudit(1.5, { studioRoot: root })).rejects.toThrow();
  });
});
