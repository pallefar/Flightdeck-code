# Bundled reuse references in Studio

## What is delivered

The AI builder has a **Browse reusable sources** entry beside the request composer. It is available before operator sign-in or model selection because it reads generic definitions shipped with the source, not private workspace records.

The catalog is derived from the actual workflow `builtinRegistry` and `PROCESS_TEMPLATES`: nine workflow built-ins and three Process Discovery templates. There is no second hand-maintained catalog. Listing returns bounded metadata; selecting a source explicitly requests its detail projection and structural field summary.

This is **reference insertion**, not enforced generator reuse. It does not choose an executable, replace a graph, build a template, send a model request, save a draft, execute a resource or grant permission. Existing generation, privacy, exact-send review, save and run controls remain authoritative.

## Use it

1. Open **AI builder → Browse reusable sources**.
2. Search the bundled definitions or select a source kind.
3. Select a definition and inspect its boundary, field summary and unknowns.
4. Read the **Exact insertion preview**. Check the explicit review checkbox only if that is the context you want to add.
5. Choose **Add reference**, then close the picker to inspect the request.
6. **Undo insertion** can restore the exact previous request once, provided its text, edit revision and authoring context are still current.

Closing the picker alone does not discard a valid Undo receipt. Editing the request, changing context or losing availability can revoke that receipt rather than overwrite newer work. Inserted references remain ordinary in-session request text; insertion is not a durable save. Later typing is retained.

## Provenance and bounds

- Process template version `1.0.0` is shown where the registry declares it. It is not an implementation version for workflow built-ins.
- Executable version, per-entry license, canonical owner and independent approval remain **Unknown** where not supplied. Source-static availability is explicitly **not probed**.
- Schema fields are a structural summary. Runtime refinements, adapter configuration and effect-time authority remain separate.
- Consistency fingerprints are not executable hashes, compatibility certificates, license grants or approval receipts. Selected detail is revalidated before insertion; captured schema-reference identity is checked after asynchronous fingerprint work.
- References append the exact displayed preview, including its own separators, through the existing composer edit/invalidation path. A one-use compare-and-set lease binds the authoring context, revision and original text. Cancellation or an uncertain confirmation never authorizes an automatic retry or rollback.
- Local measurements distinguish UTF-8 bytes, UTF-16 code units and named JSON projections. They are not model-token counts, final provider-envelope sizes or cash-savings evidence. Server-loaded skills and later requests are not included.
- The existing 8,000-code-unit composer ceiling remains. The conservative 2,000-code-unit raw-context projection and byte ceilings can refuse an insertion earlier. Text is not silently truncated.
- Catalog callbacks and synchronous composer ports are trusted same-realm seams, not a hostile-JavaScript sandbox.

No private artifact ledger, host records, credentials, live connection or connector is scanned to populate this picker.

## Implementation and regression coverage

- `src/reuse-catalog/catalog.ts`: actual-registry metadata/detail projections, provenance, limits and source-drift checks.
- `src/reuse-catalog/controller.ts`: reviewed insertion, cancellation/currentness and one compare-and-restore Undo.
- `src/studio/ReusePicker.tsx` and `ReusePicker.css`: dialog, search/filter/detail/review controls and the real composer bridge.
- `src/studio/StudioApp.tsx`: integration with the existing authoring context and prompt editing.
- `src/studio/StudioBuilder.css`: overflow-safe empty-home centering. Supporting engines retain centering when content fits and start-align overflowing content so its beginning stays reachable.

Maintained tests cover actual factories, asynchronous schema replacement, byte/character bounds, stale/ABA/reentrant operations, uncertain commits, one-use Undo, retained typing and honest static/SSR mobile layout contracts. The maintained browser fixture is in `src/studio/__tests__/reuse-catalog.browser.*`.

## Validation snapshot — October 19, 2026

The reviewed source candidate passed the full repository test entry: **4,924 Vitest cases across 292 files plus 41 Node cases**, without skips, and the normal repository typecheck, production frontend build and diff checks.

Separate independent source reviews accepted the core, UI bridge and narrow mobile CSS repair. The repaired core passed 76 maintained cases; 201 separate probe records and three original schema-race repetitions were checked without adding them to the maintained count. All three races refused stale insertion with zero composer writes.

Owned, frontend-only browser checks exercised real bundled definitions and native pointer/key/input events against immutable production assets: a complete 29-case mobile/mixed-width group and a separate 10-case actual 1280×900 desktop group passed. These groups overlap in behavior. Day/Night mobile and full-width desktop captures were inspected. Exact preview append, explicit review, one exact Undo, later-typing retention, modal focus wrapping and short-screen hit testing were exercised with no application API requests. Appearance/source-kind select changes in those checks were programmatic; native select-popup behavior and physical foreground focus are not certified.

### Retained qualifications

An earlier custom mixed-width browser driver failed without retaining enough target, visibility or media-transition state to establish its cause. An independent offline investigation found no confirmed application defect and demonstrated the intentional context/visibility/edit invalidation paths, but did not diagnose that historical run. Its failed verdict remains unchanged. Later complete browser passes are separate evidence, not a relabeling of that failure. A timestamped replay of the same key/viewport sequence on the existing unbranded test browser also passed after correcting only an observer-installation timing error in the diagnostic harness.

Normal full compilation retains the repository's existing `skipLibCheck: true` policy. An additional whole-tree `skipLibCheck: false` check still fails on the baseline Vite/Rollup TS2430 declaration incompatibility; scoped strict core/mobile checks pass. No dependency or compiler policy was changed to suppress it. Historical RED/GREEN pairs lacking identical test snapshots are not upgraded to strict identical-test TDD certification by these repairs.

These are bounded **source and frontend-only** results, not live-provider, canonical host identity/reviewer, deployed-image, recovery, universal-browser/accessibility or production-release acceptance. Operator sign-in, real key entry, model selection/send, exact-context review, durable output readback and separately authorized execution remain user-controlled gates.
