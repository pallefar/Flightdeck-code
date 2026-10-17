# Workflow card local-run status

This is a source/local-preview improvement. It is not yet promoted into the private Studio image on port 8790. Publishing the source does not deploy it, authenticate a reviewer, configure a connector or call a provider.

## What the cards show

Canvas and Stacked use the same cards and local execution result. Expanded and Compact display the full status text:

- **Completed**, **Skipped**, **Paused**, **Blocked**: the last matching record for that node in the actual local trace.
- **Not reached**: a local result exists, but it contains no record for that node. This is not Skipped. An overall blocked or paused result is never copied onto unexecuted nodes.
- Before a run, there is no result badge. A whole-graph admission refusal with an empty trace leaves every node Not reached.

Badges contain no captured input/output, error messages, human names, timings or usage estimates. They add no tab stops, buttons, live regions, approval or resume actions. Existing header buttons reference their bounded local-result descriptions. Observed branch descriptions use only the trace's literal `details.selectedPort`, never configured branch labels or arbitrary payload fields. Detailed diagnostics remain in Results.

These are **last local results for the applied graph**, not results for an unexecuted seed or unapplied Parameters/Inputs drafts. Editing the seed alone preserves that history. Running does not apply pending forms.

## Freshness and interaction

Displayed and pending results belong to the exact editor store snapshot. Applied edits, effective Undo/Redo and document replacement invalidate them. Undo can restore an old graph object, so graph-object equality alone is insufficient: edit → Undo while an adapter is pending must not revive its completion.

View, display, zoom, settings-modal and selection changes preserve the same result, shared card DOM, graph/history and independent unapplied Parameters/Inputs drafts. Applying Parameters must not silently apply or erase Inputs.

Discarding an obsolete UI result does **not** cancel an adapter, undo an external effect or provide execution authority.

## Verification and reproduction

The host-aware default test entry passed **4,072 Vitest assertions in 268 files plus 32 Node tests**, with typecheck/build/diff checks. All 4,042 assertions from the preceding published checkpoint remain present; 30 assertions were added.

Use the isolated no-API preview described in `stacked-workflow-view.md`. Its developer-console probes include:

```js
await window.stackedTests.localRunStatuses();
await window.stackedTests.localRunStatusGates();
await window.stackedTests.localRunStatusRetention();
await window.stackedTests.pendingRunFreshness('undo');
await window.stackedTests.pendingRunFreshness('view');
```

The delayed freshness fixture uses an explicitly DEVELOPMENT-only owned promise with no network transport. Approval configuration there is a development queue label, not a real authenticated reviewer. No providers, private saved workspaces or running services are changed by these probes.

Bounded responsive checks cover Day/Night, Canvas/Stacked, Expanded/Compact and three viewport sizes, with inherited motion-off or reduced motion. Geometry/contrast samples include all five status texts. These fixtures are not a full accessibility certification, a real-provider acceptance test or a production deployment approval.
