/**
 * What the promote workflow checks BEFORE it signs (upd-studio-attestation).
 *
 * The cosign attestation says "this workflow ran the checks and they passed".
 * So the workflow must never sign a record that says otherwise, a sidecar that
 * names a different record, or a sidecar whose Studio commit is not the commit
 * the workflow checked out: the certificate records the workflow's commit, the
 * sidecar records the Studio commit, and the two must be one. promote.sh exit 0
 * already implies most of this; the check is the signer's own, fail-closed, so
 * an edit to promote.sh cannot make the workflow sign a blocked run.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { ATTESTATION_PREDICATE_TYPE, checkAttestable } from "../attestation";
import { PROVENANCE_SCHEMA } from "../provenance";
import { recordDigest } from "../record";

const STUDIO = path.resolve(__dirname, "..", "..", "..", "..");
const CLI = path.join(STUDIO, "packages", "compliance", "src", "provenance-cli.ts");
const NOW = Date.parse("2026-09-25T12:00:00Z");
const SPEC_SHA = "a".repeat(64);
const COMMIT = "b".repeat(40);

function record(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "studio-compliance-record/1",
    at: "2026-09-25T11:00:00Z",
    specSha256: SPEC_SHA,
    passed: ["studio-suite", "host-gate"],
    failed: [],
    skipped: [],
    readyForProduction: true,
    verdict: "ready",
    note: "n",
    ...over,
  };
}

function provenance(rec: unknown, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: PROVENANCE_SCHEMA,
    recordSha256: recordDigest(rec),
    studioCommit: COMMIT,
    hostHead: "c".repeat(40),
    catalogueEntryId: null,
    subject: { subappId: "wc-clock", version: "0.1.0", treeSha256: "d".repeat(64), hostFiles: [] },
    ...over,
  };
}

const check = (rec: unknown, prov: unknown, studioCommit = COMMIT) =>
  checkAttestable({ record: rec, provenance: prov, specSha256: SPEC_SHA, studioCommit, now: NOW });

describe("checkAttestable — what the promote workflow signs", () => {
  it("names the predicate type the OS admission pins", () => {
    expect(ATTESTATION_PREDICATE_TYPE).toBe("https://flightdeck/studio-compliance/v1");
  });

  it("admits a ready record and the sidecar that digests it, and returns the app id", () => {
    const rec = record();
    expect(check(rec, provenance(rec))).toEqual({ ok: true, subappId: "wc-clock" });
  });

  it("refuses a record that is not ready: failed, skipped, lying, or empty", () => {
    for (const rec of [
      record({ failed: ["host-gate"], readyForProduction: false }),
      record({ skipped: ["host-gate-partial"], readyForProduction: false }),
      record({ failed: ["host-gate"] }),
      record({ passed: [] }),
    ]) {
      const r = check(rec, provenance(rec));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.refusals.join(" ")).toMatch(/^record-/);
    }
  });

  it("refuses a record made for another spec", () => {
    const rec = record({ specSha256: "e".repeat(64) });
    const r = check(rec, provenance(rec));
    expect(r).toEqual({ ok: false, refusals: ["record-spec-hash-mismatch"] });
  });

  it("refuses a sidecar that names another record", () => {
    const rec = record();
    const r = check(rec, provenance(record({ at: "2026-09-25T11:30:00Z" })));
    expect(r).toEqual({ ok: false, refusals: ["provenance-names-another-record"] });
  });

  it("refuses a Studio commit that is not the one the workflow checked out, or is dirty", () => {
    const rec = record();
    expect(check(rec, provenance(rec, { studioCommit: "f".repeat(40) }))).toEqual({ ok: false, refusals: ["studio-commit-not-the-workflow-commit"] });
    expect(check(rec, provenance(rec, { studioCommit: `${COMMIT}-dirty` }))).toEqual({ ok: false, refusals: ["studio-commit-not-the-workflow-commit"] });
    expect(check(rec, provenance(rec), "not-a-sha").ok).toBe(false);
  });

  it("refuses a sidecar of another schema, with no subject, or a subject that is not a sub-app", () => {
    const rec = record();
    expect(check(rec, provenance(rec, { schema: "studio-provenance/0" })).ok).toBe(false);
    expect(check(rec, provenance(rec, { subject: undefined })).ok).toBe(false);
    expect(check(rec, provenance(rec, { subject: { subappId: "../x", version: "0.1.0", treeSha256: "d".repeat(64), hostFiles: [] } })).ok).toBe(false);
    expect(check(rec, provenance(rec, { hostHead: "HEAD" })).ok).toBe(false);
    expect(check(rec, "nope").ok).toBe(false);
    expect(check("nope", provenance(rec)).ok).toBe(false);
  });
});

describe("provenance-cli attest-check", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-attest-check-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const specText = '{"id":"wc-clock"}\n';
  const specSha = createHash("sha256").update(specText, "utf8").digest("hex");
  const spec = path.join(tmp, "spec.json");
  fs.writeFileSync(spec, specText);

  const run = (rec: unknown, prov: unknown, commit = COMMIT) => {
    fs.writeFileSync(path.join(tmp, "record.json"), JSON.stringify(rec));
    fs.writeFileSync(path.join(tmp, "PROVENANCE.json"), JSON.stringify(prov));
    return spawnSync(
      "npx",
      ["tsx", CLI, "attest-check", "--record", path.join(tmp, "record.json"), "--provenance", path.join(tmp, "PROVENANCE.json"), "--spec", spec, "--studio-commit", commit],
      { cwd: STUDIO, encoding: "utf8" },
    );
  };

  it("prints only the app id and exits 0 when the run may be signed", () => {
    const rec = record({ specSha256: specSha, at: new Date().toISOString() });
    const r = run(rec, provenance(rec));
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("wc-clock\n");
  });

  it("exits 1 and prints nothing on stdout when it may not", () => {
    const rec = record({ specSha256: specSha, at: new Date().toISOString(), failed: ["host-gate"], readyForProduction: false });
    const r = run(rec, provenance(rec));
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/record-stacks-failed/);
  });
});
