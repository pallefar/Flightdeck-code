# Cinematic build reveal, guided tours and voice copilot

## User direction

Extend the real conversation → workflow/sub-app IDE experience with:

- motion as each received part is assembled into the view;
- a final step-by-step explanation of the actual workflow;
- corresponding framework/source/page explanation for actual sub-app candidates;
- contextual tips;
- opt-in voice dictation and spoken feedback, with an original Jarvis-inspired listening/speaking core that fits Flightdeck.

The primary product surface remains **Command / Inspect**. A guided **Learn** layer is secondary and dismissible; it must not replace editing or fill the workspace with decorative marketing cards.

## Non-streaming boundary

The current authenticated create API returns complete typed artifacts. It does **not** emit live node/file/tool-generation events. Therefore:

- While the request is in flight, show honest indeterminate requesting feedback.
- Once the server draft is received and its replacement guard is accepted, assemble/reveal actual received nodes/connections or source modules in a short, controllable sequence.
- Label this as received-artifact assembly or creation replay, not real-time model/tool progress.
- Replay/Skip/Pause controls must work; large graphs/file sets must not create long unskippable queues.
- If real incremental generation events are introduced later, bind motion to those authenticated events rather than invented timer milestones.

No animation or narration may claim a save, human approval, connector call, test execution, installation or deployment that did not occur.

## Workflow walkthrough

Derive the walkthrough from the current validated graph, edges and actual registry/effective configuration. Explain topological dependencies, both condition alternatives, independent-human pause semantics, mapping source kinds, connector configuration requirements and output behavior. Disconnected/unreachable pieces remain explicit rather than being silently omitted.

Highlight the explanation's current node and relevant connections. Explanation highlighting is visually distinct from real execution status. Do not manufacture payloads or branch outcomes. Native settings links reuse the existing mounted modal/forms; viewing/replaying a tour does not mutate positions, configuration, graph history, saved document identity or authorization.

Next/Previous, Play/Pause, Narrate, Close and Replay remain usable by keyboard. Stop stale tours on graph replacement/edits, inactivity or document hiding. Reduced motion gives an immediately complete topology and still permits manual step explanations.

## Sub-app architecture walkthrough

Use the actual candidate manifest, generated files and supported descriptors. Explain generated framework pieces, real routes/capability declarations, actual page/navigation descriptors, proposed host registration edits and supplied static checks. Source paths are real links into the retained editor, not fictitious terminal tasks. Unsupported descriptors produce a limitation notice, not invented pages.

Generated files are not installed packages. A proposed host edit is not an applied catalog registration. The existing descriptor mirror remains scriptless, and its mock-adapter/fidelity limits remain visible. Saved manual edits are not rechecked merely because a tour visits Checks.

## Voice contract

Shared module ownership: `src/voice/**`.

Exports agreed for integration:

```tsx
<VoiceProvider scopeKey={authorizedContextEpoch}>
  <VoiceControls onDictation={appendBoundedComposerText} disabled={busy} />
  <VoiceCore variant="compact" />
  <VoiceNarration id={actualNewEventId} text={safeShortSummary} active={authoringActive} />
</VoiceProvider>
```

`useVoice()` supplies at least `enabled`, `status`, `speak(text)` and `stop()`. An unprovided context is safely disabled. Voice feedback starts off; dictation starts only from an explicit user action and browser permission. Dictated text fills the composer for review and the existing explicit Send. It never runs voice commands for approval, deployment, execution, credentials or model selection.

Use real recognition and utterance lifecycle events to drive listening/speaking/error states. The core is a visual state indicator, not a claimed measured audio-spectrum display. No wake-word/background listening, automatic microphone opening or retained raw audio. Stop/disable/scope change/unmount/hidden-surface events cancel owned work and discard stale callbacks. Keep utterance queues bounded and interruptible.

Default to available on-device recognition/local-service synthesis. Missing language packs or unsupported APIs remain explicit. Do not auto-install packs or silently fall back to remote recognition/voices. Remote processing requires clear disclosure and separate explicit consent. Speak bounded generic status/tour summaries, not raw prompts, third-party skill packets, approval contexts, source text, credential references or connector payloads. Scope changes cancel speech/recognition and invalidate old consent/history.

The visual/tone reference is transformed into original Flightdeck orange/steel technical rings and calm narration, not a copyrighted character asset or an actor voice copy. Native voice quality and acoustic availability must be tested and reported honestly.

## Parent-owned prerequisite changes

The original built frontend denied microphone use entirely. The server now supports a narrow, trusted opt-in:

- `ServerOptions.productionVoiceInput?: boolean`;
- or exact `STUDIO_VOICE_INPUT=1` when the option is absent;
- explicit `false` overrides the environment;
- default/unknown environment values remain denied;
- only `/` and `/demo` documents receive `microphone=(self)` and `on-device-speech-recognition=(self)` after opt-in;
- hashed assets retain denial;
- camera/geolocation/payment/USB stay denied;
- script, connection, frame and form CSP remain unchanged;
- browser permission and app remote-service consent are still required.

The Workbench worker adds explicit microphone/camera/local-speech-discovery denial to the already scriptless preview iframe. No browser/model route can turn on the process-owned flag.

Two RED → GREEN cycles were observed for environment opt-in and explicit-false precedence. The latest focused run passed **27 tests across the production-asset and voice-policy files**. This is source-route evidence, not a rebuilt staging artifact.

A parent Studio-entry integration test is intentionally RED until the voice module is delivered and wired: `src/studio/__tests__/voice-integration.test.tsx` requires an accessible `Voice copilot` alongside the real composer. Do not treat this expected incomplete-integration failure as a previously existing baseline.

## Actual discovery / evidence

The real development browser on `http://127.0.0.1:5180/` reported a secure context, a recognition constructor with `processLocally`, static language availability support and speech synthesis, but **no synthesis voices in the initial query**. No microphone start/permission or acoustic transcription was performed by that probe. Constructor availability alone is not working voice input/output.

The current pre-voice source UI was captured at 1440×900:

```text
/Users/te451223/.hermes/cache/scratch/studio-cinematic-voice-before.png
```

Direct MDN browser reads verified the distinction between forced-local processing and browser-chosen local/remote processing, local-service voice flags and language-pack/policy availability. The extraction tool was unavailable because its configured backend supports search only; the browser supplied the actual document text instead. Sources:

```text
https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally
https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService
https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/available_static
```

## Combined release still required

1. Read delivered implementations and exact shared contracts; do not trust screenshots or a worker's success statement alone.
2. Integrate one scoped voice provider and real composer dictation, safe actual-event summaries and the retained visual core in `StudioApp`.
3. Pass active/build-reveal context into retained workflow and sub-app tours; no automatic execution.
4. Verify source privacy reset, hidden/inactive cancellation, actual guided/replay controls, dirty replacement, source/modal draft retention and reduced-motion behavior in the composed application.
5. Run the complete host-aware `npm test -- --maxWorkers=4`, typecheck/build and whitespace checks. No test exclusions or stale baseline claims.
6. Rebuild only the independent private staging image, preserve its volume and exact prior run/approval records, explicitly opt that staging service into voice input, verify production CSP/device-policy behavior and keep companion/OS untouched.
7. Separate native-acoustic results from injected lifecycle tests. If no real microphone/voice/language service is available in the test browser, report the boundary instead of calling acoustic functionality verified.

The new workers are asynchronous. Parent integration, the currently RED entry test and staging cutover depend on their delivery. Existing staging remains unchanged until combined verification is complete.
