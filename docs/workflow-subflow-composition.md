# Bounded declarative workflow-fragment composition

## Status and scope

`packages/workflow/composition.ts` is a standalone browser-safe **draft transformation**, not a nested execution engine or an agent SDK. It replaces one explicitly selected draft placeholder with one reviewed, finite fragment and returns an ordinary version-1 DAG. It performs no IO, calls no model, receives no credentials, grants no tools, and adds no dependencies. The existing graph validator, runner, approval verifier and preservation helper remain unchanged.

**The umbrella composition feature is not integrated or complete.** Parent independently reran the 21 composition tests and actual example, then added the public workflow-package exports with an observed RED → GREEN regression. The package now passes 119 tests / 9 files. Reviewed editor affordances, authoritative host/project bindings, persistence/revision handling and production admission remain separate follow-up work. No host source, deployed container, server, package manifest or lockfile is changed by this core slice. Parent evidence is `docs/evidence/composition/parent-core.json`.

## API

```ts
import {
  composeWorkflowFragment,
  WORKFLOW_COMPOSITION_LIMITS,
  type WorkflowFragmentComposition,
  type ComposedWorkflow,
} from '../packages/workflow/composition';

const request: WorkflowFragmentComposition = {
  graph: reviewedHostGraph,
  slotId: 'draftSlot',
  namespace: 'reviewedPart',
  fragment: {
    graph: reviewedFragmentGraph,
    entryId: 'entry',
    exitId: 'exit',
  },
  protectedSteps: ['originalManual', 'originalReview', 'originalOutput'],
  protectedGates: ['originalReview'],
};
const {graph, ids}: ComposedWorkflow = composeWorkflowFragment(request);
```

The function accepts `unknown` so runtime admission cannot be bypassed with a TypeScript assertion. Success returns a detached validated `Graph` and original-local-ID → generated-ID dictionaries for `nodes`, `edges` and `customBlocks`. Failure throws a fixed `Error` message; it never modifies either source graph, returns a partial graph, or executes anything. The result is editable, not frozen, but shares no mutable graph state with its inputs. Lookup dictionaries are metadata, not graph data or authority; use own-key lookup (`Object.hasOwn`) when consuming arbitrary original identifiers.

The strict request has only the fields above. Protection lists are optional and default to empty; all original host approvals are protected regardless. Review provenance/authentication is **not** established by this API. Its caller must supply genuinely reviewed native snapshots, authoritative protection bindings and a new exact review/persistence revision for the resulting graph. A `trusted: true` field is not accepted.

## Explicit boundaries instead of invented data semantics

- The host must already be an ordinary validated DAG with exactly one manual root, connected nodes, terminal output(s), and unavoidable approval gates, as checked with the actual `preservesWorkflowSteps` helper.
- `slotId` must name an **unprotected builtin `unconfigured`** node with exactly one incoming and one outgoing edge. No existing regular step, manual node, approval or bound placeholder can be replaced. Other host nodes and graph identity/name remain; no automatic layout is performed.
- The fragment itself passes the actual unchanged `validateGraph`, but is an open graph fragment, **not independently executable**: it has no manual trigger or output node, including output wrappers.
- `entryId` and `exitId` are distinct explicit builtin identity `set` nodes (`config: {}` or `{fields:{}}`), without input mappings. Entry has no incoming edge; exit has no outgoing edge. Every fragment node must be reachable from entry and able to reach exit. Disconnected nodes, extra roots/leaves and arbitrary additional input/output boundaries are refused.
- Identity `set` boundaries require **object payloads**, matching the unchanged runner. There is no new scalar/array passthrough or merge semantics; an adapter producing incompatible data still blocks at runtime.
- To exclude ambiguous simultaneous fan-in, every nonbranch node has at most one outgoing edge; every effective branch, including reviewed branch wrappers, has exactly two outgoing edges, one `true` and one `false`. With a single manual root this preserves one active path. Exclusive branch joins are allowed; forks, repeated branch ports and implicit concurrent merges are not.
- Every original and imported approval must remain unavoidable on every path to any host output. An approval on only one alternative branch is refused even if the graph schema accepts its structure.

Incoming host edges are retargeted to the fragment entry; outgoing host edges originate from its exit. Original edge IDs and ports are retained. Ordinary fragment nodes, including both identity boundary steps, are inserted in snapshot-array order at the former slot position. Host edges retain order, followed by fragment edges in snapshot order. This is deterministic declaration order; execution still uses the unchanged runner's dependency-ready topological order.

## Exact remapping

For namespace `part`, local nodes receive `part_n0`, `part_n1`, …; edges receive `part_e0`, …; graph-local declarations receive `part_b0`, …. Existing IDs in each respective host collection are reserved. Collisions get the first free `_2`, `_3`, … suffix. Local identifiers may already be 64 characters: they are never concatenated into generated IDs. Namespace length is at most 32, and suffix allocation is length-safe under the existing 64-character identifier limit. Original tokens are not trimmed, repaired or normalized.

All actual fragment custom declarations (including unused reviewed declarations) are copied with namespaced IDs. Their actual labels, descriptions, base types and defaults are retained. Instance `type` changes only when it refers to that local declaration; builtins are not renamed, inherited from a coincident host wrapper, or overwritten. Reserved/builtin custom definitions remain rejected by the unchanged graph schema.

Only actual graph reference fields change:

- node IDs and effective custom instance type references;
- edge IDs/source/target; `sourcePort` stays exact;
- fragment `inputMappings[].source.nodeId` references;
- a host descendant's explicit mapping from the removed slot now selects the inserted exit.

Configuration strings, branch payload field names/values, literal mappings, paths, labels and instruction text are **not** interpolated or rewritten. The current config schemas contain no graph-node-reference field. Both original and composed graphs pass the same ancestry/config/port validation.

Existing mapping semantics are deliberately unchanged: `kind:'input'` always selects the **original run seed**, not a fragment-local seed. Select the fragment's explicit entry node output with `kind:'node'` to read the incoming slot object. `[]` remains an explicit empty input replacement; omitted mappings retain incoming input. A statically valid but skipped ancestor or unavailable path still blocks in the runner without fallback. There is no inferred cross-boundary mapping or extra output selection language.

## Hard bounds and native JSON admission

The exported immutable limits are:

| Boundary | Limit |
|---|---:|
| Fragments per call | 1 |
| Whole request / expanded graph UTF-8 serialized bytes, each | 1,000,000 |
| Structural depth, root at depth 0 | 24 |
| Visited JSON values, including repeated shared subtrees | 20,000 |
| Own enumerable properties per object / elements per array | 100 |
| Expanded nodes | 100 |
| Expanded edges | 100 |
| Expanded custom declarations | 50 |
| Namespace characters | 32 |

The composition edge limit is intentionally stricter than the general graph schema's 300-edge maximum. The existing `boundedJson` helper's 100-element array bound applies to input graph arrays too. Aggregate counts are checked explicitly before allocation/final recursive validation; native JSON limits are checked again on the expanded graph. Explicit repeated calls may compose further reviewed slots, but each result remains an ordinary graph under the same expanded bounds. There is no recursive expansion or retained subflow node.

Before reading request fields or invoking recursive schemas, the actual iterative `boundedJson` helper rejects cycles, excessive depth/values/bytes, accessors without invoking their getters, symbols, hidden properties, nonfinite numbers, functions/undefined/bigints, custom prototypes, sparse/extended arrays and own `__proto__`/`constructor`/`prototype` **keys**. An additional native width bound precedes recursive graph validation. Ordinary shared JSON subtrees and frozen snapshots are accepted and cloned. Identifier **values** such as a node ID `constructor` remain literal values rather than property access instructions.

Existing graph restrictions remain additional constraints: mapping paths at most 16 segments, literal bounds, unsafe field/path/secret checks, graph counts/configs, reserved definitions, DAG acyclicity and graph ancestry. Native admission does not replace or loosen those validators.

This boundary expects native JSON snapshots in the trusted application realm (typically reviewed `JSON.parse` output), not arbitrary executable JavaScript objects. **It is not a JavaScript sandbox.** A hostile `Proxy` can execute traps during reflection; JavaScript cannot reliably recognize such a proxy without touching it. Do not pass objects from an untrusted executable realm or claim a trap-free proxy boundary. Native prototypes must remain trusted/unmodified. Secret-pattern screening is existing defense in depth, not a privacy or general secret-detection guarantee.

## Actual deterministic example

Using the already installed tooling, with no install or network calls:

```sh
npm exec --no -- tsx examples/workflow-composition.ts
```

The script validates the real host and fragment, composes them, and runs the unchanged `createWorkflowRunner`. It asserts actual execution before printing a stable JSON summary. It includes manual/set steps, both branch alternatives, a genuine runner approval pause, self-approval refusal, a separate named fixture reviewer through an injected verifier, and replay refusal. The fixture proof is explicitly nonsecret development data, **not production identity or authorization evidence**. No provider/HTTP/Resource call is made.

Observed output (timing-bearing trace diagnostics intentionally omitted from this deterministic summary):

```json
{
  "scope": "Local declarative DAG composition; no agent SDK or external calls",
  "nodeCount": 9,
  "trueBranch": {
    "status": "completed",
    "output": {"selected": true, "path": "yes"},
    "skipped": ["demo_n3"]
  },
  "falseBranch": {
    "status": "completed",
    "output": {"selected": false, "path": "no"},
    "skipped": ["demo_n2"]
  },
  "independentApproval": {
    "paused": "paused",
    "pendingNodeId": "review",
    "selfApproval": "blocked",
    "resumed": "completed",
    "output": {"selected": true, "path": "yes"},
    "verifierCalls": 1
  }
}
```

A separate real-runner test injects a deterministic LLM adapter, verifies missing-adapter and step-limit blocking, and proves exactly one bounded adapter call with the actual mapped input and `AbortSignal`. That is explicitly **not an agent SDK, autonomous loop or live model completion**.

## RED → GREEN evidence

Each new production behavior was introduced after observing its targeted failure. The repeated command was:

```sh
npm run test:vitest -- packages/workflow/composition.test.ts --maxWorkers=1
```

Preserved excerpts from actual pre-implementation RED output, followed by the observed GREEN suite count:

| Vertical slice | Observed RED excerpt | Next GREEN |
|---|---|---:|
| Initial flatten/run primitive | `expected undefined to be type of 'function'` | 1 passed |
| Native preflight | getter counter `expected 1 to be +0`; expected `/JSON/`, got `Invalid graph` | 3 passed |
| Strict envelope | expected `/request/`, got `Cannot read properties of null (reading 'graph')` | 4 passed |
| Explicit boundaries | absent slot: `Invalid composed graph`; invalid boundary: `promise resolved ... instead of rejecting` | 6 passed |
| Actual wrappers/reference remapping | `Error: Invalid composed graph` | 7 passed |
| Deterministic collision allocation | `Error: Invalid composed graph` | 8 passed |
| Protected steps/gates | protected slot and disconnected host: `promise resolved ... instead of rejecting` | 10 passed |
| Exclusive single-active flow | fan-out: `promise resolved ... instead of rejecting` | 11 passed |
| Aggregate expansion bounds | expected `/budget/`, got `Invalid composed graph` | 12 passed |
| Runnable example | child process `ERR_MODULE_NOT_FOUND` for the not-yet-created example; expected status `0`, received `1` | 18 passed |

Additional regression tests exercise unchanged graph-schema/runner contracts: real true/false ports and branch-wrapper defaults, original-seed/ancestor/literal mappings, two independent approval pauses, self/copy/replay refusal, one bounded LLM adapter call, immutable/frozen/shared snapshots, literal prototype-shaped identifier values, repeated explicit composition, and acceptance at the node/declaration ceilings. They introduce no extra production behavior. Final composition coverage is **21 tests**; the focused workflow package run is **118 passed across 8 files**:

```sh
npm run test:vitest -- packages/workflow --maxWorkers=1
```

The production module also bundled successfully in memory with esbuild `platform:'browser'`, `format:'esm'`, `write:false`; its inputs were existing Zod, browser-pure guardrails/data/graph/preservation helpers and this module, with no Node engine, IO, SDK or dynamic-execution dependency. The latest root typecheck, separate strict compilation of the module/tests/example, and `git diff --check` passed. Earlier root checks encountered concurrently edited parent-owned Anthropic setup sources; they were not repaired in this slice. The final handoff reports broad-suite failures separately rather than assuming a clean shared worktree.

A host-aware broad run, with no test filtering or weakening, was also executed:

```sh
FLIGHTDECK_HOST_ROOT=/Users/te451223/project-contract npm test -- --maxWorkers=2
```

The latest snapshot returned **4 failed / 3,083 passed Vitest tests across 215 files**, followed by **16 passed Node tests**. Failures were exclusively in concurrent Anthropic setup work: one SDK policy assertion in `server/__tests__/anthropic-session-setup.test.ts` (`logLevel` expected `off`, observed `warn`) and three invalid-credential admission cases in `src/studio/__tests__/anthropic-setup.test.tsx`. An earlier broad snapshot returned 3 failed / 3,071 passed, with old-client POST/DELETE/close invalidation failures; its unchanged isolated rerun returned 8 passed / 1 failed (close). Those sources continued changing during this work. No server/UI implementation or test was edited by this slice, and these shared-worktree snapshots are not a final release total. The parent must rerun the complete suite after its own changes settle.

## Remaining integration boundaries

The parent must review and add public exports, choose an explicit reviewed UI insertion/replace action with existing dirty-document/undo guards, bind preservation to authoritative host steps/gates, create and read back a new exact saved revision, and obtain separate effect-time authorization at run/approval/resource/model adapters. New graph IDs/references/order change graph/checkpoint/review bindings; never reuse an old approval receipt or silently replace a running graph. This pure transform establishes none of those authorities, persistence guarantees or production readiness claims.
