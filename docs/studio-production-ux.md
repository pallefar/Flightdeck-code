# Studio production-oriented workspace UX

## Scope and boundaries

The real `StudioApp` now uses `StudioShell`, not a mock or screenshot template. This is authoring chrome, not a new OS navigation system. It uses the host's orange `--te` accent, Arial stack and inherited surface/ink/line tokens. Host source was inspected read-only at `FlightDeck OS/wt-integration/flightdeck/web/src/theme.css`; no host file or OS service was changed.

- One shared application bar retains the four existing area labels and native buttons. Selection is exposed with `aria-current="page"` and `aria-pressed`.
- Shared context reports the actual current graph name, requested project ID and explicitly selected server model descriptor. No selection is shown as **Not selected**. A configured provider remains **configured · not-probed**, never a green connected indicator.
- Graph draft identity is separate from the server workspace identity. The shell makes no autosave, deployment, publication or server-persistence claim. Save, saved revisions, server execution and history remain in the existing `WorkflowWorkspace`.
- All four areas stay mounted and use `hidden`; navigation changes neither editor/workspace keys nor document identity. Approval visibility continues to use the existing `active` prop.
- Connection settings and the existing Resources/Approvals help actions disclose the single real connection form and focus its operator field. There is no new login modal, duplicated token field or browser credential persistence.
- The AI builder puts the request first in DOM and visual order. Project/model setup is a disclosure; the visible request status explains why Create draft is unavailable and distinguishes authoring from saved-revision execution.
- Existing credential/project/model change invalidation remains intact. The shell does not authenticate, refresh, approve, execute or call a model on navigation.
- Editor run help is collapsed by default. It preserves the explicit `{"approved":true}` routing-not-human-authorization warning, unconfigured adapter warning and graph-export/page-suggestion boundary.
- Connection help now distinguishes optional production built-asset same-origin serving from the local Vite development proxy. Serving assets does not configure models or grant project/reviewer authority.

## Accessibility acceptance evidence (not certification)

Primary references:

- W3C WCAG 2.2 Understanding [Focus Not Obscured (Minimum), 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum).
- W3C WCAG 2.2 Understanding [Target Size (Minimum), 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum).

These are acceptance references, not a claim that this app conforms to WCAG. The W3C pages initially presented browser bot verification; search retrieval subsequently returned the W3C criterion text. Focused components must not be entirely hidden by author content; the minimum target criterion is 24×24 CSS pixels subject to its documented exceptions. Studio navigation and ordinary shell/workspace actions use a 44px minimum; canvas-owned controls retain the editor's smaller target policy rather than being inflated by shell CSS.

Real CDP Tab input at 1280×577 reached the skip link, each of the four navigation buttons and Connection settings in order. All had visible solid focus outlines; nav/settings rectangles were y=4..48, height 44px. Enter on the skip link focused `studio-main`. The application bar is not sticky and cannot cover a downstream focused control.

Real source browser session: `studio-production-shell`, origin `http://localhost:5180`. All four areas were checked at 1280×577, 1440×900, 1024×768, 390×844 and a 640×450 reduced viewport: page scroll width equalled viewport width in all 20 area/viewport combinations. The canvas keeps its own scrolling.

With the concurrently improved real editor, short-screen canvas top moved from the intermediate 422.19px to 296.5px: 280.5px of canvas visible at 1280×577. At 1440×900 the full 590px canvas was visible; at 1024×768, 458px; at 390×844, 324px. These measurements are against the source app and combined shell/editor work, not an isolated shell-only benchmark.

A 200% approximation used 640×450 plus doubled shell/context/navigation text. Page width remained 640px; navigation targets became 63px high and the focused AI builder button stayed visible with its outline. This is a reflow/font simulation, not a full browser-zoom or assistive-technology audit. At very short reduced viewports the document must scroll to reach the canvas; there is no fixed overlay obscuring its bottom.

A host-dark-token injection using inspected host values gave shell and editor background `rgb(14, 23, 32)` without global root/body CSS. This verifies token inheritance in a browser, not mounting into the OS.

## Tests and reproducible browser checks

`src/studio/__tests__/production-shell.test.tsx` has four SSR regression tests. Each new behavior was observed failing before implementation: named context/skip/navigation, collapsed honest editor help, task-first request/setup order, and production/development serving help. A browser focus regression and short-screen canvas-space assertion also failed before their fixes.

`production-shell.browser.tsx` is browser-only and not imported by the production entry. On the live source origin, mount a dedicated `#fixture` outside the hidden ordinary `#root`, then import the module and call `runProductionShellBrowserChecks()`. It verifies retained editor/workspace/resources/approvals DOM, dirty graph retention across all four areas, selected navigation, real form focus, skip focus, no navigation requests and exact saved fixture identity retention. Its explicit isolated DTO save fixture makes two transport calls (POST plus exact GET); it is **not real backend persistence** and never uses real credentials.

`runProductionShellContextChecks()` verifies an aborted late authenticated configuration request cannot win after a credential change; configured providers are not implicitly selected; selected context stays configured/not-probed; project changes mask the previous model. Its model-call count is zero. `checkProductionShellViewport()` checks page overflow and rejects excess short-screen chrome on the real editor.

Actual execution:

- Final Studio focused suite: 18 files / 132 tests passed, including the production/development help regression.
- Host-aware broad run (`FLIGHTDECK_HOST_ROOT=/Users/te451223/project-contract`, maxWorkers=4): 2788 passed / 3 known computed-manifest failures, 182 files. These are the pre-final-help-test counts, not a claimed final parent release total.
- Known failures are the unchanged hand-written docusign/maps/advantage manifest JSON-literal parser refusals. No parser safeguards were weakened.
- Docker node:test suite at the later shared checkout: 6 passed. No Docker build, restart or new container was initiated by shell work.
- Typecheck, production Vite build and `git diff --check` passed. Vite still reports the main JS chunk over 500kB; all retained areas deliberately remain mounted. The final optional production image must be rebuilt by the release owner after UI work; source serving evidence is not final-image evidence.

## Screenshot evidence

Actual browser captures (local scratch paths):

- `/Users/te451223/.hermes/cache/scratch/studio-shell-1280x577.png`
- `/Users/te451223/.hermes/cache/scratch/studio-shell-390x844.png`
- `/Users/te451223/.hermes/cache/scratch/studio-shell-workflow-1440x900.png`
- `/Users/te451223/.hermes/cache/scratch/studio-shell-ai-1280x577.png`
- `/Users/te451223/.hermes/cache/scratch/studio-shell-ai-390x844.png`
- `/Users/te451223/.hermes/cache/scratch/studio-shell-approvals-1280x577.png`
- `/Users/te451223/.hermes/cache/scratch/studio-shell-resources-1280x577.png`
- `/Users/te451223/.hermes/cache/scratch/studio-shell-200percent.png`
- `/Users/te451223/.hermes/cache/scratch/studio-shell-dark-host.png`

## Remaining integration/release checks

- The existing editor's internal `main.wf-main` is nested beneath the new shell main landmark. The editor owner should change that internal layout wrapper to a neutral `div`/section without remounting its children, then rerun the retained-area/browser checks. This component is outside shell-worker ownership; do not claim a complete landmark audit until it is fixed.
- Independent-review authentication, Anthropic server key, other provider adapters and host authorization remain unconfigured/unverified as before. No real vendor completion or publication was exercised.
- Parent release verification must rebuild the final optional production image after these source changes; shell work leaves Docker and OS 4173 untouched.
- A screen-reader, full zoom, contrast and complete target-size audit remains required. This is production-oriented UX work, not a production-ready or WCAG-conformance declaration.
