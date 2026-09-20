/** Which file goes where when Studio is installed into a Flightdeck host —
 * and, since this is the document somebody follows, what the install ACTUALLY
 * requires.
 *
 * ⭐ WHY THIS FILE EXISTS. Studio's sub-app source lives in this package, which
 * sits OUTSIDE the host checkout, so the tree under `src/server`, `src/web` and
 * `src/tests` mirrors the host's layout without being it. This manifest is the
 * mapping an installer needs: source path here, target path there.
 *
 * ⛔ IT IS A MAPPING, NOT AN INSTALLER. Nothing in this package writes into a
 * host repo, and nothing here could: the whole point of Studio is that a
 * sub-app cannot mutate the thing it runs inside. The same rule applies to
 * Studio itself — these files reach a host the way any other sub-app's do,
 * through a human with a checkout.
 *
 * ── WHAT THIS FILE USED TO SAY, AND WHY IT WAS WORSE THAN NOTHING ───────
 * An earlier version of this document claimed the whole host edit was two
 * lines in `registry.ts`. Somebody followed it. With exactly those two lines
 * the host's own suite did not collect:
 *
 *     Cannot find package '@spec/index' imported from
 *     server/subapps/studio/service/pipeline.ts
 *
 * The real mount needed forty-six vendored engine files plus tsconfig path
 * aliases this document never mentioned — and once they were in place the
 * host's `npm run typecheck` went RED on them, because they are authored for
 * Studio's `moduleResolution: bundler` and the host compiles differently. That
 * is stack [4/5] of the host's `scripts/gate.sh`, so `npm run promote`
 * correctly reported BLOCKED.
 *
 * An install document that does not mount is worse than none, because someone
 * follows it. The fix was not to document the vendoring. It was to stop
 * needing it: `service/pipeline.ts` — the `@spec` -> `@codegen` ->
 * `@conformance` run — moved OUT of the emitted tree to
 * `packages/subapp/src/studio/conversion.ts`, where Studio's engine already
 * lives, and the sub-app now takes the result as a JSON bundle it re-checks
 * for itself. `__tests__/self-contained.test.ts` walks the emitted closure on
 * every run and fails on any specifier the host does not already resolve, so
 * this paragraph is enforced rather than promised.
 *
 * ── THE STAND-INS ARE NOT EMITTED ───────────────────────────────────────
 * `src/server/subapps/types.ts`, `installRow.ts`, `killSwitch.ts`,
 * `capabilities.ts`, `src/server/lib/flightdeckAudit.ts`,
 * `src/server/{db,fastify}.ts`, `src/server/{project,workspace}/types.ts` and
 * `src/web/src/subapps/registry.ts` are MODELS of host modules that already
 * exist in the host. They are here so the emitted files typecheck and run in
 * tests outside a checkout. Emitting one would overwrite a real host module
 * with a narrower copy, which is the one genuinely destructive thing this
 * mapping could do, so they are listed separately and
 * `__tests__/emit-manifest.test.ts` asserts the two lists never overlap. */

export interface EmittedFile {
  /** Path inside this package, relative to `packages/subapp/src`. */
  readonly source: string;
  /** Repo-relative path inside the Flightdeck host. */
  readonly target: string;
  readonly role: "manifest" | "guard" | "routes-index" | "service" | "web-module" | "host-test";
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
    source: "server/subapps/studio/service/bundle.ts",
    target: "flightdeck/server/subapps/studio/service/bundle.ts",
    role: "service",
    why: "the strict Zod shape of a conversion bundle — what is well-formed enough to have an opinion about. Imports zod and nothing else.",
  },
  {
    source: "server/subapps/studio/service/admit.ts",
    target: "flightdeck/server/subapps/studio/service/admit.ts",
    role: "service",
    why: "the host's OWN seven checks over a bundle's bytes — where the files would land, whether the manifest boots, what the code can reach, whether handlers guard first. Imports nothing but its sibling's types.",
  },
  {
    source: "server/subapps/studio/service/proposal.ts",
    target: "flightdeck/server/subapps/studio/service/proposal.ts",
    role: "service",
    why: "proposal naming, idempotency, and the artefact a reviewer opens — which keeps the bundle's self-report and the host's verdict apart by name",
  },
  {
    source: "web/src/subapps/studio/index.tsx",
    target: "flightdeck/web/src/subapps/studio/index.tsx",
    role: "web-module",
    why: "the console page; default-exports a SubAppModule, ships no stylesheet and no i18n key",
  },
  {
    source: "tests/subapps/studio/studioAdmission.test.ts",
    target: "flightdeck/tests/subapps/studio/studioAdmission.test.ts",
    role: "host-test",
    why: "exercises every admission rule against a real bundle: path escape, host-file edit, node builtin, guard-second, bad navSection, registry line carrying code",
  },
  {
    source: "tests/subapps/studio/studioGuard.test.ts",
    target: "flightdeck/tests/subapps/studio/studioGuard.test.ts",
    role: "host-test",
    why: "the refusal path on a real Fastify — 403 subapp_disabled with no adapter resolved — plus the positional guard-first read of the source",
  },
  {
    source: "tests/subapps/studio/studioPage.test.tsx",
    target: "flightdeck/tests/subapps/studio/studioPage.test.tsx",
    role: "host-test",
    why: "renders the web module and reads the markup: it paints, it says filing installs nothing, and it keeps the host's verdict apart from the bundle's self-report",
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

/** Studio's own source that does NOT travel, and must not.
 *
 * `studio/conversion.ts` is the `@spec` -> `@codegen` -> `@conformance` run. It
 * imports three of Studio's sibling packages, which is exactly right where it
 * now lives — in Studio — and exactly wrong in a host checkout. It is named
 * here so the exclusion is a listed decision rather than an omission somebody
 * has to notice. */
export const STUDIO_ONLY: readonly string[] = ["studio/conversion.ts"];

/** Every module specifier the emitted tree names that is not a relative path.
 *
 * ⭐ THIS LIST IS THE INSTALL REQUIREMENT. A Flightdeck host already has all
 * four: `zod` and `fastify` are server dependencies, `react` and
 * `react-dom/server` are web ones and appear only in the web module and the
 * emitted page test. That is why the install is a registry edit and nothing
 * else — no vendored packages, no tsconfig `paths`, no new dependency in the
 * host's `package.json`.
 *
 * `__tests__/self-contained.test.ts` walks the emitted files' real import
 * closure and fails on anything outside this list, so a future edit that
 * reaches for a fourth package breaks a Studio test rather than somebody
 * else's build. */
export const HOST_DEPENDENCIES: readonly string[] = ["zod", "fastify", "react", "react-dom/server"];

/** Named separately from `HOST_DEPENDENCIES` because it is a devDependency and
 * appears only in the three emitted host tests. A host that runs
 * `tests/subapps/` already has it — that is what those tests are run BY — but
 * listing it beside the runtime four would overstate what mounting Studio
 * costs a production install. */
export const TEST_ONLY_DEPENDENCIES: readonly string[] = ["vitest"];

/** Node builtins the emitted tree may name, and where.
 *
 * TESTS ONLY. A test reading source files is not a route reaching a
 * filesystem, and every host test in `tests/subapps/` does the same. A `node:`
 * specifier in a MOUNTED module would fail the host's own
 * `tests/subapps/subappImportClosure.test.ts` whether or not it were ever
 * called. */
export const NODE_BUILTINS_IN_TESTS: readonly string[] = ["node:fs", "node:path", "node:url"];

/** The host edit no sub-app can make for itself: `registry.ts` is code-declared
 * and there is no hot-install path to target. A human adds these two lines. */
export const REGISTRY_EDIT = {
  file: "flightdeck/server/subapps/registry.ts",
  importLine: 'import { studioManifest } from "./studio/manifest.js";',
  entryLines: ["  // Flightdeck Studio. Kill switch: SUBAPP_STUDIO_ENABLED", "  studioManifest,"],
} as const;

/** The install, in the order it is done. Written as data rather than as prose
 * in a README so `__tests__/emit-manifest.test.ts` can hold it to what the
 * rest of this file says — an install document drifting from the manifest it
 * describes is how the last one stopped being true.
 *
 * Steps 3 and 4 are things that are NOT required, stated as steps, because
 * their absence is the whole change: the last version of this document was
 * wrong by omission, not by anything it said. */
export const INSTALL_STEPS: readonly string[] = [
  "1. Copy the 10 files in EMIT_MANIFEST from this package to their `target` paths in the host checkout. Create `server/subapps/studio/`, `web/src/subapps/studio/` and `tests/subapps/studio/`; nothing outside those three directories is touched.",
  "2. Make the REGISTRY_EDIT: add its `importLine` beside the other manifest imports in `server/subapps/registry.ts`, and its `entryLines` inside `SUBAPP_MANIFESTS`. That is the only existing host file this install changes.",
  "3. No vendoring. Nothing from `@spec`, `@codegen` or `@conformance` travels, and nothing under `packages/` is copied. The conversion those packages perform happens in Studio and reaches the host as a JSON bundle.",
  "4. No tsconfig change. The emitted tree uses relative imports with `.js` extensions and names only HOST_DEPENDENCIES, all four of which a Flightdeck host already has. No `paths` entry, no `include` change, no new package.json dependency.",
  "5. Nothing else. No i18n edit (Studio ships no dictionary, so the frozen key counts in `tests/subapps/i18nSplit.test.ts` do not move), no `theme.css` region (the page uses the host's own classes and CSS variables), and no `web/src/api.ts` method (the page calls `fetch` through a local helper).",
  "6. Verify with the host's own tools, not Studio's: `npm run typecheck` and `npm test` in the host. The three emitted tests under `tests/subapps/studio/` are collected by the host's existing recursive vitest glob — the G3 layout fence requires that location and no wiring goes with it.",
  "7. Enable it: `SUBAPP_STUDIO_ENABLED=true`, plus the ceiling install row and the project's own row. All three, fail-closed, default OFF.",
];
