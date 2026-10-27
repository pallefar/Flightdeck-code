# Freshness-bound native model capability

## Server API

`ResolvedModelConnection` preserves `descriptor`, `bindingId`, and the existing JSON `llm`. It now optionally has:

```ts
interface NativeAuthoringCapability {
  readonly kind: 'anthropic-messages-v1';
  assertCurrent(): void;
  createPort(broker: DraftBroker, system: string): NativeModelPort;
}
type NativeModelPort = ReturnType<typeof createAnthropicToolPort>;
```

The frozen capability contains no SDK/client property. Browser descriptors and session-setup HTTP metadata have not acquired native capability, credential, destination, or binding fields. Local, Flightdeck, and unavailable Codex connections do not acquire a native capability. An incompatible trusted injected Anthropic SDK retains the existing JSON connection, but its native capability is absent: absence is not permission to fall back to another model.

`createPort` uses the exact original SDK client, selected model and effort through the installed harness port. It admits only the original broker's `modelId` **and** `modelBindingId`, using the harness's private run association rather than caller-controlled structural broker fields. Session rebinding keeps this exact check against the resolved **session** binding, without cloning the SDK, substituting a newer connection, or changing the broker's authority tuple. The extra exported `rebindNativeAuthoring` helper is server-only; its WeakMap accepts only capabilities issued by this module and never exposes the client.

## Composition-root requirements

The parent runner still owns authentication, exact-context disclosure/review, the broker's finite authority tuple and independent policy, request-wide admission/budgets, and sanitized response mapping. The capability is a model operation, not a runner or authority grant.

1. Resolve once and retain the exact resolved connection and capability.
2. Use `descriptor.model` and `bindingId` as the broker's `modelId` and `modelBindingId` respectively. Preserve the original actor/workspace/project/context/policy bindings too.
3. Call `nativeAuthoring.assertCurrent()` both **before and after every awaited independent broker authorization**, including the `before`, `after`, and `return` stages. This is essential for refusing a send after a credential replacement during an asynchronous pre-send policy wait. A check only before `complete()` cannot substitute for this root policy boundary.
4. Create the port with that broker and the reviewed server system prompt, then call `complete(turn, permit.signal)` while tracking the original operation. Drain the broker and original work before releasing admission. Do not wrap cancellation with an early-settling `Promise.race`.
5. Do not re-resolve credentials mid-operation. A new registry/credential instance has a new review binding and requires a fresh operation/review, not automatic rebinding.

## Freshness and admission

- Every rebuilt base Anthropic resolved connection gets a random nonsecret epoch in its hashed review identity, even when the same SDK/key is reused. Local destination-policy identity remains deterministic and unchanged.
- Every accepted session POST, including the same key, gets a fresh session identity. DELETE and close revoke the original state. Old `assertCurrent`, port creation and new completions fail; an already-running completion remains pending until its **original SDK/broker promise settles**, then rejects the stale result. No replacement credential receives that old request.
- Native checks run before port creation and completion and in `finally` after completion settlement, for both success and failure. Observed SDK credential/configuration drift permanently invalidates that capability, even if the public client fields are subsequently restored.
- Installed-SDK admission requires diagnostics off, no client middleware, no reserved `fetchOptions` body/method/headers/signal overrides (including own properties with undefined values), the original Anthropic origin, and no custom SDK default headers/query. It snapshots original credential fields and the Messages resource/method and rechecks them through `assertCurrent`. This is trusted-client configuration admission, **not** confinement of malicious injected code.
- Base client construction explicitly supplies API key/auth token/null webhook key, original hardcoded origin, zero retries, 30-second timeout, diagnostics off and redirect-error fetch policy. It rejects ambient `ANTHROPIC_CUSTOM_HEADERS` before construction, even if empty. Session construction retains its existing equivalent guard and explicit settings. No new credential discovery was added.
- Native request/response bounds, protocol validation, usage accounting, signed block preservation, and underlying transport settlement remain the trusted harness port's responsibility. This change does not duplicate/relax its response validator.

## Verification

Evidence: `docs/evidence/native-model-capability-20261016/`.

- Nine ordered vertical RED→GREEN slices are retained as real Vitest JSON reports: native port, rebuilt base epoch, exact broker binding, session invalidation/settlement, base SDK policy, ambient header refusal, injected-client admission, runtime freshness across policy waits, and irreversible observed-drift refusal.
- Final focused execution: **158 physical assertion records passed in seven files**, including **30** new native capability cases, **31** model-connection cases, existing setup/composition/review/route compatibility, and **39** trusted native-port cases. These are not added to repeated intermediate runs.
- New completions use the actual installed `@anthropic-ai/sdk` **0.127.0** with fake fetch. Session same-key replacement, DELETE and close use real owned loopback HTTP and real `RequestAdmission`, proving occupied capacity and broker pending work until deferred SDK fetch settlement. No live provider calls were made.
- Isolated children test ambient SDK diagnostics/headers without modifying the parent `process.env`; valid JSON and native paths both execute through the base SDK fake transport with explicit policy pinned.
- Scoped compilation of both owned production modules and the new test, with the existing project compiler options, has zero diagnostics. Whole-project `npm run typecheck` is currently blocked by the concurrently authored `packages/authoring-harness/src/subapp-broker.ts:40` passing sub-app action names outside `Action`. That file is outside this worker's ownership and was not edited. See `typecheck.json`; scoped compilation is not a claim that the full project passes.
- The first session GREEN attempt exposed a fixture reusing an already-consumed `Response` on its second send. The report is preserved; the fixture now returns a fresh response for subsequent sends and the unchanged production path passes.

Only `server/model-connections.ts`, `server/anthropic-session-setup.ts`, `server/model-connections.test.ts`, the new `server/__tests__/native-model-capability.test.ts`, and this worker's documentation/evidence were changed. No root runner, pipeline, harness, UI, deployment, credentials, installs, commits or shared services were changed. Native runner mounting and root integration remain the parent worker's responsibility.
