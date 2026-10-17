# Workflow block-building IDE

The canvas edits the actual opened DAG draft. It is not a second graph preview, a code generator, a tool-use simulator or an execution receipt. The shared Studio chat/workspace shell is owned separately.

## Parent integration contract

- `WorkflowEditorProps.buildReveal?: boolean` defaults to `false`. Opt in only when mounting an explicitly accepted AI graph. `initialGraph` remains initialization-only; ordinary navigation/parent updates must retain the editor instance.
- Call `editorRef.current.confirmReplacement()` once immediately before accepting an external replacement. Clean documents return `true` without prompting. Edited graph JSON or unapplied Inputs/Parameters drafts require the existing explicit browser confirmation. Cancellation does not mutate graph/history. Confirmation does not itself replace the graph or approve anything.
- After acceptance, remount with a new document key. Do not use queued replacement commands or treat `buildReveal` as an acceptance flag.
- `insertResource(selection)` remains the existing synchronous one-shot edit. The parent still owns its synchronous project/operator scope check. Insertion creates a reference plus literal mappings, never connections, activation or execution.
- Embedded workspaces may set `--workflow-canvas-height`. The previous responsive height is the fallback. Initial fitting waits for a nonzero, non-hidden viewport; later navigation preserves the existing zoom/scroll rather than fitting again.

## Registry / build manifest

The compact **Registry** disclosure sits in the canvas toolbar and starts closed. Its accessible name is **Registry / build manifest**. All counts come from the current graph and actual `builtinRegistry` resolution:

- node and connection totals;
- existing builtin instances versus reusable-wrapper instances and graph-local wrapper definitions;
- resource-reference nodes, mapping rows and mapped nodes;
- unknown registry types or registered unconfigured placeholders;
- actual schema/configuration warnings, including incomplete resource references.

Each node lists its family, base type where relevant, effective configuration shape, registry-default shape and mapping count. Its settings button opens the same native `NodeSettings` modal used by the canvas, preserving the mounted form and unapplied draft. Results remain **Not run** until actual execution supplies them.

Wrapper declarations show their purpose, base/default shape and actual instance count. Definitions present at an AI mount are labeled **AI graph declarations · review required**. This is declaration provenance, not evidence that the model performed human review. References do not grant resource/project authority, and graph declarations cannot approve independent-human gates.

Configuration summaries deliberately omit literal field values, HTTP destinations/bodies, credential identities, LLM instructions and model labels. They show typed field names/counts, allowed method/condition identifiers, presence/absence and explicit resource revision/function references. This is bounded UI disclosure, not a general anonymization claim.

## AI block proposals

**Custom block** remains a local declarative JSON editor. **Ask AI for a block** is disabled when the trusted parent does not provide `onRequestBlock`, with selected/configured-model guidance. Opening either control does not call a model. The AI opener focuses its actual purpose field.

Only **Request block proposal** invokes the injected guarded callback with the current graph. The review panel explains reuse-first behavior and the strict JSON contract. The existing `customBlockSchema` validates the response; executable JavaScript, unknown keys and approval wrappers remain forbidden. The user must tick the existing human-review checkbox and explicitly choose **Add reviewed reusable block**. Adding a definition and inserting an instance are separate, single-undo edits. A proposal never auto-adds nodes.

Pending requests disable reviewed Add. Document/model-context changes invalidate pending review and discard late results; closing/reopening the panel invalidates its request token. The editor does not claim that cancellation stopped an already-started remote operation. The existing server graph planner already says “Reuse builtins first”; no backend/provider/prompt changes were made here.

## Topology reveal

Only the initially accepted topology receives entry motion. Node content uses opacity/filter; positioned wrappers never animate transform, left or top. Connector paths use normalized dash drawing. The 138 ms entry plus an index capped at eight 20 ms stagger slots finishes within 300 ms even for 100 nodes (Chromium measured 298.00000000000006 ms). No timers manufacture build tasks, numeric progress, tool calls, run data or receipts. Edits, undo, palette changes and display changes do not replay entry motion. Local new/template/import actions clear it.

`prefers-reduced-motion: reduce` disables editor animation and transitions, leaving status colors unchanged. Chromium verified initial opacity 0.25 normally and 1 with reduced motion.

## Verification

Strict RED → GREEN runs covered actual counts/default resolution, safe summaries, unresolved placeholders, collapsed manifest, node-card semantics, unavailable AI controls, real imperative handoff behavior, unapplied mapping-row edits, explicit block JSON proposals, pending/stale refusal, prompt focus and first-visible fitting.

Verified on the combined source checkout:

- workflow Vitest: **83 passing tests in 12 files**;
- host-aware default suite: **2,897 Vitest tests in 195 files**, plus **16 Docker node:test tests**, all passing;
- `npm run typecheck` and `npm run build` succeeded;
- **7 new IDE browser groups**, **26 preserved native/core/mapper groups**, and the existing synchronous resource-ref browser smoke passed;
- native CDP registry → real modal and explicit DEVELOPMENT proposal controls passed;
- actual responsive canvases at 1440×900, 1280×577, 1024×768 and 390×844; no document horizontal overflow and editor chrome below 170 px;
- maximum 100-node reveal, real reduced-motion emulation, retained drafts, native Escape/focus, scrolled placement, movement, mapping results and one-action undo remained working.

The build retains Vite’s existing >500 kB chunk warning. A broad intermediate run encountered another worker’s still-red workbench tests; the subsequent complete suite passed. No source outside `src/workflow/**` and this document was edited by this worker. No model credentials, providers, backend, host, live service or frozen staging deployment were changed.

Browser evidence (scratch files):

- `workflow-ide-results.json`: seven new browser groups;
- `workflow-old-regression-results.json`: 26 preserved groups;
- `workflow-resource-ref-result.json`: atomic resource-ref smoke;
- `workflow-ide-screenshots.json`: six screenshot paths (responsive canvases, registry, actual modal and explicit DEVELOPMENT block review).

All are under `/Users/te451223/.hermes/cache/scratch`. The proposal fixture is clearly labeled DEVELOPMENT and uses an injected callback, not a vendor model or a fake main application. Real model completions remain unverified/unavailable without the operator’s selected configured connection. Docker rebuild/release is the parent’s separate step.
