# Workflow creation reveal and design walkthrough

## What the editor shows

- An **explicitly accepted received AI graph** (`buildReveal`) gets a 2-second, dependency-ordered assembly presentation. This is a replay of an already received artifact, not a backend stream, tool call, installation, validation pass or execution receipt. Existing quick node-entry animations retain their separate sub-300ms timing.
- Up to 12 presentation groups keep a 100-node graph bounded; small graphs reveal individual blocks. Node/edge DOM, hit tests, graph positions, mappings, configs, undo history and run traces remain real and unchanged. Only an inner opacity/filter layer and connection presentation change. **Pause creation**, **Resume creation**, **Skip to final** and **Replay creation** control the presentation.
- **Explain workflow** opens a retained, dismissible inspector beside the canvas (below it on narrow screens). Its visible label is **Design walkthrough · not an execution**. Fixed playback controls remain visible while the explanation/tips scroll. Closing returns focus and restores the full canvas.
- **Previous / Next** navigate one actual node at a time. **Play walkthrough** advances explanations every 2 seconds; **Pause**, **Stop**, **Replay walkthrough** and **Skip to final** never run the graph. Narration is a separate explicit action and pauses this clock so a spoken paragraph is not interrupted by automatic advancement.

## Actual graph semantics

The pure plan follows the engine's dependency-ready topological rounds, using node-array order only for simultaneous ready-node ties. It does not sort by visual position or infer a branch result. It includes disconnected design parts, marks those not reachable from any manual trigger, and surfaces actual admission constraints (exactly one manual root, connected non-root nodes, terminal outputs and no path bypassing a required human gate).

- Branches show **both alternatives**. A real run follows its selected port; the walkthrough selects neither.
- Conditional joins may continue with one active input. More than one active input blocks in DAG v1; no active input skips the node. They are not invented merge blocks.
- Human approval remains an independent human pause. The walkthrough cannot grant it.
- HTTP/LLM/resource steps need configured trusted adapters. The walkthrough calls none; resource active-revision/function/project authority remains an effect-time server check.
- Reusable wrappers use their actual base type and effective defaults/overrides. Set-fields tips describe a shallow object merge, not arbitrary code.
- Input mappings describe original-input, ancestor-output and literal **shapes**, omitting values, path/key names and identities. Explicit `[]` is correctly different from no mapping override. Missing paths/skipped ancestors block rather than fall back.
- Output steps describe the engine's incoming-data/terminal-output behavior. No transformed result, generated source or adapter response is invented.

The highlighted orange dashed **explanation route** is distinct from the graph's normal green connections and real execution trace. It never paints a gate approved or depicts fake data arriving at one.

## Parent integration contract

```tsx
<WorkflowEditor
  initialGraph={acceptedGraph}
  buildReveal={explicitlyAcceptedAiDraft}
  active={view === 'editor'}
  narration={{ enabled: voice.enabled, speak: voice.speak, stop: voice.stop }}
/>
```

- `active?: boolean` defaults to `true` for standalone use. Retained Studio/Workbench parents should pass their real active editor/IDE state.
- `narration?: { enabled: boolean; speak(text: string): void; stop(): void }` is an optional bridge to the parent's shared scoped voice provider. The workflow package implements no speech recognition/synthesis itself. Without the bridge, **Narrate current step** is disabled with enable-voice help.
- Voice is never started by accepting a graph, opening the tour, stepping, playing, enabling voice later, or replaying creation. Explicit narration uses generic registry step names and reviewed explanation text, not graph labels, literal values, URLs, reviewer identities, instructions or payloads. Navigation, editing, modal opening, visibility loss and disabling voice cancel narration requested by this tour.
- Keep the existing initial-graph/remount and `confirmReplacement()` contracts. Ordinary parent renders and view changes do not replace the graph or restart the reveal.

## Lifecycle and accessibility

Graph snapshot changes immediately suppress old instructions/highlights and cancel timers. Equivalent snapshots, zoom, Fit and Expanded/Compact changes retain the current step. Attribute observers inspect actual hidden/inert/ancestor visibility, the parent `active` prop and native `document.visibilitychange`; return navigation never silently resumes playback. Opening settings, running explicitly or dragging interrupts presentation without blocking the action.

Reduced motion or **Presentation motion** off shows the final creation view immediately. Intentional manual Previous/Next stays available; timed playback is disabled. Current-node `aria-describedby` links to its explanation/tip. Continuous polite screen-reader announcements are off until explicitly enabled. The real native settings modal is linked from the current step, retains parameter drafts, traps native keyboard focus and returns it to the tour opener.

## Verification entry points

- Unit/SSR: `npx vitest run src/workflow --maxWorkers=4`
- Isolated browser fixture: `/src/workflow/__tests__/walkthrough.html` on the existing source Vite server.
- Real Chromium driver: `src/workflow/__tests__/walkthrough.browser.py` via `browser_exec`. It asserts exactly 18 named groups and writes a read-back JSON ledger to the Hermes scratch directory.
- The browser groups cover 100 actual nodes, pause/resume/skip/replay, both branch alternatives, graph edits/deletion, equivalent/view-only renders, hidden/inactive/native background tabs, reduced/off motion, focus/retained settings, real CDP keyboard/drag, short/mobile layouts, unchanged actual deterministic local-run trace, and unconnected literal-mapped resource insertion with one undo.
- The narration case exercises the **shared-provider callback contract**, not physical microphone input or audible playback. No production provider, resource adapter, approval, deployment or Docker cutover is claimed by these checks.
