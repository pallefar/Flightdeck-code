/**
 * ⭐ THE APPROVED-PROMPT LOADER — new model-facing texts load only from human-approved,
 * hash-pinned files.
 *
 * Prompt wording is human-owned: the host's D-033 decision 13 keeps the `project-setup` prompt
 * wording with the owner or a named human, and D-035 declined to hand that over. Studio's
 * workflow, revise and repair modes each need a NEW text, and the one repair text that exists
 * (`buildRepairPrompt` in `prompt.ts`) opens with "Your previous reply did not fit the required
 * JSON shape", which is false when the model refused on substance. So no code in this repo
 * writes those texts. They are files in `packages/spec/prompts/`, and this loader hands one to a
 * caller only when:
 *
 *   - its id is on `APPROVED_PROMPT_IDS` (so a caller cannot name an arbitrary file);
 *   - `<id>.md` exists;
 *   - `<id>.approval.json` exists, names this id, a NAMED human (`isNamedHuman`, the rule the
 *     proposal-template catalogue and the guardrails' approvals use) and a real ISO date;
 *   - the sha256 of the `.md` file's BYTES equals the record's `sha256` — what
 *     `shasum -a 256 <id>.md` prints, so editing an approved text un-approves it, visibly;
 *   - those bytes are UTF-8. A file that is not is refused, never decoded with replacement
 *     characters into a text nobody approved.
 *
 * Every other outcome is a refusal the caller must honour: there is no fallback text. This
 * commit ships NO prompt text — `prompts/README.md` gives the owner-approval procedure — so
 * today every id loads as `missing`. `prompt.ts` is unchanged.
 *
 * ⛔ Node only: this module reads the filesystem, so `index.ts` does NOT re-export it (the
 * browser workbench and the vendored sub-app bundle import `@spec/index`). Import it by path.
 *
 * `dir` exists so the refusals can be tested against a temporary directory. A production
 * caller passes none, so it always reads the reviewed files in this package.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
// The catalogue's helpers, imported rather than copied: the same named-human rule, the same
// ISO-date check and the same SHA-256 (differentially tested against node:crypto).
import { isNamedHuman } from "../../guardrails/src/approval-pure";
import { sha256Hex } from "../../guardrails/src/sha256";
import { isIsoDate } from "../../codegen/src/proposal-templates";

/** The only prompts that may be loaded. Adding one is a reviewed code change. */
export const APPROVED_PROMPT_IDS = Object.freeze(["translation-repair", "workflow-draft", "workflow-repair", "revise"] as const);
export type ApprovedPromptId = (typeof APPROVED_PROMPT_IDS)[number];

/** `packages/spec/prompts/`. */
export const APPROVED_PROMPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../prompts");

export type ApprovedPromptProblem = "unknown-prompt" | "missing" | "unapproved" | "hash-mismatch" | "not-utf8";

export type ApprovedPromptLoad =
  | { readonly ok: true; readonly id: ApprovedPromptId; readonly text: string; readonly sha256: string }
  | { readonly ok: false; readonly problem: ApprovedPromptProblem };

/** `<id>.approval.json`. `approvedBy: null` is a draft awaiting the owner. */
const approvalSchema = z.object({
  id: z.string(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

function isApprovedPromptId(id: string): id is ApprovedPromptId {
  return (APPROVED_PROMPT_IDS as readonly string[]).includes(id);
}

/** The file's bytes, or `null` when it does not exist. Any other read error is thrown. */
function readBytes(file: string): Buffer | null {
  try {
    return fs.readFileSync(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

/** The pinned hash, only for a record that approves THIS id, by a named human, on a real date. */
function approves(id: ApprovedPromptId, bytes: Buffer | null): { sha256: string } | null {
  if (bytes === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
  const parsed = approvalSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { id: approvedId, approvedBy, approvedAt, sha256 } = parsed.data;
  if (approvedId !== id) return null;
  if (approvedBy === null || !isNamedHuman(approvedBy)) return null;
  if (approvedAt === null || !isIsoDate(approvedAt)) return null;
  return { sha256 };
}

/** The approved text for `id`, or why there is none. See the header for each refusal. */
export function loadApprovedPrompt(id: string, dir: string = APPROVED_PROMPTS_DIR): ApprovedPromptLoad {
  if (!isApprovedPromptId(id)) return { ok: false, problem: "unknown-prompt" };
  const bytes = readBytes(path.join(dir, `${id}.md`));
  if (bytes === null) return { ok: false, problem: "missing" };
  const approval = approves(id, readBytes(path.join(dir, `${id}.approval.json`)));
  if (approval === null) return { ok: false, problem: "unapproved" };
  let text: string;
  try {
    // `ignoreBOM` keeps a leading BOM in the text, so the text re-encodes to exactly these bytes
    // and `sha256Hex(text)` (which hashes the UTF-8 encoding) is the hash of the file.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { ok: false, problem: "not-utf8" };
  }
  const sha256 = sha256Hex(text);
  if (sha256 !== approval.sha256) return { ok: false, problem: "hash-mismatch" };
  return { ok: true, id, text, sha256 };
}
