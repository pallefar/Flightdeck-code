# Studio voice copilot

Implemented in `src/voice/`. No package, server, credential, provider, deployment or host changes are part of this module.

## Integration contract

```tsx
import {VoiceProvider, VoiceControls, VoiceCore, VoiceNarration, useVoice} from '../voice';

<VoiceProvider scopeKey={`${scopeEpoch}:authoring`}>
  <VoiceCore />
  <VoiceControls
    onDictation={appendPlainTextToComposerOnly}
    disabled={busy || !chatActive}
    active={authoringSurfaceVisible}
  />
  <VoiceNarration
    id={`accepted:${acceptedRequestId}`}
    text="A new workflow draft was received. Four blocks are ready for review."
    active={isNewlyAcceptedSafeReceipt}
  />
</VoiceProvider>
```

- `VoiceProvider({scopeKey: string, children: ReactNode})`: one provider for the retained authoring area. Use a non-secret authorization/project/model epoch, not a token, in `scopeKey`. Changing it immediately gives children a new off-state controller; layout cleanup invalidates and aborts old resources before the new scope can append anything. Off, hidden-document and unmount paths revoke remote consents. Ordinary workflow/sub-app/chat navigation can retain this provider. Resources/approval or authorization boundaries should change scope or make the surface inactive.
- `VoiceControls({onDictation, disabled?, active?})`: actual compact UI, `role="group"`, `aria-label="Voice copilot"`. `disabled` means composer unavailable/busy: it blocks and aborts dictation and discards late finals but allows opted-in, fixed safe status narration. `active={false}` means the entire voice surface is hidden/inactive: stops microphone and owned speech, resets opt-in and consent; returning does not restart. Default `active` is true. Keep only one set of controls per provider. Its unmount shuts down voice.
- `VoiceCore({variant?: 'compact' | 'standby'})`: shared actual-status core, 42px compact or optional 188px standby. It does not add a separate layout or overlay. Use compact in the single starting chat/header; standby exists only as an optional component/test demonstration. Outside a provider it is static/off.
- `VoiceNarration({id, text, active?})`: optional actual-event announcements, not a model call. Each ID is consumed before checking enabled/active, so enabling voice cannot replay older private history, nor can a StrictMode effect duplicate it. IDs are bounded to 200 characters and a 4,096-entry per-scope ledger; after the bound, new automatic announcements are suppressed rather than evicting/replaying old IDs.
- `useVoice()` returns at least `{enabled, status, speak, stop}` plus the passive current state. An absent provider is disabled/no-effects. Explicit guided tours or replay buttons may call `speak` with fixed safe instructional text. Enabling voice alone does not speak.

**Narration caller rule:** pass only bounded, safe actual counts/status/tour text. Never pass raw prompts, source files, skill context, approval details/tokens, credential identities, transcript history or connector payloads. The controller truncates speech to 500 characters and removes control characters; it does **not** claim that arbitrary input becomes non-sensitive through truncation. Parent composer appending must retain its existing length limits and must not invoke Send, run, save, deploy, approve or settings actions. Never mount dictation on credential/password or approval forms.

## Native behavior and privacy

Voice starts off and is memory-only. Passive mount discovers browser constructors, Permissions Policy and installed synthesis voices; it does not construct recognition, request microphone permission, call `getUserMedia`, record audio, download a pack, speak or call a model. No localStorage, raw-audio retention, transcript logging, wake word or background listener.

### Spoken feedback

- A real `getVoices()` local UK-English voice is preferred, then another local voice. No implicit null/default synthesis voice is used.
- Every utterance has an explicit native voice, language and rate. Voice and rate settings actually affect the utterance. Available choices are shown with language and local/remote processing labels.
- A remote-only voice is not selected automatically. Choosing a remote voice still requires a separate disclosure/consent checkbox before Test voice or safe feedback can speak.
- Test voice speaks one fixed neutral sentence, never the user's composer.
- Queueing is labelled `queued`, not Speaking. The actual utterance `start` event drives `speaking`; `end` returns Idle, `error` produces a fixed compact error.
- One owned utterance maximum. A latest safe short summary replaces the prior owned summary. A pre-existing foreign busy queue is refused, not cancelled. Owned queue start times out after 10 seconds; owned active speech is capped at 60 seconds. Stop genuinely cancels owned speech.
- **Browser limitation:** native speech synthesis has a global queue/cancel API, not per-owner cancellation. Flightdeck never calls cancel without an owned queued/active utterance, but an unrelated host component that queues during our owned utterance can still be affected by the browser's global cancel. This is disclosed in Voice options; host-wide audio arbitration is not claimed.

### Dictation

1. Enable voice explicitly.
2. Default processing is **on-device only**. Check dictation calls native static availability with `processLocally: true`, without constructing recognition or opening the microphone. Missing/downloading/downloadable packs produce truthful help. There is no automatic installation or fallback.
3. After availability resolves, press **Dictate again**. Recognition is constructed and started synchronously from this fresh gesture, with `processLocally: true` on browsers exposing it. Browser microphone permission still applies. Async availability never silently starts a mic after losing user activation.
4. If on-device support is absent, keyboard input remains available. The person can explicitly select **Browser-managed · may be remote**, acknowledge that audio may leave the device for the browser vendor, then explicitly press Dictate. `processLocally: false` leaves local-versus-remote selection to the browser; it does not force cloud processing or guarantee service support.
5. Listening is shown only after the native recognition `start` event. A non-authoritative interim preview is visible but is not appended. Native `resultIndex` and session generation deduplicate final result indexes; different final segments may append once each. Final plain text is bounded to 2,000 characters per segment, the result list to 128 entries, and interim text to 500 characters. Nothing is automatically submitted.
6. Recording is capped at 60 seconds, including pending permission/start. Stop uses `abort`, not a final-flushing stop; pending finals are discarded. No mute/stop/error/end path auto-restarts.

Scope change, voice off, provider/control unmount, inactive surface and hidden document invalidate generations **before** abort/cancel. Busy disables just the microphone path, including pending availability. Stale results and delayed availability responses cannot append or reactivate. Denied permissions, unavailable microphone/service, unsupported language, constructor failures and parent append failures produce fixed help/error text, not vendor details or raw exceptions. Policy-denied microphone and on-device APIs are distinguished from API absence and never prompt for permission.

The parent owns any explicit production microphone Permissions Policy opt-in. This module does not weaken CSP, enable microphones in preview frames or alter server configuration. Vite's permitted browser capability is not evidence that a production header allows capture.

## Visual and accessibility contract

Original Flightdeck orange/steel arcs, grid/reticle and small state bars; Arial and host tokens with inspected Flightdeck fallbacks. No actor imitation, custom copyrighted voice, imported assets or Jarvis branding. `.fd-voice` contains all module CSS; no `html`, `body` or `:root` reset. Core transitions/control effects are at most 100ms. Only real Listening/Speaking states run indicative arc/bar motion: this is **not measured audio amplitude**. Idle, off, queued, preparing and error are static. Status text remains useful without motion. Both `prefers-reduced-motion: reduce` and an ancestor `[data-motion="off"]` remove animations/transitions. Buttons/selects/summary have 44px targets and visible focus rings. Off-state hides unusable microphone buttons to keep the composer compact.

Self-audit: no tech-gradient/purple, hero/feature-card grid, fake metric, blur, stock imagery, default Inter or misplaced centered marketing composition. The independent module is a Command/Inspect surface. The large core in the DEVELOPMENT screenshot is a component demonstration, not the user's starting-page design.

## Verification — October 14, 2026

### Automated

RED failures were observed before each controller/UI/native-bridge slice and regression fix; injectable structural Web Speech ports are used because operating-system speech events cannot reliably be produced in Vitest. Tests cover actual controller behavior, not claimed acoustic transcription:

```sh
npx vitest run src/voice --maxWorkers=4
npm run typecheck
npm run build
```

Verified result: **33 tests in 4 files passed**, typecheck passed, production build passed. Build retains the existing >500kB chunk warning; no dependencies or build policy were changed. Earlier concurrent Workbench prop errors disappeared after that worker completed its implementation; the voice module did not edit their files. Parent's Studio mount test/final full suite and production release remain the parent's integration responsibility, not a voice-module baseline failure.

Coverage includes default off; local/remote consent; no fallback for all missing pack statuses; policy refusal; true start/end/error states; bounded queue/recording/results; multi-final dedupe; late-event suppression; stop/off/busy/disconnect/hidden; unavailable/disappearing voices; stale availability; safe event identity; callback exceptions; scope/StrictMode/browser DOM behavior and both motion opt-outs.

### Real native browser evidence

Fixture: `http://localhost:5180/src/voice/__tests__/voice.html` (native default). Named browser session: `flightdeck-voice`.

- Secure localhost, native recognition constructor, `processLocally`, native static availability and synthesis were present.
- On this actual local macOS browser, voices loaded: **180 local voices**; explicit selected output was **Daniel · en-GB · local**. This supersedes an earlier different browser probe that initially reported no voices; installed lists are runtime-dependent, never hardcoded in production.
- Native Test voice was clicked via actual browser mouse input with a user gesture. Observed real `off → idle → queued → speaking → idle`; native speaking screenshot captured. No injected speech events were used for these native results.
- A second native test verified reduced motion: all inspected ring/bar animation names were `none` while actual speech status remained Speaking. Real Stop returned Idle; native `speechSynthesis.speaking` and `.pending` were both false.
- Real local availability check reported the on-device language pack not installed/not ready. **No acoustic dictation success is claimed. No microphone start, remote dictation or download was requested.** The acoustic path is blocked until the person installs an appropriate browser-managed local pack through their own browser/OS process, or separately consents to and tests browser-managed recognition. No browser consistency guarantee is made.
- No uncaught errors or CSP violation events were observed. The Vite fixture response has **no CSP/Permissions-Policy header**, so this is not production CSP/header verification. Parent must verify its actual built mount and explicit production microphone policy separately.

Native evidence: `src/voice/__tests__/evidence/native-probe.json`, `native-availability.json`, `native-reduced-motion-stop.json`, `native-speaking-desktop.png`, `native-speaking-reduced-motion.png`, `native-dictation-availability.png`.

### Real browser DOM with explicitly injected event ports

`voice.html?mode=events` is visibly labelled **DEVELOPMENT / Injected event lifecycle — no audio or acoustic transcription**. Its controller uses fake external events solely for lifecycle/visual assertions; there is no production recognition substitution.

**16 assertions passed at each 1280×577 and 390×844 viewport.** No horizontal overflow, contained voice controls, 44px targets, no uncaught errors or CSP violations. Each run recorded one explicit injected start, one abort, one safe speech queue/cancel and one deduplicated append; late results after busy/scope changes were discarded. Scope reset disabled voice. Genuine active-state CSS motion changed from `fv-orbit` to `none` under ancestor motion-off. Bring the tab to front before running these checks: an obscured tab correctly refuses Enable voice, and treating that as an API failure would test the wrong lifecycle state.

Evidence: `events-desktop.json`, `events-mobile.json`, `ancestor-motion-off.json`, `mobile-contained.png`, `injected-listening-not-acoustic.png`, `injected-denied-error.png`, `injected-speaking-motion-off.png` under the same evidence directory. These are not live microphone or acoustic-transcription proofs.

### Files

Runtime: `src/voice/index.ts`, `Voice.tsx`, `controller.ts`, `ports.ts`, `browser.ts`, `voice.css`.

Tests: `controller.test.ts`, `browser.test.ts`, `ui.test.tsx`, `style.test.ts`; browser fixture and evidence under `src/voice/__tests__/`.

## Primary API references

Read directly from MDN during implementation; all are browser APIs with varying/experimental support, not Flightdeck guarantees:

- `https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally`: true forces on-device; false lets the browser choose. Missing pack/local support is not authorization to turn remote processing on.
- `https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/available_static`: local language-pack statuses and the `on-device-speech-recognition` policy gate. This implementation never follows an automatic install/fallback example.
- `https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService`: explicit local-versus-remote voice metadata.
- `https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisUtterance`: native start/end/error events and explicit voice/language/rate settings.
