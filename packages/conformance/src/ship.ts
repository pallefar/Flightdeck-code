/** The write path. The only sanctioned way a generated sub-app reaches a
 * disk, and the place the gate's refusal is actually load-bearing.
 *
 * ⭐ WHY THE GATE AND THE WRITE LIVE IN THE SAME FUNCTION. A gate whose
 * blocking power is documented rather than executed is a suggestion.
 * `assertShippable` has always been able to throw; nothing stopped a
 * caller from not calling it. So the write is HERE, behind the
 * verification, and there is no exported way to get the one without the
 * other. `shipSubApp` runs the contract checks, the compiler and the
 * sandboxed mount, and writes only if all three passed — which is why it
 * is async: teeth cost a subprocess.
 *
 * ⭐ AND WHY THE WRITE ITSELF IS THE CAREFUL PART. Approving the content
 * is half the job; the other half is that the act of writing cannot be
 * turned into an attack or a silent corruption:
 *
 *   • CONTAINMENT. Every path is checked against the repo root and
 *     against the three directories a sub-app may occupy, BEFORE anything
 *     is opened. `../../.ssh/authorized_keys` and
 *     `server/subapps/../../../etc/x` are model output like any other.
 *   • NO SYMLINK WRITES. An existing symlink at a target is refused
 *     outright, because writing through one escapes every check above it.
 *   • NOTHING EXISTING IS OVERWRITTEN unless the caller named that exact
 *     path. A generated `wc-clock` that happens to emit
 *     `server/subapps/registry.ts` does not get to replace it.
 *   • ALL-OR-NOTHING. Every target is planned and stat-ed first; one
 *     refusal means zero writes, not a half-installed sub-app. A failure
 *     during the commit rolls the whole set back.
 *   • EVERY OUTCOME IS THE REAL ONE. There is no `catch (e) { log(e) }`
 *     in this file. A write that fails is reported as failed, carrying
 *     the underlying message, and the caller is told what was rolled
 *     back. A step is never recorded as complete because nobody looked. */
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, rename, rm, unlink } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { analyzeCandidate, type CandidateSubApp } from "./analyze";
import { ConformanceError } from "./gate";
import { verifySubApp, type VerificationReport, type VerifyOptions } from "./verify";

export interface ShipOptions extends VerifyOptions {
  /** The host repo the sub-app is being added to. Absolute. */
  readonly root: string;
  /** Repo-relative paths this call is allowed to replace. Anything else
   * that already exists refuses the whole write. */
  readonly allowOverwrite?: readonly string[];
  /** Verify and plan, report exactly what would happen, write nothing. */
  readonly dryRun?: boolean;
}

export type WriteStatus =
  /** On disk, and it was not there before. */
  | "written"
  /** On disk, replacing content the caller explicitly allowed replacing. */
  | "overwritten"
  /** Deliberately not written — a host edit that ships as a patch. */
  | "held"
  /** The write was refused before anything was opened. */
  | "refused"
  /** The write was attempted and the filesystem said no. */
  | "failed"
  /** Planned, then rolled back because another file in the set failed. */
  | "rolled-back";

export interface WriteOutcome {
  /** Repo-relative, as the candidate stated it. */
  readonly path: string;
  /** Absolute, as it was resolved — `null` when it never resolved. */
  readonly target: string | null;
  readonly status: WriteStatus;
  readonly bytes: number;
  /** The filesystem's own message. Never a summary of it. */
  readonly error: string | null;
  /** Why a `held` or `refused` file was not written. */
  readonly reason: string | null;
}

export interface ShipReport {
  readonly report: VerificationReport;
  readonly writes: readonly WriteOutcome[];
  /** True only when every file that was meant to land, landed. */
  readonly committed: boolean;
  readonly dryRun: boolean;
}

/** Thrown when the files were fine but the write could not be performed
 * safely — a path outside the sub-app's own directories, a target that
 * already exists, a symlink, or a filesystem error mid-commit. Carries the
 * per-file outcomes so the caller can say which one and why. */
export class ShipRefused extends Error {
  constructor(
    readonly writes: readonly WriteOutcome[],
    readonly report: VerificationReport,
    summary: string,
  ) {
    super(
      `${summary}\n` +
        writes
          .filter((write) => write.status === "refused" || write.status === "failed")
          .map((write) => `  - ${write.path}: ${write.error ?? write.reason ?? "refused"}`)
          .join("\n"),
    );
    this.name = "ShipRefused";
  }
}

/** ⛔ A generated file may not claim any of these. They are the host's
 * own, hand-maintained (contract §7), and a sub-app that writes one is
 * editing somebody else's file. */
const NEVER_WRITE = new Set([
  "server/subapps/registry.ts",
  "web/src/i18n.ts",
  "tests/subapps/i18nSplit.test.ts",
  "package.json",
  "tsconfig.json",
]);

export async function shipSubApp(candidate: CandidateSubApp, options: ShipOptions): Promise<ShipReport> {
  const root = resolve(options.root);

  // ── 1. Earn the right to write. ──────────────────────────────────
  const report = await verifySubApp(candidate, options);
  if (!report.verified) throw new ConformanceError(report);

  const analysis = analyzeCandidate(candidate);
  if (!analysis.ok) throw new ConformanceError(report);
  const allowedRoots = [
    `server/subapps/${analysis.app.id}/`,
    `web/src/subapps/${analysis.app.webModuleId}/`,
    `tests/subapps/${analysis.app.id}/`,
  ];
  const allowOverwrite = new Set(options.allowOverwrite ?? []);

  // ── 2. Plan every file before opening any of them. ───────────────
  interface Planned {
    readonly path: string;
    readonly target: string;
    readonly contents: string;
    readonly replacing: boolean;
  }
  const planned: Planned[] = [];
  const outcomes = new Map<string, WriteOutcome>();

  for (const file of candidate.files) {
    const held = holdReason(file.path);
    if (held !== null) {
      outcomes.set(file.path, { path: file.path, target: null, status: "held", bytes: 0, error: null, reason: held });
      continue;
    }

    const contained = containedTarget(root, file.path);
    if (contained === null) {
      outcomes.set(file.path, {
        path: file.path,
        target: null,
        status: "refused",
        bytes: 0,
        error: null,
        reason: `${file.path} does not resolve to a path inside ${root} — a generated path that climbs out of the repo is refused before it is opened, not after`,
      });
      continue;
    }
    const { target, within } = contained;
    // ⛔ CHECKED ON `within`, NOT ON `file.path`. The two differ exactly
    // when the path climbs — `tests/subapps/<id>/../../../x` starts with
    // an allowed prefix and lands at the repo root. The question is where
    // the bytes go, so it is asked of the resolved path.
    if (!allowedRoots.some((prefix) => within.startsWith(prefix))) {
      outcomes.set(file.path, {
        path: file.path,
        target,
        status: "refused",
        bytes: 0,
        error: null,
        reason: `a sub-app writes only under ${allowedRoots.join(", ")} — ${file.path} resolves to ${within}, which is outside all three`,
      });
      continue;
    }

    let existing: { isSymbolicLink(): boolean } | null;
    try {
      existing = await statOrNull(target);
    } catch (error) {
      // A stat that fails for any reason other than "not there" — a
      // parent that is a file, a permission wall — is a refusal with the
      // filesystem's own message, never an exception out of the planner.
      outcomes.set(file.path, {
        path: file.path,
        target,
        status: "refused",
        bytes: 0,
        error: (error as Error).message,
        reason: `${file.path} could not be inspected before writing, and an unknown target is not written to`,
      });
      continue;
    }
    if (existing !== null && existing.isSymbolicLink()) {
      outcomes.set(file.path, {
        path: file.path,
        target,
        status: "refused",
        bytes: 0,
        error: null,
        reason: `${file.path} already exists as a symlink — writing through it would land wherever it points, outside every check above`,
      });
      continue;
    }
    if (existing !== null && !allowOverwrite.has(file.path)) {
      outcomes.set(file.path, {
        path: file.path,
        target,
        status: "refused",
        bytes: 0,
        error: null,
        reason: `${file.path} already exists and this call did not list it in allowOverwrite — a generated sub-app does not silently replace a file somebody else wrote`,
      });
      continue;
    }

    planned.push({ path: file.path, target, contents: file.contents, replacing: existing !== null });
  }

  // ── 3. One refusal means zero writes. ────────────────────────────
  if ([...outcomes.values()].some((outcome) => outcome.status === "refused")) {
    for (const item of planned) {
      outcomes.set(item.path, { path: item.path, target: item.target, status: "rolled-back", bytes: 0, error: null, reason: "another file in this set was refused, and a sub-app is installed whole or not at all" });
    }
    const writes = order(candidate, outcomes);
    throw new ShipRefused(writes, report, `refused to write ${analysis.app.id}: the file set cannot be installed safely.`);
  }

  if (options.dryRun === true) {
    for (const item of planned) {
      outcomes.set(item.path, {
        path: item.path,
        target: item.target,
        status: item.replacing ? "overwritten" : "written",
        bytes: Buffer.byteLength(item.contents, "utf8"),
        error: null,
        reason: "dry run: nothing was written",
      });
    }
    return { report, writes: order(candidate, outcomes), committed: false, dryRun: true };
  }

  // ── 4. Commit, with a journal, and roll back on the first failure. ─
  const journal = join(root, `.flightdeck-ship-${randomUUID().slice(0, 8)}`);
  const done: { readonly item: Planned; readonly backup: string | null }[] = [];

  try {
    await mkdir(journal, { recursive: true });

    for (const item of planned) {
      if (options.signal?.aborted === true) {
        throw new Error("cancelled by the caller before the write completed");
      }

      let backup: string | null = null;
      // Every one of these awaits can reject, and every rejection leaves
      // this loop. There is no per-file catch: a file that did not land
      // must never be reported as one that did.
      await mkdir(dirnameOf(item.target), { recursive: true });
      if (item.replacing) {
        backup = join(journal, `${done.length}.bak`);
        await copyFile(item.target, backup);
      }
      const temporary = `${item.target}.${randomUUID().slice(0, 8)}.tmp`;
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
      try {
        await handle.writeFile(item.contents, "utf8");
        // The rename below is atomic; without the sync it can be atomic
        // and empty after a crash.
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, item.target);

      done.push({ item, backup });
      outcomes.set(item.path, {
        path: item.path,
        target: item.target,
        status: item.replacing ? "overwritten" : "written",
        bytes: Buffer.byteLength(item.contents, "utf8"),
        error: null,
        reason: null,
      });
    }
  } catch (error) {
    const message = (error as Error).message;
    const failedAt = planned[done.length];
    if (failedAt !== undefined) {
      outcomes.set(failedAt.path, { path: failedAt.path, target: failedAt.target, status: "failed", bytes: 0, error: message, reason: null });
    }
    const rollbackErrors = await rollback(done);
    for (const { item } of done) {
      outcomes.set(item.path, { path: item.path, target: item.target, status: "rolled-back", bytes: 0, error: null, reason: `undone after ${failedAt?.path ?? "a later file"} failed` });
    }
    for (const item of planned.slice(done.length + 1)) {
      outcomes.set(item.path, { path: item.path, target: item.target, status: "rolled-back", bytes: 0, error: null, reason: "never attempted: an earlier file in the set failed" });
    }
    await rm(journal, { recursive: true, force: true });
    throw new ShipRefused(
      order(candidate, outcomes),
      report,
      `writing ${analysis.app.id} failed at ${failedAt?.path ?? "an unknown file"} and was rolled back` +
        (rollbackErrors.length === 0 ? "." : `, except: ${rollbackErrors.join("; ")}.`),
    );
  }

  await rm(journal, { recursive: true, force: true });
  return { report, writes: order(candidate, outcomes), committed: true, dryRun: false };
}

// ── Path containment ────────────────────────────────────────────────────

/** The absolute target and the repo-relative path it actually resolves
 * to, or `null` when that is not inside the root. Absolute paths, `..` climbs, Windows separators, control
 * characters and NUL are all model output, and all handled here rather
 * than by the checks upstream — this is the last place before `open`. */
function containedTarget(root: string, candidatePath: string): { target: string; within: string } | null {
  if (candidatePath.length === 0) return null;
  if (/[\u0000-\u001f]/.test(candidatePath)) return null;
  if (isAbsolute(candidatePath) || candidatePath.startsWith("/") || /^[A-Za-z]:/.test(candidatePath)) return null;
  if (candidatePath.includes("\\")) return null;

  const target = resolve(root, candidatePath);
  const within = relative(root, target);
  if (within.length === 0 || within.startsWith("..") || isAbsolute(within)) return null;
  if (within.split(sep).some((segment) => segment === "..")) return null;
  return { target, within: within.split(sep).join("/") };
}

function holdReason(path: string): string | null {
  if (path.endsWith(".patch") || path.endsWith(".diff")) {
    return "a patch against a hand-maintained host file (contract §7) — this is handed to whoever is doing the mount, not applied by the gate";
  }
  if (NEVER_WRITE.has(path)) {
    return `${path} is the host's own file — a sub-app ships an edit to it as a patch, and never a replacement for it`;
  }
  return null;
}

async function statOrNull(target: string): Promise<{ isSymbolicLink(): boolean } | null> {
  try {
    return await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Undo what landed, newest first. Returns the paths that could NOT be
 * undone, so the caller is told the truth about a partial rollback rather
 * than a reassuring "rolled back". */
async function rollback(done: readonly { readonly item: { readonly target: string; readonly path: string }; readonly backup: string | null }[]): Promise<string[]> {
  const failures: string[] = [];
  for (const { item, backup } of [...done].reverse()) {
    try {
      if (backup === null) await unlink(item.target);
      else await copyFile(backup, item.target);
    } catch (error) {
      failures.push(`${item.path} (${(error as Error).message})`);
    }
  }
  return failures;
}

function order(candidate: CandidateSubApp, outcomes: ReadonlyMap<string, WriteOutcome>): WriteOutcome[] {
  return candidate.files.map(
    (file) =>
      outcomes.get(file.path) ?? {
        path: file.path,
        target: null,
        status: "refused" as const,
        bytes: 0,
        error: null,
        reason: "not planned",
      },
  );
}

function dirnameOf(path: string): string {
  const at = path.lastIndexOf(sep);
  return at <= 0 ? sep : path.slice(0, at);
}
