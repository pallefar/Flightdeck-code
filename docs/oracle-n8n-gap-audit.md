# Oracle + n8n gap audit and Flightdeck build priorities

## Scope

Research date: October 14, 2026. This audit uses Oracle's explicitly versioned 26D public documentation and current public n8n documentation; it is not a claim about the latest Oracle release or a customer's tenant. No authenticated Oracle/n8n deployment or private backend was inspected in this pass. Oracle pages were read in the browser. The corporate browser policy blocks n8n pages; that restriction was not bypassed. n8n comparisons therefore use retrieved, indexed excerpts of official documentation, not a live UI inspection or a full-page capture. These excerpts establish the cited feature families, not every configuration detail or deployment availability. Earlier REA public captures remain separate evidence. Product documentation describes capabilities, not independently measured execution.

Flightdeck status is grounded in the current authoring checkout and the verified work in this development session, not a deployment claim. The live OS container remains separate. The Docker authoring companion uses a private workspace; it does not inherit host project permissions. Local Inputs/Parameters/Results behavior passed actual browser checks. Saved diagnostic DTO integration and the Resources backend are in progress. No Anthropic completion has run without a credential.

## Architecture recommendation

Use Oracle as the reference for governed resources, agent/workflow/application composition and authoring test profiles; use n8n for practical triggers, data transformations, connectors and operational workflow ergonomics. This is a Flightdeck design recommendation, not evidence that their internals use the same architecture. Oracle documents node families and app-enabled workflows.[1][3]

n8n documents tool-using agent roots and a mapping UI.[5][28]

Do not implement a catalog of inert tiles. Each advertised capability needs schema, configuration UI, authority checks, real execution, diagnostics and acceptance evidence. Generic resource/function wrappers should precede numerous bespoke vendor nodes. Oracle's tool-node selection separates connector and function; n8n's HTTP node supports parameterized requests and pagination.[2][13]

## Current capability baseline

**Working locally:** connected DAG editor, categorized palette/search, actual drag/drop, Compact/Expanded rendering, double-click native modal, typed parameter forms, safe original-input/ancestor/literal mappings, per-node local results/timing, undo/redo, import/export, deterministic branches/set/output, bounded failures, and approval pauses without editor self-authorization.

**Working in the Docker authoring slice:** private durable drafts, revision conflicts, exact saved-revision execution, history and restart/recreation readback. The image must be rebuilt after current source changes; new diagnostic schemas are being integrated first.

**Implemented but not a live provider claim:** explicit four-destination model selection, destination-bound skill review, protected workflow/subapp generation routes. Anthropic credential provisioning is outstanding; local service absent; Codex tool-free runtime and approved Flightdeck planner bridge remain unresolved.

**Not production-connected:** service labels on generic HTTP blocks, reusable wrappers, page suggestions and public-document research. These are not configured vendor integrations, durable approval/resume, host publication or autonomous agents.

## Prioritized block/runtime backlog

Priorities below are recommendations for Flightdeck. The source column identifies documented reference capabilities; our acceptance criteria are independent design decisions.

| Priority | Block or capability | Reference evidence | Flightdeck gap and acceptance |
|---|---|---|---|
| P0 | Reusable resource/function picker | Oracle connector/function selection; n8n HTTP operations.[2][13] | Bind resource revision + function + permitted scope. One real REST read and MCP call; unauthorized resource/tool fails before network use. No arbitrary URL or credential in graph. |
| P0 | Durable reviewer decision/resume | Oracle Human Approval; n8n agent-tool approval channels.[1][23] | Authenticate independent reviewer; bind exact pending payload/revision; approve/reject, replay denial and restart recovery. Current pause is not sufficient. |
| P0 | Draft/published runtime separation | Oracle app exposure requires publication and distinguishes development draft use.[3] | Immutable published revision, publish validation, rollback reference, audit and host authority. Edits never alter an activated revision silently. |
| P1 | Webhook trigger + response | n8n Webhook test/production URLs and response modes.[10] | Authenticated bounded intake, typed payload, deduplication and run correlation; draft test endpoint cannot activate production effects. |
| P1 | Schedule trigger | n8n timezone-aware schedule configuration.[11] | Explicit timezone, publication binding, missed-event policy and deduplication; test timezone/DST transitions. |
| P1 | Merge/join | n8n Merge combines streams and waits for connected inputs.[8] | Explicit append, matching and precedence policies; bounded multi-input execution. Current executor refuses multiple active inputs. |
| P1 | Split/for-each + aggregation | n8n Loop Over Items; Oracle For Loop.[9][1] | Structured bounded iteration, empty collection, batch/rate limits and aggregation. No unrestricted cyclic graph. |
| P1 | Switch/multiple branches | Oracle Switch.[1] | Named outputs/default, typed case comparison, no-match behavior and visible selected path. Current branches only true/false. |
| P1 | Wait/durable resume | n8n Wait and Oracle Wait.[12][1] | Persist timer or event-wait state with resume correlation, cancellation and restart tests. No promise held indefinitely in a process. |
| P1 | Parallel fan-out | Oracle Parallel.[1] | Explicit bounded concurrency/join policy and mixed-failure outcomes; no invented success when a branch fails. |
| P1 | Error handler + Stop/Fail | n8n dedicated error workflow and Stop And Error.[25] | Safe error envelope, permanent/transient distinction, timeout uncertainty and explicit compensation policy. Do not auto-retry non-idempotent actions. |
| P1 | HTTP pagination/rate control | n8n HTTP pagination.[13] | Endpoint-specific continuation schema, maximum pages/bytes, cancellation and rate control; origin/credential rules continue across pages. |
| P1 | Filter/Sort/Limit/Deduplicate/Aggregate | Practical transformation family: Flightdeck recommendation | Implement safe declarative collection operators with typed inputs/outputs and exact behavior tests; not arbitrary code or placeholder tiles. |
| P1 | Run profiles and evaluation | Oracle saved test inputs; n8n dataset evaluations.[4][24] | Save test data and expected properties, compare real results per model/workflow revision, record measured latency/available usage. Separate fixtures from production. |
| P2 | Read-only knowledge retrieval | Oracle RAG/document/vector nodes; n8n PGVector.[1][18] | Authorized document/index versions, source citations and access filtering; retrieval failure must not become an invented answer. |
| P2 | Structured agent | n8n agents choose tool actions rather than only transform a prompt.[5] | Explicit allowed tools, validated output, interaction/time/cost budgets and review gates. Current LLM node is not an autonomous agent. |
| P2 | Supervisor/worker agents | Oracle Multi Agent.[1] | Bounded delegation, isolated context, traceable tool decisions and shared approval requirements. Do not attach entire transcripts by default. |
| P2 | Versioned reusable subflows | Oracle Reference/Reference Block/Workflow.[1] | Typed input/output contract, revision pinning, nesting limits and preserved unavoidable human gates. Current single-builtin wrappers are not subflows. |
| P2 | Workflow-backed app sections | Oracle app exposure and request hints.[3] | Reviewed Flightdeck pages/actions call authorized published workflow revisions; suggestions/export are not page deployment. |
| P2 | Environment promotion | n8n source-control environments.[26] | Exported declarative version/diff, dev/test/prod resource remapping, review and separate secrets. No promise of copying n8n plan-specific feature availability. |
| P2 | Binary/document pipeline | n8n separate binary-data storage.[27] | Bounded upload/blob references, malware/content policy, retention and access controls; no large file/base64 blobs in graph JSON. |

## Connector shortlist

This is a recommended order, not a statement that these are already connected. Actual selection should follow the owner's workflows and credentials. Permissions, OAuth/admin consent, provider terms and deployment network policies must be verified for each connector.

| Wave | Connector/resource | First useful operation | Activation proof |
|---|---|---|---|
| A | Generic REST | Read a reviewed endpoint using typed parameters | Actual response mapping; auth/redirect/SSRF denial; measured errors. |
| A | MCP tools | Discover then explicitly authorize one selected read-only tool | Real protocol lifecycle and tools/call; schema drift, unapproved tool and timeout denial. |
| A | Anthropic API | Protected workflow draft and reviewed reusable block proposal | Actual approved request; strict output; recorded destination/model; no fallback. |
| B | Microsoft SharePoint / OneDrive resource | Read/list authorized documents | Tenant consent, project ACL, safe file limits and real readback. n8n documents SharePoint file/list operations.[14] |
| B | Outlook/email | Read message; draft outbound message before allowing send | Scoped mailbox consent; preview/send distinction and actual receipt. n8n documents Outlook drafts/messages.[15] |
| B | Microsoft Teams | Reviewed notification or approval request | Channel authorization, exact payload review and actual delivery acknowledgement. n8n documents Teams integration.[16] |
| B | PostgreSQL | Read-only parameterized lookup | SQL parameter binding, restricted role, tenant isolation and real query result. n8n documents Postgres query/table operations.[17] |
| C | PGVector knowledge index | Retrieve authorized chunks with citations | Data source/version permissions and measured retrieval tests. n8n documents PGVector integration.[18] |
| C | Slack; Gmail; Google Drive/Sheets; GitHub; Jira; CRM | Candidate families, not yet researched to operation-level acceptance | Conduct connector-specific primary-doc/auth review before committing scope. No parity or ready-node claim from a vendor logo. |
| D | Oracle Fusion business-object functions | Read approved enterprise business data | Actual Oracle tenant and sanctioned API/task contract required. Public node docs do not grant access.[1] |

Generic REST/MCP definitions must distinguish server-reviewed activation from model-proposed resource descriptions. Defaults remain read-only and unconfigured until operator policy supplies the destination and authorization. Vendor keys stay server-side; graphs store reference IDs only.

## Builder and operational UX

1. Keep the working modal Inputs/Parameters/Results pattern. Display actual observed fields as examples, not guaranteed schemas; n8n also offers a dedicated drag/drop mapping UI.[28]
2. Add connection test results with last-tested time, revision and scope; never equate configured with connected.
3. Provide operation search within a selected resource and classify triggers separately from actions, AI, data, logic, approvals and outputs.
4. Add saved test profiles before breakpoints/replay; Oracle's profiles are reusable test inputs, not permission to replay side effects.[4]
5. Show immutable run revision, actual node inputs/outputs where explicitly captured, timing, branch, retries and failure category. Keep sensitive data retention opt-in.
6. Add read-only execution comparison, node notes, alignment, minimap and keyboard command search as Flightdeck usability proposals; these were not individually verified as Oracle/n8n features in this pass.
7. Add publication review/diff, credential access controls and operator ownership before enabling scheduled or external side effects.
8. Do not copy arbitrary Code/Python/JavaScript nodes into AI-generated graphs. Oracle documents Code, but its presence is not permission to weaken Flightdeck's declarative execution boundary.[1]

## Delivery order and release gate

**Now:** finish durable mapping/diagnostic DTOs, rebuild only the Studio companion, verify saved mapped execution and preserve old records. Finish the Resources slice with real REST/MCP transport checks. Live Anthropic test requires secure key provisioning.

**Next:** mount resource library/operation picker; introduce webhook and schedule behind publication and authorization; implement independent durable approvals; add merge, bounded iteration and error policies.

**Then:** versioned subflows, structured agents, RAG/document resources, evaluation suites and actual workflow-backed Flightdeck app actions.

A capability is usable only when configuration, auth, real transport/runtime, persistence/readback where relevant, failure modes and UI behavior are verified. Missing permissions or credentials remain explicit blockers. “Most capable” should mean composable and dependable, not the largest untested catalog.

## Sources

[1] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/nodes-in-workflows.html
[2] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/configure-tool-nodes-in-a-workflow.html
[3] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/create-and-enable-workflows-for-using-in-agentic-apps.html
[4] https://docs.oracle.com/en/cloud/saas/fusion-ai/26d/aiaas/create-and-use-run-profiles.html
[5] https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent
[8] https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.merge
[9] https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.splitinbatches
[10] https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook
[11] https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger
[12] https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait
[13] https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest
[14] https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.microsoftsharepoint
[15] https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.microsoftoutlook
[16] https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.microsoftteams
[17] https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.postgres
[18] https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.vectorstorepgvector
[23] https://docs.n8n.io/build/integrate-ai/ai-examples/human-in-the-loop-for-tools
[24] https://docs.n8n.io/build/integrate-ai/test-and-improve-ai-workflows/run-quick-evaluations
[25] https://docs.n8n.io/build/flow-logic/handle-errors-gracefully
[26] https://docs.n8n.io/administer/use-source-control-and-environments/set-up-source-control.md
[27] https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/use-external-storage
[28] https://docs.n8n.io/build/work-with-data/understand-n8ns-data-structure
