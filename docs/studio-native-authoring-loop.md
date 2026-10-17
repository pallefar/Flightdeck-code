# Bounded native authoring loop and sub-app spec broker

This supplements the earlier, one-turn-only `studio-authoring-broker-v1.md` boundary. The new library modules provide a serial loop and a **separate** two-tool sub-app broker. They do not mount a server route, activate a model connection, generate source, persist drafts, grant capabilities, approve anything or deploy an application. The original workflow broker's executable/model-visible registry remains unchanged.

## Public interface

Exports are available from `packages/authoring-harness/src/index.ts`:

- `createSubappDraftBroker({binding, limits, authorize, protectedGraph:null})`
- `SubappBrokerOptions`, `SubappDraftBroker`, `SubappDraftSpec`, `SubappSpecReceipt`
- `runAuthoringLoop({broker, port, messages, terminalToolNames, bounds?, signal?})`
- `AuthoringPort`, `AuthoringLoopOptions`, `AuthoringLoopResult`, `AuthoringLoopBounds`, `TerminalToolName`, `WorkflowDraftReceipt`, `AUTHORING_LOOP_BOUNDS`

A sub-app broker has the same structural interface as `DraftBroker`: deeply frozen `tools`, `invoke`, `invokeNative`, `events`, `snapshot`, `close`. It registers its actual `Run` in the existing private `runs` WeakMap. `createAnthropicToolPort` therefore accepts it without another ledger, provider port, handler injection or budget override. `Run` receives only its existing allowed options, with `protectedGraph:null`.

The loop's discriminated result is:

```ts
{
  terminalToolName: 'propose_workflow_draft' | 'propose_subapp_spec',
  receipt: WorkflowDraftReceipt | SubappSpecReceipt,
  turns: number,
  events: readonly MetadataEvent[],
  snapshot: /* the broker's metadata-only Run snapshot */
}
```

`terminalToolName` narrows the receipt type. No messages, thinking, signatures, provider bodies or history are returned. A workflow receipt has `status:'draft-proposed'` and `graph`. A sub-app receipt is inert JSON:

```ts
{
  status: 'subapp-spec-proposed',
  spec: /* the parsed bounded generator-native spec */,
  understanding: /* bounded explanatory text */,
  executed: false,
  approved: false,
  deployed: false
}
```

It is deliberately **not** `GeneratedSubApp`: that type contains non-JSON registry-patch functions. No generator/emitter/apply API is called by this broker.

## Separate sub-app proposal language

Only these names are registered:

| Tool | Input | Output |
|---|---|---|
| `read_subapp_contract` | `{}` | Actual fixed proposal input schema, static source vocabulary and explicit limitations; **not** host policy/discovery |
| `propose_subapp_spec` | `{spec, understanding}` | The terminal inert spec receipt above |

The schema is sourced from `packages/codegen/src/spec-contract.ts`. Every complete proposal passes the bounded subset and the **actual `miniAppSpecSchema`** before return. This is schema admission, not proof of successful generator planning, conformance, build or host availability. The parent pipeline remains responsible for generation and its existing validation/review gates.

All selected fields are explicit and required:

- Spec: `profile:'mini-app'`, `id`, `label`, `icon`, `navSection`, `summary`, `capabilities`, `visibleToRoles`, `domains`.
- Domain: `name`, `title`, `routes`.
- Route: `method`, bounded HTTP `path`, `summary`, `operation`.
- GET operations: `{kind:'list-contracts'}` or `{kind:'list-proposals'}`.
- POST operation: `{kind:'propose', proposalKind, ticketField, fields, auditEvent}`.
- Scalar field: `{name, optional:boolean, type:'string'|'integer'|'number'|'boolean'}`.
- Enum field: `{name, optional:boolean, type:'enum', values}`.
- `understanding`: 1–4000 characters.

There are at most 6 domains, 12 routes per domain, 20 fields per form, 20 enum values per field, 2 capabilities and 5 visible roles. Every string/array has a finite bound. Capability, role and navigation values come from the generator's actual closed enums; additional authority labels are not accepted. Sensitive/unsafe field names are refused by the existing `safeMappingKey` rule. The native schema is structural; runtime refinements remain authoritative.

Tables, table-backed profiles, settings panels, workflow/source metadata, arbitrary code, files, filesystem paths, credential fields, per-field patterns/column mappings, module-path overrides and additional properties are unsupported. The `path` above is only the generator's bounded HTTP route syntax, never a filesystem destination. No custom executable callbacks or extension registry exist.

The new required-field native schema projector is linear in the selected schema tree. It does not expand optional-key combinations. Unsupported/open/unbounded schemas fail closed rather than silently becoming permissive JSON Schema.

### Declarations are not authority

`capabilities`, `visibleToRoles` and navigation are **proposed metadata**, not grants. The static vocabulary is not evidence that the actor, project or host may use those values. The trusted parent pipeline must compare the proposal with source evidence and explicit human answers/consent **before source generation**. No model tool collects independent approval, changes audience policy or manufactures missing evidence. Actual host policy and effect-time grants remain outside the harness.

Policy callbacks and metadata events use the truthful operation names `read_subapp_contract` / `propose_subapp_spec`; they are never aliased to workflow tools. All seven binding values and every before/after/return policy stage remain enforced by the same accepted `Run` implementation.

## Loop admission and native protocol

The loop requires a freshly constructed, registered broker with no prior tool calls, model calls or pending work. Start with bounded text-only history ending in a user message. There is no imported signed/tool history, resume or checkpoint API. Do not pre-read tools on that broker before handing it to the loop. Only one loop may own it; a competing invocation is refused without closing the owner.

`terminalToolNames` must contain **exactly one** of `propose_workflow_draft` or `propose_subapp_spec`, matching the broker's exact fixed registry. Arbitrary terminal names, mixed registries, extra loop options and unsupported tools deny. The trusted port callable is pinned before policy waits. The trusted composition owner must bind the port to this broker and selected destination; an arbitrary custom port is not confined by this API.

Before **any callback** for a response, the loop validates:

- The complete closed completion wrapper and native message shape, model identity and supported block forms.
- `stop_reason:'tool_use'`, at least one real tool call, and null stop-sequence/details metadata.
- Every tool name and every tool input in the **entire** batch against this broker's fixed schemas.
- Unique tool IDs within that response and no reused IDs across the owned run.
- A proposal is the sole tool call, never one member of a read/proposal/unknown-tool batch.
- Remaining full-batch tool capacity and known history/message bounds.

`max_tokens`, `model_context_window_exceeded` and explicit truncation refuse without parsing/dispatching opaque partial tool input or making a continuation call. `end_turn`, refusal, pause and stop-sequence replies are not receipts and are rejected. A textual claim of success is never accepted.

The original assistant block array is copied without normalization: all thinking/redacted/text/tool fields, property order and block order survive. Nonterminal results are appended, in original tool-call order, as the first and only blocks of the immediately following user message. No text conversion, repair, auxiliary call, compaction, fallback, parallel callback, retry or delegation occurs. A validated broker proposal receipt ends the loop **locally**, without sending the proposal or asking the model for final prose.

## Bounds and lifetime

Default hard ceilings (optional `bounds` may only reduce them):

| Bound | Maximum |
|---|---:|
| `maxTurns` | 32 |
| `maxMessages` | 100 |
| `maxHistoryBytes` | 512000 |
| `maxCumulativeBytes` | 4000000 |

The effective history ceiling also cannot exceed `Run.maxInputBytes`; turns cannot exceed `Run.maxModelCalls`. Cumulative accounting includes each sent `{messages}` history envelope, received native completion and broker tool result. The native port independently bounds the full vendor envelope including fixed system/tools and raw response bytes; the loop counter is not a vendor billing meter or a total-input-token guarantee. Shared Run output/token reservations, tool/model limits, event limits, deadline and authorization are not replaced by loop bounds.

For the parent's six-call root policy, use `bounds:{maxTurns:6}`, a broker with `maxModelCalls:6`, and the root-owned closure that also counts preceding JSON determination/metadata calls before allowing any next send. The loop alone cannot account for model calls made outside its broker. The root's native capability factory and exact-context send consent are separate composition-owner responsibilities.

On success, refusal, malformed protocol, budget failure and cancellation, the loop **awaits `broker.close()` before settling**. It forwards a native AbortSignal and never races original work against an early cancellation return. A wrapper that rejects before the original SDK/fetch work settles still cannot release the loop while that work remains in the shared ledger. Ignored aborts can keep close pending indefinitely; retain the original admission permit and report incomplete drain rather than resetting capacity or automatically retrying.

Errors are new fixed `AuthoringError` instances with only an allowed code/category and no original message/cause. Metadata events remain the broker's bounded sanitized event stream. The terminal spec/graph and understanding remain private application data; do not put receipts or the exact send-review envelope into diagnostics.

## Composition example (trusted prerequisites, not a new root)

```ts
const broker = createSubappDraftBroker({
  binding: authenticatedExactContextBinding,
  limits: explicitSharedLimits,
  authorize: freshDenyDefaultPolicy,
  protectedGraph: null,
});
const port = createAnthropicToolPort({
  broker,
  client: alreadyBuiltTrustedAnthropicClient,
  system: exactApprovedSystemText,
  effort: 'high',
});
const result = await runAuthoringLoop({
  broker, port,
  messages: approvedNativeInitialMessages,
  terminalToolNames: ['propose_subapp_spec'],
  bounds: { maxTurns: 6 },
  signal: requestSignal,
});
// Only after the awaited loop/drain may its owner release admission.
// Separately validate source evidence and human metadata consent before generation.
```

None of the authority/client/message identifiers in this example is supplied by the model or implemented by this library. The existing provider-port restrictions still apply, including diagnostics off, trusted preconstructed SDK/transport, zero retries and exact per-send review. There is no Deep Agents installation, credential discovery, hostile-code isolation, production host integration or live-provider acceptance claim.

## Verification

Use already-installed dependencies, with no provider/network credentials:

```sh
./node_modules/.bin/vitest run packages/authoring-harness/tests --maxWorkers=1
./node_modules/.bin/tsc -p packages/authoring-harness/tsconfig.json
./node_modules/.bin/tsc -p packages/authoring-harness/tsconfig.json --skipLibCheck false
```

The two new test files exercise the actual installed Anthropic SDK with synthetic fake fetch as well as deliberately malformed trusted fixture ports. Tests cover the full stop set, mixed unknown/invalid batches with zero callbacks, duplicate/reused IDs, terminal-batch refusal, byte/history/call/token limits, exact signed-block/result order, truthful sub-app policy actions, closed schemas, input pinning, fixed errors, cancellation and original-work settlement. They are local library evidence, not live model, root/privacy pipeline, UI, source-generation or deployment acceptance.
