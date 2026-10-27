# Disabled host bridge: bounded draft authority/transport prototype

**Status: independently executable kernel and isolated fixture, not integrated shared login.** Nothing here is imported, mounted or enabled by the current Studio composition root or either host checkout. The existing separate-sign-in plain-link launcher is unchanged. Approval of an opt-in bridge did not authorize deployment, account/policy grants, source cutover or access to a live session/database.

The source contract remains [studio-host-identity-contract.md](studio-host-identity-contract.md), including its audited-source versus running-backend distinction. The existing audit/parent-check files are unchanged. Their 115 ranges / 76 files / 34 H–R pairs are prior independently checked evidence, not a claim that this prototype validated a real user session.

## Implemented

`packages/host-bridge/` contains:

- **`authority.ts`**: off-by-default host-process authority registry. An explicitly enabled kernel still refuses without an independent trusted draft-action policy. It retains the actual request object and a request-liveness predicate; issues opaque random request-bound handles; binds canonical actor ID, exact workspace/project, action, method, literal path, SHA-256 of exact body bytes, session/context/policy revisions, audience and bounded expiry. Consumption is synchronously claimed before the first await. A private lease supports fresh checks during that one invocation, not a second invocation. Completion, expiry, shutdown or request death invalidates authority, including in-flight checks.
- **`native.ts`**: structural adapter for the real native `reauthorizeRequest(req)` and `projectDirectory(req)` method ABI. The same actual request reaches both awaited seams and a final reauthorization. It rejects missing principal/scope, pending accounts, missing methods, disabled context, native failures and substituted tuple/actor/role. It requires auth and workspace mode explicitly enabled. It does not import/boot host modules or parse host cookies.
- **`transport.ts`**: separately constructed Fastify host-BFF/private-authority server and Studio draft-RPC server; literal development-loopback private HTTP client. The browser route does authentication/policy preflight before body parsing, pins exact Origin including port, and requires a trusted host-session-bound CSRF checker for mutations. Missing checker denies. Fresh authority is checked again after body parsing, at RPC consumption, before store entry, after asynchronous reads/commits, and on the host immediately before returning the private DTO.
- **`draft-store.ts`**: draft-only facade over the **existing** `createFileWorkflowWorkspaceStore`, not a mock or replacement database. It always creates a new marked private root. Reconstruction requires that marker and private directory/file checks. Files are separately namespaced by injective hex encodings of workspace ID and project ID in two directory components; `alpha/general` and `beta/general` cannot share a project-only journal. The legacy live store is never opened. Persistence actor fields use canonical usernames, never a startup operator or display label.
- **`fixture.ts`**: deterministic **nonsecret synthetic native context, account/membership/policy, CSRF and dedicated-peer fixtures**, exercising the native adapter and the actual transport/store. These are not production logins, host accounts, real host session validation or permission assignments. Test-only private invocation capture is opt-in and memory-only; no handle, lease or body is written to evidence or returned to the browser.

All active roots, existing DTOs/stores/routes/UI/deploy files, host sources and launcher remain untouched. No dependencies or SDKs were installed, no model was called, and no new user database was created.

## Browser and private protocol

Only these browser routes exist on the **isolated constructed server**, not on the running host:

| Method | Literal route | Independent required action |
|---|---|---|
| GET | `/bridge/workspaces/:workspaceId/projects/:projectId/drafts` | `draft.list` |
| GET | `/bridge/workspaces/:workspaceId/projects/:projectId/drafts/:draftId` | `draft.read` |
| POST | collection above; strict `{graph}` JSON | `draft.create` |
| PUT | exact draft above; strict `{graph,expectedRevision}` JSON | `draft.update` |

Selectors must be explicit and match the trusted resolved tuple. No query strings, percent-encoded aliases, arbitrary upstream URLs, browser actor fields, HEAD/OPTIONS fallback or generic route proxy are accepted. Browser actor/role/scope/forwarded/proof headers do not grant anything. An authorized request carrying a forged actor header remains attributed to its real canonical actor; an unauthorized request cannot become authorized through that header.

The **new prototype-only private endpoints** are POST `/private/studio-drafts/invoke`, `/private/studio-authority/consume` and `/private/studio-authority/check`. They are not discovered preexisting host delegation APIs. They authenticate dedicated server-owned peer configuration before parsing bodies. The immutable invocation envelope is revalidated against host-held state; the browser never receives it. These callbacks retain the original host request, not the newly arriving RPC request, as the identity source.

Only Content-Type, Content-Length and a dedicated `x-studio-peer` header are explicitly created on outbound private requests (Node adds Host/Connection). No host Cookie, browser Authorization, forwarded headers, actor/scope headers, browser proof, Studio operator token, database credential or service-role key is forwarded. There is no browser `/auth/me` authorizer. Responses are strict draft/scope DTOs with `no-store`, no credentialed CORS and fixed failure categories; request/response bodies are not logged. Redirects are rejected and requests are never automatically retried.

**Current private transport is deliberately DEVELOPMENT-ONLY:** canonical `http://127.0.0.1:<explicit-port>`, no DNS/proxy resolution, remote URL, TLS, production peer distribution, load balancing or reverse-proxy mounting. It does not prove that cleartext loopback or a header key is an acceptable production deployment. The visibly nonsecret fixture peer key must never become production configuration. Real TLS/peer identity, approved canonical origin and trusted proxy posture require separate review.

## Authority boundaries, including missing host implementation

The native SDK does **not** supply generic Studio author/reviewer policy, an external delegation endpoint, host-session-bound CSRF checking, or the session/context epochs required by this prototype. Those must not be invented from directory metadata.

In particular, `createNativeContextAdapter` requires a trusted server-only `view(req)` projection of the already resolved native request and an **additional `epochs(req)` provider**. This provider is **not an existing inspected host SDK method**, is deliberately unconfigured outside fixtures, and must freshly bind nonsecret session/account/membership/custom-policy/enabled-context revisions to the actual request without exporting raw cookies or credentials. Missing epochs refuses. No live implementation is supplied or claimed. The adapter's current-identity result is still **not a draft action grant**: the kernel separately requires the host-owned, deny-default `DraftPolicy.permit` provider.

- Global `super_admin` discovery, project ownership, a workspace directory row and app `openable`/consent cannot become Studio draft permissions. The fixture independently demonstrates membership and action-policy refusal, including a global-only super-admin.
- Projects remain organizing dimensions within host workspace membership. Exact project binding here prevents namespace confusion; it does not assert that the host has project-membership tables or new project access semantics.
- A future trusted policy must explicitly allow each draft action for the canonical actor and exact tuple and compose all relevant fresh host restrictions, including app consent if mounted as a consent-bound app. No real account/policy grants are defined here.
- Display names are labels. Changing one does not mint an identity, and two actors with the same label remain `alice` and `bob`. Neither maps to the existing process-global Studio operator.
- No generic reviewer authority, human/service attestation, independent-review policy, execution grant, model destination authority, model credential setup, resource activation/effect, approval/decision/resume, installation or publication exists in this API. Those routes are absent and effect counters remain zero. Saving a graph that contains such node types is not permission to execute it.

The actual declared native methods are read and AST-extracted by `native.test.ts`; the relevant interfaces are strictly typechecked through an in-memory projection against this adapter. `capabilitiesFor(workspaceId, req): Promise<SubAppCapabilities>` is separately pinned as an actual request-taking async ABI, **not used as a generic draft grant**. The tests read source text only: no host import, boot, dotenv, auth endpoint, database or credential access. An explicit missing host root fails rather than skipping the test. This is scoped ABI evidence, not a whole-host compile or running-backend source attestation.

## Freshness and atomicity limits

A fresh check happens after awaited processing immediately before read disclosure/write API entry. The host BFF also confirms the original invocation after the private response arrives. Revocation during the fixture's awaited pre-write barrier yields **zero write entries**; revocation after an awaited read yields only a fixed refusal, not draft content. In-flight handle completion/shutdown is explicitly tested.

**These are not transactional host-authority/FS guarantees.** The real store performs asynchronous lock acquisition, reads, tempfile writes, fsync, rename and readback after the entry check. Authority can change during that work or during an RPC round trip. Independent native session, directory, revision and action-policy reads are not one atomic host snapshot either. The trusted host providers must perform their own effect-time freshness checks; this kernel cannot manufacture an atomic snapshot across them. Final checks reduce stale disclosure but cannot atomically combine host revocation, a filesystem commit and a network send.

If a write commits and a later freshness check, response transfer or timeout fails, persistence is **uncertain to the browser**; it is not rolled back. Do not automatically retry creates or effects. Once permitted again, explicitly read the exact record/revision (or reconcile the scoped draft list for an uncertain create). Existing store CAS protects update revisions, not distributed exactly-once create semantics. Process loss drops in-memory invocation authority; it never restores or resumes a grant. Multi-process authority distribution, durable revocation, transactional commit interlocks and root-wide route migration are not implemented.

## Bounds

- Raw draft body: 270,000 bytes; existing graph admission: 256,000 bytes and the existing pure-JSON/depth checks.
- Private envelope/response: 1,000,000 bytes, strict bounded schemas. A large list fails rather than becoming an unbounded stream; no pagination is claimed.
- Invocation lifetime: default 2,000 ms, allowed 1–5,000 ms; default 64 retained entries, configured maximum 1,024. Concurrent consumption claims exactly once within this host process. Test-only deterministic clocks are labeled as such.
- Browser workspace/project IDs: canonical ASCII slug subset, each at most 64 characters; canonical actor ID: at most 200 characters; no silent normalization. This can refuse some historical host IDs that the native registry accepts; it does not rewrite them or pretend universal host compatibility.
- Private request timeout: 4,500 ms; fixture server socket/request settings: 5,000 ms. These are bounded transports, not a guarantee that an underlying asynchronous store transaction was cancelled.

## Run without mounting or deploying

From the Studio checkout, using the already installed dependencies:

```sh
# Default: proves the browser BFF returns 503 without any draft entry, then closes.
node --import tsx examples/host-bridge-draft.ts

# Explicitly enables ONLY new ephemeral synthetic fixture servers and a NEW scratch root.
# Does real HTTP create / exact GET / CAS update / exact GET in alpha/general;
# creates bob's beta/general draft, proves cross-namespace refusal, reconstructs the
# real file-backed store and compares both complete snapshots, then closes/deletes fixtures.
node --import tsx examples/host-bridge-draft.ts --synthetic-drafts

# Same isolated exercise, writing nonsecret measured evidence to this tranche's owned path.
node --import tsx examples/host-bridge-draft.ts --synthetic-drafts --write-evidence

FLIGHTDECK_HOST_ROOT='/Users/te451223/FlightDeck OS/wt-integration' \
  npx vitest run packages/host-bridge --maxWorkers=1
npm run typecheck
npx tsc --noEmit --moduleResolution bundler --module esnext --target es2022 \
  --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes \
  --skipLibCheck --esModuleInterop examples/host-bridge-draft.ts
```

The demo reports only nonsecret fixture origins, status codes, canonical fixture actor/scope, draft IDs/revisions, snapshot hashes and zero effect counters. It never prints body contents, peer credentials, CSRF values or invocation authority. A successful run exits and removes only its newly created scratch root. It does not keep a listener running.

## Verification and acceptance scope

Owned actual execution evidence lives under `docs/evidence/host-bridge/`: the focused Vitest JSON report, draft demo result, strict-typecheck result and source-contract check. The suite exercises disabled/missing-policy behavior, anonymous/expired/revoked/pending/nonmember/global-only-super-admin fixtures, enabled context and resolver mismatches, forged browser identity/headers/body, missing explicit tuple, unknown methods/effect routes, Origin sibling ports/CSRF, bounded malformed/oversized JSON, dedicated peer authentication, body/method/path/audience/expiry binding, real HTTP replay/concurrent consumption, workspace/general isolation, canonical actors/display labels, revision CAS, await-barrier revocation, exact durable reconstruction and real redirect target/retry counters.

The records in these tests are synthetic drafts; the sockets and filesystem persistence are real. A focused pass and strict project/example checks are **not** the entire repository test suite, a full-host boot, authenticated host smoke, production TLS audit or deployment approval.

## Parent verification — October 15, 2026

Parent reread all authority/native/transport/draft-store/fixture implementations and the executable example. Before adding this annotation, all **15 delivered artifact hashes** matched the worker source-contract report. Parent independently rechecked the host-only subset: **102 ranges / 68 host files / 34 candidate–reference pairs**, all exact, with both host tracked trees clean using Git's no-optional-locks read-only mode. The original audit's additional **13 Studio anchors** were not silently recertified by this host-only check. This still does not attest the compiled running backend or a live session.

Parent execution passed **63 focused tests / 8 files**, the existing **22 store tests / 2 files**, and the separate strict example typecheck. The example actually ran in default-disabled mode (503, no draft entry) and explicit isolated synthetic mode (create 201, exact read 200, update 200, exact reconstruction and workspace/general isolation). No host or Studio root was mounted.

An additional parent-owned guarded probe (`docs/evidence/next-ui/host-bridge-parent-probe.mjs`) ran real BFF/RPC HTTP against a **new** private scratch root. It verified forged browser actor/scope headers do not change canonical fixture attribution; display renames preserve identity; stale update returns 409 without replacing the current draft; two workspace/general journals remain separate; and complete draft readbacks, exact reconstructed bytes/file modes and private-header names remain correct. Unsupported effect counters stayed zero. Its socket guard allowed only its two owned literal-loopback ports and observed zero forbidden attempts. Cleanup then verified the **exact scratch root absent** and **both ports refusing connections**. Measured output is `host-bridge-parent-http.json`; no session/peer/CSRF values or raw draft bodies are recorded.

The default host-aware repository entry also passed **3,289 Vitest cases / 230 files plus 30 Node Docker/bootstrap cases**, followed by strict project typecheck, build and `git diff --check`. These are framework case counts (the Vitest report has 3,286 distinct displayed names), not thousands of independent production security proofs. Focused/store cases above are included, not additional totals. Generated evidence is `docs/evidence/next-ui/full-merged-pre-release-tests.json` and `full-merged-pre-release-node-tests.json`; the existing bundle-size advisory remains.

The detailed original source/test verification record is `docs/evidence/next-ui/host-bridge-parent-check.json`. The first read-only security critique has now completed and found two P2 context-boundary defects; remediation and current verification are recorded below. The earlier tests remain historical pre-release evidence, not final composed-app/candidate-image acceptance, shared-login integration, production authority/FS atomicity or deployment approval.

## Independent findings and parent remediation — October 15, 2026

The original report, source freeze, measured negative probes and focused/store test results are archived under `docs/evidence/next-ui/host-bridge-independent/`. Parent checked all five original production/fixture hashes before editing. The critic demonstrated two bounded defects, not a real-host/browser-only escape:

1. **R1/P2 — authenticated peer response confusion.** A real owned HTTP relay around the actual RPC/file store could preserve the outer tuple while substituting an inner project or UUID, omitting data, returning both record and list, or returning 201 for an exact GET. Parent reproduced each acceptance before repairing it. The BFF now requires the action-specific status and cardinality; checks every inner project and exact requested UUID; rejects duplicate list record IDs; and binds successful write metadata to the current canonical writer, create attribution, expected next revision and the exact ordered parsed request graph. Sorted-digest-equivalent nested key reordering is rejected. Read/list records and update creators may legitimately retain another historical actor; they are not forced to equal the current reader/writer.
2. **R2/P2 — pre-body CSRF context discarded during upload.** A real partial POST with a previously valid session-bound CSRF value could finish after session rotation and obtain authority for the new epoch. Parent reproduced 201 where refusal was required. Preflight now returns an opaque, host-process-only ticket backed by a private WeakMap; it retains the actual request identity, actor/session/authority/policy snapshot, exact method/path and expiry. The BFF requires that ticket after parsing, and issuance claims it synchronously before awaiting, compares the original snapshot against fresh state/policy and checks expiry/state again afterward. Origin and the trusted CSRF checker are also freshly checked after body upload. The checker must support non-consuming revalidation of the same actual request. Missing, forged, reused, cross-request or cross-authority tickets refuse. Existing trusted direct authority callers in isolated core tests may still issue without a browser-preflight ticket; the BFF cannot.

Preflight tickets use the same configured TTL as invocations (default 2,000 ms), measured separately: an overlong upload refuses rather than silently minting a fresh session context. A ticket is not a serialized identity assertion or a new host session provider. No real host CSRF/epoch/action-policy implementation has been supplied.

Six observed vertical RED/GREEN checkpoints are retained: authority preflight, actual slow upload, inner project, read response shape/status/UUID, list semantics and write confirmation bindings. The final focused suite passed **99 cases / 10 files** with no failed/pending tests: 37 authority cases, six actual partial-upload cases across POST/PUT and session/authority/policy changes, 18 actual HTTP relay/real-store response cases and the unchanged baseline transport/native/demo/security coverage. Focused cases are included in, not added to, the new host-aware full pass: **3,325 Vitest cases / 232 files plus 30 Node Docker/bootstrap cases**. Project typecheck, build and diff checks passed; the unchanged 740.30-kB JS bundle retains its size advisory. The strict standalone example typecheck also passed.

The new `parent-remediation-probe.mjs` changes only the output destination of the original parent probe. It ran against current code with a new owned marked root and two owned loopback ports, verified exact create/read/CAS/reconstruction/namespace/attribution/file-mode behavior, observed zero forbidden socket attempts and zero unsupported effects, then confirmed the exact scratch root absent and both ports refusing connections. `parent-remediation-http.json`, `parent-remediation-recount.json` and `parent-remediation-verification.json` contain measured readbacks/counts/hashes. Only `authority.ts` and `transport.ts` changed among the five original production/fixture modules; native/store/fixture source hashes remain unchanged, as do both host tracked trees.

Malformed peer confirmations now fail closed, but **a real write may already have committed**. The relay write tests explicitly verify exactly one requested commit and unchanged real data after the substituted response is refused; they do not claim rollback. No automatic retry is added. Response-shape/content binding is not cryptographic attestation that an otherwise self-consistent peer record is durable; explicit exact readback/reconciliation remains necessary.

The fresh independent scoped recheck (`deleg_82360b80`) is accepted with a **bounded no-new-finding result**: the original concrete R1/R2 defects did not reproduce. Its independently authored actual HTTP/file-store harness enumerates **69 groups: 61 negatives and eight positive controls**—36 response-substitution negatives, 12 POST/PUT partial-upload negatives and 13 ticket negatives. Historical-creator/current-writer, exact reconstruction, stable upload, TTL−1 and concurrent single-use controls passed. The unchanged focused suite passed **99 cases / 10 files**, separately from those groups. Parent matched all **33 artifact hashes and 19 current repository file hashes**, recounted the 69 unique groups and 99 passing assertions, and confirmed all 99 are included in the existing 3,325-case parent full suite. The independent harness removed 39 marked roots and closed 101 owned listeners; all 10 suite-worker guard snapshots report no remaining listeners (139 opens/closes). No overlapping or repeated counts are added. Exact artifacts and parent verification are archived under `docs/evidence/next-ui/host-bridge-independent/reaudit/`, including `parent-check.json`. Parent did not claim a second execution of all 69 independent groups. This closes the bounded prototype remediation acceptance, not live host identity, production peer/TLS, authority/filesystem atomicity or malicious-peer durability attestation. This tranche remains unmounted/off and was not deployed. The initial post-remediation runtime readback was blocked by an unreachable Docker daemon. After the user restored Docker, the parent verified Docker 29.8.1, healthy staging/companion/OS containers and exact retained container/image IDs. All three start timestamps changed with the restart. Studio/companion health and the OS page return 200; the accepted staging frontend and its built asset are served. `docs/evidence/next-ui/runtime-restored-readback.json` records the new evidence. This restores the existing accepted deployment only, not a current-source candidate or bridge integration; the host Vite process is separate. No engine, host stack or service was restarted by this work.

Before any mounting/cutover: separate parent security review; verify the actual backend source revision; implement/review native host session/context epoch and CSRF providers plus explicit real draft policies; approve exact host-origin routing/proxy/peer topology; migrate **every** sensitive Studio route, store, run/send/review/resource binding and browser DTO to per-request canonical actor and workspace/project namespacing. Existing operator routes cannot be bypassed or relabeled integrated by mounting this small package. Independent-human review and effects remain blocked until their own exact authority contracts are approved and verified.
