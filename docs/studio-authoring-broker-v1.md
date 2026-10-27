# Studio authoring broker v1 — implemented, unmounted

## Delivered boundary

`packages/authoring-harness/src/index.ts` exports a Flightdeck-owned draft broker and a **native Anthropic Messages API model port**. This is runnable source, not a replacement agent loop. The existing JSON-only planner, provider adapters, model defaults, connection selection, server composition root, package/lock files and deployment configuration were not edited by this work. Deep Agents was not installed, imported into the application, activated or newly executed.

Post-review verification: **144 owned assertions in four files passed**. The final selected regression run passed **305 assertions in 15 files, including those 144**. Both the app-matched scoped typecheck and a separate `skipLibCheck:false` check passed. These are local deterministic fixtures, **not live Anthropic, production authorization, UI acceptance or hostile-code isolation**.

The new, separate result is `packages/authoring-harness/evidence/acceptance-results.json`. It maps every original matrix ID to physical test records and records scope limitations. The original `docs/studio-harness-acceptance.json` and spike evaluation were not mutated. All **24 full production acceptance cases remain not-run, zero passed**. The new library's clean declaration check does **not** fix or supersede the retained isolated Deep Agents stack's 22 declaration errors.

## Public API

- `createDraftBroker({ binding, limits, authorize, protectedGraph })`
  - `tools`: deeply frozen native tool declarations.
  - `invoke(fixedName, nativeJsonInput, signal?)`: one bounded, policy-checked operation.
  - `invokeNative(toolUseBlock, signal?)`: the same operation with a native `tool_result`, the exact `tool_use_id`, stringified validated payload and `is_error:false`. Denials throw a fixed `AuthoringError`; no successful receipt is fabricated.
  - `events()`: a frozen snapshot of bounded metadata events.
  - `snapshot()`: call/output/token reservations, observed token usage, elapsed time, pending original work and dropped-event count.
  - `close()`: stop new work, abort and await **all original broker/model/policy/body work**. No reset, timeout race or new admission grant.
- `createAnthropicToolPort({ client, broker, system, effort })`
  - `complete({ messages }, signal?)`: **one** native Messages turn. Returns `{ message, truncated }`. No loop, tool dispatch, retry, repair, fallback, client construction, credential lookup or environment/base-URL configuration.

The already-built client must have diagnostics explicitly off, no client middleware and **no own `fetchOptions.body`, `method`, `headers` or `signal` field**, even if its value is undefined. The installed SDK 0.127.0 excludes those four fields in its TypeScript type but spreads them over its constructed request at runtime. The port refuses those runtime overrides at binding and immediately before each `messages.create` call, after the before-policy await. A per-send refusal latches model work closed like other failed model operations.

For a correctly configured trusted SDK/transport, the port pins the original `messages.create` callable, model from the broker binding, system text, effort, tool declarations, request limits, `stream:false`, `thinking:{type:'adaptive'}`, `output_config.effort`, `maxRetries:0`, deadline and signal. It adds only a fixed, single-next-call response-bounding middleware. Provider failures have fixed categories and no raw body, provider exception or `cause`; a failed model operation latches the run closed against framework retries. This misconfiguration guard is not a lowest-level egress verifier or containment of malicious trusted SDK overrides.

A supplied client/transport remains **trusted server configuration**. Its credential source, destination, redirect/DNS/TLS/proxy policy and original transport ownership must be verified by that owner. This port does not turn an arbitrary custom client/fetch, hidden detached work or same-process hostile JavaScript into a confined transport. Do not mutate the client or its lower-level methods after binding. Live TLS/model access remains a separate gate.

## Trusted identity and fresh policy

The immutable, bounded tuple is:

```
actorId, workspaceId, projectId, modelId, modelBindingId,
contextEpoch, policyEpoch
```

Construct it from authenticated server authority, never a model argument, browser label, framework context/thread ID or resume payload. `modelBindingId` must identify the selected destination, private credential-binding epoch and relevant transport policy without containing credentials. Rotate epochs and deny old requests when identity, project authorization, selected model/destination, context-send consent or policy changes. No default model or connection is selected here; the existing explicitly configured model is preserved.

`authorize` is mandatory; absence is invalid. It receives the immutable binding, fixed action, input digest, stage and combined cancellation signal. **Every operation** checks policy before dispatch, after awaited work, and before return; the binding is strictly schema-validated and its seven named primitive values compared again after the policy promise itself settles. Object insertion order does not establish authority or cause refusal; extra, absent, malformed or changed fields still refuse. The model action additionally supplies private `envelopeJson`: the exact frozen native request data, including tools, system and full message history. All three model policy stages receive that same envelope. The real SDK fixture checks it against the actual serialized request data passed to fake fetch.

The policy owner must freshly authenticate/authorize the exact tuple and exact send envelope at each stage. A boolean that echoes the old tuple without checking current authority is not a host integration. Treat `envelopeJson` as private review data, **not event/log metadata**. No raw thinking, tool input, source, prompts, identities, provider errors or message IDs enter `events()`.

Unknown tool names and extra scope/approval/resume/path fields deny before policy or handler dispatch. There is no tool-registration or handler injection option; extra broker options are refused. Executable handlers are private, fixed closures selected and snapshotted before any await. The exposed broker and all model-visible declaration objects are frozen.

## Initial tools and intentionally narrow proposal language

| Native tool | Actual implementation | Not granted |
|---|---|---|
| `read_block_catalog` | Snapshot of `packages/workflow/graph.ts::builtinRegistry`, including its actual defaults and draft-only/not-probed status | Adapter discovery, probing, resource access or execution |
| `read_block_schema` | Bounded structural projection of the actual `configSchemas` declaration for an allowlisted builtin type | Filesystem/artifact lookup, full independent JSON Schema validation, adapter availability |
| `propose_workflow_draft` | Bounded native graph proposal, validated again by the actual `graphSchema` and `preservesWorkflowSteps`; protected approval config/type must match the trusted original | Save, build, acceptance into an editor, independent human approval, execution or deployment |

The returned configuration schema explicitly marks runtime refinements and depth-limited structural portions. Those refinements are enforced by the real workflow validators, not silently advertised as a complete JSON Schema implementation.

Native tool inputs are finite schemas with closed object alternatives, every alternative's properties required, bounded arrays/strings/numbers and `strict:true`. Optional native object properties are represented by alternative closed shapes. Broker-side validation remains authoritative even if a provider violates its declaration.

The v1 proposal subset deliberately excludes arbitrary dictionaries and graph-local wrappers: `customBlocks` must be empty; `set.fields` is empty; HTTP body dictionaries, per-block LLM model overrides and structured mapping/branch literals are unsupported. Scalar literals, builtin configs, graph positions, typed branch ports and supported input mappings are available. The limit is 100 nodes and 100 edges, narrower than the general workflow format. A richer valid general workflow can therefore be refused by this v1 broker; do not silently relax the native declarations to accommodate it.

Supply `protectedGraph:null` explicitly for a new graph, or the trusted current original graph for edits. Existing step IDs remain bound. Existing approvals must remain unavoidable on every output route; removal, bypass, type replacement and reviewer/reason configuration weakening are rejected. Original and candidate approval configs both pass through the authoritative `configSchemas.approval` parser before comparison, so an unchanged reason-first config is resubmittable. This is approval-specific normalization, not global sorting of graph dictionaries or signed native blocks. The original snapshot is privately copied before awaiting, so caller mutation cannot redefine protection. This is declarative draft preservation, **not statutory compliance certification or a reviewer grant**.

Draft receipts say `draft-proposed`, `executed:false`, `approved:false`, `deployed:false`. They are not durable artifact/build receipts. Registered HTTP/resource/LLM blocks remain unprobed draft descriptions; no adapter is installed or called by these tools.

## Native protocol and privacy

The port uses the installed `@anthropic-ai/sdk` Messages API and installed native types. It never converts tool calls into a JSON text planning conversation. Native `tool_use` IDs, names, inputs and direct-caller metadata remain native. Native `tool_result` IDs/content/error flags remain native. Returned `thinking`, `redacted_thinking`, text and tool-use blocks retain their original fields, property order and array order when supplied in a subsequent tool-result history.

Validation checks shape without substituting Zod-normalized blocks. Duplicate tool-use IDs within a response refuse before completion issuance, including truncated responses; no returned completion is available to orchestration for callbacks. Signed/tool history is matched to private in-memory hashes of this port's previously issued content; changed signatures, modified blocks, unissued signed history, orphan/duplicate/mismatched result IDs and assistant-prefill sends deny. There is no durable history import/checkpoint/resume capability. The external runtime must keep the native assistant block array intact; reconstructing only tool calls and plain text loses required native history.

All installed stop-reason variants are returned verbatim. `max_tokens` and `model_context_window_exceeded` set `truncated:true` and close the run to further tool/model work. Partial native tool input is retained as opaque bounded data for that response, **never interpreted, dispatched or re-sent**. Other stop reasons are not relabelled as success; no automatic continuation/resume is performed. Unsupported content/server-tool forms, malformed complete messages, oversized data and wrong-model replies fail closed. Streaming is not implemented in v1.

Raw response bytes are bounded **before** SDK JSON decoding. Oversize handling awaits the original reader cancellation; an ignored abort or hung cancellation does not release capacity. SDK diagnostics must remain off. The only event fields are a sequence, fixed operation/phase, bounded elapsed time and optional fixed error code. Buffer overflow increments `droppedEvents`; a consumer must not invent missing completion events.

## Shared accounting and settlement

All ports attached to one broker share one ledger. No per-tool, per-model-port, retry, child, compaction or framework budget is substituted for that ledger.

| Required explicit limit | Hard allowed maximum |
|---|---:|
| `maxModelCalls` / `maxToolCalls` / `maxConcurrent` | 32 / 256 / 8 |
| `maxDurationMs` | 300000 |
| `maxInputBytes` / `maxOutputBytes` | 512000 each |
| `maxTotalOutputBytes` | 4000000 |
| `maxTokensPerCall` / `maxTotalOutputTokens` | 8192 / 65536 |
| `maxEvents` | 2048 |

There are no implicit defaults. Calls and concurrency reserve synchronously; the original operation is registered before any policy callback can reenter or close the broker. Model calls conservatively reserve the entire pinned output-token allowance with no refund, including failed attempts. Observed input/cache/output usage is recorded separately. Per-call raw response bounds and aggregate validated return-byte accounting are separate. This is bounded local admission/accounting, **not a guarantee of remote cancellation, exact billing or a hard total input-token financial cap**.

The monotonic deadline aborts outstanding work and prevents new work. It does not pretend to settle an ignored original promise. `close()` may remain pending indefinitely for such work. A bounded server shutdown must report an incomplete drain and keep the permit accounted for, not reset capacity or automatically retry.

## External runtime integration — separate ownership

No Deep Agents dependency or LangChain replacement loop belongs in this application package. The retained isolated runtime can call these normal TypeScript/JSON ports. Its owner must provide the model-message adapter and exact fixed tool callbacks inside that isolated runtime, then verify its **actual executable** registrations and native block round trips. That full adapter/composition has not been installed or newly verified here.

A caller constructs the actual ports from already-resolved trusted values:

```ts
import { createDraftBroker, createAnthropicToolPort } from './packages/authoring-harness/src/index';

const broker = createDraftBroker({
  binding: authenticatedBinding,     // host prerequisite, not model/framework input
  limits: explicitSharedLimits,
  protectedGraph: trustedOriginalGraphOrNull,
  authorize: freshExactContextPolicy // required trusted implementation; missing authority denies
});
const modelPort = createAnthropicToolPort({
  client: alreadyBuiltTrustedAnthropicClient,
  broker,
  system: approvedSystemText,
  effort: 'high'
});
const callbacks = Object.freeze({
  read_block_catalog: (input: unknown, signal?: AbortSignal) => broker.invoke('read_block_catalog', input, signal),
  read_block_schema: (input: unknown, signal?: AbortSignal) => broker.invoke('read_block_schema', input, signal),
  propose_workflow_draft: (input: unknown, signal?: AbortSignal) => broker.invoke('propose_workflow_draft', input, signal)
});
```

The example identifiers denoting identity, policy, limits, context and client are **composition-owner prerequisites**, not implementations supplied by this package. Do not replace them with permissive fixtures in an app. A safe initially unconfigured policy returns `allowed:false`.

Bind each framework callback to its literal operation above; never select a handler from framework-supplied agent/parent/name/permission metadata after a guard. Use `broker.tools` as the exact native provider allowlist, refuse framework schema substitution, and route **every** model producer through `modelPort.complete({messages}, signal)`. Preserve complete native assistant blocks when converting to/from the retained model abstraction. No agent loop is implemented here.

The retained source reference is `/Users/te451223/.hermes/cache/scratch/studio-harness-research/deepagents-spike/context/src/runtime.ts`, with its existing `FixtureAuthoringNativeModel`, fixed `tool()` callbacks, `compose` and concrete ToolNode inventory probe. Its fixture names/models and transport are **not** this new provider integration. The retained composition replaces filesystem, subagent and summarization middleware by their exact pinned names and disables checkpoint/skills/memory/backend access. Do not infer safety from `tools:[]` or `subagents:[]`; re-prove the new three-name executable registry and absence of auxiliary model/backend producers in that separate pinned environment. The earlier 42 fixtures and declaration findings remain separate historical evidence.

Keep the actual shared `RequestAdmission` permit until broker drain, even if the framework's outer invocation rejects early. The caller-provided runtime invoker, not this package, owns orchestration:

```ts
try {
  return await permit.track(async signal => {
    try { return await invokeExternalRuntime({ modelPort, callbacks, signal }); }
    finally { await broker.close(); }
  });
} finally {
  await permit.release();
}
```

The tests exercise this pattern against the **actual RequestAdmission class**, actual installed Anthropic SDK/fake fetch and a **synthetic** early-return wrapper. They do not label that wrapper as a new Deep Agents execution or an application composition-root test.

## Unsupported capabilities and remaining gates

Shell, filesystem, network/resource invocation, secrets, plugin installation, arbitrary source/candidate execution, approvals, deployment, execution, activation, subagents, delegation and resume grants have **no registered handler** and deny explicitly. There is no durable draft store, verifier sandbox, human reviewer, checkpoint store or inferred host authority. Library refusal is not evidence of OS/network confinement.

Keep the host database identity bridge disabled/unmounted. Real identity/CSRF/policy providers, reviewer authority, production namespace/storage boundaries, live model/TLS acceptance, isolated runtime adaptation/declaration remediation, in-app mounting, actual UI events and deployment acceptance require separate work and evidence. Nothing here approves their activation.

## Reproduce and inspect evidence

From `/Users/te451223/Flightdeck-code`, using only already-installed dependencies:

```sh
./node_modules/.bin/vitest run packages/authoring-harness/tests --maxWorkers=1
./node_modules/.bin/tsc -p packages/authoring-harness/tsconfig.json
./node_modules/.bin/tsc -p packages/authoring-harness/tsconfig.json --skipLibCheck false
./node_modules/.bin/vitest run packages/authoring-harness packages/providers/src/anthropic.test.ts packages/providers/src/planner-bridge.test.ts packages/workflow --maxWorkers=1 --reporter=json --outputFile=packages/authoring-harness/evidence/review-repairs-selected-vitest.json
```

- `evidence/review-repairs-selected-vitest.json`: actual final 305-assertion selected run; no skipped/failed tests. Counts are physical assertion records, not deduplicated display names. The 144 owned tests are a subset, not an additional total.
- `evidence/review-repairs-owned-vitest.json`: separate final owned run, 144 passed in four physical files; 92 unchanged original records plus 52 new review-repair records.
- `evidence/review-repairs-verification.json`: four sequential RED/GREEN stages, command/log/source hashes, strict tuple controls, post-repair probe outcomes, snapshot location and verification-fixture failure disclosure.
- `evidence/review-repairs-typechecks.json`: both refreshed scoped compiler commands exited zero; not full-host or Deep Agents compilation.
- `evidence/acceptance-results.json`: refreshed original matrix hash, final report/source hashes, all 24 case mappings, precise test-file/ordinal records, unsupported/partial limitations and full production results fixed at not-run. Twenty-one cases have related local test evidence; that is not 21 production passes.
- `evidence/vitest-results.json` and `evidence/typechecks.json` retain the historical pre-repair run. Full pre-repair package/docs/evidence snapshots and the unchanged original independent review are archived under `/Users/te451223/.hermes/cache/scratch/authoring-repairs-native-20261015/before/`.

Development followed observed RED → GREEN cycles for catalog/guarding, draft/schema admission, protected-gate checks, scope fields, native declarations, SDK plumbing, abort settlement, protocol integrity, native-history preservation, stop/truncation handling, diagnostics, output/token/event bounds, retry latching and reentrant admission/close. A real native block-property-order regression was reproduced and fixed without normalizing the original blocks. No live model calls, production credentials, browser/Docker writes, installs, dependency additions, commits or pushes were used.

## Four independent review repairs — October 15, 2026

Fresh independent remediation review is accepted within the original unmounted draft-only/trusted-client boundary: **144 owned assertions, both scoped compilers and 121 fresh independent probes passed**, with zero native outbound guard calls in final runs. R1–R4 are closed; no remaining/new concrete defect was reproduced in that scope. Parent matched all 14 current source hashes, recomputed the source-set digest, verified all 39 independent artifact entries and confirmed the owned cases inside the full repository run. Independent evidence is in `docs/evidence/v1/final-independent-rechecks/broker/`; archived code/config copies use inert `.snapshot` names mapped by `archive-layout-correction.json`. This annotation does not change package source or transfer acceptance to production/host/runtime integration. All 24 original production cases remain not-run.

Each finding was added and observed RED before its own production repair; the complete owned suite was GREEN before adding the next finding.

| Finding | Observed RED | Following owned GREEN |
|---|---|---|
| R1 reserved runtime SDK request overrides | 12 expected failures: four fields at binding, on a subsequent send and after a policy barrier | 104 passed |
| R2 duplicate native response tool-use IDs | 2 expected failures: complete and truncated response | 106 passed |
| R3 unchanged protected approval config | 1 expected false-denial failure | 107 passed |
| R4 insertion-order-independent strict binding | 1 expected false-denial failure; 36 strict/revocation controls already passed | 144 passed |

Raw RED/GREEN JSON reports, exit-status/log manifests and source hashes are in `/Users/te451223/.hermes/cache/scratch/authoring-repairs-native-20261015/`. Final counts are not sums of repeated runs. The post-repair copy of the review probe preserves its 20 control records, changes only the five finding expectations/output destination and confirms all 25 records with zero probe failures and zero native outbound sentinel attempts. The original review/probe artifacts were not rewritten.

Verification used whitelisted child environments, scratch HOME/TMPDIR, explicit noncredential SDK auth and fake fetch. The first selected regression run passed 304 records but its tsx example child exited 97 because the blanket socket guard blocked the loader's local IPC attempt. That failed report is retained as `selected-regression.initial-vitest.json` in scratch. After permitting only the exact scratch tsx parent Unix-domain socket path (not TCP/HTTP/DNS/TLS), the unchanged example passed alone and all 305 selected records passed. This is a verification-fixture correction, not a production/network-isolation acceptance result. All 24 original full production cases remain **not-run**.
