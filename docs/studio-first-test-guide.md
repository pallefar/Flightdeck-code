# Studio first-version testing

> Current private authoring update — October 17, 2026: Studio8790 now runs the reviewed `e9a04ab6…` image with optional bounded native drafting and durable working-source authoring. Existing private records were preserved. See `studio-authoring-private-release-20261017.md` for exact scope, checks and the remaining user-run sign-in/provider gates. Older verification sections below remain historical.

Private evaluation only. Open **http://127.0.0.1:8790/** directly. There is **no new Studio account to create**: this staging service uses its existing operator token, separate from Flightdeck OS sign-in. Host identity/reviewer integration remains disabled. Use only synthetic examples—no real employee, candidate, customer or other personal data.

## 1. Safe preflight

From this checkout, with the existing local Docker service already running:

```sh
node scripts/studio-first-test.mjs
# Explicit equivalent:
node scripts/studio-first-test.mjs --check
# Package alias (release-owned and unchanged):
npm run studio:first-test
```

Default and `--check` are the same **bounded read-only** action. They neither launch/restart Docker services nor open a browser, write records, select a model, send a prompt, probe a provider or access the clipboard. No install is required beyond this checkout's existing dependencies.

The script pins the literal origin, staging container name, immutable `e9a04ab6…` image, Compose ownership, UID 1000, loopback-only `8790 → 8787` publication, read-only root and original private `/state` volume. It accepts no alternate URL, container, path or credential arguments/environment options. Docker is explicitly bound to a local Unix socket rather than a remote/current Docker context. It rechecks the exact immutable container ID and admitted configuration before private work and after the readback.

Admission covers both effective mounts and their Docker `Binds`/`Mounts`/`Tmpfs` specifications. The only tmpfs is `/tmp:rw,noexec,nosuid,size=64m,mode=1777`; application/state overlays and inherited volumes are refused. Security options and dropped capabilities must be exactly `no-new-privileges:true` and `ALL`. PID/user/UTS namespace overrides, host IPC/cgroup namespaces, devices/device requests/device rules, custom sysctls, unconfined security additions and changed masked/read-only kernel paths are refused. The inspected policy pins 128 PIDs, 805306368 bytes memory, 1610612736 bytes memory-plus-swap, zero memory reservation, normal OOM behavior, `init:true` and `runc`. It binds `/app` working directory and both configured/effective command to the original `docker-entrypoint.sh` → `node --import tsx deploy/studio-docker/bootstrap.mjs` entry.

Before either public HTTP or a private helper, the trusted local **Docker CLI** evaluates an explicit runtime environment key allowlist and emits **only policy booleans to the launcher**, not raw environment values. Full inspect JSON crosses the trusted local Unix socket into that CLI; this is not daemon-side redaction. The policy pins the original executable search path, production `NODE_ENV` and the approved optional public CA. The new native-drafting opt-in admits only the exact literal `STUDIO_NATIVE_AUTHORING=1`; arbitrary values and similarly named keys are refused. Optional absence remains admissible to the helper, while this private deployment explicitly enables it. This flag neither chooses a connection nor sends a prompt. Unknown keys are refused even when empty, including code-loading/linker overrides (`NODE_OPTIONS`, `NODE_PATH`, `LD_*`, `DYLD_*`), diagnostic/cache-output controls, TLS/SSL/OpenSSL overrides and proxy settings. The launcher does not silently clear drift or treat the host child's clean environment as a container environment reset. A deliberate environment/configuration change requires release-owner review; these snapshot checks trust the local daemon and are not protection against a malicious daemon or a guarantee against concurrent configuration mutation.

The only optional extra mount allowed is the exact approved read-only public CA at `/etc/studio/trust/host-approved-public-ca.pem`, sourced from this checkout's `deploy/studio-docker/trust/host-approved-public-ca.pem`, together with that exact `NODE_EXTRA_CA_CERTS` setting. Other extra mounts or CA paths are refused. See `studio-runtime-tls-v1.md`; this helper does not perform even a TLS/provider probe.

Checks cover public liveness and admission readiness, actual HTML/hashed JS/CSS and their security/cache policies, refusal of source/map/API-fallback paths, exact served-byte agreement with the immutable image, four authenticated model descriptors with `not-probed` status, authenticated setup metadata and a GET-only workspace list in the synthetic `studio-first-test` project. An empty list is valid; it is not evidence that a draft was saved. No saved record bodies, names, IDs, operator values or individual credential hashes are exported. HTTP credentials are read and used only inside the verified container.

Successful output contains fixed nonsecret statuses. `localWorkflows:"ready-to-test"` means **ready for your manual tests**, not that those tests or live AI passed. The current no-key state is truthful:

```json
{"selection":"none","anthropicSetup":"available-memory-only-unconfigured","workspaceRead":"pass","localWorkflows":"ready-to-test","liveAI":"unconfigured","modelRequests":"not-performed","recordWrites":"not-performed","clipboard":"not-accessed"}
```

That is an excerpt, not the full response. All four destinations—ChatGPT/native Codex, Flightdeck service, local/OpenAI-compatible, Anthropic—remain individually visible as unavailable/not-probed until actually configured. Configured metadata becomes `configured-not-probed`, never a live-AI pass. Disabled/external setup states are explicit. Missing credentials for a model are not a failed preflight. Broken required checks exit nonzero with a fixed category, without exception details or private response bodies. Do not "fix" a target refusal by supplying arbitrary paths or weakening the pin; ask the release owner to review a deliberate deployment change.

Bounds: HTTP GET only, literal loopback sockets, no redirects/proxy discovery, 2.5-second request deadlines, 16 KiB response headers, 128 KiB HTML, at most 16 referenced assets, 8 MiB per asset/20 MiB combined, 1 MiB workspace response. Docker inspections have 10-second/16 KiB bounds; the private helper has a 30-second internal deadline and a 35-second host process limit. Child diagnostics are not forwarded. Scratch paths are explicitly under `/Users/te451223/.hermes/cache/scratch`.

On POSIX hosts each child gets its own process group. Timeouts, stream/output failures, parent SIGINT/SIGTERM and explicit parent exit signal that owned group; ordinary descendants remaining in it are covered, including after a successful direct-child exit. A separate 250 ms post-exit/post-kill close bound prevents inherited pipes from holding the Promise indefinitely: on expiry streams are destroyed, retained output is zeroed and the failed child handle is unreferenced. This is a host-client lifecycle bound, subject to normal event-loop scheduling, **not proof that a Docker daemon-side exec terminated**. Escaped process sessions, force-killed parents and uninterruptible native work cannot be guaranteed stopped. The container helper retains its independent 30-second deadline; no claim of daemon-exec cancellation is made.

## 2. Local editing and branch execution — no sign-in or model needed

1. Choose **Open workflow example**. This opens the real **Conditional routing** template locally; it does not request AI generation.
2. Change the workflow name to a synthetic label such as `V1 synthetic routing check`. Move a block; double-click a block to inspect settings. Apply any parameter/input changes explicitly. Try Undo/Redo.
3. Open **Local execution input**, use `{"approved":true}`, and choose **Run locally**. Expect completion through **Accepted output**, with the other output skipped.
4. Repeat with `{"approved":false}`. Expect **Other output**, with Accepted output skipped. The boolean is routing input, **not independent human approval**.
5. Use **Document → Export JSON** to inspect/export applied changes. Ordinary area navigation should retain the local graph. A refresh can lose unsaved browser edits.

Acceptance: both real branch choices execute locally and editing/undo/export work. HTTP/model blocks without adapters must block honestly. Local execution does not create server run history.

## 3. User-controlled operator sign-in

The **operator token authenticates this private Studio**. An **Anthropic API key authenticates billable vendor access**. They are not interchangeable. Do not put either in chat, shell arguments, environment variables, graph JSON, screenshots or logs. Do not reuse OS/companion credentials. The assistant does not read, paste or autofill them for you, and no declined secure-login prompt is repeated.

Prefer an already user-controlled secure credential/autofill path if one is available. As an optional macOS-only alternative, **you may explicitly run this yourself**:

```sh
node scripts/studio-first-test.mjs --copy-operator-token --acknowledge-clipboard-risk
# Same user-only action through the release owner's package alias:
npm run studio:first-test -- --copy-operator-token --acknowledge-clipboard-risk
```

**Clipboard warning:** clipboard managers/history, Universal Clipboard, synchronization, monitoring apps and pastes into the wrong window can retain or disclose the token. Disabling such features first is your choice; the helper does not change your system settings. Automatic clearing cannot erase another application's history or synced copy. If that risk is unacceptable, do not invoke this option.

Both flags are mandatory; combining copy with `--check` or adding alternate targets is refused. The command first runs the read-only checks, then revalidates the exact container before accessing only its existing `/state/operator-token`. The copy exception transfers those bytes through a private child pipe to `/usr/bin/pbcopy` **stdin**, never launcher stdout, command arguments, environment or a file. No model/OS/companion credential is copied. The UI input remains your action; the helper adds no authentication endpoint, account or browser injection.

The file-read and copy boundaries independently require **exactly 64 ASCII lowercase-hex bytes** (`0–9`, `a–f`). High-bit/non-ASCII bytes are refused directly rather than masked by ASCII decoding; rejected owned buffers are zeroed. This is format admission, not a credential-validity or native-clipboard claim.

Keep the terminal open. After the fixed "copied" notice, paste into **Connection settings → Operator token** within **30 seconds**. The helper verifies the copied value without printing it. It attempts cleanup only if both the clipboard value and native pasteboard change counter still match its owned copy; a new copy is left alone. The final conditional native clear rechecks the counter and is followed by readback. Native clipboard APIs are not a transactional lock against concurrent writers. Cleanup is best-effort, not guaranteed erasure: process termination, native-tool errors or monitoring/sync can defeat it. A changed clipboard is reported `left-changed`; uncertain cleanup is not claimed as cleared. SIGINT/SIGTERM during the lifetime wait trigger the same conditional cleanup attempt; force-kill cannot. The real user's clipboard/copy path was **not exercised by the agent**; unit tests use nonsecret process/clipboard doubles only.

In Studio, enter a synthetic **Project ID** such as `studio-first-test` and select **Check connection & project skills**. Expect authenticated configuration, no automatic model selection and no model request. A project label does not grant host workspace access or supply project skills.

## 4. Save and history — operator authentication required, AI not required

With the local conditional graph and synthetic project selected:

1. In **Saved workflow workspace**, choose **Save as new draft**. Require the app's exact authenticated readback confirmation and a saved revision/identity; a click alone is not success.
2. Refresh drafts and explicitly load that draft. Verify the same graph/name/revision.
3. Edit the synthetic name, then choose **Save New Revision** and require its readback confirmation.
4. In **Server execution · saved revision only**, supply synthetic `{"approved":true}` and explicitly run the saved revision. Confirm completion and inspect **Run history**, then reload the exact run.
5. Do not retry an uncertain execution. Each saved revision may run only once; explicitly save a new revision for another execution. A pending independent review may block revision/execution; do not self-approve it or try to resume preserved historical runs.

Acceptance: create/update/readback/load and a newly chosen synthetic deterministic saved run/history agree. These actions **do write your test records**; only the manual acceptance path does so, never `--check`. Keep existing staging drafts/runs untouched. Production reviewer/resource activation and host authorization are not established by this test.

## 5. Actual AI — only after your in-app key and explicit send

1. Open **Connection settings → Anthropic API key setup** and explicitly load metadata. Current staging offers server-memory setup. If external/disabled, follow that state rather than trying to override it.
2. Enter your Anthropic key only in its masked **Anthropic** input, read/acknowledge the disclosure and choose **Save session key**. Saving configuration must not select a model or call it.
3. Use **Check connection & project skills** again and explicitly select **Anthropic API**. `configured · not-probed` still does not prove a completion. Session keys are lost on server restart; this is not an encrypted durable vault or immediate-zeroization guarantee.
4. For the bounded harness, open **Authoring engine**, explicitly **Check native authoring availability**, then explicitly choose Native only when the current Anthropic connection is ready. JSON remains a separate explicit choice; metadata loading/cancellation does not select an engine or silently fall back. A configured descriptor is still not a provider completion.
5. Submit a small synthetic request, for example: `Create a workflow that routes a synthetic ticket by a boolean approved field and returns it. No external connectors or personal data.` This explicit send can spend vendor credits. Review any exact-context send acknowledgment requested by the app. If context changes, review again rather than bypassing the guard.
6. Require an actual accepted workflow result in the workflow editor. For a separate sub-app test, request `Create a synthetic ticket list and submission form with example data only.` Require the actual sub-app result in the IDE; its scriptless preview does not execute generated source or deploy it.
7. For a sub-app, **In-session Save** applies an editor buffer only. Use **Saved sub-app** to persist the separate working files and original generated baseline; require exact save/readback and explicit reopen. **Check working source** is an explicit local Worker-based static conformance action, not typechecking, source execution, live-host verification or permission to deploy. Editing/reopening does not automatically check source or reuse an old report.
8. Editing, saving, review and saved-revision execution remain separate actions. Unsupported/unconfigured model/resource/reviewer paths must stay blocked. No silent provider fallback is acceptable.

Live key-save, billable completion and authenticated browser acceptance remain **user-run/unverified** by this launcher. The separately recorded TLS repair proves transport trust only, not key validity or AI output. No real key or provider request was used to develop/test this helper.

## Developer verification

Only the launcher, its `.test.mjs` file and this guide are owned by this repair; package alias/deployment/runtime trust integration belong to the release owner.

```sh
TMPDIR=/Users/te451223/.hermes/cache/scratch ./node_modules/.bin/vitest run scripts/studio-first-test.test.mjs --maxWorkers=1
node --check scripts/studio-first-test.mjs
./node_modules/.bin/tsc --allowJs --checkJs --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck scripts/studio-first-test.mjs
# Optional broader repository check (not rerun for this scoped repair):
npm run typecheck
node scripts/studio-first-test.mjs --check
```

Initial implementation evidence (historical): 19 passing tests in one file, syntax/`--checkJs` and repository typecheck, with both exact-target check forms passing, was retained under `/Users/te451223/.hermes/cache/scratch/studio-first-test-v1-20261015/`. The independent review then demonstrated four bounded drift/plumbing findings despite those passing tests; it did not establish active compromise.

### Independent-review repairs — October 15, 2026

Only this guide and `scripts/studio-first-test.mjs` / `scripts/studio-first-test.test.mjs` were changed. The image pin, deployment, package/host entry and other application files were not changed. Tests use nonsecret fixtures, owned subprocesses and scratch-only Vitest configuration/cache; no real copy path was executed.

Each production change followed its observed failing test, followed by an all-launcher-tests GREEN run:

| Slice | Observed RED | Subsequent GREEN (launcher total) |
| --- | --- | --- |
| M1 runtime policy / pre-entry refusal | 2 failed | 21 passed |
| M2 tmpfs, isolation, resources and effective command | 2 failed | 23 passed |
| L1 process groups, parent signals, inherited pipes | 5 failed | 28 passed |
| L1 explicit parent-exit cleanup | 1 failed | 29 passed |
| L2 exact file/copy byte admission | 2 failed | 31 passed |
| M2 alternate mount specifications | 2 failed | 32 passed |
| M2 absent optional Docker map compatibility | 1 failed | 32 passed |
| M2 nonsemantic CA metadata field ordering | 1 failed | 33 passed |

The first finishing live check refused the target before helper execution: Docker could omit an empty `Sysctls` map, and its equivalent CA mount object could be serialized with a different key order. Both were reproduced RED and corrected without permitting custom sysctls, extra CA fields/options or another target. The failed attempt and its safe projection error were retained, not represented as a passing live check.

Final scoped verification: **33 launcher assertions in one physical file plus 1 unchanged safe-entry assertion in a second file (34 passed, zero skipped)**, both Node syntax checks and launcher `--checkJs` passed. The repository-wide typecheck/full suite was not rerun for this security-only repair. The final actual default and explicit `--check` each exited 0 against literal `8790`, with the same unavailable/not-probed descriptors, no selection, memory-only/unconfigured setup, no provider/model request, no record write and clipboard not accessed. Exact inspected container ID/start time/image remained unchanged across the policy probes.

Additional executable policy probes exercised Docker's actual generated template against 57 nonsecret environment mutations (including empty overrides) and 25 command/configuration mutations; all were refused while the real approved metadata was admitted. No altered container was created. Same-group child cleanup, bounded escaped-session pipe closure and parent SIGINT/SIGTERM/exit were exercised in scratch; all owned fixtures were cleaned. Escaped sessions were explicitly cleaned by the test harness, not claimed killed by the launcher. No daemon-side-exec or native clipboard cancellation/acceptance pass is claimed.

Sanitized RED/GREEN logs and JSON, executable probes, safe metadata projections, final compiler/tests/default/check results, source before/after hashes and an absolute-path checksum manifest are under `/Users/te451223/.hermes/cache/scratch/studio-first-test-launcher-repairs-20261015/`; final successful verification is in its `final/` subdirectory. This is new task evidence, not an edit to historical evidence. Hashes cover only source/artifact bytes, never credentials or credential digests.

Fresh independent remediation review is accepted in its bounded configuration-drift/plumbing scope: **34 focused tests**, **127 policy controls**, **512 exhaustive byte controls** and **9 process/helper controls** passed; all 19 original baseline cases remain. Literal `8790 --check` passed without clipboard/model/record actions. Parent verified all 30 manifest-listed artifacts and seven source identities before annotation. The informational CLI-versus-daemon wording correction above changed only documentation and a source comment, not executable behavior. Independent artifacts are retained under `docs/evidence/v1/final-independent-rechecks/launcher/`; `archive-layout-correction.json` maps inert snapshot filenames without changing their bytes. Final whole-repository evidence and the remaining user-run sign-in/live-AI gates are in `studio-v1-test-release.md`. These probe counts are separate from, not added to, the full test total.
