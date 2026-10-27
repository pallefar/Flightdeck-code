# Studio ↔ Flightdeck OS identity contract — read-only audit

Evidence captured **2026-10-15T05:00:12.221011+00:00**, rechecked **2026-10-15T05:09:45.032963+00:00**.

## Outcome
- Reuse OS-owned identity through a host request adapter/BFF. **Do not give Studio database or service-role credentials, and do not create a second Studio account database.**
- **OS projects are not an access boundary.** The implemented authority is workspace membership; project owners are cockpit authors, not universal project members or workflow reviewers. A database connection would not add the missing authority.
- Existing host session/RBAC/directory/capability seams are real source contracts. **No OS-to-Studio authenticated session bridge or generic Studio gate/queue policy is currently wired.**
- Runtime listener, image identity and actual public launcher were verified. **Exact running backend source revision, active DB engine/schema, real sessions and memberships were not attested within the permitted read-only scope.** Do not call this deployed identity integration.

## Safety and evidence bounds
Only public repository code, Git metadata, filtered Docker metadata and unauthenticated liveness/static assets were read. No credentials, secret files, runtime environment dump, logs, OAuth/browser authentication, private directory endpoints or direct database queries. No host edits, role grants, DB migrations, service restarts or launcher changes. No host test/boot/import that might load dotenv or touch a live database. Only the requested scratch reports are written.

## 1. Which source matches the running service?
- Container `31ed1059114fad7413ad6b42437f6845e03b75e4017496f67f9103a9f020b0df` (`/wt-integration-flightdeck-1`), published on loopback port 4173; image `sha256:7907b42917fb26fdf653ffa5fdf350db5c268a4bebf2cec27507af47a21b7f2d`.
- Image built `2026-10-11T08:50:44.810272382Z`; container started `2026-10-11T08:51:27.76866243Z`. Compose working directory is `/Users/te451223/FlightDeck OS/wt-integration`. Only mount type/destination metadata was inspected, never mounted contents.
- Best source candidate: `H=/Users/te451223/FlightDeck OS/wt-integration`, HEAD `220538ca240b636c639aee8b1aaa6cb59cc8f530`. Reference: `R=/Users/te451223/project-contract`, HEAD `52a7cf7cf72d6ef6d0956e0e760fe2a06bd7d7ab`.
- All **34 distinct audited host files** are byte-identical between H and R; both tracked trees are clean. This removes relevant source-contract skew between these two checkouts.
- **Cannot prove compiled backend equality:** OCI revision label is empty; no public backend provenance endpoint was identified. The primary served index bundle is not present under either current local dist filename. Matching a few shared static chunks is not server attestation. Compose metadata and commit/build timing associate H with the deployment, but do not prove its image bytes.
- `S=/Users/te451223/Flightdeck-code`, HEAD `f80ad1f05018b8a38e720c3df59bff5ff0950cba`, has pre-existing working-tree changes. Studio anchors describe exact inspected working-tree bytes, not a claim that either companion/staging image contains them.
- Public `GET /api/health/live` returned 200 with `{"ok":true}`. `GET /console` and the public `StudioHome-3vR0dMN1.js` returned 200; the launcher chunk SHA-256 is `92e677e15e8de2a7031cbe431abc71719e15946ca72835d50b1458a783bcc904` and contains the admin metadata fetch plus `target:_blank` / `rel:noopener noreferrer` link. No configured launch URL or account information was fetched.
- The running Supabase Postgres container seen in `docker ps` is infrastructure evidence only. We did not inspect private runtime configuration, connect to it, or establish that this process selected Postgres rather than SQLite.

## 2. Existing identity/session/project interfaces
### Session and canonical principal
- Host identity is native `auth_users` + `auth_sessions`; membership/custom-role tables are instance-wide. In Postgres the identity schema is `flightdeck_landlord` behind the existing `Db` port, with workspace schemas for workspace data. The source selects PostgreSQL with its enabled flag or SQLite otherwise. This is not an external Supabase Auth/JWT contract.
- `Principal = {username, displayName, role, pending?}`. Username is normalized lower case and is the canonical account key; `displayName` is mutable and not unique. `role` is the instance role. No explicit human/service-kind field exists in the inspected account schema.
- Session cookie: `flightdeck_session=<opaque 64-hex token>; Path=/; HttpOnly; SameSite=Lax; Expires=…`; `Secure` only when the trusted request protocol is HTTPS; no Domain attribute. New-session absolute TTL is 30 days. Stored session/rotation values are `sha256:<hex>`, not the raw cookie.
- Every authenticated request resolves the session against current user state. Disabled/unknown/expired refuse; pending accounts cannot act. Logout/password reset/disable revoke sessions. Step-up rotates the token without extending expiry; role/membership changes clear strong-auth evidence and later requests reread authorization.
- Cookies are not isolated by TCP port: a different port on the same hostname is not an independent cookie security boundary. Do not copy/read the real cookie to test this; keep it at the host boundary and strip it before Studio RPC.
  Sources: `H:flightdeck/server/services/auth.ts:152-175`; `H:flightdeck/server/services/auth.ts:98-123`; `H:flightdeck/server/services/auth.ts:557-697`; `H:flightdeck/server/services/auth.ts:728-780`; `H:flightdeck/server/routes/auth.ts:163-237`; `H:flightdeck/server/services/auth.ts:497-542`.

| Existing interface | Exact integration meaning |
|---|---|
| `POST /api/auth/login` | Host verifies local username/password and sets a new session cookie; credential UI stays host-owned. Do not proxy the password into Studio. |
| `GET /api/auth/me` | Returns required, bootstrap, principal, effectiveRole, customRole, memberships, oidc.enabled. Cookie-authenticated self metadata; anonymous may have principal:null. Effective role describes resolved workspace only. Not a grant to call Studio. |
| `POST /api/auth/logout; POST /api/auth/step-up` | Logout deletes matching session/rotation lineage and clears cookie. Step-up checks the signed-in account, rotates token, preserves session expiry. Host login/OIDC routes own credential collection. |
| `GET /api/auth/users` | super_admin/people.read.users directory. Returned user records omit password hashes but contain account metadata; not a general Studio directory. Do not fetch a full roster for the bridge. |
| `GET /api/workspaces` | workspaces:[{id,label,enabled,pending}]; non-super members filtered to own memberships when enabled. super_admin discovery is not resource access. |
| `GET /api/workspaces/members; GET /api/admin/workspaces/:id/members` | Workspace-admin active-workspace roster vs global super_admin roster for named workspace. Not project membership or human attestation. |
| `GET /api/projects` | {workspaceId, defaultProjectId, projects:[...]}, server-resolved workspace. All workspace projects, not a per-project membership filter. |
| `RegisterRoutesCtx.projectDirectory?(req)` | Promise<SubAppProjectDirectory>: workspace{id,label}, selectedProjectId, project rows with app availability/links. Missing must fail closed; does not grant generic review or execution. |
| `RegisterRoutesCtx.reauthorizeRequest?(req)` | Promise<{actor:string,effectiveRole:string}|null>; refreshes request identity/workspace/project. Not an external bearer endpoint and not a Studio queue permission. |
| `RegisterRoutesCtx.capabilitiesFor(workspaceId, req)` | Promise<SubAppCapabilities>; actual request required, exact resolved workspace; writeInboxProposal returns Promise<string> and reauthorizes app consent at write time. Not a workflow run or install permission. |
| `WorkflowApprovalDependencies.resolveIdentity(request); authorize(identity,scope)` | Identity {name,active}; scope {projectId, action:list|review|decide, nodeId?, reviewer?, runId?}. Must evolve to canonical actorId and workspace/project bindings before host use. |
| `WorkflowResourceDependencies.authenticate; authorize` | Authorization callback receives actor, projectId, action:read|propose|execute. Needs per-request host identity and fresh effect-time authority, not just bearer-to-startup-operator. |
| `GET /api/admin/scope` | {authOff,instance,workspaces:[{id,label}]}; lists workspaces where this caller has admin role, with instance=true for super_admin. Not selected workspace/project or exact action authorization, and not a Studio RPC proof. |
| `GET /api/standalone/context` | {appId,workspaceId,projectId:general,mode}; fixed standalone binding metadata. os-postgres standalone mode opens Db and uses host auth code against it directly; do not adapt this by copying DSN/credentials into Studio. |

### Scope and authority rules that must not be weakened
- With workspaces enabled, global `super_admin` does **not** bypass `workspace_members`. `/api/workspaces` can list workspaces for a super-admin who still cannot access their resources. The effective workspace role and custom-feature narrowing, not `principal.role ?? …`, govern workspace actions.
- `X-Workspace-Id` / `X-Project-Id` and `fdWorkspace` / `fdProject` deep-link values select context; they are not authority. Missing/unknown selections fall back to `te-ops` / `general`; workspaces-off ignores the workspace selector. Existing-disabled selections normally 409; auth/health/project-list recovery paths have explicit exceptions. A bridge must require selectors and reject any requested/resolved mismatch.
- The source explicitly states: projects are organizing dimensions, not tenant/access boundaries; workspace members see all projects. No `project_members` table/helper was found in the tracked server/migration search. Project `owners` are allowed cockpit authors, **not** a substitute for project membership or reviewer permission.
- App authority is separate: kill switch AND workspace ceiling AND project install enablement; scopes are taken only from the workspace ceiling. SDK consent is not permission to execute arbitrary workflows, approve gates, install or publish.
  Sources: `H:flightdeck/server/lib/rbac.ts:989-1072`; `H:flightdeck/server/routes/admin/workspaces.ts:263-285`; `H:flightdeck/server/workspace/resolve.ts:94-174`; `H:flightdeck/server/project/resolve.ts:94-209`; `H:flightdeck/server/project/types.ts:1-38`; `H:flightdeck/server/routes/admin/projects.ts:153-197`; `H:flightdeck/server/subapps/installRow.ts:20-31`.

### No generic reviewer/queue contract to reuse
- OS workflow step `decision` is its own assignee-only accept/reject mechanism; the implementation explicitly says no separate reviewer is defined. PageDoc review is a different content-owner/admin-not-author policy for page revisions. Neither maps arbitrary Studio `config.reviewer` text to a human or authorizes a graph gate.
- The scoped search examined 804 tracked server TypeScript/migration SQL files. Generic review-queue text hits were CRM pointer cleanup and PageDoc inbox derivation, not a Studio queue authorization service. Absence searches are corroborating evidence, not a proof about uninspected external systems.
  Sources: `H:flightdeck/server/services/workflowStepRun.ts:989-1066`; `H:flightdeck/server/pagedoc/policy.ts:230-253`.

### Other context routes checked (not delegation substitutes)
- `GET /api/admin/scope` returns `{authOff, instance, workspaces:[{id,label}]}` for the caller’s admin scope. It is discovery, not a selected project/action proof for Studio.
- `GET /api/standalone/context` in `lib/subappStandalone.ts` returns fixed `{appId, workspaceId, projectId:general, mode}` bootstrap metadata. That builder’s `os-postgres` path calls `openDb` and registers native auth hooks itself. Reusing it by copying database credentials would violate the selected host-server/API boundary; it is not an existing session-delegation API.
  Sources: `H:flightdeck/server/routes/admin/discovery.ts:107-131`; `H:flightdeck/server/lib/subappStandalone.ts:68-145`.

## 3. Install/admin/launcher boundary — current, not proposed
- Admin Build Studio mounts `StudioHome` and reads `GET /api/admin/studio`, gated by global `super_admin` and handler capability `build.read.studio`. The server performs a bounded public-health probe and returns status/launch/app-conformance/graduation metadata. It does not supply an authenticated Studio context.
- Open Studio is a plain new-tab `noopener noreferrer` link under Studio’s own sign-in. Source contract explicitly says **never framed or proxied**. The actual served launcher chunk confirms the plain-link shape. Do not silently turn it into a proxy/SSO launcher.
- Authored `S:packages/subapp/.../studio` admission routes can check/file a bundle through the awaited host capability adapter; they neither install an app nor establish the authoring server’s identity. The inspected OS `SUBAPP_MANIFESTS` does not register this `studio` admission app; Presentation/Redact Studio are different apps.
  Sources: `H:flightdeck/web/src/admin/StudioHome.tsx:141-161`; `H:flightdeck/server/routes/admin/studio.ts:109-122`; `H:flightdeck/server/admin/capabilities.ts:303-357`; `H:flightdeck/server/services/studio/probe.ts:1-25`; `H:flightdeck/server/subapps/registry.ts:24-55`; `S:packages/subapp/src/server/subapps/studio/routes/index.ts:101-145`.

## 4. What prevents a secure drop-in connection today?
1. **Single startup operator, not request principal.** Studio composition and workspace routes still use one `operator.actor` plus bearer authentication. Merely forwarding requests through the host would attribute every person to that operator. Refactor the composition root and every sensitive route, not only `resolveIdentity`.
2. **Missing workspace dimension.** Current workflow/resource/approval paths and stores use `projectId` only. Each OS workspace can have `general`; add the canonical `(workspaceId, projectId)` namespace across stores, run/review/send bindings and browser DTOs before sharing data.
3. **Independent review is not configured by the Docker bootstrap.** Its source calls `createServer({operator})` without `workflowApprovals`. This means source-path approval access stays unavailable, not that an independent reviewer exists. We did not authenticate to either live Studio instance.
4. **Stable identity/human proof missing from review DTO.** `{name,active}` and a name blacklist are not canonical human identity or independence proof. Add trusted `actorId`/human eligibility; compare reviewerId with initiatorId, never mutable display names. Do not invent a reviewer or infer human status from a global role.
5. **Review list leakage/freshness.** The list authorizes project/action then returns all project summaries; it does not filter every gate/queue. Exact review/decision authorization is followed by more awaited store/run reads. Add per-gate filtering and a final fresh host policy/session check before private response/decision reservation.
6. **Effect-time identity is separate from app consent.** Host `reauthorizeRequest(req)` refreshes workspace/project/session/membership/role/custom-feature state. Capability `reauthorize(rt,ctx,scope)` rereads app/install/scope state, not the session, and permits changed revisions when the required scope remains. The workflow `principalAccessCheck` checks account/membership/project but not the original session/current required role. Compose the appropriate fresh checks; do not serialize or forge the WeakSet-branded context.
7. **Resource auth callback lacks live request context.** It currently receives actor/project/action. Tie it to a verified host request invocation and recheck before each effect; downstream resume keeps the original initiator’s authority, not the reviewer’s.
  Sources: `S:server/index.ts:83-126`; `S:server/index.ts:443-472`; `S:server/workflow-workspace.ts:68-145`; `S:deploy/studio-docker/bootstrap.mjs:1-20`; `S:server/workflow-approval.ts:34-116`; `S:server/workflow-approval.ts:117-140`; `S:server/workflow-approval.ts:146-190`; `S:server/workflow-resources.ts:6-69`; `S:packages/guardrails/src/approval-pure.ts:58-88`; `H:flightdeck/server/services/auth.ts:152-175`; `H:flightdeck/server/app.ts:1536-1587`; `H:flightdeck/server/subapps/capabilityContext.ts:121-205`; `H:flightdeck/server/routes/workflowRun.ts:93-155`.

## 5. Smallest secure bridge — proposed only
No existing external “ask host for authenticated exact scope” endpoint can be plugged into Studio today. Reuse the actual host request resolver/RBAC/SDK internally; add a narrow host adapter rather than a separate SSO/account system.

### 1. Off-by-default host identity adapter and exact-scope DTO; no live cutover
Add a narrowly allowlisted host Studio BFF in the chosen OS source. Reuse host cookie/session/RBAC and actual registry objects. Require AUTH_REQUIRED and approved workspace mode. Require explicit workspaceId+projectId, resolve both without accepting substitution, and check current workspace membership/custom feature/action policy. Response contains stable username actorId plus display label, exact tuple and explicit permitted actions/policy revision; no cookies, tokens, DB handles or full directory.

**Test gate:** Anonymous, pending, disabled, non-member, global-only super_admin, unknown/disabled workspace/project, absent selector and requested/resolved mismatch all deny before Studio data/model work. Source tests use private scratch synthetic fixtures only; never boot against real Postgres or dotenv.

### 2. Host-only authenticated private RPC into separately hosted Studio; same-origin UI option for approval
Preferred smallest browser seam is a new-tab Studio UI at a host-owned same-origin path, with browser API calls to a fixed host BFF prefix. Backend stays separately hosted/private. This deliberately changes the current never-proxy/separate-auth boundary and requires explicit approval; until then leave launcher and existing sign-in untouched. Host strips browser Authorization, Cookie and actor/scope-proof headers before RPC, uses dedicated server-to-server authentication (not DB/service-role keys), and supplies a request-scoped opaque invocation handle bound to actor/workspace/project/action/canonical method/path/body digest/revisions/expiry. Browser never receives an internal authorization proof. No generic URL proxy.

**Test gate:** Direct client access to RPC, forged actor/role/scope headers, different body/method/path, foreign audience, replayed/expired handle and arbitrary upstream URL all deny. No OS session cookie or Studio operator token appears in Studio browser storage/URLs or upstream transport.

### 3. Per-request Studio actor and workspace/project storage namespace; draft-only initial use
Replace startup-global actor at HTTP route composition, not only reviewer callback. Scope private stores, graph/run/approval/resource keys, grants, model selection and reviewed sends by canonical workspace/project plus stable actorId where appropriate. Retain displayName only for display. Browser transport uses host same-origin session/CSRF, not copied operator bearer. Start with identity/directory and authorized draft read/write only; keep model credential setup, live sends, resource activation/execution, installs/publication and human approvals closed until separate exact policies exist.

**Test gate:** Two workspaces each containing general cannot read/update the other records; same displayName on different accounts cannot break independence; displayName changes do not create a new principal. Requests cannot fall back from one actor/scope to the startup operator.

### 4. Optional independent review/effects only after host-owned explicit grants
Use current OS accounts and membership, plus a small host-owned deny-default Studio action/queue policy if project-specific Studio powers are desired. This is an action grant, not a claim that existing OS project membership exists. Store policy in the existing OS authority domain after migration/config approval, not a separate Studio user DB. Bind review to exact workspace/project/run/pending-node/queue/context digest/revision and canonical reviewerId != initiatorId; verify human eligibility from approved host-owned policy, not a display name or graph reviewer field. Filter list summaries per gate before disclosure. Fresh host callback must recheck original invocation session, account, current role/membership, enabled workspace/project, action/queue policy and app consent immediately before sensitive response/CAS/effect; recheck the original initiator authority for resumed downstream effects, never substitute reviewer authority. Expired/detached invocations fail closed; no automatic continuation grant.

**Test gate:** Revoke/logout/disable/demote/remove membership/disable project/change policy or consent during each awaited operation: no private response, decision CAS, model/socket call or downstream replay. Reviewer can neither self-review nor gain authority from queue text; duplicate decisions remain governed by existing permanent claim/run CAS, not proof replay.

### Origin, CSRF and proxy requirements
- Verified local OS origin is `http://127.0.0.1:4173`; no canonical production HTTPS origin was established. Configure the exact scheme/host/port explicitly before exposure. Production TLS/proxy/cookie posture cannot be inferred from the source defaults.
- Existing HostGuard validates raw Host hostname and permits any port. Existing apiLoadGuard accepts fetch `empty` or absent destination and is **not a complete Origin/CSRF check**. SameSite=Lax does not isolate same-site sibling origins/ports. The published-media CORS feature is unrelated to authenticated Studio.
- For the new browser BFF: exact pinned Origin (reject hostile/null/missing on mutations), host-session-bound CSRF custom header plus JSON, Fetch Metadata defense where available, explicit method/path/size allowlists and no credentialed wildcard CORS. Keep non-browser RPC on a separately authenticated private path.
- Trust only actual reverse-proxy hops, overwrite client-supplied forwarded headers, preserve canonical Host/protocol for cookie Secure/origin checks, and strip Cookie/Authorization/browser actor/proof headers on upstream Studio calls. Never forward DB/service-role keys or credentials. Existing source default `trustProxy=loopback,linklocal,uniquelocal` is not verified deployment configuration.
- Browser `GET /api/auth/me` is a UI bootstrap only. A browser-reported principal/effectiveRole or cached result must never be the Studio authorizer. The private backend asks the host through a request-bound invocation/fresh effect callback; missing/expired authority denies.
  Sources: `H:flightdeck/server/lib/hostGuard.ts:14-38`; `H:flightdeck/server/lib/apiLoadGuard.ts:230-251`; `H:flightdeck/server/config.ts:18-52`; `H:flightdeck/server/app.ts:328-424`; `H:flightdeck/server/routes/auth.ts:163-237`; `H:flightdeck/server/subapps/types.ts:429-457`.

## 6. Minimal remaining user decisions
- **Approve the browser boundary change?** Keep a separate tab, but approve a host-origin BFF/static Studio path with private backend; current launcher explicitly does not proxy. Until approved, leave it unchanged. Until decided: No shared-session cutover.
- **Which exact existing host identities may author/review which scope/actions?** Reuse existing OS workspace membership semantics for discovery; require explicit host-owned Studio action grants for any narrower project/action/queue permissions. Choose real account IDs and a human-review policy through the host admin process; no invented reviewer and no automatic global-role/owner mapping. Until decided: No grants, no independent review or live effects. If true universal per-project membership is required, that is a separate OS access-model change, not a DB connection setting.

## Implementation decision — October 15, 2026

The user explicitly approved: **“Approve the opt-in bridge; keep it disabled.”** This authorizes implementation of an opt-in host-authenticated bridge for existing OS identities, not a live cutover, database credential sharing, or automatic author/reviewer/execution grants. Existing host source, launcher and active services remain unchanged during the isolated implementation and validation tranche. Final mounting, namespace migration, real policy configuration and any deployment are separate acceptance decisions.

## 7. Acceptance tests for future implementation — NOT executed in this audit
- Host identification: release image supplies immutable source revision/provenance and digest; compare the backend artifact before deployment. Public JS matching alone is insufficient.
- Authentication-first: valid, anonymous, expired, rotated/revoked session; disabled/pending user; forged browser actor/role/Authorization; no DB/provider/network effects on refusal.
- Exact scope: missing/unknown/default-substituted selector, disabled workspace/project, workspaces-off cross-scope attempt, registry failure; resolved tuple must equal requested tuple.
- Authority matrix: global super_admin without membership, ordinary workspace role and narrowed custom role; no implicit project-owner/reviewer privileges.
- Isolation: two workspaces/general, duplicate display names and renamed display name; all store/readback/review/send bindings preserve stable actorId and workspaceId.
- BFF/proxy: configured canonical origin and port, HTTPS cookie Secure through only trusted proxy, hostile/null/missing Origin, CSRF missing/mismatch, sibling-port origin, forwarded-host/proto spoof, no credentialed wildcard CORS.
- RPC: authenticate server peer, audience/method/path/body/revision binding, bounded TTL/nonce, replay denial, strip browser credentials, disallow arbitrary destinations/redirects and direct backend bypass.
- Revocation barriers: pause after every await before private data return, durable write/decision reservation/model call/resource socket; mutate only synthetic authority; verify fresh deny and zero new effect counters.
- Reviews remain 503/unavailable without real provider/policy; project-list permission does not expose unauthorized gate metadata; reviewerId != initiatorId and exact pending gate authority are mandatory.
- No host launcher change until approved; test real new launch path plus exact record GET readback in isolated staging before any deliberate cutover. No private DB smoke in this audit.

## 8. What was actually verified
- 115 hashed source ranges collected; 34 distinct host files compared across H/R, all equal. Each source-range hash covers exact bytes including line terminators; complete file SHA-256 and Git blob IDs are in the JSON.
- Final source recheck: 76 distinct files, no hash drift; both host tracked trees clean. Running OS container ID, image ID and start time unchanged from the first snapshot.
- Public liveness, console HTML, selected assets and actual launcher chunk read without credentials. Auth endpoints, membership/project data, readiness/database probes and model calls were not invoked.
- No tests requiring a host process, DB, secret environment or user session were run. Future acceptance tests above are not reported as passing. No host changes are claimed.

- A concurrent edit to `S:server/index.ts` was detected during the final audit extension. Its operator/composition declarations were reread and rehashed; the added Anthropic setup option did not change the identity findings. Host sources remained unchanged. The final no-drift check is against these recaptured bytes.

## Source anchors and machine-readable evidence
Full findings, interfaces, source/runtime metadata, absence-search scope, acceptance plan, and **all full SHA-256 file/range anchors** are preserved in `docs/evidence/next-ui/host-identity-source-audit.json`. H/R anchors are relative to the roots above; S anchors describe working-tree source, not deployed code.

Parent independently reread the identity, membership, project and launcher contracts and rechecked all **115 source-range hashes / 76 distinct files** plus **34 H/R file pairs**. All matched at readback; `docs/evidence/next-ui/host-identity-parent-check.json` records the actual check. This still does not attest the running backend revision, current sessions/database, or an implemented bridge.

| Key host contract source | H/R full-file SHA-256 (identical) |
|---|---|
| `Dockerfile` | `4e83f4ea3b75a731ce4c32636a520bb381a9804c474c154d5858bcafcfab7e88` |
| `flightdeck/server/admin/capabilities.ts` | `cd8210682f2d050af7e57333f54d57da0a90978264a486eab26c9dec2fb19ce0` |
| `flightdeck/server/app.ts` | `36fe743ed252ade1be2d385b18eb90c27a9190106fea2c3e043ccbf6aed29dcc` |
| `flightdeck/server/config.ts` | `a98e8482cbe5b6f5bf4b1729bbc9a7e30c57bd91fe8502f462723e8fe2b0986e` |
| `flightdeck/server/db.ts` | `8486302d165ff7f80ca5d3961e9b0e60501d4cd27524cdfb899f08f55777bcf7` |
| `flightdeck/server/dbPostgres.ts` | `d61d43649c55a59489a9f438c0059ced36e50c32b7d0981f98f24dbc7f209a3d` |
| `flightdeck/server/lib/apiLoadGuard.ts` | `68276c2337e97bec36d38f2cfe03b3255e07817ce1d835be37bdce250cfcc95e` |
| `flightdeck/server/lib/consoleReturnPath.ts` | `9807926d3d3e8498d51c91fe5923d6a71835da58608aa5480857c3245dd6747d` |
| `flightdeck/server/lib/hostGuard.ts` | `0972460bd6d80b2375b43a61a4c7a52b38a9d4146d1da30fb78a9817524129fe` |
| `flightdeck/server/lib/rbac.ts` | `d4c6d6f35c84ea43a478d9647c5e6f262e05b5b928d79bff14ab87d9c10cf345` |
| `flightdeck/server/lib/subappProjectDirectory.ts` | `c009e6cb19b5c58189f9adac053ad2d2dff819d3901991ebce3b429ea8024380` |
| `flightdeck/server/pagedoc/policy.ts` | `65b006e14958edc1e3d0802cd66edd2ec7c5cb14b49fd9d762641880df5c256b` |
| `flightdeck/server/project/resolve.ts` | `211b9d840b6b613f711d4fc463dc7470216cc84a19220ad27d4211f95022cc00` |
| `flightdeck/server/project/types.ts` | `74b4a0ca02123ccbf57ae75e9154f4038517659c5db6b4a6b63bef9e97869765` |
| `flightdeck/server/routes/admin/membership.ts` | `9d5a972b2c719a525ed378a98ac5ebce7594229c1c6a6914a91f713fe03a7cc5` |
| `flightdeck/server/routes/admin/projects.ts` | `ba5fa11d53adad1a716a2d5c23f91c0b0f33d1ef74baf6ed07b283fca5f0757c` |
| `flightdeck/server/routes/admin/studio.ts` | `2a21bb433eb9c6e4799f9359d251521ac47605e78b15218b74972e4ed6950ee6` |
| `flightdeck/server/routes/admin/workspaces.ts` | `0691ed6ae770f52d6731a7d72f654dbca799c68c5af703bdcbc63432f7355179` |
| `flightdeck/server/routes/auth.ts` | `021cac5f805395f7a13a130b36b6c4fccfd974c03c090d853b9a4d280e50366b` |
| `flightdeck/server/routes/workflowRun.ts` | `9b99dd844dfacee8875929ff2c8f920ae1320960c747b4ed851a58004a787660` |
| `flightdeck/server/services/auth.ts` | `e5dcbe3f3ec0c92d7fcbf4ce699b90ab3e4eb8c3ecb534424bf92e1642d8b6cb` |
| `flightdeck/server/services/studio/probe.ts` | `453d8eaefabbb81a7a96907580d987e7579f1d4ce0132d2599534db189b44668` |
| `flightdeck/server/services/workflowStepRun.ts` | `155bfc0dd94aa96a1fc3bf9a6b2b7fee8d9d34beda7d977c91ec49b7348cd69c` |
| `flightdeck/server/subapps/capabilities.ts` | `7f46d1f7724f62b7ed1b2229af14db80a2dc4a4a22ddd40fe512a52921ab8789` |
| `flightdeck/server/subapps/capabilityContext.ts` | `04eefe0778a6b2679004e5f1a4943140289f62c1d265e01ff69d4365a48bd2cf` |
| `flightdeck/server/subapps/installRow.ts` | `4cd999e47020473f6287c248355131f3405c3057817c19beeb9057437375fad3` |
| `flightdeck/server/subapps/registry.ts` | `a8b5f772d0560c73885e7d54dadf64d3bd992540cee0e6141d4aeb82b6d50a7a` |
| `flightdeck/server/subapps/types.ts` | `ff88f1bf51ed2d7b97d7ac700066ff429a16ea6c98f8a42cfd3afad84a1c870d` |
| `flightdeck/server/workspace/resolve.ts` | `bb91623962bab592ce192c012660a256b0e3c38adb83a2ef57b659c945a8ad83` |
| `flightdeck/web/src/admin/StudioHome.tsx` | `22f3cac2f5d55db801470f40d1592a651ddbb808d87f547dd217cbf12c54a8b0` |
| `flightdeck/web/src/admin/adminRoutes.tsx` | `83dd3f8efa254ab63d68daefdd2f837779fe860d44d39135d971602924fb31c8` |
| `flightdeck/web/src/subappApi.ts` | `fc20ff1dc82db94cac0a78d4cc136caaa731dbf56c32be22fbf68a8e27e50d7d` |
| `flightdeck/server/lib/subappStandalone.ts` | `042ff93ad0ad62e257c13348c38e500961e18b53d36cccf00f8cf578ebe6c8a2` |
| `flightdeck/server/routes/admin/discovery.ts` | `84054ea6c6d220e90e7c5cf16341664e3fd59eccac8e6b54f685f96b75637f63` |
