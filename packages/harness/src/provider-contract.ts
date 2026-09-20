/** The seam this harness wraps.
 *
 * `packages/providers` owns the real provider interface and is written by
 * somebody else, concurrently. So the constraint here is deliberately the
 * loosest thing that still lets a request be keyed: **a request is anything
 * with a `model: string`**. TypeScript is structural, so every provider request
 * type that carries a model satisfies `ProviderCallShape` without importing
 * anything from this package, and this package never has to be edited when
 * theirs gains a field.
 *
 * ⛔ THE TRAP THAT COMES WITH THAT TOLERANCE: a field this harness does not key
 * on is a field that does not invalidate a fixture. If the peer's request grows
 * a semantic top-level field — `temperature`, `thinking`, `outputConfig` in
 * camelCase — a change to it replays a stale recording and the test passes
 * against the wrong answer. That is why `keyFields`/`extraKeyedFields` exist,
 * why the field list is written into every fixture, and why `diffFixtures`
 * reports a change to that list as harness drift rather than as a result.
 */

/** The minimum a request must be for a fixture to be findable. */
export interface ProviderCallShape {
  readonly model: string;
  /** The four other fields the key covers by default, if present. Typed `unknown`
   * so any peer shape — string, array, object, its own branded types — fits. */
  readonly system?: unknown;
  readonly messages?: unknown;
  readonly tools?: unknown;
  readonly output_config?: unknown;
}

/** One model call. Single argument on purpose: a peer `(req, opts?) => …` is
 * assignable to this, and a caller that needs to pass options closes over them. */
export type ProviderFn<Req extends ProviderCallShape, Res> = (request: Req) => Promise<Res>;

/** What `createHarness` returns, and all `replayVariant` needs from it —
 * stated structurally so `compare.ts` never imports the harness. */
export interface HarnessCaller<Req extends ProviderCallShape, Res> {
  call(request: Req): Promise<Res>;
}
