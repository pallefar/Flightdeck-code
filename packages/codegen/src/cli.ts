/** `codegen` as a command, in the house shape.
 *
 * Modelled on `flightdeck/scripts/scaffold-parity.ts` — the codebase's own
 * deterministic manifest-to-file generator — because that script already
 * encodes the doctrine: parse argv by hand, refuse with an exit code and a
 * named reason rather than a stack trace, print the plan under `--dry-run`,
 * and never overwrite an existing file without `--force`.
 *
 *   npx tsx packages/codegen/src/cli.ts --spec <spec.json|-> --out <host-repo> [--dry-run] [--force]
 *                                        [--standalone <dir>]
 *
 * `--standalone <dir>` ALSO writes the harness that runs this sub-app outside
 * Flightdeck OS, into a root of its own. It is a separate root on purpose and
 * not a flag on `--out`: two of the harness files sit at host paths and would
 * overwrite the real registry. The sub-app's own files are written to BOTH
 * roots, byte-identical — that identity is the property the standalone build
 * exists to demonstrate, and `standalone.test.ts` hashes it rather than
 * trusting this comment.
 *
 * `--out` is the ROOT of the Flightdeck host repository; every emitted path
 * is already repo-relative. `--dry-run` writes nothing and lists what would
 * land, including the registry patch. `--spec -` reads the spec from stdin,
 * for piping a model's output straight in.
 *
 * ── THE DOCTRINE, ENFORCED RATHER THAN STATED ────────────────────────
 * "A named reason rather than a stack trace" used to be true of every path
 * except the one that mattered — the write loop. Disk work now goes through
 * `apply.ts`, which stages the whole set before committing any of it and
 * returns failures as data; this file's only job is to turn that report
 * into human sentences and an exit code. Nothing here throws to the top.
 *
 * ── EXIT CODES ARE PART OF THE CONTRACT ──────────────────────────────
 *   0  applied, or already applied (re-running a spec is a no-op)
 *   1  refused, fixable with --force (a clash, or a file edited by hand)
 *   2  bad usage, an unreadable/truncated spec, a rejected spec, or a
 *      refusal --force must never unlock (a path leaving the repo root)
 *   3  the filesystem said no — nothing was committed, named errno
 *   4  cancelled by the operator; nothing was committed */
import fs from "node:fs";
import path from "node:path";
import { applyGeneratedFiles, applyWrites, fingerprint, planWrites, type ApplyReport } from "./apply";
import { emittedRecordPath } from "./emitters/migrations";
import { generateSubApp } from "./generate";
import { MINI_APP_FLOOR } from "./profile";
import { CodegenInvariantError } from "./invariants";
import { serverDir, webDir } from "./naming";
import { SpecRejectedError } from "./plan";
import { REGISTRY_PATH } from "./registry-patch";

const argv = process.argv.slice(2);
const has = (name: string): boolean => argv.includes(name);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

function fail(message: string, code = 2): never {
  console.error(`codegen: ${message}`);
  process.exit(code);
}

/** Reads the spec, from a file or from stdin.
 *
 * A spec is model-authored, and a model-authored document can arrive cut in
 * half — the pipe closed, the generation hit its token ceiling. That is a
 * DIFFERENT failure from "this is not valid JSON", and it gets its own
 * named reason, because the operator's next move differs: re-run the
 * generation, versus fix the file. Either way a partial document is refused
 * whole; there is no path by which half a spec becomes half a sub-app. */
function readSpecText(specPath: string): string {
  if (specPath === "-") {
    let text: string;
    try {
      text = fs.readFileSync(0, "utf8");
    } catch (err) {
      fail(`could not read the spec from stdin — ${(err as Error).message}`);
    }
    if (text.trim().length === 0) fail("the spec on stdin was empty");
    return text;
  }
  if (!fs.existsSync(specPath)) fail(`no spec at ${specPath}`);
  try {
    return fs.readFileSync(specPath, "utf8");
  } catch (err) {
    fail(`could not read ${specPath} — ${(err as Error).message}`);
  }
}

function parseSpec(specPath: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    const message = (err as Error).message;
    const where = specPath === "-" ? "the spec on stdin" : specPath;
    const truncated = /Unexpected end of JSON input|Unterminated string/i.test(message) || !/[}\]]\s*$/.test(text);
    if (truncated) {
      fail(`${where} ended mid-document (${text.length} bytes) — it is truncated, not malformed; re-run the generation that produced it`);
    }
    fail(`${where} is not valid JSON — ${message}`);
  }
}

function describeDisposition(d: string): string {
  switch (d) {
    case "create":
      return "create   ";
    case "refresh":
      return "refresh  ";
    case "resume":
      return "resume   ";
    case "identical":
      return "identical";
    case "drift":
      return "DRIFT    ";
    default:
      return "CLASH    ";
  }
}

function printReconciliation(report: ApplyReport): void {
  const { untracked, drifted, staleTempFiles } = report.reconciliation;
  for (const file of untracked) {
    console.warn(`codegen: note — ${file} is under this sub-app's directories but is not part of the plan`);
  }
  for (const file of drifted) {
    console.warn(`codegen: note — ${file} differs from what codegen last wrote`);
  }
  for (const file of staleTempFiles) {
    console.warn(`codegen: note — ${file} is a leftover staging file from an interrupted run; safe to delete`);
  }
}

export function main(): void {
  const specPath = opt("--spec");
  const outRoot = opt("--out");
  if (specPath === undefined) fail("--spec <spec.json> is required");
  if (outRoot === undefined) fail("--out <host-repo-root> is required");
  const standaloneRoot = opt("--standalone");
  const dryRun = has("--dry-run");
  const force = has("--force");

  const specText = readSpecText(specPath);
  const spec = parseSpec(specPath, specText);

  // The registry is read, never written: the output is a patch a human
  // applies, because "adding a sub-app is exactly as heavy as adding a
  // route file" is a review step, not an automation target.
  const registryAbs = path.join(outRoot, REGISTRY_PATH);
  const registrySource = fs.existsSync(registryAbs) ? fs.readFileSync(registryAbs, "utf8") : undefined;

  // mig-studio-emitted-migrations: what the last generation of this sub-app
  // emitted, so its migrations EVOLVE rather than restart. Read, never
  // written here; an unreadable record is a refusal, not "no record".
  const specId = (spec as { id?: unknown }).id;
  let previousEmitted: unknown;
  if (typeof specId === "string" && /^[a-z0-9-]+$/.test(specId)) {
    const recordAbs = path.join(outRoot, emittedRecordPath(specId));
    if (fs.existsSync(recordAbs)) {
      try {
        previousEmitted = JSON.parse(fs.readFileSync(recordAbs, "utf8"));
      } catch (err) {
        fail(`${emittedRecordPath(specId)} is not readable JSON (${(err as Error).message}) — codegen will not guess at the migrations it emitted before`);
      }
    }
  }

  let generated;
  try {
    generated = generateSubApp(spec, {
      ...(registrySource === undefined ? {} : { registrySource }),
      ...(previousEmitted === undefined ? {} : { previousEmitted }),
    });
  } catch (err) {
    if (err instanceof SpecRejectedError || err instanceof CodegenInvariantError) fail(err.message);
    throw err;
  }

  for (const warning of generated.warnings) console.warn(`codegen: warning — ${warning}`);

  // Which SHAPE is about to land, said before anything lands. The person
  // running this is the one the propose-don't-mutate design hands the
  // decision to, and "does this app own tables in my workspace?" is the
  // part of that decision they cannot get back once it boots.
  console.log(
    generated.plan.profile === "mini-app"
      ? `codegen: ${generated.plan.id} — mini-app, database-free (${MINI_APP_FLOOR})`
      : `codegen: ${generated.plan.id} — profile "table-backed": ships a schema.ts whose DDL runs on every boot in every workspace. This is NOT the mini-app path.`,
  );

  // Ctrl-C between the first and last file is exactly the hazard this
  // command is built around, so it is wired to the applier's cancellation
  // rather than to a default SIGINT that would kill the process mid-rename.
  //
  // Being precise about what this buys, because it is not "the loop stops
  // instantly": the apply is synchronous, so a handler cannot preempt it.
  // What installing one DOES do is stop Node terminating the process where
  // it stands — the apply runs to its next checkpoint, the abort is
  // observed, and the commit is rolled back, so the operator's cancel means
  // "none of it" rather than "however much of it had landed". The one thing
  // no handler can catch — SIGKILL, power loss — is covered by the other
  // end: the intent journal written before the first rename.
  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const report = applyGeneratedFiles(generated.files, {
    root: outRoot,
    planId: generated.plan.id,
    specFingerprint: fingerprint(specText),
    force,
    dryRun,
    ownedDirs: [serverDir(generated.plan.id), webDir(generated.plan.webModuleId), `tests/subapps/${generated.plan.id}`],
    signal: controller.signal,
  });

  // The SAME generated files, a second root, the other half of the set. The
  // sub-app's own files land in both; only the harness differs, and only the
  // harness is excluded from the host.
  const standaloneReport =
    standaloneRoot === undefined
      ? undefined
      : applyWrites(
          [...planWrites(generated.files, { target: "standalone" }), ...planWrites(generated.files, { target: "host" })],
          {
            root: standaloneRoot,
            planId: `${generated.plan.id}-standalone`,
            specFingerprint: fingerprint(specText),
            force,
            dryRun,
            ownedDirs: [
              "standalone",
              serverDir(generated.plan.id),
              webDir(generated.plan.webModuleId),
              `tests/subapps/${generated.plan.id}`,
            ],
            signal: controller.signal,
          },
        );

  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);

  for (const warning of report.warnings) console.warn(`codegen: warning — ${warning}`);
  if (standaloneReport !== undefined) {
    for (const warning of standaloneReport.warnings) console.warn(`codegen: standalone warning — ${warning}`);
    for (const refusal of standaloneReport.refusals) console.error(`codegen: standalone — ${refusal.detail}`);
    if (standaloneReport.outcome !== "applied" && !dryRun) {
      console.error(`codegen: the standalone tree was NOT written (${standaloneReport.outcome}); the host tree above is unaffected`);
      process.exitCode = 1;
    } else if (!dryRun) {
      console.log(
        `codegen: standalone tree written to ${standaloneRoot} — cd there, npm install, npm run dev. ` +
          `It has no RBAC, no kill switch and no audit chain; standalone/README.md says which column is which.`,
      );
    }
  }

  if (dryRun) {
    const lineCounts = new Map(generated.files.map((f) => [f.path, f.contents.split("\n").length]));
    console.log(`codegen (dry-run) — ${generated.plan.id}: ${report.actions.length} files`);
    for (const action of report.actions) {
      console.log(`  ${describeDisposition(action.disposition)} ${action.path} (${lineCounts.get(action.path) ?? 0} lines)`);
    }
    printReconciliation(report);
    if (report.refusals.length > 0) {
      for (const refusal of report.refusals) console.error(`codegen: ${refusal.detail}`);
      process.exit(report.refusals.every((r) => r.forceable) ? 1 : 2);
    }
    if (registrySource === undefined) {
      console.log(`  no ${REGISTRY_PATH} under --out, so no patch was generated; apply the edit by hand:`);
      console.log(`    ${generated.registryPatch.importLine}`);
      for (const line of generated.registryPatch.entryLines) console.log(`    ${line}`);
    }
    return;
  }

  switch (report.outcome) {
    case "refused": {
      // Nothing was written. Every refusal names its file and its reason.
      for (const refusal of report.refusals) console.error(`codegen: ${refusal.detail}`);
      console.error(`codegen: refused — ${report.refusals.length} file(s); nothing was written`);
      process.exit(report.refusals.every((r) => r.forceable) ? 1 : 2);
      break;
    }
    case "failed": {
      // Staged-then-committed means the tree is either fully updated or
      // exactly as it was. Say which, and name the errno.
      for (const failure of report.failures) {
        console.error(`codegen: ${failure.phase} of ${failure.path} failed with ${failure.code} — ${failure.message}`);
      }
      const committed = report.actions.filter((a) => a.status === "committed").length;
      console.error(
        committed === 0
          ? "codegen: nothing was written; the host repository is untouched. Fix the cause and re-run — the rerun resumes, it does not need --force."
          : `codegen: ${committed} file(s) were committed before the failure and could not be rolled back; re-run to finish, or inspect the files named above.`,
      );
      process.exit(3);
      break;
    }
    case "aborted": {
      console.error("codegen: cancelled — nothing was committed; the host repository is untouched.");
      process.exit(4);
      break;
    }
    case "no-op": {
      console.log(`codegen: ${generated.plan.label} is already on disk, byte for byte. Nothing to do.`);
      printReconciliation(report);
      return;
    }
    case "applied": {
      for (const action of report.actions) {
        if (action.status === "committed") console.log(`codegen: wrote ${action.path}`);
        else if (action.status === "already-applied") console.log(`codegen: unchanged ${action.path}`);
      }
      printReconciliation(report);
      console.log(
        `codegen: ${generated.plan.label} emitted. Apply ${REGISTRY_PATH}.patch to mount it — nothing runs until it is in SUBAPP_MANIFESTS.`,
      );
      console.log(`codegen: recorded in ${report.journalPath} — re-running this spec is a no-op, and an interrupted run resumes.`);
      return;
    }
  }
}

// Run only when invoked directly, so importing this module in a test does
// not parse argv and exit the runner. A throw from anywhere inside `main`
// becomes a named reason and exit code 3 — this command's contract says it
// does not hand operators a stack trace, and that has to hold for the
// unforeseen error too, not only the ones with a branch.
if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    main();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`codegen: unexpected failure — ${message}`);
    if (process.env["CODEGEN_DEBUG"] === "1" && err instanceof Error) console.error(err.stack);
    console.error("codegen: re-run with CODEGEN_DEBUG=1 for the stack trace.");
    process.exit(3);
  }
}
