# Private Studio update — October 15, 2026

> Superseded live-image status — October 17, 2026: private Studio8790 has since been updated to the reviewed authoring image `e9a04ab6…`, retaining the original private volume and all existing records. See `studio-authoring-private-release-20261017.md`. The5029 image and evidence below remain historical/rollback provenance, not the current live image. The companion and Flightdeck OS were not changed.

> Subsequent first-version work: the actual private runtime now has an explicit machine-local public-CA override and a successful TLS-only Anthropic transport preflight. See `studio-runtime-tls-v1.md`. The immutable app image and original state are unchanged; the earlier cutover evidence below remains historical. New first-test helper, encrypted-backup and authoring-broker source work is undergoing separate acceptance, not implicitly covered by this image's earlier tests.

## Current delivery

**Private staging is updated and verified at `http://127.0.0.1:8790/`.** This is a local evaluation deployment, not public production or Flightdeck OS identity integration.

The user's subsequent **“continue and finish”** direction was applied to the pending private update and the previously requested in-app Anthropic setup. The earlier canceled choice remains an accurate historical event; it was not retrospectively converted into a selection. Only Studio staging was replaced. The companion and OS were not restarted, reconfigured or mounted into Studio.

- Actual running image: `sha256:5029e89247bb09d1340f23ba4440e80f4521cd8ff05c2f939588ff7a07e0bbaf`.
- Build tag: `flightdeck-studio-staging:combined-focusfix-candidate-20261015`.
- Compose now pins that immutable local image ID and explicitly sets `STUDIO_ANTHROPIC_SESSION_SETUP=1`. Every other normalized Compose field is unchanged.
- The original `flightdeck-studio-staging_staging-private` volume is retained. All four private files' complete bytes, names, owner/group and modes match their pre-update inventory. A read-only witness was taken while the sole volume writer was stopped.
- Both existing drafts, both original runs and their history read back exactly through the authenticated API. The completed run remains completed; the paused run remains nonresumable. No saved run or external effect was replayed.
- Loopback-only publication, UID/GID 1000, read-only image, dropped capabilities and no-new-privileges remain enforced.
- The host identity bridge remains disabled and unmounted. No reviewer grant, model selection, provider key or automatic model request was added.

## Verification

The image's 756 build inputs still match the accepted frozen source ledger. Its earlier whole-source acceptance is **3,340 Vitest cases / 233 physical files plus 30 Node tests**, followed by successful typecheck/build/diff checks. The independent modal critique and actual-image runtime/persistence checks are recorded in `studio-modal-focus-remediation.md`; these historical executions were not relabeled new independent release tests.

For this actual staging cutover:

- Re-ran **85 focused setup tests / three files** and **30 Node Docker/bootstrap tests**, all passing. These overlap earlier full results and are not additive totals.
- Compared real served HTML, JS and CSS bytes against the running image. The browser loaded `index-B7Cx5YFX.js`.
- Repeated **12 native modal labels** across 1280×640 and 390×568: reachable whole-card double-click, containment, forward and backward boundary wrapping, native interior Tab, and Escape/exact-card focus return. No captured page or CSP errors and no API requests occurred in that modal probe.
- Verified the actual chat-first entry at both sizes, one main landmark, no horizontal document overflow, masked operator field, disabled authoring/setup without credentials and no selected model.
- Executed the real built-in conditional example locally with `{"approved":true}`. It completed with that exact output, without a backend request, model call or saved server run.
- Re-read the original authenticated records and private inventory after browser testing. The existing companion/OS IDs, images and start timestamps remained unchanged.

One browser IPC wait timed out after the desktop Escape had already completed. Existing results and actual focus were read back before continuing; this was not an application failure or a replayed effect. The secure-login prompt left the browser on a different origin after decline; the real app was explicitly restored before subsequent checks.

## Entering a real Anthropic key

1. Open **Connection settings**.
2. Supply the existing **Studio operator token** in its masked field and choose the intended project. This is not the Anthropic key and does not establish host workspace access.
3. Open **Anthropic API key setup** and explicitly load its metadata. The actual authenticated route now reports `available:true`, `persistence:'server-memory'` and an unavailable, unconfigured connection.
4. Enter the Anthropic key only in that masked in-app setup, review its memory-only disclosure and explicitly save it. Do not put it in chat or the operator field.
5. Refresh configuration and explicitly select Anthropic before choosing to create a draft. Exact-context review, saving and saved-revision execution remain distinct actions.

No Studio browser login was saved; the secure operator-login prompt was declined. No further credential prompt was issued. Consequently the **authenticated browser key-save flow and live provider creation/review/save/run remain unverified**. Authenticated setup metadata and preserved records were verified inside the staging container without exporting credentials. No real provider key was supplied, no model was selected and no vendor request was sent. Session-provisioned keys are lost on server restart; memory is not a persistent encrypted vault or a promise of immediate zeroization.

## Remaining production boundaries

Private update completion does not complete live Anthropic acceptance, remote vendor TLS, OS session/CSRF/action-policy integration, real independent reviewer assignment, full recovery/anti-rollback operations, harness adoption or acoustic dictation. Their deny-default restrictions remain in place. The new image includes the accepted deny-only recovery bootstrap guard, not a full restore system. The evaluated agent harness remains uninstalled and its production acceptance cases remain unrun.

No commit, push, public publication, host launcher/data/permission change or OS/companion deployment occurred.

## Evidence

`docs/evidence/next-ui/private-staging-cutover-20261015/` contains the acceptance record, normalized configuration RED/GREEN checks, stopped-writer inventory witness, before/after/final service metadata, authenticated nonsecret record fingerprints, exact asset hashes, structured focused tests, Node TAP, native browser results, local-run result, captures and checksums. Private credential and record bodies are not exported.

The old Command/Inspect image and prior Compose text are retained for a service-only rollback if needed. No rollback or data restore was performed. Never remove or replace the private volume as part of an image rollback.
