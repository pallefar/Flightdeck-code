# Process lifecycle readiness

## Scope

`GET /api/studio/ready` reports only whether the process-local request-admission controller is accepting new work. It is not a claim that a model, reviewer, identity provider, resource, recovery system or Flightdeck host is configured, authorized or reachable. A no-model private authoring process can be lifecycle-ready while every live-model request remains refused.

The public response is deliberately fixed and nonsecret:

- Accepting: HTTP 200, `Cache-Control: no-store`, `{"ready":true,"scope":"request-admission"}`.
- Admission stopped: HTTP 503, `Cache-Control: no-store`, `Retry-After: 1`, `{"ready":false,"scope":"request-admission"}`.
- HEAD uses the same status/headers with no response body.

No provider is resolved or probed, no descriptors/keys/destinations are read, no queues/counts/scopes are exposed, and no durable state or resource is read or written. Existing public `/api/studio/health` remains the exact `{ok:true}` liveness contract.

## Shutdown behavior

The actual `createServer` registers readiness against the same admission instance used by expensive routes. Its existing preClose/onClose hooks stop admission and drain original tracked work. Full capacity alone does not signal unready: requests are refused through the existing 429 zero-queue policy. Once stopped, late settlement cannot reopen admission. Hung ignored-abort work retains its permit and bounded drain fails rather than freeing/retrying it.

Fastify can itself reject new socket requests with 503 once closing starts, before dispatching this route. After the listener is closed the endpoint is unreachable, also not ready. This addition does not keep the listener open or promise an observable readiness interval during every shutdown. Existing bootstrap still needs a separately reviewed production supervisor/exit policy for drain failure.

## Executed verification

Strict TDD first observed a real composition-root 404 instead of 200. After initial route wiring, the stopped-admission regression observed 200 instead of 503. Both were corrected without changing the admission ledger or its limits.

```sh
npx vitest run server/__tests__/readiness.test.ts \
  server/__tests__/request-admission.test.ts \
  server/__tests__/request-admission-composition.test.ts --maxWorkers=2
npm run typecheck
npm run build
git diff --check
```

15 tests / 3 files passed. New readiness cases exercise a throwing descriptor/provider registry (zero accesses), actual loopback HTTP GET and HEAD, hung original work, drain refusal and permanent stopped state after late settlement. Typecheck/build/diff passed; the existing 709.98 kB frontend chunk advisory is unchanged.

Files: `server/readiness.ts`, `server/__tests__/readiness.test.ts`, and two composition-root registration lines in `server/index.ts`.

This is verified source engineering, not a staging deployment. Current staging remains the separately accepted Command/Inspect image until a later combined release passes its gates. This slice does not close production G11 on its own, and does not change recovery/startup quarantine, external monotonic authority, distributed admission or financial budgets.
