/**
 * One error type across every provider, so callers branch on `kind` instead of
 * on a vendor's exception classes — or, worse, on the text of a message.
 *
 * ⛔ NEVER STRING-MATCH A PROVIDER ERROR. Adapters map their SDK's own typed
 * error classes onto `ProviderErrorKind`, most-specific-first. The mapping
 * lives in the adapter because only the adapter knows its SDK's hierarchy;
 * what escapes the adapter is always a `ProviderError`.
 */

export type ProviderErrorKind =
  /** The request was malformed or rejected by validation. Retrying it unchanged will fail again. */
  | "bad_request"
  /** No usable credential. */
  | "auth"
  /** Authenticated, but not allowed. */
  | "permission"
  /** Unknown model, or an endpoint that is not there. */
  | "not_found"
  | "rate_limit"
  /** The provider failed on its own side. */
  | "server"
  /** Never reached the provider: DNS, TLS, socket, timeout. */
  | "transport"
  /** The caller aborted. */
  | "canceled"
  | "unknown";

/** Kinds where trying the same request again can plausibly succeed. */
const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set<ProviderErrorKind>([
  "rate_limit",
  "server",
  "transport",
]);

export interface ProviderErrorInit {
  readonly kind: ProviderErrorKind;
  /** Which adapter raised it — `ModelProvider.name`. */
  readonly provider: string;
  readonly status?: number;
  readonly cause?: unknown;
}

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly provider: string;
  readonly status: number | undefined;
  /** Whether re-issuing the identical request could succeed. Derived from `kind`, never guessed per call site. */
  readonly retryable: boolean;

  constructor(message: string, init: ProviderErrorInit) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "ProviderError";
    this.kind = init.kind;
    this.provider = init.provider;
    this.status = init.status;
    this.retryable = RETRYABLE.has(init.kind);
  }
}

export function isProviderError(value: unknown): value is ProviderError {
  return value instanceof ProviderError;
}
