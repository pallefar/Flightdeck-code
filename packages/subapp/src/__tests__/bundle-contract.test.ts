/** The one place both halves of Studio are importable at once.
 *
 * ⭐ WHY THIS FILE IS THE WHOLE SEAM. Generation lives in
 * `studio/conversion.ts` and runs in Studio. Filing lives in
 * `server/subapps/studio/**` and runs in a Flightdeck host. In production they
 * never share a process: what passes between them is JSON over HTTP, and the
 * host parses it with a schema that knows nothing about the generator.
 *
 * That is the right shape and it has one cost: nothing at runtime notices when
 * the two drift. Studio could start emitting a field the host's `.strict()`
 * schema rejects, and every Studio test would stay green while every real
 * install answered 400. So the seam is tested HERE, in the repository that
 * contains both sides, by running the real conversion and parsing its output
 * through the real host schema.
 *
 * ⛔ AND THE DIRECTION OF THE DEPENDENCY IS ASSERTED TOO. `conversion.ts`
 * imports the host's bundle schema; nothing in the emitted tree imports
 * `conversion.ts`. That is what makes the emitted tree installable at all, and
 * `self-contained.test.ts` walks the closure to prove it. */
import { describe, expect, it } from "vitest";
import {
  MAX_BUNDLE_FILES,
  STUDIO_BUNDLE_SCHEMA,
  bundleBytes,
  studioBundleSchema,
} from "../server/subapps/studio/service/bundle.js";
import { admitBundle } from "../server/subapps/studio/service/admit.js";
import { STUDIO_PRODUCER, bundleFrom } from "../studio/conversion.js";
import { BUNDLE_AT, readyConversion, studioBundle } from "./support.js";

const bundle = studioBundle({ source: "skills/works-council-clock/SKILL.md" });

describe("what Studio emits is what the host accepts", () => {
  it("parses through the host's own strict schema, unmodified", () => {
    const parsed = studioBundleSchema.safeParse(bundle);
    expect(parsed.success, JSON.stringify(parsed.success ? [] : parsed.error.issues, null, 2)).toBe(true);
  });

  it("survives a JSON round trip — which is how it actually travels", () => {
    const parsed = studioBundleSchema.safeParse(JSON.parse(JSON.stringify(bundle)) as unknown);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toEqual(bundle);
  });

  it("is ADMITTED by the host, not merely well-formed", () => {
    // The stronger claim. A bundle can parse and still be refused — that is
    // the point of the admission layer — so the generator is held to the
    // rules the host actually applies, not just to the wire shape.
    const report = admitBundle(bundle);
    expect(report.errors, JSON.stringify(report.errors, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("says what wire format it is, and who produced it", () => {
    expect(bundle.bundle).toBe(STUDIO_BUNDLE_SCHEMA);
    expect(bundle.producedBy).toBe(STUDIO_PRODUCER);
    expect(bundle.producedAt).toBe(BUNDLE_AT);
  });

  it("carries the paths a human will `cd` to, not some outer checkout's", () => {
    for (const file of bundle.files) {
      expect(file.path.startsWith("server/") || file.path.startsWith("web/") || file.path.startsWith("tests/")).toBe(true);
    }
    expect(bundle.registry.file).toBe("server/subapps/registry.ts");
  });

  it("fits inside every ceiling the host enforces, with room to spare", () => {
    expect(bundle.files.length).toBeLessThan(MAX_BUNDLE_FILES);
    // A mini-app is small. If this ever approaches the ceiling, the ceiling is
    // not the thing that changed.
    expect(bundleBytes(bundle)).toBeLessThan(200_000);
  });

  it("is byte-deterministic: the same workflow twice is the same bundle", () => {
    const again = studioBundle({ source: "skills/works-council-clock/SKILL.md" });
    expect(JSON.stringify(again)).toBe(JSON.stringify(bundle));
  });

  it("reports the gate that judged it, with the checks named", () => {
    expect(bundle.gate.ok).toBe(true);
    expect(bundle.gate.checks.length).toBeGreaterThan(0);
    expect(bundle.gate.findings.every((finding) => finding.severity !== "error")).toBe(true);
    expect(bundle.gate.filesChecked).toBe(bundle.files.length);
  });

  it("carries provenance as a label, and null when there is none", () => {
    expect(bundle.workflowSource).toBe("skills/works-council-clock/SKILL.md");
    expect(bundleFrom(readyConversion(), { at: BUNDLE_AT }).workflowSource).toBeNull();
  });
});
