# Sub-app IDE experience

## Scope and embedding contract

The Workbench is an editable source workspace for a real candidate supplied by the existing store. It does not own AI classification, model configuration, authorization, deployment or arbitrary code execution.

```tsx
<Workbench
  store={controller.workbench}
  onPrompt={existingGuardedPromptHandler}
  onStop={existingCancellationHandler}
  hideChat
/>
```

`WorkbenchProps.hideChat?: boolean` defaults to `false` for standalone consumers. When `true`, the original ChatPane remains mounted inside `.fd-chat-slot[hidden][inert]`. Its composer, transcript and draft survive; its grid column and keyboard stops disappear. The outer Studio conversation owns orchestration. No second conversation transport, reference callback or context-send API was added.

The root `.fd-wb` is **relative**, `width: 100%`, `min-width: 0`, `min-height: 0` and border-box. It never uses absolute positioning or an inset to escape its parent. Its default height is `var(--fd-workbench-height, 100%)`: give the host-owned workspace wrapper a definite available height, or set that property. Host chrome and scroll policy remain host-owned. Do not retain a fixed 760/850px height if the shell already measures its viewport.

## Working views

- **Sources** (legacy accessible tab name `Files`): searchable complete authoritative file list, actual source counts, existing server/web/test/host-edit groups, source selection, a capped recent-source strip, annotated line-numbered reading and the existing editable textarea. Unknown kinds are labelled explicitly. Search temporarily reveals matches through collapsed directories; clearing restores their collapse state.
- **Changes** (`Diff`): the real store-derived diff against the preceding generated round. The first round still says it has no comparison base rather than inventing an all-green change set.
- **Preview**: the existing descriptor mirror with an explicit non-execution/mock-adapter notice, actual enable-layer toggles, request/refusal diagnostics and the unchanged fidelity ledger. Unsupported manually saved page descriptors fail closed.
- **Checks** (`Gate`): actual reported rule counts, severity filtering and finding-to-source navigation. The screen distinguishes a static generated conformance snapshot from installed-host verification and marks manually edited sources as not rechecked.
- **Execution** (`Run`): only actual reported generation diagnostics or the actively selected waiting-for-diagnostics state; no shell, terminal execution button, package installation simulation or inferred adapter. An actual failed follow-up is shown even though it produced no new candidate. Explicit historical round selection keeps its original run linkage. A settled answer with zero reported steps no longer receives a green execution-success badge.

Tabs have stable IDs, linked `tabpanel`s, roving keyboard focus and Arrow/Home/End navigation. Visited panes remain mounted behind `hidden` and `inert`; changing workspace views preserves editor DOM identity, textarea selection, unsaved buffers and the preview iframe. Source panes and lists scroll internally. At mobile widths the retained explorer can be shown with Files; selecting a file closes it and returns focus to the explorer toggle. Desktop view controls remain compact rather than inheriting a whole-screen mobile target policy.

## Source lifecycle and security

The existing store/editing/selectors remain unchanged. Edit changes a local buffer; **Save** applies the local overlay read by Sources, Changes and Preview. **Revert** drops unsaved typing but keeps the saved overlay. **Restore generated** removes the overlay. Locks, conflict resolution, read-only in-flight writes and historical rounds keep their existing semantics.

Saving does not alter generated round history, rerun conformance, install files in a host or execute source text. Source annotations explicitly disclose their generated-snapshot origin when manually edited lines may have moved. Historical source no longer reads a draft belonging to the latest working round.

PreviewFrame and its portal were not modified. The iframe remains `about:blank` with exactly `sandbox="allow-same-origin"`; there is no `allow-scripts`, source evaluation, frame script, native form submission, popup or top-navigation permission. The mirrored page is still a descriptor-driven UI with a labelled mock capability adapter; it is not a deployed app or a production backend.

## Visual and motion contract

All Workbench CSS is scoped beneath `.fd-wb`. Atlas host tokens are consumed through Workbench-local aliases with inspected light fallbacks; host `--bg`, `--surface`, `--surface2`, `--ink`, `--muted`, `--line`, `--te`, `--green`, `--amber` and `--red` are not redeclared. Arial chrome and local technical monospace require no downloaded fonts. Thin orange selection lines, restrained surface layers and a subtle preview-grid background are original Flightdeck styling, not a copied brand shell.

Panels and newly revealed actual file rows use one 200ms fade; control color transitions are 160ms. There is no looping caret, particle animation, synthetic typing or staged fake progress. `prefers-reduced-motion: reduce` disables animation, transitions and smooth scrolling for descendants and pseudo-elements. The Studio shell's existing `data-motion="off"` descendant rule also applies without another Workbench prop.

## Verification — October 14, 2026

Tests were introduced and observed failing before each production behavior change. Existing Workbench tests were not removed or weakened.

- Release command: `FLIGHTDECK_HOST_ROOT=/Users/te451223/project-contract npm test -- --maxWorkers=4` — **195 Vitest files / 2898 tests passed**, followed by **16 Docker companion tests passed**. Counts include the concurrent shell/workflow changes in the shared checkout; this is not a Workbench-only total.
- `npm run typecheck` passed. `npm run build` passed with the existing Vite large-chunk advisory; no dependency or bundler configuration was changed here.
- Browser fixture: `http://127.0.0.1:5180/src/workbench/__tests__/browser.html`. It imports only browser-compatible Workbench code and fetches the existing frozen real code-generator output. It makes no model request and imports no Node/filesystem fixture module.
- **21 assertions at each of 1440×900, 1280×577 and 390×844: 63 browser assertions passed**, with no captured browser errors or unhandled rejections. These exercised actual tree search/selection, retained DOM/buffers/selection, Save/Revert/Restore, real diff readback, stale-check notices, portal rendering, enable-state refusal, unsupported descriptor refusal, retained chat and an explicitly labelled store failure diagnostic. The last item is a fixture diagnostic, not a claim that a host command was executed.
- Native CDP ArrowRight changed both selected and focused tab from Files to Diff. Native Tab traversal on mobile never reached a hidden/inert descendant. Reduced-motion emulation returned `animationName: none` and `transitionDuration: 0s`.
- Read-only HEAD of unchanged staging `http://127.0.0.1:8790/` returned HTTP 200 and CSP including `default-src 'none'; script-src 'self'; frame-src 'self' about:; form-action 'none'`. No staging image/service was changed by this Workbench task. Source-fixture browser verification does not establish a staging cutover or live provider completion.

Evidence retained outside the repository:

- `/Users/te451223/.hermes/cache/scratch/workbench-ide-1440.png`
- `/Users/te451223/.hermes/cache/scratch/workbench-ide-1280.png`
- `/Users/te451223/.hermes/cache/scratch/workbench-ide-390.png`
- `/Users/te451223/.hermes/cache/scratch/workbench-browser-verification.json`
- `/Users/te451223/.hermes/cache/scratch/workbench-full-tests.txt`

The pre-change root was measured at `(0, 0)` filling the 1440×900 viewport despite its embedded parent. The current mobile root measured `(16, 56)` with width 358 and height 772, contained in its parent; document width remained 390. Final screenshots show the actual edited checkout. A durable pre-change screenshot was not saved, so the geometry observation is not presented as a screenshot comparison.

## Boundaries retained

This task changes only `src/workbench/**` and this document. It adds no backend/provider/host/deployment changes, credentials, billing behavior, schema extensions, arbitrary code runner, automatic activation or production-pass claim. Shell integration and any later rebuild/cutover remain separate parent-owned work.
