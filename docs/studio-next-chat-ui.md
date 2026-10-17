# Studio next chat UI

## Delivered in the actual authoring entry

Primary surface: **Command / Inspect**, not a marketing hero. One integrated command surface contains the prompt, explicit draft/send/setup action and optional suggestions below it. The duplicate startup heading is hidden. Empty graph context is not visible until the person opens the workflow builder.

The compact application bar prioritizes AI builder / Workflow builder / Sub-app IDE. Resources, Approvals, appearance and motion are in the Tools disclosure. Opened builders have their own contextual workspace bar and Discuss draft action. Desktop retains the conversation beside the actual editor; mobile Discuss moves back to the same composer, with both editors still mounted.

- Conversation hide/show retains the composer, selection, graph, workspace controller and IDE DOM, and uses `hidden` + `inert` for keyboard exclusion. Native mouse and Tab checks passed.
- Handoff receipts are bound to the exact current `acceptedRequestId` **and result identity**, and are created only after the typed builder is actually opened. They report received graph/file counts, never live generation percentages, tools or fabricated files. The semantic route changes immediately; editing is not delayed by the shell cue.
- Dirty workflow replacement asks once. Cancellation preserves the existing graph and saved document identity and leaves a pending explicit Review / Open receipt. Ordinary navigation does not replay the handoff.
- Only pointer-transparent frame/light-trail pseudo decoration animates. The live builder, composer, source textarea, toolbar, chat turns and interactive node geometry are not translated/scaled by the shell. Reduced motion and Motion off suppress those decorations while retaining the typed textual receipt.
- Standalone `src/main.tsx` explicitly opts into scoped Night. Embedded `StudioApp` defaults to host inheritance. Day / Night / Follow host is memory-only. Night uses the actual host dark shared tokens locally on the Studio root, so workflow, IDE and voice settings inherit together. No new html/body/:root repaint, remote fonts, CDN, branding package or dependency.

Appearance changes retain the exact destination, project/token field, composer, accepted state, candidate state, editor DOM and enabled voice consent; no provider/network request or browser-storage write occurs. The existing four explicit model destinations, password-type memory-only operator token, exact skill-send review hashes, private-source scope clearing, server-only routing, generic bounded receipt narration and draft-only dictation path remain intact. Declarative graph-local wrapper declarations are not independent library activation or arbitrary executable adapters.

Reference posture: original Flightdeck orange/steel and Arial. General left-chat/right-preview/code interaction is informed by parent-supplied indexed primary Lovable documentation excerpts. No full live/authenticated Lovable visual comparison was available or claimed.

Composition check: 0/10 on the design skill's structural tells. The focused entry is centered, but its content and controls are left-aligned; there is no feature-tile hero, fake metrics/progress, generic purple/blue gradient, unearned blur, or proprietary typography.

## Verification / reproduction

Focused tests: `npx vitest run src/studio --maxWorkers=2` — **173 passed in 28 files**. `npm run typecheck` and `npm run build` passed. Build retains the existing large-chunk warning (about 706 kB JS); no dependency or bundler/deployment changes were made.

The browser fixture is explicitly **DEVELOPMENT ONLY**, with predetermined model responses through the real Fastify composition root and real typed DTO parsing/generation/workspace readback. It does not prove a live vendor/provider, real external effects, host mounting or deployment. The owned fixture was stopped after verification; existing Vite 5180 and frozen Docker services were not restarted or modified.

Run it when needed:

```
npx tsx src/studio/__tests__/ai-builder.fixture.ts
```

Open the emitted `browserUrl` in a named isolated browser session. The development browser API `window.__aiBuilder` exposes the existing full `run()` and the added `checkReceivedHandoff()`, `checkConversationToggle()`, `checkAppearanceRetention()`, `checkToolFocus()` and `checkMobileDiscuss()`. `showWorkflow()`, `showSubapp()`, `showConversation()`, `viewportCheck()` and `checkManualScroll()` remain available. Manual-scroll verification now first asserts genuine overflow beyond the existing near-end threshold; its original no-scroll-stealing assertion remains unchanged.

Evidence directory: `src/studio/__tests__/evidence/next-chat/`.

- `contracts.json`: 94 unique actual-route/retention assertions, including 9 explicit create requests in the full route exercise; no automatic mount/navigation/provider calls, exact-context acknowledgment, typed routing, dirty cancellation/open, real saved identity readback, source retention, late cancellation and scope clearing.
- `matrix-desktop.json`, `matrix-short.json`, `matrix-mobile.json`: all 27 combinations of 1440×900 / 1280×577 / 390×844 × Day / Night / reduced motion × home / workflow / sub-app. The command/outer workspace bounds, composer reachability, keyboard-visible focus, stationary handoffs and mobile Discuss retention were exercised. This is not a claim that every internal editor panel has optimal short-screen height; see the measured gap below.
- `actual-entry.json`: 6 additional checks of the actual Vite 5180 `src/main.tsx` entry in Night/Day at those sizes.
- `native-retention.json`: native mouse/Tab, hidden/inert exclusion, retained composer selection `[3,12]`, unchanged editor/workspace identities and zero extra requests.
- `manual-scroll.json`: a genuine scrolled conversation stays at scrollTop 0 after another real routed turn; structured questions remain visible above their answer field.
- `motion-off.json`: both real typed handoffs retain their semantic destination/counts with the explicit Motion off setting; frame animation is none and the decorative trail has opacity 0.
- `summary.json`: programmatically checked matrix completeness and aggregated counts.

Key screenshots:

- `entry-main-night-1440x900.png` — actual standalone command entry.
- `entry-main-day-390x844.png` — actual mobile entry.
- `workflow-night-1440x900.png` — accepted actual graph + retained conversation + received handoff.
- `subapp-night-1440x900.png` — actual generated IDE sources + retained conversation + received handoff.
- `subapp-reduced-1280x577.png` and `subapp-reduced-390x844.png` — short/mobile composed editor measurements.

All existing behavioral tests were retained. Deliberate Workflow builder naming changes updated the owned browser selectors without removing routing/privacy/retention assertions. Explicit RED → GREEN checks covered composition/navigation, scoped appearance, duplicate-heading/context removal, compact IDE disclosure, received handoff, hide/show, stable geometry, setup-focus regression, reduced-motion trail suppression and real command containment at short/mobile sizes.

## Ownership / largest remaining integration gap

Changed only `src/studio/**`, the explicit appearance prop in `src/main.tsx`, and this requested document. No workflow/workbench/voice core/backend/provider/deploy/package/host edits or commits/pushes.

**Workbench owner / parent action:** At 1280×577 the composed IDE workspace is 433 px high. Removing the shell's duplicated IDE boundary freed 24 px, but the Workbench's automatic received-module presentation still leaves its source code pane **20 px high during assembly** (top 548.86, bottom 568.86, while the workspace ends at 561). After reduced-motion finalization the pane is **109.42 px high**. Exact rectangles and screenshots are in `matrix-short.json` and `subapp-{day,night,reduced}-1280x577.png`. The shell never delays editing, and Focus/Hide conversation remain available, but the automatic Workbench presentation still needs to avoid consuming the first source-editing viewport. Those internal files remain exclusively sibling-owned; this worker did not suppress the accepted assembly or reach into the editor implementation to hide the issue.

Parent owns final merged full-suite / cross-editor acceptance and staging cutover. Staging remains frozen; this is source implementation and development-fixture evidence, not a release claim.
