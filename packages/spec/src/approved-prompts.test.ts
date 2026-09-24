/**
 * The approved-prompt loader: a NEW model-facing text reaches a model only from a file a named
 * human approved, pinned to the exact bytes they approved.
 *
 * Prompt wording is human-owned (host D-033 decision 13, kept with a human by D-035). The
 * workflow, revise and repair modes need new texts, and the existing `buildRepairPrompt` opens
 * with "Your previous reply did not fit the required JSON shape", which is false for a semantic
 * refusal. So the code ships a loader and NO text: every outcome below except the last refuses.
 *
 * The expected hashes are computed with `node:crypto` over the file's BYTES, independently of
 * the loader, so "hash-pinned" means what `shasum -a 256 <file>` prints — the command the
 * README gives the approver.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APPROVED_PROMPT_IDS, APPROVED_PROMPTS_DIR, loadApprovedPrompt } from "./approved-prompts";

const bytesHash = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

let dir = "";
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "approved-prompts-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const TEXT = "Placeholder wording for a test only.\nIt is never shipped.\n";

function writePrompt(id: string, bytes: Uint8Array | string): void {
  fs.writeFileSync(path.join(dir, `${id}.md`), bytes);
}
function writeApproval(id: string, approval: unknown): void {
  fs.writeFileSync(path.join(dir, `${id}.approval.json`), typeof approval === "string" ? approval : JSON.stringify(approval));
}
function approvalFor(id: string, bytes: Uint8Array | string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, approvedBy: "Karsten Haldan", approvedAt: "2026-09-24", sha256: bytesHash(bytes), ...over };
}

describe("the allowlist", () => {
  it("names exactly the four new model-facing texts", () => {
    expect([...APPROVED_PROMPT_IDS]).toEqual(["translation-repair", "workflow-draft", "workflow-repair", "revise"]);
    expect(Object.isFrozen(APPROVED_PROMPT_IDS)).toBe(true);
  });

  it("refuses an id that is not on it, even when an approved file for it exists", () => {
    writePrompt("system", TEXT);
    writeApproval("system", approvalFor("system", TEXT));
    expect(loadApprovedPrompt("system", dir)).toEqual({ ok: false, problem: "unknown-prompt" });
  });

  it("refuses a path-shaped id rather than resolving it", () => {
    expect(loadApprovedPrompt("../revise", dir)).toEqual({ ok: false, problem: "unknown-prompt" });
  });
});

describe("loadApprovedPrompt refuses until a named human approved these exact bytes", () => {
  it("missing: there is no <id>.md", () => {
    writeApproval("revise", approvalFor("revise", TEXT));
    expect(loadApprovedPrompt("revise", dir)).toEqual({ ok: false, problem: "missing" });
  });

  it("unapproved: there is no <id>.approval.json", () => {
    writePrompt("revise", TEXT);
    expect(loadApprovedPrompt("revise", dir)).toEqual({ ok: false, problem: "unapproved" });
  });

  it("unapproved: approvedBy is null (a draft awaiting the owner)", () => {
    writePrompt("revise", TEXT);
    writeApproval("revise", approvalFor("revise", TEXT, { approvedBy: null, approvedAt: null }));
    expect(loadApprovedPrompt("revise", dir)).toEqual({ ok: false, problem: "unapproved" });
  });

  it.each(["system", "agent", "Studio", "", " "])("unapproved: approvedBy %j is not a named human", (approvedBy) => {
    writePrompt("revise", TEXT);
    writeApproval("revise", approvalFor("revise", TEXT, { approvedBy }));
    expect(loadApprovedPrompt("revise", dir)).toEqual({ ok: false, problem: "unapproved" });
  });

  it.each([null, "", "yesterday", "2026-13-40"])("unapproved: approvedAt %j is not a real ISO date", (approvedAt) => {
    writePrompt("revise", TEXT);
    writeApproval("revise", approvalFor("revise", TEXT, { approvedAt }));
    expect(loadApprovedPrompt("revise", dir)).toEqual({ ok: false, problem: "unapproved" });
  });

  it("unapproved: the approval record is not JSON, or not the approval shape", () => {
    writePrompt("revise", TEXT);
    writeApproval("revise", "{ approvedBy: Karsten Haldan");
    expect(loadApprovedPrompt("revise", dir)).toEqual({ ok: false, problem: "unapproved" });
    writeApproval("revise", ["Karsten Haldan"]);
    expect(loadApprovedPrompt("revise", dir)).toEqual({ ok: false, problem: "unapproved" });
    writeApproval("revise", approvalFor("revise", TEXT, { sha256: "not-a-hash" }));
    expect(loadApprovedPrompt("revise", dir)).toEqual({ ok: false, problem: "unapproved" });
  });

  it("unapproved: an approval copied from another prompt does not approve this one", () => {
    // Same bytes, same named human — but the record says it approved `workflow-draft`, and an
    // approval of a text for one mode is not an approval of it for another.
    writePrompt("revise", TEXT);
    writeApproval("revise", approvalFor("workflow-draft", TEXT));
    expect(loadApprovedPrompt("revise", dir)).toEqual({ ok: false, problem: "unapproved" });
  });

  it("hash-mismatch: the text changed after it was approved", () => {
    writeApproval("revise", approvalFor("revise", TEXT));
    writePrompt("revise", TEXT.replace("never", "always"));
    expect(loadApprovedPrompt("revise", dir)).toEqual({ ok: false, problem: "hash-mismatch" });
  });

  it("hash-mismatch: even a trailing-newline edit is a different text", () => {
    writeApproval("revise", approvalFor("revise", TEXT));
    writePrompt("revise", `${TEXT}\n`);
    expect(loadApprovedPrompt("revise", dir)).toEqual({ ok: false, problem: "hash-mismatch" });
  });

  it("not-utf8: approved bytes that are not UTF-8 are refused, never decoded lossily", () => {
    const bytes = Uint8Array.from([0x48, 0x69, 0xff, 0xfe, 0x0a]);
    writePrompt("revise", bytes);
    writeApproval("revise", approvalFor("revise", bytes));
    expect(loadApprovedPrompt("revise", dir)).toEqual({ ok: false, problem: "not-utf8" });
  });
});

describe("loadApprovedPrompt returns an approved text exactly", () => {
  it("returns the text and the sha256 of its bytes", () => {
    writePrompt("workflow-draft", TEXT);
    writeApproval("workflow-draft", approvalFor("workflow-draft", TEXT));
    expect(loadApprovedPrompt("workflow-draft", dir)).toEqual({ ok: true, id: "workflow-draft", text: TEXT, sha256: bytesHash(TEXT) });
  });

  it("pins bytes, not characters: non-ASCII text and a leading BOM hash as the file does", () => {
    const text = "﻿Überprüfung — ✓ 𝄞\n";
    writePrompt("translation-repair", text);
    writeApproval("translation-repair", approvalFor("translation-repair", text));
    const loaded = loadApprovedPrompt("translation-repair", dir);
    expect(loaded).toEqual({ ok: true, id: "translation-repair", text, sha256: bytesHash(Buffer.from(text, "utf8")) });
  });
});

describe("⛔ fence: what ships in packages/spec/prompts/", () => {
  const entries = fs.readdirSync(APPROVED_PROMPTS_DIR).sort();
  const ids: readonly string[] = APPROVED_PROMPT_IDS;

  it("is the directory next to this package's src/", () => {
    expect(APPROVED_PROMPTS_DIR).toBe(path.resolve(__dirname, "../prompts"));
  });

  it("carries a README naming the owner-approval procedure", () => {
    expect(entries).toContain("README.md");
    const readme = fs.readFileSync(path.join(APPROVED_PROMPTS_DIR, "README.md"), "utf8");
    expect(readme).toContain("shasum -a 256");
    for (const id of ids) expect(readme).toContain(id);
  });

  it("holds nothing but the README and <allowlisted id>.md / .approval.json files", () => {
    const stray = entries.filter((name) => {
      if (name === "README.md") return false;
      const match = /^(.+?)(\.md|\.approval\.json)$/.exec(name);
      return match === null || !ids.includes(match[1] ?? "");
    });
    expect(stray).toEqual([]);
  });

  it("every prompt .md has its approval json, and every approval json its .md", () => {
    const stems = (suffix: string): string[] =>
      entries.filter((name) => name !== "README.md" && name.endsWith(suffix)).map((name) => name.slice(0, -suffix.length));
    const prompts = stems(".md");
    const approvals = stems(".approval.json");
    expect(prompts.filter((id) => !approvals.includes(id)), "prompt text without an approval record").toEqual([]);
    expect(approvals.filter((id) => !prompts.includes(id)), "approval record without a prompt text").toEqual([]);
  });

  it("with no text shipped, every allowlisted prompt loads as missing from the real directory", () => {
    // When the owner approves a text, this case is the one to update: its id then loads ok.
    for (const id of ids) {
      if (entries.includes(`${id}.md`)) continue;
      expect(loadApprovedPrompt(id), id).toEqual({ ok: false, problem: "missing" });
    }
  });
});
