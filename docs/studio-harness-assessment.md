# Flightdeck Studio: reusable authoring harness assessment

Status: both static-source audits and the isolated Deep Agents deterministic SDK spike are complete. Parent verified the retained artifact and independently reran the actual pinned SDK, isolation probes and app-matched typecheck: 42 unique fixture/isolation cases passed. The extra strict dependency declaration check independently reproduced 22 errors. Verdict PARTIAL; all 24 production acceptance cases remain not-run. No harness is integrated into or activated in the app, OS, companion or staging; no live provider call or app dependency installation occurred in this experiment.

## Decision direction

Reuse an existing agent runtime for planning, bounded tool calls, context management, and actual event reporting. Keep Flightdeck's authorization, validated artifacts, independent approvals, credentials, and operational budgets outside that runtime. A runtime should never become the authority for its own tools or approvals.

Retain Deep Agents JavaScript/LangGraph as the conditional integration candidate: its stripped native authoring loop now has independently reproduced executable fixture evidence. Resolve the declaration issues and exercise the actual Flightdeck native provider/broker/identity boundary before production selection. DeepSeek remains a research candidate only through custom composition; do not adopt shipped SDK-minimal as a protected default. Do not combine full frameworks, replace the business workflow runner or install a harness in the OS as a shortcut.

## Verified candidates

### DeepSeek Harness

The official DeepSeek project is a real Cordis-based harness, not merely a model API. Its documentation describes staged dispatch, monotonic guards and identity-protected execution [2,3]. That documented protection is stronger than the inspected implementation; see the static dispatch finding below. The reviewed checkout is pinned at `571902028a75c64c1d767f4ae5fd099485f0ddf0`; its root package version is `0.2.1-alpha.3`, license MIT, and declared Node engines `^22.19.0 || >=24.0.0`.

Important limitation: upstream calls this unaudited developer-preview software, not a sole security control [29]. Correction to the initial documentation-based assessment: the actual SDK-minimal configuration selects `danger-full-access`, persistent shell tools, retries, automatic compaction and JSONL persistence [37]. It is not a security-minimal composition. Do not run it against Flightdeck source, credentials or host services as shipped.

### DeepSeek static-audit findings

- Dispatch integrity: execution identity is normal writable object data; guards run before around-dispatch middleware, and the body resolves the then-current tool name/agent/arguments. The execution object is frozen only at result notification. This indicates a same-process middleware mutation gap, not a demonstrated prompt-driven exploit or sandbox escape [36].
- Sandbox scope: inspected Linux profiles permit host-root reads; the macOS profile is allow-default with write denial. These profiles do not establish confidential-source or egress isolation [38].
- Request accounting: the default retry count is five; the always-retry mode has no retry-count ceiling. Initial evaluation must omit these and auxiliary model producers [39,37].
- Lifecycle: SDK `run()` observes receipt-to-idle without a per-run AbortSignal/deadline. An RPC timeout leaves server work running; whole-runtime teardown is needed for abandonment [40,41].
- Privacy: session events record raw tool arguments and rendered results/metadata. Preserve metadata-only app diagnostics rather than adopting these logs [42].

The independent audit is `/Users/te451223/.hermes/cache/scratch/studio-harness-research/deepseek-audit.md`. It records broader source findings and test-source limitations. No repository code or security tests were executed. Safe SDK evaluation and authority remain separate from source review.

### Deep Agents JavaScript / LangGraph

The official documentation describes built-in file operations, progressive skills/context handling, delegation, custom tools/MCP, typed event streaming, and human-in-the-loop interruptions with checkpoint support [31,33]. That makes it a credible integrated authoring-runtime candidate, subject to dependency and compatibility evaluation.

Important limitation: its filesystem permissions are first-match-wins and an unmatched operation is allowed. Subagent `permissions: []` explicitly removes inherited restrictions, and filesystem permissions do not constrain arbitrary shell execution or custom tools [24]. Application tool authorization and isolation must still enforce the real boundary. Do not use a production durable approval mechanism by relying on the example MemorySaver, a client-supplied thread ID, or a library resume command alone.

### Deep Agents implementation review and executable gate

Pinned source `9f3bfd5529ef9df65158c609f6590f1127b56416` declares `deepagents@1.15.0`. A viable narrow composition replaces the default filesystem, delegation and summarization middleware by exact name, injects a host-owned native model and registers only fixed broker callbacks [43,44,45]. This reuses the actual upstream loop; it does not require a Flightdeck-written agent loop.

Implementation limits: tool selection can change after middleware hooks; summarization invokes the model outside the main wrapper; the native `tool()` wrapper can reject on abort while its callback still runs [46,48,47]. The actual broker/model promises must remain in Flightdeck's admission ledger until settlement. No policy decision may rely on an SDK tool name, runtime context, thread ID or resume command as authority.

The complete static audit is `/Users/te451223/.hermes/cache/scratch/studio-harness-research/deepagents-audit.md`. The executed spike resolves the observed published SDK peer discrepancy with exact `@langchain/langgraph-sdk@1.9.30` and a verified 46-package lock/physical tree. It imported and ran under Node 22.23.3 / TypeScript 5.9.3 with existing app flags. Full app integration and hostile-code containment remain unverified. The 24 application acceptance cases remain `not-run`; fixture passes do not promote real identity, provider, approval or checkpoint cases.

The executable feasibility result is PARTIAL: actual SDK catalog-read/candidate-proposal turns succeeded, forbidden operations had zero broker effects, post-hook selection/definition swaps were denied by fixed broker bindings, and original-operation accounting held through actual SDK early-abort settlement. These are predetermined native-model fixtures, not live-model reasoning or independent reviewer evidence. The fixture uses trusted closures in one isolated process; it is not an external production broker or arbitrary-JavaScript sandbox. Parent reproduced the draft and denied CLI scenarios as well as all 42 checks. The extra `skipLibCheck:false` check returns 22 dependency declaration errors and zero fixture-source errors, so compatibility is explicitly qualified. Exact image/evidence and scope are in `studio-harness-spike-evaluation.json`; all SDK installation/execution stayed in new no-network, non-root/read-only containers with no app/host mounts, and existing services were unchanged.

### OpenHands SDK

The official SDK documents default execution tools, policy-controlled action confirmation, custom approval handling, and DockerWorkspace-based remote execution [32,35]. It is worth evaluating if autonomous repository editing and test execution becomes the primary requirement. For the current TypeScript app plus bounded workflow authoring, it adds a Python/service/workspace seam; this is an integration cost judgement, not a claim of inferior security. Its action risk analyzer is advisory, not a substitute for Flightdeck's independent review and effect-time authorization.

### OpenAI Agents SDK (JavaScript)

The official SDK documents custom function tools, input/output/tool guardrails, handoffs, approval and run state [17]. It is a credible thinner orchestration option. Input guardrails run concurrently by default, so security-relevant checks must block before work begins. Its custom-function tool guardrail pipeline does not cover every handoff or built-in/hosted execution tool [17]. Keeping only brokered custom tools is therefore part of the design, not an optional extra.

## Protected architecture

Chat and existing typed workflow/sub-app determination
-> selected harness authoring loop, fixed actor/project/model/context binding
-> Flightdeck-owned deny-by-default tool broker
-> validated candidate source/graph, or isolated verification worker
-> human review and durable app authorization
-> existing workflow execution/deployment paths (never an authoring-tool shortcut).

Current application evidence: `packages/providers/src/openai-compatible.ts` constructs a bounded non-streaming JSON-object planning request and rejects native tool/function response forms. `server/model-connections.ts` resolves explicit provider bindings. Adding an agent runtime is therefore a new controlled native tool-call path, not a relabel of the current planner. Keep the existing safe planner available until the new path is exercised and accepted. Preserve the current explicit destination selection and unavailable-provider behavior; framework adoption cannot establish missing credentials, approved host gateway tasks, or vendor connectivity.

### Initial tools (proposed, not yet registered)

- Read the actor/project-scoped registered-block inventory and actual configuration availability.
- Read a selected registered block's bounded schema and typed port contracts.
- Propose a workflow graph using registered blocks.
- Propose a graph-local declarative wrapper for review; never install it as a global plugin.
- Read and patch candidate-owned allowed source files using revision preconditions.
- Validate graph/source/manifest and preview a received artifact through existing safe interfaces.
- Ask clarification or submit a draft result.

Verification that executes candidate code stays disabled until an isolated execution service is actually configured and tested. Shell commands, plugin installation, arbitrary filesystem/network access, secrets/vault reads, resource activation, live external side effects, approvals, execution and deployment are not initial authoring tools. Do not advertise unavailable capabilities.

### Mandatory boundaries

1. Authenticate actor/project in the server; reject model-supplied identity or scope overrides. Revalidate every call and resume against the current context/model epoch.
2. Enumerate tool names, use strict bounded input/output schemas, canonicalize candidate paths, and reject traversal/symlink escapes. Native framework permissions supplement but do not replace broker policy.
3. Read credentials only in approved server-side adapters. Never mount credentials or host directories into a code-verification worker. Restrict verification networking, tools, resources and lifetime. Sandboxing alone does not prevent in-sandbox exfiltration [34].
4. Use the existing independent reviewer/auth/CAS/HMAC/effect-time checks for privileged operations. Missing approval adapters deny; stale or edited arguments invalidate the reviewed action. Model, subagent and framework resume calls cannot approve themselves.
5. Apply reviewed context-send bindings, bounded data classification/scrubbing and resource authorization to tool outputs before any model turn. Preserve metadata-only diagnostics; disable automatic remote tracing, raw argument logging and unmanaged harness session persistence.
6. Enforce request-wide model/tool/concurrency/time/output budgets across main agents, delegated work and compaction. Do not let framework retries or provider defaults introduce unapproved fallback or repeat external effects.
7. Subagents receive strict subsets of the parent's broker capability and the same global budget. A framework configuration change cannot expand host authority.
8. Treat catalog, retrieved documents, skills, tool output and generated source as untrusted content, not permission grants. Models may propose artifacts, not tool installation or policy changes.
9. Drive UI activity from sanitized real harness events. Preserve accepted-artifact routing and received-piece assembly; never animate invented execution, deployment or tool completion.

## Acceptance before activating a harness

Evaluate a pinned isolated candidate without production credentials or host/OS access. Exercise actual SDK dispatch/guards with deterministic test doubles; label those as test-double evidence, not live vendor generation. Then test a configured explicitly selected live provider separately when credentials are available. Do not claim that a passed unit test proves containment.

The accompanying acceptance matrix lists required allowed and denied behavior. Every denial case must prove zero handler side effects, not just an error message. Logs/event payloads must be inspected for data leakage. Concurrent approvals, cancellation, stale context and resume must be tested against application policy. Verify release dependencies, isolated runtime behavior and unchanged persistence/host identities before any private staging adoption.

Primary source URLs and pinned checkout evidence are below and in the source ledger. Both shortlisted static-source audits are complete; actual isolated dispatch/type/dependency tests and application integration remain separate gates before selection or activation.

## Primary references

[2] deepseek-ai/deepseek-harness — https://github.com/deepseek-ai/deepseek-harness
[3] docs/tool-execution-pipeline.md — https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/tool-execution-pipeline.md
[17] Guardrails — https://openai.github.io/openai-agents-js/guides/guardrails
[24] Permissions — https://docs.langchain.com/oss/javascript/deepagents/permissions.md
[29] DeepSeek safety notice (pinned source) — https://github.com/deepseek-ai/deepseek-harness/blob/571902028a75c64c1d767f4ae5fd099485f0ddf0/SAFETY.md
[30] DeepSeek sdk-minimal default access (pinned source) — https://github.com/deepseek-ai/deepseek-harness/blob/571902028a75c64c1d767f4ae5fd099485f0ddf0/packages/bundle/sdk-minimal/README.md
[31] Deep Agents harness capabilities (full retrieved markdown) — https://docs.langchain.com/oss/javascript/deepagents/harness.md
[32] OpenHands security/confirmation (full retrieved markdown) — https://docs.openhands.dev/sdk/guides/security.md
[33] deepagents-hitl — https://docs.langchain.com/oss/javascript/deepagents/human-in-the-loop.md
[34] deepagents-sandbox — https://docs.langchain.com/oss/javascript/deepagents/sandboxes.md
[35] openhands-sandbox — https://docs.openhands.dev/sdk/guides/agent-server/docker-sandbox.md
[36] Pinned DeepSeek source — https://github.com/deepseek-ai/deepseek-harness/blob/571902028a75c64c1d767f4ae5fd099485f0ddf0/packages/core/tools/src/index.ts
[37] Pinned DeepSeek source — https://github.com/deepseek-ai/deepseek-harness/blob/571902028a75c64c1d767f4ae5fd099485f0ddf0/packages/bundle/sdk-minimal/cordis.patch.yml
[38] Pinned DeepSeek source — https://github.com/deepseek-ai/deepseek-harness/blob/571902028a75c64c1d767f4ae5fd099485f0ddf0/packages/sandbox/sandbox-local/src/profiles.ts
[39] Pinned DeepSeek source — https://github.com/deepseek-ai/deepseek-harness/blob/571902028a75c64c1d767f4ae5fd099485f0ddf0/packages/llm/llm/src/retry-policy.ts
[40] Pinned DeepSeek source — https://github.com/deepseek-ai/deepseek-harness/blob/571902028a75c64c1d767f4ae5fd099485f0ddf0/packages/sdk/client/src/api.ts
[41] Pinned DeepSeek source — https://github.com/deepseek-ai/deepseek-harness/blob/571902028a75c64c1d767f4ae5fd099485f0ddf0/packages/sdk/client/src/client.ts
[42] Pinned DeepSeek source — https://github.com/deepseek-ai/deepseek-harness/blob/571902028a75c64c1d767f4ae5fd099485f0ddf0/packages/core/agent-loop/src/tool-calls.ts
[43] Audited Deep Agents stack — https://github.com/langchain-ai/deepagentsjs/blob/9f3bfd5529ef9df65158c609f6590f1127b56416/libs/deepagents/package.json
[44] Audited Deep Agents stack — https://github.com/langchain-ai/deepagentsjs/blob/9f3bfd5529ef9df65158c609f6590f1127b56416/libs/deepagents/src/agent.ts
[45] Audited Deep Agents stack — https://github.com/langchain-ai/deepagentsjs/blob/9f3bfd5529ef9df65158c609f6590f1127b56416/libs/deepagents/src/middleware/utils.ts
[46] Audited Deep Agents stack — https://github.com/langchain-ai/langchainjs/blob/e493ed653d734e31a8d051f78ab29b067f530e4b/libs/langchain/src/agents/nodes/ToolNode.ts
[47] Audited Deep Agents stack — https://github.com/langchain-ai/langchainjs/blob/417ddcf506790e1f50050609d5cf9b252c38f3e3/libs/langchain-core/src/tools/index.ts
[48] Audited Deep Agents stack — https://github.com/langchain-ai/deepagentsjs/blob/9f3bfd5529ef9df65158c609f6590f1127b56416/libs/deepagents/src/middleware/summarization.ts
