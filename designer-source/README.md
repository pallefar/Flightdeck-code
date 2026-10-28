# Editable AppDesigner source package

**Finite public redistribution is explicitly authorized.** On October 27, 2026, the rights holder confirmed control of the rights and authorized publication of this reviewed finite source set in Flightdeck-code; see `REDISTRIBUTION.md`. `SOURCE-PROVENANCE.json` records the exact closure. All 36 OS-derived sources match pinned OS commit `a2fe29b48425a32d00c8b4c73ba20ce10c5137d9`. This is not a repository-wide OS license, authority to publish other private files, or runtime/integration acceptance.

## Boundaries

- The eight application/style sources are the latest deferred-control-value candidate, including its CRLF/title, pending-selection, save history and synchronous deferred-value corrections. They are unmodified source bytes, not a stale minified mirror.
- The 36 OS files are exactly the reachable PageDoc schema/renderer/CSS, editor-core history/savepoints, page transaction, StatTile and widget-schema closure. No whole OS checkout, global theme, fixture/probe bundle, companion shell, native server or provider implementation is included.
- `AppDesigner` retains both `onCreatePageRequestHandle` and `onDocumentHandle`. The former is the actual common Create-page request API; the latter is the committed native-document adapter seam. Neither establishes host identity, permissions, a deployed page or publication.
- StatTile's two host navigation/i18n imports resolve only to the explicit sandbox seam. Sample data and local-only save disclosures remain visible. Live widgets, actions, publication and host grants are not supplied.
- This is an independent source project outside the root `src/server/packages` compiler membership. Its original strict compiler program remains strict with `skipLibCheck:false`. The existing root tsconfig include/exclude/strict options and all original root members are unchanged; generated declarations and the ordinary Vitest wrapper remain in the root program. This is a package boundary, not a hidden test exclusion.

## Reproduction (from repository root)

Use the exact existing cached/locked dependency versions. No install/update step is performed by the builder. Use the repository's single physical `node_modules` peer tree; do not install a second source-local React mirror. The builder anchors its type roots and bundle paths to the repository, independent of caller cwd, and the ordinary peer-identity regression rejects split React dispatchers.

```sh
node designer-source/build.mjs
node designer-source/build.mjs --check
node designer-source/tests/run.mjs
```

The builder writes `src/studio/designer/{AppDesigner,model,native}.js`, the paired `AppDesigner.css`, actual emitted `.d.ts` closure/facades, pinned private Zod declarations/license, notices and a deterministic source/output manifest. It refuses source drift, compiler-version drift, extra stale outputs, unexpected host seam imports and any compiler diagnostics. `--check` regenerates every byte and requires the exact output inventory.

The normal repository build runs this generator before the unchanged TypeScript/Vite steps. `npm test` retains the original Vitest and Docker families and explicitly adds this pure package runner. New ordinary wrapper tests are discoverable without any Vitest exclusion change. Retained model/save/native tests change only import destinations; their assertions are preserved. Browser replay drivers are separate obligations and are not executed by this runner.

## Canonical Zod boundary and notices

Runtime bundling and declaration relocation use the same exact `zod@3.25.76`: the bare v3 widget-schema entry plus its co-shipped `zod/v4` PageDoc entry. Every emitted bare Zod type import is redirected to the complete exact private declaration closure, not the host's Zod major. React is external. `src/studio/designer/NOTICE.md` contains the full Zod MIT notice. The package's `UNLICENSED` flag does not invent an OS license or authorize public publication.

Current isolated checks also compile the emitted declaration API against copied actual OS dependencies (Zod 4.4.3, TypeScript 6.0.3 and React types 19.2.17). That proves declaration portability, not an installed/mounted host. No browser, worker, native OS persistence, generated-source execution, provider or user-credential journey has been performed in this phase.
