# Workflow modular assembly

## Delivered behavior

The received workflow now assembles as technical Flightdeck modules, not a plain graph fade: a dashed placement ghost at the actual node coordinates, an arriving decorative faceplate, a short snap/settle, actual typed-port socket accents, and normalized drawing of the actual released dependency edges. The complete received graph remains editable and can be explained with the retained walkthrough.

This is an **Operate** surface, not a build-progress dashboard. The status remains **Draft received · assembling the view** and **not executed**. There are no invented tool steps, dependencies, data packets, run results, save receipts, deployment receipts or independent-human approvals. Missing/unconfigured capabilities keep their existing configuration warning and `Execution blocked` summary. Existing blocks and reusable wrapper origins/counts are unchanged.

The assembly language is intended to match separately owned sub-app creation: placement ghost → module plate → short seat/socket accent → real connection/framework completion → explanation. The workflow and sub-app builders remain separate; this change does not merge their routing, documents or execution contracts.

## Motion and editing contract

- `AssemblyPlate.tsx` renders one `aria-hidden="true"`, `pointer-events:none` faceplate inside `.wf-node-assembly`. Only this decoration translates/scales: `translateY(-18px) scale(.97)` → `translateY(2px) scale(1)` → `translateY(-1px)` → identity. The real node article, content, buttons and typed ports do not transform for assembly. The stage still uses the editor's existing zoom transform only.
- `.wf-assembly-plate[data-assembly-phase]` distinguishes `queued`, `arriving`, and `locked`. `locked` means visually seated only. `animationend` settles an arriving plate; changing presentation groups or skipping replaces only decoration. Parameter/settings forms and editing controls retain DOM identity.
- Node articles expose `data-visual-assembly`, `data-creation-queued` and `data-creation-current`. The existing inner assembly attributes are retained. `data-creation-current` identifies the current presentation group, not runtime execution or approval.
- Real SVG dependency groups now also expose `data-creation-current`. Their real `pathLength=1` paths use `wf-connection-lock`. There are no additional decorative/fabricated dependencies. Port `::after` accents use `wf-port-seat` without moving the real buttons.
- `--wf-assembly-duration` and `--wf-assembly-state` are scoped to the editor. Each plate/socket/edge fits in `min(210ms, 2000ms / groupCount - 8ms)`. The existing presentation clock stays nominally two seconds and uses at most twelve actual-graph groups. A 100-node graph therefore uses approximately 158.667ms per snap, not a 100-node animation tail.
- `PlaybackState.creationCycle` increments only for an actual enabled creation replay. It restarts the same paused first group's decoration without remounting its head button or settings. It is presentation state, never graph/export/history data.
- Pause freezes the group clock and CSS plate/socket/edge animations. Skip, a graph change, native dragging, settings, replacement/import, running or inactive/hidden presentation returns to the complete topology or pauses explanation using the existing guards.
- The received-status overlay's noninteractive area passes pointer input through; only its Pause/Resume/Skip buttons accept pointer events. This fixes an observed native hit-test interception of a real output input port.
- System reduced motion, the explicit Presentation motion checkbox, and live ancestor/editor `[data-motion="off"]` immediately show the fully assembled graph. CSS disables animations/transitions on decorations and their pseudo-elements; the hook cancels the creation clock and disables timed Play. Manual Next/Previous remain available. Re-enabling motion does not replay old creation.
- Host tokens, Arial, family colors, existing card dimensions, safe configuration summaries, parameter/mapping drafts and atomic resource insertion remain unchanged. No new dependencies, canvas engine, sounds or autoplay voice were introduced.

## Parent integration

`WorkflowEditor`'s existing public props are unchanged:

- `buildReveal?: boolean` defaults to false. Set it only on the explicitly accepted received-graph mount, not arbitrary graph changes/navigation. External replacements still require the parent's existing remount/key and dirty-document guard.
- `active?: boolean` defaults to true and stops retained-away presentation.
- `narration?: { enabled; speak; stop }` remains the explicit shared-provider bridge. Narrate is optional, privacy-bounded and never automatic. This work does not mount a second voice provider.

No Studio, Workbench, voice, package/server/provider, host, deployment or dependency files were changed by this refinement. Source verification used Vite 5180. Frozen staging 8790 was not deployed or changed. Combined Studio/voice wiring and release verification remain parent-owned.

## Verification

RED was observed before each new production behavior:

1. Static rendering had zero faceplates instead of the four received nodes.
2. Same-first-group replay had no presentation cycle (`undefined` instead of `1`).
3. Real Chromium reported no connection-lock phase on a released actual dependency.
4. Real Chromium reported that ancestor motion-off did not immediately finalize assembly.

GREEN at the stable end:

| Check | Actual result |
| --- | --- |
| `npx vitest run src/workflow --maxWorkers=4` | 108 passed, 15 files |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; existing-style >500kB bundle warning remains |
| Modular CSS/CDP browser driver | 13 groups passed |
| Retained walkthrough/native keyboard driver | 18 groups passed |
| Additional existing editing regressions | 23 groups passed |

The 54 browser groups were counted from saved result objects, not inferred from a plan. They cover Expanded/Compact and short-desktop/mobile branch graphs; queued/arriving/locked actual CSS; identical interactive rectangles at scrubbed keyframes and completion; thirteen visible real head/port center hit tests; native CDP drag of a queued block with exact zoom-normalized movement and one Undo; explicit same-first-group replay retaining head identity; normalized actual edges; all three motion-off modes; actual store export bytes and Undo/Redo unchanged; zero adapter/model-proposal calls during replay; actual local execution traces unaffected; wrapper review/default reuse; dirty guards; native modal Enter/Tab/Escape/focus return and draft retention; source mappings and real deterministic local outputs; atomic resource-reference insertion.

The maximum-graph check renders 100 real nodes/99 real dependencies, fits every actual node in the viewport, uses twelve groups, and leaves graph/history unchanged. In the final browser run the received-view clock completed at **2111.2ms** including browser/render scheduling; the computed final CSS endpoint was **2141.57ms**. Both remain below the unchanged **2200ms browser regression ceiling**. The nominal presentation clock remains 2000ms; this is not backend timing.

Evidence is under `/Users/te451223/.hermes/cache/scratch/`:

- `workflow-modular-verification.txt`
- `workflow-modular-browser-results.json`
- `workflow-walkthrough-browser-results.json`
- `workflow-modular-editing-regressions.json`
- `workflow-modular-{1280,390}-{placement-arrival,snap-seat,complete}.png`

The six screenshots show actual rendered received graphs. Arrival/seating frames scrub the real paused CSS animation through WAAPI for inspection; they are explicitly presentation checkpoints, not simulated model/runtime progress. The isolated entry imports the workflow editor only, avoiding main-entry HMR coupling.

Drivers: `src/workflow/__tests__/modular-assembly.browser.py` and the existing `walkthrough.browser.py`, executed through the named real-browser session. A long legacy mapper assertion exceeded the browser helper's five-second synchronous wait; its still-running actual browser completion and eight results were read back successfully without rerunning effects. Initial Fit was allowed to settle before legacy absolute-size assertions. Neither required changing application behavior or relaxing graph/playback bounds.

The visual audit stays within Flightdeck's existing Operate composition: no marketing hero, generic feature grid, rainbow plastic palette, brand/logo imitation, invented metrics, confetti or looped attention animation. No deployment, live-provider invocation, audible voice integration or full combined-suite baseline is claimed here.
