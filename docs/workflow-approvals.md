# Durable workflow approvals — opt-in server API

This slice mounts review and decision/resume at the actual `createServer` composition root. It is **not configured in the default Docker companion**, creates no second human identity or credential, adds no browser approval authority, and does not publish or activate resources. No UI or deployment change is included.

## Trusted configuration

`ServerOptions.workflowApprovals?: WorkflowApprovalDependencies` (types in `server/workflow-approval.ts`) requires:

- `store: new WorkflowApprovalStore(privateDirectory)`. The dedicated directory must be server-owned and 0700. The journal and randomly generated, persistent `.integrity-key` are 0600. Paths are startup configuration, never request values. Share the same workspace file, approval directory and protected key across server processes. Use a local filesystem supporting exclusive `mkdir`, atomic rename and directory/file fsync; distributed/network filesystem behavior is not claimed.
- `resolveIdentity(request)`: authenticate the **actual active named human** through a trusted identity provider/session/header verification. Never resolve identity from `body.actor`, `humanName`, `reviewer`, graph text, model output or an unverified browser assertion. The operator remains the initiating actor. No resolver or second account is synthesized.
- `authorize(identity, scope)`: project permission for the action (`list`, `review`, `decide`) **before any journal lookup**, followed for review/decision by exact `{ projectId, nodeId, reviewer, runId, action }` permission. `reviewer` is the queue from the immutable pending node, not the human name submitted by a client. Bind the queue to the deployment's real project membership/roles. Both checks are mandatory; a permissive project lookup must not substitute for gate permission. A reviewer whose trimmed, case-folded name equals the original initiator is refused even if the callback grants permission.
- Optional `ttlMs`: positive integral server-owned duration, maximum 86,400,000 ms, default 900,000 ms. Creation and expiry timestamps come from the server, not graph/model fields.

Cookie authentication must also enforce the deployment's CSRF/origin policy inside the trusted request authentication/policy boundary. This module does not create login sessions, provision reviewers or implement an identity provider. Test-only independent identities in `server/__tests__/workflow-approval-process.fixture.ts` are not usable production configuration.

The workspace store must provide the durable `beginResume` CAS operation; enabling approvals against a legacy custom store without it refuses startup. Adapters are reacquired for **the original initiating actor and project**, never the reviewer. The existing resource composition adapter rechecks project grant and the current activated resource revision at effect time. Workflow approval cannot activate a resource or grant connector access. General HTTP/LLM execution remains unconfigured at the composition root; no provider fallback or publication authority is introduced.

## Public routes and browser contract

Base: `/api/studio/workspaces/:projectId/approvals`.

| Method / suffix | Response | Authority |
| --- | --- | --- |
| `GET /` | `{ approvals: WorkflowApprovalSummary[] }` | Authenticated project `list` permission; metadata only |
| `GET /:approvalId/review` | `{ approval: WorkflowApprovalReview }` | Project + exact pending gate/queue `review` permission, independent active named human |
| `POST /:approvalId/decisions` | `{ approval: WorkflowApprovalSummary, run: WorkflowRun }` | Project + exact gate/queue `decide` permission, independent active named human |

All query fields are refused. All bodies are strict. The decision body is **only**:

```ts
interface WorkflowApprovalDecision {
  approvalId: string; // exact route UUID
  revision: number;   // current approval revision, not draft revision
  decision: 'approve' | 'reject';
  contextDigest: string; // exact reviewed SHA-256, lowercase 64 hex chars
}
```

There is no browser checkpoint, proof, run graph replacement, actor, reviewer or human-name input. No independent `/runs/:runId/resume` endpoint is added. `approve` durably records the decision and resumes the original run in the same request; a second approval node creates a new pending approval with a fresh ID and digest. `reject` blocks the original run. Expiry returns 409 with the persisted expired approval and blocked run, without downstream execution. Duplicate/stale revisions, copied digests and consumed gates return 409. Malformed bodies return 400, unauthorized requests 401/403, unavailable runtime/integrity/storage 503. Unknown query fields currently return 404. The default unconfigured server requires its existing operator authentication and returns 503 from these routes; old pauses and public runs remain `resumable: false`.

Summary fields (exported `WorkflowApprovalSummary`):

```ts
{
  id, revision, runId, projectId, draftId, draftRevision, nodeId,
  state: 'pending' | 'interrupted' | 'consumed' | 'rejected' | 'expired',
  contextDigest, createdAt, expiresAt,
  decisionBy?: string, decidedAt?: string
}
```

`WorkflowApprovalReview` additionally has `context` containing the exact original run/project/draft revision, canonical graph digest, **order-preserving graph digest**, initiating actor, pending node/config/reason, bounded nonsecret `pendingData`, complete immutable graph snapshot, resource references (including revisions/functions), and the server creation/expiry timestamps. The context is authenticated by the private journal. The browser should fetch this exact review, display the context, require an explicit human confirmation of its digest, then submit the same digest/revision. The hash binding prevents context substitution; it cannot prove that a human actually read or understood the display. Do not auto-approve from a list response or model recommendation.

The digest is SHA-256 of UTF-8 **order-preserving JSON** of `context` (the server `canonicalWorkflowValue` serialization), not sorted-key JSON. JSON object-key order is retained because workflow branch equality already uses ordered JSON semantics. The existing workspace `graphDigest` remains the unchanged sorted-key digest; `orderedGraphDigest` adds the stricter execution binding. No checkpoint, ancestor value map, seed, secret key or MAC is exposed in these DTOs or generic workspace GETs. Public traces remain payload-free but retain bounded timing/error/branch metadata and authenticated human names for completed approval entries.

Do not import the filesystem store into a browser bundle. Implement bounded browser-native DTO parsing separately, using the exported types as the contract. Opt-in run DTOs use `resumable: boolean` and `pauseDisposition: 'not-paused' | 'unavailable-no-resume' | 'review-pending'`; legacy/default records still have false and the old disposition. Runtime-disabled, expired, missing-journal and interrupted approvals are not advertised as resumable. A list/GET read projects availability without rewriting approval identities.

## Persistence and crash protocol

Workspace files retain version-one readability and the strict run/graph-digest schema. A durable approval pause upgrades the file to version two; default non-approval writes remain version one. The original run ID, immutable graph, draft revision, initiating actor and one-run-per-revision protection are preserved. A pending durable pause also blocks execution of a newer revision of the same draft. Resume advances `executionEpoch` and updates that original history record; it does not reserve a replacement run.

Private journal records are version one HMAC-SHA-256 authenticated envelopes. MAC verification precedes interpretation of opaque adapter facts. Reads are bounded to 4,000,000 bytes before JSON parsing, use no-follow regular-file reads, reject nonprivate/hard-linked files, and then run strict checkpoint schema/preflight checks. The engine separately validates ordered graph binding, initiator/effective options and the exact prefix/cursor without replaying upstream adapters. Missing integrity keys are **not regenerated** over existing journals or claims.

The decision protocol is deliberately conservative:

1. Take the exclusive cross-process approval lock; authenticate/re-authorize the independent reviewer and confirm the exact journal and current original run after asynchronous authorization.
2. Atomically write/fsync/read back the authenticated decision with incremented revision.
3. Create/fsync a **permanent one-time reservation keyed by original run + pending gate + reviewed context digest**.
4. CAS the exact paused original workspace run to `running` with the current process execution epoch. All workspace mutations use an exclusive cross-process lock and atomic/fsynced readback.
5. Restore the private checkpoint (no adapter execution), verify the narrowly scoped server-only authorization capability, and resume only after the gate. Reacquire effect-time resource authority for the original initiator.
6. Persist/read back the resulting original run. A subsequent gate gets a fresh authenticated checkpoint/approval. Mark the old journal consumed only after that persistence succeeds.

The journal and workspace are separate files, **not a transaction**. Ordering is fail-closed:

- Pending checkpoint and run fully persisted before a decision: survive process restart and permit independent review/resume.
- Crash between recording a paused run and creating its journal, or between persisting a second pause and its new journal: no fabricated checkpoint, no reconstructed upstream execution, no automatic recovery. Public resumability is false; the pending durable run remains an execution blocker requiring investigation.
- Approved but not yet claimed: exposed as `interrupted`, not automatically claimed or retried. It cannot be approved again.
- Claimed (even if workspace CAS has not happened): the permanent reservation prevents any retry; exposed as interrupted unless a terminal journal outcome is present.
- Crash after workspace CAS: an independent process reads the original run as `interrupted`, with null result and resumability false. No downstream replay.
- Crash after external effects or persisted result but before journal completion: retain the permanent claim and conservative interrupted approval; inspect actual original history and external systems. **No transactional exactly-once external-effect guarantee is claimed.**

A crashed lock is never stolen using a timeout/PID guess. Lock contention is bounded and returns conflict. Stale lock/key/journal/claim remediation is an explicit operator investigation, not a browser route. Do not delete claims or rerun the original revision as an automatic repair. Back up workspace, approval journals and key consistently; partial rollback can lose availability but cannot remove a retained one-time claim.

## Exercised evidence

The dedicated tests exercise real file-backed Fastify routes, reconstructed stores/servers, independent child processes, actual loopback DEVELOPMENT REST and MCP initialization/tools-list/tools-call, and actual abrupt process termination after the durable reservation and run CAS. Two separate child-process decisions yield 200/409; upstream REST and MCP calls each remain **1**, downstream REST is **1**, and a reconstructed root GET reads the same original run/output. A killed claimed resume reads interrupted and cannot replay downstream. Downstream resource revocation blocks effects. Additional tests cover self/model/inactive reviewers, wrong project/queue, stale hashes/revisions, client checkpoint/proof/graph authority, copied authenticated journals, tampering, missing keys, rejection/expiry, sequential gates, concurrent decisions, payload-free traces, and state changes during async authorization.

No running Docker service, host OS instance or production provider was changed or called by this slice.
