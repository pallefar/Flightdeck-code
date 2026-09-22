/** FD-M008 — a generated mini-app declares no OS-04 host-surface contributions.
 *
 * ⭐ THE DEFECT THIS FILE PINS. Host 42b0f308 (OS-04) added `contributions`
 * to `SubAppManifest`: a bundle through which a sub-app feeds `/api/state`
 * flags, arms background work with the raw `db` and workspace `root`, adds
 * fixed connector rows, and supplies the signing state of a contract. The
 * host acts on it at boot — `app.ts` calls `assertContributionsUnambiguous`,
 * which throws when a second sub-app claims the single-valued
 * `ticketSigning` (docusign already does) — and at runtime. This gate went on
 * calling every unknown member "additive and ignored", so a generated
 * manifest carrying `contributions: { ticketSigning: … "signed" … }` passed
 * with zero findings, the workbench's "Download candidate" enabled, and the
 * downloaded file said `gate.ok: true` over a manifest that stops the host
 * booting and reports a contract as signed.
 *
 * Each case below is one way of writing that member; each must be refused.
 * The last block is the other direction: the word itself, in a label or a
 * comment, is not a finding — a gate that cries wolf gets switched off. */
import { describe, expect, it } from "vitest";
import { generateSubApp } from "../../codegen/src/generate";
import { contractRunSpec, registryFixture } from "../../codegen/src/fixtures/specs";
import { runConformanceGate } from "./gate";
import { MANIFEST_PATH, conformingSubApp, editFile } from "./fixtures/subapp";

const REGISTER = `  registerRoutes: (app, ctx) => registerWcClockRoutes(app, ctx),\n`;
const CLOSE = `  registerRoutes: (app, ctx) => registerWcClockRoutes(app, ctx),\n};\n`;

/** The conforming fixture with `extra` written into the manifest object. */
const withMember = (extra: string) => editFile(conformingSubApp(), MANIFEST_PATH, REGISTER, `${REGISTER}${extra}`);
/** The conforming fixture with `after` written below the manifest object. */
const afterManifest = (after: string) => editFile(conformingSubApp(), MANIFEST_PATH, CLOSE, `${CLOSE}${after}`);

const m008 = (app: ReturnType<typeof conformingSubApp>) =>
  runConformanceGate(app).findings.filter((f) => f.rule === "FD-M008");

describe("⭐ the reproduction: real generated output plus a contributions member", () => {
  it("contract-run passes clean, and fails the moment it contributes signing state", () => {
    const generated = generateSubApp(contractRunSpec, { registrySource: registryFixture });
    const files = generated.files
      .filter((f) => f.kind !== "standalone")
      .map((f) => ({ path: f.path, contents: f.contents }));
    const manifest = files.find((f) => f.path.endsWith("/manifest.ts"));
    if (manifest === undefined) throw new Error("codegen emitted no manifest.ts");
    expect(runConformanceGate({ files }).ok).toBe(true);

    const contributions =
      `  contributions: {\n` +
      `    stateFlags: () => ({ esign: { enabled: true } }),\n` +
      `    ticketSigning: async (db, root, ticket) => ({ status: "signed", signedCount: 1, totalCount: 1 }),\n` +
      `  },\n`;
    const edited = manifest.contents.replace(/\n};\s*$/, `\n${contributions}};\n`);
    expect(edited).not.toBe(manifest.contents);
    const report = runConformanceGate({
      files: files.map((f) => (f === manifest ? { path: f.path, contents: edited } : f)),
    });

    expect(report.ok).toBe(false);
    const hit = report.errors.find((f) => f.rule === "FD-M008");
    expect(hit?.file).toBe(manifest.path);
    expect(hit?.evidence).toContain("contributions");
    // It names why, in the host's own terms.
    expect(hit?.message).toContain("assertContributionsUnambiguous");
    expect(hit?.message).toContain("ticketSigning");
  });
});

describe("⛔ every way of writing the member is refused", () => {
  const FORMS: ReadonlyArray<readonly [string, ReturnType<typeof conformingSubApp>]> = [
    ["a plain property", withMember(`  contributions: { stateFlags: () => ({}) },\n`)],
    ["a quoted key", withMember(`  "contributions": { stateFlags: () => ({}) },\n`)],
    ["a reference to a bundle declared elsewhere", withMember(`  contributions: extraContributions,\n`)],
    ["shorthand", withMember(`  contributions,\n`)],
    ["a method", withMember(`  contributions() { return {}; },\n`)],
    ["a getter", withMember(`  get contributions() { return {}; },\n`)],
    ["a computed key", withMember(`  ["contributions"]: {},\n`)],
    ["an assignment after the declaration", afterManifest(`wcClockManifest.contributions = {};\n`)],
    ["Object.assign after the declaration", afterManifest(`Object.assign(wcClockManifest, { contributions: {} });\n`)],
    ["a string-keyed write the skeleton cannot see", afterManifest(`Reflect.set(wcClockManifest, "contributions", {});\n`)],
  ];

  it.each(FORMS)("%s", (_name, app) => {
    const hits = m008(app);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((f) => f.severity === "error" && f.file === MANIFEST_PATH && f.line > 0)).toBe(true);
  });

  it("a spread, which could carry the member where no reader can see it", () => {
    const hits = m008(withMember(`  ...extraMembers,\n`));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.message).toMatch(/spread/);
    expect(hits[0]?.evidence).toContain("...extraMembers");
  });
});

describe("the word alone is not a finding", () => {
  it("in a label, a string elsewhere, or a comment", () => {
    const app = editFile(
      editFile(conformingSubApp(), MANIFEST_PATH, `label: "Works council clock",`, `label: "Pension contributions clock",`),
      MANIFEST_PATH,
      REGISTER,
      `${REGISTER}  // No contributions: a generated mini-app reaches no host surface.\n`,
    );
    const report = runConformanceGate(app);
    expect(report.findings.filter((f) => f.rule === "FD-M008")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("the conforming baseline is clean", () => {
    expect(m008(conformingSubApp())).toEqual([]);
  });
});
