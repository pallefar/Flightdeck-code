/**
 * `detokenize` — restoring values into an answer written by something that is
 * NOT trusted.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE THREAT MODEL, STATED PLAINLY
 * ─────────────────────────────────────────────────────────────────────────
 * The model's output is untrusted input. Not because the provider is hostile,
 * but because the output is generated: a model can emit `<person:7>` when the
 * vault holds six entries, drop `<person:2>` entirely, write `<PERSON:1>`,
 * HTML-escape the brackets, or collapse a tag back to the host's own lossy
 * `<person>`. Every one of those is ordinary model behaviour.
 *
 * And the payload it was given may itself have been shaped by a document the
 * operator did not write. Prompt injection aimed at this layer looks exactly
 * like `<person:9> <person:10> <person:11>` in the model's answer: a request
 * to print the vault. So the rule is absolute:
 *
 *   ⛔ A TAG THAT IS NOT IN THE VAULT IS NEVER RESTORED. Not approximately,
 *      not by nearest ordinal, not "if the class matches". Restoration is a
 *      lookup by exact ordinal, and a miss is a reported refusal.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE MANGLE POLICY, DECIDED AND EXPLICIT (brief section D)
 * ─────────────────────────────────────────────────────────────────────────
 * RECOVER, and report the recovery, when undoing the mangle is a FUNCTION —
 * one input, one output, no choice:
 *   - CASE:        `<PERSON:1>` → the class folds to lowercase against a
 *                  closed seven-word vocabulary. No ambiguity exists.
 *   - HTML ENTITY: `&lt;person:1&gt;` → each entity has exactly one
 *                  unescaped form.
 *   - WHITESPACE:  `< person : 1 >` → dropped.
 *
 * FAIL LOUDLY, restoring nothing, when undoing it would be a GUESS:
 *   - `<person:007>` — "strip leading zeros" is an assumption about what the
 *     model meant. Wrong, it restores one person's name where another's
 *     belonged. That is the single worst thing this package could do, so the
 *     ordinal's digits are matched exactly and `007` is `malformed-ordinal`.
 *   - `<person:9>` with nine entries of other classes — `invented`.
 *   - `<date:1>` where entry 1 is a person — `class-mismatch`. The class is
 *     part of the tag's identity; restoring across it would put a name where
 *     the model wrote a date and produce a confidently wrong sentence.
 *   - `<person>` — `degraded`. There is nothing to look up.
 *
 * REPEATS ARE FINE. The same tag many times is the same value many times;
 * that is what a vault is for. It is counted, not flagged.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE REPORT SAYS WHAT HAPPENED BY TAG, NEVER BY VALUE
 * ─────────────────────────────────────────────────────────────────────────
 * Everything in `DetokenizeReport` is a tag, a class name from the closed
 * vocabulary, a reason code from a closed list, or a count. No value, and no
 * raw model text either — untrusted output does not belong in a log line any
 * more than a personal value does.
 *
 * ONE PASS. Restoration is a single `replace` with a function, so a restored
 * value is never re-scanned. A value that happens to contain `<person:2>`
 * cannot trigger a second restoration, and neither can one the model was
 * tricked into producing.
 */

import { TagIntegrityError } from "./errors";
import { type TagClass, type TagMangle, findTagCandidates } from "./tags";
import { Vault, lookupOrdinal, vaultEntries } from "./vault";

export type TagRejectReason =
  /** Well-formed, class known, ordinal not in this vault. */
  | "invented"
  /** Ordinal is in the vault but under a different class. */
  | "class-mismatch"
  /** Tag-shaped, class known, no ordinal — collapsed to the lossy placeholder. */
  | "degraded"
  /** Ordinal present but not a shape we mint (`007`, `0`, `x`, six digits). */
  | "malformed-ordinal";

export interface RestoredTag {
  readonly tag: string;
  readonly count: number;
  /** Empty when every occurrence was byte-identical to what we minted. */
  readonly mangles: readonly TagMangle[];
}

export interface RejectedTag {
  readonly reason: TagRejectReason;
  /** From the closed vocabulary — safe to log. */
  readonly cls: TagClass;
  /** The ordinal the model wrote, when it was a number at all. `null` for
   * `degraded` and `malformed-ordinal`, where echoing it would mean echoing
   * untrusted text. */
  readonly ordinal: number | null;
  readonly count: number;
}

export interface DetokenizeReport {
  /** Tags found in the output and restored, with how many times and how they
   * were mangled on the way. */
  readonly restored: readonly RestoredTag[];
  /** Vault tags the model did not use. Not an error — a summary legitimately
   * drops detail — but the caller is the one who knows whether it matters. */
  readonly dropped: readonly string[];
  /** Tag-shaped spans that were NOT restored, by reason. Left in the text
   * verbatim unless `onRejected` says otherwise. */
  readonly rejected: readonly RejectedTag[];
  /** Restored tags whose vault entry unified several surface forms of one
   * declared name: those occurrences come back as the CANONICAL form, so the
   * result is faithful prose but not byte-identical to the source. */
  readonly canonicalised: readonly string[];
  /** Every vault tag appeared, nothing was rejected, nothing was
   * canonicalised. The only condition under which the restored text is a
   * byte-exact inverse of tokenization. */
  readonly exact: boolean;
}

export interface DetokenizeOptions {
  /**
   * What to do with a tag-shaped span that will not be restored.
   *   "leave"  (default) — leave the model's own characters untouched. The
   *      report says what was found. Least destructive, and it keeps the
   *      evidence in the text for a human reading the answer.
   *   "strip"  — remove the span. For output that will be shown to an end
   *      user, where a dangling `<person:9>` is worse than a gap.
   *   "throw"  — `TagIntegrityError`. For callers that treat any tag defect
   *      as a failed generation and retry.
   */
  readonly onRejected?: "leave" | "strip" | "throw" | undefined;
}

export interface DetokenizeResult {
  readonly text: string;
  readonly report: DetokenizeReport;
}

export function detokenize(modelOutput: string, vault: Vault, opts: DetokenizeOptions = {}): DetokenizeResult {
  const onRejected = opts.onRejected ?? "leave";

  const restored = new Map<string, { count: number; mangles: Set<TagMangle> }>();
  const rejected = new Map<string, RejectedTag & { count: number }>();

  const noteRejected = (reason: TagRejectReason, cls: TagClass, ordinal: number | null): void => {
    const key = `${reason}\u0000${cls}\u0000${ordinal ?? ""}`;
    const seen = rejected.get(key);
    if (seen === undefined) rejected.set(key, { reason, cls, ordinal, count: 1 });
    else rejected.set(key, { ...seen, count: seen.count + 1 });
  };

  // ONE pass, built from the same candidate scan `tokenize` sweeps with, so
  // "what we would restore" and "what we neutralised in the source" are the
  // same set by construction. Slicing rather than `String.replace` keeps the
  // restored value out of the scanner's path entirely — there is no second
  // look at any output byte.
  const candidates = findTagCandidates(modelOutput);
  let text = "";
  let last = 0;

  for (const { raw, index, verdict } of candidates) {
    text += modelOutput.slice(last, index);
    last = index + raw.length;

    if (verdict.kind === "degraded") {
      noteRejected("degraded", verdict.cls, null);
      text += onRejected === "strip" ? "" : raw;
      continue;
    }
    if (verdict.kind === "malformed") {
      noteRejected("malformed-ordinal", verdict.cls, null);
      text += onRejected === "strip" ? "" : raw;
      continue;
    }

    const entry = lookupOrdinal(vault, verdict.ordinal);
    if (entry === undefined) {
      noteRejected("invented", verdict.cls, verdict.ordinal);
      text += onRejected === "strip" ? "" : raw;
      continue;
    }
    if (entry.cls !== verdict.cls) {
      noteRejected("class-mismatch", verdict.cls, verdict.ordinal);
      text += onRejected === "strip" ? "" : raw;
      continue;
    }

    const seen = restored.get(entry.tag) ?? { count: 0, mangles: new Set<TagMangle>() };
    seen.count += 1;
    if (verdict.kind === "mangled") for (const m of verdict.mangles) seen.mangles.add(m);
    restored.set(entry.tag, seen);
    text += entry.value;
  }
  text += modelOutput.slice(last);

  const entries = vaultEntries(vault);
  const dropped = entries.filter((e) => !restored.has(e.tag)).map((e) => e.tag);
  const canonicalised = entries.filter((e) => e.aliasForms > 1 && restored.has(e.tag)).map((e) => e.tag);
  const rejectedList = [...rejected.values()].sort(
    (a, b) => a.reason.localeCompare(b.reason) || a.cls.localeCompare(b.cls) || (a.ordinal ?? 0) - (b.ordinal ?? 0),
  );

  if (onRejected === "throw" && rejectedList.length > 0) {
    throw new TagIntegrityError([...new Set(rejectedList.map((r) => `${r.reason}:${r.cls}`))].sort());
  }

  const report: DetokenizeReport = {
    restored: [...restored.entries()]
      .map(([tag, v]) => ({ tag, count: v.count, mangles: [...v.mangles].sort() }))
      .sort((a, b) => a.tag.localeCompare(b.tag)),
    dropped,
    rejected: rejectedList.map(({ reason, cls, ordinal, count }) => ({ reason, cls, ordinal, count })),
    canonicalised,
    exact: dropped.length === 0 && rejectedList.length === 0 && canonicalised.length === 0,
  };

  return { text, report };
}
