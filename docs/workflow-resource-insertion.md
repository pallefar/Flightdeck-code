# Resource selection → workflow insertion

**Use resource function** in Studio Resources now inserts a configured reference into the retained real workflow editor. It does not invoke a resource, model, local runner or saved run.

## Edit contract

- The existing library permits selection only for its current authenticated project/token scope, an active revision, a configured function and schema-valid data-only parameters. Draft, unavailable and invalid selections stay disabled. Browser selection does not establish execution authority: the server independently rechecks project, current active revision and reviewed function binding at execution.
- `WorkflowEditorStore.addResourceNode(ResourceSelection)` preflights the entire selection before reading fields, strictly parses all required reference fields and accepts only bounded JSON object parameters (10 KB total, existing JSON depth/node bounds). Restricted nested connection, header, credential, destination and executable fields are rejected.
- Parameters become explicit literal mappings. `{}` becomes `inputMappings: []`, meaning an explicit empty replacement object, never default incoming input. Configuration contains only resource ID, exact revision and function ID; there are no endpoint/header overrides or generated HTTP blocks.
- One fully validated graph commit returns the new node ID. No intermediate node or second update enters history. Rejection leaves current graph, prior history and redo history untouched. Structured schema parsing protects nested values from subsequent caller mutation.
- No automatic edges. A disconnected-reference notice tells the operator to connect the block and review literal Inputs before execution. Successful insertion selects the new block and opens the existing native settings modal with Inputs/Parameters/Results panels. Undo removes only the inserted node and preserves prior edits; redo restores the exact configured node.

## Retention and lifetime

Studio uses a synchronous `WorkflowEditorHandle.insertResource` ref, not a queued pending command. It checks captured versus live project/token scope. Nothing can replay later on workspace load, scope change or editor remount. Successful insertion switches to the retained editor without changing editor revision or workspace document keys. Resources and workspace remain mounted. Failure appears both in the editor and in the still-visible Resources area.

The shared Studio transport now also reaches the retained `WorkspaceController` through its existing injection seam. Browser-native `fetch` is called through a function wrapper rather than a class-member receiver; the real browser regression caught an illegal-invocation failure in the previously uninjected workspace path. No global fetch patch or second credential store is used.

## Verification

Strict RED→GREEN observed missing store action, missing editor handle, absent real Studio selection button and stale undo notice before each implementation/fix. Direct store tests cover literal identity/configuration, deep-copy protection, one undo/redo, empty mappings, restricted nested fields, accessors (zero reads), cycles, oversize parameters, extra selection fields, invalid revisions and full-graph atomic failure.

```sh
npx vitest run src/workflow src/studio
npm run typecheck
npm run build
```

The reusable real-browser harness is `src/workflow/resource-insertion.browser.tsx`. Its explicitly DEVELOPMENT-only route fixture is `src/workflow/resource-insertion.fixture.ts`; neither is imported by the application entry or production bundle. To reproduce with existing dependencies:

```sh
npx tsx src/workflow/resource-insertion.fixture.ts
PORT=9192 npx vite --host 127.0.0.1 --port 5189 --strictPort
```

Open the development origin root `/` and invoke both exported browser assertions through the Vite-transformed harness module. They exercise real React handlers, native dialogs and authenticated Fastify routes using a public DEVELOPMENT test sentinel, not actual operator secrets. Stop both dedicated processes afterward; SIGINT/SIGTERM cleans the fixture's private temporary resource/workspace files.

Browser assertions verified retained editor/workspace/library DOM identities; schema-bound active selection; real reference/literal export; native modal focus; retained unapplied parameter typing across unrelated Resources navigation; one undo and redo; same saved workflow ID with revision 2 and exact authenticated readback; no saved runs; no replay after explicit workspace-load remount; empty-function explicit `[]` mappings; visible 100-block capacity rejection with unchanged undo; disabled draft revision; and immediate scope masking. The fixture observed zero destination calls.

The scoped Studio/workflow run passed 199 tests; typecheck and production build passed (existing >500 KB chunk warning). `git diff --check` passed. A full `npm test` run passed 2,668 Vitest tests and all four Docker bootstrap node tests, but seven live-host checks failed because this invocation lacked `FLIGHTDECK_HOST_ROOT`; 35 tests were skipped. No host-check bypass, missing-context acknowledgement or safeguard relaxation was added.

This verifies actual DEVELOPMENT selection-to-editor-to-persistence UI contracts. Default Docker registry remains empty unless independently configured. No activated Docker resource, live vendor readiness, host installation, production authorization, provider invocation or execution is claimed.
