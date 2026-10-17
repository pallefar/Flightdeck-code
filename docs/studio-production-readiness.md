# Studio production-readiness audit

**Release verdict: BLOCKED.** The private single-operator loopback companion has verified security/engine foundations; it is not a verified shared production service, installed host DAG runtime, or live provider integration.

Audit started **2026-10-14 10:36:25 UTC**. Source evidence snapshot **2026-10-14T10:46:12.741650+00:00**. HEAD `f80ad1f05018b8a38e720c3df59bff5ff0950cba`; working tree dirty and actively edited by other workers. Each JSON source anchor carries its inspected SHA-256. New production-serving code appeared during this audit: file existence does not close a gate, and active deployment remained unchanged.

## Ranked release ledger

**20 gates: 7 blocked, 9 missing, 4 verified.** `verified` means the named bounded criterion only, not certification. `missing` is an engineering/operational control absent from inspected composition, not a claim of exploitation. `blocked` includes configuration, final verification and unresolved acceptance criteria. P0 blocks shared/effectful production; P1 blocks the relevant production surface; P2 remains a quality/operability gate.

| ID | Rank | State | Gate | First source anchor | Owner role |
|---|---|---|---|---|---|
| G01 | P0 | blocked | Trusted identity/project membership | `server/index.ts:33` | Identity / host integration |
| G02 | P0 | blocked | Independent reviewer and cookie CSRF | `deploy/studio-docker/bootstrap.mjs:10` | Identity / approvals |
| G03 | P0 | missing | Consistent restore and anti-rollback | `server/workflow-approval-store.ts:107` | Storage / operations |
| G04 | P1 | missing | Model egress origin/address policy | `packages/providers/src/openai-compatible.ts:21` | Provider / security |
| G05 | P1 | blocked | Production assets and CSP | `vite.config.ts:23` | Deployment / parallel worker |
| G06 | P1 | blocked | Installed-image audit and digest pin | `deploy/studio-docker/Dockerfile:1` | Build / dependencies |
| G07 | P1 | missing | Bound request admission/effect budgets | `server/index.ts:195` | API / runtime |
| G08 | P1 | missing | Stale-lock recovery without replay | `server/workflow-approval-lock.ts:10` | Storage / operations |
| G09 | P1 | missing | Payload privacy/retention/export authority | `server/workflow-workspace-store.ts:77` | Privacy / storage |
| G10 | P1 | missing | Secrets/HMAC lifecycle | `deploy/studio-docker/secrets.mjs:9` | Security / operations |
| G11 | P1 | missing | Readiness/bounded graceful drain | `server/index.ts:243` | Operations / API |
| G12 | P2 | missing | Nonsecret operational observability | `server/index.ts:200` | Operations / security |
| G13 | P1 | missing | CI/approved release artifact | `scripts/test-all.mjs:16` | Release engineering |
| G14 | P1 | blocked | Strict manifest baseline/final full suite | `scripts/test-all.mjs:7` | Codegen / conformance |
| G15 | P2 | blocked | Canvas usability/accessibility verification | Browser / parent observation; scope limited | UX / accessibility |
| G16 | P1 | blocked | Host runtime/live provider scope | `server/model-connections.ts:11` | Host / providers |
| V01 | P1 | verified | Private loopback Docker isolation | `docker-compose.studio.yml:8` | Deployment |
| V02 | P1 | verified | Durable ordered approval/crash refusal | `server/workflow-approval-store.ts:110` | Approval / execution |
| V03 | P1 | verified | Resource DNS-pin bounded transport | `packages/resources/transport.ts:26` | Resources / security |
| V04 | P1 | verified | Private bootstrap/constant failures | `deploy/studio-docker/secrets.mjs:9` | Deployment / security |

`studio-production-gates.json` is the authoritative detailed ledger: prerequisites, actual source excerpts/hash, safe reproduction, remediation and acceptance tests for every row. Owner roles are proposed responsibility, not assertions about assigned people.

## Parent verification addendum — after this audit snapshot

**Current private UI artifact (October 15, 2026):** `studio-command-inspect-release.md` records the accepted running staging image `sha256:171ab7208da5d9de7c8a2403699fd17bb333ca6a8d1a397c23baff3d6372130e`, 3,000 Vitest tests / 211 files plus 16 Node tests, exact preserved private records and unchanged OS/companion identities. The actual image has 63 locked runtime application packages and zero known application dependency findings. The historical counts and “missing” statements below are not a current-source inventory; a fresh remaining-gate review is in progress. No shared production, host identity or live provider claim follows.

**Lifecycle follow-up (source only):** `studio-lifecycle-readiness.md` adds a nonsecret request-admission readiness route with no model probes. Three readiness cases plus existing admission regressions (15 tests / 3 files), typecheck/build/diff passed. Stopped/hung work remains nonready without freeing capacity, and public liveness is unchanged. It is not yet deployed and does not close the broader G11 supervisor/failure-policy gate.

**Development-toolchain follow-up:** the parent subsequently passed **2,867 Vitest tests / 187 files and all 16 Docker tests** under Vitest 4.1.11, plus typecheck/build/diff checks. Full-development, production-lock and physically verified new candidate-image npm application audits returned zero known findings; the six development findings noted in the historical sections are now resolved in current source. The new isolated candidate was verified without changing the frozen running staging/companion/OS. See `studio-verification-devchain-2026-10-14.json`. This is not an OS/global-tool scan or a general security/deployment guarantee.

**Earlier staging artifact freeze:** the parent subsequently verified the complete host-aware suite at **2,864 Vitest tests / 186 files and 16 Docker Node tests, zero failures or skips**, plus typecheck/build/diff checks. The three manifest baseline failures are resolved with unchanged strict generated admission and bounded static core-metadata conformance against actual host sources. G14 is verified for that engineering scope, not installed-host boot. The latest source witness, exact staging image and remaining blockers are recorded in `studio-verification-2026-10-14.json`. The ranked counts/anchors above and the original audit JSON remain historical snapshots; their original G14 blocked state is superseded by that explicit override.

The final shell/editor layout and opt-in production-serving candidate were subsequently delivered. The parent reproduced/fixed the nested-main landmark regression, passed 81 focused shell/editor/contract tests plus typecheck/build, rebuilt the combined layout image and exercised the actual built app and API at loopback port 8790. Exact saved-run and unavailable-approval readbacks survived a staging-only restart. The companion and OS were unchanged. See `studio-staging-evaluation.md` for the specific image, evidence and evaluation limits.

This closes neither the entire G05 deployment boundary nor the entire G15 accessibility criterion: the private staging image is not an HTTPS/identity-configured production deployment or conformance certification. The ranked ledger above remains the historical evidence snapshot, not a claim that current production-serving engineering is absent. Request admission, offline backup verification and runtime dependency minimization have subsequently delivered scoped engineering results. The parent passed 402 server/workflow/resource/provider tests and 16 Docker tests, rebuilt the hardened staging image, physically verified its 63 production application packages and audited that exact image with zero known application-dependency findings. Six development-toolchain findings remain. Offline verification still refuses restore; production freshness authority/quarantine/recovery are not implemented. Concurrency limits are process-local, not rate/financial/distributed budgets. These results are detailed in `studio-staging-evaluation.md`; they do not close the broader identity, production recovery or deployment gates.

## Three implementable high-leverage slices (no user credentials)

1. **Production asset/image + header boundary (G05/G06)** — parallel worker in progress. Active `5180` still returns Vite/react-refresh; original Dockerfile installs dev dependencies and runs `tsx`. Exercise an isolated immutable build/image and actual Workbench preview under strict parent `script-src` without `unsafe-inline` or `unsafe-eval`. Preview currently portals into an `about:blank` same-origin iframe and injects CSS (`src/workbench/components/PreviewFrame.tsx:57-64,76-81`); preserve no `allow-scripts`. Resolve style CSP compatibility without weakening script isolation. Verify hash cache, MIME, traversal, exact API routing, secret/source absence and TLS/reverse-proxy contract. Do not touch running OS/companion to prove this slice. Production Compose needs deliberate deployment-specific configuration, not reuse of the dev entry.[2]
2. **Bound expensive-route admission (G07)** — source `server/index.ts::createServer` / `/blocks/propose` and `server/workflow-workspace-store.ts::serialized`. A scratch composition-root barrier probe sent **12 requests and observed 12 simultaneous provider entries**, with zero network/billing. Add global/actor/project semaphores, bounded queues, rate/deadline/cost budgets, explicit 429/503/Retry-After and shutdown drain. Barrier tests must prove cap, rejection before durable reservation, release after exceptions/abort and no duplicate effect retry.
3. **Synthetic consistent backup/restore + recovery verifier (G03/G08)** — source `WorkflowApprovalStore::claim`, `initialize`, approval decision ordering and workspace `beginResume`. Build only in ephemeral scratch, using synthetic keys/data and no real adapter grants. Include workspace/resources/grants/private integrity key/journals/permanent claims; reject missing/mixed/older state and prove a consumed gate cannot run again. HMAC proves authenticity, not freshness; restoring a valid older snapshot can erase later claims. Require monotonic external restore authority or block all restored resumptions pending independent reconciliation. A stale-lock probe returned **409 after 2083ms**, without invoking work: correct fail-closed behavior still needs an audited recovery runbook. Never delete permanent claims or auto-retry uncertain effects.

## Most important release blockers

- **Identity/project authority (G01):** valid project IDs are partitions, not permissions. An isolated nonsecret bearer read two arbitrary project IDs successfully. That is deliberate single-operator behavior, not a current cross-tenant exploit. Before shared release, resolve membership server-side on every read/write/history/export/context request and again at effect time; OWASP recommends deny-by-default authorization on every request.[1]
- **Independent review (G02):** durable core is implemented, but default `createServer({operator})` supplies no production reviewer identity/queue policy. Browser digest acknowledgment and exact history readback cannot manufacture reviewer authority. If future resolver uses cookies, decisions need explicit CSRF/origin/session policy; the current bearer-only boundary is not diagnosed as cookie-CSRF vulnerable.[5]
- **Egress (G04):** configuration-only `validateModelBaseUrl` accepted `https://169.254.169.254/v1`, HTTPS loopback and arbitrary HTTPS origin; it denied metadata HTTP. **No network request to those targets occurred.** Browser cannot set destinations. Production model egress needs the destination policy and connection-time checked-address pinning already used in the separate resource transport. OWASP distinguishes origin allowlists and connection-time DNS enforcement.[4]
- **Supply chain (G06):** `npm audit --omit=dev --json --ignore-scripts` found **zero**, but full audit found **7 dependency entries (3 moderate, 2 high, 2 critical)**. Actual image includes Vitest 2.1.9, tinypool 1.1.1 and source-map-js 1.2.1 because Dockerfile installs dev packages. Advisory prerequisites are not established; no exposed Vitest UI or RCE is claimed. Remove unnecessary tooling, update with regressions, and audit installed image/OS layers rather than presenting omit-dev as the whole result.
- **Privacy (G09):** `captureData:false` excludes node snapshots, not run input/output or private pending approval data. Ordinary synthetic name/email/address passes safe-value validation. Field filtering is not anonymization. Retention/erase/export authority, backup confidentiality and non-replay tombstones remain required.
- **Final quality (G13/G14/G15):** no `.github` CI files found; another CI system was not queried. Parent supplied full baseline 2765 passed / three strict maps,docusign,advantage manifest-parser failures plus four node tests; this auditor did not duplicate the suite. Do not weaken parser/host checks to get green. Freeze the artifact and rerun all named criteria.

## What was actually verified

- **58 focused Vitest tests in five files passed**, zero failures, 9.91s: approval routes (18), real competing/crashed process behavior (5), OpenAI-compatible transport (31), resource security (3), real resource transport (1). Command: `./node_modules/.bin/vitest run server/__tests__/workflow-approval-process.test.ts server/__tests__/workflow-approval.test.ts packages/resources/security.test.ts packages/resources/transport.test.ts packages/providers/src/openai-compatible.test.ts --maxWorkers=2 --minWorkers=1`.
- **Four node bootstrap/secret tests passed**: `node --test deploy/studio-docker/bootstrap.test.mjs deploy/studio-docker/secrets.test.mjs`. Tests use private ephemeral scratch; no active credential reads.
- Real independent child processes returned **200/409**, upstream REST/MCP counters stayed **1**, downstream **1**. Abrupt process exit **17** after claim/CAS or after approved journal refused replay. This proves durable ordered reservation/fail-closed crash behavior, **not transactional exactly-once external effects**.
- Filtered Docker inspect: UID/GID1000, read-only image, ALL caps dropped, no-new-privileges, memory805306368, PID128, loopback8787. Active Node **v22.23.2**, image `sha256:eda86b657b175767030f7a755650b3240e793673c5304bfee465745c9ad956e1`. Source base `node:22-slim` remains mutable. Source/installed-image versions are distinguished from a final rebuilt artifact.
- Live unauthenticated workflow/model/approval/create endpoints returned **401**; public health **200 `{ "ok": true }`**. Health intentionally proves liveness, not usable model/reviewer/storage readiness. No provider probe, secret extraction or active authenticated action performed.
- Read-only builder inspection at **1280×577** and **390×844** showed no horizontal document overflow, explicit not-deployed/not-probed states and disabled unauthenticated create/check controls. Token input is password-type, initial local/session storage key arrays empty. UI workers changed layout during inspection: screenshots are observations, not final UX acceptance.
- Actual host source `/Users/te451223/project-contract/flightdeck/web/src/admin/StudioHome.tsx:4-10,153` opens a separate tab with `noopener noreferrer` and own sign-in. GET4173 succeeded. Host launch does not install Studio DAG runtime or confer host authorization.
- Companion ID/start remained `cd43c2be987bf201256a2cc10d49435a689c37c3a9105deb77d195c796236973`, `2026-10-14T09:46:56.211076293Z`; OS ID/start remained `31ed1059114fad7413ad6b42437f6845e03b75e4017496f67f9103a9f020b0df`, `2026-10-11T08:51:27.76866243Z`. No restarts/recreation/publish/container/volume/OS mutation.

## UX and criteria limits

Full editor focus/keyboard/screen-reader, mobile canvas, modal/undo/workspace retention and production-CSP preview acceptance remain blocked pending final snapshot. Parent baseline observed about152px useful canvas height at1280×577; that is parent evidence, not independently remeasured here. Check WCAG2.2 non-obscured focus (2.4.11), target minimum24×24CSSpx or applicable exception (2.5.8), and keyboard alternatives for dragging; do not claim conformance from a screenshot.[3]

Primary OWASP, Docker and normative W3C TR pages were fetched HTTP200 in safe read-only Python retrieval. The generic extract tool failed because configured backend is search-only; no settings changed. Separate W3C Understanding pages were browser-challenge-blocked in parent inspection, not claimed inspected. No installs, dependency fixes, active auth, model spend or external writes were used. Only the two audit documents are owned/modified by this worker.

## Sources

[1] https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
[2] https://docs.docker.com/compose/how-tos/production
[3] https://www.w3.org/TR/WCAG22
[4] https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
[5] https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
