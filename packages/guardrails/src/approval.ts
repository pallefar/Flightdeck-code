/**
 * APPROVAL BOUND TO CONTENT — "approving v1 must not bless v2".
 *
 * boot.json's guardrails, verbatim:
 *   "Security, access, and connector permissions require explicit human
 *    approval."
 *   "All actions touching guardrails are proposed, never auto-applied, and
 *    audited."
 *
 * An approval that names only a subject ("mini-app wc-clock is approved") is
 * a standing permission, and a standing permission over mutable content is
 * not an approval of anything in particular. The host already treats this as
 * the failure mode worth engineering against: `config.integrity-alarm` in
 * `audit/flightdeck-audit.jsonl` fires on an "unaudited config change" by
 * comparing an expected sha256 to an actual one. Same idea, same primitive.
 *
 * So an `Approval` carries a `contentHash`, and `checkApproval` compares it to
 * the hash of what is being decided RIGHT NOW. Edit the spec and every
 * existing approval stops matching — not because it was revoked, but because
 * it was never an approval of this.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ─────────────────────────────────────────────────────────────────────────
 * It does not construct an AUDIT hash. The host's audit chain is
 * `sha256(prevHash + canonicalPyJson(body))`, GENESIS-rooted and append-only
 * (`flightdeck/server/lib/flightdeckAudit.ts`), and its integrity comes from
 * being computed in one place against the real tail of the real file. A second
 * implementation computing chain hashes from a different checkout is how a
 * chain forks. Studio emits an event BODY (`./audit.ts`) and the caller
 * appends it through the capability adapter, which is the only thing that
 * knows `prevHash`.
 *
 * `contentHash` here is a plain digest of a proposal. It is not chained, not
 * appended to anything, and carries no ordering claim.
 */

import { createHash } from "node:crypto";

/**
 * ⭐ THE ONE IMPURE LINE IN THIS PACKAGE, AND WHY IT IS ISOLATED HERE.
 *
 * `packages/conformance`'s own `NODE_BUILTINS` set contains "crypto", and
 * FD-C001 refuses any mounted sub-app module that imports a node builtin —
 * "a mounted sub-app module has the host process's full filesystem and network
 * access, and that is how it escapes the capabilities its manifest declares".
 *
 * So a Studio ROUTE — the place the contract says this work happens — could
 * not call a single gate in this package, because `gates.ts` imported
 * `contentHash` and `contentHash` imports `node:crypto`. The guardrails were
 * unreachable from the one process that needs them, and nothing said so
 * because every test imports them from Node.
 *
 * The fix is codegen's: `pure.ts` is the route-safe surface, the digest is a
 * PARAMETER there, and this file supplies the Node implementation for the CLI
 * and host halves. `hash.ts` holds the part that was always pure.
 */

/** Re-exported so every existing caller of `canonicalJson` keeps working; the
 * definitions moved to `./hash`, which has no node import. */
export { canonicalJson, contentHashWith, type Digest } from "./hash";
import { type Digest, contentHashWith } from "./hash";

/** Node's sha256, the digest every CLI-side caller uses. Route-side callers
 * pass their own through `GateContext.digest` — see `pure.ts`. */
export const nodeDigest = (utf8: string): string =>
  createHash("sha256").update(utf8, "utf8").digest("hex");

export function contentHash(value: unknown): string {
  return contentHashWith(nodeDigest, value);
}

/** Re-exported so every existing import of `@guardrails/approval` keeps
 * working. The definitions live in `approval-pure.ts`, which a mounted sub-app
 * may import; this file adds the one thing it may not: a Node digest. */
export {
  checkApprovalWith,
  isNamedHuman,
  type Approval,
  type ApprovalCheck,
  type ApprovalProblem,
} from "./approval-pure";

import { checkApprovalWith, type Approval, type ApprovalCheck } from "./approval-pure";

export function checkApproval(
  proposal: unknown,
  scope: Approval["scope"],
  approval: Approval | undefined,
): ApprovalCheck {
  return checkApprovalWith(nodeDigest, proposal, scope, approval);
}

