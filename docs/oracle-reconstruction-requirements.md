# Oracle-informed Studio reconstruction requirements

## Evidence and scope

This is an independent Flightdeck implementation, not recovery of Oracle's proprietary backend. No authenticated Oracle tenant was supplied. Public documentation describes intended behavior; it does not prove tenant execution, private APIs, source architecture, or production connector semantics.

A fresh **actual MCP stdio** session initialized the installed `rea` server version **6.4.0**, discovered **170 tools**, called `list_browser_targets`, then `inspect_web_page` against the exact `docs.oracle.com` origin and selected target. Complete canonical evidence is retained locally in the scratch `oracle-rea-mcp/nodes-reference.json` artifact.

- Evidence: `ev_2cf8c27148bdba6f399c129dd500eb35bfaf7e9108ac2c4b071296f6d898e6a4`.
- Captured subject: Oracle's pinned **26C** `nodes-in-workflows.html` reference. This is not an assertion about the user's tenant release or the latest Oracle release.
- Completeness: attach-limited and policy-filtered, with no truncated sections reported. No prior network traffic, credentials, storage values, script sources or raw request/response bodies were requested.
- The documentation inventory covers AI, communication, data, logic and workflow-control nodes. It includes nested workflows, retrieval/tool integrations, variables, policy controls, approvals, branching, bounded iteration, parallelism and waits. These are **documented product functions**, not observed execution.
- A separate public navigation resolved a 26C URL to a 26D workflow-creation page. Keep that redirect distinct from the pinned MCP capture; do not silently relabel the evidence.

Sources: `https://docs.oracle.com/en/cloud/saas/fusion-ai/26c/aiaas/nodes-in-workflows.html`; `https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/create-workflows.html`. Existing source ledger and demo transcript boundaries remain in `oracle-agent-studio-research.md`.

## Confirmed owner requirements

Flightdeck Studio/OS owns the theme, navigation, identity and project context. n8n is only an interaction reference. The editor needs actual categorized drag-and-drop, editable typed block options, compact/expanded cards, generic connectors and reviewed reusable custom blocks. Strict LLM determination dispatches workflow versus sub-app creation, and workflow project-page suggestions use authorized project skills.

The owner additionally requested **all four** model connections: ChatGPT/GPT subscription, existing Flightdeck model service, local models, and Anthropic API. Selection must be explicit; do not silently fall back to another data destination or billing system.

## Requirements and acceptance matrix

“Implemented” below means the stated local code/UI tests have run, not that host deployment or live provider execution was verified.

| ID | Requirement | Current evidence/status | Acceptance criterion |
|---|---|---|---|
| R01 | Strict workflow/sub-app determination and separate builders | Implemented and tested in protected creation pipeline | Invalid/ambiguous/truncated replies do not default to a builder; sub-app classification never loads workflow skills |
| R02 | Connected graph creator/editor | Live local editor, validated DAG core | Create/select/move/connect/configure/import/export nodes with schema validation and one-action undo |
| R03 | Categorized palette, drag/drop, Expanded/Compact | Verified with native browser drag events and real mouse reposition | Drop coordinates account for zoom/scroll; compact cards retain ports and inspector; display leaves graph/history/execution unchanged |
| R04 | Effective typed parameters and custom inheritance | Live and tested | Saved settings affect actual execution/export; errors remain unsaved; undo/redo refresh controls; wrapper defaults remain inherited |
| R05 | Durable project-scoped drafts with revision control | Backend and editor UI mounted; durable route/client tests pass. Credentialed live browser save/reload pending | Save/reload survives a reconstructed store; stale writes conflict; cross-project access fails; persisted approval bindings cannot be removed/reassigned |
| R06 | Server execution of saved revisions and real run history | Backend and editor run/history controls mounted; actual saved snapshots/history verified in integration tests; credentialed browser execution pending | Execute an exact saved snapshot, store/read back trace and outcome; do not accept a replacement graph in a run request |
| R07 | Human approval and authoritative review | Local core pauses and prevents bypass/self-approval; production reviewer identity pending | Real independently authenticated reviewer and durable audit required; a persisted pause must not pretend it can resume after restart |
| R08 | Explicit multi-provider model connections | Implementation in progress | Server-owned provider/model selection; bounded real adapters; unavailable configuration fails closed; reviewed context binds the destination/model |
| R09 | Real HTTP/tool/MCP connectors | Generic declarations exist; production adapters unconfigured | Credential references resolve server-side; allowlist/SSRF/redirect/data-authority checks precede actual calls; return actual results only |
| R10 | Workflow variables and node input/output mapping | Documented Oracle function; Flightdeck gap | Typed bounded references/mappings, validated ports and inspectable real data flow; no arbitrary JavaScript evaluation |
| R11 | Retrieval and sub-workflow/agent composition | Documented Oracle function; Flightdeck gap | Explicit project-authorized adapters/contracts, bounded nesting and tool access; no invented integrations |
| R12 | Switch, iteration, parallelism and waits | Documented Oracle functions; current core intentionally DAG v1 | Versioned migration and bounded/cancellable execution with deterministic validation; no unbounded cycles |
| R13 | Error policy and observability | Local blocked/completed/paused trace exists; durable UI pending | Show actual outcomes, failed node and reason; retries/notifications require explicit policy and real adapters |
| R14 | Draft/review/publication lifecycle | Draft labels and proposals exist; host publication not integrated | Separate draft, validated review and host publication; no deployment badge from a preview/export |
| R15 | Skill-grounded workflow project-page suggestions | Protected API integration tests pass | Suggestions cite authorized skill/workflow step IDs and survive host-side scope/reference validation before creation |
| R16 | Flightdeck theme and navigation integration | Token inheritance verified locally; final launcher/navigation integration pending | Actual Studio entry/OS launch path, history/leave guards and project/workspace scopes work without duplicate shell or copied auth |
| R17 | Sub-app conformance and host handoff | Existing protected source-generation/conformance path retained | Run real host checks against baseline and verify authorized mutations by reading back exact targets |

## Model connection boundaries

- The installed Codex CLI reported **logged in using ChatGPT**. That is a genuine existing subscription sign-in, **not yet proof of a Studio completion call**.
- Use the supported private Codex CLI/SDK interface with its own credential store. Do not extract/copy its OAuth credentials or assume the subscription provides general API credits.
- OpenAI primary references: `https://developers.openai.com/codex/auth` and `https://developers.openai.com/codex/config-reference`. General API and subscription authentication/billing are distinct; public/untrusted Codex execution is not an acceptable integration.
- No Anthropic key or named Studio operator is configured in the inspected local runtime. The normal local Ollama endpoint was unreachable. This does not establish that the owner lacks credentials or models elsewhere.
- Flightdeck's actual model protocol/auth/scope contract has been audited. It is an internal governed task/facts gateway with no Studio planner task; an approved host bridge remains required. Do not assume it is OpenAI-compatible or invent a completion endpoint.
- A model switch must invalidate an exact-context send approval whenever its selected destination/model binding changes. Failures must not trigger silent cross-provider sends.

## Host audit findings and current corrections

The host audit distinguishes the existing Admin Studio launch surface from the unregistered, authored Studio admission sub-app. The host's real capability adapter requires request-bound `capabilitiesFor(workspaceId, req)` and asynchronous `writeInboxProposal`; producer/copy compatibility repairs have been implemented and independently passed all fourteen targeted ABI/behavior tests against the live host declaration projection. The conformance verifier's old simulated ABI is being corrected separately; these are not installed host changes.

The host workflow scaffold API is not a storage/runtime API for Studio DAG graphs. Page suggestions are not PageDoc v2 documents. Both require reviewed conversion and verified host authority before any real persistence/publication claim.

The inspected Flightdeck model service is `server/services/ai/gateway.ts::callAiProvider`, an internal governed `{task,facts}` gateway, not a generic public chat-completions route. Its provider activation gates, compiled envelope, small operator-text limits, PII scanning and edge-secret ownership must not be bypassed to forward Studio planner requests. A trusted Flightdeck adapter remains an explicit integration requirement.

One audit defect has been corrected locally: page proposal and client schemas now share the actual five host navigation sections and the eight-character icon bound. Invalid legacy `work` metadata is refused rather than silently posted. Nine new contract tests and the surrounding proposal/client HTTP tests passed; this does not create or publish a page.

## First working vertical slice

Implement durable authenticated local drafts and exact-revision server runs, wire the explicit model registry into the existing protected determination/planning path, and expose their real save/load/run states in the Studio workspace. Keep the existing demo available.

Then integrate through the actual Flightdeck Studio launch/model/project/persistence contracts, using the host audit findings. Defer unsupported connector, composition and control-flow items visibly rather than filling them with synthetic results. A public-doc requirements pass or a matching UI is not proof of completed integration.
