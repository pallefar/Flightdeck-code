/** Spec in, sub-app out. The whole public act of this package.
 *
 * Order matters and is the point:
 *   1. `planSubApp` parses, resolves and cross-checks — and, before
 *      anything is emitted, runs the DERIVED MANIFEST past a local copy of
 *      the host's `subAppManifestSchema`. A manifest that would not boot
 *      never becomes a file.
 *   2. The emitters write text from the plan.
 *   3. `checkEmittedInvariants` reads that text back and refuses it if it
 *      breaks a contract rule.
 *
 * Step 3 is not belt-and-braces. Steps 1 and 2 trust the plan; step 3
 * trusts nothing and reads the output the way a reviewer would. If an
 * emitter is ever changed in a way that drops the guard call or reaches a
 * module it should not, the generator fails loudly here rather than
 * shipping source into somebody's Fastify host. */
import { emitGuard } from "./emitters/guard";
import { emitHostTest } from "./emitters/hostTest";
import { emitManifest } from "./emitters/manifest";
import { emitDomainRoutes, emitRoutesIndex } from "./emitters/routes";
import { emitSchema } from "./emitters/schema";
import { emitWebModule } from "./emitters/web";
import { CodegenInvariantError, checkEmittedInvariants, type GeneratedFile } from "./invariants";
import { serverDir, webDir } from "./naming";
import { planSubApp, type SubAppPlan } from "./plan";
import { REGISTRY_PATH, buildRegistryPatch, type RegistryPatch } from "./registry-patch";

export interface GenerateOptions {
  /** The current text of `server/subapps/registry.ts`. Supplying it adds a
   * ready-to-apply `registry.ts.patch` to `files`; without it the patch is
   * still returned as an object the caller can apply to whatever source it
   * has. A diff cannot be invented without the file it applies to, and
   * inventing one is how a patch stops applying. */
  registrySource?: string;
}

export interface GeneratedSubApp {
  plan: SubAppPlan;
  /** Every emitted file, sorted by path — byte-deterministic for one spec. */
  files: GeneratedFile[];
  registryPatch: RegistryPatch;
  /** Things worth a human's attention that are not refusals. */
  warnings: string[];
}

/** `wc-clock` -> `wcClock`, the host's test-file naming (`advantageBoard`,
 * `docusignFields`). */
function camelFile(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function generateSubApp(input: unknown, options: GenerateOptions = {}): GeneratedSubApp {
  const plan = planSubApp(input);
  const server = serverDir(plan.id);

  const files: GeneratedFile[] = [
    { path: `${server}/manifest.ts`, contents: emitManifest(plan), kind: "manifest" },
    { path: `${server}/guard.ts`, contents: emitGuard(plan), kind: "guard" },
    { path: `${server}/routes/index.ts`, contents: emitRoutesIndex(plan), kind: "routes-index" },
    ...plan.domains.map((domain) => ({
      path: `${server}/routes/${domain.fileName}`,
      contents: emitDomainRoutes(plan, domain),
      kind: "routes-domain" as const,
    })),
    { path: `${webDir(plan.webModuleId)}/index.tsx`, contents: emitWebModule(plan), kind: "web-module" },
    // Contract §10: a sub-app's tests live in `tests/subapps/<id>/`, never
    // the flat `tests/` root. The vitest glob is already recursive.
    { path: `tests/subapps/${plan.id}/${camelFile(plan.id)}Conformance.test.ts`, contents: emitHostTest(plan), kind: "host-test" },
  ];
  if (plan.tables.length > 0) {
    files.push({ path: `${server}/schema.ts`, contents: emitSchema(plan), kind: "schema" });
  }

  const registryPatch = buildRegistryPatch(plan);
  const warnings = [...plan.warnings];
  if (options.registrySource !== undefined) {
    const diff = registryPatch.toUnifiedDiff(options.registrySource);
    if (diff.length === 0) {
      warnings.push(`${REGISTRY_PATH} already imports "${plan.id}" — no registry edit emitted`);
    } else {
      files.push({ path: `${REGISTRY_PATH}.patch`, contents: diff, kind: "patch" });
    }
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const violations = checkEmittedInvariants(files, plan);
  if (violations.length > 0) throw new CodegenInvariantError(violations);

  return { plan, files, registryPatch, warnings };
}
