# Block-settings keyboard remediation — October 15, 2026

## Current acceptance boundary

**Source, full-suite, final-image runtime, native parent verification and fresh independent source critique are accepted.** The critique (`deleg_82dc1b28`) found no new concrete regression. Following the later “continue and finish” direction, the corrected immutable image was deployed to private staging on port 8790, with explicit in-app Anthropic setup enabled and exact original-state readback. The earlier canceled choice remains historical, not retroactive consent. Current cutover evidence and scope are in `studio-private-staging-release-20261015.md`. This is not global accessibility/security certification, public production or live host/provider acceptance.

The original actual-image finding is `candidate-focus-1`, preserved in `combined-candidate-browser.json`: mobile last-control Tab reached BODY; other first/last desktop/mobile boundaries focused the DIALOG wrapper rather than the expected control. It was not an authorization or provider bypass.

## Narrow source fix

Only one original build input changed, `src/workflow/WorkflowEditor.tsx`, plus the new `src/workflow/block-settings-keyboard.test.tsx`. Parent matched the delivered hashes:

- production component: `bd2cd17089b82a805f36ca4ca02bbbf7d8ab09a2db95af2ec392d4f7855bb6cf`;
- keyboard test: `d5b0f6e3a1315a0912bae9bf231102b07bba7c14311786762f23a9e3c56d1764`.

The added handler runs only for Tab in an active, open settings dialog. It enumerates currently enabled/tabbable/layout-visible controls, excluding hidden/inert ancestors and hidden/collapsed visibility. It wraps first↔last boundaries, retains the only control, and prevents escape if no eligible controls remain. Inline/inactive editors, interior Tab and Escape remain native. No retained-form, pending-settings, cancellation, return-focus, CSS, authority or dependency code changed. The builder reported explicit failing boundary/exclusion/empty/inactive tests before its corresponding changes; parent reread the exact diff and all 15 bounded rendered-listener/DOM-fixture tests.

## Parent whole-source execution

The actual host-aware default entry passed **3,340 Vitest cases / 233 physical files plus 30 Node Docker/bootstrap cases**, with zero failed/pending, followed by typecheck, build and diff checks. Parent enumerated the assertion records and confirmed all 15 new keyboard tests are included; they are not extra cases to add to that total.

Evidence: `docs/evidence/next-ui/full-modal-remediation-tests.json` and `modal-remediation-full-recount.json`. The browser tests below are separate enumerated labels, not additional independent unit/security proofs. The existing large-bundle advisory remains; no unrelated size threshold was weakened.

## Corrected immutable image

- Tag: `flightdeck-studio-staging:combined-focusfix-candidate-20261015`.
- Exact image ID: `sha256:5029e89247bb09d1340f23ba4440e80f4521cd8ff05c2f939588ff7a07e0bbaf`.
- Frozen input ledger: **756 files**, aggregate `d3f6931b07ccb30ab2ecefeb66da6d1b5444699688c15fac46b4ee2e394da63e`.
- Compared to the first candidate's 755 inputs: only the component changed and the one test was added. The original failing image/tag remains unchanged, not silently relabeled fixed.
- Actual newly built JS: `index-B7Cx5YFX.js`; unchanged CSS: `index-BuOWUG7p.css`. Image HTML/JS/CSS bytes all matched the new full-suite host build.

The public already-admin-trusted build CA remained a BuildKit secret; no verification bypass or runtime secret was added. Runtime/remote vendor TLS is a separate gate.

## Actual final-image runtime and persistence

Parent replayed the independently authored runtime probes against the **new exact image**, preserving all three Node probe files byte-for-byte. Only runner output root/container labels/image/tag/input-ledger/provenance metadata changed. This is parent replay, not a newly independent seven-case audit.

All **seven runtime acceptance groups** passed under network-none, read-only, UID/GID 1000, dropped capabilities, no-new-privileges and private state/tmp tmpfs. The real physical graph contains **63** lock-matched production packages, `npm ls` succeeds, test sources are absent, and **224** retained source/config files match the new frozen ledger. Actual health/readiness/auth/no-selection/HTML/JS/CSS controls pass. Each of five marker kinds was refused twice—**10 marked-bootstrap refusals** included in those groups—with exact inventories unchanged and no token creation. This remains deny-only startup evidence, not restore freshness, direct-entry/running-effect coverage or transactional authority/filesystem proof.

A separate actual no-server `npm audit --omit=dev --json` in this corrected image returned exit 0 and zero application dependency findings; no OS/global-tool certification is inferred. Exact executable probes, image metadata, results and checksums are archived under `docs/evidence/next-ui/combined-focusfix-runtime-proof/` (24 manifested artifacts plus the manifest/checksum files).

An independent private Compose fixture used ordinary bootstrap and real authenticated HTTP. The same **24 initial labels**, **seven after restart** and **seven after recreation** passed: exact composed draft/run readback, one original run without replay, revision/project refusals, memory-only synthetic setup loss, no model autoselection/fallback, bridge routes absent and independent-review default 503. Counts overlap and are not summed. Credentials stayed inside the fixture; a nonfunctional generated key never reached a provider or evidence. Records are synthetic and do not establish real host identity or project policy.

## Native parent proof

The actual corrected production bundle passed **21 unique recorded labels**, with zero page errors. Four native boundary groups are included:

| Viewport | Native key | Observed result |
|---|---|---|
| 1280×640 | Tab from last eligible control | close button focused; default prevented |
| 1280×640 | Shift+Tab from first | last connection control focused; default prevented |
| 390×568 | Tab from last | close button focused; default prevented |
| 390×568 | Shift+Tab from first | last connection control focused; default prevented |

Each probe explicitly focused/verified its true first/last control immediately before complete foreground CDP key events (virtual-key 9). Interior Tab stayed native in both sizes. The real modal was visible, nonzero and viewport-contained. Native editing, Escape, exact edited-card focus return, the same form DOM and unapplied **Condition field** value across close/reopen, restored local fields, untrapped inline-inspector traversal and retained editor identity were verified. No API, automatic save or provider request occurred in the browser.

Two harness distinctions are retained: node labels update the local graph immediately, so a Condition field draft—not the label—proved pending Apply retention; native event cancellation must be read after dispatch, because an on-target microtask can precede React's delegated listener. One browser IPC timeout was recovered by reading the completed assertions, without replaying mutations.

Evidence: `combined-focusfix-browser.json`, `combined-focusfix-browser-1280.png`, `combined-focusfix-browser-390.png`, and `modal-remediation-parent-verification.json`.

## Cleanup / release gates

The exact private fixture container, volume and network were removed. Ports 64566 and 64611 are closed; all seven runtime-replay containers are absent. The browser is back at `about:blank`. All 756 current/frozen input hashes still matched after testing, and all three live services retained exact container IDs, image IDs and start timestamps. `combined-focusfix-cleanup.json` records filtered verification.

The fresh read-only critique is now accepted. Parent verified all **28 manifested artifact hashes**, both unchanged source hashes and exact in-memory reversal to the frozen beforefile. It recounted **41 passing existing cases / four files**, all included in the parent 3,340-case report, and **80 uniquely named modeled scenarios** (60 real-form SSR configurations, 16 exclusions/exception fixtures and four guard/lifecycle cases). The matrix metrics total **1,660 modeled key dispatches**; these are not native-browser events or additive test totals. Parent did not claim a second execution of all 80 scenarios. The deliberately delegated BODY/dialog-wrapper-origin focus case remains a stated native-behavior limit; the fixed live first/last boundaries have separate parent native proof. Original VM-binding harness failures are archived as harness issues, not product failures. Exact evidence and `parent-check.json` live under `docs/evidence/next-ui/modal-focus-independent/`.

Private candidate engineering acceptance and the subsequent private staging update are complete. The earlier canceled-choice snapshot (`combined-candidate-cutover-decision.json`) is preserved. The later scoped update pins `5029e892…`, enables session-only key setup, retains the private volume and exact original records, and leaves companion/OS and host bridge unchanged. Cutover-specific native desktop/mobile checks and authenticated readbacks passed; no real key, provider call, model selection or saved-run replay occurred. Browser operator sign-in was declined; the real authenticated browser/live-provider flow remains pending. See `studio-private-staging-release-20261015.md` and `private-staging-cutover-20261015/acceptance.json`. No commit, push, public release or bridge activation occurred.
