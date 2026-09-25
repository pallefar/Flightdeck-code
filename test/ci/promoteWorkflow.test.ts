/** The Studio promote workflow and its cosign keyless attestation (upd-studio-attestation).
 *
 * WHAT THIS PINS. `scripts/promote.sh` writes a compliance record and seals a
 * `studio-provenance/1` sidecar over the candidate, and anyone can recompute
 * that verdict. Recomputing it does not say WHO ran the checks. The OS admits a
 * Studio sub-app (upd-studio-admission) only against an attestation made by
 * THIS workflow's identity, so the workflow is the trust anchor and its shape
 * is what this file holds still:
 *
 * - it runs promote.sh and attests only when promote PASSED — never after a
 *   failed, cancelled or skipped promote (a skipped promote FAILS the job, it
 *   is never a quiet green, the same doctrine as promote.sh's skipped stacks);
 * - the attestation is `cosign attest-blob` KEYLESS (workflow OIDC identity, no
 *   `--key`), with predicate type https://flightdeck/studio-compliance/v1,
 *   the compliance record as the predicate and PROVENANCE.json as the subject;
 * - cosign is pinned to one version and a sha256 per platform, checked before
 *   it runs; every action is pinned by commit sha;
 * - the bundle is verified against this workflow's own identity before it is
 *   uploaded as `<app>/PROVENANCE.sigstore.json`;
 * - only a human dispatch starts it (no pull_request trigger), and the token
 *   can read the repo and mint an OIDC token, nothing else.
 *
 * There is no YAML parser in this repo and none is added for one file: the
 * workflow is read as text, split into its steps at their fixed indent. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const STUDIO = path.resolve(__dirname, "..", "..");
const WORKFLOW = path.join(STUDIO, ".github", "workflows", "promote.yml");
const PREDICATE_TYPE = "https://flightdeck/studio-compliance/v1";

function source(): string {
  if (!fs.existsSync(WORKFLOW)) throw new Error(`no promote workflow at ${WORKFLOW}`);
  return fs.readFileSync(WORKFLOW, "utf8");
}

/** Code lines only: full-line comments dropped, so prose cannot satisfy a pin. */
function code(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

interface Step {
  readonly index: number;
  readonly text: string;
  readonly id: string | undefined;
  readonly name: string | undefined;
  readonly cond: string | undefined;
  readonly uses: string | undefined;
}

/** The steps of the `promote` job: every `      - ` block under its `steps:`. */
function steps(): Step[] {
  const lines = code(source()).split("\n");
  const jobAt = lines.findIndex((l) => /^ {2}promote:\s*$/.test(l));
  if (jobAt < 0) throw new Error("no `promote` job");
  const stepsAt = lines.findIndex((l, i) => i > jobAt && /^ {4}steps:\s*$/.test(l));
  if (stepsAt < 0) throw new Error("the promote job has no steps");
  const blocks: string[][] = [];
  for (let i = stepsAt + 1; i < lines.length; i++) {
    const l = lines[i] ?? "";
    if (/^ {0,4}\S/.test(l)) break; // the next job or top-level key
    if (/^ {6}- /.test(l)) blocks.push([l.replace(/^ {6}- /, "        ")]);
    else blocks[blocks.length - 1]?.push(l);
  }
  const field = (b: string, k: string): string | undefined => {
    const m = new RegExp(`^ {8}${k}:\\s*(.+?)\\s*$`, "m").exec(b);
    return m?.[1];
  };
  return blocks.map((b, index) => {
    const text = b.join("\n");
    return { index, text, id: field(text, "id"), name: field(text, "name"), cond: field(text, "if"), uses: field(text, "uses") };
  });
}

function stepWith(re: RegExp): Step {
  const s = steps().find((st) => re.test(st.text));
  if (!s) throw new Error(`no step matches ${re}`);
  return s;
}

describe("Studio promote workflow — cosign keyless attestation (upd-studio-attestation)", () => {
  it("exists, is started only by a human dispatch, and grants only read + OIDC", () => {
    const text = code(source());
    const on = /^on:\s*\n((?: {2}.*\n?)+)/m.exec(text)?.[1] ?? "";
    expect(on).toMatch(/^ {2}workflow_dispatch:/m);
    expect(on).not.toMatch(/pull_request|push:|schedule:|workflow_run:/);
    const perms = /^permissions:\s*\n((?: {2}.*\n?)+)/m.exec(text)?.[1] ?? "";
    expect(perms).toMatch(/^ {2}id-token:\s*write\s*$/m);
    expect(perms).toMatch(/^ {2}contents:\s*read\s*$/m);
    expect(perms.split("\n").filter((l) => /:\s*write\s*$/.test(l))).toEqual(["  id-token: write"]);
    // A job-level permissions block would override the top-level one.
    expect(text).not.toMatch(/^ {4}permissions:/m);
  });

  it("pins cosign to one exact version and a sha256 per platform, and checks it before use", () => {
    const text = code(source());
    const version = /COSIGN_VERSION:\s*"?(v\d+\.\d+\.\d+)"?\s*$/m.exec(text)?.[1];
    expect(version, "COSIGN_VERSION must be an exact vX.Y.Z").toBeDefined();
    for (const platform of ["linux-amd64", "linux-arm64", "darwin-amd64", "darwin-arm64"]) {
      expect(text, `no pinned sha256 for cosign-${platform}`).toMatch(
        new RegExp(`cosign-${platform}\\)?[^\\n]*\\b[0-9a-f]{64}\\b`),
      );
    }
    const install = stepWith(/releases\/download\/\$\{?COSIGN_VERSION/);
    expect(install.text).toMatch(/shasum -a 256 -c|sha256sum -c/);
    // The download is checked BEFORE it is made executable or run.
    const checkedAt = install.text.search(/shasum -a 256 -c|sha256sum -c/);
    expect(checkedAt).toBeGreaterThan(0);
    expect(checkedAt).toBeLessThan(install.text.indexOf("chmod"));
    expect(install.text).not.toMatch(/continue-on-error/);
    // No floating installer that ignores the pin.
    expect(text).not.toMatch(/sigstore\/cosign-installer/);
  });

  it("pins every action by commit sha", () => {
    const uses = steps().map((s) => s.uses).filter((u): u is string => u !== undefined);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}(\s+#.*)?$/);
  });

  it("never splices an expression into a run script", () => {
    for (const s of steps()) {
      const run = /^ {8}run: \|\n([\s\S]*)$/m.exec(s.text)?.[1] ?? "";
      expect(run, s.name).not.toMatch(/\$\{\{/);
    }
  });

  it("runs promote.sh as its own step, which cannot be skipped or soften a failure", () => {
    const promote = stepWith(/scripts\/promote\.sh/);
    expect(promote.id).toBe("promote");
    expect(promote.cond, "an `if:` could skip the promote step").toBeUndefined();
    expect(promote.text).not.toMatch(/continue-on-error|\|\|\s*true|set \+e/);
  });

  it("attests keylessly, only after promote passed, over PROVENANCE.json with the record as predicate", () => {
    const all = steps();
    const promote = stepWith(/scripts\/promote\.sh/);
    const attest = stepWith(/cosign attest-blob/);
    expect(attest.index).toBeGreaterThan(promote.index);
    expect(attest.cond).toBe("steps.promote.outcome == 'success'");
    expect(attest.text).not.toMatch(/continue-on-error|always\(\)/);
    const cmd = attest.text.slice(attest.text.indexOf("cosign attest-blob"));
    expect(cmd).toContain(`--type ${PREDICATE_TYPE}`);
    expect(cmd).toMatch(/--predicate "?\$\{?RECORD\}?"?/);
    expect(cmd).toMatch(/--bundle "?\$\{?BUNDLE\}?"?/);
    expect(cmd).toMatch(/--yes/);
    expect(cmd).toMatch(/"?\$\{?PROVENANCE\}?"?\s*$/m);
    expect(cmd, "keyless: no key material").not.toMatch(/--key\b|COSIGN_PRIVATE_KEY|COSIGN_PASSWORD/);
    // The files it attests are the ones promote.sh wrote, and the signer checks them
    // itself first (attestation.ts): the record admits for this spec, the sidecar
    // names it, and its Studio commit is the commit this workflow checked out.
    expect(attest.text).toMatch(/provenance-cli\.ts attest-check/);
    expect(attest.text).toMatch(/--studio-commit "\$GITHUB_SHA"/);
    expect(attest.text.search(/attest-check/)).toBeLessThan(attest.text.indexOf("cosign attest-blob"));
    expect(attest.text).toMatch(/PROVENANCE\.json/);
    expect(attest.text).toMatch(/compliance-record\.json/);
    // Everything after the attest step that ships the bundle also needs it to have succeeded.
    for (const s of all.filter((st) => st.index > attest.index && /upload-artifact|verify-blob-attestation/.test(st.text))) {
      expect(s.cond, s.name).toMatch(/steps\.attest\.outcome == 'success'/);
    }
    expect(attest.id).toBe("attest");
  });

  it("verifies the bundle against this workflow's own identity before uploading it", () => {
    const attest = stepWith(/cosign attest-blob/);
    const verify = stepWith(/cosign verify-blob-attestation/);
    const upload = stepWith(/upload-artifact@/);
    expect(verify.index).toBeGreaterThan(attest.index);
    expect(upload.index).toBeGreaterThan(verify.index);
    expect(verify.text).toContain(`--type ${PREDICATE_TYPE}`);
    expect(verify.text).toMatch(/--certificate-oidc-issuer https:\/\/token\.actions\.githubusercontent\.com/);
    // The identity reaches the shell through env, never spliced into the script.
    expect(verify.text).toMatch(/^ {10}WORKFLOW_IDENTITY: \$\{\{ github\.server_url \}\}\/\$\{\{ github\.workflow_ref \}\}\s*$/m);
    expect(verify.text).toMatch(/--certificate-identity "\$WORKFLOW_IDENTITY"/);
    expect(verify.text).not.toMatch(/--certificate-identity-regexp|--insecure/);
  });

  it("uploads the bundle as <app>/PROVENANCE.sigstore.json next to the sidecar and the record", () => {
    const attest = stepWith(/cosign attest-blob/);
    expect(attest.text).toMatch(/\/PROVENANCE\.sigstore\.json/);
    // The app dir name is what attest-check printed (the sidecar's subject), checked again before it is a path.
    expect(attest.text).toMatch(/APP="\$\(.*attest-check/s);
    expect(attest.text).toContain("[a-z][a-z0-9-]*");
    const upload = stepWith(/upload-artifact@/);
    expect(upload.text).toMatch(/if-no-files-found:\s*error/);
  });

  it("fails the job when promote did not pass — a skipped promote is never green", () => {
    const promote = stepWith(/scripts\/promote\.sh/);
    const guard = steps().find((s) => s.cond !== undefined && /always\(\)/.test(s.cond) && /steps\.promote\.outcome != 'success'/.test(s.cond));
    expect(guard, "no always() step that fails on a promote that did not succeed").toBeDefined();
    expect(guard!.index).toBeGreaterThan(promote.index);
    expect(guard!.text).toMatch(/exit 1/);
    expect(guard!.text).not.toMatch(/continue-on-error/);
  });
});
