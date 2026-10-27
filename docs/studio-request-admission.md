# Studio expensive-request admission

The standalone composition root now owns one process-local admission controller shared by model build/create/block proposals, saved workflow runs, resource execution, and independent-reviewer approval decisions. It is not a host authorization system, rate limiter, financial budget, or distributed semaphore.

## Bounds and refusal

Defaults: **4 active globally, 2 per authenticated actor, 2 per project**, with **zero queued requests**. All three caps apply simultaneously. Projects are validated using each route's existing strict schema before acquiring a bucket; omitted model projects share a reserved internal unscoped bucket. Novel projects cannot bypass the global or actor cap. Actor keys are internally normalized to match the approval runtime's case-insensitive human-identity comparison. Inactive actor/project buckets are immediately removed; each map has at most the global active limit's number of entries.

The trusted `createServer({ requestAdmission: ... })` option accepts only `global`, `actor`, `project` (integers 1–100), `deadlineMs` (1–300000, default 30000), and `drainMs` (1–30000, default 5000). Omitted fields receive those defaults. Unknown fields, explicit undefined values, nonintegers and out-of-range values fail startup. No environment/browser limit override or queue exists.

Saturation returns **429**, constant `Retry-After: 1`, and only `{ "error": "request capacity unavailable" }`. The header is a pacing hint, not a promise that capacity will free in one second. The backend does not retry or enqueue refusals. Caller identity labels cannot establish a bucket: model/saved-run routes use the configured authenticated operator; Resources uses its trusted authenticated identity; decisions use the approval runtime's resolved reviewer. Resumed execution still uses the immutable original run initiator, not the reviewer or browser body.

Authentication precedes parsing/admission for model intake and the existing workspace/resource/approval routes. Unauthenticated requests remain 401, including malformed/oversized model intake. Existing body limits remain 1000000 bytes for model routes, 300000 for workspace routes, 32000 for Resources and 4096 for approvals. Fastify's actual request-receive timeout is now 30000 ms; this is not an execution deadline or proof of cancellation.

## Ordering and execution semantics

Model admission precedes registry resolution/provider acquisition and covers the entire classifier → planner sequence with one permit. Server model wrappers refuse repair attempts, attempts greater than one, and fresh calls after failure or abort; successful classification followed by initial planning remains two distinct calls within one admitted request. This intentionally removes automatic planner repair calls from these HTTP routes.

Saved-run admission precedes durable `reserveRun` CAS and acquiring adapters. Decision admission precedes the approval lock, decision write, permanent claim, run CAS and restored execution. Resource invocation admission precedes resource lookup and adapter execution. Existing effect-time project authorization, independent reviewer validation, and durable at-most-one reservation/claim invariants are unchanged. Admission is not permission to execute.

## Cancellation and settlement

Every permit owns a deadline AbortSignal. Request abort/incomplete close and actual socket disconnect request cancellation; shutdown also signals all admitted work. Signals are combined with workflow-engine adapter signals, forwarded through existing resource/HTTP/LLM adapter request ports, and supplied as an optional signal to model functions. Supported transports can honor them; the existing Anthropic planner bridge does not forward that optional model signal. A trusted manual/host adapter may likewise ignore it.

**Aborting is not settlement.** Tracked provider/adapter promises must actually settle before a permit is released, including after an exception and after the workflow engine has already returned its existing timeout/side-effect-uncertainty result. Responses can finish while a soft-aborted adapter still holds capacity. There is no timed replacement, retry or false claim that provider billing/remote effects stopped. A model adapter ignoring abort can keep its request and capacity occupied indefinitely; operators must repair/terminate such an adapter rather than launch replacement work behind it.

Settlement is the trusted adapter promise boundary. An opaque provider library that internally returns from a timeout race while retaining hidden transport/remote work cannot expose that hidden settlement to this controller. No in-process semaphore can prove remote effect cancellation or enforce a monetary/token budget. Providers must honor their promise/abort contract; remote side effects and financial limits remain separate deployment concerns.

`preClose` stops admissions and requests cancellation before draining; `onClose` also drains. Draining is bounded by `drainMs` and rejects with the fixed `request admission drain incomplete` error if work remains. It never resets counts, frees hung permits, reopens admission or waits indefinitely. Public health remains the existing unchanged liveness response; no new readiness/configuration disclosure route is added.

## Verification

New composition-root barrier tests use authenticated real Fastify injection and isolated private file-backed journals. Twelve concurrent novel-project model requests produce **2 provider entries and 10 constant 429 refusals** with defaults. Shared caps reject build/create/block work before registry resolution and saved runs/resources/approval decisions before reservation, adapter calls and durable claims. Real loopback REST readback proves a subsequently admitted saved graph executes once and duplicate reservation remains 409 without an extra socket call.

Additional tests independently exercise global/actor/project caps, normalized actor identity, 1000 transient scopes with no retained buckets, strict startup options, classifier/planner shared permits, exceptions/no provider retry, deadline abort with ignored cancellation, a real HTTP socket disconnect, bounded actual composition-root shutdown, trusted reviewer vs original operator identity, and the unchanged real five-second workflow-engine timeout while a deliberately broken trusted adapter fixture remains unsettled. No live vendor call, credential read, billing, deployment or production effect is involved.
