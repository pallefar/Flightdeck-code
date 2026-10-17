# Main-entry native authoring and durable source integration

## Source delivery

The real Studio entry now mounts the delivered durable sub-app workspace in the existing IDE header. A closed compact button opens a native modal; it does not consume source viewport rows or perform automatic reads/saves. Source persistence uses the actual authenticated private backend, exact revision CAS and separate GET readback. Saved generated baseline/evidence and manual working files remain distinct.

Explicit saved-source loading clears only the obsolete accepted model handoff, not the opened source or retained conversation. The controls are inactive while another draft request is pending. Closing or navigating away retains the source and saved identity; loading another saved document still requires explicit replacement confirmation.

Project & model setup now has an initially closed **Authoring engine** disclosure:

1. Configure/select Anthropic through the existing in-app operator flow.
2. **Check native authoring availability** reads only authenticated server metadata; it does not probe the provider, select an engine or submit a request.
3. Explicitly choose **Native draft harness**. JSON planner remains the original default. The server must also opt in (`STUDIO_NATIVE_AUTHORING=1` or trusted server option).
4. Create explicitly. Native mode is carried through targeted answers/review continuation and IDE follow-up requests. Unsupported engines/destinations are refused before transport; native 409 has a fixed explicit no-fallback message.

Credential/project/model changes invalidate native availability and old sends. Changing engine clears obsolete routing/review capability while retaining conversation and source. Native mode cannot silently turn into JSON fallback. The bounded metadata reader owns and cancels its source stream without awaiting an untrusted cancellation promise.

## What was actually exercised

- Host-aware unchanged default test entry: **3,842 Vitest physical assertion records across 260 files**, all passed; **31 Node tests**, no failures/skips. Typecheck, production build, strict harness/dependency declaration check and diff whitespace check passed. The existing >500KB Vite chunk advisory remains visible.
- Actual Chromium main-entry fixture: **33 functional assertions** passed with the real Fastify composition root, installed Anthropic SDK/native tools and deterministic fake fetch. It generated the real local DAG and SDK source, asked targeted human manifest questions, edited/saved two workflow revisions and two source revisions, performed exact GET readbacks and explicitly reopened manual source while retaining original baseline and conversation. Its nine SDK sends were synthetic transport calls, not vendor requests or credit use. No workflow run/deployment route was called.
- Desktop 1280×577 source viewport: **200.15625px**. Mobile 390×844: **201.5625px**, unchanged while the durable modal was open, with viewport-contained modal bounds and no horizontal overflow.
- Actual mobile CDP raw Tab/Shift+Tab/Escape proved three focus-wrap/return boundaries, with no observed page/unhandled errors.
- A fresh browser entry reopened exact revision2/Unicode manual source with original baseline separate and no new SDK send. The original helper report incorrectly captured its count before two layout assertions appended to the same array. The source helper was corrected; its replay was blocked when browser automation became unavailable. That raw report is retained as qualified functional evidence, **not an accepted numeric assertion total**.

Two earlier fixture attempts selected the first retained hidden source pane rather than the active `.fd-source-slot:not([hidden])`. They are preserved in `entry-browser-fixture-failure-1.json` / `-2.json`. Production source was not weakened or changed for this harness issue. The final fixture checks the active textarea's exact file identity before editing.

Screenshot capture and requestAnimationFrame waits timed out despite working synchronous DOM/native keyboard checks. Later Browser Use could no longer connect to its daemon. No new screenshot, visual acceptance or acoustic/provider proof is claimed. Do not replace these failures with old screenshots or fabricated captures.

## Evidence and remaining gates

Evidence: `docs/evidence/authoring-integration/authoring-full-tests.json`, `frontend-source-checkpoint.json`, `frontend-source-snapshots/`, `frontend-integration-summary.json`, `entry-browser-result.json`, `entry-mobile-layout.json`, `entry-native-keyboard.json`, `entry-fresh-reopen.json`, `entry-fixture-cleanup.json`.

The dedicated fixture stopped with exit143, not a graceful-drain success. Exact owned ports5173/52140 were subsequently verified closed and all three owned synthetic scratch roots were explicitly removed; no graceful cleanup is inferred from termination. Studio8790, companion8787 and OS4173 were read back healthy and were not restarted/deployed.

This remains source/private-fixture delivery, not completion of the whole usable-authoring goal. Independent native/UI review, explicit safe validation of edited working source, isolated immutable runtime/candidate/browser capture and an authorized private update remain open. Generated baseline findings do not become fresh validation of edits. Host installation, real user key/send, host identity/reviewer/recovery and production approval stay separate. The current Docker app still runs the earlier `5029e89247bb…` image; these source changes have **not been deployed**.
