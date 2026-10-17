# Workflow draft core and editor

## Integration

```tsx
import { WorkflowEditor, createGraphFromWorkflowSteps } from './workflow';
<WorkflowEditor
  key={documentId}
  initialGraph={createGraphFromWorkflowSteps(legacyWorkflow)}
  onChange={(validatedGraph) => setDraft(validatedGraph)}
/>
```

`WorkflowEditorProps`:
- `initialGraph?: Graph`: initial document only; remount with a new key to load parent changes.
- `onChange?: (graph: Graph) => void`: called initially and after each accepted graph revision.
- `onRequestBlock?: ({prompt: string, graph: Graph}) => Promise<unknown>`: optional guarded server port returning a CustomBlock object (or JSON string). The response is strictly parsed, shown for review, and never automatically added.
- `executionAdapters?: ExecutionAdapters`: optional trusted parent adapters. Omitted by default; local connector/model runs are blocked. No browser human-authorization form exists.

Exports are available from `src/workflow/index.ts` (editor + all core exports) and `packages/workflow/index.ts` (core only). `createWorkflowTemplate('approval'|'branch'|'http')` makes an actual editable connected draft. `createGraphFromWorkflowSteps({name,steps,statutorySteps?,slug?})` converts string steps into manual → explicit unconfigured steps / required approval gates → output. It does not guess business logic or reviewers.

## Graph and safety

Exact version-1 fields: `{version:1,id,name,nodes,edges,customBlocks}`. Node: `{id,type,label,position:{x,y},config,inputMappings?}`. Edge: `{id,source,target,sourcePort?:'default'|'true'|'false'}`. CustomBlock: `{id,label,baseType,defaults,description}`; base type is HTTP, LLM, set, branch or output only. IDs are ASCII letter-leading identifiers up to 64 characters. Node, edge and custom-definition IDs are unique within their collection. Configs are strictly validated against the builtin base schema, including custom overrides. Unknown keys/types, cycles, dangling edges, unsafe ports, secret-bearing fields and inline URL credentials are refused.

`graphSchema`, `customBlockSchema`, `configSchemas`, `validateGraph`, `builtinRegistry`, `createEmptyGraph`, `resolveNode` and their `Graph`, `GraphNode`, `CustomBlock`, `BuiltinType`, `Json` types are public. Structurally valid draft configs may be incomplete; execution then blocks with a reason. HTTP uses only HTTPS URLs without userinfo, query or fragments. All actual credentials live behind the adapter's vault resolution of `credentialRef`.

No graph configuration is executed as JavaScript. Secret-field and common-secret-format screening is defense in depth, not a general secret detector: do not paste secrets into labels, descriptions, prompts or arbitrary data. No localStorage persistence or publication occurs. Draft JSON contains the entered configs and should be reviewed before sharing.

The editor prevents deleting/retyping existing approval nodes and importing a revision that removes them. Undo can retract a newly authored draft addition; New workflow/templates explicitly open a new document. These draft editing policies do not constitute an immutable server audit trail. Before accepting changes to an existing authoritative workflow, the parent must enforce its own gate-preservation/review policy.

## AI draft port

```ts
const result = await proposeWorkflowGraph(prompt, skills, planner);
```

`PlannerLlm = (request: {system:string,user:string,purpose:'draft',attempt:1}) => Promise<unknown>`.
`PlannerSkill = {id:string,content?:string,version?:string}`.
Result: `{status:'proposed',graph:Graph,reviewRequired:true}` or `{status:'refused',issues:string[]}`. Raw objects and strict JSON strings are accepted, never markdown/code. Invalid/unknown/unsafe output and planner errors fail closed. There is no raw network/filesystem IO, credential handling, retry or deployment. The parent supplies guarded LLM execution and trusted project-context provenance. Skill text/prompt are explicitly untrusted context.

## Bounded execution

```ts
const runner = createWorkflowRunner(graph, adapters, {initiator: authenticatedCreator});
const result = await runner.run({requestId:'request1'});
// A trusted server, NOT the model or graph, supplies authenticated human authorization:
const continued = await runner.resume(result, {humanName: authenticatedReviewer, proof: verifierProof});
```

`run` returns `{status:'completed'|'paused'|'blocked',output:Json,trace:TraceEntry[],pendingNodeId?,reason?}`. `TraceEntry` has `{nodeId,status:'completed'|'skipped'|'paused'|'blocked',message?,humanName?,details?}`.

- Deterministic topological order; one manual root; terminal output; multiple active inputs block (no implicit merge).
- Branch equals/exists selects true/false ports and skips inactive paths. Set declaratively merges object fields. All outputs and seeds are bounded validated JSON.
- HTTP adapter gets `{url,method,credentialRef,body?,input,signal}`. It must actually resolve the credential in a trusted vault and enforce allowlisted destination/SSRF/redirect rules; the core performs no HTTP IO.
- LLM adapter gets `{instruction,model?,input,signal}`. No autonomous arbitrary tools are implied.
- Missing config/adapters or unsupported legacy steps block rather than manufacture responses.
- Human approval always pauses. `authorizeHuman(authorization,{graphId,nodeId,reviewer,initiator,signal})` is a trusted independent verifier. An explicit initiator, nonempty named human distinct from that initiator and successful verifier are mandatory. Graph reviewer settings never grant approval.
- Graphs with paths bypassing any required approval are refused before adapter execution. Pause results are runner-instance-bound opaque capabilities, held internally in a WeakMap: copied/forged/replayed resumes are refused and concurrent successful resumes of the same result cannot replay downstream steps. Private restart-safe checkpoints are explicit opt-in; see the contract below.
- `RunnerOptions`: `initiator?`, `timeoutMs?` (default 5s, max 30s per adapter), `maxSteps?` (default/max 100), `maxDataBytes?` (default 100,000, max 1,000,000 serialized characters), `captureData?` (default false). Data preflight additionally bounds structural depth to 256 and visited JSON values to 100,000; rejects cycles, accessor/nonenumerable/symbol properties, custom object prototypes and sparse/extended arrays before recursive validation. Ordinary shared subtrees are accepted and cloned. Adapters get AbortSignal on timeout, but external side effects already started may have occurred; there is no automatic retry or rollback.

Tests supply small explicit HTTP/LLM adapters only as test fixtures. Production has no synthetic connector responses, no secret storage, and no deployment claims.

## Private restart-safe approval checkpoints

```ts
const checkpoint: WorkflowCheckpoint = runner.checkpoint(pausedResult);
// Trusted server persists this privately with a separate run/review/CAS record.
// Following restart, construct with the SAME parsed graph and effective options:
const reconstructed = createWorkflowRunner(graph, trustedAdapters, options);
const pausedAgain = reconstructed.restore(JSON.parse(storedCheckpointJson));
// restore never runs a node, verifies a human, or approves anything.
// Only AFTER server-owned authentication, exact review binding and durable CAS:
const next = await reconstructed.resume(pausedAgain, authenticatedAuthorization);
// If next is paused at another gate, checkpoint(next) stores the new cursor.
```

Contract:
- `checkpoint(pausedResult): WorkflowCheckpoint` throws unless passed the exact currently live pause result owned by that runner. Copies, other runners' results, completed/blocked and consumed results cannot export state. Returned checkpoints are detached JSON objects and may be JSON-roundtripped/copied for private storage.
- `restore(checkpoint: unknown): RunResult` synchronously throws for invalid state/binding. A valid restore returns a fresh **paused** result owned by the reconstructed runner's WeakMap. It does not call HTTP, Resource, LLM, human verifier, or execute any downstream node. `resume` still requires a named, independently authenticated human different from the original initiator and the injected trusted verifier. Neither checkpoint nor output nor trace is an authorization proof.
- Version 1 stores `{version,graphBinding,options,index,steps,seed,values,branches,trace,output,pending}`. `values`/`branches` are bounded `[nodeId,value]` tuples; `pending` is `{nodeId,data}`. `graphBinding` is the full deterministic ordered representation of the exact parsed graph (preserved object-key and array order, because branch equality uses ordered JSON), not merely graph ID or an unauthenticated digest. Configs, custom defaults, mappings, edge ports, gates, labels and positions all bind. `options` stores the exact initiator and effective timeout/step/data/capture settings; different bindings are refused. Adapter functions/credentials and authorization proofs are never serialized.
- The checkpoint holds **actual private execution data** needed to continue, even with `captureData:false`; it is not a scrubbed diagnostic record or browser DTO. Default trace payload capture remains off. Paused/completed timings and branch metadata are retained. Persist only in bounded private server storage, never public history, browser storage, logs or model prompts. Existing JSON secret screening is defense in depth, not a privacy guarantee.
- Public browser-pure `workflowCheckpointSchema`, `parseWorkflowCheckpoint`, `WorkflowCheckpoint`, `WORKFLOW_CHECKPOINT_MAX_BYTES` perform strict envelope validation. Before recursive Zod: maximum 4,000,000 UTF-8 serialized bytes, depth 264, 200,000 visited values, 100 elements per array; reject accessors, custom prototypes, cycles, symbols, nonenumerable/prototype keys and sparse/extended arrays. Execution data also retains its original per-value character/depth/node bounds. A live run may be too large to checkpoint; export fails closed without changing the pause.
- Restore additionally validates graph admission, topological cursor and exact trace prefix, completed/skipped status, executed-node references, duplicate IDs, steps, mapping availability, pending input, computed declarative values and branch selections. It recomputes only pure manual/set/branch/approval/output data for consistency; it **never replays adapters**. Previously approved trace names are checked for initiator independence but are not reauthenticated. Adapter outputs are opaque persisted facts: coherent malicious edits to those facts or past approval history cannot be cryptographically detected by this schema. Private provenance/integrity and exact external review binding are mandatory.
- **Durable global replay control remains the server's responsibility.** Resuming the same live result concurrently consumes its capability before downstream side effects, but restoring copies of the same checkpoint (in the same or different runners/processes) creates separate capabilities. The core provides no global one-time flag, cross-process lock, request identity, authenticated storage or transaction. The server must atomically claim/consume its separately authenticated, review-bound run/gate revision with durable CAS **before** calling resume, and persist the next checkpoint/result with that identity. Never accept client-supplied checkpoint fields, `trusted:true`, human labels, request IDs or proofs as storage/review authority. Do not auto-retry after an uncertain side effect or crash between effect and persistence; CAS alone does not provide transactional exactly-once external effects.

## Declarative input mappings

Public exports: `inputMappingSchema`, `inputMappingSourceSchema`, `InputMapping`, `InputMappingSource`; `GraphNode.inputMappings?: InputMapping[]`.

```ts
node.inputMappings = [
  {target:'item', source:{kind:'input', path:['items', 0]}},
  {target:'score', source:{kind:'node', nodeId:'classify', path:['result','score']}},
  {target:'category', source:{kind:'literal', value:'review'}},
];
```

- Omitted/undefined mappings retain existing incoming-input behavior. Present mappings replace input with exactly the selected top-level object; `[]` explicitly produces `{}`. Set merges its configured fields into that mapped object; branch/output and injected adapters consume mapped data. HTTP `config.body` remains a separate explicit body, never synthesized from mappings.
- `input` always means the original validated run seed, not the immediate predecessor. `node` means the validated output of an already executed graph ancestor. Self, downstream, absent and unrelated-branch references fail static graph validation. An ancestor skipped by a branch or a missing runtime path blocks with `MAPPING_SOURCE_UNAVAILABLE`, without fallback. Mapping does not activate paths or change the existing multiple-active-input prohibition.
- Maximum 100 mappings per node; duplicate targets forbidden. Targets follow config field spelling (ASCII letter followed by letters/digits/underscores, at most 64 characters), rejecting prototype/secret fields; `credentialRef` is a reference-only exception, as in config fields. Paths have at most 16 segments: own object keys are strings of 1–64 characters, own array indices are integers 0–99. Array properties/string indices and numeric object keys do not resolve. Prototype/secret/credential path segments are forbidden, including `credentialRef`. Empty paths select the whole source.
- Literal preflight occurs **before** recursive JSON parsing: at most 10,000 UTF-8 serialized bytes, depth 16, 2,000 visited values; existing JSON string/array bounds and inline-secret screening still apply. Cycles, prototype-bearing objects, getters, sparse arrays and prototype keys fail closed. References to ordinary shared JSON subtrees are safe and cloned.
- Only Resource/HTTP/LLM/set/branch/output and reviewed wrappers with the existing HTTP/LLM/set/branch/output bases accept mappings. Resource wrappers remain unsupported until separately reviewed. Manual triggers, approvals and unconfigured placeholders reject them, including `[]`. Gate preservation, independent-human verification and pause replay protection remain unchanged.
- Strings are literal data: no interpolation, expressions, eval, generated code, implicit credentials or network behavior.

## Reviewed Resource invocation

Builtin `resource` stores only strict `{resourceId?: UUID, revision?: positive safe integer, functionId?: safe identifier}`. UUIDs are preserved exactly, not normalized or subjected to graph-ID spelling rules. Defaults are `{}`; incomplete references are valid drafts but execution blocks with `CONFIG_REQUIRED`. No endpoint, headers, credentials, model override, actor/project, or stored parameters are allowed in this config. The typed settings expose all three reference fields; Apply converts only canonical positive-integer revision text into the numeric graph value and validates UUID/function ID without trimming.

`ExecutionAdapters.resource?: (request: {resourceId:string; revision:number; functionId:string; parameters:Json; signal:AbortSignal}) => Promise<Json>` is an injected trusted adapter, not a built-in network client. The server composition root must bind the authenticated actor/project outside the graph and resolve/recheck the exact active revision, independently reviewed read-only REST/MCP function, registry/policy fingerprint, current grants and parameter/output schemas. Graph drafts and model proposals cannot authorize or activate Resources. The adapter should return the invocation's validated JSON output (not its registry execution metadata envelope).

The actual mapped object (or unchanged incoming object when mappings are absent) is cloned and passed as `parameters`. Nonobject input blocks with `INPUT_INVALID`. Missing adapters block with `ADAPTER_UNCONFIGURED` and cause no network IO. Existing bounded timeout, AbortSignal, output cloning/data limits, ancestry/literal restrictions and approval gates apply unchanged. Trusted adapter rejection—including stale revision or denied authorization—is reported as fixed `ADAPTER_ERROR`, never raw registry/transport errors; timeouts use `ADAPTER_TIMEOUT`. Traces measure elapsed time, omit payloads by default, and do not establish persistent authorization or connectivity. Tests use explicitly labelled injected fixture adapters; real socket transport and server authorization belong to the server/Resources integration tests.

Palette integration: the editor owner must categorize `resource` under `Connectors / AI` in `WorkflowEditor.tsx`'s `BLOCK_CATEGORY`. Resource-library selection is separate from editable reference controls; no fake connected badge or invented function dropdown is provided.

## Local execution diagnostics

Public `TraceDetails` type (no persistence or server DTO schema implied):

```ts
type TraceDetails = {
  durationMs: number;
  input?: Json;
  output?: Json;
  selectedPort?: 'true' | 'false';
  errorCode?: string;
};
```

Actual completed/paused/blocked node attempts include nonnegative elapsed time from `performance.now()`. Branches include their actual selected port even when payload capture is off. Skipped nodes have no invented input/output or measured execution. Graph/seed admission failures and unknown/copied/consumed pauses have no invented node attempt. Approval pause timing ends at the pause; a resume measures that verification attempt separately, excluding human waiting time. Successful resume retains the existing `humanName` audit field. Proof is never added to diagnostics.

`captureData:true` is explicit opt-in for a **local inspector**, not permission to persist or share payloads. Captured input is the actual mapped input before adapter invocation; captured output exists only after validated completion. Snapshots are independent clones limited to the smaller of 10,000 UTF-8 serialized bytes and `maxDataBytes`, depth 16 and 2,000 values. Oversized snapshots are omitted, not fabricated/truncated. Execution adapters receive cloned inputs so they cannot mutate ancestor outputs or original-seed selections.

Snapshots drop prototype/secret/credential keys and conservative name/email/user/person/actor identifier fields; strings and keys use the existing browser-pure guardrails `scrub` utility, with names discovered in name-labelled fields. **This is not proof of anonymization or a general secret/PII detector.** Unlabelled names, unknown secret formats and business-sensitive information can remain. Capture remains off by default; original output and the existing `humanName` audit field are not anonymized by this option.

Node errors use fixed safe categories/messages, never raw adapter exceptions, endpoints or returned invalid values. Codes include `MAPPING_SOURCE_UNAVAILABLE`, `CONFIG_REQUIRED`, `ADAPTER_UNCONFIGURED`, `ADAPTER_ERROR`, `ADAPTER_TIMEOUT`, `DATA_INVALID`, `DATA_LIMIT`, `INPUT_INVALID`, `STEP_LIMIT`, `MULTIPLE_ACTIVE_INPUTS`, `EXECUTION_REFUSED`, `AUTHORIZATION_REQUIRED`, `AUTHORIZATION_REFUSED`, `AUTHORIZATION_FAILED`, `PAUSE_CONSUMED`. Adapter failures/timeouts preserve the warning that side effects may already have occurred. No retries or rollback claims are introduced.
