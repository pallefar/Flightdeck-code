# Stacked workflow view

An optional top-to-bottom view of the same Flightdeck workflow draft. The existing Canvas view remains the default.

## Use

- Open a workflow and choose **Stacked** beside **Canvas**.
- Conditions show labelled **True** and **False** connections. Shared targets render once, below their incoming dependencies.
- Choose **Compact** for a shorter overview, or **Expanded** for configuration summaries.
- Scroll down to follow the workflow, sideways to explore wide branches, or choose **Fit width**. Zoom and scroll are retained separately for Canvas and Stacked during the mounted editing session.
- Single-click a block for its existing inspector; double-click for the same native block-settings modal. Existing Parameters, Inputs, Results, Apply, connection tools and undo/redo remain shared.
- Add blocks through the existing palette. Stacked layout is automatic; use Canvas to edit authored block positions. A palette drop in Stacked adds a normal unconnected block, not an inferred link or a position from the automatic layout.

## Semantics

This is a presentation of the actual graph, not a second workflow model. Switching views does not change authored positions, configuration, mappings, saved document identity or edit history. Pending settings are neither applied nor discarded. No model, API, persistence or execution request is triggered by the view switch.

Dependency layers are not promises of parallel execution. Both condition alternatives are shown without predicting the selected path. Disconnected draft blocks remain visible. A join is one actual node, not a merge adapter; the existing engine still blocks multiple active inputs. Human gates retain the existing independent-review boundary, and an unconfigured reviewer still blocks execution.

Long connections that would disappear behind intermediate cards use external routing lanes. This prevents a bypass edge from looking like a connection through an intervening review gate. Complex connections can still cross or overlap each other; Canvas remains available for detailed graph inspection. The layout does not add approval or remove execution validation.

## Local preview and scope

The dedicated development preview is `http://127.0.0.1:5298/src/workflow/__tests__/stacked.browser.html` while its owned Vite process runs. It includes local condition, join, human-review and empty examples. It has no API proxy, authentication or provider configuration; do not use it for API keys or real workspace persistence.

Run it with:

```sh
npx vite --config src/workflow/__tests__/stacked.vite.config.ts
```

This feature has not replaced the private Studio image on port 8790. Its operator session, model setup and saved data are not touched by development of this view. The companion, OS service and launcher are outside this change.

## Verification record

Evidence lives in `docs/evidence/stacked-workflow-20261017/`. It retains test-first failures, layout tests, browser checks, mobile native keyboard evidence and a real Studio source-entry check. The isolated source-entry fixture initially lacked the main app's aliases; that fixture error and its corrected configuration are retained. The first approval probe incorrectly expected an unconfigured template to pause; the corrected probe verifies real blocked → explicitly configured development queue → paused behavior, without authenticating or approving a reviewer.

The original skip-edge/card overlap and a foreground 100-node initial-scroll failure were reproduced and fixed. Passing output before foreground animation frames settled was not used as the initial-scroll RED witness. Build output retains the existing large-chunk warning.

The first independent review identified a mobile Registry containment regression. It was reproduced in a nonzero-scrolled 390×568 editor and fixed by keeping Registry outside the horizontally scrollable controls group. The panel now stays editor-relative, moves with page scroll and scrolls internally. Actual pointer opening, Tab → settings, Enter, native modal focus, Escape and exact focus return were verified at an explicitly asserted 390×568 viewport; both Canvas and Stacked containment paths passed.

After that fix, the full suite passed **4,040 Vitest assertions in 267 files plus 32 Node assertions**, with all prior test records retained. Build/typecheck passed; the existing large-chunk warning remains. A CDP probe that returned a DOM object caused a collector serialization error, and a later foreground/viewport-invalid keyboard probe was not accepted as native-mobile evidence. Both were retained; the explicit-viewport trusted-input probe passed. The standalone preview's Night selector background was also corrected without changing application source.

The final independent source/SSR/CSS recheck passed for the exact application/remediation hashes, with 80 focused test records. It is separate from the parent-owned native browser evidence; original failed findings and collector errors remain preserved. The stacked view is complete for source and local-preview delivery, not promoted into the private 8790 image. No deployment, real provider completion, real reviewer authorization or public-production approval is established by this preview.
