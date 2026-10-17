# Parent integration checkpoint: modular workflow and native voice

> Historical checkpoint. The remaining integration/release work below was subsequently completed; see `studio-modular-voice-release.md` and `studio-verification-modular-voice-2026-10-14.json` for the final source, image, readbacks and explicit dictation/provider limits.

## Source integration now present

The actual `StudioApp` mounts one `VoiceProvider`, bound to a non-secret integer context epoch. Operator/project/model changes rotate its controller. Moving between authoring and Resources/Approvals rotates it too; ordinary chat/workflow/sub-app navigation retains it.

A compact state-reactive voice core and settings action live in the shared app bar. One retained native dialog contains the actual `VoiceControls`. This avoids a second starting-page panel and keeps controls reachable when mobile builders hide the conversation. Dictation appends bounded text to the existing 8,000-character composer and returns to chat; it does not submit or interpret privileged commands. Busy/setup states disable dictation. Closing stops owned activity; hidden/private-scope changes revoke opt-in through the provider lifecycle.

The workflow editor receives its real `active` state and the scoped explicit narration bridge. Workbench receives `active` and reveal-enabled accepted-candidate store semantics, and uses its existing shared voice hook. Accepted-draft handoff/reveal behavior for the composed sub-app still needs the combined real-route check after its consolidated delivery; do not infer this from standalone tour success.

`VoiceNarration` receives only fixed generic status/count summaries keyed by actual request/phase. It never reads prompt text, graph labels, imported skills, source files, approval context or connector payloads. Review, routing, saving, execution and deployment remain separate.

## Independently exercised

- Workflow unit tests: **108 passed in 15 files**.
- Parent modular browser checks: actual queued ghost/arriving plate/locked plate, 13 real head/port hit tests, stationary editing rectangles, unchanged graph/history, pause/skip and actual SVG dependency drawing.
- Maximum actual graph: **100 nodes / 99 edges / 12 groups**; parent observed final view at **2,170 ms**, below the unchanged 2,200 ms regression ceiling. This is received-view timing, not backend progress.
- Combined focused source integration: **153 tests / 24 files passed**, then typecheck/build/diff checks passed.
- Full host-aware source command: `FLIGHTDECK_HOST_ROOT=/Users/te451223/project-contract npm test -- --maxWorkers=4` — **2,982 Vitest tests / 208 files + 16 Node tests passed**, no reported failures/skips; typecheck/build/diff passed. This milestone preceded a subsequent focus-return guard and therefore is not an immutable final-release witness.
- In the actual composed development app, native local **Daniel / en-GB** speech transitioned from queued to speaking; the core's real speaking animation was `fv-orbit`. Native Stop cleared synthesis speaking/pending, and crossing the Resources scope required fresh opt-in.
- A separate stable native run kept opt-in after normal dialog Close, opened the explicit local workflow example, opened its real design walkthrough and invoked **Narrate current step**. Actual speech reached Speaking for **Step 1 · Manual trigger**, then stopped through the shared app-bar control.

No microphone or acoustic dictation was started. Recognition implementation/lifecycle tests and availability are not a claim of real audio transcription.

## Browser automation finding

The automated native Escape run changed `document.hidden` to true. Instrumentation showed a real visibility event, not a deliberate voice-off from normal dialog closure. The controller correctly revoked opt-in on hiding. Normal dialog Close in a foreground tab retained Idle and enabled native workflow narration; no privacy guard was weakened to make an automation assumption pass. Temporary prototype instrumentation was restored and is not production code.

## Evidence

Under `/Users/te451223/.hermes/cache/scratch/`:

- `workflow-modular-parent-results.json`
- `studio-composed-voice-native.json`
- `studio-guided-voice-native.json`

The recorded tests use actual source components. Generic request-count narration has a dedicated capture-seam SSR test; native audio evidence remains separate from callback/event doubles.

## Remaining release work

Read the pending consolidated sub-app/voice delivery, exercise both actual routed builders and their assembly through the composed entry, confirm source/voice privacy and native-modal/keyboard/mobile/reduced-motion behavior, re-run the final full suite on the exact completed source, then rebuild only the isolated private staging image with retained volume and exact existing-record readbacks. Frozen Docker staging and the companion/OS have not been changed by this integration. Public identity/TLS/live-model/recovery gates remain separate.

The current Vite build still reports its >500 kB advisory (this checkpoint: **680.55 kB** minified JavaScript); no performance benchmark or general security guarantee is implied.
