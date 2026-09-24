/**
 * ⭐ THE STUDIO'S OWN AUDIT TRAIL — `<STUDIO>/.studio/audit.jsonl`.
 *
 * Nothing recorded who certified or shipped what. `promote.sh` step [6/6]
 * writes a compliance record whose note says it is "signed off by a human
 * only after reading the stack list", and nothing anywhere captured that
 * sign-off, or who started the run it signs. This is where the runner
 * (promote/mount/preview start and end), ship (`ship`, `signoff`,
 * `recertify`) and retention (`prune`) write it down.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────
 *
 * Not the HOST's audit chain. A sub-app never constructs a host audit hash
 * (contract §5 rule 5); that chain is `appendFlightdeckAudit()`'s alone.
 * This is a local, operator-side log of Studio's own actions, outside any
 * host checkout, with no chain and no hash of its own.
 *
 * ── WHY THE SCHEMA IS CLOSED, AND WHY EVERY VALUE HAS A SHAPE ────────────
 *
 * The one thing in this system most likely to contain a person's name is the
 * PROMPT (see `server/index.ts`, `logger: false`). A trail that accepted
 * "whatever the caller passed" would be the easiest place for it to land on
 * disk. So:
 *
 *   - `.strict()`: an extra key — `prompt`, `note`, `detail` — is a THROW,
 *     never a strip. Stripping would make the mistake silent;
 *   - every other field is an identifier with a pattern (a sha256, a run id,
 *     a git ref, a commit, a verdict CODE, counts), so free text cannot ride
 *     in a field that exists either;
 *   - `operator` is the one field that holds words, so the CALLER does not
 *     choose it: it must equal the configured `STUDIO_OPERATOR`, which must
 *     itself be name-shaped (letters, marks, spaces, `. ' -`; no digits) and
 *     a named human by the rule approvals use (`isNamedHuman`) — a sign-off
 *     by "system" is not a sign-off. With `STUDIO_OPERATOR` unset or not a
 *     name, NOTHING is written: the trail fails closed;
 *   - the refusal names issue PATHS and CODES only. `zod`'s own messages can
 *     quote the value they refused, and the value might be the prompt.
 *
 * ── APPEND-ONLY ─────────────────────────────────────────────────────────
 *
 * One `write()` per entry on an `O_APPEND` descriptor, so concurrent writers
 * (the runner's start and end, a ship in another terminal) never interleave
 * or overwrite. `O_NOFOLLOW` so a symlink planted at the path cannot redirect
 * the trail into another file. Directory 700, file 600 — and tightened when
 * found wider, rather than trusted. Nothing here truncates, rewrites or
 * deletes; retention never prunes this file.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { isNamedHuman } from "../packages/guardrails/src/approval-pure";

/**
 * The Studio checkout: the nearest ancestor of THIS FILE holding a
 * `package.json`. The same rule as `STUDIO_ROOT` in `server/index.ts` (a test
 * pins that they agree); not imported from there, so the runner and the ship
 * script can write the trail without loading the HTTP server and its provider.
 */
export const DEFAULT_STUDIO_ROOT: string = ((): string => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (let dir = here; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    if (path.dirname(dir) === dir) return path.dirname(here);
  }
})();

export const auditFileFor = (studioRoot: string): string => path.join(studioRoot, ".studio", "audit.jsonl");

export const AUDIT_ACTIONS = [
  "promote-start",
  "promote-done",
  "mount-done",
  "preview-start",
  "ship",
  "signoff",
  "recertify",
  "prune",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * The compliance record's verdict as a CODE. The record's own `verdict` is a
 * sentence ("BLOCKED — stacks failed"); the caller maps it, so no sentence is
 * ever copied into the trail.
 */
export const RECORD_VERDICTS = ["ready", "blocked", "not-certified"] as const;

const count = z.number().int().min(0).max(1_000_000);

/**
 * A person's name, as a shape: starts with a letter, then letters, combining
 * marks, spaces and `. ' ’ -`. No digits, no punctuation that makes a
 * sentence — "Zoë O'Brien-Łukasiewicz" passes, "earns 91000" cannot.
 */
const operatorName = z
  .string()
  .max(120)
  .regex(/^\p{L}[\p{L}\p{M} .'’-]+$/u)
  .refine((name) => isNamedHuman(name));

const auditInput = z
  .object({
    action: z.enum(AUDIT_ACTIONS),
    operator: operatorName,
    specSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    runId: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/)
      .optional(),
    recordVerdict: z.enum(RECORD_VERDICTS).optional(),
    branch: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/)
      .refine((ref) => !ref.includes(".."))
      .optional(),
    commit: z
      .string()
      .regex(/^[0-9a-f]{7,64}$/)
      .optional(),
    /** `prune` records how many, never which: counts only. */
    counts: z.object({ runs: count, worktrees: count }).partial().strict().optional(),
  })
  .strict();

const auditEntry = auditInput.extend({ at: z.string().datetime() }).strict();

export type AuditInput = z.input<typeof auditInput>;
export type AuditEntry = z.output<typeof auditEntry>;

export interface AuditOptions {
  /** Defaults to `DEFAULT_STUDIO_ROOT`. Tests pass a temp directory. */
  readonly studioRoot?: string;
  /** The clock, injectable for tests. */
  readonly now?: () => Date;
  /** Where `STUDIO_OPERATOR` is read from. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** Paths and codes only — never a received value. */
function refusal(error: z.ZodError): Error {
  const where = error.issues.map((i) => `${i.path.join(".") || "(entry)"}:${i.code}`).join(", ");
  return new Error(`studio audit: entry refused — ${where}`);
}

/**
 * The operator this Studio is configured for, or a throw. Fails CLOSED: no
 * configured operator means no entry, rather than an entry by whoever the
 * caller says. Neither name is echoed — both are a person's name.
 */
function requireConfiguredOperator(claimed: string, env: Readonly<Record<string, string | undefined>>): void {
  const configured = env["STUDIO_OPERATOR"]?.trim() ?? "";
  if (configured === "") throw new Error("studio audit: entry refused — STUDIO_OPERATOR is not set");
  if (!operatorName.safeParse(configured).success) {
    throw new Error("studio audit: entry refused — STUDIO_OPERATOR is not a named human");
  }
  if (claimed !== configured) {
    throw new Error("studio audit: entry refused — operator is not the configured STUDIO_OPERATOR");
  }
}

/** Creates `.studio` 700, or tightens it; refuses anything that is not a real directory. */
function ensureAuditDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory()) throw new Error("studio audit: .studio is not a directory");
  if ((stat.mode & 0o777) !== 0o700) fs.chmodSync(dir, 0o700);
}

/**
 * Appends one entry. Validates first — a refused entry writes nothing.
 * Resolves once the line is on disk (written, not merely queued).
 */
export async function appendAudit(input: AuditInput, options: AuditOptions = {}): Promise<AuditEntry> {
  const parsed = auditInput.safeParse(input);
  if (!parsed.success) throw refusal(parsed.error);
  requireConfiguredOperator(parsed.data.operator, options.env ?? process.env);
  const entry: AuditEntry = { at: (options.now ?? (() => new Date()))().toISOString(), ...parsed.data };
  const line = Buffer.from(`${JSON.stringify(entry)}\n`, "utf8");

  const file = auditFileFor(options.studioRoot ?? DEFAULT_STUDIO_ROOT);
  ensureAuditDir(path.dirname(file));
  const { O_WRONLY, O_APPEND, O_CREAT, O_NOFOLLOW } = fs.constants;
  const handle = await fs.promises.open(file, O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW, 0o600);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("studio audit: audit.jsonl is not a regular file");
    if ((stat.mode & 0o777) !== 0o600) await handle.chmod(0o600);
    const { bytesWritten } = await handle.write(line, 0, line.length);
    if (bytesWritten !== line.length) throw new Error("studio audit: short write");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return entry;
}

export interface AuditRead {
  /** Newest first. */
  readonly entries: readonly AuditEntry[];
  /** Lines in the whole trail that are not a valid entry (torn, hand-edited,
   * or carrying a key the schema refuses). Counted, never returned, and
   * never silently dropped. */
  readonly unreadable: number;
}

/** The newest `limit` entries, newest first. An absent trail is empty. */
export async function readAudit(limit: number, options: Pick<AuditOptions, "studioRoot"> = {}): Promise<AuditRead> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("studio audit: limit must be a positive integer");
  const file = auditFileFor(options.studioRoot ?? DEFAULT_STUDIO_ROOT);
  let text: string;
  try {
    const handle = await fs.promises.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      text = await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries: [], unreadable: 0 };
    throw error;
  }

  const valid: AuditEntry[] = [];
  let unreadable = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      unreadable += 1;
      continue;
    }
    const parsed = auditEntry.safeParse(json);
    if (parsed.success) valid.push(parsed.data);
    else unreadable += 1;
  }
  return { entries: valid.slice(-limit).reverse(), unreadable };
}
