/** The approval model, with no node builtin in it.
 *
 * Split out of `approval.ts` so `pure.ts` can offer a route the whole approval
 * check. The only thing that ever needed `node:crypto` was one digest call;
 * everything here — what a valid approval IS, what an unnamed approver is, how
 * a mismatch is reported — was always pure and was only unreachable from a
 * sub-app because it shared a file with that one line.
 */
import { type Digest, contentHashWith } from "./hash";

export interface Approval {
  /** A NAMED human. "the approver", "system" and "" are not names, and
   * `checkApproval` refuses them — an unnamed approval is an audit trail that
   * cannot be followed back to a person. */
  readonly approver: string;
  /** The sha256 of the exact proposal that was approved. */
  readonly contentHash: string;
  /** ISO timestamp, for the audit body. Not verified here. */
  readonly at: string;
  /** What was approved, so an approval for one gate cannot be replayed at
   * another. */
  readonly scope: "registration" | "model-request" | "workflow-intake" | "generated-artifacts";
  /** Optional free note from the approver. Never scanned, never echoed into a
   * finding — it is the human's words, not data under classification. */
  readonly note?: string;
}

export type ApprovalProblem =
  | "no-approval"
  | "unnamed-approver"
  | "content-hash-mismatch"
  | "wrong-scope";

export interface ApprovalCheck {
  readonly ok: boolean;
  readonly problem?: ApprovalProblem;
  /** The hash the proposal actually has, so a human can re-approve the right
   * thing rather than guess why their approval stopped working. A digest of a
   * proposal is not the proposal. */
  readonly expectedHash: string;
}

/**
 * ⭐ THE UNION OF BOTH LISTS THAT USED TO EXIST.
 *
 * `packages/envelope` carried a second copy of this rule with a comment
 * promising a test would catch any divergence. No test compared them, and they
 * disagreed in BOTH directions: this list was missing `service`, `bot`,
 * `robot`, `svc` and `none`; the envelope's was missing `automation`, `agent`,
 * `studio` and the rest below.
 *
 * So the copy is gone and the entries it had that this one lacked are here.
 * Merging UP rather than picking a side is the only safe direction: a name
 * either list refused is a name that should not carry an approval, and the
 * cost of refusing one real person called "Svc" is a clearer error than the
 * cost of an audit trail that ends at "service".
 */
const NON_NAMES = new Set([
  "",
  "system",
  "automation",
  "agent",
  "studio",
  "flightdeck",
  "flightdeck-server",
  "the approver",
  "approver",
  "admin",
  "unknown",
  "n/a",
  // ── from the envelope's copy, which this list did not have ──
  "service",
  "svc",
  "bot",
  "robot",
  "none",
  "null",
  "undefined",
  "anonymous",
  "someone",
  "user",
]);

export function isNamedHuman(approver: string | undefined): boolean {
  if (typeof approver !== "string") return false;
  const t = approver.trim().toLowerCase();
  if (NON_NAMES.has(t)) return false;
  return t.length >= 2;
}

/** The same check with the digest supplied, for callers that may not import
 * `node:crypto` — see `hash.ts` for why that is most of them. */
export function checkApprovalWith(
  digest: Digest,
  proposal: unknown,
  scope: Approval["scope"],
  approval: Approval | undefined,
): ApprovalCheck {
  const expectedHash = contentHashWith(digest, proposal);
  if (!approval) return { ok: false, problem: "no-approval", expectedHash };
  if (!isNamedHuman(approval.approver)) return { ok: false, problem: "unnamed-approver", expectedHash };
  if (approval.scope !== scope) return { ok: false, problem: "wrong-scope", expectedHash };
  if (approval.contentHash !== expectedHash) {
    return { ok: false, problem: "content-hash-mismatch", expectedHash };
  }
  return { ok: true, expectedHash };
}
