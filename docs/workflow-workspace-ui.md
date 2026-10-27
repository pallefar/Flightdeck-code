# Studio workflow workspace UI

`src/studio/WorkflowWorkspace.tsx` is an embedded Studio/OS control section, not a new application shell. It consumes existing theme variables and owns no navigation, credential entry, project routing, browser storage, connector adapters, or model calls. The server scope remains **single-operator local project partitioning**, not authenticated host project authority.

## Parent composition

Named exports:

- `WorkflowWorkspace`, `WorkflowWorkspaceProps`
- `WorkspaceRunDetail` (text-only persisted-record renderer)
- `WorkspaceController`, `WorkspaceState` from `workspace-controller.ts`
- `WorkspaceClient`, `WorkspaceClientError`, public browser DTO schemas/types from `workspace-client.ts`

```tsx
import { WorkflowWorkspace } from './WorkflowWorkspace';

<WorkflowWorkspace
  graph={editorGraph}
  projectId={projectId}
  token={token}
  documentKey={workspaceDocumentKey}
  onLoadGraph={graph => {
    setEditorGraph(graph);
    setEditorRevision(previous => previous + 1); // remount editor for external load
    // Do NOT change workspaceDocumentKey for a workspace load.
  }}
/>
```

The existing parent owns the project text and in-memory operator token. No actor/token/key goes into URLs, graph data, exports, logs or browser storage. A missing or malformed scope disables workspace writes and reads and directs the operator to **Connect operator credential in AI builder**. The component never asks for secrets or quietly starts a backend with a fixture identity.

Keep `WorkflowWorkspace` mounted during normal editor changes. Keep the editor mounted during ordinary graph/settings rerenders so its typed-but-unapplied block drafts survive. Increment `workspaceDocumentKey` only for explicit new/template/import/AI graph replacements, **not** ordinary edits or workspace loads. This detaches the saved identity and requires Save as new draft. Without that optional seam, the UI still exposes **Use graph as new draft** and clearly distinguishes **Save as new draft** from the explicit selected-draft **Save New Revision** action; the parent must not infer document replacement solely from object reference churn. Loading a saved graph remounts the editor via the parent's editor key only.

`controller?: WorkspaceController` is an optional injection seam for tests/embedding. `onLoadGraph` only fires after real draft/history reads and explicit dirty-discard confirmation. The component uses an inline Discard edits & load / Cancel prompt, not `window.confirm`; SSR does not request or execute anything.

## Client and controller contract

Browser DTO validation mirrors the public server record schemas locally; the client imports only the pure `packages/workflow/graph` schema module and Zod, **never** a Node/server store. JSON graph/input/output depth, values, secret/prototype fields and UTF-8 bytes are bounded before recursive parsing. Responses are streamed with a 16 MB hard cap before JSON parsing. Run snapshot SHA-256 is checked through browser Web Crypto over key-order-independent canonical JSON. Graph/draft/run identities, project scope, revisions, timestamps, approval bindings, trace nodes, state/null-result relationships and pause disposition are validated. Missing Web Crypto means execution records cannot be trusted, not a silent integrity bypass.

`WorkspaceClient(projectId, token, transport = fetch)` supports exactly seven routes:

- `list(signal?)`, `create(graph, signal?)`, `get(draftId, signal?)`
- `update(draftId, graph, expectedRevision, signal?)`
- `run(draftId, revision, input, signal?)`
- `listRuns(draftId, signal?)`, `getRun(draftId, runId, signal?)`

All writes use strict bodies. No delete, publish, approve, resume or retry routes are invented. Requests use same-origin credentials and memory-only Authorization headers; error text is selected from safe local messages, never raw server/provider/path details.

Controller methods: `setScope`, `matchesScope`, `setGraph`, `newDocument`, `refresh`, `save('new'|'revision')`, `load(id, confirmDiscard?)`, `history`, `inspect`, `run`, `cancel`, `getState`, `subscribe`; `runDisabledReason` provides the current refusal explanation.

- Every successful create/update/run is followed by **GET of the exact draft/run**, with captured revision/graph/full record comparison, before showing saved/recorded status. Run history is read back too. Concurrent changes or failed readbacks are unconfirmed; refresh/inspect before retrying uncertain work.
- Dirty state compares the current graph against the saved snapshot using recursively key-sorted JSON. Edits during a save stay dirty; a response never overwrites those edits.
- Project/token/new-document switches abort and suppress stale responses. Old identities/details are masked immediately during rendering, before scope effects. Loading callbacks are also checked against current scope/document identity.
- Execution requires the matching saved graph and revision. Before POST, the controller freshly checks the exact durable draft and run history; the backend enforces CAS/replay protection. The run request contains only `{revision,input}` and never the unsaved graph.
- One run per revision; repeat runs are disabled. Save New Revision is always explicit, including unchanged graph when another execution is desired. Running/interrupted history blocks every revision. Paused history says **Resume unavailable**, with no approve/retry controls.
- Saved approval ID/type/config bindings are immutable. Configure reviewer and reason before first saving. Conflicts preserve local edits and explain revision/approval/replay conflicts, rather than claiming settings saved.
- Unknown/unavailable list/history is represented by `null`, never an invented empty-record success. Drafts/history refresh and execution are explicit actions; there is no auto-save or automatic run.

## Stable browser controls

Section: `aria-label="Workflow workspace"`, class `.wf-workspace`.

Controls: `Save as new draft`, `Save new revision`, `Use graph as new draft`, `Refresh saved drafts`, `Filter saved drafts`, `Server run input`, `Run saved revision`, `Refresh run history`, `Load draft <uuid>`, `Inspect run <uuid>`, `Discard edits and load draft`, `Cancel loading draft`.

Run detail uses `.wf-workspace-detail` / `aria-label="Persisted run detail"`; output, trace, input and snapshots are rendered through React text nodes inside bounded scrollable `<pre>` blocks, not HTML.

## Verification and limits

Tests were introduced before the first client/controller/UI implementations and observed red, then green. Additional red regression tests cover a second save unlocking an in-flight create, credential-switch identity leakage before effects, and oversized response streams not being cancelled.

```sh
npm test -- src/studio/__tests__/workspace.test.ts src/studio/__tests__/workspace-ui.test.tsx \
  server/__tests__/workflow-workspace.test.ts server/__tests__/workflow-workspace-store.test.ts \
  server/__tests__/workspace-composition.test.ts
npm run typecheck
npm run build
git diff --check
```

Verified: 23 new frontend tests; 191 focused Studio/editor/workflow/workspace tests passed; root typecheck/build and diff check passed. An additional direct esbuild browser bundle of `WorkflowWorkspace.tsx` succeeded with 18 modules and no server/Node store imports. Integration tests drive the actual authenticated Fastify routes and real private JSON files in physical `process.env.TMPDIR`, close apps/clean directories, and reopen the server/store before durable history reads. They execute real true/false branches and set output, actual approval pauses, blocked HTTP connector outcomes, CAS and immutable-approval conflicts, running reservations and exact post-write readbacks. The explicitly injected test model throws if invoked by local execution. Negative transport fixtures are only named malformed/auth/stream/scope tests, not production execution datasets.

The parent now mounts this component in `StudioApp.tsx`, sharing the in-memory operator token/project and current editor graph. Workspace and editor remain mounted across internal AI-builder/editor navigation; saved loads remount only the editor, and explicit AI graph replacement changes document identity. Mounted `/demo` browser verification confirms controls are visible and save/run remain disabled without credentials. Live credentialed browser save/run has not been performed because the development server has no configured named operator/token. No fixture credentials were installed. This does not claim deployed host integration or configured outbound adapters.
