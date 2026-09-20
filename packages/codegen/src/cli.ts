/** `codegen` as a command, in the house shape.
 *
 * Modelled on `flightdeck/scripts/scaffold-parity.ts` — the codebase's own
 * deterministic manifest-to-file generator — because that script already
 * encodes the doctrine: parse argv by hand, refuse with an exit code and a
 * named reason rather than a stack trace, print the plan under `--dry-run`,
 * and never overwrite an existing file without `--force`.
 *
 *   npx tsx packages/codegen/src/cli.ts --spec <spec.json> --out <host-repo> [--dry-run] [--force]
 *
 * `--out` is the ROOT of the Flightdeck host repository; every emitted path
 * is already repo-relative. `--dry-run` writes nothing and lists what would
 * land, including the registry patch. */
import fs from "node:fs";
import path from "node:path";
import { generateSubApp } from "./generate";
import { CodegenInvariantError } from "./invariants";
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

export function main(): void {
  const specPath = opt("--spec");
  const outRoot = opt("--out");
  if (specPath === undefined) fail("--spec <spec.json> is required");
  if (outRoot === undefined) fail("--out <host-repo-root> is required");
  const dryRun = has("--dry-run");
  const force = has("--force");

  if (!fs.existsSync(specPath)) fail(`no spec at ${specPath}`);
  let spec: unknown;
  try {
    spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  } catch (err) {
    fail(`${specPath} is not valid JSON — ${(err as Error).message}`);
  }

  // The registry is read, never written: the output is a patch a human
  // applies, because "adding a sub-app is exactly as heavy as adding a
  // route file" is a review step, not an automation target.
  const registryAbs = path.join(outRoot, REGISTRY_PATH);
  const registrySource = fs.existsSync(registryAbs) ? fs.readFileSync(registryAbs, "utf8") : undefined;

  let generated;
  try {
    generated = generateSubApp(spec, registrySource === undefined ? {} : { registrySource });
  } catch (err) {
    if (err instanceof SpecRejectedError || err instanceof CodegenInvariantError) fail(err.message);
    throw err;
  }

  for (const warning of generated.warnings) console.warn(`codegen: warning — ${warning}`);

  if (dryRun) {
    console.log(`codegen (dry-run) — ${generated.plan.id}: ${generated.files.length} files`);
    for (const file of generated.files) {
      const exists = fs.existsSync(path.join(outRoot, file.path));
      console.log(`  ${exists ? "overwrite" : "create   "} ${file.path} (${file.contents.split("\n").length} lines)`);
    }
    if (registrySource === undefined) {
      console.log(`  no ${REGISTRY_PATH} under --out, so no patch was generated; apply the edit by hand:`);
      console.log(`    ${generated.registryPatch.importLine}`);
      for (const line of generated.registryPatch.entryLines) console.log(`    ${line}`);
    }
    return;
  }

  const clashes = generated.files.filter((f) => fs.existsSync(path.join(outRoot, f.path)));
  if (clashes.length > 0 && !force) {
    fail(`${clashes.length} file(s) already exist — pass --force to overwrite:\n  ${clashes.map((f) => f.path).join("\n  ")}`, 1);
  }

  for (const file of generated.files) {
    const abs = path.join(outRoot, file.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.contents, "utf8");
    console.log(`codegen: wrote ${file.path}`);
  }
  console.log(`codegen: ${generated.plan.label} emitted. Apply ${REGISTRY_PATH}.patch to mount it — nothing runs until it is in SUBAPP_MANIFESTS.`);
}

// Run only when invoked directly, so importing this module in a test does
// not parse argv and exit the runner.
if (process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
