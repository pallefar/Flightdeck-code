# Private staging evaluation

## Current private deployment — October 15, 2026

Studio at `http://127.0.0.1:8790/` now runs the verified corrected combined image `sha256:5029e89247bb09d1340f23ba4440e80f4521cd8ff05c2f939588ff7a07e0bbaf`, with explicit in-app Anthropic setup enabled. Original private files, both drafts and both runs match exactly; the companion/OS remain unchanged. The bridge stays disabled and no real provider key, selection or call was made. Browser operator sign-in was declined, so the user-authenticated browser/live-provider flow remains pending. Current acceptance and entry instructions: `studio-private-staging-release-20261015.md`.

The remaining sections preserve earlier evaluations; their image identities and counts are historical, not the current deployment.

## Earlier modular-voice artifact — October 14, 2026 (superseded)

Staging now runs `flightdeck-studio-staging:modular-voice-final-20261014`, image `sha256:dbb044500ad9c7963cb17b7887bee7bb550ce59fc8899cdb9f77ccd22f944cac`. Both root and demo start on one chat-first page. Accepted workflow/sub-app drafts open their separate retained builders, with real received-artifact modular assembly, guided explanations and opt-in voice.

The final host-aware test entry passed **2,986 Vitest tests / 208 files + 16 Node tests**, typecheck/build/diff checks passed, and the composed route regression passed 51 assertions. The exact rebuilt runtime has 63 locked application packages and zero known runtime npm findings. Parent native narration, local deterministic execution, desktop/mobile entry and exact original-record readbacks passed. The private volume, CSP, companion and OS are unchanged. Actual dictation remains unverified because the tested native language pack was unavailable; no microphone/download/remote fallback was attempted.

Current details and exact artifact evidence: `studio-modular-voice-release.md` and `studio-verification-modular-voice-2026-10-14.json`. Start with **Open workflow example → Explain workflow → Replay creation**. Live AI creation still needs a configured model. The remaining public identity/TLS/reviewer/recovery gates have not been removed.

### Earlier full-green engineering artifact — superseded

The former `flightdeck-studio-staging:verified-20261014`, image `sha256:53ce57e036909d5ac4330255b519569971a32f40daea1515e1b8066f2f2debfc`, passed **2,864 Vitest tests in 186 files and all 16 Docker Node tests**, with zero failures/skips. Typecheck, production build and diff checks passed. The three historical manifest failures were resolved through bounded non-executing live-host core metadata projection; strict generated-manifest admission remained unchanged. This did not establish full host boot or callback correctness.

The final image was rebuilt, physically verified and audited again: 63 locked production application packages, no unnecessary dev tools/source tests, zero known application npm findings. The real staging browser rendered the four-area UI; original mapped-run and unavailable-approval snapshots matched after recreation. The companion and OS remained unchanged. Detailed exact commands, source snapshot witness, image and remaining release blockers: `studio-verification-2026-10-14.json`.

The remaining sections preserve earlier layout/hardening verification history. They are not the current artifact identity unless explicitly stated above. The old implicit demo graph entry was superseded by the explicit chat-first example action.

**Evaluation URL:** `http://127.0.0.1:8790/demo` on this Mac only. This is a loopback-only Docker staging candidate, **not a production release**. It uses built frontend assets and the real API on one origin; Vite is not running inside it.

## What to try

- Use **Blocks** to reveal categorized/searchable blocks. Click to insert or drag onto the canvas.
- Use **Inspector** after selecting a block; double-click a block or use **Open block settings** for the native modal.
- Change Expanded/Compact display and use **Fit to graph**. These are view operations, not graph saves.
- Open **Local execution input & trace**, enter `{"approved":true}`, then **Run locally**. The conditional template takes its accepted branch. The boolean is routing data, not human approval evidence.
- Switch among AI builder, Workflow editor & demo, Resources and Approvals. The editor stays mounted; navigation does not save or execute anything.
- **Document** contains import/export and new-document actions. Replacing edited content requires confirmation.

Local editing and deterministic local runs need no backend credential. Backend save/history require the existing sign-in boundary and a project. No browser sign-in provisioning was added by this layout pass; do not paste server/model keys into chat. The staging private volume and generated operator credential are separate from the existing companion. No credential was copied from the companion or OS.

## Verification performed by the parent

- Reproduced nested `<main>` landmark failure with a regression test, changed the editor's internal wrapper to a neutral div, then passed the test. The built staging DOM has exactly one main landmark.
- **81 focused tests passed** across shell/editor/imported workflow contracts; typecheck, actual TypeScript/Vite production build and diff checks passed.
- Rebuilt the initial layout image `flightdeck-studio-production-check:local`; tagged that snapshot as `flightdeck-studio-staging:layout-20261014`. Initial image ID: `sha256:28dc2d9c74ae7a5093f334f2d7dc4ea26742e3b0585d31dd2ad9ca9e8abb6f5b` (superseded by the hardening update below).
- Actual browser: no Vite script; one main landmark; desktop/mobile document horizontal overflow absent; retained editor/area DOM across all four areas; a real local accepted-branch run returned `{"approved":true}`. An earlier empty-input local run exercised the alternative branch. Captured JavaScript errors and CSP violations were empty during the initial execution check; this is not a full assistive-technology/CSP certification.
- Actual API: mapped saved workflow completed with `{"label":"docker-mapped","verified":true}`; exact original draft/run readback passed after restarting **only staging**. Metadata remained payload-free. The approval development run stayed paused and nonresumable after restart; unconfigured review returned 503, unauthenticated review 401.
- Existing companion and OS container IDs/start timestamps remained unchanged. Existing services at 5180/8787 and 4173 were not replaced.

Screenshots:

- `/Users/te451223/.hermes/cache/scratch/studio-staging-parent-1280.png`
- `/Users/te451223/.hermes/cache/scratch/studio-staging-parent-390.png`

## Subsequent development-toolchain verification

The parent then verified the minimal Vitest 4.1.11 migration: **2,867 tests / 187 files and all 16 Docker tests passed**, plus typecheck/build/diff checks. Independent full-development, omit-dev and new candidate-image application npm audits each returned **zero known findings**; the former six development findings are resolved. The new isolated candidate `flightdeck-studio-devchain-check:local` was physically verified with 63 production packages and the real network-none private bootstrap.

The running staging image, companion and OS were deliberately left unchanged during this development-only migration. Do not attribute the new lock/framework to the older running staging artifact. Details and exact candidate identity: `studio-verification-devchain-2026-10-14.json`. Vitest 4 release verification uses `--maxWorkers=4`, not the removed `--minWorkers` flag. These results do not remove the remaining production identity, deployment or recovery blockers.

## Isolation and lifecycle

Configuration: `deploy/studio-docker/staging.compose.yml`, project `flightdeck-studio-staging`, container `flightdeck-studio-staging-studio-staging-1`, private volume `flightdeck-studio-staging_staging-private`. Loopback port 8790 is distinct from the existing companion and OS. Nonroot UID/GID 1000, read-only image, dropped capabilities and private state are retained.

```sh
docker compose -f deploy/studio-docker/staging.compose.yml up -d --no-build --wait
# Stop only this evaluation instance, retaining its state:
docker compose -f deploy/studio-docker/staging.compose.yml stop studio-staging
```

Do not merge this file into the OS Compose project or remove its private volume as a routine restart.

## Hardening verification snapshot — superseded by the latest artifact above

The parent rebuilt and deployed **only this private staging service** as `flightdeck-studio-staging:hardening-20261014`, image `sha256:8481b3a0c44f3704640e2a34d95b3482f11711ed90e81f16acd77d428367e52e`. The URL and staging private volume are unchanged. The build ran the full TypeScript/Vite build; no compiler threshold was weakened.

- **402 server/workflow/resource/provider tests passed**, including the backup and real request-admission tests; typecheck passed; **16 Docker/bootstrap/artifact tests passed**. The prior integration test's automatic-repair call count was explicitly aligned to the new no-provider-retry HTTP contract; invalid drafts still refuse. Broader manifest-conformance repair and final full-suite verification remain separate work.
- Authenticated expensive routes now share process-local zero-queue limits: global 4 / actor 2 / project 2. Actual barrier tests prove 12 novel-project requests enter the provider only twice and return ten 429 refusals. These are concurrency controls, not distributed rate or financial budgets.
- The parent physically verified **63 installed runtime application packages**, exact lock/version matching, no Vitest/Vite/TypeScript/Tinypool, and no server/package source tests. An audit performed inside this exact rebuilt image returned **zero known application-dependency vulnerabilities**. The full development/build toolchain still has six findings; OS/global-tool scanning remains outside that npm result.
- The real built browser app still completed the accepted local branch with `{"approved":true}`; one main landmark, no page horizontal overflow, no captured JavaScript/CSP errors, public health `{ok:true}`, and unauthenticated model 401 were verified again.
- Existing mapped-run and unavailable-approval exact snapshots survived staging recreation. No effects were rerun for readback. The companion/OS IDs and start timestamps remained unchanged.
- Offline backup integrity/anti-rollback verification passed its synthetic tests, but it performs **no restore** and returns `restore: "blocked"`. Production monotonic catalog/quarantine/encryption/recovery integration remains missing.

## Release restrictions

This image must not be exposed publicly. It has no TLS, production membership authorization, configured independent reviewer, live model credential, activated vendor resources or installed host workflow runtime. Those capabilities are not implied by UI availability, concurrency admission, a clean application npm audit or healthy liveness.

`docs/studio-production-readiness.md` and its historical JSON ledger record the broader release gates; `studio-verification-2026-10-14.json` records the later full-green engineering milestone and G14 override. The three historical manifest failures are resolved. The large-browser-bundle advisory and the remaining production configuration/operational controls are still open; do not label this staging candidate production-ready.
