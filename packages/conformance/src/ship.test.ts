/** The write path, tested by looking at the disk afterwards.
 *
 * ⭐ THE POINT OF THESE TESTS is that the gate's blocking power is a fact
 * about the filesystem, not a claim in a comment. Every refusal below is
 * asserted by listing the target directory and finding it empty. */
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConformanceError } from "./gate";
import { ComplianceRequiredError, ShipRefused, shipSubApp } from "./ship";
import {
  MANIFEST_PATH,
  PATCH_PATH,
  ROUTES_PATH,
  WEB_PATH,
  conformingSubApp,
  editFile,
  withFile,
} from "./fixtures/subapp";

const REPO_ROOT = process.cwd();
const SLOW = 90_000;
const roots: string[] = [];

async function hostRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "flightdeck-host-"));
  roots.push(root);
  return root;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * ⭐ A PASSING COMPLIANCE RECORD, as `scripts/promote.sh` writes one.
 *
 * `shipSubApp` writes into the host repo, which IS production, so it now
 * requires the host's own compliance gate to have certified THIS spec. These
 * cases are about the write path, so they supply a valid record and the
 * compliance cases below supply broken ones.
 */
const SPEC_SHA = "46927a342179b43c2a00a53ea848068fc8d2c168ba2dc825649a661316fca2de";
const CERTIFIED = {
  specSha256: SPEC_SHA,
  now: Date.parse("2026-09-20T10:00:00Z"),
  record: {
    schema: "studio-compliance-record/1",
    at: "2026-09-20T09:00:00Z",
    specSha256: SPEC_SHA,
    passed: ["studio-suite", "conformance-redteam", "generate-and-mount", "build-web", "host-gate"],
    failed: [],
    skipped: [],
    readyForProduction: true,
    verdict: "ready",
  },
};

async function seed(root: string, path: string, contents: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), contents, "utf8");
}

afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop() ?? "", { recursive: true, force: true });
});

describe("shipping an app that verifies", () => {
  it("writes every file, byte for byte, and holds the host patch back", async () => {
    const root = await hostRepo();
    const candidate = conformingSubApp();

    const result = await shipSubApp(candidate, { root, repoRoot: REPO_ROOT, compliance: CERTIFIED });

    expect(result.committed).toBe(true);
    expect(result.report.verified).toBe(true);
    for (const file of candidate.files) {
      const outcome = result.writes.find((w) => w.path === file.path);
      if (file.path === PATCH_PATH) {
        expect(outcome?.status).toBe("held");
        expect(await exists(join(root, file.path))).toBe(false);
        continue;
      }
      expect(outcome?.status).toBe("written");
      expect(await readFile(join(root, file.path), "utf8")).toBe(file.contents);
    }
  }, SLOW);

  it("a dry run reports the same plan and touches nothing", async () => {
    const root = await hostRepo();
    const result = await shipSubApp(conformingSubApp(), { root, repoRoot: REPO_ROOT, dryRun: true });

    expect(result.committed).toBe(false);
    expect(result.writes.filter((w) => w.status === "written")).toHaveLength(6);
    expect(await readdir(root)).toEqual([]);
  }, SLOW);
});

describe("shipping an app that does not verify", () => {
  it("throws, and leaves the repo untouched", async () => {
    const root = await hostRepo();
    // Compiles-nowhere: the contract gate is happy, the compiler is not.
    const broken = editFile(conformingSubApp(), ROUTES_PATH, "return reply.code(201).send({ ok: true });", 'return reply.code("201").send({ ok: true });');

    await expect(shipSubApp(broken, { root, repoRoot: REPO_ROOT, compliance: CERTIFIED })).rejects.toBeInstanceOf(ConformanceError);
    expect(await readdir(root)).toEqual([]);
  }, SLOW);
});

describe("what the write path refuses even when the code is fine", () => {
  it("a path that climbs out of the sub-app's own directories", async () => {
    const root = await hostRepo();
    // A non-code file, so it reaches the write path: an escaping `.ts`
    // is refused earlier still, by the compiler stage. This is the LAST
    // line of defence, and it is the one that has to hold when the
    // earlier ones do not apply.
    const escaping = withFile(conformingSubApp(), "tests/subapps/wc-clock/../../../escaped.md", "# notes\n");

    const error = await shipSubApp(escaping, { root, repoRoot: REPO_ROOT, compliance: CERTIFIED }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShipRefused);
    expect((error as ShipRefused).message).toContain("escaped.md");
    // ⭐ All-or-nothing: the six perfectly good files did not land either.
    expect(await readdir(root)).toEqual([]);
    expect((error as ShipRefused).writes.filter((w) => w.status === "rolled-back").length).toBeGreaterThan(0);
  }, SLOW);

  it("replacing a file that is already there", async () => {
    const root = await hostRepo();
    await seed(root, MANIFEST_PATH, "// written by a human, months ago\n");

    const error = await shipSubApp(conformingSubApp(), { root, repoRoot: REPO_ROOT, compliance: CERTIFIED }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShipRefused);
    expect((error as ShipRefused).message).toContain("allowOverwrite");
    expect(await readFile(join(root, MANIFEST_PATH), "utf8")).toBe("// written by a human, months ago\n");
    expect(await exists(join(root, ROUTES_PATH))).toBe(false);
  }, SLOW);

  it("replacing it anyway, when the caller names that exact path", async () => {
    const root = await hostRepo();
    await seed(root, MANIFEST_PATH, "// written by a human, months ago\n");

    const result = await shipSubApp(conformingSubApp(), { root, repoRoot: REPO_ROOT, allowOverwrite: [MANIFEST_PATH], compliance: CERTIFIED });

    expect(result.committed).toBe(true);
    expect(result.writes.find((w) => w.path === MANIFEST_PATH)?.status).toBe("overwritten");
    expect(await readFile(join(root, MANIFEST_PATH), "utf8")).toContain("wcClockManifest");
  }, SLOW);

  it("writing through a symlink, which would land outside every check above", async () => {
    const root = await hostRepo();
    const elsewhere = await hostRepo();
    await mkdir(dirname(join(root, MANIFEST_PATH)), { recursive: true });
    await writeFile(join(elsewhere, "target.ts"), "// somewhere else entirely\n", "utf8");
    await symlink(join(elsewhere, "target.ts"), join(root, MANIFEST_PATH));

    const error = await shipSubApp(conformingSubApp(), { root, repoRoot: REPO_ROOT, allowOverwrite: [MANIFEST_PATH], compliance: CERTIFIED }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShipRefused);
    expect((error as ShipRefused).message).toContain("symlink");
    expect(await readFile(join(elsewhere, "target.ts"), "utf8")).toBe("// somewhere else entirely\n");
  }, SLOW);
});

describe("when the filesystem says no in the middle", () => {
  it("rolls the whole set back and reports the real error", async () => {
    const root = await hostRepo();
    // The web module's target is a DIRECTORY. Planning sees something
    // there and the caller allowed replacing it; the copy that backs it
    // up is the step that fails, after five files have already landed.
    await mkdir(join(root, WEB_PATH), { recursive: true });

    const error = await shipSubApp(conformingSubApp(), { root, repoRoot: REPO_ROOT, allowOverwrite: [WEB_PATH], compliance: CERTIFIED }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShipRefused);
    const refused = error as ShipRefused;
    expect(refused.message).toContain("rolled back");
    expect(refused.writes.find((w) => w.path === WEB_PATH)?.status).toBe("failed");
    // The real message from the filesystem, not a summary of it.
    expect(refused.writes.find((w) => w.path === WEB_PATH)?.error).toMatch(/EISDIR|EPERM|ENOTSUP|illegal operation/i);
    // And nothing that landed before the failure is still there.
    expect(await exists(join(root, MANIFEST_PATH))).toBe(false);
    expect(await exists(join(root, ROUTES_PATH))).toBe(false);
    for (const write of refused.writes.filter((w) => w.path.startsWith("server/") && w.path.endsWith(".ts"))) {
      expect(write.status).toBe("rolled-back");
    }
  }, SLOW);
});


/**
 * ⭐ THE HOST'S COMPLIANCE GATE, AT THE WRITE BOUNDARY.
 *
 * Studio's own conformance says the code is shaped correctly. It says
 * nothing about whether the HOST's gate — five stacks, including the PII
 * boundary check and the Python engine eval — passed with this candidate
 * mounted. Only `scripts/promote.sh` can answer that, and its answer was
 * written to a file nobody opened.
 */
describe("nothing reaches the host repo without the host's own verdict", () => {
  it("⭐ no record at all — refused, and NOT ONE FILE is written", async () => {
    const root = await hostRepo();
    const error = await shipSubApp(conformingSubApp(), { root, repoRoot: REPO_ROOT }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ComplianceRequiredError);
    // The refusal happens before anything is opened. A gate that refuses
    // after a partial write is a gate that corrupted the host repo.
    expect(await readdir(root).catch(() => [])).toEqual([]);
  });

  it("⭐ a record whose verdict contradicts its own evidence", async () => {
    const root = await hostRepo();
    const lying = {
      ...CERTIFIED,
      record: { ...CERTIFIED.record, failed: ["host-gate"], readyForProduction: true },
    };
    const error = await shipSubApp(conformingSubApp(), { root, repoRoot: REPO_ROOT, compliance: lying }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ComplianceRequiredError);
    expect((error as ComplianceRequiredError).code).toBe("verdict-contradicts-its-own-evidence");
    expect(await readdir(root).catch(() => [])).toEqual([]);
  });

  it("⭐ a record for a different spec is not a licence to ship this one", async () => {
    const root = await hostRepo();
    const other = { ...CERTIFIED, specSha256: `${"0".repeat(63)}1` };
    const error = await shipSubApp(conformingSubApp(), { root, repoRoot: REPO_ROOT, compliance: other }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ComplianceRequiredError);
    expect((error as ComplianceRequiredError).code).toBe("spec-hash-mismatch");
  });

  it("⛔ but a DRY RUN needs no record — planning is not shipping", async () => {
    // A gate that stopped people LOOKING at what would happen would be
    // routed around within a week.
    const root = await hostRepo();
    const result = await shipSubApp(conformingSubApp(), { root, repoRoot: REPO_ROOT, dryRun: true });
    expect(result.writes.length).toBeGreaterThan(0);
    expect(await readdir(root).catch(() => [])).toEqual([]);
  });
});
