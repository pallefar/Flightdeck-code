# Private Anthropic server-memory setup

## Delivered scope

`server/anthropic-session-setup.ts` exports:

```ts
createAnthropicSessionSetup(options: AnthropicSessionSetupOptions): AnthropicSessionSetup
// options: { baseRegistry, authenticate, enabled?: boolean, env?, anthropicClient? }
// result:  { registry: ModelConnectionRegistry, register(app): void, close(): void }
```

`createServer` now integrates this module and the masked UI behind trusted opt-in; see `studio-anthropic-setup-integration.md` for actual root wiring and baseline evidence. The module does not mount itself, and source integration does not enable or deploy it. Flightdeck OS identity, final combined release and real vendor acceptance remain separate. No vendor request or account verification is performed during construction, GET, POST, DELETE, listing or resolution.

`enabled` must be the boolean `true` from trusted server configuration. Otherwise `register` adds no routes (404), `registry` is the **exact original base object**, and `close` is a no-op. No production capability is widened by importing the module.

For enabled setup, pass the existing named-operator bearer predicate as the synchronous `authenticate(header)` function. Do not create another token/identity authority, derive identity from a browser label, or obtain database credentials here. A thrown predicate is an authentication failure. Supply the immutable server model configuration snapshot, never browser model/policy fields. With no snapshot, only the named model/effort settings are read from the server environment.

Module-level integration sketch (the actual opted-in wiring is in `server/index.ts`):

```ts
const setup = createAnthropicSessionSetup({
  baseRegistry,
  authenticate: header => presentsOperatorToken(header, operator.token),
  enabled: privateSetupOptIn === true,
  env: trustedModelConfig,
});
setup.register(app);
// Use setup.registry, not a spread/copy: descriptors must remain live.
// Resolve once per model request and retain that exact connection/client.
app.addHook('preClose', async () => { setup.close(); });
```

Invalidate setup before shutdown drain; continue tracking actual provider promise settlement with the shared request-admission owner. `close` is synchronous/idempotent, clears owned client references and invalidates old closures. It does not claim to cancel or drain external work itself.

## HTTP contract

All routes use the exact path `/api/studio/model-connections/anthropic/setup`:

| Method | Strict JSON request | Successful response |
| --- | --- | --- |
| GET | none | metadata below |
| POST | `{ "apiKey": string, "expectedRevision": string }` | metadata below |
| DELETE | `{ "expectedRevision": string }` | metadata below |

Success has **exactly five fields**, no optional verification field. Management and persistence form a strict discriminated union:

```ts
type Metadata = {
  model: string;
  status: 'configured' | 'unavailable';
  revision: string;
} & (
  | { available: true; persistence: 'server-memory' }
  | { available: false; persistence: 'external' }
);
```

`available` describes whether this dialog manages the connection, not whether a model is usable. An already-configured base connection returns `available:false` and `persistence:'external'`; its retention, restart, storage and destination policies are outside this session manager. Do not apply session-memory or restart-loss promises to external credentials. GET may report either variant; a successful mutation must return the owned `server-memory` variant and a new revision.

`configured` means constructed/configured, **not probed**, accepted by the vendor, or billed. No key, key hash, endpoint, private target binding or custom-origin policy is returned. Every handled response uses `Cache-Control: no-store`. There are no redirects or CORS allowances.

- Authenticate in `onRequest`, before origin, content-type, malformed JSON and oversized-body handling. Unauthenticated malformed/oversized POST/DELETE returns the same 401 as other unauthorized requests.
- Host must be canonical `localhost`, `127.0.0.1`, or `[::1]`, optionally a canonical port 1–65535. It is a constraint, **not authentication**.
- `Origin: null`, cross-origin, malformed/noncanonical Origin and non-loopback Host fail closed. Origin must exactly equal the canonical HTTP(S) origin formed from that Host and the socket's encryption flag, including effective port. This is **not** a check of the actual listening/peer address or proof that ingress is private. Ignore all forwarded host/protocol headers, even when Fastify trusts proxies. Authenticated no-Origin CLI requests are permitted. The trusted listener, loopback publication, TLS and reverse-proxy policy must independently enforce the private transport boundary; an operator-authenticated non-browser caller can supply its own Host.
- Mutation media type is `application/json` (optionally `charset=utf-8`), with native body limit 65,536 bytes. Unknown object keys, missing fields, wrong types and non-object roots are rejected. Revision is an unmodified lowercase UUID-shaped 36-character string.
- Keys are 1–8,192 JavaScript string code units, non-whitespace-only, without C0/C1 controls or Unicode line/paragraph separators. The accepted value is retained exactly; no trimming/repair occurs. Construction does not establish that a key is usable by the vendor.
- CAS validation, replacement construction, random epoch generation and commit have no network await. Exactly one mutation with a given revision can win; failure does not advance revision or destroy the current configuration. No automatic CAS retry exists.

Fixed error DTOs are `{error: string}` only: 401 `operator token required`; 403 `private same-origin setup required`, `Anthropic connection is externally managed`, or `setup configuration unavailable`; 400 `malformed setup request`; 413 `setup request too large`; 415 `setup JSON required`; 409 only `setup revision conflict`; closed setup returns 503 `setup unavailable`, and unexpected route errors return 500 with that same safe category. The browser distinguishes 401 authentication, 403 refusal and 409 stale-CAS categories without exposing raw error bodies or retrying. No native parser/provider message, input, cause or stack is serialized. Setup routes have silent framework logging and discard the parsed request body reference after schema parsing; deployment-wide middleware/proxies must also avoid request/body/header logging.

## Registry, provider and rotation boundaries

- The facade keeps the four base descriptor IDs and every other provider's descriptor/resolved connection unchanged. Its descriptor getter is live. `selectedId` remains the base selection; POST never selects Anthropic. `resolveSelected` uses the unchanged base selection and the facade's own resolution.
- An already-configured base Anthropic connection is externally managed: well-formed POST **and** DELETE refuse with 403 before CAS comparison, preserving its exact connection, selection and revision even for an outdated valid UUID. Metadata uses that connection's actual model and explicitly reports external, read-only management. The module does not remove or close externally owned clients.
- For an unconfigured base, model precedence is exactly `STUDIO_ANTHROPIC_MODEL ?? FLIGHTDECK_MODEL ?? DEFAULT_MODEL`; effort is `FLIGHTDECK_EFFORT ?? 'high'`. No trim, repair, browser override or model fallback occurs. Invalid trusted model/effort throws the fixed construction error `Invalid Anthropic session setup configuration` before routes are registered.
- Production constructs the installed official SDK client with explicit key, null auth token/webhook key, official `https://api.anthropic.com`, zero retries, 30,000ms timeout, redirect-error fetch and logging **off**. It passes that client and an explicit sanitized model/effort/key environment to existing `createModelConnections`, retaining the existing Anthropic provider/planner/output boundaries rather than reimplementing them. `anthropicClient` is only a trusted deterministic-test seam, never an HTTP field.
- Inspection of installed SDK 0.127.0 found that its default logger can inherit `ANTHROPIC_LOG`, and its constructor unconditionally merges `ANTHROPIC_CUSTOM_HEADERS`. Therefore logging is explicitly disabled, and production provisioning refuses when the latter environment setting exists (even empty), without reading/returning its value. No global environment mutation is used. The fixture-only injected-client seam does not construct that SDK client.
- Each accepted key, including the same key again, gets a fresh random **non-secret** private binding epoch. Old closures cannot perform another send. Results from already-sent work are rejected after actual settlement if their epoch is stale. Rotation/removal/close never substitutes an early abort race for the underlying promise: admission capacity remains occupied until that work actually settles. An already-sent request cannot be unsent; remote effect/cost may already have occurred. No hidden retry is added.
- DELETE removes the owned connection and marks Anthropic unavailable without selecting another provider or falling back to environment credentials. Closed setup cannot be repopulated by a body that finishes parsing after shutdown.

## Storage/privacy limits

Only keys provisioned through this module live solely in its process memory/SDK instances, scoped to this process's authenticated operator. This module performs no file/database/browser storage, environment assignment, credential-file lookup, vault claim or persistence across restart. External credentials are not owned here; their persistence and restart policy must be checked at their source. Rotation drops owned references; in-flight work necessarily retains its original client through settlement. JavaScript/SDK memory cannot promise immediate zeroization or protection against process/heap inspection. This is **not an encrypted vault**. HTTPS/private origin, bearer handling, global log controls and process protection remain deployment obligations.

## Actual RED/GREEN evidence

The feature was implemented as end-to-end vertical slices, running the focused Vitest file at every step. Observed REDs, followed by GREEN:

1. Missing setup module; disabled route/base-identity behavior green (1 test).
2. Authenticated metadata returned 404 instead of 401; metadata green (2).
3. Provisioning POST absent (404 instead of 200); CAS/facade provisioning green (3).
4. DELETE absent (404 instead of 409); removal green (4).
5. Cross-origin GET incorrectly accepted (200 instead of 403); origin boundary green (5).
6. Native JSON errors returned framework DTO rather than fixed private category; strict intake green (6).
7. Old closures still sent/returned after POST, DELETE and close (3 failures); epoch/accounting green (9).
8. Externally managed metadata reported the unrelated snapshot model; read-only external ownership green (10).
9. Real installed SDK policy had logging `warn`, not `off`; fixed SDK policy green (11).
10. A slow authenticated socket body repopulated closed setup (200 instead of 503); effect-time close guard green (12).
11. Four invalid trusted model/effort cases failed to throw; fail-closed configuration green (16).
12. Isolated ambient custom-header process accepted provisioning (200 instead of 409); guard green (17).

13. Closing in an asynchronous pre-handler still returned successful metadata (200 instead of 503); metadata close recheck green (21 tests, including the supplementary regressions below).

Additional regression expansion exercises twelve competing HTTP POSTs and twelve competing DELETEs (one winner each), throwing SDK-detail suppression/no retry, boundary-length/exact keys and throwing authentication. Actual loopback HTTP, native parser/oversize errors, raw slow sockets, existing admission and installed SDK with a synthetic fetch transport are exercised. All keys/tokens/data are explicitly development fixtures. There are no live provider calls.

Re-run focused verification:

```sh
npx vitest run server/__tests__/anthropic-session-setup.test.ts server/model-connections.test.ts server/__tests__/request-admission.test.ts server/__tests__/request-admission-composition.test.ts server/__tests__/model-route-integration.test.ts server/__tests__/model-destination-review.test.ts --maxWorkers=1
npm run typecheck
```

Observed result: **6 files, 76 tests passed**, including **21 setup tests**. Full-project typecheck exited 0 earlier; later shared-worktree runs were blocked by concurrent, out-of-scope workflow edits (`src/workflow/store.ts` missing `FragmentReviewState.revision`, then an incomplete `src/workflow/storefragment.test.ts`). Neither file was edited by this worker. A scoped TypeScript check of the new module/test with the project's strict compiler flags exited 0:

```sh
npx tsc --noEmit --target ES2022 --lib ES2022,DOM,DOM.Iterable --module ESNext --moduleResolution bundler --jsx react-jsx --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --skipLibCheck --resolveJsonModule --esModuleInterop --allowImportingTsExtensions --verbatimModuleSyntax server/anthropic-session-setup.ts server/__tests__/anthropic-session-setup.test.ts
```

No full-suite, Docker, restart, deployment, live Anthropic or host-identity integration claim is made by this deliverable.

## Independent review and current remediation

The original independent combined review and exact 34-file manifest are archived unchanged under `docs/evidence/next-ui/anthropic-setup-independent/`. It demonstrated no high-severity exploit in the inspected session-owned path, but found misleading external-key ownership/persistence UI and an adjacent composer/review ambiguity. The original review predates the fixes; its hash check explicitly identifies changed files rather than treating it as approval of the new snapshot.

Parent observed a real-root/client HTTP RED on external metadata (`available:true/server-memory` instead of `false/external`) and repaired the strict five-field contract, permanent-refusal classification and no-retry behavior. Exact GET readbacks retained the external connection, revision and selection with zero SDK calls. Two deliberately inconsistent 200 mutation responses then exposed acceptance of read-only external metadata; both now fail closed. The isolated ambient-header regression also observed 409 instead of 403 and is repaired without global environment changes. The earlier 409 observations above are historical checkpoints, not the current permanent-refusal contract.

Native external-key UI and composer-review remediation, final combined verification and a scoped independent recheck remain separate before enablement. Nothing in this remediation deploys setup or supplies a real key.
