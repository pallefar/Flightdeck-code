# Oracle AI Agent Studio → Flightdeck Studio

## Evidence boundary

This is a public-surface investigation and an independent Flightdeck implementation, not recovery of Oracle's proprietary backend. No authenticated Oracle tenant was supplied. REA successfully inspected the public Fusion AI page through Chrome DevTools Protocol with an exact `https://www.oracle.com` origin filter.[1]

REA observation: `ev_367d84d0a0f72386744e4ae97605fd83d0a95875ce036e10246e3565ad1c14bb`. Capture was attach-limited and policy-filtered; it did not establish historical network activity, server architecture, or execution inside the Agent Studio builder. Credentials, storage values, and script sources were not requested. The evidence was captured on October 13, 2026.

## Reference patterns

Oracle documents workflows as preconfigured node sequences; nodes can perform model calls as well as ordinary processing. The workflow creation path has separate model, security, trigger, variable, and error-handling configuration, followed by publication.[2]

Oracle's application builder is a separate composition layer. Applications add sections backed by app-enabled workflows, support advisor and summary sections, and distinguish UI action steps such as navigation and refresh from workflow execution.[3]

App-enabled workflows expose a structured application request context. This suggests a typed application/workflow boundary rather than parsing arbitrary LLM prose.[4]

The research pass extracted timestamped transcripts of two Oracle-linked demos. These findings are transcript-supported, not independently visually observed: the supplier quote demo describes editing a workflow, adding human approval, publishing, and an end-user approval step.[5] The app-builder demo describes natural-language assembly, layout changes, preview, and publish, but explicitly elides part of agent configuration behind the scenes.[6]

## Flightdeck design decisions

These are our implementation choices, not claims about Oracle internals:

1. A bounded structured LLM determination decides **workflow** versus **sub-app**, or requests clarification. Invalid, truncated, or failed replies do not default to a builder.
2. A sub-app stays on the existing source-generation and conformance path. A workflow is a distinct draft for Flightdeck's workflow builder, not a workflow converted into a mini-app and relabelled.
3. For workflow projects, authorized project skills provide the planning context. Suggested user-facing pages cite skill identities and workflow step identities. Unknown references are rejected.
4. Classification is not authorization. Existing authentication, datasource permissions, pseudonymisation, privacy checks, and human review remain in front of model and host mutations.
5. Drafting, creation, host compliance, registration, execution, and publication are separate states. A frontend preview must not pretend that host typechecking or a mount probe ran.
6. Host handoff uses trusted destinations (`POST /api/workflows` and `POST /api/ui/pages`), never model-generated endpoint URLs. Project scope is resolved by the host, not granted by an LLM field.

## Current host integration anchors

Inspected the separate `pallefar/project-contract` host checkout:

- `flightdeck/server/routes/workflows.ts`: workflow scaffold creation, manifest validation, immutable existing process directories, boot-registration proposal rather than editing `boot.json`.
- `flightdeck/server/routes/uiPages.ts`: project-scoped page creation, administrator checks, page/layout separation, document-page draft/publish lifecycle.
- `flightdeck/web/src/pages/WorkflowInstance.tsx`: workflow run view.

This repository is Studio. Do not modify the host or declare pages deployed merely because Studio produced a draft. Host creation must be verified through its authenticated APIs and read back after each mutation.

## Baseline before feature work

- `npm run typecheck`: passed.
- Full test run against a fresh host checkout via `FLIGHTDECK_HOST_ROOT=/Users/te451223/project-contract`: **2204 passed, 3 failed, 2207 total**.
- Existing failures: `packages/codegen/src/__tests__/manifest-rules.test.ts` attempts to read the host's docusign, maps, and advantage hand-written manifests as JSON literals. Those manifests contain computed values. This was observed before new production features were added; no security/divergence checks were disabled.

## Sources

[1] https://www.oracle.com/applications/fusion-ai
[2] https://docs.oracle.com/en/cloud/saas/fusion-ai/26c/aiaas/create-workflows.html
[3] https://docs.oracle.com/en/cloud/saas/fusion-ai/26c/aiaas/build-agentic-applications-using-applications-builder.html
[4] https://docs.oracle.com/en/cloud/saas/fusion-ai/26c/aiaas/create-and-enable-workflows-for-using-in-agentic-apps.html
[5] https://www.youtube.com/watch?v=SU_mrEgzg28
[6] https://www.youtube.com/watch?v=bPgq6n9YEqQ
