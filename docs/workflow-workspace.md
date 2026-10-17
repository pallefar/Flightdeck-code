# Local workflow workspace (not deployment)

`server/workflow-workspace.ts` registers seven authenticated Fastify routes. `server/workflow-workspace-store.ts` supplies bounded, private JSON-file persistence. This is a **single-operator, single-process local authoring/execution slice**, not host project authorization, publication, multiuser access control or production connector integration. No outbound HTTP/model implementation is included.

## Mount seam

```ts
import { registerWorkflowWorkspaceRoutes } from './workflow-workspace';
import { createFileWorkflowWorkspaceStore } from './workflow-workspace-store';

registerWorkflowWorkspaceRoutes(app, {
  actor: options.operator.actor, // server-owned; never taken from request fields
  authenticate: header => presentsOperatorToken(header, options.operator.token),
  store: createFileWorkflowWorkspaceStore(serverSelectedWorkspaceFile),
  // adaptersFor: ({ actor, projectId }) => trustedProjectAdapters(actor, projectId),
});
```

The composition root chooses an options/env/default path (for example `.studio/workflow-workspace.json`); the plugin never accepts a path, actor, adapter or graph snapshot through a run request. Paths containing `..` components or NUL are refused. All existing path ancestors must be actual directories, not symlinks: on macOS choose the physical `/private/...` path rather than a `/var/...` alias when applicable. Keep the file in a server-owned directory inaccessible to other users. Existing parent permissions are not modified.

Authentication is a route `onRequest` hook, **before body parsing**, validation, store lookup or adapter acquisition. Missing/refused/throwing authentication returns 401. The injected actor owns all locally authenticated project scopes; project slugs partition records, but do not establish host authorization. A real host integration must authorize that actor for the requested project **before any store call**, including list/read routes, via a trusted host gate or scoped/authorized store facade. Adapter authorization alone cannot protect drafts/history. Keep bearer tokens and connector credentials out of browser graph values and request logs.

## Routes

Base: `/api/studio/workspaces/:projectId/workflows`. Project IDs use lower-case alphanumeric segments separated by single hyphens, maximum 64 characters. Draft/run IDs are server-generated UUIDs.

| Method | Suffix | Strict body | Success |
|---|---|---|---|
| GET | (base) | — | 200 `{drafts: summaries}` |
| POST | (base) | `{graph}` | 201 `{draft}` |
| GET | `/:draftId` | — | 200 `{draft}` |
| PUT | `/:draftId` | `{graph, expectedRevision}` | 200 `{draft}` |
| POST | `/:draftId/runs` | `{revision, input}` | 201 `{run}` |
| GET | `/:draftId/runs` | — | 200 `{runs}` |
| GET | `/:draftId/runs/:runId` | — | 200 `{run}` |

Malformed bodies/identities return 400; body limit violations return 413; cross-project or absent identities return the same 404; stale saves/runs, approval-binding changes or execution replay return 409; unavailable/corrupt storage returns sanitized 503. Provider errors and filesystem paths are never returned. A blocked or paused execution is a persisted 201 run, not successful connector work. Summaries omit the full graph and include its `name`. No delete, publish, approve, retry or resume routes exist.

## Durable contract

Exported strict `draftSchema`, `runSchema`, `workflowRunResultSchema`, `workspaceGraphSchema` and `workspaceInputSchema` define the records; `WorkflowDraft`, `WorkflowRun`, `WorkflowWorkspaceStore` and `WorkflowWorkspaceDependencies` expose the TypeScript seams.

A draft includes `{id, projectId, revision, graph, status:'draft', createdBy, updatedBy, createdAt, updatedAt, approvalBindings}`. Revisions start at 1. Approval bindings contain `{id,type:'approval',config}` for every approval; they are generated server-side at creation, and newly added approvals become bound on save. Subsequent saves cannot remove, retype or reassign these IDs/configs. Labels/positions and graph connections remain editable, including incomplete/disconnected drafts; execution separately rejects disconnected and approval-bypass paths.

A run includes `{id, draftId, projectId, draftRevision, graphSnapshot, graphDigest, state, result, initiatedBy, input, startedAt, finishedAt, resumable:false, pauseDisposition, executionEpoch}`. `graphDigest` is SHA-256 over recursively key-sorted UTF-8 JSON (array order preserved). The immutable snapshot comes from the saved revision, not the browser. `result` contains the real engine `{status,output,trace,pendingNodeId?,reason?}`; errors are reduced to known safe core reasons or a generic refusal. Adapter output is screened before core normalization, then strictly bounded/validated again before persistence.

The store serializes read/modify/write/CAS across store instances configured with the same absolute path in this process. A run reservation is durably written/read back **before** adapters are acquired. Only one run per draft revision is permitted, and an in-flight/interrupted run blocks further runs for that draft even if it is edited. There is no automatic retry. Editing while a run is in progress does not change its snapshot. A later revision may run after the previous execution has finished; this is new execution, not resume. External side effects are not transactional, and adapter timeouts may occur after side effects began.

`state` is `running|completed|paused|blocked|interrupted`. Running/interrupted records have null result/finish time. Terminal states carry actual result/finish time. `executionEpoch` is a server-generated process UUID; records left running by an exited process are **reported as interrupted**, never replayed. Paused records always have `pauseDisposition:'unavailable-no-resume'` and `resumable:false`. The runner's opaque pause capability is not serialized or retained by this plugin. A restart does not reconstruct that capability, approve the gate, or reexecute earlier work. Other runs use `pauseDisposition:'not-paused'`.

## Bounds and filesystem safety

- Existing graph schemas: at most 100 nodes, 300 edges, 50 reviewed declarative custom blocks, bounded IDs/text/configs and DAG/port validation. No executable graph code.
- Additional limits: 256,000 UTF-8 bytes per graph; 100,000 per input/output; 100 top-level input fields; depth 24; 100,000 inspected JSON values. Request bodies: 300,000 bytes. Finite JSON only; existing secret screening also applies to graph text, input and adapter output. Screening is defense in depth, **not a universal secret detector**: never paste secrets.
- One file: at most 128 drafts, 256 runs, 16,000,000 bytes, depth 32 and 100,000 inspected values. All limits apply on read and write. Corruption, duplicate/orphaned IDs, inconsistent snapshots/digests and unsafe persisted values are refused, never silently reset to an empty workspace.
- Reads use `lstat`, no-follow/nonblocking open, regular-file/single-link and size checks, bounded chunks and before/after file checks. Symlinks (including broken ones), non-regular files and hard-linked targets are refused.
- New directories are 0700; exclusive same-directory tempfiles/new replaced files are 0600. Validated writes are file-synced, atomically renamed, directory-synced, then bounded-read back before acknowledgement. Invalid writes/tempfile failures leave the prior file intact and clean up the temporary file. Failure after atomic replacement can leave an unacknowledged new record: inspect history; **do not retry adapter work**.
- This is not a multi-process database or a defense against a privileged adversary racing directory replacement. Do not share the file among concurrently running servers; use a transactional host store for that deployment boundary. No retention/delete mechanism is provided; reaching limits requires explicit server-owned maintenance or a stronger store.

## Mapping and diagnostic persistence

Saved graphs preserve optional declarative `inputMappings` exactly through the core graph schema and canonical snapshot digest. Sources are bounded literal JSON, original run input paths, or graph-ancestor node output paths. Missing paths and branch-skipped sources block execution with `MAPPING_SOURCE_UNAVAILABLE`; there is no fallback to another input.

Trace entries optionally include strict metadata-only `details: {durationMs, selectedPort?, errorCode?}`. Duration must be finite, nonnegative and at most 86,400,000 ms (a defensive record bound, not the adapter timeout). `selectedPort` is `true|false` and binds only to completed branch nodes, including custom branch wrappers; branch attempts with metadata must record their selected port. Skipped entries cannot carry attempt metadata. Fixed core error categories are permitted only on blocked entries; raw exception text is refused. Details are optional so version-one records lacking them load unchanged, without manufactured timing.

The durable route explicitly sets `captureData:false` and copies only measured timing/branch/error metadata. Server and browser DTOs reject diagnostic `input`, `output` and any unknown metadata fields; this workspace exposes no diagnostic-persistence opt-in. Original saved input and final public output remain separately bounded records. Per-node payloads are available only from an explicitly opted-in local inspector run, not from saved history. Persisted run detail shows timing, selected branch and safe error categories while clearly labeling payloads unavailable and legacy/skipped timing absent. Preflight rejects getters without invoking them, custom prototypes, hidden/symbol fields and unsafe keys before recursive validation.

Integration regressions use the actual Studio composition root and file store through a `WorkspaceClient` Fastify-to-Fetch transport, compare exact graph digests/readback across reconstructed servers, and exercise nested original-input/node-output mappings plus missing/skipped source blocking. No Docker rebuild or host deployment is implied by these tests.

## Execution and remaining boundaries

Valid saved graphs execute with real `createWorkflowRunner` and the injected actor as initiator. Manual/set/branch/output are local deterministic operations. Approval pauses. Missing HTTP/LLM adapters genuinely block. `adaptersFor` is a trusted injection seam, not a network implementation: a host must resolve vault credential references, enforce project capability grants, destination/SSRF/redirect policy, model/privacy approvals, and adapter cancellation/side-effect policy. No human verifier is exposed by this slice.

`server/index.ts` now mounts this plugin with the server-configured operator authentication. `ServerOptions.workflowWorkspaceStore` supplies an injected store; otherwise the server uses `STUDIO_WORKSPACE_FILE` or `.studio/workflow-workspace.json`. The actual composition-root test exercises save/readback, real branch execution, history readback, cross-project denial and restored history after reconstructing the server/store.

Frontend save/load/run/history integration is still in progress. Nothing here claims host project authorization, a deployed host, restart-safe resume or live AI/connector configuration.

## Verification

```sh
npm test -- server/__tests__/workflow-workspace.test.ts server/__tests__/workflow-workspace-store.test.ts
npm run typecheck
npm run build
git diff --check
```

The focused tests drive real Fastify injection and real temporary files under `process.env.TMPDIR`, close apps/clean up, and include actual engine set/true/false branch runs, blocked missing adapters, approval pauses, CAS/concurrent saves, in-flight replay prevention, physical file security, real permission failure, and a separate exited Node process's durable interrupted reservation. Injectable model output is used only in explicitly named trusted test fixtures; production returns no synthetic connector data.

Verified on this slice: **22 focused tests passed**, root typecheck/build passed. A full host-aware run with `FLIGHTDECK_HOST_ROOT=/Users/te451223/project-contract` returned **2392 passed / 3 failed / 2395 total**. The three previously identified failures remain in `packages/codegen/src/__tests__/manifest-rules.test.ts`: hand-written **docusign**, **maps**, and **advantage** host manifests compute fields that the generated-manifest JSON-literal reader deliberately refuses. No parser/security gate was weakened. Running the suite without the host environment instead fails the two host-divergence gates and skips unverified host checks; that is not a host-aware pass.
