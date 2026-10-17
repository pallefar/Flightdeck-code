# Oracle public requirements → Flightdeck acceptance checklist

## Evidence boundary and outcome

Research session: October 13, 2026. Read-only repository inspection; all new files are scratch artifacts. No Oracle tenant, authenticated builder, connector invocation, or backend execution was available or attempted. Local implementation findings are source inspection, not fresh test results.

**Release boundary:** Oracle's retrieved manual identifies itself as **26D**, document G59779-01.[1] The existing repository research pins 26C; the parent's REA artifact separately captures that 26C node page.[26] Both are valid public-source evidence. Public availability of a 26D manual does not establish a customer's rollout, tenant version, general availability of every feature, or that 26D is the latest release. Tenant release is unknown. No exhaustive 26C→26D change list is asserted.

**Main conclusion:** Flightdeck already contains a schema-bound DAG draft editor and bounded local executor. Its highest-value gaps are durable scoped lifecycle, reusable resource/function registry with real adapters, typed field mapping, and workflow-backed app composition—not adding more visual palette labels. This is a local-source assessment using L1–L7 below.

### Classification

- **D:** Oracle documentation assertion, not independently exercised behavior.
- **O:** observed public DOM/text or inspected local code; not runtime proof.
- **A:** proposed Flightdeck acceptance criterion; an independent design choice, not an Oracle implementation assertion.
- **Gap** means absent from the inspected Studio graph/editor/core contract, not proven absent everywhere in the host. Host API behavior must be verified independently.

## Prioritized gap / acceptance table

Every acceptance cell is **A**. P0 closes misleading/insecure integration boundaries; P1 adds the main functional authoring model; P2 broadens advanced parity. Priorities are recommendations for Flightdeck, not Oracle priorities.

| ID / priority | Official public requirement or pattern (D) | Existing Flightdeck evidence (O) / concrete gap | Acceptance criterion (A) |
|---|---|---|---|
| R01 / P0 | Separate workflow and application creation; natural-language creation also exposes explicit Workflows/Applications tags.[2] | L4/L5 have strict model determination, clarification, separate graph proposal and subapp source-generation outcomes. Oracle docs do **not** establish automatic LLM classification of the deliverable. | Preserve strict validated determination; ambiguity asks a question; malformed/truncated responses fail closed. Workflow opens graph builder; subapp opens existing workbench. Label semantic determination as Flightdeck-specific. |
| R02 / P0 | Workflow settings include details, model provider, roles, triggers, variables, error handling; draft workflows are editable and publishable.[3][13] | L1 graph has version:1 (schema version only), id/name/nodes/edges/customBlocks. L3/L5 retain draft/export/local-run boundaries; no durable graph publication. | Add host-scoped draft persistence and separate immutable published revision ID, optimistic concurrency, publish validation and author audit. Editing cannot silently mutate the running revision. Restart/read-back proves persistence. These revision mechanics are our design, not recovered Oracle internals. |
| R03 / P0 | REST tools are reusable Resources entries with base URL, authentication, endpoints, method, relative path, typed parameters, samples and headers; optional approval before execution.[8] Connector nodes select an existing tool and function.[10] | L1 HTTP configs duplicate URL/method/body/credentialRef per node; custom wrappers only live inside a graph. L2 requires injected trusted adapter; L5 supplies none. Slack/Microsoft365 service labels are not implemented integrations. | Store reviewed project-authorized connector definitions separately; node references connector revision/function and maps parameter values. Secret refs only, server vault resolution, SSRF/redirect controls, RBAC. Demonstrate a real allowlisted request, response mapping and denial case; unconfigured integrations remain blocked. |
| R04 / P0 | MCP tool setup requires instance URL, SSE or StreamableHTTP transport and credential type; resource selectable by agents/nodes/workflows.[9] | L1/L2 have no MCP resource schema, discovery or invocation adapter. | Introduce MCP server resource and selected tool/schema binding; credential refs and explicit capability authorization. Show real discovery/invocation and timeout/error path. Do not call generic HTTP or an MCP-labelled mock MCP support. |
| R05 / P0 | Approval processes define notification channels, payload, levels, approvers and conditions; published process attaches to a human-approval node, pauses execution and resumes on outcome; optional feedback target/max executions.[11] | L2 pauses and verifies independent human with replay protection, but WeakMap state is memory-only. L3 has no authorization UI; L5 creates runner without initiator/adapters. No durable approval process/channel registry. | Persist pending run + exact workflow revision/node/payload; authenticate reviewer independently; model/config cannot approve. Prove approve/reject, replay denial, timeout policy and restart recovery before offering operational approval. Preserve unavoidable statutory gates. |
| R06 / P0 | Application sections select app-enabled workflows; workflow must have been published at least once, and explicit draft-use development option exists.[17][18] | L5 generates page suggestions and downloadable handoff only; subapp source generation is not a workflow-association builder. | Add typed section→authorized workflow/revision association and explicit app-enabled capability. Published bindings and development draft bindings must be distinguishable. Real host validation/read-back required before saying pages/apps are created or deployed. |
| R07 / P0 | Workflow/app publication remains access-controlled; workflow settings explicitly select roles.[3] | L4/L6 gate model context and project skill acquisition; L5 project ID is only suggested host scope. Integration document L7 says host owns scope/navigation and current separate-tab boundary. | Bind actual host identity/project/roles to draft, skill/resource visibility, run and publish operations. No model/browser project field confers authority. Verify actual launcher and route/history/leave-guard contract; do not change host separation without approval. |
| R08 / P1 | Expressions support string/date/integer/number/boolean/object/array; scoped variables include system/workflow/user/trigger/user-defined/node inputs, outputs, errors and status.[5][6] | L1 has safe JSON config only; L2 propagates a single predecessor payload, set merges static fields, branch reads a top-level field. No expression/mapping or scoped variable schema. | Provide typed picker/mapping UI for literals and approved context paths, with input/output schemas and missing-field semantics. Validate producer ordering and schema paths; preserve user-question vs conversation scope. No arbitrary eval or executable model code. Test nested object/array mappings and nonexistent paths. |
| R09 / P1 | Chat/user history is not automatically passed to internal LLM/agent/workflow nodes; authors explicitly map required context.[19] | L2 LLM receives generic incoming input and instruction; no declared conversation/history binding or app call context. | Map user input/history explicitly and minimize context; show exactly which authorized fields each node receives. Prevent cross-project/session leakage and avoid silently attaching whole transcripts. |
| R10 / P1 | For/While loop, switch, wait and parallel nodes exist. Documented inspection covers collection/condition, iteration state, wait duration/loop target/max iterations, separate parallel outcomes; switch routes runtime values.[4][16] | L1 forbids cycles and permits only default/true/false ports; L2 blocks multiple active inputs. No switch/loop/wait/parallel schema/execution. | Add bounded structured loop containers (not unrestricted cyclic graph), named switch/default branches, wait resume state and explicit join contract. Test empty collection, iteration limit, no matching branch, cancel/restart and mixed parallel failures. Do not add inert node tiles. |
| R11 / P1 | Reusable reference blocks contain nodes/logic and typed parameters; reference nodes map inputs and reuse block output. Return ends a branch and returns configured value to caller.[12] | L1 custom block wraps one builtin with validated defaults, not a multi-node reusable subflow. L2 output returns full payload and must be terminal. | Keep safe single-builtin wrappers; introduce separately versioned reviewed subflows with typed parameters/output, recursion/depth limits and preserved approval gates. Calling twice with different inputs must yield isolated results. Document single-wrapper vs subflow distinction. |
| R12 / P1 | Permanent workflow errors can notify an email destination; tool/reference/approval nodes select error-handler nodes; failed-node error code/info expressions are documented.[3][5][10] | L2 catches errors as blocked, with bounded timeouts and warning that external side effects may already have occurred. No error edges, notification policy or configurable node retries. | Add explicit on-error target/policy and redacted error envelope. Distinguish transient/permanent failures, configure bounded retries only for retry-safe/idempotent operations, and log partial side-effect uncertainty. Workflow error email is separate from signal delivery retries. |
| R13 / P1 | Webhook, email, interval/recurrence schedule and signal triggers activate after publication; signals carry reusable version/schema contract and delivery max attempts/delay/backoff; inbound email exclusivity is documented.[7] | L1/L2 support one manual root only; no trigger resource schema or event intake adapters. | Implement authenticated webhook first, then schedule/email/signal adapters as separate scope. Bind published revision, validate typed payload, authorize management, deduplicate delivery and expose event/run correlation. Drafts must not activate live triggers. Test schedule timezone and duplicate event behavior. |
| R14 / P1 | Debugger shows path/status, node input/output/context/variables/duration and tokens where available; saved run profiles cover branches/negative cases; step/rerun/resume and temporary override accept/discard are documented.[14][15][22][23] | L2/L3 expose status-only trace and final output. No per-node payload/duration, trace ID, saved profiles, breakpoint debugger or temporary override distinction. | First add redacted node input/output/time/run revision and selected branch, durable trace/run ID and reusable test profiles. P2: breakpoints/step/rerun, clearly flagged test-only pinned/mocked output and override accept/discard. Never replay side-effect nodes without explicit safety confirmation. |
| R15 / P1 | Application anatomy includes advisor, summary, workflow tiles/widgets, priority actions and communications; focusing one agent scopes subsequent questions/actions/communications.[20] Builder commands select actions whose ordered steps navigate app, send agent command, refresh agents, switch context or edit artifact.[17] | L5 pages are skill-grounded suggestions with source/step/role IDs, not declarative workflow-backed runtime sections/action wiring. | Compose Flightdeck-native advisor/summary/workflow sections from a reviewed widget schema. Bind request reason, context, action ID and revision at typed workflow boundary. Prove focus-scoped query, action dispatch and refresh; do not copy Oracle component branding. |
| R16 / P2 | App request hints distinguish startup display/actions/communications, summary/subtitle, query, invoked action, extra panel and communication stages.[18] Communications are outbound and templated, not inbound handlers.[24] | L1/L2 have no application request envelope or communications template/delivery registry. | Define Flightdeck-owned typed request variants and display/action/communication output schemas, renderer allowlist and template parameters. Separate preview from send, require approval before external sends; inbound events stay triggers. |
| R17 / P2 | Production monitoring/evaluation covers errors, session counts, latency/token usage, correctness and RAG quality; reevaluation after agent/model changes is recommended.[21] | L2 local trace has no aggregate metrics, reference-answer evaluation corpus or production monitoring contract. | Correlate real runs with workflow/model/connector revisions, report measured—not synthesized—latency/errors/tokens, and regress core branch/approval/mapping behavior against saved inputs. No requirement to reproduce Oracle AI Units billing metric. |
| R18 / P0 preserve | Oracle lists node categories but does not establish native palette drag/drop or a Compact mode.[4] | L3 has categorized/searchable builtin + reusable palette, native drag/drop coordinate mapping, movable nodes, compact/expanded dimensions and responsive edge anchors. L4/L5 already propose strictly validated reviewed declarative wrappers and skill-grounded page suggestions. | Preserve these user-specific requirements and tests: zoom/scroll drop coordinates, one-action undo, rejected foreign/malformed payloads, custom defaults, display-only compact toggle and settings persistence. Source/skill/step citations remain valid after edits; invalidate or regenerate stale page suggestions. No new code-execution capability in model-generated blocks. |

## Local source anchors (all relative to /Users/te451223/Flightdeck-code)

- **L1:** `packages/workflow/graph.ts:9–43` — builtin/config registry, wrappers, exact DAG version-1 contract, unsupported cycles.
- **L2:** `packages/workflow/engine.ts:1–71`; `packages/workflow/README.md:42–62` — single-input topological executor; optional HTTP/LLM/human adapters; blocked outcomes; in-memory-only pauses; no rollback/retry.
- **L3:** `src/workflow/WorkflowEditor.tsx:7–36,44–100` — typed editor props, palettes/drop/compact, parameter form, local execution and review-only custom block addition.
- **L4:** `packages/spec/src/studio-create.ts:26–105`; `packages/pipeline/src/create-studio.ts:46–159`; `packages/pipeline/src/propose-block.ts:12–37` — strict determination, skill evidence checks, protected proposal, safe builtin wrapper limits.
- **L5:** `src/studio/StudioApp.tsx:9–32,59–65,83–88`; `src/studio/controller.ts:17–43` — reviewed downloadable host handoff, no host mutation, draft graph editor without production execution adapters, separate subapp workbench.
- **L6:** `server/project-skill-source.ts:25–54` — operator-bound skill bundle, bounded schema and project lookup; not proof of authenticated host project authorization.
- **L7:** `docs/studio-os-integration.md:23–46` — recorded host boundary and still-unchecked integration acceptance; this research did not re-run host launch or conformance tests.

## Documented node inventory; do not misrepresent supported execution

The 26D page groups AI (Agent, LLM, Multi Agent, RAG Document Tool, Workflow), Communication (Send Email, Publish Signal), Data (Business Object Function, AI Guidance, Document Processor, External REST, Tool, Vector DB Reader/Writer), Logic (Code, Set Variables, Policy Nodes), Workflow Control (Human Approval, Reference, Reference Block, If Condition, For Loop, Parallel, Return, Switch, Wait, While Loop).[4] The parent's captured 26C text also includes Reference Block; its condensed steering list omitted that row, so use the artifact rather than the condensed list.[26]

Flightdeck currently implements only manual/http/llm/set/branch/approval/output/unconfigured and safe single-node wrappers (L1/L2). Its LLM adapter is not an autonomous Agent/Multi Agent implementation. Its set/branch/output are useful partial analogues, not full Oracle Set Variables/If Condition/Return semantics. Code is intentionally excluded from model-generated blocks; parity is not permission to add arbitrary JavaScript. Unsupported RAG, vector, document, policy, signal and multi-agent nodes should remain absent or explicitly unavailable until real schema/adapters/runtime exist.

## Public demo / observation boundary

The public Fusion AI page's DOM directly exposed app-builder video ID `bPgq6n9YEqQ` and the labelled 1:51 demo control.[25] Observation artifact: `public-demo-observations.json`. Official entry: https://www.oracle.com/applications/fusion-ai/#agentic ; linked demo: https://www.youtube.com/watch?v=bPgq6n9YEqQ . This pass verified provenance only, not playback/transcript or an authenticated authoring session. Existing repository transcript findings for this video and supplier demo `SU_mrEgzg28` remain inherited evidence, not independently re-observed assertions.

REA boundary: parent's MCP 6.4.0 capture `ev_2cf8c27148bdba6f399c129dd500eb35bfaf7e9108ac2c4b071296f6d898e6a4`, exact docs.oracle.com target, canonical `/Users/te451223/.hermes/cache/scratch/oracle-rea-mcp/nodes-reference.json`; text independently read from `nodes-main-text.txt`.[26] Attach-limited/policy-filtered evidence cannot establish earlier network activity, proprietary source/server architecture, or actual workflow execution.

## Unknowns and retrieval issues

- No documented immutable revision numbering, rollback algorithm, draft conflict strategy, secret-storage implementation, backend queue architecture or persistence mechanism was established. Proposed safeguards above are independent acceptance decisions.
- Some guessed documentation slugs resolved to Oracle's unavailable page; a run-profile page initially yielded blank text. Correct pages were recovered using observed Previous/Next/inline links, and successful content verified before evidence registration. Failed captures remain in `captures.json` but are not requirement citations.
- Two Oracle-hosted PDF guides downloaded successfully via real `curl` and were read as supplemental background; they are not used to establish tenant availability or add unversioned acceptance assertions. The app guide itself warns of prospective/illustrative features.
- Browser first attempt failed before navigation because `workspace` was not a Python variable; corrected explicit scratch root immediately. No repo file changed.
- No build/test/deployment was requested or performed. Existing test counts in repository notes are historical, not this pass's verification.

## Delivery artifacts

All under `/Users/te451223/.hermes/cache/scratch/oracle-public-requirements/`: this report; `source-ledger.json`; `verified-sources.json` (IDs, URLs, release/classification, literal quote and capture path); `captures.json` (including failures); individual captured page texts; `public-demo-observations.json`; downloaded supplemental PDFs. The Sources block below is generated from the ledger, not handwritten.

## Sources

[1] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/index.html — 🐴 How do I use AI Agent Studio?
    > "How do I use AI Agent Studio?

G59779-01

26D"
[2] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/choose-how-to-create-workflows-and-agentic-applications.html — 🐴 Choose How to Create Workflows and Agentic Applications
    > "You can create workflows in either of these ways:"
[3] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/create-workflows.html — 🐴 Create Workflows
    > "Specify where to send an email when a workflow instance runs into a permanent error."
[4] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/nodes-in-workflows.html — 🐴 Nodes in Workflows
    > "Here are some of the nodes that are available for workflows:"
[5] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/variables-specific-to-workflows.html — 🐴 Variables Specific to Workflows
    > "Node inputs are variables used to pass input to the node in the workflow."
[6] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/expressions-in-ai-agent-studio.html — 🐴 Expressions
    > "You can directly enter expressions in the required format,"
[7] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/configure-workflow-triggers.html — 🐴 Configure Workflow Triggers
    > "Triggers activate after the workflow is published."
[8] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/add-external-rest-tool.html — 🐴 Add External REST Tool
    > "Select Require Human Approval to ensure that a person reviews and approves any action before the tool runs."
[9] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/add-mcp-tool.html — 🐴 Add MCP Tool
    > "Add a new tool of type MCP."
[10] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/configure-tool-nodes-in-a-workflow.html — 🐴 Configure Tool Nodes in a Workflow
    > "Function: Select the function to use from the connector."
[11] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/add-an-approval-process-channel-to-a-human-approval-node-of-workflows.html — 🐴 Add an Approval Process Channel to a Human Approval Node of Workflows
    > "The workflow resumes after the required approval outcome is received."
[12] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/add-a-reference-block-to-a-reference-node-of-workflows.html — 🐴 Add a Reference Block to a Reference Node of Workflows
    > "Reference blocks define reusable logic in agentic workflows."
[13] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/edit-a-workflow.html — 🐴 Edit a Workflow
    > "You can edit workflows that are in draft status."
[14] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/overview-of-the-debugger.html — 🐴 Overview of the Debugger
    > "Duration: How long the node took to run."
[15] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/create-and-use-run-profiles.html — 🐴 Create and Use Run Profiles
    > "Use run profiles to save and replay common test inputs without retyping prompts,"
[16] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/inspect-node-results.html — 🐴 Inspect Node Results
    > "For Loop and While Loop nodes, inspect the collection or condition,"
[17] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/build-agentic-applications-using-applications-builder.html — 🐴 Build Agentic Applications Using App Builder
    > "Only the workflows that are enabled for using in agentic apps are available for selection."
[18] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/create-and-enable-workflows-for-using-in-agentic-apps.html — 🐴 Create and Enable Workflows for Using in Agentic Applications
    > "From the Details tab, enable Expose to agentic apps."
[19] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/create-and-configure-workflows-for-use-in-agentic-apps.html — 🐴 Create and Configure Workflows for Use in Agentic Applications
    > "Pass user input and history explicitly."
[20] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/anatomy-of-an-agentic-app.html — 🐴 Anatomy of an Agentic Application
    > "Any subsequent questions, actions, and communications are then scoped to the selected agent."
[21] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/monitor-and-evaluate-ai-agents.html — 🐴 Monitor and Evaluate AI Agents
    > "Test your agents for response correctness, response time, and token usage to meet your quality standards."
[22] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/override-node-configuration.html — 🐴 Override Node Configuration
    > "If the override fixes the issue, select Accept to apply it to the workflow."
[23] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/rerun-step-through-or-resume-a-workflow.html — 🐴 Rerun, Step Through, or Resume a Workflow
    > "Step: Run the next node and pause again."
[24] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/overview-of-agentic-apps.html — 🐴 Overview of Agentic Applications
    > "Communications always initiate outbound messages; they never intercept or receive incoming messages."
[25] https://www.oracle.com/applications/fusion-ai — Public Fusion AI demo link
    > "Watch the agentic app builder demo (1:51)"
[26] https://docs.oracle.com/en/cloud/saas/fusion-ai/26c/aiaas/nodes-in-workflows.html — Nodes in Workflows — REA 26C capture
    > "Here are some of the nodes that are available for workflows:"
