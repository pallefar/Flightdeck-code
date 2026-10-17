# Studio Resources library UI

`StudioApp` mounts `ResourceLibrary` as the third **internal** Studio area, alongside AI builder and workflow editor. Editor, saved workspace and resource library stay mounted and use `hidden` for navigation. Editor revision/document keys and existing Inputs/Parameters/Results modal ownership are unchanged.

## Authority and transport

- Uses the actual shared in-memory Studio operator token and project, not a second login or browser storage. The credentials button returns to AI builder.
- No request on mount or credential/project change. Authenticated **Refresh resources** reads the existing same-origin `/api/studio/workspaces/:projectId/resources` contract. Opening a resource reads its exact head and revision history.
- Changing project/token masks previous records before reset effects, aborts pending requests and suppresses stale responses. Aborted delayed writes cannot initiate old-scope readback. Already-started server effects may not be cancellable.
- Create/update allow only a name and configured function IDs. Saving compares POST/PUT response with exact authenticated GET, including resource/project/revision/state/definition/actor. No saved success on mismatch or failed readback. Stale CAS conflicts preserve the proposal and never retry.
- Draft/activated revisions and source draft revision are explicitly labeled. Drafts cannot test. **Independent server review required** is informational: no activation/approve endpoint or self-review button is provided.
- Configured functions remain `configured-not-probed`, including after an actual test. Missing registry configuration has no vendor logos, invented functions or fake output.
- The explicit read-only test posts resource revision/function identity plus schema-bound parameters. It displays actual output, measured duration and exact invocation context, not persistent connectivity. Input edits, selection changes, refresh and scope changes discard old results. There is no automatic model or resource execution.

## Browser boundary

`resource-client.ts` imports only Zod and browser-safe `packages/resources/contract.ts` at runtime. The contract's transport Schema import is type-only. It never imports a filesystem store, registry or Node transport runtime.

Strict DTOs are stream capped at 256 KB and preflighted before recursive validation. Proposals/parameters are capped at 32 KB. The validator supports only fixed-property objects, bounded strings/arrays, finite numbers and booleans; unknown schema keywords, inherited/accessor fields, cycles, sparse arrays and prototype keys fail closed. Nested objects/arrays use schema-bound form fields, not arbitrary command/request JSON. Connection/credential/destination/command-named input fields are refused by the UI and require safe server configuration.

Optional `onSelectResource(ResourceSelection)` remains exposed only to a trusted parent. `StudioApp` now supplies the actual editor insertion handler: **Use resource function** is enabled only for an active, available function with schema-valid data-only parameters in the current scope. Selection inserts a real `resource` block with `{resourceId, revision, functionId}` and literal `inputMappings`, not an HTTP wrapper or endpoint configuration. Empty parameters are explicitly `inputMappings: []`. See `workflow-resource-insertion.md` for atomic history, retained workspace identity and DEVELOPMENT browser verification.

## Verification performed

```sh
npx vitest run src/studio/__tests__/resource-client.test.ts src/studio/__tests__/resource-controller.test.ts src/studio/__tests__/resource-ui.test.tsx
npx vitest run src/studio
npm run typecheck
npm run build
```

Direct tests exercise real authenticated Fastify resource routes with private temporary ResourceStore files, exact create/update readback, CAS refusal and independently activated DEVELOPMENT REST GET over a real loopback socket. Other direct regressions cover no automatic requests, immediate scope masking, delayed request/write abortion, retained conflict drafts, strict schema preflight, malformed schema types and changed readback.

Real browser verification used a dedicated Vite test process on **5188**, separate from the existing Vite **5180**, Docker **8787** and OS **4173**. `/demo` assertions confirmed real Resources navigation, missing-credential disabled refresh, no false empty-success status, no secret field/approval UI, and retained editor/workspace DOM identities and exact typed graph-name/local-input/workspace-input drafts across Resources navigation.

An explicitly DEVELOPMENT Fastify test transport on **9191** (not Docker, a host provider or vendor) supplied real authenticated routes to the actual ResourceLibrary via its injected fetcher/controller. Browser assertions verified real empty registry messaging/disabled creation, head/revision/function selection, disabled draft test, independently activated DEVELOPMENT revision 2, explicit real read-only GET of a measured clock, actual numeric output/duration, retained not-probed status and immediate invalid-scope masking. Both dedicated test processes were stopped afterward. No actual operator credential was entered, copied or exposed.

Production bundle inspection traversed all 92 emitted module identities: `packages/resources/contract.ts` was the only resource package runtime module, with no registry/store/transport, `node:` browser-external shims or workspace store edges. Build succeeded with the existing >500 KB chunk-size warning.

## Remaining boundaries

The Docker/host credential flow and production provider configuration are owned by the composition-root/deployment work. A successful DEVELOPMENT fixture proves this UI/client/controller path, not live vendor integration, host capability authorization, production activation or deployment. No credentials, external services, model calls, billing or host installation were involved.
