# Server-owned model connections

`server/model-connections.ts` exports `createModelConnections(options)` and the types `ModelConnectionRegistry`, `ModelConnectionDescriptor`, `ResolvedModelConnection`, `ModelConnectionId`. Construction, descriptor listing and resolution do **not** perform model requests, connectivity probes, native login probes, or billing. `configured` means server configuration is present and validated, **not** that a service is live. All descriptors currently carry `verification: "not-probed"`.

## HTTP integration contract (actual Studio composition root)

`createServer({operator, modelConnections?})` constructs the registry once at startup when none is injected. There is no implicit Anthropic/default-provider selection. Startup without any model selection supports authenticated local workspace authoring/execution; only model-backed routes fail closed.

- Authenticate with the existing operator bearer token **before** listing descriptors, reading server selection, resolving a client, loading project context, or spending a model call.
- `GET /api/studio/model-connections` → `{connections: ModelConnectionDescriptor[], selectedId: ModelConnectionId | null}`. The four IDs are `codex-chatgpt`, `flightdeck`, `local`, `anthropic`. `selectedId` is the server's explicit default, not a claim that the connection is usable. Listing never probes or bills.
- `POST /api/studio/create`, `POST /api/studio/build`, `POST /api/studio/blocks/propose` accept **only** `connectionId` as the model selection field, alongside their existing strict request fields. Send the chosen ID on every request, including clarification and reviewed-skill resubmissions. Omission is supported only with an explicit server `selectedId` (apart from the server-only trusted fixture seam below).
- Malformed/unknown/null IDs and endpoint/model/key/binding overrides return 400 before resolution. Unauthenticated requests return 401 before configuration use. No selected ID returns **409** `{status:"model-connection-unselected",error:"select a model connection"}`. A known but unavailable selection returns **409** `{status:"model-connection-unavailable",error:"selected model connection unavailable"}`. No model calls are made for these failures; never silently switch providers.
- Each accepted request resolves its connection once and retains that exact client throughout classifier, sub-app/workflow planner, graph drafting, or block proposal. All existing intake grants, pseudonymisation, provenance, human review and output checks still apply. The pipelines gate the input boundary; do not double-gate planner scaffolding with another wrapper.
- `GET /api/studio/health` without valid authentication returns only `{ok:true}`. Authenticated health returns `{ok:true,selectedId,model,modelStatus:"configured"|"unavailable"|"unselected",verification:"not-probed"}`. It reveals neither endpoints nor secrets and makes no live-completion claim.

## Frontend contract and exercised UI

The actual `src/studio/StudioApp.tsx` composer exposes all four IDs, including disabled unavailable destinations and their reasons. Operator token and project changes immediately clear descriptor state, selection, clarification answers and skill-send review, abort outstanding checks/model proposals, and suppress stale responses. Changing destination also resets the controller's original request/result and pending approval; it does not reset the deterministic workspace or edit document.

`Check connection & project skills` explicitly authenticates same-origin, no-store health, descriptor and project-skill reads without model calls. The browser-only descriptor client validates the updated authenticated health contract against a strict four-unique-ID DTO and selected default, rejects unknown fields/unsafe URL-bearing text, and incrementally caps response bytes at 32 KB. Public `{ok:true}` liveness is not accepted as authenticated configuration. No endpoints, secrets, transport functions or raw errors are rendered. Tokens stay in React/controller memory only; no model keys or browser storage are used.

There is no first-configured-provider fallback. A server `selectedId` is shown as an **explicit server default**; an absent default leaves the selection empty even when other providers are configured. `configured` is displayed alongside `not-probed`, explicitly **not connected/verified**. Creation and AI block proposals require an authenticated checked configured selection. Create, clarification, reviewed-skill resubmission, workbench regeneration and block proposal bodies carry the exact `connectionId`. HTTP 409 is a sanitized selection/configuration refusal, not a pipeline result or permission to fall back. Block DTOs require the real `reviewRequired:true` contract and are bounded/validated before the editor's separate human reuse review.

The editor and saved workspace remain mounted in hidden sections across builder navigation. Typed graphs, run input and saved identity survive navigation and destination changes. Workspace loading remounts only the graph editor (`editorRevision`), not the workspace document; AI graph replacement changes the workspace document key explicitly. Saved deterministic operations do not require a selected model. `/demo` visibly explains missing backend credentials and remains a usable unauthenticated local editor; it makes no connection/completion claim.

Verification includes a Fastify-injected frontend HTTP contract test with a scratch file-backed workspace and local transport fixtures, plus `src/studio/__tests__/model-ui.browser.tsx`, an explicitly invoked browser-only mounted React fixture harness. The latter checks actual create/answer/review/regeneration/block controls, descriptor credential races, late-result suppression, mounted state retention, saved identity readback and workspace-load remount behavior. It is not imported by the production entry. These are DTO/transport fixtures, **not live completions**. The running uncredentialed Vite demo was also exercised independently. A credentialed live smoke remains blocked by the absence of an actual operator credential/configured live service; neither an actor nor a key was invented.


**Review binding:** the server-only `StudioCreateDeps.modelBindingId` hashes the resolved ID, model and registry `bindingId`. Version-2 skill-send review includes that identity plus purpose/operator/project/protected prompt/exact protected skill bytes. Changing ID, model, destination endpoint or approved policy/bridge identity invalidates the old review even when all content and the human are unchanged. Neither the server binding nor endpoint is returned in the review packet. Pure existing pipeline callers may omit the optional dependency for compatibility; the real HTTP server always supplies it.

**Trusted tests/clients:** `ServerOptions.llm` remains a server-code-only injection seam, cannot coexist with `modelConnections`, and now requires an explicit nonempty `llmBindingId` for destination/model/policy identity even in fixture tests. This seam cannot be selected by a browser ID and is never constructed from environment/browser configuration. Trusted clients must revise their binding when destination/model/policy changes. Existing route fixtures use an explicit fixture binding; they are not live model responses.

## Registry API

```ts
const connections = createModelConnections({env: process.env});
const {llm, descriptor, bindingId} = connections.resolve(connectionId);
// Server-only binding combines descriptor.id, descriptor.model and bindingId.
// Invoke llm only through the existing privacy/provenance/authorization gate.
```

- `descriptors` is an immutable browser-safe list of `{id,label,model,status,verification,reason?}`. It contains no endpoint, native-home path, secret, native stdout/stderr or provider errors.
- `resolve(id)` returns immutable **server-only** `{descriptor,bindingId,llm}` or throws `Unknown model connection` / `Model connection unavailable`.
- `selectedId` comes only from `STUDIO_MODEL_CONNECTION`. It is optional; there is **no automatic default**. `resolveSelected()` throws `No model connection selected` when unset. Unknown configured IDs fail construction with `Unknown model connection selection`.
- Known but unavailable selection fails closed. Do not fall back to another ID, Anthropic, OpenAI API, or another destination on subscription limits or transport failures.
- Callers may select only an ID. Never accept endpoint, secret, executable, environment, client/transport function, model override or bridge configuration from browser request bodies or model-generated graphs.
- Output is bounded JSON-object text (256,000 UTF-8 bytes); truncated replies retain `truncated: true` and are not parsed. Errors become `Model connection request failed`, without raw provider text or causes. This is output validation, **not** authorization or a replacement for `gatedPlannerLlm`.
- `bindingId` is SHA-256 over versioned nonsecret ID, destination/policy and model. It changes when endpoint/model changes; Anthropic effort is included. Secret rotation does not change it. Keep it server-side and bind it to reviewed context. Rebuild the registry and invalidate old reviews when configuration changes. An approved Flightdeck bridge must change its supplied binding identity when its gateway/provider/model/task contract/policy changes; it must refuse runtime drift rather than sending to a new target under an old review.

## Four destinations

| ID | Server configuration | Current behavior |
| --- | --- | --- |
| `codex-chatgpt` | Native official Codex CLI login; no extracted OAuth/token configuration | **Unavailable: zero-tool boundary not verified.** Native auth can be explicitly probed without billing. No subscription completion is executed. |
| `flightdeck` | Future trusted injected `flightdeckLlm`, `flightdeckModel`, `flightdeckBindingId` | Unavailable unless an approved bridge is supplied at server startup. No invented HTTP endpoint, gateway-token forwarding or generic chat conversion. |
| `local` | `STUDIO_LOCAL_BASE_URL`, `STUDIO_LOCAL_MODEL`; optional server secret `STUDIO_LOCAL_API_KEY` | Nonstreaming OpenAI-compatible `POST <base>/chat/completions`. Requires an actual configured/installed model; no model ID or installation is fabricated. |
| `anthropic` | `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`; `STUDIO_ANTHROPIC_MODEL` (legacy `FLIGHTDECK_MODEL`, otherwise existing provider default); optional `FLIGHTDECK_EFFORT` | Existing `AnthropicProvider` and `plannerLlm` bridge, official SDK, fixed `https://api.anthropic.com`, explicit supplied credentials, no OAuth-file inspection. API usage is separately billed. |

`STUDIO_MODEL_CONNECTION` accepts exactly the IDs above. Invalid per-connection configuration is reported as unavailable with a fixed sanitized reason. Invalid model names, empty credentials and unsupported Anthropic effort do not become silently defaulted values. `localFetch` and `anthropicClient` are trusted injection seams, used by transport/SDK **fixture tests**, not browser configuration or production fake responses.

## Local/OpenAI-compatible safety

`packages/providers/src/openai-compatible.ts` exports `openAiCompatibleLlm`, `CancelablePlannerLlm`, `OpenAiCompatibleOptions`, and model/destination validators. Remote URLs must be HTTPS; HTTP is accepted only for literal `127.0.0.1` or `[::1]`. `localhost`, alternate numeric IP spellings, URL-parser authority tricks, inline credentials (even an empty user-info component), query strings, fragments and non-HTTP(S) URLs are rejected. The configured path is the API base, typically `/v1`.

The adapter sets `redirect: "error"`: credentials are never forwarded to another origin or redirected URL. Requests have one protected system turn and one protected user turn, `stream:false`, `response_format:{type:"json_object"}`, `max_tokens:16000`; there are no tools or function definitions. Tool-call responses and unknown stop reasons fail closed. There is a 30-second default deadline covering transport and body consumption, optional per-call `signal`, 256,000-byte request bound, 256,000-byte default response bound, incremental response-byte counting, cancellation and sanitized errors. Trusted direct adapter options may reduce/increase deadline up to 120 seconds and response size up to 1,000,000 bytes; the registry still enforces its own 256,000-byte completion boundary.

This is an OpenAI-compatible adapter, not proof every local server supports this exact JSON mode. Unsupported servers fail rather than retry with a weaker format. It does not discover installed models, start a model service, or assert live connectivity.

## Native subscription blocker and explicit probe

OpenAI documents ChatGPT subscription access through the official Codex CLI, separately from API billing. Native CLI auth remains owned by Codex; Studio never reads, copies, prints or imports `auth.json` (Codex or Hermes), browser cookies, OAuth tokens or token caches.

The installed CLI was checked as `codex-cli 0.162.1`. `exec --help` supports `--ignore-user-config`, `--ignore-rules`, `--ephemeral`, `--skip-git-repo-check`, read-only sandbox, JSONL events, output schema and stdin prompts. Its feature listing includes shell, unified exec, apps/plugins/hooks, browser/image tools and multi-agent tools. Official configuration documents `features.shell_tool=false`, `web_search="disabled"`, `project_doc_max_bytes=0`, and environment inheritance controls. However, the current official `codex-rs/core/src/tools/spec_plan.rs` registers `ApplyPatchHandler` separately when the model advertises apply-patch support; turning off the shell is **not** a demonstrated zero-tool mode. Model-driven utility tools also require auditing. That source audit is not proof of the exact installed binary's runtime tool set. No enforceable, supported zero-tool execution boundary was established for this installation, so `codexSubscriptionLlm()` deliberately throws `CODEX_SAFETY_BLOCKER` without spawning a model session. This is a real safety blocker, not a ready provider, synthetic completion, or permission to weaken policy.

`probeCodexSubscription({privateLocal:true, ...})` explicitly executes only native `--version` and `login status`, without a model request. The `privateLocal` value must be set by authenticated local server startup policy, never by an HTTP body. It is not itself network authentication. Do not expose subscription tooling to public/untrusted HTTP. The probe uses no shell, a private owned temporary cwd, only `HOME`/`PATH`/`CODEX_HOME` in the child environment, a 5-second deadline per native command, a 16,384-byte output bound, SIGKILL on timeout/overflow and cleanup. Native output is parsed into safe version/authenticated booleans, never returned. API-key login does not count as subscription login. Merely listing connections never calls this probe.

A future executable subscription implementation requires a verified zero-tool policy **before any prompt is sent**; isolated owned scratch cwd; no project/skill/file context; managed enterprise policy preserved; user MCP/apps/plugins/hooks/web/multiagent disabled; environment filtered; protected `PlannerRequest` passed only on stdin; output schema, strict bounded JSON/event handling; process-group cleanup; and fail-closed handling of any tool event, malformed/truncated output or nonzero exit. Never use dangerous bypass flags, post-hoc tool-event detection as the only safety layer, fabricated model catalogs, extracted subscription credentials, or a different billable API as fallback.

## Actual Flightdeck host protocol (not OpenAI-compatible)

Inspected host paths, relative to the separate Flightdeck host checkout:

- `flightdeck/server/services/ai/gateway.ts`: `callAiProvider(deps, {task,facts}, redactOpts)` is the sole internal outbound call site. It accepts DB/root/actor scope and authenticates the host to its **own edge gateway** with `FLIGHTDECK_AI_GATEWAY_TOKEN`; provider credentials stay in the edge function. There is no generic public planner-completion route.
- `flightdeck/server/services/ai/config.ts`: live-instance/admin gates, approved non-vendor gateway URL, selected provider/model and recorded human approval must remain authoritative.
- `flightdeck/server/services/ai/envelope.ts`: closed compiled task/fact vocabulary, at most two text facts of 2,000 characters each, final PII scan. The task list contains `map.suggest`, `intake.fieldmap`, `kb.question`; **no Studio planner task exists**.
- `flightdeck/web/src/modelRegistry.ts`: browser on-device models, not the server gateway.

The current service is **not yet wired for arbitrary Studio PlannerRequests**. Do not relabel Studio planning as KB/maps/intake work, increase fact limits, serialize an arbitrary prompt into ordinary chat, forward gateway tokens into this app/browser, or bypass the host envelope/approval/audit gates. Until a named approved host task/SDK contract exists, leave `flightdeckLlm` unset. A future bridge must establish scope/identity, reviewed exact facts, host-envelope authority, binding stability and a validated completion mapping to the structural `PlannerLlmLike` contract. Supplying that future trusted seam does not establish an integration today.

## Verified versus unavailable

- Real nonbilling native adapter probe: `{installed:true, version:"0.162.1", authenticated:true, usable:false}`. Subscription completion smoke **not run** because the safety prerequisite failed. No billed/model request was made by this implementation.
- OpenAI-compatible adapter: injected transport fixtures test request shape, URL policy, redirect rejection, invalid JSON/tool output, truncation, deadline/cancellation, response-byte bound, request bound and sanitized errors. These are **not** live model completions.
- Anthropic registry: injected SDK fixture exercises the existing real provider bridge; no live API credential was available and no live API connection is claimed.
- Flightdeck registry: approved-bridge fixtures only; actual host Studio task contract is missing.
- Local service: no configured live model/service was available during this work. No installed model is claimed.

Official references: OpenAI Codex authentication (`https://developers.openai.com/codex/auth`), configuration (`https://developers.openai.com/codex/config-reference`), and source (`https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/spec_plan.rs`). Re-audit actual installed CLI support and enforced policy before enabling subscription completion.
