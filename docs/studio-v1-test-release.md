# First-version private test release

## Status

**Ready for bounded private first-version testing.** All nine review findings are repaired and independently closed within their declared scopes, with no remaining concrete defect reproduced in those reviews. The final host-aware run passed **3,542 Vitest cases / 240 files plus 31 Node cases**, typecheck, build, strict broker compilation and launcher JS checks. Independent results were hash-verified and archived; this is local test handoff acceptance, not public production approval, live-provider acceptance or activation of the unmounted authoring broker/host bridge.

The running app is `http://127.0.0.1:8790/`. Its immutable image remains `sha256:5029e89247bb09d1340f23ba4440e80f4521cd8ff05c2f939588ff7a07e0bbaf`. The latest host build produces exactly the HTML, JS and CSS served by that image. The newly delivered offline broker/envelope code is not mounted into the app; no image replacement is being implied by their source-test results.

## Start the first test

From `/Users/te451223/Flightdeck-code`:

```sh
npm run studio:first-test
```

This real, exercised default is read-only. It verifies the exact private Docker target, loopback publication, security configuration, actual built assets, authenticated configuration/setup metadata and workspace reads. It does not touch the clipboard, change records, select a model, send a prompt or contact a provider. Current output reports local workflows `ready-to-test`, live AI `unconfigured`, model requests `not-performed` and clipboard `not-accessed`.

### Local workflow — no credentials needed

1. Open the app and choose **Open workflow example**.
2. Move/edit a block, double-click its settings, apply changes, and test Undo/Redo.
3. Open **Local execution input & trace**. Run once with `{"approved":true}`, then with `{"approved":false}`. The corresponding accepted/other branch should complete; the other output should be skipped.
4. Export the applied graph through **Document → Export JSON**.

Use synthetic examples only. A boolean `approved` is branch data, not human approval. An independent approval node must pause or report unavailable review; V1 does not invent a reviewer or silently resume it.

### Save/history and actual AI

These use the existing private Studio operator sign-in, not a new account or Flightdeck OS login. The detailed tested path and the **optional user-only, double-opt-in clipboard helper** are in `studio-first-test-guide.md`. Prefer an existing user-controlled secure credential path. The optional helper has clipboard/history/sync risks and best-effort cleanup; its real general-clipboard/token-copy path has not been executed by the agent. No declined password prompt is repeated.

After operator sign-in, use synthetic project `studio-first-test` to save a new draft, confirm exact readback, load it, save a new revision and explicitly run that newly saved deterministic revision. Existing drafts/runs are not test targets. Never retry an uncertain execution.

For live generation, enter the Anthropic key only in **Connection settings → Anthropic API key setup**, then explicitly refresh configuration, select Anthropic and send a small synthetic workflow or sub-app request. Configuration alone must not send a model request. Keys remain server-memory-only and are lost on restart. Real key-save, authenticated browser generation and billable create/review/save/run are not yet verified.

## Delivered and exercised

- **First-test launcher:** actual repaired package entry passed against the real current app; Docker-CLI environment-policy booleans, exact tmpfs/mount/security/namespace/resource/command admission, bounded owned-process lifecycle, direct hex-byte validation and user-only optional sign-in plumbing. Full inspect JSON crosses the trusted local Unix socket into the CLI; only environment-policy booleans reach the launcher. This is not daemon-side redaction. Thirty-three launcher cases plus one unchanged safe-entry case are included in the full total below. Real clipboard/token copying is not tested or automatically performed; daemon-side exec termination is not inferred from Docker CLI cancellation.
- **Runtime TLS repair:** actual running Node now validates the original Anthropic hostname/certificate chain and negotiates TLS 1.3 with the already host-admin-trusted public CA. The separate explicit local override does not disable TLS checks. This was TLS-only: no HTTP credentials or model request. See `studio-runtime-tls-v1.md`.
- **Encrypted offline verification:** real AES-256-GCM archive/fence round trip and a repeated standalone synthetic drill: six files, eleven entries, one permanent claim, tamper/wrong-key/stale-reference refusals, two actual deny-only bootstrap refusals and verified cleanup. No extraction, marker unlock, resumed effect or restored runtime. Operational keys/freshness/restore authority remain unimplemented.
- **Authoring broker/native model port:** real registered-block/schema reads, validated draft proposals, immutable dispatch/scope, exact-context policy, native tool/thinking protocol, bounded accounting and original-work settlement. Actual installed SDK/fake-fetch tests pass; 144 owned tests are included in 305 selected regression tests and the full run. Repairs refuse reserved SDK runtime request overrides and duplicate response IDs, normalize protected approval configurations consistently and compare seven strict binding values independent of field order. It remains unmounted: no Deep Agents app installation, replacement loop, host authority, real UI/harness activation or hostile-code containment is claimed. All 24 original full production harness cases remain not-run.

## Combined evidence

The repaired host-aware default test entry passed **3,542 Vitest assertion records / 240 physical files plus 31 Node Docker/bootstrap cases**, with no failures/skips/pending cases. All 3,472 pre-repair records remain present and passing; the 70 additional records are verified by physical file/title multiplicity rather than inferred from implementation reports. Repository typecheck, production build and diff check passed. The existing 740.88 kB JS chunk advisory remains. Parent also reran broker scoped app-matched and strict-declaration checks, launcher syntax and separate JS typecheck successfully. Focused tests overlap the full results and are not additional totals.

Parent reran the repaired real safe package entry and independently checked the broker's 144 owned cases inside its 305-case selected report and the full repository report. It verified all 74 launcher and 129 broker delivery-manifest entries plus current source/installed SDK hashes; 22 broker tool-cache files were checked but not copied into the durable archive. The earlier parent synthetic drill and accepted envelope replay remain separately scoped evidence. All four original private files' complete bytes/paths/modes/owners remain unchanged in a fresh aggregate-only inventory comparison. The companion/OS and post-TLS Studio service retain their exact IDs, images and start times. Latest built HTML/JS/CSS bytes exactly match those actually served.

### Independent acceptance

| Slice | Independently executed checks | Disposition |
| --- | --- | --- |
| Launcher | 34 focused tests; 127 policy, 512 byte and 9 process/helper controls; actual literal-target `--check` | M1/M2/L1/L2 closed in bounded scope |
| Encrypted offline envelope | 38 focused tests; 42 native-VM probes; strict scoped compiler | F1 closed in offline immutable-scratch scope |
| Unmounted draft broker | 144 owned tests; 121 fresh offline SDK probes; both scoped compilers | R1–R4 closed in draft-only/trusted-client scope |

Focused/full tests overlap and repeated probes are not summed. Parent verified the launcher/broker rechecks' 30/39 artifact entries, seven launcher and 14 broker source identities, and recomputed the broker source-set digest before acceptance annotations. Original artifacts remain exact; archived source/config copies have inert `.snapshot` filenames with a path/hash map.

One parent finishing run correctly failed because newly archived historical `.test` files were discovered as current tests (seven copied suites failed loading). All 3,542 actual source assertions passed, but that was not a passing whole run. Only archive filenames were made inert; no test exclusion, filter, compiler flag or production validator was weakened. The initial failure is retained; the full unchanged default entry then passed exactly 3,542 current assertions / 240 files plus 31 Node cases. The CLI-versus-daemon correction changed only a comment and documentation; executable behavior matches the independently reviewed source.

Final evidence: `docs/evidence/v1/accepted-first-version-tests.json`, `docs/evidence/v1/accepted-validation/`, `docs/evidence/v1/final-independent-rechecks/` and `docs/evidence/v1/archive-layout-correction.json`. Repaired and pre-repair runs remain separately retained in `repaired-first-version-tests.json`, `full-first-version-tests.json` and their parent directories. Original critic batch `deleg_b1c2b007` has all 49 manifest-listed sanitized artifacts verified and archived in `independent-reviews/`; repair deliveries are in `repair-deliveries/`. Envelope recheck remains in `envelope-remediation/independent-recheck/`; runtime TLS proof remains separate in `runtime-tls/`. Earlier release/canceled-choice records retain their historical meanings; no blanket acceptance transfers across source snapshots.

The host identity bridge stays disabled/unmounted. No real API key, reviewer grant, model selection, provider completion, saved-run replay, public release, commit, push or OS/companion change occurred. Native microphone dictation, actual reviewer/OS integration, operational recovery and advanced harness activation are separate from this first manual test path.
