# Reviewed local workflow fragments

## Delivered boundary

The actual `WorkflowEditor` now exposes **Compose fragment** in a selected builtin `unconfigured` slot's inspector / native block settings. It does not add another default toolbar row or a nested subflow node. One explicitly reviewed finite fragment becomes ordinary supported graph nodes through the unchanged `composeWorkflowFragment` API.

This is an **in-memory local graph edit**, not deployment, host integration, server persistence, an approval receipt, a model request, a plugin install, tool activation or execution. Current documents do not provide an authoritative host protection binding. The modal says so. Optional protection lists are accepted only by the trusted `WorkflowEditorStore` constructor; fragment JSON cannot supply a host graph or protection grant. Production host-bound admission and exact server revision/readback remain separate work.

## Interaction

1. Select an unprotected builtin placeholder with exactly one incoming and one outgoing connection.
2. Apply any pending Parameters / Inputs first. Composition refuses rather than silently saving or discarding settings. Visited forms remain mounted and hidden across node selection; parameter and mapping dirty states are independent. Refusal is visible inside native block settings when that is the current top layer.
3. Choose **Compose fragment**. Opening stops owned walkthrough narration before displaying raw source and gates walkthrough playback. The native dialog starts with a visibly labelled, deterministic **local example, not AI-generated**: identity entry → exclusive branch → yes/no set nodes → identity exit. It has supported configuration and distributed explicit coordinates.
4. Paste/edit bounded graph JSON and explicit entry ID, exit ID and namespace. **Inspect exact fragment** uses the real pure transform. Actual inserted/expanded counts, node/effective-base facts, mapping counts and an expandable exact expanded graph plus remapping are shown.
5. Check the uniquely identified `wf-fragment-reviewed` checkbox, then explicitly choose **Apply reviewed fragment**. Any source/boundary/namespace edit or graph event revokes inspection and the checkbox. No failed/stale review is automatically retried.
6. Apply changes only the current local graph in one existing store commit. Undo and redo restore exact exported JSON. Existing `onChange` invalidates current local run/debugger results and lets the parent keep its existing dirty/saved-workspace identity semantics. No new workspace, save, server reservation or network request is introduced.

Positions from the fragment remain exact; Fit after apply and the existing explicit Fit action change the viewport only. There are no animation delays or moving editing hitboxes.

## Store contract

- `beginFragmentReview(slotId)` captures the store-owned current revision and exact ordered exported snapshot before review.
- `previewFragment(session, unknownDraft)` admits only native bounded JSON with `namespace` and `fragment`. It never accepts a caller-owned host graph, protection fields, accessors, excess bounds or executable values. Failed inspection revokes any earlier prepared result.
- Composition uses `JSON.parse` of that captured exact export. This preserves array and nested object-key order while matching normal Export semantics for internal optional `undefined` mapping fields after the existing UI clears mappings. The pure transform is not weakened or changed.
- Prepared graphs remain private; returned previews are detached. `applyReviewedFragment(session, true)` requires the literal boolean, a prepared inspection, exact current serialization **and** the same monotonic revision. Undo to identical bytes still expires a review; a nested key reorder cannot pass as sorted-digest-equivalent.
- Successful apply uses one existing commit and clears redo. Failure, cancellation, missing checkbox, invalid/oversized/accessor JSON and unsupported slots leave graph and history untouched. Session identities are store-local objects, not authority or authentication.
- Existing node/config/mapping preservation, wrapper remapping, distinct builtin identity boundaries, object payload requirement, exclusive branches, original-seed semantics, unavoidable approvals and all strict limits come from the unchanged pure API. Imported graph-local wrappers grant nothing.

## Native modal and privacy

The dialog consumes scoped host Day/Night tokens. It supports native Escape, explicit Close/Cancel, forward/backward keyboard focus containment and opener focus return, including opening above retained native block settings. Wrapper-review checkbox selectors remain separate and unchanged.

Inactive views, hidden/inert ancestors, native document hiding and unmount close the disclosure and release its private draft; reopening starts a fresh local example with no checkbox. Existing parameter/mapping forms are not unmounted by cancelling fragment review. Explicit new/import replacements clear old private form drafts; ordinary node selection retains them. Explicit node deletion releases that removed form's pending flags.

StrictMode effect replay does not destroy a live review: cleanup cancellation is epoch-checked at the microtask boundary, and an old native close event is ignored if the dialog has already reopened. Actual disclosure removal remains immediate. No raw-source narration is added. Callback-boundary tests are not acoustic evidence.

## Limits and data semantics disclosed in the UI

One fragment; 1,000,000 UTF-8 bytes per request and expanded graph; structural depth 24; 20,000 values; width 100; at most 100 expanded nodes, 100 edges and 50 wrappers; namespace at most 32 characters. The editable source also has a character cap, with the actual UTF-8 check before JSON parsing and the pure native/depth/value/width checks afterward.

Entry/exit are distinct builtin identity `set` nodes without mappings, and require object data. `kind:'input'` continues to mean the original run seed. For incoming slot data, explicitly map from entry output. Missing/skipped sources block without fallback. Host references to the removed slot retarget to the inserted exit; literal/config strings are not interpolated. All original/imported approvals remain unavoidable and independent at execution. There is no browser approval/resume authority.

## TDD and verification

Observed targeted RED failures preceded the corresponding implementation:

| Vertical | Observed RED |
|---|---|
| Store atomic review/edit | `store.beginFragmentReview is not a function` |
| Current revision / nested ordered snapshot | expected apply to throw; it did not |
| Native preflight, cancel/revoke, trusted protection | missing revoke method; forbidden payload accepted; protected slot accepted |
| Literal checkbox | truthy string accepted instead of refusal |
| Native UI entry | `Missing Compose fragment` |
| Pending settings guard | `Composition discarded or bypassed unapplied settings` |
| Explicit replacement privacy | `Explicit document replacement retained old private settings` |
| Native keyboard boundary | `Native Tab escaped modal` |
| StrictMode disclosure | `StrictMode effect cleanup dismissed the live fragment modal` |
| Source editing cap | missing `maxLength="1000000"` |
| Native settings top-layer refusal | `Dirty refusal is hidden behind the native settings layer` |
| Normal optional-mapping clear | `Unsafe JSON shape or composition budget exceeded` |
| Removed form guard cleanup | fragment could not open after explicit unrelated-node deletion |

Commands exercised without installation:

```sh
npm run test:vitest -- src/workflow/storefragment.test.ts src/workflow/fragment-review.test.tsx --maxWorkers=1
npm run test:vitest -- src/workflow packages/workflow --maxWorkers=1
npm run typecheck
```

Latest focused unit run: **241 passed across 27 files**, including **12 new store/UI tests**. Root typecheck passed. One intermediate typecheck encountered a concurrently edited `packages/providers/src/model-transport.test.ts` syntax error; the unchanged next run passed. No unrelated source was repaired.

Native acceptance uses only the owned no-HMR, no-API-proxy loopback fixture:

```sh
npm exec --no -- vite --config src/workflow/__tests__/fragment.vite.config.ts
# Native browser helper execution:
# exec(Path('src/workflow/__tests__/fragment.browser.py').read_text())
```

The fixture is source-only DEVELOPMENT verification, not the shared staging deployment. The **26 native browser acceptance groups** are recorded in `docs/evidence/workflow-fragment/browser-results.json`. Adjacent `export-before.json`, `export-after.json`, `export-undo.json` and `export-redo.json` preserve the exact actual editor exports; adjacent PNGs show Day/Night at 1280×577 and 390×844 with reduced motion both enabled and disabled. Assertions include native mouse hit tests, Tab / Shift+Tab / Escape, focus return, containment, real exact export before/after undo/redo, cancellation, dirty Parameters/Inputs, retained forms, stale review refusal, malformed/nonidentity/oversized source, namespaced custom wrappers and mapped entry/original-seed/host-exit references.

The actual editor's unchanged local runner produced:

```json
{"selected":true,"path":"yes"}
{"selected":false,"path":"no"}
```

A separately composed gated local graph genuinely paused at original node `gate`; no verifier or approve/resume button was injected. Existing unchanged native block-modal, custom-wrapper review, manifest/settings retention and document-replacement browser regressions also passed. Browser instrumentation observed zero fetch/XHR requests and zero browser errors. The final handoff reports the computed browser-group count and stopped owned fixture status.

## Parent source/native acceptance — October 15, 2026

Parent reread the complete store/review implementation and the editor's pending-form/session/commit integration, then independently reran **241 tests / 27 files**. A separate exact new-file run confirmed **12 store/UI tests**; these are included in 241, not additional cases.

Parent started its own copy of the supplied no-HMR/no-API-proxy fixture and reran the complete native harness with a different evidence directory. All **26 groups** passed again, including the real yes/no runner outputs, genuine independent-gate pause, mapped wrapper/seed/exit semantics, byte-exact export/undo/redo and native pointer Apply. All **8 desktop/mobile × Day/Night × motion cases** retained a readable **248px source viewport**, native Tab/Shift+Tab/Escape and focus return, bounded modal/page widths and matching host ink. Captured fetch/XHR and browser error counts were both zero.

Parent evidence is under `docs/evidence/next-ui/workflow-fragment-parent/`, separate from the worker's original evidence. `verification.json` records source/export hashes and the actual recount; original/undo and composed/redo exports matched byte-for-byte. Both executions cover the same 26 groups; they are not 52 distinct acceptance cases. The parent's owned fixture was stopped and port 5297 verified closed. Staging/companion/OS container IDs, image IDs and start times matched the earlier readback; staging public health remained exact `{ok:true}`. This remains an isolated actual-editor fixture, not the complete installed host or combined release. Final whole-tree/composed-app/candidate acceptance and authoritative host protection/persistence are still separate.

## Not delivered / not claimed

No host/server/package/pure-transform implementation, staging image, shared Vite process or container was changed. No provider, Resource connector or external service was called. No persistence, authenticated host protection binding, saved revision admission, approval receipt reuse or production execution authority is established. Parent-owned real composition-root / combined acceptance and final broad-suite verification remain necessary. **Not deployed.**
