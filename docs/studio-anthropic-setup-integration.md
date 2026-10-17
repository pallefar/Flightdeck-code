# Anthropic in-app setup — composition-root acceptance

Date: October 15, 2026. **Source/build and corrected immutable-runtime engineering acceptance complete; now explicitly enabled in private Studio staging on port 8790.** Current cutover/readback and instructions: `studio-private-staging-release-20261015.md`. No real Anthropic key, selection or vendor call occurred. Browser operator sign-in was declined, so actual authenticated browser key-save and live-provider acceptance remain pending. Historical sections below retain their original execution scopes.

## Real server wiring

`createServer` now mounts `createAnthropicSessionSetup` at the existing composition root and retains its live registry facade for model listing, health, selection and authoring. It uses the existing operator-token predicate, not another identity or account system. Private key setup is enabled only by trusted `anthropicSessionSetup.enabled: true` or the exact process setting `STUDIO_ANTHROPIC_SESSION_SETUP=1`. Explicit `enabled: false` overrides that environment setting. Missing, `0` and `true` do not enable it.

The trusted constructor option excludes `baseRegistry` and `authenticate`; those remain owned by the composition root. The production bootstrap does not need a second authentication path. The endpoint's own canonical loopback/same-origin checks still apply; enabling the flag is not permission to expose it publicly.

The facade is not spread or cached. GET/POST/DELETE metadata and the authenticated model list therefore observe the same current session. Provisioning never selects Anthropic. Removal leaves the connection unavailable rather than restoring an environment key or falling back to another provider. Externally managed Anthropic connections remain read-only to this setup module.

During `preClose`, the root stops admission, synchronously closes/invalidates the session setup, then drains original tracked work. Delayed parsing cannot repopulate the closed setup. An already-sent request may still have remote effects or cost; rotation and shutdown cannot unsend it.

## Cancellation defect found and repaired

A new actual-HTTP composition-root shutdown test observed that the synthetic SDK received **no cancellation signal**. Tracing the path showed `admittedModel` correctly added the signal and `AnthropicProvider.complete` correctly forwarded one, but the intermediate `plannerLlm` bridge constructed a new request without it.

The minimized bridge regression failed on `undefined` versus the exact `AbortSignal`. The bridge now explicitly carries this optional trusted transport context into `provider.complete`, separately from model messages. It still constructs the allowed fields and does not spread arbitrary request properties. Both the bridge regression and the actual root shutdown test pass. A synthetic SDK deliberately ignoring abort keeps shutdown pending until its original promise settles; stale output is rejected afterward.

## Verification performed

Observed RED/GREEN integration slices:

1. The real root returned 404 rather than the required authenticated 401 on the opted-in setup path. Mounting the existing setup module and using its live registry passed the complete setup/list/explicit-create/removal sequence.
2. The exact environment opt-in returned 404 instead of 200 in an isolated child process. Adding the trusted startup flag passed absent/invalid/off/on and explicit-disabled-override cases without global environment mutation.
3. Actual root shutdown saw no SDK signal. The minimized planner-bridge test also failed; explicit signal forwarding made both green.

Commands and observed results:

```sh
npx vitest run packages/providers/src/planner-bridge.test.ts server/__tests__/anthropic-setup-composition.test.ts server/__tests__/anthropic-session-setup.test.ts server/__tests__/request-admission.test.ts server/__tests__/request-admission-composition.test.ts server/__tests__/model-route-integration.test.ts server/__tests__/model-destination-review.test.ts server/__tests__/readiness.test.ts --maxWorkers=2
# 8 files, 83 tests passed

npx vitest run src/studio --maxWorkers=2
# 29 files, 226 tests passed

npm run typecheck && npm run build && git diff --check
# all exited 0
```

The root suite contributes seven tests: the integrated registry flow, isolated environment-policy cases, the actual bounded browser client over sockets plus server reconstruction, fresh skill-send review after same-key rotation, original-work capacity after POST and DELETE, and original-work shutdown accounting. The real client uses its fixed relative path with a trusted test transport that forwards unmodified requests to the owned HTTP server; responses are not invented. Exact GET readbacks verify accepted mutations. Restart/reconstruction returns unavailable and a fresh revision.

The build produced `index-mc3jRDYp.js` (738.17 kB, 212.92 kB gzip) and `index-BuOWUG7p.css`; Vite's existing greater-than-500-kB chunk warning remains. This was not a final merged full-suite/release acceptance: other workers were still implementing separate changes.

## Built-app browser acceptance

An owned, loopback, environment-scrubbed development server imported the real `createServer`, served the actual built application and used a synthetic in-memory SDK client. No frontend request/response fixtures or Vite API proxy were substituted. Its diagnostics recorded **zero SDK calls** through loading, provisioning and explicit configuration refresh. One deliberately explicit model selection and Create action then reached the synthetic SDK once through the actual gated planner. Removal made no extra SDK call. Real vendor calls remained zero.

Parent evidence is durable under `docs/evidence/next-ui/anthropic-setup-parent/`:

- `http-flow.json`: **35 unique passing checks**, real setup/health/model-list/project-skills/create HTTP paths and zero captured runtime/unhandled-rejection errors during the observed flow. It proves no automatic metadata request on open, masked DOM-only input, immediate clear, exact real metadata transitions/CAS readback, no automatic selection/probe/create, manual refresh and selection, retained unsent text and editor/IDE DOM, and removal invalidation.
- `native-matrix.json`: actual Chromium Tab/Shift+Tab wrapping and Escape/clear/detach/exact-opener focus return at **1280×640** and **390×568**. Both modal rectangles and document widths fit the real viewport. Mobile content scrolls inside the bounded dialog.
- `removal-desktop.png`, `native-1280x640.png`, `native-390x568.png`: actual built-app captures. Masked content in native test captures is a nonsecret fixture string, never a user's key.

The first native harness attempt had a JavaScript selector quoting error before exercising the case. The corrected harness passed both sizes; that harness error is not represented as an application failure or an extra passing case.

## Independent review and targeted remediation

The combined read-only audit has now completed. It demonstrated no high-severity exploit in the reviewed session-owned setup path, while identifying **P2 external-key management/persistence disclosure** and **P3 composer/review ambiguity**. The original report, reproduction results and SHA-256-verified 34-file manifest are archived under `docs/evidence/next-ui/anthropic-setup-independent/`. Its snapshot check explicitly records subsequent changes; it is not approval of later fixes.

The parent's P2 backend/client repair keeps the exact five public keys but distinguishes session management (`available:true,persistence:'server-memory'`) from read-only external management (`available:false,persistence:'external'`). External retention/restart/storage/destination policy is not claimed here. External changes and ambient-header configuration refusal return fixed 403 policy refusals, not a reloadable 409 CAS conflict. GET accepts either strict variant; a successful mutation must return the owned variant and advance revision.

Observed RED/GREEN included the actual-root/client external metadata mismatch, two inconsistent 200 external mutation replies accepted by the client, and ambient-header refusal incorrectly classified as 409. Actual HTTP GET readbacks now preserve the exact external connection, descriptors, selection and revision after refused POST/DELETE, with zero SDK calls in that flow. Supplementary tests retain refusal even with a stale valid UUID and reject inconsistent/extra-field metadata.

The four-file full focused run passed **96 tests with no failures or pending tests**, including the original root/SDK/admission-shutdown regressions and the new cases; `parent-remediation-tests.json` is generated evidence. Typecheck, build and `git diff --check` also exited 0. The concurrent build emitted `index-DhphLFyx.js` (740.30 kB, 213.54 kB gzip) and the existing chunk-size warning. These are source checks, not a final merged release or proof of the still-in-progress UI changes.

## Parent P2/P3 UI and real-root recheck — October 15, 2026

The UI/controller builder has delivered. Parent reread the changes and independently verified all **10 manifest hashes**. Every composer edit now revokes the current skill-send acknowledgment through a monotonic epoch, including reversion and edits while a request is pending. Clarification and reviewed-send continuations retain the original epoch, request, answers and server hash. The retained transcript, result, Workbench, workflow editor and workspace are not reset by ordinary composer edits. Externally managed credentials render a read-only state with no credential/consent/mutation form and an explicit unknown destination/retention/restart disclosure; missing or disabled controls after metadata loading no longer leave native focus outside the open modal.

Parent execution passed **263 tests / 32 files**, followed by typecheck, build and `git diff --check`; the four new controller cases were also independently located as passed in the **3,289-case full pre-release report**. These are overlapping sets, not additive totals. The worker's `vitest run src/studio` command selects 234 cases / 30 files because substring matching also includes 17 spec cases; the physical `src/studio/` directory contributes 217 cases / 29 files. The current build remains `index-DhphLFyx.js` (740.30 kB, 213.54 kB gzip), with the existing chunk-size advisory.

Parent repeated **23 enumerated checks** in four evidence batches, with no captured page errors:

- Eight native composer checks against the actual Studio component with explicitly synthetic DTOs: typing, reversion, Clear, late response after pending edits/reversion, fresh unchecked review and exact explicit send. Retained transcript/result/Workbench/editor/workspace identities were checked. This is not vendor, server-hash-generation or acoustic evidence.
- Seven native external-ownership checks through the **current built app and an actual isolated composition root**: no request on open, one explicit GET per opening, truthful read-only state, native Tab/Shift+Tab wrapping, Escape/exact-opener return and containment at 1280×640 and 390×568. The two UI openings made only two setup GETs and no writes.
- Three separate negative real-HTTP checks: explicit POST and stale-revision DELETE both return fixed no-store 403; exact external metadata, revision, registry descriptors and selection remain unchanged; synthetic SDK/vendor/forbidden-socket counters stay zero. These deliberate negative probes are not attributed to the UI.
- Five owned-session built-app/real-root checks: explicit metadata load, acknowledgment plus one native Save POST, immediate fixture-key clearing with no automatic selection/send, exact configured readback, one native Remove DELETE and exact unavailable readback. Synthetic SDK/vendor/forbidden-socket counters remain zero. An initial harness confirmation lookup matched the closed voice dialog; it was corrected to the exact setup dialog without retrying the write or changing application code.

Evidence is `docs/evidence/next-ui/anthropic-setup-independent/parent-ui-*.json` and captures, summarized with source/artifact hashes in `parent-ui-remediation-verification.json`. Worker native cases and these repeated parent checks are not additive independent production proofs. Both newly owned HTTP roots and the Vite fixture were stopped; ports 58188, 58189 and 5298 refused connections, and the browser was released to `about:blank`. Exact staging/companion/OS container IDs, images and start times remained unchanged; staging health stayed `{ok:true}`.

## Independent remediation re-audit accepted — October 15, 2026

The fresh scoped recheck (`deleg_392f3f2a`) completed with **no remaining concrete finding demonstrated**: the original P2/P3 reproductions no longer succeeded. Parent verified all **16 recorded source hashes** against current code, matched the report/probe/test/execution/hash-manifest artifacts to their five reported SHA-256 values and copied all seven reviewer artifacts under `docs/evidence/next-ui/anthropic-setup-independent/reaudit/`.

The independent run passed **111 tests / 8 focused files**, with no failures or pending tests; parent also found all 111 cases passed in the latest 3,325-case full-repository report. The **nine independent probe groups** exercised actual composition-root injection, the bounded client, controller and StudioApp SSR: six permanent external mutation refusals with exact unchanged state; a 48-case ownership/status/revision client matrix; three accepted owned writes versus twelve genuine CAS conflicts; delayed transport/body and reviewed-send continuations; repeated clarification; caller/response mutation; and changed server skill content yielding a new hash rather than releasing old consent. These are overlapping focused tests and separately grouped probes, not additive production-security totals.

Parent then reran the same nine probe groups against current code, changing only the output destination. All passed with **zero native network attempts**, two synthetic SDK classifier calls and **zero skill-bearing model calls**. All 16 source hashes still matched afterward. The earlier native keyboard/focus/mobile/buffer-retention proof remains parent/worker evidence; the re-auditor did not use the browser or independently repeat it.

One parent harness transfer inserted redaction markers into the executable source text and caused a parse failure before assertions. The probe was restored by exact artifact-byte copy, patched only for its output path and checked for exact expected SHA-256 and valid syntax before the successful rerun; no production code was repaired or changed. `parent-check.json`, `parent-probes.json` and `parent-final-source-runtime.json` retain the resulting measurements and scope.

At that re-audit snapshot, this accepted bounded source/API/client/controller/UI remediation, not a live vendor completion, production identity/ingress, secret zeroization or release. Setup was still opt-in and undeployed; the later private cutover recorded above supersedes that deployment state. The temporary Docker/runtime availability blocker has since been cleared after the user restored Docker: `docs/evidence/next-ui/runtime-restored-readback.json` verifies healthy staging/companion/OS containers, retained exact IDs/images and changed restart timestamps, plus real health/static-asset readbacks. This is the old accepted deployment, not delivery or enablement of the new setup path. No shared engine or service was restarted by the agent.

## Remaining gates

- Source/API/UI remediation, parent native/root checks, independent recheck, corrected immutable candidate/runtime acceptance and private setup enablement are complete. The authenticated staging metadata route is verified; browser sign-in was declined and the real user-key/browser/live-provider flow remains pending.
- The user will enter a real key in the app when the accepted private deployment is ready. No test tool or chat should receive it. Real creation/review/save/run is not yet verified.
- Existing single-operator credentials do not establish Flightdeck OS database-backed session/project identity. That bridge and a real independently authorized reviewer remain separate.
- Server memory is not an encrypted vault and cannot promise immediate JavaScript/SDK zeroization. Only session-provisioned keys disappear on this module's restart; in-flight work may retain its original client until settlement. External credentials are unchanged and their retention/restart policy must be checked at their source.
- Model-egress, monotonic recovery authority, public TLS, harness production acceptance and acoustic dictation remain their own gates. These tests do not close them.
