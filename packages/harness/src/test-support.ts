/** Test-only helpers, deliberately not re-exported from `index.ts` — nothing in
 * the shipping surface may depend on them. Mirrors `@spec`'s `test-support.ts`. */
import type { ProviderCallShape, ProviderFn } from "./provider-contract";

export interface FakeProvider<Req extends ProviderCallShape, Res> {
  readonly provider: ProviderFn<Req, Res>;
  /** Every request that reached the provider, in order. In playback this stays
   * empty — which is how a test proves no network call was made. */
  readonly calls: Req[];
}

/** A stand-in for a real provider. Return an `Error` to make the call reject. */
export function fakeProvider<Req extends ProviderCallShape, Res>(
  reply: (request: Req, index: number) => Res | Error,
): FakeProvider<Req, Res> {
  const calls: Req[] = [];
  const provider: ProviderFn<Req, Res> = async (request) => {
    const index = calls.length;
    calls.push(request);
    const result = reply(request, index);
    if (result instanceof Error) throw result;
    return await Promise.resolve(result);
  };
  return { provider, calls };
}

/** A provider that must never run. Hand this to a "live" harness in a test that
 * claims not to touch the provider, and the claim is enforced rather than stated. */
export function explodingProvider<Req extends ProviderCallShape, Res>(
  reason = "provider was called",
): ProviderFn<Req, Res> {
  return () => {
    throw new Error(reason);
  };
}
