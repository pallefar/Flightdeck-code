/** `provenance` as a command — the steps `scripts/promote.sh` runs.
 *
 *   npx tsx packages/compliance/src/provenance-cli.ts subject \
 *       --sandbox <root> --spec <spec.json> [--host <repo>] (--out <subject.json> | --dry-run)
 *
 *     Right after the candidate is mounted: derives the subject from the
 *     sandbox (app tree hash without PROVENANCE.json; every changed host file
 *     outside the app dir with its sha256) and REFUSES a changed host file
 *     codegen did not declare. `--dry-run` prints and writes nothing.
 *
 *   npx tsx packages/compliance/src/provenance-cli.ts seal \
 *       --subject <subject.json> --record <compliance-record.json> --studio <dir> \
 *       --studio-at <sha[-dirty]> [--host <repo>] [--sandbox <root>] [--catalogue-entry <id>] --out <PROVENANCE.json>
 *
 *     After the compliance record exists: binds the subject to the record's
 *     JCS digest, the Studio identity captured at step 0 (`--studio-at`; it
 *     refuses if the checkout moved or gained local changes since) and the
 *     host head, and writes the `studio-provenance/1` sidecar. With
 *     `--sandbox` it first re-hashes the subject there (and afterwards also
 *     writes the sidecar into the sandbox's app dir, its place); with
 *     `--host` it refuses if the host HEAD moved since the sandbox was built.
 *
 *   npx tsx packages/compliance/src/provenance-cli.ts studio-identity --studio <dir>
 *
 *     Prints the Studio checkout's identity, `<sha>` or `<sha>-dirty`. promote.sh
 *     captures it at step 0, BEFORE the suite, the red-team and codegen run,
 *     and hands it to `seal --studio-at`.
 *
 * Exit codes: 0 written / clean dry run; 1 refused (each reason on stderr,
 * nothing written); 2 bad usage or an unreadable input.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { SpecRejectedError } from "../../codegen/src/plan";
import { generateSubApp } from "../../codegen/src/generate";
import { CodegenInvariantError } from "../../codegen/src/invariants";
import {
  PROVENANCE_FILE,
  ProvenanceError,
  appDirOf,
  buildProvenance,
  checkSubject,
  declaredHostFiles,
  type ProvenanceSubject,
} from "./provenance";
import { deriveSubject, rehashSubject } from "./subject";

class Usage extends Error {}
class Refused extends Error {}

function args(argv: readonly string[]): { mode: string | undefined; opt: (n: string) => string | undefined; has: (n: string) => boolean } {
  return {
    mode: argv[0],
    opt: (name) => {
      const i = argv.indexOf(name);
      return i >= 0 ? argv[i + 1] : undefined;
    },
    has: (name) => argv.includes(name),
  };
}

function need(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) throw new Usage(`${name} is required`);
  return value;
}

function readJson(file: string, what: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch (err) {
    throw new Usage(`could not read ${what} at ${file} — ${(err as Error).message}`);
  }
}

function gitOut(dir: string, gitArgs: readonly string[]): string | null {
  const r = spawnSync("git", ["-C", dir, ...gitArgs], { encoding: "utf8" });
  return r.status === 0 ? r.stdout : null;
}

function hostHeadOf(repo: string): string {
  const head = gitOut(repo, ["rev-parse", "--verify", "HEAD^{commit}"]);
  if (head === null) throw new Usage(`${repo} has no HEAD`);
  return head.trim();
}

const STUDIO_IDENTITY_RE = /^[0-9a-f]{40}(-dirty)?$/;

/** The Studio checkout's identity: its HEAD commit, `-dirty` when it has any local change (untracked included). */
export function studioIdentity(studio: string): string {
  const head = gitOut(studio, ["rev-parse", "--verify", "HEAD^{commit}"]);
  const status = gitOut(studio, ["status", "--porcelain", "--untracked-files=all"]);
  if (head === null || status === null) throw new Usage(`${studio} is not a git checkout`);
  return status.trim().length === 0 ? head.trim() : `${head.trim()}-dirty`;
}

function studioIdentityCommand(a: ReturnType<typeof args>): void {
  process.stdout.write(`${studioIdentity(need(a.opt("--studio"), "--studio <dir>"))}\n`);
}

function subjectCommand(a: ReturnType<typeof args>): void {
  const root = need(a.opt("--sandbox"), "--sandbox <root>");
  const specPath = need(a.opt("--spec"), "--spec <spec.json>");
  const dryRun = a.has("--dry-run");
  const out = a.opt("--out");
  if (!dryRun && out === undefined) throw new Usage("--out <subject.json> or --dry-run is required");

  let generated;
  try {
    generated = generateSubApp(readJson(specPath, "the spec"));
  } catch (err) {
    if (err instanceof SpecRejectedError || err instanceof CodegenInvariantError) throw new Usage(err.message);
    throw err;
  }
  const derived = deriveSubject({
    root,
    subappId: generated.plan.id,
    version: generated.plan.version,
    declaredHostFiles: declaredHostFiles(generated.files),
  });
  if (!derived.ok) {
    for (const p of derived.problems) console.error(`provenance: ${p.code}${p.path === undefined ? "" : ` ${p.path}`} — ${p.detail}`);
    throw new Refused(`${derived.problems.length} problem(s); no subject`);
  }
  const host = a.opt("--host");
  if (host !== undefined && hostHeadOf(host) !== derived.hostHead) {
    throw new Refused(`host-moved — the sandbox holds ${derived.hostHead} but ${host} is now at ${hostHeadOf(host)}`);
  }
  const text = `${JSON.stringify({ hostHead: derived.hostHead, subject: derived.subject }, null, 2)}\n`;
  if (dryRun) {
    process.stdout.write(text);
    console.log(`provenance (dry-run): ${derived.subject.subappId} — ${derived.subject.hostFiles.length} host file(s) listed; nothing written`);
    return;
  }
  fs.writeFileSync(need(out, "--out"), text);
  console.log(`provenance: subject for ${derived.subject.subappId} written to ${out}`);
}

function sealCommand(a: ReturnType<typeof args>): void {
  const saved = readJson(need(a.opt("--subject"), "--subject <subject.json>"), "the subject");
  const record = readJson(need(a.opt("--record"), "--record <record.json>"), "the compliance record");
  const studio = need(a.opt("--studio"), "--studio <dir>");
  const out = need(a.opt("--out"), "--out <PROVENANCE.json>");
  if (typeof saved !== "object" || saved === null) throw new Usage("the subject file is not an object");
  const { hostHead, subject: rawSubject } = saved as { hostHead?: unknown; subject?: unknown };
  if (typeof hostHead !== "string" || typeof rawSubject !== "object" || rawSubject === null) {
    throw new Usage("the subject file has no hostHead / subject");
  }
  const subject = checkSubject(rawSubject as ProvenanceSubject);

  const host = a.opt("--host");
  if (host !== undefined && hostHeadOf(host) !== hostHead) {
    throw new Refused(`host-moved — the subject was derived at ${hostHead} but ${host} is now at ${hostHeadOf(host)}`);
  }
  const sandbox = a.opt("--sandbox");
  if (sandbox !== undefined) {
    const moved = rehashSubject(sandbox, subject);
    if (moved.length > 0) {
      for (const m of moved) console.error(`provenance: ${m.code}${m.path === undefined ? "" : ` ${m.path}`} — changed since the subject was derived`);
      throw new Refused("the candidate changed between mount and seal");
    }
  }

  // The identity promote.sh captured at step 0, before the suite, the
  // red-team and codegen ran — not the checkout as it is now. It is kept as
  // captured (a -dirty marker survives local edits reverted since), and the
  // seal refuses if the checkout moved to another commit or picked up local
  // changes in between: then what the record names is not what ran.
  const studioAt = need(a.opt("--studio-at"), "--studio-at <sha[-dirty]> (from `studio-identity` at step 0)");
  if (!STUDIO_IDENTITY_RE.test(studioAt)) throw new Usage(`--studio-at ${studioAt} is not <40-hex sha>[-dirty]`);
  const now = studioIdentity(studio);
  const capturedHead = studioAt.slice(0, 40);
  if (now.slice(0, 40) !== capturedHead) {
    throw new Refused(`studio-moved — the run started at Studio ${studioAt} but ${studio} is now at ${now}`);
  }
  if (!studioAt.endsWith("-dirty") && now.endsWith("-dirty")) {
    throw new Refused(`studio-moved — ${studio} was clean at ${capturedHead} when the run started and has local changes now`);
  }
  const studioCommit = studioAt;

  const catalogue = a.opt("--catalogue-entry");
  const provenance = buildProvenance({
    record,
    studioCommit,
    hostHead,
    catalogueEntryId: catalogue === undefined || catalogue === "" ? null : catalogue,
    subject,
  });
  const text = `${JSON.stringify(provenance, null, 2)}\n`;
  fs.writeFileSync(out, text);
  // …and in its place, the app dir's root, where the tree hash already leaves it out.
  if (sandbox !== undefined) fs.writeFileSync(path.join(sandbox, appDirOf(subject.subappId), PROVENANCE_FILE), text);
  console.log(`provenance: ${provenance.schema} for ${subject.subappId} written to ${out} (record ${provenance.recordSha256})`);
}

export function main(argv: readonly string[]): number {
  const a = args(argv);
  try {
    if (a.mode === "subject") subjectCommand(a);
    else if (a.mode === "seal") sealCommand(a);
    else if (a.mode === "studio-identity") studioIdentityCommand(a);
    else throw new Usage('the first argument is "studio-identity", "subject" or "seal"');
    return 0;
  } catch (err) {
    if (err instanceof Refused) {
      console.error(`provenance: refused — ${err.message}`);
      return 1;
    }
    if (err instanceof ProvenanceError) {
      console.error(err.message);
      return 1;
    }
    console.error(`provenance: ${(err as Error).message}`);
    return 2;
  }
}

if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main(process.argv.slice(2)));
}
