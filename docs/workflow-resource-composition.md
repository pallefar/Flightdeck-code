# Resources in the Studio composition root

`createServer` now mounts Resources using the existing `presentsOperatorToken` check and the configured operator actor. No second credential, anonymous fallback, browser-selected actor, model approval or HTTP activation endpoint is introduced.

## Startup dependencies

```ts
createServer({
  operator,
  workflowResources: {
    store,                 // optional ResourceStore
    registry,              // optional trusted ResourceRegistry
    authorize,             // optional async (actor, projectId, action) => boolean
    credentialResolver,    // optional resolver for the file-loaded registry only
  },
});
```

`authorize` actions are `read`, `propose`, `execute`. An injected registry or policy overrides file loading entirely; the file cannot silently add privileges to an injected configuration. The optional store can be combined with file configuration. Supply an explicit policy for execution with an injected registry; the default policy never permits execution.

Default private resource directory, in order:

1. `STUDIO_RESOURCE_DIR`
2. `STUDIO_STATE_DIR/resources`
3. `.studio/resources`

The existing resource store requires private 0700 directories and 0600 files. No resource directory is created by startup/listing alone. Without injected dependencies or a configuration file, lists have no function descriptors; local authenticated authoring can save drafts referencing unconfigured identities, but execution is denied. Local project partitioning is **not host project authorization**.

## Optional strict server-owned file

Set `STUDIO_RESOURCE_CONFIG_FILE` before startup. It is a fixed trusted path, not an API parameter. The loader refuses symlink path components, nonregular files, group/world permission bits, oversized files, malformed JSON, unsupported fields/schemas and invalid grants. Reads are bounded to 64 KB, including concurrent growth. An invalid file aborts construction with a fixed error; no partial function list becomes active.

Example declaration (configuration only; not a live-service claim):

```json
{
  "version": 1,
  "projects": [{"id": "local-project", "actions": ["read", "propose"]}],
  "network": {"allowedOrigins": ["https://example.com"]},
  "functions": [{
    "id": "reviewed_read",
    "kind": "rest",
    "projects": ["local-project"],
    "endpoint": "https://example.com/read",
    "method": "GET",
    "input": {"type": "object", "properties": {}, "required": [], "additionalProperties": false},
    "output": {"type": "object", "properties": {"value": {"type": "number"}}, "required": ["value"], "additionalProperties": false}
  }]
}
```

Each function's project IDs must exist in `projects`. Execute grants must be explicitly present as `"execute"` in the project's actions, and still do not activate a draft. REST allows only GET, with optional `query: {inputParameter: fixedQueryName}` mapping scalar schema properties. MCP replaces `method`/`query` with `kind: "mcp"`, `tool` and `readOnly: true`. Neither browser proposals nor file definitions permit arbitrary headers or inline secrets.

`network.allowedOrigins` is required and constrains every fixed endpoint at startup. HTTPS is the default allowed protocol. HTTP requires an exact literal-loopback origin in both `allowedOrigins` and `developmentOrigins`; `localhost` aliases are refused. Optional `timeoutMs` (1–15000) and `maxBytes` (1–256000) retain transport bounds. The underlying transport still applies DNS/address checks, address pinning and redirect refusal. Schema support is the constrained Resources subset, not general JSON Schema.

Optional credentials contain `{ref, origin, header}` with `header` equal to `authorization` or `x-api-key`. No credential file or another app's credentials are read. Without an injected resolver, credential-dependent calls fail closed before transport. The default Docker configuration does not supply a resolver or independently authenticated reviewer.

## Browser and saved workflow contract

Resources API remains `/api/studio/workspaces/:projectId/resources` with strict identity/proposal/update/execute bodies documented in `workflow-resources.md`. All query parameters are rejected after authentication. `functions` contains only IDs, kinds, input/output schemas, read-only effects and `configured-not-probed` status, not destinations/credential references.

A saved builtin `resource` node has only:

```ts
config: { resourceId, revision, functionId }
```

The node's mapped object input becomes function parameters. No URL, key, actor, project override or reviewer is accepted in node config. The composition root binds actor/project once per run, checks execution policy, fetches the exact current active resource revision, rechecks policy and then refetches current state after asynchronous scope resolution. Registry execution also verifies selected function, project allowlist, activation fingerprint and input/output schema. Unknown, draft, inactive, changed, stale and foreign selections block before network. Workspace adapters validate outputs and persist payload-free diagnostics (`captureData: false`).

Activation remains a trusted server-only seam: `registry.activate(store, projectId, resourceId, expectedRevision, independentlyResolvedReviewerActor)`. This is not an identity verifier; the caller must independently authenticate and authorize that reviewer. No production reviewer is manufactured and no file configuration auto-activates resources. Tests use explicitly labelled independent reviewer fixtures only.

## Verification and limits

`resource-run-composition.test.ts` listens on actual ephemeral loopback sockets, saves and GET-verifies workflow graphs, executes reviewed REST and MCP functions through the real root, GET-verifies stored runs, and checks no extra network call for denied/stale/changed selections. Measured smoke output is REST `{label:"real",hits:1}` and MCP `{valid:true,nodeCount:2,edgeCount:1}`. Tests also reproduce/reject changes during effect-time scope resolution, unknown query fields and startup persistence/configuration boundaries.

The parent rebuilt/recreated only the Studio Docker companion after this delivery. Actual authenticated Docker checks verified an empty configured-function list, development resource draft create/GET/history readback across restart, denied execution and an absent activation endpoint. Previous mapped and legacy workflow/run records also read back unchanged. This does not verify an activated vendor resource: the default registry remains empty and production review/vault configuration is still absent. Host capabilities, independent-human review integration, vendor services, write-effect permissions, crash recovery and quotas remain outside this slice.
