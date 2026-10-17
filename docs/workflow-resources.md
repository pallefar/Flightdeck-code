# Durable reusable Resources backend

Status: backend registration seam and **actual Studio composition-root mount with saved workflow-node execution delivered**. See `workflow-resource-composition.md` for operator authentication, trusted startup options and optional private configuration. No Docker deployment or host OS mounting is claimed by these repository changes. No credentials, host authorization, model keys or vendor integrations were reused. Reference services below are DEVELOPMENT services, not Oracle/n8n/vendor connectors.

## Mount and authority

Import `registerWorkflowResourceRoutes` from `server/workflow-resources.ts`. Inject:

- `store: new ResourceStore(privateAbsoluteDirectory)` (0700 directory, 0600 files).
- `registry: new ResourceRegistry(trustedFunctions, networkPolicy, credentialResolver?)`.
- async `authenticate(authorization) -> { actor } | null`.
- async `authorize(actor, projectId, 'read' | 'propose' | 'execute') -> boolean`.

Use the composition root's actual auth/project capability resolver, not a second token or a permissive scope grant. Authentication and project authorization run in `onRequest`, before JSON parsing, storage or network. Execute rechecks project authority at effect time. This module does not establish host authorization by itself.

The registry is **server configuration**, never a browser/model proposal. A trusted function contains an ID, project allowlist, fixed destination, constrained schemas and either REST GET/query mapping or an explicitly reviewed read-only MCP tool. Credentials contain only a server vault reference, exact origin and approved header (`authorization` or `x-api-key`). The injected resolver supplies the value in memory. References/headers/destinations are not exposed in browser summaries or persisted resource definitions. Transport response credential echoes are rejected.

Browser resource proposals contain only `{ name, functions: [functionId] }`; unknown destination/header/secret/code fields are rejected. Proposing or editing produces a draft, not an authorization. There is **no HTTP activation route**. Independently authorized server review calls:

```ts
await registry.activate(store, projectId, resourceId, expectedRevision, independentlyResolvedReviewerActor);
```

The reviewer must differ from the draft author. The method being server-only is not proof that a string is a human: the composition root must independently authenticate/authorize that reviewer and must never expose this capability to models or accept a browser-selected reviewer. Activation creates its own CAS revision with sourceRevision and exact registry/policy SHA-256 bindings. Registry/policy changes invalidate old activation. Changing a resource creates another draft; it does not carry forward approval. Writes are unsupported and denied at registry construction; read-only MCP requires explicit trusted `readOnly: true`, not a remote annotation.

## Browser integration contract

Browser-safe runtime identity/proposal/summary schemas and types live in `packages/resources/contract.ts` (only Zod is imported at runtime). Import no server store/registry/transport runtime into the frontend.

Base: `/api/studio/workspaces/:projectId/resources`.

| Method/path | Body | Response |
|---|---|---|
| GET base | none | `{ resources: ResourceSummary[], functions: FunctionSummary[] }` |
| POST base | `{ definition: { name, functions } }` | 201 `{ resource }` |
| GET `/:resourceId` | none | `{ resource }` |
| GET `/:resourceId/revisions` | none | `{ revisions }` |
| PUT `/:resourceId` | `{ expectedRevision, definition }` | `{ resource }` (draft) |
| POST `/:resourceId/execute` | `{ revision, functionId, parameters }` | `{ result: { output, durationMs, resourceId, revision, functionId } }` |

A ResourceSummary contains id/projectId/revision/sourceRevision/state/definition/actor; internal policy bindings are omitted. FunctionSummary contains id/kind/input/output/effect/status, not destination/credentials. Status is always `configured-not-probed`: a configuration or one test call is not a persistent "connected" claim. Present resource revision + function pickers before vendor-logo connectors. Bind node selection to resourceId/revision/functionId; parameters are schema-bound data, not arbitrary network requests. After create/update, GET the exact target and compare the saved revision/definition before UI success. Conflicts require explicit reload/review, never automatic execution retries. This API itself does not bypass existing human gates; the actual root now wires reference-only resource nodes as documented in `workflow-resource-composition.md`.

Request body limit is 32 KB. Inputs and outputs use a deliberately small declarative subset: object with fixed properties/required/additionalProperties:false, string (maxLength capped at 4096), finite number, boolean, bounded array. Maximum nesting 10, object keys 64 and array items 256. Unknown schema keywords, remote refs, executable validation, inherited/accessor-backed object fields, prototype keys and sparse/accessor-backed arrays are rejected. REST parameters map only to fixed query names; path/method/origin are never caller-controlled. MCP input/output schemas are pinned to the selected discovered tool and structured output is revalidated.

## Transport/security

The HTTP adapter actually uses Node HTTP(S) sockets, checks all resolved addresses and pins the checked address in the socket lookup, eliminating a second DNS resolution at connect. Production permits HTTPS and globally routable IPv4 only. IPv6 is intentionally unsupported/fail-closed, including mapped IPv4. Private/link-local/loopback/CGNAT/documentation/benchmark/multicast/reserved ranges are denied. Exact literal `http://127.0.0.1:<port>` may be enabled only via injected `developmentOrigins`; hostname aliases and redirects are never allowed. No automatic redirects/retries or forwarding credentials to another origin. Default transport timeout 5 seconds (maximum 15 seconds); response cap 64 KB (maximum 256 KB), bounded streamed reads, fixed sanitized errors. Request cancellation destroys the socket; cancellation does not prove a remote operation stopped.

Store writes use exclusive immutable revision files, synced private files, atomic synced head replacement, directory fsync, exact readback, cross-instance lock directories and CAS. Active record reads compare the source draft's identity/revision/definition/actor. Project/UUID paths are strictly validated; symlinks/nonregular/private-mode violations fail closed. Atomic publication can leave orphan revision files or lock directories after a crash; this intentionally blocks subsequent writes rather than silently overwriting history or guessing whether another writer died. Operator recovery tooling, quotas and automatic crash recovery are not delivered. Filesystem permissions are not a defense against a privileged local attacker; deploy the state root in a trusted private volume with trusted ancestors.

## MCP implemented subset and source verification

The client implements actual Streamable HTTP JSON-RPC initialization, `notifications/initialized`, `tools/list`, and a single selected `tools/call`, with negotiated version/session headers and both JSON and bounded POST SSE responses.[1][2][3] The version implemented is **2025-11-25**, pinned intentionally (no claim that it is the latest). No MCP SDK is installed in this repository and no dependency was added. The implementation is a restricted client, not a general SDK.

Discovery is not authorization: only the exact server-configured tool is callable, with canonical exact input/output-schema comparison before invocation. All other discovered tool metadata is ignored. Tool annotations are not accepted as authority.[3] Remote tools must provide outputSchema and structuredContent; text-only tools, schema-rich tools outside our subset and paginated discovery are unsupported/fail-closed. No stdio process spawning, arbitrary command execution, roots/files access, sampling, elicitation, stream resumption, autonomous session retries, session teardown DELETE or remote cancellation notifications. Each call initializes a bounded fresh session; the reference server expires sessions after 30 seconds. Connection abort is not protocol-level remote cancellation.[1][2]

`registerDevelopmentMcp(app, authenticate)` exposes an actual DEVELOPMENT reference endpoint `/mcp`. The caller must bind its server to literal loopback. It authenticates before parsing, rejects browser Origin headers, binds sessions to the credential, validates lifecycle/version and performs real read-only graph DAG validation (`validate_graph`). It returns measured graph validity/counts, not invented vendor data. Session table is capped at 128. This service is not mounted automatically.

## Verified execution and remaining work

Run:

```sh
npx vitest run packages/resources server/__tests__/workflow-resources.test.ts
npm run typecheck
npm run build
```

Tests exercise actual authenticated Fastify routes with restart/readback/CAS, real REST GET against an explicit local DEVELOPMENT HTTP fixture, and actual TCP JSON-RPC calls to the DEVELOPMENT MCP graph validator. Security cases cover auth-before-parse, project scope, inactive/stale/changed-policy binding, missing discovered tool, redirect nonforwarding, private addresses/aliases/IPv6, streamed size/deadline/cancellation, malformed JSON, credential echoes, self-review, symlink denial, changed source revisions, schema restrictions and accessor denial. Test output prints real measured REST/MCP outputs without credentials.

Still absent from this backend delivery: host capability integration, production vault resolver, independently authenticated production reviewer, external connector/live-primary-public-endpoint smoke, vendor adapters (Microsoft SharePoint/Outlook/Teams/Postgres etc.), writes/side-effect review, durable per-invocation approvals/audit history, operator crash recovery/quotas. Root mounting and saved resource-node wiring are delivered separately in `workflow-resource-composition.md`; UI delivery is tracked by its own tests. The existing Docker companion/OS stack were not modified or restarted by this module. Do not label proposed resources or configured adapters "connected", "activated" or vendor-ready without the corresponding server authority and verified transport.

## Sources

[1] https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
[2] https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
[3] https://modelcontextprotocol.io/specification/2025-11-25/server/tools
