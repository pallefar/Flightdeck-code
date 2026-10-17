# Canvas-first workflow authoring

## Scope and boundaries

This change is confined to `src/workflow/**` and this document. It does not change graph schemas, mapping resolution, execution adapters, saved-workspace semantics, host installation or deployment. The shared Studio app bar/navigation belongs to the shell; the editor adds no second hero or global navigation.

- Document name and **Run locally** are the primary row. Local execution acts on the in-memory graph; it is not the separate saved-workspace run action. Existing adapter fail-closed behavior and independent-human pauses remain unchanged.
- **Blocks**, Undo/Redo and **Inspector** are compact editing controls. **Document** is a native keyboard-accessible disclosure containing New workflow, Import JSON and Export JSON. Choosing an action closes the disclosure so it cannot intercept a later canvas click. JSON transfer receives focus, and closing/applying returns focus to Document.
- Block count, connection count and structural/configuration-warning status stay visible. The existing validation, connection selectors and local input/trace are available through native disclosures below the canvas. No autosave, model connectivity or deployment success is inferred.
- New/template replacement checks the actual graph serialization against the graph opened by this editor. Typed block-settings input also conservatively marks replacement as requiring confirmation. Import uses the same confirmation, existing strict parser and existing single-commit undo. Cancel leaves the graph intact. This is a local replacement guard, not a claim that the editor knows the workspace's saved revision; new-document history behavior is unchanged.

## Retained panels and keyboard paths

Both panels start collapsed. Their buttons expose `aria-controls` and `aria-expanded`; `hidden` removes closed content from focus navigation without unmounting it. Search/category state and the current inspector forms survive collapse. At narrow widths disclosed panels stack after the canvas rather than forcing document-wide horizontal scrolling; each can scroll internally.

A single node-header click/keyboard activation selects and reveals the inspector. Native palette buttons add blocks without dragging. Connection selectors and numeric X/Y fields remain keyboard alternatives to port gestures and pointer movement. Double-click anywhere on a block still opens the native modal. **Open block settings** in the inspector provides a keyboard route to that same modal. Escape/Close restores the recorded opener, falling back to the inspector toggle if the opener is hidden or removed.

The inspector, modal and Inputs/Parameters/Results use the same mounted `NodeSettings` forms. No subtree is reparented, and switching display mode does not replace graph or form state. Parameter and mapping Apply actions remain separate. There are no document-global Cmd/Ctrl-S, D or R handlers; browser commands and editable-field shortcuts are not intercepted.

## Fit and layout contract

**Fit to graph** computes zoom from node bounds and the active Expanded/Compact dimensions, using actual canvas `clientWidth`/`clientHeight` (excluding scrollbars). It applies zoom and clamped native scroll offsets after rendering. It does not modify positions, graph JSON or history. Empty/non-finite helper inputs return a safe viewport; supported graphs retain the existing nonnegative, finite 0–10000 position schema. Invalid negative-position imports remain rejected rather than silently normalized. A 1% lower zoom bound permits a maximum-size/distant graph to fit; operators can reset to 100% for editing individual blocks.

Initial fitting shows the template graph on the first fold. The canvas uses a viewport-relative height with a 300px floor and natural document flow for lower actions, instead of a fixed-height editor clipping its own tools. Host tokens, orange accent and Arial remain in use; there is no new library or external font.

Observed clean `/demo` layouts with the concurrently updated shared shell:

| Viewport | Canvas top | Canvas height | Editor chrome above canvas | Document horizontal overflow |
| --- | ---: | ---: | ---: | --- |
| 1440×900 | 296.5px | 590px | 146.5px | None |
| 1280×577 | 296.5px | 300px | 146.5px | None |
| 1024×768 | 296.5px | 458px | 146.5px | None |
| 390×844 | 520px | 534px | 168px | None |

At 1280×577, 280.5px of canvas is visible before document scrolling, versus approximately 152px in the before capture (canvas began at 425px). The editor's own chrome is 146.5px, independently of shell improvements. All canvas-toolbar button bounding boxes measured at least 24×24 CSS pixels at every listed size. Zoomed graph content can still be very small when fitting a large graph; reset zoom and use the inspector for detailed edits.

## Verification and strict TDD evidence

The new native harness was written and run before each implementation slice. Observed RED failures included missing palette toggle, missing Fit control, excessive chrome, missing keyboard modal action, missing replacement confirmation, lost modal-opener focus, oversized wrapping inspector tabs, and missing JSON-transfer focus. A native click also caught the open Document disclosure intercepting Fit as New workflow; closing it on action fixed that real interaction bug.

Tests are reproducible with existing dependencies, not an installed browser test framework:

```sh
npx vitest run src/workflow --maxWorkers=4 --minWorkers=1
npm run typecheck
FLIGHTDECK_HOST_ROOT=/Users/te451223/project-contract npx vitest run --maxWorkers=4 --minWorkers=1
npm run build
npm run test:docker
```

Through `browser_exec`, using the live Vite `/demo` and pre-imported browser helpers:

```python
from pathlib import Path
exec(Path('/Users/te451223/Flightdeck-code/src/workflow/canvas-first.browser.py').read_text())
exec(Path('/Users/te451223/Flightdeck-code/src/workflow/workflow-browser-checks.py').read_text())
```

- New harness: **10 passing browser groups**. Actual CDP mouse/keyboard input exercises panel toggles, native typing, double-click, Tab, Enter, Escape, modal trapping/opener return, initial visibility, four responsive sizes and pointer-activated fit. It verifies retained form DOM identity/drafts, Compact geometry, unchanged positions, cancellation and a real textarea import of 100 distant blocks with one-action undo. The Compact select uses a native DOM change event; the Fit action uses CDP input. Confirmation cancellation is explicitly stubbed to avoid blocking CDP, not claimed as a native confirmation-dialog test.
- Existing canvas harness: **8 passing groups**, including native DragEvent/DataTransfer scrolled+zoomed drops, reusable defaults, malformed/foreign payload rejection, one-action undo/redo, real CDP Compact-node movement, typed settings and actual local true/false routing. Its viewport is now 1280×577 and asserts actual nonzero scroll offsets: observed `scrollLeft=22`, `scrollTop=120` at 80%, not merely requested offsets that clamped to zero.
- Existing whole-card settings and modal-draft harnesses pass. Existing mapper/results harness passes **8 groups**, including separate Apply retention, actual ancestor/literal mapping outputs, missing-path blocking, graph invalidation, roving tabs and removal of all mappings.
- Real isolated DEVELOPMENT resource insertion passes with injected and default native fetch. Both preserve editor/workspace/library identity and unapplied parameters; save under the same identity at revision 2 with exact authenticated readback; prove one undo/redo, no replay, capacity rejection and scope masking. Observed saved IDs: `9cbcd055-ee1d-4531-9636-ad46d82bc026` and `ebe7267c-cb7d-4c9b-9eca-76400a70805b`. The fixture observed **zero destination calls**. Its dedicated 9192/5189 processes were stopped; they did not replace 8787/5180 or touch the OS service.
- Final host-aware Vitest report: **2789 passed, 3 failed, 0 pending, 2792 tests**. All **47 tests in `src/workflow`** pass. The three known baseline failures are the computed hand-written `docusign`, `maps`, and `advantage` manifest fixtures rejected by the JSON-literal reader. No host checks were skipped or weakened. Concurrent workers added unrelated tests while this task ran; these are observed final counts, not a fixed repository baseline.
- Typecheck and production build pass. The existing Vite large-chunk warning remains (568.46 kB entry JavaScript in the final build). All **6 Docker node tests** pass; this is not a production rollout.

Raw final Vitest report: `/Users/te451223/.hermes/cache/scratch/workflow-final-vitest.json`.

Screenshots:

- Before: `/Users/te451223/.hermes/cache/scratch/workflow-before-1280.png`
- After: `/Users/te451223/.hermes/cache/scratch/workflow-after-1280x577.png`
- After: `/Users/te451223/.hermes/cache/scratch/workflow-after-1440x900.png`
- After: `/Users/te451223/.hermes/cache/scratch/workflow-after-1024x768.png`
- After: `/Users/te451223/.hermes/cache/scratch/workflow-after-390x844.png`

## Accessibility acceptance references, not certification

The W3C WCAG 2.2 Recommendation is the primary acceptance reference, especially **2.4.11 Focus Not Obscured (Minimum)** and **2.5.8 Target Size (Minimum)**. Focus visibility/return, native keyboard controls and measured toolbar targets are scoped evidence, not WCAG conformance certification or a complete assistive-technology audit. Source retrieved directly from W3C:

```text
https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum
https://www.w3.org/TR/WCAG22/#target-size-minimum
```

Production identity, configured model/provider readiness, independently activated resources and host deployment remain separate unverified operator concerns; no credentials or production effects were introduced by this layout work.
