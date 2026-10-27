# Studio create backend contract

`POST /api/studio/create` uses the same bearer operator authentication as `/api/studio/build`. All model routes now require explicit connection selection as described below. This endpoint is draft-only: no host writes, publishing, workflow-to-subapp conversion, or connector execution.

## Public APIs

- `packages/spec/src/studio-create.ts`: `determineStudioTarget(input, llm)`, `planStudioWorkflow(input, llm)`, strict `determinationSchema`, `workflowDraftSchema`, `projectPageSchema`, `projectSkillSchema`, `projectSkillsSchema`; types `StudioDetermination`, `StudioNeedsInput`, `StudioQuestion`, `StudioWorkflowDraft`, `StudioProjectPage`, `ProjectSkill`, `ProjectSkillSource`, `WorkflowPlanningOutcome`.
- `packages/pipeline/src/create-studio.ts`: `createStudioFromPrompt(input, deps)`; types `StudioCreateInput`, `StudioCreateDeps`, `StudioCreateOutcome`, `StudioCreateResponse`, `StudioSkillSourceState`.
- `ProjectSkillSource = (projectId: string) => Promise<readonly {id: string; version: string; content: string}[]>`. `ServerOptions.projectSkillSource` is injectable; production defaults to `loadProjectSkillsFile(process.env['STUDIO_PROJECT_SKILLS_FILE'])`.

The request accepts `{prompt, connectionId?, answers?, projectId?, registrySource?, datasource?, toolId?, projectSkills?, reviewedSkillHash?}`. `connectionId` must be exactly `codex-chatgpt | flightdeck | local | anthropic`; omission requires an explicit server-selected connection. Browser `projectSkills` are untrusted reference context, never project authority. The existing datasource schema is reused. Unknown request fields are refused. `reviewedSkillHash` is an explicit authenticated human send confirmation, not an authority claim about the source or a workflow execution approval.

`GET /api/studio/model-connections` requires authentication and returns `{connections:[{id,label,model,status,verification,reason?}],selectedId:null|id}`. Only the ID is accepted as browser model configuration; endpoint/model/key/client/binding overrides are refused. Selection is resolved once after authentication/strict parsing, and that same client is retained through determination, workflow/subapp planning and graph drafting. No provider fallback exists. No selection returns HTTP 409 `model-connection-unselected`; unavailable selection returns HTTP 409 `model-connection-unavailable` (both include constant `error` strings). These make no model calls. The build/block-proposal routes follow the same selection contract. See `docs/model-connections.md` for the complete frontend contract.

The default startup constructs `createModelConnections()` once, without probes. Workspace-only startup needs no model/key/selection. Public health returns only `{ok:true}`; authenticated health describes the selected model's `configured | unavailable | unselected` state and `verification:'not-probed'`, never a live-completion claim. The trusted `ServerOptions.llm` fixture/client seam requires an explicit `llmBindingId`, cannot coexist with a registry, and cannot be selected/configured from the browser.

## Responses

- `{status:'subapp-result', target:'subapp', determination:{target:'subapp',reason}, outcome: BuildOutcome, skillSourceState}`
- `{status:'workflow-proposed', target:'workflow', determination:{target:'workflow',reason}, workflow, pages, projectId, skillSources:[{id,version,contentHash}], warnings, skillSourceState}` — reachable only after exact-context human send review and successful source/shape/output checks.
- `{status:'needs_input', questions:[{id,question}], skillSourceState}`
- `{status:'invalid_determination'|'invalid_workflow', issues:string[], skillSourceState}`
- `{status:'model-request-refused', decision:ModelRequestDecision, skillSourceState}`
- `{status:'grant-refused', decision:GrantDecision, skillSourceState}`

`skillSourceState` is `not-loaded | loaded | empty | unavailable`. Auth failures are 401; malformed bodies are 400 with constant messages and a generic request path. Selection failures are 409 before the pipeline runs (no `skillSourceState`). Operational/model privacy/provenance refusals remain 200 outcomes.

`GET /api/studio/projects/:projectId/skills` requires authentication and returns `{projectId,skillSourceState,skillSources:[{id,version,contentHash}]}`; no skill content. Source failures return `unavailable` with constant issues.

## Actual safety/reachability

Intake datasource grants bind the entire caller body before classification. The classifier receives only protected prompt/answers; it never receives skills. Invalid, ambiguous, or truncated determinations never dispatch a builder. The workflow branch lazily loads project-bound skills, rechecks datasource grants against those exact bytes, then pseudonymises/gates third-party context before a workflow planning call.

The ordinary model gate continues to refuse imported prose. A **separate explicit human send action** is available only when the existing envelope accepted the bounded source shape, independently re-proved its residual text, and its payload tier is at most 2. The refusal then includes `review:{hash,preview,unchecked}` for the authenticated operator. The UI renders the masked preview and scan limitations; only a deliberate confirmation resubmits `reviewedSkillHash`. That version-2 hash binds the purpose, operator, project, complete protected prompt context, exact protected skill context, and server-resolved connection/destination/model/policy identity via `StudioCreateDeps.modelBindingId`. Changed content/identity/project is refused and offered a fresh review. Restricted, residual-PII, malformed, and oversized contexts never get an approvable packet. Third-party authorship is not changed and no global gate is relaxed. This action approves one model send, not host execution or publication.

The workflow output proof preserves every generated value but uses schema-owned domain labels for the workflow and intake-field `name` properties (those are not person records). The complete projected output is checked with pseudonymisation and the generated-artifact gate. Any identifying output that would need replacement is refused, not restored. Integration tests cover actual HTTP review-to-proposal reachability and nested personal-record output.

The pure workflow planner is exercised directly with skill fixtures. It validates the host-compatible ladder, exact lower-kebab slugs (3–40 chars), unique references, statutory subsets, skill-quoted page purposes/titles/roles/steps, and explicit `Human gate: step_id`, `Statutory step: step_id`, or `Human-only step: step_id` obligations. Prose-only human obligations that cannot be safely mapped ask for explicit step ids. It strips model evidence from returned pages. All proposals still require human review and host validation.

`WORKFLOW_BUILDER_ROUTE` is the compiled-in `/console/admin/build/workflows?tab=builder`; this is metadata, not a redirect or publish action. These are legacy workflow handoff metadata, **not an n8n graph/editor implementation**. The graph package/editor is a separate integration.

## Verification

### Model route integration (current scoped run)

- RED observed for missing authenticated listing, explicit route selection/no-default behavior, destination-bound review invalidation, truthful auth-separated health, and missing trusted injection binding. GREEN: **215 tests passed across 18 files**, covering all server route/workspace suites, all pipeline suites, the registry and both new provider adapters.
- New HTTP integration files: `server/__tests__/model-route-integration.test.ts` (**23 tests**) and `server/__tests__/model-destination-review.test.ts` (**6 tests**). Actual Fastify lifecycle exercises explicit local transport fixtures, review→workflow→graph and classifier→successful-subapp paths. ID/model/endpoint/policy-only changes produce a fresh review without sending skill context. No fixtures are represented as live completions.
- `npm run typecheck`, `npm run build`, `git diff --check`: **exit 0**.
- Actual standalone `server/index.ts` boot with an isolated clean environment and no model selection: public liveness 200, authenticated four unavailable/not-probed descriptors with null selection, all three model routes 409/unselected, authenticated workspace listing 200. Process terminated after verification. No native/model completion or billing probe attempted.
- Full host-aware run: **2547 passed, 5 failed, 149 files**. Three failures are the existing nonliteral docusign/maps/advantage host-manifest fixtures. Two are outside this integration in `packages/conformance/src/host-sdk-model.test.ts`: assertions still expect scanner/type-projection failures that concurrent scanner/SDK work now makes pass. Backend/pipeline/model tests passed; those independently owned conformance assertions were not changed here.

### Earlier create-pipeline evidence

Observed RED→GREEN cycles covered determination, distinct workflow planning, mandatory gates, page grounding, exact skill-byte preservation, ambiguity, output bounds, protected dispatch, HTTP auth/grants, lazy source loading, and provenance.

- Focused command: `npx vitest run server/__tests__/create.test.ts packages/spec/src/studio-create.test.ts packages/pipeline/src/__tests__/create-studio.test.ts`: **47 passed, 3 files**.
- `npm run typecheck`: **exit 0**.
- `git diff --check`: **exit 0**.
- Full run with `FLIGHTDECK_HOST_ROOT=/Users/te451223/project-contract npm test`: **2307 passed, 3 failed tests**, plus graph-child `packages/workflow/proposal.test.ts` failed to load its still-unwritten module during concurrent work. The three failed tests are the supplied baseline nonliteral host manifests (docusign/maps/advantage); their safety checks remain unchanged.
