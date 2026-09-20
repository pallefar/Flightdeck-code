/** Test fixtures — real generator output, frozen.
 *
 * ⭐ WHY THE FIXTURES ARE FILES AND NOT HAND-WRITTEN STRINGS. The preview
 * makes one large bet: that a generated page's variable part is a literal
 * it can parse and its fixed part is text it can fingerprint. A fixture
 * written by hand to match what `emitters/web.ts` is BELIEVED to emit
 * tests that belief, not the emitter. These files came out of
 * `generateSubApp(wcClockSpec)` and were copied verbatim, so
 * `preview.test.ts` is checking the reader against the real thing.
 *
 * They are frozen on purpose. Importing `@codegen` here would make these
 * tests pass or fail on a sibling package's working tree — and when the
 * emitter changes its runtime, the right outcome is that the drift check
 * FAILS loudly here, which is exactly what a frozen fixture gives and a
 * live import does not. Refresh them deliberately, by regenerating. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Candidate, CandidateManifest, Finding, GeneratedFile, Severity } from "../types";

const DIR = fileURLToPath(new URL("./fixtures/", import.meta.url));

export function fixture(name: string): string {
  return readFileSync(`${DIR}${name}`, "utf8");
}

export const WC_CLOCK_MANIFEST: CandidateManifest = {
  id: "wc-clock",
  label: "Works Council Clock",
  version: "0.1.0",
  summary: "Tracks works-council consultation clocks.",
  icon: "⏱️",
  navSection: "Contract pipeline",
  routePrefix: "/api/apps/wc-clock",
  webModuleId: "wc-clock",
  capabilities: ["read:contracts", "write:inbox-proposal"],
  visibleToRoles: ["hr_preparer", "legal"],
  envVar: "SUBAPP_WC_CLOCK_ENABLED",
  tablePrefix: "subapp_wc_clock_",
};

export function wcClockFiles(): GeneratedFile[] {
  return [
    { path: "server/subapps/wc-clock/manifest.ts", contents: fixture("wc-clock.manifest.txt"), kind: "manifest" },
    { path: "server/subapps/wc-clock/routes/index.ts", contents: fixture("wc-clock.routes-index.txt"), kind: "routes-index" },
    { path: "server/subapps/wc-clock/routes/clocks.ts", contents: fixture("wc-clock.routes-clocks.txt"), kind: "routes-domain" },
    { path: "server/subapps/wc-clock/routes/review.ts", contents: fixture("wc-clock.routes-review.txt"), kind: "routes-domain" },
    { path: "web/src/subapps/wc-clock/index.tsx", contents: fixture("wc-clock.web-module.txt"), kind: "web-module" },
  ];
}

export function finding(
  rule: string,
  file: string,
  line: number,
  message: string,
  severity: Severity = "error",
): Finding {
  return { rule, severity, file, line, column: 1, message, evidence: null };
}

export function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    manifest: WC_CLOCK_MANIFEST,
    files: wcClockFiles(),
    findings: [],
    rulesRun: ["FD-M001", "FD-G001", "FD-X002", "FD-X003"],
    notes: [],
    ...overrides,
  };
}

/** A candidate with an arbitrary file set, for the store and tree tests
 * that care about paths and not about contents. */
export function candidateOf(files: ReadonlyArray<Partial<GeneratedFile> & { path: string }>): Candidate {
  return candidate({
    files: files.map((file) => ({
      path: file.path,
      contents: file.contents ?? `// ${file.path}\n`,
      kind: file.kind ?? "unknown",
    })),
  });
}
