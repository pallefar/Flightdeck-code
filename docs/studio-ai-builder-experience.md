# Studio AI chat → builder experience

## Implemented surface

The production entry remains `src/main.tsx → StudioApp`; no fixture driver is imported by that entry.

- One retained Draft builder conversation. The selected model determines workflow versus sub-app through the existing authenticated, schema-validated create route. There are no invented Chat/Plan/Build backend modes.
- Workflow receipts open the actual graph editor. Sub-app receipts open one retained Workbench with its internal chat hidden and inert. Resources, approvals, the editor and workspace stay mounted across ordinary navigation.
- Initial clean workflow handoff is automatic. Existing graph edits or unapplied block settings use the editor's synchronous replacement guard. A cancelled handoff keeps the graph, saved identity and received result; explicit Review/Open is required to try again. Receipt IDs and current-result identity suppress stale handoffs and duplicate StrictMode confirmations.
- External accepted-document replacements and the explicit local example reset the workspace document key. Ordinary edits, navigation and saved workspace loads do not. Local source buffers continue through the Workbench's existing reconciliation/conflict behavior.
- The conversation records actual requests and outcomes, with one request marker updated in place. It retains at most 24 turns; user text is at most 8,000 characters and Studio summaries at most 2,000. This bound is for the conversation, not a new claim that all historical generated candidates are size-limited.
- Explicit clarification answers and exact skill-send fingerprints are separate user turns. Skill acknowledgments survive normal navigation but are not reused for a changed context. Reviewed sends use the captured original request, not a mutable caller object or a newly edited unsent prompt.
- Identity/project/destination invalidation aborts old requests and clears the conversation and retained Workbench source. The person's unsent composer text is retained until Clear request is chosen.

## Honest boundaries

Waiting means **Requesting routed draft**, not simulated tokens, tool executions, percentages or gates. Receipts mean **Draft received / review required**, not deployment. A new request creates a fresh routed draft; the backend does not patch an arbitrary open document in place. Cancellation does not guarantee that an already-started server-side model call stopped.

Suggestions only prefill the composer. Connection checks load authenticated configuration/provenance and do not probe a model. Unconfigured creation stays disabled with setup help. HTTP 429 says the request was not accepted; HTTP 503 says authoring is unavailable. Neither automatically retries. Missing-service instructions distinguish a deployment URL from development-only Vite/server commands.

The local example is the existing built-in workflow template, explicitly labelled as not an AI request. The IDE still uses the existing scriptless preview, and never evaluates generated JavaScript. No host mutation, resource activation, execution, provider setup or deployment was added.

## Visual and accessibility contract

Original Flightdeck orange/steel styling, Arial and inherited host tokens; no remote fonts or dependencies. The reference is the general conversation-left/workspace-right pattern from official indexed Lovable editor documentation, not an authenticated Lovable UI reconstruction. No enterprise block bypass was attempted.

Reference:
```text
https://docs.lovable.dev/features/projects/editor
```

The shell uses a bounded available-height grid, independently scrollable conversation/technical panes and a persistent composer. Mobile switches between conversation and workspace without unmounting them. Long model context is visually ellipsized while complete text remains in its title and real connection settings. Conversation following only occurs near the end; new clarifying questions are brought into view instead of hiding their text above the answer field. Manual scroll is not stolen.

Artifact arrival transitions are short. `prefers-reduced-motion` disables animations/transitions, and the real memory-only Motion toggle applies the same policy. Navigation/hand-off and connection-help focus intents are separated so the credential field cannot lose focus to the composer when opening setup from a builder.

Design self-audit: no default indigo/violet palette, three-feature tile hero, fabricated metrics, remote typeface or ambient fake progress. The standby illustration is a small static linework marker, not a fabricated product preview.

## Verification actually run

Strict RED → GREEN cycles were observed for conversational markers, source privacy reset, explicit answers/cancellation, immutable reviewed requests, transport admission errors, retained chat/UI, graph-owned counts, mobile composer access, hidden grid clipping, readable clarification scrolling, short-screen canvas space and connection-help focus from an open builder.

Release command:
```sh
FLIGHTDECK_HOST_ROOT=/Users/te451223/project-contract npm test -- --maxWorkers=4
npm run build
git diff --check
```

Result: **195 Vitest files / 2,898 tests passed**, plus **16 Node companion tests passed**. TypeScript and the Vite production build succeeded. Vite reports the main JavaScript chunk above its 500 kB warning threshold (602.12 kB minified / 175.89 kB gzip); this is a warning, not a claimed performance benchmark. The tracked diff check produced no diagnostics; owned untracked source files were also checked with `git diff --no-index --check` and produced no whitespace diagnostics (exit 1 denotes their difference from `/dev/null`).

The isolated development fixture uses predetermined completion replies through the **actual Fastify composition root**, with real parser/guardrail/codegen/workspace routes and a temporary private workspace. It does not mock the response parser, use vendor keys or claim a live provider. The accepted workflow has 4 nodes: 3 built-in instances, 1 declarative wrapper instance/definition and an unavoidable independent human gate. The actual generator produces the 6 source files received by the IDE.

Browser evidence:
- 47 regression assertions (45 unique checks), 9 explicit create requests, 14 observed Studio transport requests. Includes exact skill review and retained acknowledgment, both real routed builders, exact server-save readback, retained DOM/dirty/saved identity, cancelled dirty handoff, one explicit retry of handoff, duplicate-submit suppression, cancellation/late-result suppression, private IDE DOM removal on scope change and correct setup/workspace focus.
- 24 screenshot cases: root default, clarifying conversation, workflow builder and sub-app IDE; each at 1440×900, 1280×577 and 390×844 in light and inherited host-dark tokens.
- Every screenshot case checked document and actual grid bounds, not only overflow clipping. Visible composer bottoms are 834, 511 and 786 px respectively. On the short desktop workflow, the final canvas begins at 323.5 px. Mobile workspace conversation is hidden but retained; Discuss draft returns to it.
- Real CDP Ctrl+Enter submitted exactly one request; 18 native Tab steps never focused hidden/inert controls.
- Manual conversation scroll stayed at 0 across a later real routed turn.
- Computed animations and transitions were `none` / `0s` for actual workflow arrival, chat and IDE surfaces under reduced-motion and Motion off.
- Actual unauthenticated create returned 401; an unavailable selected destination returned 409, with zero additional predetermined model calls. The uncredentialed UI kept Send disabled.

Evidence directory:
```text
/Users/te451223/.hermes/cache/scratch/studio-ai-builder-evidence/
```

JSON: `browser-regression.json`, `visual-matrix.json`, `motion.json`, `keyboard.json`, `manual-scroll.json`, `auth-refusal.json`; labelled screenshot PNGs are alongside them. This is local development/browser evidence, not vendor, host-deployment or production-identity proof.

Reproduce the isolated browser fixture:
```sh
npx tsx src/studio/__tests__/ai-builder.fixture.ts
```

Open the printed development-only browser URL and run `window.__aiBuilder.run()` from browser developer tools. The dedicated fixture was stopped after verification; both of its Vite/backend ports were then confirmed unreachable. The existing Vite demo on 5180 and frozen staging app on 8790 both still returned HTTP 200. No staging rebuild or cutover was performed.

## Changed files

Production: `StudioApp.tsx`, `StudioShell.tsx`, `StudioBuilder.css`, `ConversationHistory.tsx`, `controller.ts`, `client.ts` under `src/studio/`.

Tests: updated `__tests__/controller.test.ts`; added `conversation.test.ts`, `draft-admission.test.ts`, `ai-builder-ui.test.tsx`, `ai-builder-route.test.ts`, `ai-builder.fixture.ts`, `ai-builder.browser.tsx`, `ai-builder-browser.html`.

This worker did not edit workflow/workbench ownership areas, core/server/provider modules, deployment configuration or the production entry. No commits or deployment cutover were performed. Live providers and the independent production reviewer remain unconfigured; staging rebuild/review is the parent's separate step.
