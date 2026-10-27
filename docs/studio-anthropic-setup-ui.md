# Anthropic session-key setup UI

## Scope and release boundary

This change adds a private session-key setup action inside the existing **Project & model setup** disclosure. The default Command/Inspect layout stays closed and unchanged. It does not add a shell area, an account, a database, host identity integration, a deployment switch, or a model request. Existing operator-token/project state is reused; the operator field still says **Never enter a model API key here.**

**Not enabled or deployed by this work.** Combined verification against the new real backend, independent security review and any private staging enablement belong to the parent integration task. The browser responses described below are explicitly nonsecret DEVELOPMENT fixtures, not evidence of working Anthropic credentials, a vendor completion, host DB reuse or durable persistence.

## Explicit interaction

1. Open Connection settings. This performs no network request.
2. Supply the operator credential in its existing field, then choose **Anthropic API key setup**. Opening the native dialog also performs no network request.
3. Choose **Load setup status** to authenticate and load public metadata. Disabled/private-unavailable/authentication states use fixed messages. If metadata says **Externally managed**, this dialog exposes no credential field, acknowledgment, Save or Remove form: change/remove at its source. Destination, credential retention and restart policy are unknown here; session-memory promises do not apply.
4. For a session-owned connection only, enter the key in the masked field. A fresh checkbox discloses that a key saved here remains in **server memory until restart**, is then lost, and saving **does not call a model**. Before metadata loads, any lifetime/destination copy is explicitly conditional on session ownership.
5. Save or explicitly remove the session key. No automatic model selection, metadata fetch, connection check or draft submission follows either mutation.
6. Close the dialog, explicitly **Check connection & project skills**, then select Anthropic. Even an explicit server Anthropic default is suppressed after a key mutation until a model is chosen again.

Key setup is unavailable without the existing operator token. A project ID is not required to load setup metadata; it is still required by the existing project-skill connection check. Configured remains **not-probed**, not proof of a live vendor connection.

## Browser API exports

`src/studio/anthropic-setup-client.ts` exports:

- `AnthropicSetupClient(fetcher?: typeof fetch)` with `load(token, context)`, `save(token, apiKey, expectedRevision, context)` and `remove(token, expectedRevision, context)`.
- `AnthropicSetupRequestContext`: `{signal: AbortSignal, isCurrent: () => boolean}`. Callers must abort on scope changes as well as advance their current epoch.
- `parseAnthropicSetupMetadata(value: unknown)` and the `AnthropicSetupMetadata` type.
- `AnthropicSetupError`, whose `code` and `message` are fixed safe categories, never raw server/transport data.

All requests use the fixed relative path `/api/studio/model-connections/anthropic/setup`, bearer auth, `credentials: 'omit'`, `redirect: 'error'`, and `cache: 'no-store'`. There is no destination/model override or write retry. POST sends exactly `{apiKey, expectedRevision}`; DELETE sends exactly `{expectedRevision}`.

GET accepts exactly five keys with either `{available: true, persistence: 'server-memory', model: string, status: 'configured' | 'unavailable', revision: UUID}` or `{available: false, persistence: 'external', model: string, status: 'configured' | 'unavailable', revision: UUID}`. External metadata is valid only for GET; successful mutation confirmations must be session-owned. Model text is bounded to 1–200 characters and refuses controls, line separators, URL/URI forms, `sk-` and `Bearer` text. The client reuses `readStudioJson` with a **4096-byte** cap through an abort/epoch-aware stream wrapper; it cancels rejected/aborted streams without waiting indefinitely for the source's cancellation promise. Abort/current checks occur before and after the transport and each stream read, after the bounded reader, and before UI acceptance/callbacks.

Credentials are accepted at 1–8192 characters, single-line, without control/format characters. They are preserved exactly, with no trimming or normalization. Input validation is not a claim that the vendor accepts the credential. UUID CAS is required before each write; stale revisions get a fixed conflict message. Permanent setup-policy refusal (403, including external ownership) is `Setup request refused.`, not a reload/CAS conflict. POST must confirm `configured`; DELETE must confirm `unavailable`; both must advance revision. Inconsistent or malformed success DTOs remain uncertain, not successful.

## Secret and lifecycle handling

`AnthropicConnectionSetup` exports its props type and the integrated component. The key input is uncontrolled: no key value in React state, props, value/defaultValue attributes, callback metadata, controller observers, transcript, preview frames, ARIA announcements, history, URL, localStorage or sessionStorage. Only a boolean input-presence flag is stored. It is masked and uses autocomplete/autocorrect/capitalization off and spellcheck false.

The captured actual DOM input is cleared immediately on submission, close, Escape, operator/project/provider context replacement, app navigation, pagehide/history navigation events and unmount. Closed/inactive modal input DOM is removed, not retained hidden or inert. Transport request buffers necessarily carry the submitted credential; JavaScript strings and browser/network internals cannot be securely zeroized, so this is not a memory-erasure, vault or encryption guarantee.

A synchronous busy ref blocks double submission. Closing aborts client acceptance; it cannot promise that an already received server change was undone. Mutation uncertainty survives closing/reopening. After failure, conflict, cancellation or malformed confirmation, writes stay blocked until a separate explicit **Load setup status** succeeds. No mutation retry is automatic.

At mutation start, and again after a current confirmed success, `StudioApp` calls the existing `invalidateContext(true)`: old generations and block requests are aborted, skill-send review and retained private Workbench state are cleared, and connection descriptors/selection are invalidated. Unsent composer text, operator/project values and retained editor DOM/document identity are preserved. Voice scope is rotated and owned activity stopped on open; voice/dictation and status narration are inactive while the modal is open. No sensitive setup text is routed to voice.

The modal uses native `showModal`, explicit Close and Escape, live enabled-control Tab/Shift+Tab wrapping and exact-opener focus return. It ignores a queued StrictMode cleanup `close` event when the native dialog has already reopened.

## Verification actually executed

- Strict RED/GREEN verticals: missing parser; unsafe metadata; fixed-route client; sanitized write/input error boundary; late/aborted response acceptance; integrated SSR launcher; missing browser modal; Unicode/URI rejection; pagehide clearing; native Tab wrapping. Browser privacy-flag test was corrected to account for Chromium reflecting the `autocapitalize="off"` attribute as the `none` property value.
- `npx vitest run src/studio --maxWorkers=2`: **29 files, 226 passing tests**, including **52** new client/SSR tests.
- `npm run typecheck`: passed (`tsc --noEmit`).
- `git diff --check`: passed. The checkout was already dirty; no commit, package change, backend edit, deployment or service restart was performed here.
- Owned no-HMR loopback browser fixture: **48 unique passing assertions**, zero captured JS errors. It covers no automatic fetch, no model selection, DOM-only credential handling, acknowledgment, save/remove, double-submit, late write and old-generation suppression, uncertainty recovery, conflict/raw-error/DTO rejection, two context invalidations, voice reset, context/navigation/pagehide/unmount clearing, and preserved prompt/editor DOM. One deliberately seeded fake pending generation tests invalidation; it is not a vendor call.
- Native Chromium Tab/Shift+Tab, Escape, cleared detached field and focus return passed at **1280×640 Day**, **1280×600 Night/reduced motion**, **390×720 Day/reduced motion**, and **390×568 Night**. All modal rectangles and page widths were within the actual viewport.
- Default, uninjected native browser fetch reached an owned static **404 fixture** using a nonsecret operator sentinel, proving receiver-safe transport rather than an illegal invocation. It did not reach the new backend.

Browser entries: `src/studio/__tests__/anthropic-setup.browser.html` and `.tsx`. Run `runInitialSetupChecks()`, `runSecuritySetupChecks()`, `runNavigationClearChecks()`, then `unmountClearCheck()` from `window.anthropicFixture` on a dedicated no-proxy fixture origin. `runSecuritySetupChecks` requires an owned static 404 handler at the setup path for its default-native-fetch assertion. The main app never imports these fixtures.

Temporary, nonsecret execution evidence and native screenshots were written to `/Users/te451223/.hermes/cache/scratch/anthropic-ui-evidence/` (`complete.json`, `navigation.json`, `security.json`, `native-matrix.json`, `native-matrix-red.json`, `modal-*.png`). Scratch evidence is not a durable release record. Only the owned fixture server was started and it was stopped after verification; shared 5180/8790 services were untouched. An additional full-owned-file whitespace scan found only the pre-existing whitespace-only StudioApp blank line (now line 149); no new-file or appended-rule whitespace issues were found.

## Resolved QA findings

| Finding | Severity / category | Reproduction and observed result | Resolution / evidence |
| --- | --- | --- | --- |
| Native Tab traversal left document focus outside the modal | Medium / accessibility | On the isolated fixture, open setup and press Tab past the final enabled control. Native modal inertness prevented outside interaction, but document focus moved out of the dialog. | Added enabled-control edge wrapping for Tab/Shift+Tab. `native-matrix-red.json` records the failing result; `native-matrix.json` records the passing keyboard matrix. |
| Pagehide retained the typed field | High / privacy lifecycle | Type a nonsecret sentinel, dispatch the fixture's `pagehide` event, and inspect the retained field reference. The initial implementation left its value and modal mounted. This was an event-lifecycle test, not a real BFCache navigation. | Added pagehide/popstate/hashchange close/clear/abort handling. `complete.json` proves cleared detached input references for navigation and unmount. Real BFCache behavior is not independently verified here. |
| StrictMode cleanup could close the newly reopened native dialog | Medium / functionality | Repeated StrictMode fixture openings intermittently lost the modal when the previous layout cleanup's queued native `close` event arrived after `showModal`. | Ignore a queued close event when the dialog is currently open. Repeated happy-path and native matrix checks pass. |

No unresolved UI failures were observed within the stated fixture scope. Real backend, host identity, vendor acceptance, acoustic voice behavior and actual BFCache integration remain outside that proof. Modal screenshots are in the scratch evidence directory listed above; the native short/mobile Night screenshot also confirms bounded modal scrolling rather than clipped page-wide overflow.

## Parent integration acceptance — October 15, 2026

Parent reread the delivered UI/client/StudioApp/CSS, independently reproduced the **226 Studio tests / 29 files**, and exercised the actual built application against the real enabled composition root with an isolated synthetic SDK. **35 unique real-HTTP browser checks** and **2 native viewport keyboard/clear/focus cases** passed. Exact GET readback confirmed provisioning/removal; setup and configuration refresh made zero SDK calls, and only an explicit selected Create reached the synthetic SDK once. No real key or vendor call was used. The parent also found and repaired the planner bridge's dropped cancellation signal; the broader integration run passed **83 tests / 8 files**. Details and limits are in `docs/studio-anthropic-setup-integration.md`.

Worker JSON evidence is now archived under `docs/evidence/next-ui/anthropic-setup-worker/`. Parent parsed and deduplicated the cumulative reports: complete 48, navigation 28, security 37, **48 unique checks total**, not their sum. All four worker native matrix cases passed; the original native RED evidence is retained separately. These fake-response fixture checks remain distinct from the parent's actual HTTP server checks.

## Remaining release gates

### Independent-audit P2 UI correction — October 15, 2026

The native browser first reproduced the incorrect external ownership/lifetime display with the parent's real updated client parser and a clearly labelled deterministic external DTO. `docs/evidence/anthropic-external-p2/red-native.json` and `.png` retain the RED result. The UI now shows **Externally managed — session setup unavailable**, directs changes/removal to the source, marks external destination/retention/restart policy unknown here, and removes the complete credential/acknowledgment/Save/Remove form. Imperative save/remove functions also require `metadata.available`; read-only ownership is not enforced only through disabled controls. Conditional session-only copy remains before load and for owned metadata.

Loading external status exposed a native focus loss when the busy Load button became disabled. The recorded RED is `red-focus.json`. After explicit metadata settlement, a layout effect restores focus inside the still-open modal if native disabling/removal left it outside. Native Tab/Shift+Tab edge wrap, Escape and exact-opener focus return then passed; the full external run contains **10 labelled UI assertions**, recorded separately from its native-keyboard assertions. It made **one explicit fixture GET, zero writes/model calls/retries**, retained composer/editor DOM and left the external revision unchanged. These are browser-only fixture results; parent owns the separate actual HTTP external root/client/SDK proof.

Existing owned setup browser paths were rerun: initial → security → navigation → unmount. Cumulative reports contain **48 unique assertions**, not 18 + 37 + 47 + 48. The default native transport reached an owned static 404 fixture with no API proxy. Evidence is durable under `docs/evidence/anthropic-external-p2/` (`owned-initial.json`, `owned-security.json`, `owned-navigation.json`, `owned-unmount.json`, plus external RED/GREEN JSON/PNGs). Current combined scoped verification was **30 Studio files / 234 tests passed** and `tsc --noEmit` passed. This scoped total includes the P3 regressions and parent's updated setup cases; do not add prior subset totals.

The separate P3 correction is documented in `docs/studio-review-composer-revocation.md`. No real credentials/vendor calls, API setup implementation, dependency changes, deployment or shared-service changes were performed by this UI worker. The owned no-HMR/no-proxy port-5298 fixture is stopped before handoff; final shutdown proof is in the evidence acceptance record.

- Independent combined security review, the final merged suite and candidate-image/private staging acceptance remain required before enablement. UI ownership and implementation are returned to parent; this is not a deployed feature.
- Verify actual app/host identity integration separately. This UI neither creates nor migrates the FlightdeckOS account/database identity.
- Real credentials must be entered by the person inside the app or their approved credential UI, never chat or test tools. No real API key was used here.
