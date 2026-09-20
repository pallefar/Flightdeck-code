/** Which file goes where when Studio is installed into a Flightdeck host.
 *
 * ⭐ WHY THIS FILE EXISTS. Studio's sub-app source lives in this package, which
 * sits OUTSIDE the host checkout, so the tree under `src/server` and `src/web`
 * mirrors the host's layout without being it. This manifest is the mapping an
 * installer needs: source path here, target path there.
 *
 * ⛔ IT IS A MAPPING, NOT AN INSTALLER. Nothing in this package writes into a
 * host repo, and nothing here could: the whole point of Studio is that a
 * sub-app cannot mutate the thing it runs inside. The same rule applies to
 * Studio itself — these four files reach a host the way any other sub-app's do,
 * through a human with a checkout.
 *
 * ── THE STAND-INS ARE NOT EMITTED ───────────────────────────────────────
 * `src/server/subapps/types.ts`, `installRow.ts`, `killSwitch.ts`,
 * `capabilities.ts`, `src/server/lib/flightdeckAudit.ts`,
 * `src/server/{db,fastify}.ts`, `src/server/{project,workspace}/types.ts` and
 * `src/web/src/subapps/registry.ts` are MODELS of host modules that already
 * exist in the host. They are here so the emitted files typecheck and run in
 * tests outside a checkout. Emitting one would overwrite a real host module
 * with a narrower copy, which is the one genuinely destructive thing this
 * mapping could do, so they are listed separately and `__tests__/emit-manifest.test.ts`
 * asserts the two lists never overlap.
 *
 * ── THE ENGINE PACKAGES TRAVEL WITH IT ──────────────────────────────────
 * `service/pipeline.ts` imports `@spec`, `@codegen/pure` and
 * `@conformance/gate`. That is legal in a sub-app route for one reason and one
 * reason only: all three are free of `node:` specifiers, so none of them puts
 * the filesystem into the route's static import closure — the thing the host's
 * `tests/subapps/subappImportClosure.test.ts` fails on, whether or not the
 * import is ever called. Installing Studio therefore means vendoring those
 * three package roots alongside it and NOT vendoring `@codegen`'s `apply.ts`,
 * its `index.ts` (which re-exports `apply.ts`), `@conformance`'s `ship.ts` or
 * its `verify/` directory. Those four are the CLI half — the part a human runs
 * to apply an approved proposal — and every one of them opens a file.
 * `__tests__/import-closure.test.ts` walks the real closure and fails on the
 * first `node:` specifier, so this paragraph is checked rather than promised. */

export interface EmittedFile {
  /** Path inside this package, relative to `packages/subapp/src`. */
  readonly source: string;
  /** Repo-relative path inside the Flightdeck host. */
  readonly target: string;
  readonly role: "manifest" | "guard" | "routes-index" | "service" | "web-module";
  readonly why: string;
}

export const STUDIO_SUBAPP_ID = "studio";
export const STUDIO_ROUTE_PREFIX = "/api/apps/studio";
export const STUDIO_MIN_HOST_VERSION = "5.0.0";

export const EMIT_MANIFEST: readonly EmittedFile[] = [
  {
    source: "server/subapps/studio/manifest.ts",
    target: "flightdeck/server/subapps/studio/manifest.ts",
    role: "manifest",
    why: "the code-declared manifest the host validates at boot; `initSchema` is a no-op because Studio is database-free",
  },
  {
    source: "server/subapps/studio/guard.ts",
    target: "flightdeck/server/subapps/studio/guard.ts",
    role: "guard",
    why: "the three-layer enable AND, re-read per request, cloned from maps/guard.ts",
  },
  {
    source: "server/subapps/studio/routes/index.ts",
    target: "flightdeck/server/subapps/studio/routes/index.ts",
    role: "routes-index",
    why: "the three routes; the guard is the first statement in every handler",
  },
  {
    source: "server/subapps/studio/service/pipeline.ts",
    target: "flightdeck/server/subapps/studio/service/pipeline.ts",
    role: "service",
    why: "the in-memory @spec -> @codegen -> @conformance run; pure, and writes nothing",
  },
  {
    source: "web/src/subapps/studio/index.tsx",
    target: "flightdeck/web/src/subapps/studio/index.tsx",
    role: "web-module",
    why: "the console page; default-exports a SubAppModule, ships no stylesheet and no i18n key",
  },
];

/** Models of host modules. Present so the emitted tree compiles and runs
 * outside a checkout; never installed, because the host already has the real
 * ones and they are wider than these. */
export const HOST_STANDINS: readonly string[] = [
  "server/db.ts",
  "server/fastify.ts",
  "server/lib/flightdeckAudit.ts",
  "server/project/types.ts",
  "server/workspace/types.ts",
  "server/subapps/types.ts",
  "server/subapps/capabilities.ts",
  "server/subapps/installRow.ts",
  "server/subapps/killSwitch.ts",
  "web/src/subapps/registry.ts",
];

/** Package roots the route's import closure reaches. All `node:`-free. */
export const VENDORED_PACKAGES: readonly string[] = ["@spec", "@codegen/pure", "@conformance/gate"];

/** Modules that must NOT travel with Studio: each one opens a file, and an
 * import that is merely PRESENT in a route's static closure fails the host's
 * fence whether or not it is called. */
export const EXCLUDED_FROM_VENDORING: readonly string[] = [
  "@codegen/index",
  "@codegen/apply",
  "@codegen/cli",
  "@conformance/index",
  "@conformance/ship",
  "@conformance/verify",
];

/** The host edit no sub-app can make for itself: `registry.ts` is code-declared
 * and there is no hot-install path to target. A human adds these two lines. */
export const REGISTRY_EDIT = {
  file: "flightdeck/server/subapps/registry.ts",
  importLine: 'import { studioManifest } from "./studio/manifest.js";',
  entryLines: ["  // Flightdeck Studio. Kill switch: SUBAPP_STUDIO_ENABLED", "  studioManifest,"],
} as const;
