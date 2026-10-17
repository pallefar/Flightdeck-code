# Protected native Studio pipeline

## Scope and API

This implementation changes only `packages/pipeline/src/create-studio.ts`, adds `build-subapp-spec.ts`, and adds the two native pipeline test files. It does not mount a host sub-app, start services, call a provider, install dependencies, evaluate generated source, write generated files, or change the legacy sub-app translator.

`create-studio.ts` exports the trusted server injection:

```ts
export interface NativeStudioAuthoring {
  readonly policyBindingId: string;
  readonly draftWorkflow: (input: {
    readonly prompt: string;
    readonly answers?: Readonly<Record<string, string>>;
    readonly projectId?: string;
    readonly projectSkills: readonly ProjectSkill[];
    readonly workflow?: StudioWorkflowDraft;
  }) => Promise<unknown>;
  readonly draftSubapp: (input: {
    readonly prompt: string;
    readonly answers?: Readonly<Record<string, string>>;
  }) => Promise<{ spec: unknown; understanding: string }>;
}
```

`StudioCreateDeps.nativeAuthoring?: NativeStudioAuthoring` selects this path. Omitting it preserves the existing JSON determination/planner/translator path, including the legacy skill review purpose. There is no native-to-JSON fallback. The semantic JSON determination and its existing gates still run before dispatch. Both native targets require an exact lowercase-kebab project id of at most 64 characters; missing or malformed project identity returns `needs_input` with `projectId` before either native callback.

The binding is a nonempty string of at most 1,000 characters. The composition root must construct it from the actual engine/system prompt/tools/limits policy, as well as binding the selected connection separately. The pipeline snapshots its policy primitive and actual callback references before asynchronous work. It does not construct an agent loop or enforce the root's shared six-model-call/sixteen-tool-call budget.

Native callbacks run only inside the existing protected/pseudonymised create callback. Sub-app arguments contain only protected prompt/answers, never skills, registry source, generated files, credentials or host grant state. Human answers are independently copied before the sub-app callback; a callback cannot change a declined permission by mutating those arguments.

## Workflows

With server-loaded skills, the existing lazy skill loading, fresh authorization callback, third-party provenance, exact send review, `planStudioWorkflow` evidence/page validation, declared statutory gate checks and metadata output privacy proof remain in force. Only after those checks does native `draftWorkflow` receive the protected skills and the actual accepted `StudioWorkflowDraft` with authoritative step ids. Skills and workflow metadata are cloned before the callback, so mutation cannot remove mandatory steps from the subsequent proof. No `node0` or other fabricated skeleton is supplied here; the server runner must construct its protected skeleton from these actual ids.

The returned graph is bounded before schema traversal and reparsed with `graphSchema`. `preservesWorkflowSteps` proves one manual entry, reachable connected nodes leading to terminal outputs, and unavoidable approval nodes; the skill-grounded path additionally preserves every planned step and statutory step. The same graph-label scanner alias, exact unchanged pseudonymisation check, and `gateGeneratedArtifacts` boundary used for existing graph output apply to native graphs.

When **both** loaded and reference skill arrays are empty, explicit native mode may return:

```ts
{
  status: 'workflow-graph-proposed', target: 'workflow',
  determination: { target: 'workflow', reason: string },
  graph: Graph, projectId: string, skillSources: [],
  warnings: [
    'Local-only draft: review and configure adapters before local execution.',
    'No host authority: no project pages, host metadata, publication or execution grants are established.'
  ]
}
```

There are no invented workflow-country/intake/page metadata fields. An explicitly unavailable loader refuses; it is not equivalent to an empty loader. Reference-only skills do not authorize either general drafting or host metadata. Without native injection, empty skills retain the existing request for project skills.

Native send reviews use purpose `studio-workflow-skill-send/3-native` and add `nativePolicyBindingId` to the existing model/project/actor/prompt/skill hash context. Legacy purpose remains `studio-workflow-skill-send/2`. An old JSON review or a changed native policy cannot authorize the native callback. Review previews contain the complete admitted protected skill payload, never a silently sliced preview. Transport/UI bounds must either admit that complete packet or refuse it, not truncate it.

## Generator-native sub-apps

`build-subapp-spec.ts` exports:

- `buildSubAppFromSpec(input: BuildSubAppSpecInput, deps: BuildSubAppSpecDeps): Promise<BuildSubAppSpecOutcome>`.
- `BuildSubAppSpecInput`: `{ prompt: string; answers?: Readonly<Record<string,string>>; spec: unknown; understanding: string }`.
- `BuildSubAppSpecDeps`: `Pick<BuildDeps, 'ctx' | 'digest' | 'names' | 'authorship' | 'maxPayloadTier' | 'onModelDecision'>`; there is no LLM parameter.
- `NativeGeneratedSubApp`: the actual generator result with `registryPatch` projected to inert `{file, importLine, entryLines}` data instead of its callable patch methods.
- `BuildSubAppSpecOutcome`: existing non-proposed `BuildOutcome` variants, plus the existing proposed outcome fields with `generated: NativeGeneratedSubApp`. The enclosing `subapp-result` outcome accepts this union without falsely typing inert patch data as executable functions.

The generator's own `miniAppSpecSchema` is the input contract, not the legacy planner shape and not `translateSpec`. The admitted subset is the database-free `mini-app` profile, no nonempty tables, no settings panel, and only `list-contracts`, `list-proposals`, and explicit `propose` operations. Proposal form fields, `ticketField`, `proposalKind` and `auditEvent` must be present in the schema-bound spec. Arbitrary effects/contributions are not expressible. Codegen retains its cross-field and emitted-invariant checks.

Preflight rejects getters without invoking them, cycles, custom prototypes, symbols, functions, prototype keys, excessive depth/count/bytes and malformed values. Native build input is bounded to 120,000 UTF-8 JSON bytes, depth 16, 10,000 values, and at most 100 entries in any array. Graph input is bounded to 100,000 bytes with the same structural limits. Understanding is nonempty and at most 8,000 characters. Callback return wrappers are also bounded and must have exactly `spec` and `understanding`.

Operator prompt/answers are independently pseudonymised and gated in the pure builder. Model-owned spec strings and understanding must pass an unchanged pseudonymisation/output privacy check **before** returning questions or generating sources. Only schema-owned domain/field/workflow `name` keys are aliased for scanning; all their string values, including embedded structured text, remain scanned.

### Human choices before sourcegen

Stable standard question ids:

- `consent:read:contracts`
- `consent:write:inbox-proposal`
- `visibleToRoles`
- `navSection`
- `icon`

Capability questions cover both declared scopes and scopes required by the actual operations. The model cannot bypass a question by omitting its manifest declaration. Consent requires exact `yes` (case/edge-whitespace tolerant); ambiguous prose grants nothing and explicit `no` is never overridden by the model. Audience answers are an exact unique comma/whitespace-separated role set matching the final spec. Navigation and icon must exactly match the human answer. A broader or different model audience/navigation/icon causes another targeted question, not an invented choice.

The prompt may provide complete standalone assignment lines, such as `consent:read:contracts: yes`, `visibleToRoles: legal`, `navSection: Contract pipeline` and `icon: 📋`. Repeated assignments are ambiguous; unrelated prose about reading contracts, administrators or permissions is not consent. Explicit round-trip answers take precedence over prompt assignments. No generator call occurs until the consequential choices are proved.

These choices authorize only a **draft manifest ceiling**, never host access. Accepted candidates explicitly warn that host installation, project consent and effect-time capability grants remain required.

### Actual generation and gates

The admitted spec goes through the real `generateSubApp` from `codegen/src/pure`, not a fixture or stub. All real files are returned, including inert standalone harness source. Actual host files are passed to all seven `runConformanceGate` checks and to `gateGeneratedArtifacts` with the correct `contents` → `content` mapping. Conformance errors refuse with a fixed message. Artifact privacy refusal returns the existing sanitized gate decision. Registry patch methods are removed before returning the wire candidate. The new generator provenance marker is preserved in emitted manifests.

No generated sources are sent back to a model. Native callback exceptions and malformed/sensitive output never cause a fallback or echo exception details. Existing fixed refusal categories are used.

## Verification

Vertical RED → GREEN cycles were exercised for general local graphs; reviewed native graphs; stale/legacy policy reviews; missing project identity; real pure generation; missing human choices; getter preflight; sensitive model prose; direct operator privacy; unsupported profile/settings; explicit prompt assignments; native sub-app dispatch; protected-step mutation; consent mutation; bounded policy binding; canonical project ids; operation-required scopes; missing project for sub-apps; visible draft-ceiling disclosure; asynchronous callback/policy pinning; and numeric project coercion. The initial pure-generator test failed on the absent export before the module was implemented. Subsequent tests exercised actual exported functions.

Additional passing regression matrices cover disconnected/cyclic/bypassed/secret/malformed graphs, loader refusal, reference-only contexts, genuine in-memory grant refusal, sensitive request refusal before all callbacks, native exceptions without fallback, exact answers, malformed specs, controlled post-generation source mutations, and callback question round-trips. Controlled mutation tests start with real generator output: removing an emitted enable guard fails conformance; inserting sensitive bytes after the spec proof fails the output gate. Static TypeScript-AST closure traversal verifies the new builder reaches actual codegen/conformance but no CLI/apply modules, and its only external import is `zod`.

The actual create result is JSON-serialized and parsed through the real browser `parseStudioResult`; real generated file bytes and the `generatedBy: "flightdeck-studio"` manifest marker survive. The general local workflow result is also accepted by that exact strict browser DTO with `skillSourceState: 'empty'`. These are deterministic local adapter fixtures, not live SDK/provider or host execution evidence.

Current verification command (report path is scratch, not runtime state):

```sh
npx vitest run packages/pipeline packages/spec packages/codegen/src/__tests__/pure-closure.test.ts --maxWorkers=2 --reporter=default --reporter=json --outputFile=/Users/te451223/.hermes/cache/scratch/native-pipeline-final.json
npm run typecheck
```

Latest complete selected run: **238 assertions passed across 14 files**, including **68 native assertions** (39 native-create; 29 native-subapp-spec). Typecheck passed. This selected run is not the repository-wide historical 3,542-test suite, and is not added to earlier overlapping focused counts. The parent owns root/runtime/UI/harness integration and the whole-suite acceptance run.

### Verified source hashes

SHA-256 of the final owned source/test bytes:

| File | SHA-256 |
| --- | --- |
| `packages/pipeline/src/create-studio.ts` | `57dd2ed21fd318fac65362fd0e2e88198b04c7d8224f6fa38c71a3fe129bad57` |
| `packages/pipeline/src/build-subapp-spec.ts` | `fd178116e0f07156244c9f35303d2fb7a11803a8075e9af11ff2e61842dfd4f7` |
| `packages/pipeline/src/__tests__/native-create.test.ts` | `87074dcbf20c6209005c01bf290d4b218b236054a78717f0c6400d76155f61b2` |
| `packages/pipeline/src/__tests__/native-subapp-spec.test.ts` | `bf6e35efc57e75b5537fb0b7aa252ddf93de6edea190e6d3638189567e261f8a` |

The final JSON report contains 238 physical `assertionResults` records across 14 files, all passed; its SHA-256 is `807d04ae4222f42c9e9f0d1b80e772d0a33abac9afc161f80f0dcc476ed34a93`. Counts were aggregated from the actual report, not deduplicated display names or overlapping runs. Earlier shared-workspace typecheck failures in harness `Action`/a missing concurrent UI module were subsequently resolved by their owners; the final typecheck passed without changes to those files from this lane.

## Remaining boundaries

The root must opt in and supply a genuinely bounded native engine, exact model destination binding, actual protected workflow skeleton and shared request budget. This seam does not prove vendor access, cancellation/drain, host source ABI compilation, mounted routes, host grant freshness, execution, publication or deployment. Standalone harness files are returned as reviewable text only. Conformance is the existing static candidate gate, not a full host mount/VERIFY run. Existing privacy scanners have documented coverage limits and do not certify anonymity.
