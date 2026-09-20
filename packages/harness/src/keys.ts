/** What a fixture is keyed on.
 *
 * ⭐ THE KEY IS THE REQUEST, NOT THE CALL INDEX. Open Scaffold-style recorders
 * that key on order have one specific failure: adding a call in the middle of a
 * test shifts every later call's index, so every later fixture misses at once
 * and the "fix" is to re-record the whole file against a live API. Content
 * addressing makes an inserted call exactly one cache miss.
 */
import { canonicalDigest, canonicalStringify } from "./canonical";
import type { ProviderCallShape } from "./provider-contract";

/** The five fields named in the design: change any of them and it is a different call. */
export const KEYED_FIELDS: readonly string[] = ["model", "system", "messages", "tools", "output_config"];

/** 128 bits of sha256, hex. Long enough that a collision is not a thing that
 * happens, short enough to read in a directory listing and a diff. */
export const KEY_LENGTH = 32;

export interface KeyingOptions {
  /** Replaces the default five outright — for a peer whose request names things differently. */
  readonly keyFields?: readonly string[];
  /** Added to whichever set is in force. Use this for a peer's extra semantic fields. */
  readonly extraKeyedFields?: readonly string[];
}

/** The field list actually in force, deduplicated, in a stable order. */
export function keyFieldsFor(options: KeyingOptions = {}): readonly string[] {
  const base = options.keyFields ?? KEYED_FIELDS;
  return [...new Set([...base, ...(options.extraKeyedFields ?? [])])].sort();
}

/** The slice of a request that the key covers. Anything outside it — an API key,
 * an abort signal, a request id, a retry counter — is invisible to the key and
 * never reaches disk. */
export function keyedView(
  request: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): Record<string, unknown> {
  const view: Record<string, unknown> = {};
  for (const field of fields) {
    const value = request[field];
    if (value !== undefined) view[field] = value;
  }
  return view;
}

/** Content address of a call.
 *
 * Note what is deliberately NOT hashed: the field list itself. Adding
 * `extraKeyedFields: ["temperature"]` to a suite whose requests carry no
 * temperature must not invalidate a single existing fixture — and it does not,
 * because an absent field contributes nothing. The list is recorded in the
 * fixture instead, where a drift is reported rather than paid for. */
export function requestKey(
  request: Readonly<Record<string, unknown>>,
  options: KeyingOptions = {},
): string {
  return canonicalDigest(keyedView(request, keyFieldsFor(options))).slice(0, KEY_LENGTH);
}

/** Convenience for a typed request. */
export function keyOf<Req extends ProviderCallShape>(request: Req, options: KeyingOptions = {}): string {
  return requestKey(request as unknown as Readonly<Record<string, unknown>>, options);
}

/** Which keyed fields two requests disagree on. The unit of attribution for
 * "did the input change, or did the harness change?". */
export function differingFields(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): string[] {
  const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return fields.filter((field) => canonicalStringify(a[field] ?? null) !== canonicalStringify(b[field] ?? null));
}
