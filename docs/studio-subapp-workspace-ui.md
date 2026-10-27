# Durable sub-app source workspace UI

## Delivered boundary

`SubappWorkspace` is a compact, initially closed disclosure intended for the existing Studio IDE header slot. Its native modal is outside editor layout flow: opening it adds no source viewport rows. The parent supplies the existing Workbench store, in-memory project/token scope and active IDE state. Optional `onLoaded` runs once after a successful explicit saved-source replacement so the parent can clear an old accepted-chat receipt.

```tsx
<SubappWorkspace
  store={controller.workbench}
  projectId={projectId}
  token={token}
  active={view === 'ide'}
  fetcher={fetcher}
  onLoaded={() => { /* clear an obsolete accepted-chat receipt */ }}
/>
```

No automatic draft reads, saves, source downloads, model calls, checks or execution occur on mount or disclosure open. All persistence is through the shared `/api/studio/workspaces/:projectId/subapps` routes. This is operator-scoped local partitioning, not authenticated host-project authority, host installation or deployment. Parent composition-root mounting is a separate integration responsibility; this slice does not edit StudioApp, Workbench, the existing store, result parsing, routes or schemas.

## Source/evidence semantics

- **In-session Save** remains the existing editor action; it applies a buffer to the Workbench saved overlay only.
- **Save draft** creates a separate durable identity. **Save new revision** updates only the linked identity using its exact expected revision.
- Capture requires the latest selected round, no current generation and no dirty/conflicted buffers. It synchronously copies the immutable generated `baseline` and the effective saved working `files` before any await.
- Successful writes require a separate GET of the exact identity and comparison of the complete returned document, revision, SHA-256 and exact captured snapshot. A successful mutation response alone is not success.
- A failed/mismatched readback is uncertain even if that GET fails with 401/404/409. Cancellation after mutation dispatch remains uncertain across close/hide and scope changes; no retry occurs. Refresh does not erase uncertainty. The user must inspect and explicitly open a saved record before another save.
- CAS refusal preserves all editor state. Saved identity is bound to the exact latest round object, not its potentially reused ID, and survives overlay edits and ordinary navigation. A real new round resets it, including changes discovered on reconnect.
- Open fetches and verifies the requested saved document, confirms replacement of existing work, then rechecks scope/epoch and editor state **after** confirmation. Changed context or declined confirmation leaves source untouched.
- Restoration validates/stages before replacing anything. It restores the generated baseline as a Workbench round and applies differing working files through actual `editFile`/`saveFile`. Original findings/rules/notes stay separate. The restored round has no checker steps; no build, verification or execution result is inferred.
- **Download source bundle** works without a credential, after a separate explicit gesture. It is versioned, portable plain JSON containing source strings and original evidence—not an executable application. It neither applies files to host paths nor evaluates source. Browser textarea line endings follow native textarea normalization; direct snapshot/HTTP transfer separately proves exact CRLF and Unicode preservation.

The browser client uses only browser-safe shared DTO contracts and Web Crypto, never server/filesystem imports. Responses are stream-byte-capped, fatal-UTF-8 decoded and native-JSON preflighted before recursive schema parsing. Project, UUID, revision, digest, duplicate identities, MIME and exact response status are checked. Requests are no-store and refuse redirects. Native Fetch is invoked through a receiver-safe wrapper. Abort/epoch checks bracket transport, stream reads, digest work, chained readback and confirmation; untrusted hung stream cancellation is never awaited. Credentials remain in memory/Authorization headers, not request JSON, local storage, source exports or logs.

## Verification

Final focused run: **101 passing physical assertions in six files**, including **36 assertions in the four new sub-app test files** and 65 existing Workbench editing/store assertions. `docs/evidence/studio-subapp-workspace/vitest.json` preserves the actual per-file assertion records; these numbers do not sum overlapping runs.

```sh
TMPDIR="$HOME/.hermes/cache/scratch" npx vitest run \
  src/studio/__tests__/subapp-workspace-client.test.ts \
  src/studio/__tests__/subapp-workspace-controller.test.ts \
  src/studio/__tests__/subapp-workspace-snapshot.test.ts \
  src/studio/__tests__/subapp-workspace-ui.test.tsx \
  src/workbench/__tests__/editing.test.ts \
  src/workbench/__tests__/store.test.ts --maxWorkers=1
npm run typecheck
```

Repository typecheck and a complete Vite production build to an owned scratch directory passed. Vite reports its existing >500 KB chunk-size advisory; this work makes no bundle-size/performance improvement claim. Tests include actual `generateSubApp(minimalSpec)` output, real authenticated loopback routes, a private file-backed store reconstructed from disk, exact manual CRLF/Unicode byte comparison, dirty/conflicted refusal, exact revision readback, failed-readback uncertainty, duplicate-click blocking, scope/hide cancellation and stale confirmations.

Real Chromium fixture: **22 lifecycle assertions passed** using the default native browser Fetch against the actual routes and an isolated synthetic private file store. The recorded request sequence is one POST, one PUT and the five explicit/verification GETs—no model/run/extra mutation calls. The actual source viewport was 300.15625 px at 1280×577 and opening the modal did not change it. A separate mobile layout measurement at 390×844 recorded 404.5625 px of source, viewport-contained modal bounds and no horizontal document overflow. Day and host-token Night captures are retained. Native CDP Tab, Shift+Tab and Escape additionally proved focus wrap and return to the exact disclosure opener.

Evidence is under `docs/evidence/studio-subapp-workspace/`: `desktop-result.json`, `native-keyboard.json`, `mobile-layout.json`, the Vitest JSON report and Day/Night desktop/mobile PNGs. No production credentials or user source were used. The browser fixture intercepts its explicit Download gesture through the trusted `onDownload` seam; OS/browser download-manager delivery was **not** exercised. The tested source bundle itself contains the exact working source and distinct generated baseline.

## Isolated browser reproduction

```sh
npx vite --config src/studio/__tests__/subapp-workspace.vite.config.ts
# Open /src/studio/__tests__/subapp-workspace.browser.html on loopback port 5196.
```

The dedicated no-HMR/no-production-proxy config boots actual routes with an explicitly nonsecret synthetic fixture credential and a new private scratch store. It never reads the normal operator store, provider settings or user fixtures. Default scratch is `$HOME/.hermes/cache/scratch`; `SUBAPP_FIXTURE_SCRATCH` can supply another trusted existing scratch directory. The generated fixture is inert JSON in `subapp-workspace.generated.snapshot` (not runnable copied `.test.ts` files).

In the browser, invoke `verifySubappWorkspaceFixture(window.subappFixture)` from the module export once per fresh fixture server. It performs deliberate synthetic saves, so do not blindly replay it against retained state. The development request-count endpoint is fixture-only. The first fixture attempt honestly failed because the actual shell TMPDIR traversed macOS `/var` symlink; the private store correctly refused it. The owned config was corrected to canonical trusted scratch without weakening store checks. All dedicated fixture processes and synthetic state are stopped/removed after verification. No providers, host writes, installations, containers or commits are part of this verification.
