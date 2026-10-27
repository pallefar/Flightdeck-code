# Private native authoring root — source checkpoint

The explicit `authoringEngine: "native-v1"` create path now invokes the actual freshness-bound Anthropic capability and bounded harness. Server `nativeAuthoringEnabled` or exact `STUDIO_NATIVE_AUTHORING=1` is still required. Omission preserves the existing JSON path. Unsupported native connections return 409 without fallback.

## Working boundaries

- Local workflow requests without project skills produce real `workflow-graph-proposed` DAGs, not invented host process metadata/pages.
- Skill-backed workflow drafts require the existing exact-context human send review before metadata and native graph planning. Trusted protected step IDs and independent-review requirements are held by the broker; missing/bypassed/config-rewritten gates are refused. `independent` is an unconfigured review requirement, not an authenticated reviewer or grant.
- Native sub-app spec proposals pass the actual pure generator, conformance and artifact privacy gates. Required native DTO fields are explicit. Registry edits are inert wire metadata, not executable methods; no source is evaluated, installed or mounted.
- Six model sends **total per request**, including JSON determination/metadata; sixteen broker tool calls maximum; one concurrent operation; no retry/repair/fallback. Systems, tool definitions and limits are version-bound into native skill-review identity.
- One resolved original model credential/binding is held throughout. Freshness is rechecked on both sides of awaited datasource policy calls. Broker policy binds the fixed system, tool registry and original protected request. Continuations preserve only the originating native response blocks and fixed broker results.
- Request admission holds the original SDK/native work until it settles, including an ignored-abort fetch. No shell, filesystem read, host-effect, independent-approval or deployment tools are registered.

## Executed verification

`native-root-progress-tests.json` contains **334 passing physical assertions in 14 files**, including **12** root-integration cases. This focused selection overlaps earlier runs; totals are not additive. It covers real installed SDK/fake-fetch graph and source generation, strict browser parsing, exact skill review/protected gates, six-call exhaustion, privacy refusal with zero sends, and retained shared admission on timeout. Existing JSON/create/review/destination/admission compatibility is included.

Project typecheck, both harness compiler variants (including dependency declarations), production build and diff whitespace check exited 0. Build retains the existing large-chunk advisory. Source snapshots and SHA-256 mapping are under `docs/evidence/authoring-integration/native-root-checkpoint/` with inert `.snapshot` suffixes.

The first native workflow root test was RED (`needs_input`, not a local graph) before root invocation was mounted, then GREEN. The first sub-app fixture was invalid against the real required-only tool schema: missing summary/domain-title/route-summary/field-optional members were corrected in the synthetic fixture, not relaxed in production validation. This fixture failure is not claimed as a production defect.

## Still pending

Independent native composition security review (`deleg_6b107953`), pipeline/UI delivery acceptance, frontend engine selection and durable workspace composition, full-suite/browser/isolated-image acceptance. This checkpoint does not complete the user's usable-authoring goal.

The running private Docker Studio remains on image `5029e89247bb…` at `127.0.0.1:8790`; this source work was **not deployed**. Current Studio/companion/OS containers were read back healthy. No real provider request, sign-in/key entry, host bridge activation, host/private-state mutation, commit, push or publication occurred. Actual user-controlled key/selection/send/review and real independent reviewer/production identity remain separate gates.
