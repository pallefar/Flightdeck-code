# Next sub-app UI: Code / Inspect

## Delivered surface

An original Flightdeck **Command / Inspect** IDE, distinct from the workflow canvas. It inherits the Studio parent's Day/Night tokens through scoped aliases, including `--shadow`; Arial chrome and local system monospace need no fonts, packages or CDN. The identity bar names the actual candidate, version, round and draft/historical state. Sources, Changes, Preview and Checks remain linked, keyboard-navigable views. Execution is still shown only for actual reported diagnostics—not a decorative terminal.

- Compact command bar with a real **Focus** action. Focus gives source editing the explorer/walkthrough space while retaining their DOM behind `hidden`/`inert`. The Files action can exit focus and restore its existing search field.
- Focus makes only the presentation clock inactive: a newly accepted round received while focused is deferred until focus exits. It does not remove source editing, discard drafts, cancel generation or replay a round already shown.
- Searchable authoritative explorer, real tier counts, capped recent source tabs, Read/Edit, Save/Revert/Restore, file locks and real diffs keep their existing behavior. Visited source textareas, selection, unsaved buffers and the iframe remain retained across navigation.
- A bounded received-module disclosure can be collapsed independently of the walkthrough. Buttons have stationary accessible names and native hit areas; the animated faceplates are `aria-hidden` and pointer-transparent. Module groups and artifact counts come from the real received candidate.
- No entrance animation remains on source panes, editor wrappers, read views or explorer rows. Only decorative module faces and receipt text animate (200ms); control-color transitions remain 160ms. Source editing is immediately available. Reduced motion and ancestor motion-off still constrain the actual clock, not merely CSS.

## Truth and privacy boundaries

The always-visible status row states **Page/PANELS only · other pages source-only**. The current reader supports one emitted Page/PANELS module; additional web modules and PageDoc are not evaluated or invented. Supported page/section counts remain actual reader results, including zero when unsupported. Module placement is presentation of received artifacts, not generation progress, package installation, registry activation or host verification.

Preview retains exactly `sandbox="allow-same-origin"` and `allow="microphone 'none'; camera 'none'; on-device-speech-recognition 'none'"`. It is an `about:blank` parent React portal without scripts or generated-source evaluation. Its existing fidelity ledger still distinguishes real descriptor structure, mocked capability data and absent host behavior. The frame's deliberately separate light host-style approximation is not a Night-theme host-fidelity claim.

Checks and source annotations still describe the generated conformance snapshot; saving working-source edits does not rerun checks or change generated round history. Historical rounds remain authoritative/read-only. No model, adapter, deployment or privileged execution callback was added.

Workbench uses the existing shared voice bridge—no new production provider, orb or historical auto-narration. Narration contains only fixed technical/count/limitation synopses. Accepted scoped narration pauses the visual timer without cancelling the new utterance; explicit stop, close, editing, scope reset, native document hide and retained builder hide still cancel owned narration, including when visual playback was already paused.

## Composed short-screen regression — verified fix

The earlier isolated measurements below did **not** establish the composed chat + IDE fit. The real development route reproduced a **20px** source viewport during assembly at 1280×577, with its bottom below the workspace footer. A second RED caught the handoff toast covering source; the mobile RED caught wrapping chrome; a further RED caught Save introducing a footer and shrinking source to **135.66px**. These were native Chromium layout assertions, not stylesheet-only tests.

The fix keeps automatic assembly in a fixed-height, original real-group socket/faceplate rail. It still presents every received group in sequence; only that decorative rail scrolls to keep an arriving group visible. Full real modules and walkthrough are explicit, bounded inspection disclosures over the workspace, not newly stacked default chrome. Their close/playback controls remain available. The shell receipt uses a reserved header slot, so neither its arrival nor its six-second dismissal covers or moves source. Source actions use a horizontally scrollable, keyboard-focusable rail; Save's truthful generated-versus-saved delta stays there rather than adding a footer. Source font remains **12px / 1.7**, and Focus is never forced.

Final actual-route geometry:

| Native viewport | Workbench `(x,y,w,h)` | Read/Edit source `(x,y,w,h)` |
| --- | --- | --- |
| 1280×577 | `(370,172,894,389)` | `(595,363.84375,668,170.15625)` |
| 390×844 | `(10,279,370,553)` | `(11,614.4375,368,171.5625)` |

These exact source bounds stayed unchanged across automatic module assembly, Read → Edit, typing, Save and automatic handoff dismissal, with no source/footer overlap, handoff occlusion, font shrink or forced Focus. The default source remains unobscured; explicitly opening the inspection disclosure can intentionally cover part of it until closed.

### Reproduce RED / GREEN

Use the existing real composition-root DEVELOPMENT fixture (predetermined model outputs, **not** a live provider):

```sh
npx tsx src/studio/__tests__/ai-builder.fixture.ts
```

At the emitted origin, open `src/studio/__tests__/ai-builder-browser.html` in a native browser, set 1280×577 or 390×844, then run:

```js
await window.__aiBuilder.checkSubappSourceViewport();
await window.__aiBuilder.checkSubappInspectionRetention();
// Existing real routing/review/cancellation/private-scope acceptance:
// Run on a fresh fixture page:
await window.__aiBuilder.run();
```

The same `checkSubappSourceViewport()` command produced the original RED `Source is readable at 1280x577 during assembly: 20.00px >= 160px` before production edits. The final function additionally requires all real arriving groups to remain visible, containment, unoccluded source, stable dirty/saved bounds and selection/textarea identity. It is deliberately the composed route, not a Workbench-only mount. Long browser-tool launches must use `void ...then(...)` and poll a window result instead of accidentally awaiting a >5s IPC expression.

### Fresh checks / evidence

- `npm run test:vitest -- src/workbench src/voice src/studio --maxWorkers=2`: **459 passed / 44 files**. `npm run typecheck` and `git diff --check` passed.
- **12/12** actual composed cases: 2 native sizes × Day/Night × normal/reduced/off. **532 native geometry samples** and **412 case-scoped assertions**, deduplicated within each case. All four actual groups (Manifest, Server, Web, Tests) visibly arrived during each normal-motion run; reduced/off settled immediately without replay.
- Native CDP mouse/hit-testing, text insertion, Shift+Arrow selection, Cmd+S, 24 Tab steps per size, Focus return, real module source references, walkthrough scroll/Next/Escape/focus return and retained source/iframe passed at both sizes (**20 additional native checks**). This is browser input evidence, not only `.click()` assertions.
- The unchanged actual-route suite passed **57 unique checks / 9 explicit create requests**: typed routing, exact-context send review, dirty replacement, cancellation, real readback, private-source scope clearing and no automatic navigation requests.
- Existing isolated source-focus, architecture-tour and shared-voice-event browser regressions passed **7 / 33 / 7 checks**. Shared voice uses explicitly labelled DEVELOPMENT event ports; this is not a new acoustic/microphone claim.
- Parent-requested CSS changes select `button[data-primary-action=true]` for both primary and hover styling. Native entry proof shows **Set up connection** orange/right with disabled secondary Create and zero requests; after explicit fixture configuration **Create draft** becomes primary. No gating, automatic configuration or send behavior changed here.

Current evidence: `src/workbench/__tests__/evidence/composed-height/verification.json` enumerates the exact current contributors. `red-1280x577.json`, `red-handoff-occlusion.json`, `red-module-visibility.json`, `red-save-height.json` retain actual RED results. `matrix-final-*.json/png` supersede the intermediate matrix captures. `native-*.json`, `native-source-*`, `native-modules-*`, `native-walkthrough-*`, `primary-setup-*`, `primary-create-*`, `assembly-*`, `actual-route-contracts.json` and `legacy-*.json` contain the native/retention/assembly evidence.

Production changes for this fix: `src/workbench/components/ArchitectureTour.tsx`, `src/workbench/components/EditorPane.tsx`, `src/workbench/theme.ts`, `src/studio/StudioBuilder.css`. Regression additions: `src/studio/__tests__/ai-builder.browser.tsx`. This document and owned evidence were updated. No server, provider, package, deploy, host, voice-core or presentation-clock source changed; no commits or process shutdowns.

## Prior isolated-editor verification

Tests were observed RED before new command/focus, collapsible module and stable chrome changes. A real browser RED caught an accepted receipt continuing while Focus hid the presentation; the clock's active constraint fixes that path. The existing tour browser fixture was updated after reproducing its stale Pause/motion-off assumptions against the current lifecycle contract.

Commands run in `/Users/te451223/Flightdeck-code`:

```sh
npm run test:vitest -- src/workbench src/voice --maxWorkers=2
npm run typecheck
npm run build
```

- **16 focused test files / 285 tests passed**. Typecheck passed. Build passed with the existing large-chunk advisory; no production package or build configuration changed.
- **189 fresh browser assertions**, computed and count-checked from owned evidence—not borrowed release counts. This includes four Day/Night layout runs at **1280×577** and **390×844**, six source/focus/receipt runs, native keyboard/pointer checks, native speech and visibility checks, and the updated guided-tour harness.
- Desktop IDE root: `(16, 56)`, `1248×505`; default source read viewport `1022×234.42`. Mobile root: `(16, 56)`, `358×772`; default source read viewport `356×344.81`. Both remained inside their parent with no document horizontal overflow. Mobile source/workspace actions measured at least 44px high.
- Browser coverage exercised actual source selection/search, Save/Revert/Restore, generated-history preservation, stale-check notices, real diffs, retained textarea/selection/iframe, scriptless/recording-denied preview, unsupported saved-descriptor refusal and hidden/inert tab exclusion. Native Arrow/Home/End, Ctrl+S, Lock and Focus worked; 24 native Tab steps at each viewport never entered a hidden/inert descendant.
- A clearly labelled DEVELOPMENT stress candidate used frozen real route contents under 995 diagnostic paths, alongside the five original artifacts: **1,000 artifacts stayed exactly three typed pieces**, settled within four seconds and did not alter authoritative files, locks or execution history. This was not a live model completion.
- Actual browser synthesis used installed local **Daniel / en-GB**. Native start/end, paused visual playback and cancellation on builder exit were observed. Activating another real browser tab produced native visibility events `[true, false]`, cancelled owned speech/revoked consent and did not resume playback on return. These are native event/state observations, not an acoustic recording.
- The safe on-device availability probe returned **unavailable** for the language pack. No microphone session, download, remote consent or browser-managed fallback was started.
- No captured browser errors/unhandled rejections, generated-source execution or live provider calls.

The shared Vite server's full reloads erased fixture state during sibling edits. Verification was completed on the owned no-HMR config `src/workbench/__tests__/vite.fixture.config.ts`, loopback port 5182, with no API proxy. That temporary fixture process was stopped after capture; it is not production serving.

## Evidence and files

Production edits in this refinement:

- `src/workbench/Workbench.tsx`
- `src/workbench/theme.ts`
- `src/workbench/components/FileTreePane.tsx`
- `src/workbench/components/ArchitectureTour.tsx`

Tests/harnesses: `embedded-ide.test.tsx`, `premium.browser.fixture.tsx`, `premium.browser.html`, `vite.fixture.config.ts`, and the corrected `tour.browser.fixture.tsx`, all under `src/workbench/__tests__/`.

Evidence lives under `src/workbench/__tests__/evidence/`. `source-ide-verification.json` contains the programmatically aggregated totals and exact contributing files. Screenshots: `source-ide-desktop-day.png`, `source-ide-desktop-night.png`, `source-ide-desktop-night-modules.png`, `source-ide-mobile-day.png`, `source-ide-mobile-night.png`.

## Remaining acceptance

The composed short/mobile source-height gap is now covered by the real-route checks above, superseding the prior isolated-editor limitation. **Final merged full-suite, actual standalone entry/host launch and staging/Docker release acceptance remain parent-owned.** The existing parent-owned development fixture was left running; this fix did not restart or modify it. The frozen Docker service on 8790, host reference, providers, credentials and server/deployment source remain untouched. Dictation still needs a real local language pack; no live-provider, SDK harness, microphone, installed-host or release claim follows from this development fixture.
