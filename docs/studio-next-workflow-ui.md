# Workflow IDE refinement — Command / Inspect

## Delivered

The actual `WorkflowEditor` is now a canvas-first Command / Inspect workspace, not a parallel dashboard or simulated agent console.

- One desktop workspace command row contains document identity, Blocks, Undo/Redo, Inspector, Document, Explain workflow and explicit Run locally. View commands sit in the compact canvas bar. Editor-local chrome measures **91px at 1280×577** and **165px at 390×844** in the isolated browser fixture.
- A retained **Block Composer** combines search and native category filtering. Actual builtin entries show their current instance count. Graph-local wrappers show their existing base and current instance count, with a dashed declaration treatment. Unconfigured placeholders remain visibly execution-blocked. No configuration is embedded in drag payloads.
- Existing-block reuse stays visible before long instructions: at least two actual builtin cards are completely visible in the short-desktop composer. New-wrapper actions remain at hand, rather than below an entire registry list. On narrow screens, the retained composer is an in-editor overlay with a real Close/focus-return action, not a form beneath the canvas.
- **Custom block** opens a native review dialog. Its definition editor sits beside a strictly parsed, typed-default preview. The required review checkbox adds only a graph-local declaration. It does not add a node automatically, activate a resource, publish an approved library, install a plugin or approve execution. Each subsequent insertion reuses its actual defaults and remains one undo.
- **Ask AI for a block** remains unavailable without a trusted parent callback. Opening either dialog does not call a model. Only the explicit proposal action invokes the existing callback; rejected approval wrappers and stale graph/model-context responses remain blocked. Callback browser tests are labelled DEVELOPMENT injection, not live provider proof.
- The collapsed Registry manifest exposes actual **existing builtin instances**, **local wrapper instances**, **graph-local wrapper definitions** and **unresolved capabilities**. Registered unconfigured placeholders can be counted both as registered instances and unresolved capabilities; this is stated explicitly. Configuration summaries do not reveal literal payloads or credential identities.
- Fit now waits for a positive, active, visible viewport and ignores inactive/hidden/inert/background targets. First activation fits once; returning to the retained editor preserves user zoom. View operations do not change graph positions, exports or history.

## Visual and motion contract

All surfaces consume inherited Flightdeck tokens through existing `--wf-*` aliases. No host palette is redeclared. Arial, steel surfaces, orange focus/command accents and native orange checkbox accents work under both inherited light and dark themes. The local run action uses a token-derived tint instead of white-on-solid-orange Night text.

The modular assembly remains a physical, noninteractive faceplate presentation of received topology. A subtle steel header seam was added to the decorative plate only. The node dimensions, typed ports, settings forms and graph data stay stationary. Queued placement ghosts, arriving plates, locked couplers and actual SVG edge locks remain intact; creation still uses at most 12 groups with the existing approximately two-second bound. Pause, Skip, Replay, manual explanations and actual settings references remain available. Reduced motion, live ancestor motion-off, retained visibility and actual document-hidden guards remain enforced.

Final design is not execution. There is no simulated model stream, fake task log, automatic run/deploy, new voice implementation, package change, server/protocol modification or host mutation.

## TDD and verification

Failing tests were observed before production changes for composer provenance, consolidated commands/manifest facts, native wrapper review/focus/defaults, short-desktop reuse density, mobile canvas space, native theme accents and inactive first Fit. The owned test entry imports only workflow UI modules, avoiding reliance on the evolving Studio shell.

Commands actually passed:

```text
npx vitest run src/workflow --maxWorkers=2
16 files / 110 tests passed
npm run typecheck
exit 0
```

Reproducible new acceptance harness:

```python
# Inside browser_exec, with the existing source Vite on 5180:
exec(Path('/Users/te451223/Flightdeck-code/src/workflow/__tests__/next-ui.browser.py').read_text())
```

The new harness records 17 groups: both viewport sizes in Day/Night; active-only Fit; native wrapper review; explicit/rejected/stale proposals; manifest settings and document replacement guards; first-visible Fit; real native `DragEvent`/`DataTransfer` cases; actual pure-data mapping/debugger runs; and 12 real canvas/composer/review screenshots. The nested drop and mapping groups contain five and eight assertions respectively.

Existing browser suites also passed: **13 modular-assembly groups** and **18 walkthrough groups**, including real CDP node drag, native keyboard/modal focus, actual document backgrounding, resource insertion in one undo, unchanged local trace, stable node/port hit geometry, exact export preservation, reduced-motion/manual controls and live ancestor motion-off. The maximum graph measured 100 nodes / 99 edges / 12 groups, with final plate end at approximately 2146ms in that run, within the existing 2200ms observed allowance. A further **eight-case physical/reduced-motion matrix** passed at both sizes in inherited Day/Night.

### Exact evidence paths

All paths below are under `/Users/te451223/.hermes/cache/scratch/` (temporary scratch artifacts; archive them for a release):

- `workflow-next-verification-summary.json` — programmatically aggregated receipts (57 recorded groups) and the exact screenshot inventory.
- `workflow-next-unit-typecheck.txt`
- `workflow-next-ui-browser-results.json`
- `workflow-next-modular-browser-results.json`
- `workflow-next-walkthrough-browser-results.json`
- `workflow-next-motion-matrix.json`
- `workflow-next-native-modal.json` — real whole-card double-click, Tab trap, Escape, retained draft, Apply/undo and native review-checkbox mouse input.
- `workflow-next-1280-dark-canvas.png`
- `workflow-next-1280-dark-composer.png`
- `workflow-next-1280-dark-review.png`
- `workflow-next-1280-light-canvas.png`
- `workflow-next-390-dark-canvas.png`
- `workflow-next-390-dark-composer.png`
- `workflow-next-390-dark-review.png`
- Matching `workflow-next-{1280|390}-{light|dark}-{canvas|composer|review}.png` states are listed individually in the UI results JSON.
- `workflow-next-modular-{1280|390}-{placement-arrival|snap-seat|complete}.png` records actual paused CSS positions and the final received view, not generated progress.

## Files changed

Production: `src/workflow/WorkflowEditor.tsx`, `styles.ts`, `BuildManifest.tsx`; new `BlockComposer.tsx` and `WrapperReview.tsx`.

Tests: new `block-composer.test.tsx` and `__tests__/next-ui.{html,browser.tsx,browser.py}`; strengthened `host-theme.test.tsx`. This document is `docs/studio-next-workflow-ui.md`.

## Issues and remaining gap

A five-second browser IPC wait timed out while an eight-case mapping script continued; exact completed results were read back rather than fabricated or retried as execution. Concurrent/just-mounted motion fixtures also stalled a scrubbed animation clock. The unchanged suites passed when serialized on their native workflow fixture entry; the theme matrix additionally waits for a real animation frame after changing inherited tokens. No production durations, validators or assertions were weakened.

**Largest visual gap:** a full-DAG mobile Fit is an overview, so labels are small until zoom or the actual Registry/settings modal is used. The final combined chat/workspace shell must still be measured by the parent worker: these isolated 91/165px editor metrics do not establish the remaining canvas height after chat and shell chrome.

**Unverified here:** live provider completions, configured production connectors, independent reviewer integration, full-suite/staging release and final combined shell. Existing Docker 8790, backend, packages, host checkout and deployments were not changed. The public editor `active`, `narration`, `buildReveal`, ref and callback contracts remain source-compatible.
