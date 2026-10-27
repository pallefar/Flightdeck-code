# Independent workflow Approvals inbox

The retained **Approvals** Studio area is mounted beside AI builder, Workflow editor & demo, and Resources. It uses the same in-memory project/operator token and same-origin cookie credentials; it does not provision a reviewer, accept a human-name assertion, or grant authorization. The server contract remains `docs/workflow-approvals.md`.

## Deployment boundary

A deployment must configure the actual trusted independent-review identity provider and project + exact gate/queue permissions. The initiator cannot review their own run. The default runtime is not configured; authenticated approval requests return 503, unauthenticated requests are refused. Missing credentials leave Refresh disabled, and 503 never becomes a fake empty inbox or enabled approval action. A browser credential field is not independent identity evidence. Sign-in must use the deployment's real authentication boundary, not an invented second account or a secret supplied in chat.

No backend, engine, Docker, host, resource activation or provider configuration was changed by this UI slice. No production approval was performed under Karsten Haldan or a fabricated reviewer. The DEVELOPMENT fixtures below are deliberately isolated and have no production identity authority.

## Explicit review sequence

1. **Refresh approvals** requests authorized metadata only. Mounting/navigation does not automatically request private context or execute anything.
2. Select an approval to fetch its exact `/review` response. Before display, native Web Crypto checks SHA-256 of UTF-8 order-preserving JSON, the separate ordered graph digest, the existing sorted graph digest, scope/original identities, node/gate configuration and derived resource references. Sorting the context is incorrect. Missing Web Crypto blocks confirmation.
3. Review the pending data, queue/reason, complete immutable graph, exact resource function/revision references, timestamps, original draft/run identity and displayed digest. React text rendering is used throughout. Bounded stored data is not a guarantee of anonymization.
4. Explicitly check the human digest acknowledgment. **Approve and resume** warns that downstream configured actions may immediately execute under the original initiator's authority. **Reject** blocks that original run. The POST contains only `approvalId`, approval `revision`, `decision`, and `contextDigest`.
5. A successful receipt is not final success: fetch the exact original approval review, exact original workspace run, and that draft's run history. Confirm the immutable ordered graph and original identities, decision receipt, recorded reviewer/trace, and exact updated result before displaying a read-back outcome. A later pause is displayed as a fresh gate requiring Refresh, a different review and new acknowledgment—not a finished workflow.

Acknowledgment clears on refresh, selection, expiry, scope/credential change, response and cancellation. Expired, consumed, rejected and interrupted contexts cannot decide. Concurrent clicks send at most one decision. Stale responses cannot chain additional readbacks after a scope change; previous-person private data is masked during render before reset effects.

409, 503, lost responses and failed/mismatched readbacks remain uncertain. Error bodies, including an expired 409 receipt, are not treated as success. There is no automatic retry/resume. **Inspect original run history** is a separate explicit read of the captured original identity; its status is not evidence of a particular decision. Canceling the browser request cannot stop server effects already claimed.

Review responses are stream-capped at 4,000,000 bytes before JSON parsing. Review preflight rejects excessive depth (24), accessors, unsafe prototypes/keys, oversized graph/pending data and non-native JSON before recursive schemas. Browser contracts import pure graph schemas only, never filesystem-backed stores. Workspace transports are wrapped to avoid native Fetch receiver errors.

## Durable run browser DTO

`resumable` is boolean. `review-pending` requires paused state and `resumable: true`; non-paused states require `not-paused` and false. Legacy and runtime-unavailable pauses retain `unavailable-no-resume` and false. Timing/branch/error metadata remains strict and old payload-free traces remain readable. Human names are accepted only on completed approval trace entries and displayed as recorded evidence. The initiating workspace points to Approvals without an Approve button, while preserving one-run-per-revision and pending-run blockers.

## Verification

- `npx vitest run src/studio server/__tests__/workflow-approval.test.ts server/__tests__/workflow-approval-process.test.ts packages/workflow`: **265 tests / 27 files passed**, including **20 new inbox/DTO/UI tests**, actual file-backed route decisions, child-process restart/claim tests and core checks.
- `npm run typecheck`, `npm run build`, and `git diff --check` passed. Build retains Vite's >500 kB chunk advisory (559.59 kB bundle); it is not a compiler failure.
- An actual production Vite build inspected all chunk module IDs: **88 browser modules**, including the three approval modules; **zero server/store/Node modules** crossed the browser boundary.
- Source Studio at `http://127.0.0.1:5180/demo` was exercised in a real browser: four navigation areas, retained editor/workspace/resources DOM, and auth-disabled default Approvals. A StrictMode idle-cleanup cancellation message found during this exercise was reproduced RED, fixed, and rechecked.
- The browser-only development harness passed **six grouped checks**, **24 captured fixture requests**, and **three explicit development decisions**: self-review 403 without private context; native Web Crypto acknowledgment; one POST despite repeated clicking; exact approval/run/history readback; sequential new gate and rejection; scope masking; and an authenticated 503 from a second unconfigured composition root. Default native WorkspaceClient Fetch also read the exact original run successfully. The two private backend roots and Vite fixture were stopped after verification; their ephemeral storage was removed.

### Repeat the isolated browser proof

```sh
npx tsx src/studio/__tests__/approvals-browser.fixture.ts
```

Open the printed `browserUrl`; `window.approvalChecks` reports the actual result. The fixture uses loopback servers, private ephemeral journals and **explicit nonsecret DEVELOPMENT sentinels**. Its injected reviewer header is accepted only by that test composition root, with an independently checked project/queue. It is not a deployable identity provider, real named-human approval, host integration or configured connector/model proof. Stop the process after checks; its SIGINT/SIGTERM cleanup closes the roots and removes storage.

### Full-suite result and existing blockers

The first full run lacked `FLIGHTDECK_HOST_ROOT`, correctly failing seven live-source prerequisite checks. Re-running with the real local host checkout removed those failures. With default high worker concurrency, the unrelated real resource-run composition test exceeded its existing 5-second test limit; it passed unchanged in isolation (1.25 seconds) and in the complete four-worker run (1.27 seconds). No timeout, validator, test selection or production source was relaxed.

```sh
FLIGHTDECK_HOST_ROOT=/Users/te451223/project-contract npm test -- --maxWorkers=4 --minWorkers=1
```

Actual result: **2,765 Vitest tests passed; three known manifest-source failures remained**, plus **four Docker Node tests passed**. The three failures are the existing hand-written `docusign`, `maps`, and `advantage` manifest fixtures whose computed fields are refused by the generated-manifest JSON-literal reader. No new inbox/DTO regression remained. This is not an all-green full-suite claim, and no host deployment or real independent reviewer authentication is established.
