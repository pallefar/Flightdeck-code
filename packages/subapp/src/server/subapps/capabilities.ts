/** HOST STAND-IN — not emitted. See `src/server/db.ts`.
 *
 * Only the error type, because only the error type crosses into a sub-app's
 * source. `buildCapabilities` itself is the host's, and a sub-app never
 * constructs an adapter — it is handed one by `ctx.capabilitiesFor(id)`. */
import type { CapabilityScope } from "./types.js";

/** `scope` is the capability the refusal is ABOUT, carried structurally so a
 * route can answer `{ code: "capability_denied", scope }` and a page can say
 * one true sentence per condition instead of splicing English server prose into
 * whatever language the person reads. */
export class CapabilityDeniedError extends Error {
  constructor(
    message: string,
    readonly scope?: CapabilityScope,
  ) {
    super(message);
  }
}
