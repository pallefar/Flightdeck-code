/** Getting a generated plan onto disk — and never leaving half of it there.
 *
 * ⭐ WHY THIS FILE EXISTS. Everything else in this package is paranoid about
 * TEXT: `plan.ts` refuses a spec, `emit.ts` refuses an identifier,
 * `invariants.ts` reads the emitted source back and refuses it. Then the
 * whole validated set used to reach the filesystem through an unguarded
 * `for … writeFileSync` loop. That loop was the one step with no story: an
 * `EACCES` on a read-only path, an `ENOSPC`, or a `SIGINT` on the 4th of 8
 * files left a HALF-MOUNTED sub-app in somebody's host repo — `manifest.ts`
 * and `guard.ts` present, `routes/` and `schema.ts` missing — surfaced as a
 * raw Node stack trace, and the rerun that should have repaired it was
 * refused by the clash check unless the operator reached for `--force`,
 * which is also the flag that overwrites their hand edits.
 *
 * ── THE FOUR MECHANISMS ──────────────────────────────────────────────
 *
 * 1. TWO-PHASE COMMIT. Every file is first written to a sibling temp file
 *    in its own destination directory and `fsync`ed (STAGE). Only when the
 *    WHOLE set is staged does anything get renamed into place (COMMIT).
 *    A full disk or a denied path is discovered in phase 1, where the
 *    destination tree has not been touched at all. A failure in phase 2
 *    rolls back: files we created are unlinked, files we overwrote are
 *    restored from the backup they were renamed to. Sibling temps, not a
 *    staging root, because a rename is only atomic within one filesystem.
 *
 * 2. A JOURNAL, so a rerun RESUMES instead of being refused.
 *    `.flightdeck-codegen/<id>.json` records the exact sha256 of every byte
 *    this tool committed. That turns four questions that used to be one
 *    ("does the file exist?") into four different answers: identical →
 *    skip; ours and untouched but the spec changed → refresh, no `--force`
 *    needed; ours and MODIFIED since → drift, refuse and name the file;
 *    never ours → clash, refuse. The interrupted-apply case — journal
 *    present, `completedAt: null`, files missing — is just "refresh the
 *    ones that are missing", so the repair rerun needs no flag at all.
 *    The journal is itself written through the same atomic tmp+rename, and
 *    an unreadable one degrades to "no journal" rather than throwing.
 *
 * 3. READ-BACK. After the commit phase the applier re-reads every file it
 *    wrote and re-hashes it. The report is what is ON DISK, not what was
 *    issued. The same pass walks the three directories a sub-app owns and
 *    reports files the plan does not account for, so a hand-added
 *    `routes/extra.ts` is visible instead of silently orphaned.
 *
 * 4. NO PATH LEAVES THE ROOT. One function resolves every destination:
 *    absolute paths, drive letters, `..` escapes, NUL bytes and `.git`
 *    segments are REFUSED, not clamped — and so is a path whose parent
 *    directory is a symlink, because normalization alone cannot see that.
 *    `--force` can never turn one of these into a write; it only ever
 *    unlocks clash and drift.
 *
 * Failures are DATA, not exceptions: `applyGeneratedFiles` returns an
 * `ApplyReport` whose every action carries a terminal status, and a failed
 * action carries the errno and the path that produced it. Aborted work is a
 * distinct outcome from failed work, so an operator's Ctrl-C is not
 * reported as a bug. The caller decides the exit code; this module never
 * calls `process.exit` and never prints. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { GeneratedFile } from "./invariants";

/** Where the journal lives, relative to the host repo root. */
export const JOURNAL_DIR = ".flightdeck-codegen";
const TMP_PREFIX = ".codegen-tmp-";
const BAK_PREFIX = ".codegen-bak-";

/* ── actions ────────────────────────────────────────────────────────── */

/** Content is distinguished at the point of write, not coerced through one
 * string path. Today every emitter produces `text`; a `bytes` payload that
 * ever arrives (an icon, a fixture) is written as bytes rather than being
 * stringified into corruption. */
export type WritePayload = { kind: "text"; text: string } | { kind: "bytes"; bytes: Uint8Array };

export interface WriteAction {
  /** Stable identity: sha256 of `path \0 bytes`, derived from the PLAN.
   * Two runs of the same spec produce the same id; call order and wall
   * clock do not enter into it. This is what the executed-guard compares. */
  readonly id: string;
  /** Repo-relative destination, exactly as the emitters named it. */
  readonly path: string;
  readonly payload: WritePayload;
  /** sha256 of the bytes that will land on disk. */
  readonly sha256: string;
  readonly kind: GeneratedFile["kind"];
}

/** Commit order. Not cosmetic: the sequential loop below guarantees that
 * when a file lands, everything it references is already there. `schema.ts`
 * precedes the `manifest.ts` that imports it; every route file precedes the
 * `routes/index.ts` that re-exports it; `manifest.ts` — the file the host's
 * `registry.ts` will import — is second to last; and `registry.ts.patch`,
 * the only artifact that asks a human to mount the thing, is last of all.
 * Nothing is dispatched in parallel, so a later step can never observe an
 * earlier step's file as absent. */
const COMMIT_RANK: Record<GeneratedFile["kind"], number> = {
  /** Beside the schema: the Postgres half of the same tables. */
  migration: 0,
  schema: 0,
  guard: 1,
  "routes-domain": 2,
  "routes-index": 3,
  "web-module": 4,
  "host-test": 5,
  manifest: 6,
  /** With the manifest: the record of what this generation emitted. */
  "emitted-record": 6,
  patch: 7,
  /** Last, and after the patch on purpose: the harness is the only thing in
   * the set that can be written to a DIFFERENT root from everything else, and
   * ranking it behind the mount artifact keeps the host sequence above exactly
   * as it was. */
  standalone: 8,
};

export function sha256(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/** sha256 of a UTF-8 string — used by the CLI to fingerprint the spec. */
export function fingerprint(text: string): string {
  return sha256(Buffer.from(text, "utf8"));
}

function payloadBytes(payload: WritePayload): Buffer {
  return payload.kind === "text" ? Buffer.from(payload.text, "utf8") : Buffer.from(payload.bytes);
}

/** One write action, content-addressed. The id is a function of the
 * destination and the bytes and of nothing else — not of when this ran or
 * of where in the list it sat. */
export function writeAction(relPath: string, payload: WritePayload, kind: GeneratedFile["kind"]): WriteAction {
  const bytes = payloadBytes(payload);
  return {
    id: crypto.createHash("sha256").update(relPath).update("\0").update(bytes).digest("hex").slice(0, 32),
    path: relPath,
    payload,
    sha256: sha256(bytes),
    kind,
  };
}

export function sortForCommit(actions: readonly WriteAction[]): WriteAction[] {
  return [...actions].sort(
    (a, b) => COMMIT_RANK[a.kind] - COMMIT_RANK[b.kind] || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
}

/** Turns emitted files into ordered write actions. Every emitter produces
 * text today, so this is the text door; `applyWrites` is the one that also
 * takes bytes. */
/**
 * WHICH TREE THESE WRITES ARE FOR.
 *
 * ⛔ `host` IS THE DEFAULT AND IT EXCLUDES THE STANDALONE HARNESS. Two of
 * those files sit at host paths — `web/src/subapps/registry.ts` and
 * `server/subapps/types.ts` — and writing them into a Flightdeck checkout
 * would overwrite the real registry (every other sub-app with it) and the
 * real capability types. This is a refusal, not a preference:
 * `applyGeneratedFiles` names the offending path rather than skipping it,
 * because a silent skip is how you find out later that half a harness landed.
 */
export type WriteTarget = "host" | "standalone" | "both";

export interface PlanWritesOptions {
  /** Default `"host"` — the behaviour before the harness existed. */
  readonly target?: WriteTarget;
}

export function planWrites(
  files: readonly GeneratedFile[],
  options: PlanWritesOptions = {},
): WriteAction[] {
  const target = options.target ?? "host";
  const wanted = files.filter((file) =>
    target === "both" ? true : target === "standalone" ? file.kind === "standalone" : file.kind !== "standalone",
  );
  return sortForCommit(wanted.map((file) => writeAction(file.path, { kind: "text", text: file.contents }, file.kind)));
}

export class StandaloneIntoHostError extends Error {
  constructor(readonly paths: readonly string[]) {
    super(
      "refusing to write the standalone harness into a host checkout: " +
        paths.join(", ") +
        ". Two of these sit at host paths and would overwrite the real registry and the real " +
        "capability types. Pass target: \"standalone\" with a root of its own.",
    );
    this.name = "StandaloneIntoHostError";
  }
}

/* ── path confinement ───────────────────────────────────────────────── */

export type RefusalReason =
  | "path-escape"
  | "dot-git"
  | "ancestor-is-symlink"
  | "destination-is-symlink"
  | "destination-is-directory"
  | "clash"
  | "drift";

export interface Refusal {
  readonly path: string;
  readonly reason: RefusalReason;
  readonly detail: string;
  /** `--force` unlocks clash and drift, and nothing else. A path that tries
   * to leave the root is not a policy decision an operator may override. */
  readonly forceable: boolean;
}

export class PathEscapeError extends Error {
  constructor(
    readonly relPath: string,
    readonly reason: RefusalReason,
    detail: string,
  ) {
    super(detail);
    this.name = "PathEscapeError";
  }
}

/** The ONE place a repo-relative path becomes an absolute one. Refuses
 * rather than clamps, because a clamped path silently writes somewhere the
 * caller did not name, and that is worse than a refusal. */
export function resolveWithinRoot(rootAbs: string, relPath: string): string {
  const bad = (reason: RefusalReason, detail: string): never => {
    throw new PathEscapeError(relPath, reason, detail);
  };
  if (relPath.length === 0) bad("path-escape", "empty path");
  if (relPath.includes("\0")) bad("path-escape", `${JSON.stringify(relPath)} contains a NUL byte`);
  if (path.isAbsolute(relPath) || relPath.startsWith("/") || relPath.startsWith("\\")) {
    bad("path-escape", `${JSON.stringify(relPath)} is absolute; every emitted path must be repo-relative`);
  }
  if (/^[A-Za-z]:/.test(relPath)) bad("path-escape", `${JSON.stringify(relPath)} carries a drive letter`);

  const normalized = path.normalize(relPath.replace(/\\/g, "/"));
  const segments = normalized.split(/[\\/]/).filter((s) => s.length > 0 && s !== ".");
  if (segments.some((s) => s === "..")) {
    bad("path-escape", `${JSON.stringify(relPath)} walks out of the project root with ".."`);
  }
  if (segments.some((s) => s === ".git")) {
    bad("dot-git", `${JSON.stringify(relPath)} writes inside .git — a git hook is executable code, never a generated file`);
  }
  if (segments.length === 0) bad("path-escape", `${JSON.stringify(relPath)} names no file`);

  const abs = path.resolve(rootAbs, segments.join(path.sep));
  const rel = path.relative(rootAbs, abs);
  if (rel.length === 0 || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    bad("path-escape", `${JSON.stringify(relPath)} resolves outside the project root`);
  }
  return abs;
}

/** Normalization cannot see a symlinked parent: `server/subapps` may itself
 * point anywhere. Walk the ancestors and refuse if any is a link. */
function assertAncestorsAreRealDirectories(rootAbs: string, absFile: string, relPath: string): void {
  const rel = path.relative(rootAbs, path.dirname(absFile));
  if (rel.length === 0) return;
  let cursor = rootAbs;
  for (const segment of rel.split(path.sep)) {
    cursor = path.join(cursor, segment);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(cursor);
    } catch {
      return; // does not exist yet — we will create it, so it cannot be a link
    }
    if (st.isSymbolicLink()) {
      throw new PathEscapeError(
        relPath,
        "ancestor-is-symlink",
        `${path.relative(rootAbs, cursor)} is a symlink; writing through it would leave the project root`,
      );
    }
  }
}

/* ── statuses and report ────────────────────────────────────────────── */

/** Terminal states are terminal. Nothing is caught, logged and allowed to
 * fall through to success. `aborted` is distinct from `failed` so a
 * user-initiated cancel is never reported as an error. */
export type ActionStatus =
  | "pending"
  | "staged"
  | "committed"
  | "already-applied"
  | "refused"
  | "failed"
  | "aborted"
  | "rolled-back";

/** What the preflight found at the destination, before anything was done. */
export type Disposition =
  | "create" // nothing there
  | "identical" // byte-for-byte what we would write
  | "refresh" // ours per the journal, unmodified since, and the spec changed
  | "resume" // ours per the journal, but missing from disk — an interrupted apply
  | "clash" // something is there that this tool never wrote
  | "drift"; // ours per the journal, but edited since

export interface ApplyFailure {
  readonly phase: "preflight" | "stage" | "commit" | "verify" | "journal" | "rollback";
  readonly path: string;
  /** An errno (`EACCES`, `ENOSPC`, `EXDEV`, …) or a codegen-defined reason. */
  readonly code: string;
  readonly message: string;
}

export interface ActionReport {
  readonly id: string;
  readonly path: string;
  readonly kind: GeneratedFile["kind"];
  readonly disposition: Disposition;
  readonly status: ActionStatus;
  readonly sha256: string;
  readonly error?: ApplyFailure;
  readonly refusal?: Refusal;
}

export interface Reconciliation {
  /** Journal-recorded files whose bytes on disk are not the bytes we wrote. */
  readonly drifted: string[];
  /** Files under a directory this sub-app owns that the plan does not. */
  readonly untracked: string[];
  /** Files the plan committed that a read-back could not find. */
  readonly missing: string[];
  /** Leftover staging files from a run that died — safe to delete. */
  readonly staleTempFiles: string[];
}

export type ApplyOutcome = "applied" | "no-op" | "refused" | "failed" | "aborted";

export interface ApplyReport {
  readonly outcome: ApplyOutcome;
  readonly root: string;
  readonly planId: string;
  readonly journalPath: string;
  readonly actions: ActionReport[];
  readonly refusals: Refusal[];
  /** Populated on `failed`/`aborted`: what actually went wrong, first. */
  readonly failures: ApplyFailure[];
  readonly reconciliation: Reconciliation;
  /** Non-fatal notes — an unreadable journal, a rollback that could not
   * fully undo itself. Never swallowed silently. */
  readonly warnings: string[];
}

export interface ApplyOptions {
  /** Host repository root. Every destination resolves inside it. */
  readonly root: string;
  /** The sub-app id; names the journal. */
  readonly planId: string;
  /** sha256 of the spec that produced these files, recorded for the operator. */
  readonly specFingerprint: string;
  /** Unlocks clash and drift — and only those. */
  readonly force?: boolean;
  /** Preflight and report, touch nothing. */
  readonly dryRun?: boolean;
  /** Directories the sub-app owns, for the reconciliation walk. */
  readonly ownedDirs?: readonly string[];
  /** Cancellation. Checked before every stage and before the commit phase;
   * an abort after the commit phase has begun rolls back rather than
   * stopping midway, because a half-committed tree is the thing this module
   * exists to prevent. */
  readonly signal?: AbortSignal;
  /** Injectable clock, so the journal is testable. */
  readonly now?: () => string;
}

/* ── journal ────────────────────────────────────────────────────────── */

interface JournalEntry {
  path: string;
  actionId: string;
  sha256: string;
  /** The sha this path held before this apply, when THAT content was also
   * ours. It closes the last re-run trap: if the process is killed between
   * two renames, or a rollback puts the old bytes back, the next run finds
   * content that matches neither "nothing there" nor the new target — and
   * without this field it would call that drift and demand `--force`, which
   * is the exact flag-reaching the journal exists to avoid. */
  supersedes: string | null;
  committedAt: string | null;
}

interface Journal {
  formatVersion: 1;
  planId: string;
  specFingerprint: string;
  startedAt: string;
  /** `null` means an apply began and never reported finishing. The next run
   * treats that as "resume", not as "clash". */
  completedAt: string | null;
  entries: JournalEntry[];
}

export function journalPathFor(rootAbs: string, planId: string): string {
  return path.join(rootAbs, JOURNAL_DIR, `${planId}.json`);
}

/** A file on somebody else's disk is untrusted input: shape-check it and
 * fall back to "no journal" rather than throwing out of a parse. */
function readJournal(at: string, warnings: string[]): Journal | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(at, "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    const j = parsed as Partial<Journal>;
    if (j.formatVersion !== 1 || typeof j.planId !== "string" || !Array.isArray(j.entries)) {
      throw new Error("unrecognised shape");
    }
    const entries: JournalEntry[] = [];
    for (const entry of j.entries as unknown[]) {
      if (typeof entry !== "object" || entry === null) continue;
      const e = entry as Partial<JournalEntry>;
      if (typeof e.path !== "string" || typeof e.sha256 !== "string" || typeof e.actionId !== "string") continue;
      entries.push({
        path: e.path,
        actionId: e.actionId,
        sha256: e.sha256,
        supersedes: typeof e.supersedes === "string" ? e.supersedes : null,
        committedAt: typeof e.committedAt === "string" ? e.committedAt : null,
      });
    }
    return {
      formatVersion: 1,
      planId: j.planId,
      specFingerprint: typeof j.specFingerprint === "string" ? j.specFingerprint : "",
      startedAt: typeof j.startedAt === "string" ? j.startedAt : "",
      completedAt: typeof j.completedAt === "string" ? j.completedAt : null,
      entries,
    };
  } catch (err) {
    warnings.push(
      `${path.basename(at)} could not be read as a codegen journal (${(err as Error).message}); treating every existing file as a clash`,
    );
    return undefined;
  }
}

/* ── the durable write primitives ───────────────────────────────────── */

function describe(err: unknown): { code: string; message: string } {
  const e = err as NodeJS.ErrnoException;
  return { code: typeof e?.code === "string" ? e.code : "EUNKNOWN", message: e?.message ?? String(err) };
}

/** Write-then-fsync into a sibling temp file. The fsync is the difference
 * between "the rename published the bytes" and "the rename published a
 * zero-length file that a crash had not flushed yet". */
function stageBytes(tmpAbs: string, bytes: Buffer): void {
  const fd = fs.openSync(tmpAbs, "wx", 0o644);
  try {
    fs.writeSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Durability of the rename itself. Not supported everywhere; a failure
 * here costs durability, never correctness, so it is ignored by design. */
function fsyncDir(dir: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch {
    /* platform does not permit directory fsync */
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

function writeFileAtomic(absPath: string, bytes: Buffer): void {
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `${TMP_PREFIX}${process.pid}-${crypto.randomBytes(4).toString("hex")}`);
  try {
    stageBytes(tmp, bytes);
    fs.renameSync(tmp, absPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* nothing staged */
    }
    throw err;
  }
  fsyncDir(dir);
}

/** Names the first ancestor that exists but is not a directory, if any. */
function blockingParent(rootAbs: string, absFile: string): string {
  const rel = path.relative(rootAbs, path.dirname(absFile));
  if (rel.length === 0) return "";
  let cursor = rootAbs;
  for (const segment of rel.split(path.sep)) {
    cursor = path.join(cursor, segment);
    try {
      if (!fs.lstatSync(cursor).isDirectory()) {
        return ` — ${path.relative(rootAbs, cursor).split(path.sep).join("/")} exists and is not a directory`;
      }
    } catch {
      return "";
    }
  }
  return "";
}

function unlinkQuietly(at: string): void {
  try {
    fs.unlinkSync(at);
  } catch {
    /* already gone */
  }
}

/* ── the applier ────────────────────────────────────────────────────── */

interface Slot {
  action: WriteAction;
  abs: string;
  tmp: string;
  bak: string;
  disposition: Disposition;
  bytes: Buffer;
  status: ActionStatus;
  error?: ApplyFailure;
  refusal?: Refusal;
  /** Set once the temp file exists, so cleanup knows what to remove. */
  staged: boolean;
  /** Set once the destination has been renamed aside, so rollback can undo. */
  backedUp: boolean;
  committed: boolean;
  existedBefore: boolean;
  /** sha of the bytes the destination held at preflight, if any. */
  previousSha: string | null;
  /** Were those bytes ours? Decides what goes in the journal's `supersedes`. */
  previousWasOurs: boolean;
}

/** The text-only convenience door: emitted files in, report out. */
export function applyGeneratedFiles(
  files: readonly GeneratedFile[],
  options: ApplyOptions & PlanWritesOptions,
): ApplyReport {
  const target = options.target ?? "host";
  if (target === "both") {
    // "both" would put the shims on top of the host's own files. There is no
    // root for which that is correct, so it is refused here rather than left
    // to whoever reads the report.
    const offending = files.filter((f) => f.kind === "standalone").map((f) => f.path);
    if (offending.length > 0) throw new StandaloneIntoHostError(offending);
  }
  return applyWrites(planWrites(files, { target }), options);
}

export function applyWrites(input: readonly WriteAction[], options: ApplyOptions): ApplyReport {
  const rootAbs = path.resolve(options.root);
  const now = options.now ?? (() => new Date().toISOString());
  const force = options.force === true;
  const warnings: string[] = [];
  const refusals: Refusal[] = [];
  const failures: ApplyFailure[] = [];
  const journalAt = journalPathFor(rootAbs, options.planId);
  const journal = readJournal(journalAt, warnings);
  const journalByPath = new Map<string, JournalEntry>(journal?.entries.map((e) => [e.path, e]) ?? []);

  const actions = sortForCommit(input);
  const slots: Slot[] = [];

  const report = (outcome: ApplyOutcome): ApplyReport => ({
    outcome,
    root: rootAbs,
    planId: options.planId,
    journalPath: path.relative(rootAbs, journalAt),
    actions: slots.map((s) => ({
      id: s.action.id,
      path: s.action.path,
      kind: s.action.kind,
      disposition: s.disposition,
      status: s.status,
      sha256: s.action.sha256,
      ...(s.error === undefined ? {} : { error: s.error }),
      ...(s.refusal === undefined ? {} : { refusal: s.refusal }),
    })),
    refusals,
    failures,
    reconciliation: reconcile(rootAbs, actions, journalByPath, options.ownedDirs ?? []),
    warnings,
  });

  /* ── PREFLIGHT ─────────────────────────────────────────────────────
   * Resolve, confine and classify every destination before touching any
   * of them. Everything that can be known without writing is known here. */
  for (const action of actions) {
    let abs: string;
    try {
      abs = resolveWithinRoot(rootAbs, action.path);
      assertAncestorsAreRealDirectories(rootAbs, abs, action.path);
    } catch (err) {
      if (!(err instanceof PathEscapeError)) throw err;
      const refusal: Refusal = { path: action.path, reason: err.reason, detail: err.message, forceable: false };
      refusals.push(refusal);
      slots.push(blankSlot(action, "", "clash", "refused", { refusal }));
      continue;
    }

    const dir = path.dirname(abs);
    const short = action.id.slice(0, 8);
    const tmp = path.join(dir, `${TMP_PREFIX}${process.pid}-${short}`);
    const bak = path.join(dir, `${BAK_PREFIX}${process.pid}-${short}`);
    const bytes = payloadBytes(action.payload);
    const entry = journalByPath.get(action.path);

    let st: fs.Stats | undefined;
    try {
      st = fs.lstatSync(abs);
    } catch {
      st = undefined;
    }

    let disposition: Disposition;
    let refusal: Refusal | undefined;
    let previousSha: string | null = null;
    let previousWasOurs = false;
    if (st === undefined) {
      // Missing. If the journal says we committed it, this is the
      // interrupted-apply case the old clash check could not express.
      disposition = entry !== undefined ? "resume" : "create";
      previousWasOurs = entry !== undefined;
    } else if (st.isSymbolicLink()) {
      disposition = "clash";
      refusal = {
        path: action.path,
        reason: "destination-is-symlink",
        detail: `${action.path} is a symlink; codegen will not write through one`,
        forceable: false,
      };
    } else if (st.isDirectory()) {
      disposition = "clash";
      refusal = {
        path: action.path,
        reason: "destination-is-directory",
        detail: `${action.path} is a directory, not a file`,
        forceable: false,
      };
    } else {
      let onDisk: string;
      try {
        onDisk = sha256(fs.readFileSync(abs));
      } catch (err) {
        const d = describe(err);
        const failure: ApplyFailure = { phase: "preflight", path: action.path, code: d.code, message: d.message };
        failures.push(failure);
        slots.push(blankSlot(action, abs, "clash", "failed", { error: failure }));
        continue;
      }
      previousSha = onDisk;
      // Ours if it is the content the journal last committed, OR the content
      // that commit replaced — an interrupted apply leaves one or the other.
      previousWasOurs = entry !== undefined && (entry.sha256 === onDisk || entry.supersedes === onDisk);
      if (onDisk === action.sha256) {
        disposition = "identical";
      } else if (previousWasOurs) {
        disposition = "refresh";
      } else if (entry !== undefined) {
        disposition = "drift";
        refusal = {
          path: action.path,
          reason: "drift",
          detail: `${action.path} was modified after codegen wrote it — pass --force to overwrite those edits`,
          forceable: true,
        };
      } else {
        disposition = "clash";
        refusal = {
          path: action.path,
          reason: "clash",
          detail: `${action.path} already exists and was not written by codegen — pass --force to overwrite`,
          forceable: true,
        };
      }
    }

    if (refusal !== undefined && !(force && refusal.forceable)) {
      refusals.push(refusal);
      slots.push(blankSlot(action, abs, disposition, "refused", { refusal }));
      continue;
    }

    slots.push({
      action,
      abs,
      tmp,
      bak,
      disposition,
      bytes,
      status: disposition === "identical" ? "already-applied" : "pending",
      staged: false,
      backedUp: false,
      committed: false,
      existedBefore: st !== undefined,
      previousSha,
      previousWasOurs,
    });
  }

  if (failures.length > 0) {
    cleanupStaged(slots);
    return report("failed");
  }
  if (refusals.length > 0) {
    // Nothing has been written. A refusal is not a failure: the tree is
    // exactly as it was, and the operator has a named reason per file.
    return report("refused");
  }

  const todo = slots.filter((s) => s.status === "pending");
  if (todo.length === 0) {
    // Every file already on disk is byte-for-byte what this plan says.
    // Re-processing the same plan is a no-op, not a duplicate write and
    // not a refusal — this is the executed-guard doing its job.
    if (!options.dryRun) touchJournal(journalAt, options, slots, now, warnings, failures);
    return report("no-op");
  }

  if (options.dryRun) return report("applied");

  /* ── STAGE ─────────────────────────────────────────────────────────
   * Write every file to a sibling temp and fsync it. A denied path or a
   * full disk surfaces HERE, where the destination tree is untouched. */
  for (const slot of todo) {
    if (options.signal?.aborted === true) {
      cleanupStaged(slots);
      for (const s of todo) s.status = "aborted";
      return report("aborted");
    }
    try {
      fs.mkdirSync(path.dirname(slot.abs), { recursive: true });
      unlinkQuietly(slot.tmp); // a leftover from a dead run of this same pid
      stageBytes(slot.tmp, slot.bytes);
      slot.staged = true;
      slot.status = "staged";
    } catch (err) {
      const d = describe(err);
      const failure: ApplyFailure = {
        phase: "stage",
        path: slot.action.path,
        code: d.code,
        // The raw errno for "a parent is a regular file" is `EEXIST … mkdir`,
        // which reads as the opposite of the problem. Say what is actually in
        // the way, so the operator's next move is obvious.
        message: `${d.message}${blockingParent(rootAbs, slot.abs)}`,
      };
      slot.error = failure;
      slot.status = "failed";
      failures.push(failure);
      cleanupStaged(slots);
      for (const s of todo) if (s.status === "staged" || s.status === "pending") s.status = "aborted";
      return report("failed");
    }
  }

  /* The intent record. Written BEFORE the first rename, so a crash in the
   * commit phase leaves behind a journal that says "an apply started and
   * did not finish" — which is what lets the next run repair it. */
  const intentOk = touchJournal(journalAt, options, slots, now, warnings, failures, { completed: false });
  if (!intentOk) {
    cleanupStaged(slots);
    for (const s of todo) s.status = "aborted";
    return report("failed");
  }

  /* ── COMMIT ────────────────────────────────────────────────────────
   * An explicit sequential loop, in COMMIT_RANK order. Overwrites rename
   * the old file aside first so a later failure can put it back. */
  const committed: Slot[] = [];
  for (const slot of todo) {
    try {
      if (slot.existedBefore) {
        unlinkQuietly(slot.bak);
        fs.renameSync(slot.abs, slot.bak);
        slot.backedUp = true;
      }
      fs.renameSync(slot.tmp, slot.abs);
      slot.staged = false;
      slot.committed = true;
      slot.status = "committed";
      committed.push(slot);
      fsyncDir(path.dirname(slot.abs));
    } catch (err) {
      const d = describe(err);
      const failure: ApplyFailure = { phase: "commit", path: slot.action.path, code: d.code, message: d.message };
      slot.error = failure;
      slot.status = "failed";
      failures.push(failure);
      rollback(slots, warnings, failures);
      return report("failed");
    }
  }

  const aborted = options.signal?.aborted === true;
  if (aborted) {
    // Honoured by undoing, not by stopping midway: a half-committed tree
    // is precisely what this module exists to prevent.
    rollback(slots, warnings, failures);
    for (const s of todo) s.status = "aborted";
    return report("aborted");
  }

  /* ── READ-BACK ─────────────────────────────────────────────────────
   * The report describes what is on disk, not what was issued. */
  for (const slot of committed) {
    try {
      const onDisk = sha256(fs.readFileSync(slot.abs));
      if (onDisk !== slot.action.sha256) {
        const failure: ApplyFailure = {
          phase: "verify",
          path: slot.action.path,
          code: "ECONTENT",
          message: `read-back of ${slot.action.path} hashed ${onDisk.slice(0, 12)}, expected ${slot.action.sha256.slice(0, 12)}`,
        };
        slot.error = failure;
        slot.status = "failed";
        failures.push(failure);
      }
    } catch (err) {
      const d = describe(err);
      const failure: ApplyFailure = { phase: "verify", path: slot.action.path, code: d.code, message: d.message };
      slot.error = failure;
      slot.status = "failed";
      failures.push(failure);
    }
  }

  for (const slot of slots) if (slot.backedUp) unlinkQuietly(slot.bak);

  touchJournal(journalAt, options, slots, now, warnings, failures);
  return report(failures.length > 0 ? "failed" : "applied");
}

function blankSlot(
  action: WriteAction,
  abs: string,
  disposition: Disposition,
  status: ActionStatus,
  extra: { error?: ApplyFailure; refusal?: Refusal },
): Slot {
  return {
    action,
    abs,
    tmp: "",
    bak: "",
    disposition,
    bytes: Buffer.alloc(0),
    status,
    staged: false,
    backedUp: false,
    committed: false,
    existedBefore: false,
    previousSha: null,
    previousWasOurs: false,
    ...(extra.error === undefined ? {} : { error: extra.error }),
    ...(extra.refusal === undefined ? {} : { refusal: extra.refusal }),
  };
}

function cleanupStaged(slots: readonly Slot[]): void {
  for (const slot of slots) if (slot.staged && slot.tmp.length > 0) unlinkQuietly(slot.tmp);
}

/** Undo the commit phase: unlink what we created, restore what we replaced.
 * Anything that cannot be undone becomes a WARNING naming the exact file —
 * never a silent partial state. */
function rollback(slots: readonly Slot[], warnings: string[], failures: ApplyFailure[]): void {
  for (const slot of [...slots].reverse()) {
    if (slot.committed) {
      try {
        if (slot.backedUp) fs.renameSync(slot.bak, slot.abs);
        else fs.unlinkSync(slot.abs);
        slot.status = "rolled-back";
        slot.committed = false;
      } catch (err) {
        const d = describe(err);
        const failure: ApplyFailure = { phase: "rollback", path: slot.action.path, code: d.code, message: d.message };
        failures.push(failure);
        warnings.push(`could not roll back ${slot.action.path}: ${d.code} — inspect it by hand`);
      }
    } else if (slot.backedUp) {
      try {
        fs.renameSync(slot.bak, slot.abs);
        slot.backedUp = false;
      } catch {
        warnings.push(`could not restore ${slot.action.path} from its backup — inspect it by hand`);
      }
    }
  }
  cleanupStaged(slots);
}

function touchJournal(
  journalAt: string,
  options: ApplyOptions,
  slots: readonly Slot[],
  now: () => string,
  warnings: string[],
  failures: ApplyFailure[],
  mode: { completed: boolean } = { completed: true },
): boolean {
  const stamp = now();
  const entries: JournalEntry[] = slots
    .filter((s) => s.status !== "refused" && s.tmp.length > 0)
    .map((s) => ({
      path: s.action.path,
      actionId: s.action.id,
      sha256: s.action.sha256,
      // Only the INTENT record needs the old sha. Once the commit phase has
      // finished there is nothing left to be ambiguous about, and a rollback
      // leaves the intent record in place — which is why rolling back needs
      // no journal write of its own.
      supersedes: mode.completed || !s.previousWasOurs ? null : s.previousSha,
      committedAt: mode.completed ? stamp : s.status === "committed" ? stamp : null,
    }));
  const journal: Journal = {
    formatVersion: 1,
    planId: options.planId,
    specFingerprint: options.specFingerprint,
    startedAt: stamp,
    completedAt: mode.completed ? stamp : null,
    entries,
  };
  try {
    writeFileAtomic(journalAt, Buffer.from(`${JSON.stringify(journal, null, 2)}\n`, "utf8"));
    return true;
  } catch (err) {
    const d = describe(err);
    const failure: ApplyFailure = { phase: "journal", path: path.basename(journalAt), code: d.code, message: d.message };
    failures.push(failure);
    warnings.push(`could not write ${path.basename(journalAt)} (${d.code}); a rerun will not be able to resume`);
    return false;
  }
}

/* ── reconciliation ─────────────────────────────────────────────────── */

function walk(dirAbs: string, rootAbs: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) walk(abs, rootAbs, out);
    else if (entry.isFile()) out.push(path.relative(rootAbs, abs).split(path.sep).join("/"));
  }
}

/** The in-memory plan, checked against what is actually on disk. Files that
 * arrived some other way — a hand edit, a second generator, an operator's
 * `routes/extra.ts` — enter the same report the CLI prints, instead of
 * being invisible because no write was issued for them. */
function reconcile(
  rootAbs: string,
  actions: readonly WriteAction[],
  journalByPath: ReadonlyMap<string, JournalEntry>,
  ownedDirs: readonly string[],
): Reconciliation {
  const planned = new Set(actions.map((a) => a.path));
  const drifted: string[] = [];
  const untracked: string[] = [];
  const missing: string[] = [];
  const staleTempFiles: string[] = [];

  for (const action of actions) {
    let abs: string;
    try {
      abs = resolveWithinRoot(rootAbs, action.path);
    } catch {
      continue;
    }
    if (!fs.existsSync(abs)) missing.push(action.path);
  }

  const seen = new Set<string>();
  for (const dir of ownedDirs) {
    let abs: string;
    try {
      abs = resolveWithinRoot(rootAbs, dir);
    } catch {
      continue;
    }
    const found: string[] = [];
    walk(abs, rootAbs, found);
    for (const rel of found) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      const base = path.basename(rel);
      if (base.startsWith(TMP_PREFIX) || base.startsWith(BAK_PREFIX)) {
        staleTempFiles.push(rel);
        continue;
      }
      if (!planned.has(rel)) untracked.push(rel);
    }
  }

  for (const [rel, entry] of journalByPath) {
    let abs: string;
    try {
      abs = resolveWithinRoot(rootAbs, rel);
    } catch {
      continue;
    }
    let onDisk: string;
    try {
      onDisk = sha256(fs.readFileSync(abs));
    } catch {
      continue;
    }
    if (onDisk === entry.sha256 || onDisk === entry.supersedes) continue;
    const action = actions.find((a) => a.path === rel);
    if (action === undefined || action.sha256 !== onDisk) drifted.push(rel);
  }

  drifted.sort();
  untracked.sort();
  missing.sort();
  staleTempFiles.sort();
  return { drifted, untracked, missing, staleTempFiles };
}
