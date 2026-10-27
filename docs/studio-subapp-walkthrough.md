# Received-artifact sub-app walkthrough

## Contract

This is a **Command / Inspect** surface inside the existing Workbench, not another product window or a generated application executing in Studio. The create API returns a complete candidate. The presentation therefore says **“Draft received · assembling source view”** while arranging already-received source modules, and **“Design walkthrough · not installed / no source execution”** afterward. No streaming file arrival, tool invocation, terminal output, progress percentage, dependency installation or host mounting is inferred.

The original orange/steel, Arial and mono-token design is retained. Small typed sockets become received module pieces through a 200 ms inner-face slide, shallow overshoot and settle. A placement accent marks completed pieces; it is not a dependency edge or a source lock. No LEGO branding, assets, toy palette, extra voice orb or global host styling is introduced.

## Parent integration

`WorkbenchProps` retains its existing required `store` and `onPrompt` and optional `onStop` / `hideChat`. New optional props:

```tsx
buildReveal?: boolean;                    // default false
active?: boolean;                         // default true
onNarrate?: (text: string) => void;        // optional explicitly enabled host override
onStopNarration?: () => void;              // optional host override
```

The normal integration needs only `buildReveal` and `active`. Workbench reads the shared `useVoice()` controller from `src/voice/index.ts`; without a provider, narration stays disabled. Keep the parent `VoiceProvider` scope-bound and render voice controls in the unified conversation, not a second Workbench voice surface. Callback overrides must retain the same explicit-consent and scope checks.

```tsx
<Workbench
  store={store}
  hideChat
  buildReveal={acceptedSubappCandidate}
  active={visibleArea === "subapp"}
  onPrompt={existingGuardedDriver}
/>
```

Do not add a round/view key or remount Workbench for ordinary navigation. Set `buildReveal` for an accepted actual candidate, not for a generation attempt or keyword match. Reset the existing store before project/actor/model scope changes. Pass `active={false}` while its retained parent area is hidden/inert.

### Receipt and replay semantics

- A previously unseen selected **latest round ID**, received while reveal-enabled, starts assembly once when its builder is active. A receipt reaching the retained hidden Workbench is deferred until the actual chat-to-IDE handoff; it is not consumed while hidden. Historical selection never auto-assembles or narrates.
- Enabling reveal later on an already-observed round does not replay it. Saving, typing, source selection, enable-layer changes and tab navigation do not trigger assembly.
- Receipt assembly groups actual manifest, server, web, test, proposed host-edit, standalone and other artifacts. Missing groups produce no invented piece. The default total timeline is capped at 3,000 ms regardless of file count; the 1,000-file regression proves this is not a per-file delay.
- Assembly does not change source selection. Every file remains available immediately. Module buttons open an actual representative source path and pause the presentation.
- Play, Pause, Next, Previous, Stop/Skip, Replay creation and Replay walkthrough are local presentation actions. They never call the model/driver or alter generated files, drafts, locks, run diagnostics or authorization.
- Play/Next/Previous deliberately select existing Sources/Preview/Checks views. Navigation rechecks the currently selected round and active state. Manual editing and source/tab input take priority over timed navigation, and an unmatched source is not highlighted.
- Hiding, native document backgrounding, closing, stopping, reset, historical selection and unmount cancel timers/stop narration. Returning to a hidden Workbench does not silently resume an already-started presentation. StrictMode cleanup leaves presentation paused, not falsely “playing.”

## Evidence and limitations

`src/workbench/walkthrough.ts::buildWalkthrough(candidate)` is a pure, non-executing index. It reads actual manifest literals through the existing `@codegen/testing/readEmittedManifest` reader, validates the consumed declaration shapes, and uses the existing `buildPreview` descriptor/runtime-fingerprint/route-scan readers. It does not introduce an evaluator, transpiler or broader page parser.

The walkthrough proceeds through:

1. Actual manifest identity/version and capability declarations. Declarations are not grants.
2. Actual route/guard/schema artifacts and declared role boundary. Missing guard/schema artifacts are explicitly named absent. Role visibility is not effect-time authorization proof.
3. The supported emitted page, actual navigation/role declarations, and any literal settings contribution. A settings declaration does not establish module presence or registration.
4. Actual PANELS sections, list/form request paths and field counts. “Route scanned” describes the existing limited source scan, not executed authorization or a live request.
5. Actual proposed host-edit artifacts, or an explicit absence. Nothing is applied.
6. Actual generated test artifacts and reported static rule IDs/findings. Test presence does not establish execution. Saved manual edits do not rerun checks.

Counts deduplicate exact received paths with first-path semantics. Source files exclude proposed host edits; standalone harness files and shims are identified separately and included in the source count. The manifest reader does not replace unsupported source with metadata. Missing/unparsable/drifted page descriptors get an explicit unsupported explanation and no invented sections.

**The current reader supports one emitted Page/PANELS module. PageDoc configurations and additional web modules remain source-only.** This limitation is displayed in the page lesson. Workflow-result page suggestions are not associated with the sub-app candidate or counted as its pages.

The existing fidelity ledger remains authoritative: structure/request descriptors are real, preview row data and success bodies may be mocked, SQL/host shell/Fastify lifecycle are absent. The frame remains an `about:blank` same-origin React portal with no source execution and exactly:

```html
sandbox="allow-same-origin"
allow="microphone 'none'; camera 'none'; on-device-speech-recognition 'none'"
```

No `allow-scripts` or global CSP change is added.

## Retention, accessibility and motion

Visited source editors now retain their own DOM, mode, selection and textarea buffer under hidden/inert source slots. Reference navigation does not discard a manual draft. Visited Preview/Checks/source panes and iframe identity remain retained across ordinary view changes. Scope reset removes the old candidate/tour/editor state.

Escape/Close returns focus to the real disclosure opener. Hidden module/reference controls are excluded from keyboard order. Modules remain stable interactive buttons; only their decorative inner face transforms. The disclosure has bounded height, scrolls locally, and does not consume an unbounded viewport row. Mobile module buttons were measured at approximately 109 × 59 px and the explorer remained hidden/inert after responsive transition.

Reduced motion and `data-motion="off"` remove animation/transition and immediately finalize received assembly. Timed Play is disabled while motion is off; manual step navigation remains available. Re-enabling motion never repeats the receipt. No camera scrolling, flashing loop or infinite animation is introduced. Actual browser measurement: normal `fd-module-snap` is `0.2s`; reduced motion is `none / 0s`; interactive button transforms remain `none`.

Narration is a fixed technical synopsis containing counts and limitations, never raw source, labels, prompts, field values, evidence strings or configuration/credential values. Enabling voice does not read an old candidate, and historical rounds never narrate. Native speech/microphone availability is a separate concern from this walkthrough's integration tests.

Accepted scoped narration pauses the visual clock without cancelling the newly queued utterance. The parent independently observed native Speaking on the actual routed sub-app page lesson with playback paused, then stopped it through the shared control. Real acoustic dictation remains unverified.

## Verification

Strict RED → GREEN cycles covered plan grounding, emitted-manifest versus metadata facts, unsupported/invalid declarations, duplicate paths, standalone shims, static rule evidence, playback/reset/historical/StrictMode lifecycle, 1,000-file timing, declined navigation, unchanged source exports, retained source editors, module sockets, descriptor highlighting and iframe recording denial.

Executed successfully:

```sh
npx vitest run src/workbench --maxWorkers=2   # 245 tests, 12 files
npm run typecheck
npm run build
```

The build retains Vite's existing large-chunk warning; no dependency or bundling policy was changed.

Real Chromium evidence totals were counted and validated programmatically:

- 63 existing Workbench assertions: 21 each at 1440×900, 1024×650 and 390×844.
- 90 modular-tour assertions: 30 at each viewport, including reduced motion at 1024×650.
- 7 actual shared-voice-controller integration assertions with explicitly labelled DEVELOPMENT event ports, not native audio/microphone claims.
- 4 native CDP keyboard assertions for Escape, forward/reverse Tab, and Enter activation.
- Zero browser error-event reports in the completed runs; zero model callback invocations during walkthrough checks.

Parallel HMR initially erased desktop window-held results. Final desktop/legacy diagnostic runs froze only Vite HMR update/full-reload messages in the isolated fixture tab; application code, normal interaction, the server and generated-source security were unchanged. The diagnostic script was removed afterward. Native Enter verification used the complete CDP key data including Enter text; a bare incomplete key event did not activate the button.

Machine evidence and inspected screenshots are under `src/workbench/__tests__/evidence/`:

- `existing-browser.json`
- `modular-tour-browser.json`
- `shared-tour-voice.json`
- `native-keyboard.json`
- `subapp-modular-received-desktop.png`
- `subapp-modular-received-mobile.png`
- `subapp-guided-page-desktop.png`
- `subapp-guided-page-reduced.png`

These worker checks use existing frozen real generator output, not a live model/provider generation or an installed host. The parent subsequently verified the actual chat handoff, added regression tests for deferred receipt/motion/narration, passed the full 2,986 Vitest + 16 Node tests, and updated only private staging. Current artifact evidence: `studio-modular-voice-release.md`. No package, server, provider, Docker, host, credential or global CSP changes were made by the original sub-app worker.
