/** The registry edit. Adding a sub-app is "import + push", which sounds
 * small until it is done by a program against a file that has moved on
 * since the spec was written. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { RegistryPatchError, buildRegistryPatch } from "../registry-patch";
import { planSubApp } from "../plan";
import { registryFixture, wcClockSpec } from "../fixtures/specs";

const patch = buildRegistryPatch(planSubApp(wcClockSpec));

/** An INDEPENDENT unified-diff applier, written here on purpose: checking
 * the emitted diff with the same insertion plan that produced it would only
 * prove the formatter agrees with itself. This one reads the `@@` headers
 * and the `+`/` ` lines the way a patch tool does. */
function applyUnifiedDiff(source: string, diff: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  let cursor = 0;
  const diffLines = diff.split("\n").filter((l) => l.length > 0 || false);
  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i] as string;
    if (line.startsWith("--- ") || line.startsWith("+++ ")) continue;
    const header = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(line);
    if (header === null) continue;
    const oldStart = Number(header[1]) - 1;
    const oldCount = Number(header[2]);
    while (cursor < oldStart) out.push(lines[cursor++] as string);
    let consumed = 0;
    for (let j = i + 1; j < diffLines.length; j++) {
      const body = diffLines[j] as string;
      if (body.startsWith("@@")) break;
      if (body.startsWith("+")) {
        out.push(body.slice(1));
        continue;
      }
      if (body.startsWith(" ")) {
        expect(body.slice(1)).toBe(lines[cursor]);
        out.push(lines[cursor++] as string);
        consumed++;
        if (consumed === oldCount) {
          i = j;
          break;
        }
      }
    }
  }
  while (cursor < lines.length) out.push(lines[cursor++] as string);
  return out.join("\n");
}

describe("what the patch does", () => {
  it("adds exactly one import and one array entry", () => {
    const applied = patch.apply(registryFixture);
    expect(applied.status).toBe("applied");
    expect(applied.source).toContain('import { wcClockManifest } from "./wc-clock/manifest.js";');
    expect(applied.source).toContain("  wcClockManifest,");
    expect((applied.source.match(/wcClockManifest/g) ?? []).length).toBe(2);
  });

  it("puts the entry inside SUBAPP_MANIFESTS, after the existing ones", () => {
    const applied = patch.apply(registryFixture).source;
    const arrayBody = applied.slice(applied.indexOf("SUBAPP_MANIFESTS: SubAppManifest[] = ["), applied.indexOf("\n];"));
    expect(arrayBody).toContain("wcClockManifest");
    expect(arrayBody.indexOf("docusignManifest")).toBeLessThan(arrayBody.indexOf("wcClockManifest"));
  });

  it("names the kill switch beside the entry, where a reviewer will read it", () => {
    expect(patch.entryLines.join("\n")).toContain("SUBAPP_WC_CLOCK_ENABLED");
  });

  it("is idempotent — regenerating does not add a second import", () => {
    const once = patch.apply(registryFixture);
    const twice = patch.apply(once.source);
    expect(twice.status).toBe("already-applied");
    expect(twice.source).toBe(once.source);
    expect(patch.toUnifiedDiff(once.source)).toBe("");
  });

  it("anchors on the last manifest import, not on a line number", () => {
    // A registry that has grown two more sub-apps since the spec was
    // written still patches, and the import lands after the newest one.
    const grown = registryFixture.replace(
      'import { docusignManifest } from "./docusign/manifest.js";',
      'import { docusignManifest } from "./docusign/manifest.js";\nimport { mapsManifest } from "./maps/manifest.js";\nimport { advantageManifest } from "./advantage/manifest.js";',
    );
    const applied = patch.apply(grown).source.split("\n");
    const advantageAt = applied.findIndex((l) => l.includes("advantage/manifest.js"));
    const wcClockAt = applied.findIndex((l) => l.includes("wc-clock/manifest.js"));
    expect(wcClockAt).toBe(advantageAt + 1);
  });

  it("refuses rather than guesses when the array is not there", () => {
    const broken = registryFixture.replace("export const SUBAPP_MANIFESTS: SubAppManifest[] = [", "const catalog = [");
    expect(() => patch.apply(broken)).toThrow(RegistryPatchError);
    expect(() => patch.apply(broken)).toThrow(/no "export const SUBAPP_MANIFESTS/);
  });

  it("refuses rather than guesses when there is no import to anchor to", () => {
    const broken = registryFixture
      .split("\n")
      .filter((l) => !l.startsWith("import "))
      .join("\n");
    expect(() => patch.apply(broken)).toThrow(/no manifest import and no "\.\/types\.js" import/);
  });
});

describe("the diff a human reads is the edit the tool makes", () => {
  const diff = patch.toUnifiedDiff(registryFixture);

  it("is a well-formed unified diff naming the registry", () => {
    expect(diff.startsWith("--- a/server/subapps/registry.ts\n+++ b/server/subapps/registry.ts\n")).toBe(true);
    expect(diff).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@$/m);
    expect(diff.endsWith("\n")).toBe(true);
  });

  it("applies, via an independent applier, to exactly what apply() produces", () => {
    expect(applyUnifiedDiff(registryFixture, diff)).toBe(patch.apply(registryFixture).source);
  });

  it("changes nothing but the two inserted lines", () => {
    const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    const removed = diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
    expect(removed).toEqual([]);
    expect(added).toEqual([
      '+import { wcClockManifest } from "./wc-clock/manifest.js";',
      "+  // Generated by Flightdeck Studio. Kill switch: SUBAPP_WC_CLOCK_ENABLED",
      "+  wcClockManifest,",
    ]);
  });

  it("merges into one hunk when the two edits are close, and splits when they are not", () => {
    const spread = registryFixture.replace(
      "export const HOST_VERSION",
      `${Array.from({ length: 20 }, (_, i) => `// filler ${i}`).join("\n")}\nexport const HOST_VERSION`,
    );
    expect((patch.toUnifiedDiff(spread).match(/^@@/gm) ?? []).length).toBe(2);
    expect((patch.toUnifiedDiff(registryFixture).match(/^@@/gm) ?? []).length).toBe(1);
    expect(applyUnifiedDiff(spread, patch.toUnifiedDiff(spread))).toBe(patch.apply(spread).source);
  });
});

/** The end of the argument: `git apply` — the tool a human will actually
 * use — applied to the REAL `server/subapps/registry.ts` from the contract
 * checkout, not to a fixture shaped to suit the patcher. A diff that only
 * ever applies to its own fixture is a diff nobody can use. */
const REAL_REGISTRY = "/home/user/project-contract/flightdeck/server/subapps/registry.ts";
const canRunGitApply = (() => {
  if (!fs.existsSync(REAL_REGISTRY)) return false;
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!canRunGitApply)("against the real registry, with git apply", () => {
  it("applies cleanly and mounts the sub-app", () => {
    const source = fs.readFileSync(REAL_REGISTRY, "utf8");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-registry-"));
    try {
      const target = path.join(dir, "server", "subapps", "registry.ts");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, source);
      const diffPath = path.join(dir, "registry.patch");
      fs.writeFileSync(diffPath, patch.toUnifiedDiff(source));
      execFileSync("git", ["init", "-q", "."], { cwd: dir, stdio: "ignore" });
      // --check first: git tells us the patch does not apply before it has
      // half-applied it.
      execFileSync("git", ["apply", "--check", diffPath], { cwd: dir, stdio: "pipe" });
      execFileSync("git", ["apply", diffPath], { cwd: dir, stdio: "pipe" });
      const patched = fs.readFileSync(target, "utf8");
      expect(patched).toContain('import { wcClockManifest } from "./wc-clock/manifest.js";');
      expect(patched.slice(patched.indexOf("SUBAPP_MANIFESTS"), patched.indexOf("\n];"))).toContain("wcClockManifest,");
      // And what apply() would have produced is the same file.
      expect(patched).toBe(patch.apply(source).source);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
