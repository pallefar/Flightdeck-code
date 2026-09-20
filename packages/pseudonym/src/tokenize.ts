/**
 * `tokenize` — personal data out of the payload, into the vault, and then
 * PROVED gone.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ORDER IS THE DESIGN
 * ─────────────────────────────────────────────────────────────────────────
 *   1. COLLISION SWEEP — every span the detokenizer would read back as a tag
 *      is interned as `<literal:n>` before anything else touches the text.
 *   2. THE HOST'S PATTERNS, in the host's order (email before digits).
 *   3. DECLARED NAMES — the `RedactOptions.names` contract, but reversible.
 *   4. PROOF — the host's own `residualPiiFindings`, on the result. Refuse.
 *
 * Step 1 must be first. After it, the ONLY tag-shaped spans in the text are
 * ones this function minted, so steps 2-4 can insert and reason about tags
 * without any risk of confusing them with source content. That invariant is
 * asserted in step 4, not assumed.
 *
 * Step 2 runs the host's patterns in the host's array order, for the host's
 * stated reason: "`email` runs before `digits`, otherwise a numeric local-part
 * would be partly eaten and the address would survive as a recognisable
 * fragment".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠ STEP 3 IS AFTER STEP 2, WHICH IS THE OPPOSITE OF `redact()`. HERE IS WHY.
 * ─────────────────────────────────────────────────────────────────────────
 * The host masks declared names FIRST and then runs the patterns. That order
 * is right for a LOSSY function and wrong for a reversible one, and the case
 * that shows it is an ordinary signature block:
 *
 *     Jane Doe <jane.doe@acme.de>
 *
 * Names first, the declared parts "Jane" and "Doe" match INSIDE the address,
 * so the address is shredded into three separate replacements and never
 * recognised as an email at all. `redact()` does not care — it is throwing
 * the value away either way. This package does: a shredded address cannot be
 * restored, and the three fragments would each have to be canonicalised back
 * to the full declared name, producing `Jane Doe.Jane Doe@acme.de`.
 *
 * Patterns first, the whole address is ONE `<email:1>` entry and the prose
 * name is `<person:2>`. Both restore byte-exactly.
 *
 * NOTHING ESCAPES BY DOING IT THIS WAY, which is the part that has to be
 * argued rather than asserted. A declared name that gets absorbed into a
 * pattern match is absorbed into that match's VAULT ENTRY — it is in the
 * vault, not in the payload. Step 4 then scans the transmitted bytes with the
 * caller's declared names and would refuse if any fragment had survived. The
 * name is gone from the wire in both orders; only the reversibility differs.
 *
 * Steps 2 and 3 both run through `mapOutsideTags`, so a replacement can never
 * reach inside a tag an earlier step minted. Without it, a caller declaring
 * the surname "Son" would rewrite `<person:1>` into `<per<person:2>:1>` —
 * "son" is a substring of "person", and the host's recipe matches a full
 * declared name WITHOUT word boundaries. That is not a hypothetical; it is
 * the first thing that breaks if the passes are naive, and it is why the gaps
 * are transformed rather than the whole string.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY STEP 4 IS NOT A FORMALITY
 * ─────────────────────────────────────────────────────────────────────────
 * This is section C of the brief: PROOF, NOT ASSUMPTION. The host does the
 * same thing one layer up — `serializeAiRequest` calls `assertNoResidualPii`
 * on the finished JSON rather than trusting that `redact()` did its job — and
 * for the same reason: a tokenizer is a pile of regexes, and the failure mode
 * of a pile of regexes is a gap nobody thought of.
 *
 * The seam that makes this testable rather than merely asserted is
 * `opts.patterns`. It narrows what step 3 REPLACES. It cannot narrow what
 * step 4 SCANS — that is always the host's full `PII_PATTERNS`. So
 * `tokenize(textWithAnEmailInIt, { patterns: [] })` is a tokenizer with a hole
 * in it, and it refuses, loudly, naming the class. The gate is exercised, not
 * mocked.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ONE THING STEP 4 DOES NOT COUNT AS RESIDUE, AND WHY
 * ─────────────────────────────────────────────────────────────────────────
 * The host's scanner also checks the caller's DECLARED NAMES, and it checks a
 * full declared name with no word boundary. So a caller who legitimately
 * declares "Li", "Son" or "Mai" gets a hit on this package's own tags —
 * `son` is inside `<person:1>`, `li` is inside `<literal:1>` — even though
 * the payload is spotless.
 *
 * Step 4 therefore scans TWICE:
 *   - the STRICT scan, on the exact transmitted bytes;
 *   - the MASKED scan, on the same bytes with every MINTED tag replaced by
 *     U+FFFC. The gate is the MASKED scan. Anything it finds is a refusal.
 *
 * Masking removes only spans this package itself wrote, from a seven-word
 * compiled-in vocabulary plus a counter — never caller data, because step 1's
 * invariant says no other tag-shaped span exists by then. This is the host's
 * own precedent, stated in `envelope.ts`: it deliberately scans `facts` and
 * not the three envelope headers, because they are "validated against a
 * COMPILED-IN list" and scanning them "would be strictly worse than useless:
 * `claude-haiku-4-5-20251001` trips the `digits` class, so a whole-document
 * scan would refuse every request to a date-stamped model id — a gate that
 * fires on its own constants is a gate that gets deleted".
 *
 * The difference between the two scans is not discarded. It comes back as
 * `tagClassNameCollisions`, because a DOWNSTREAM host scan run with the same
 * names will refuse this payload, and the caller needs to know that before
 * they hit it rather than after. Refusing here instead was the alternative
 * and was rejected: it would turn a real person's real surname into an error
 * about our own vocabulary, which is our problem to report, not theirs to
 * suffer.
 */

import { PseudonymError, TagCollisionError } from "./errors";
import {
  PII_PATTERNS,
  type PiiPattern,
  assertNoResidualPii,
  escapeRegExpLiteral,
  residualPiiFindings,
} from "./host-mirror";
import {
  HOST_CLASS_TO_TAG_CLASS,
  MAX_VAULT_ENTRIES,
  TAG_CANDIDATE_RE,
  TAG_CLASSES,
  TAG_MINT_RE,
  type TagClass,
  findTagCandidates,
  maskMintedTags,
} from "./tags";
import { Vault, internValue, sealVault, vaultEntries } from "./vault";

/** U+FFFC OBJECT REPLACEMENT CHARACTER. Chosen because it is a single
 * non-letter, non-digit codepoint: it cannot join with neighbouring text to
 * form a match in any host pattern (all five need letters or digits). */
const TAG_MASK = "￼";

/** What `tokenize` will say about what it did. Tags and counts; no values.
 * The same rule as a guardrail finding, and for the same reason — this is the
 * object a caller is most likely to log. */
export interface TokenizeFinding {
  readonly tag: string;
  readonly cls: TagClass;
  /** How many spans in the source collapsed onto this tag. */
  readonly occurrences: number;
  readonly via: "pattern" | "declared-name" | "tag-collision";
  /** >1 means several surface forms of one declared identity were unified, so
   * restoration writes the CANONICAL form and is not byte-exact for the short
   * ones. Reported here so that is never a surprise. */
  readonly aliasForms: number;
}

export interface TokenizeOptions {
  /** Names the caller KNOWS are in the text. Same contract as the host's
   * `RedactOptions.names` — declaring them is the caller's one obligation —
   * except that here they are TOKENIZED, not reduced to initials, so the
   * model can reason about them and they come back intact. */
  readonly names?: readonly string[] | undefined;

  /**
   * What to do about source text that is already tag-shaped.
   *   "tokenize" (default) — carry it in the vault as `<literal:n>`. Lossless:
   *      it comes back exactly as written, and the model never sees an
   *      ambiguous span.
   *   "refuse" — throw `TagCollisionError`. For callers who would rather send
   *      nothing tag-shaped at all.
   */
  readonly onSourceTagShapedText?: "tokenize" | "refuse" | undefined;

  /**
   * How the surface forms of ONE declared name relate.
   *   "unify" (default) — "Jane Doe", "Jane" and "Doe" all become the same
   *      tag. The model sees one person, which is the entire point of a vault.
   *      Restoration writes the canonical declared form, so an occurrence that
   *      was a bare surname comes back as the full name. Reported via
   *      `aliasForms`, so a caller that needs byte-exactness can see it.
   *   "distinct" — each surface form gets its own tag. Restoration is
   *      byte-exact for every occurrence, at the cost of the model reading
   *      "Jane Doe" and "Doe" as two different people.
   */
  readonly nameAliasing?: "unify" | "distinct" | undefined;

  /** Ceiling on distinct values. Capped at `MAX_VAULT_ENTRIES` regardless. */
  readonly maxEntries?: number | undefined;

  /**
   * ⚠ TEST SEAM / NARROWING ONLY. Which patterns step 3 REPLACES.
   * Defaults to the host's full `PII_PATTERNS`. Narrowing it does not weaken
   * anything: step 4 always proves against the full host set, so a narrowed
   * tokenizer refuses instead of shipping. That asymmetry is the point.
   */
  readonly patterns?: readonly PiiPattern[] | undefined;
}

export interface TokenizeResult {
  /** The payload. This is what goes to the model. Pseudonymised, NOT
   * anonymous — ask `assessTier` what it may be treated as. */
  readonly text: string;
  /** ⛔ CATEGORY 4. Stays host-side. Never serialised — it will throw. */
  readonly vault: Vault;
  readonly findings: readonly TokenizeFinding[];
  /**
   * Tag classes that a declared name is spelled inside (`Son` in `person`).
   * The payload is clean — see the header — but a downstream scan run with
   * the same `names` will report `declaredName` on this package's own tags.
   * Empty for almost every real input.
   */
  readonly tagClassNameCollisions: readonly TagClass[];
}

export function tokenize(text: string, opts: TokenizeOptions = {}): TokenizeResult {
  const names = opts.names ?? [];
  const aliasing = opts.nameAliasing ?? "unify";
  const onCollision = opts.onSourceTagShapedText ?? "tokenize";
  const patterns = opts.patterns ?? PII_PATTERNS;

  const vault = new Vault(opts.maxEntries ?? MAX_VAULT_ENTRIES);
  const counts = new Map<string, { via: TokenizeFinding["via"]; n: number }>();
  const note = (tag: string, via: TokenizeFinding["via"]): string => {
    const seen = counts.get(tag);
    if (seen === undefined) counts.set(tag, { via, n: 1 });
    else seen.n += 1;
    return tag;
  };

  // ── 1. COLLISION SWEEP ────────────────────────────────────────────────
  // One pass with the SAME regex `detokenize` reads back with, so there is no
  // gap between "what we neutralise" and "what we would misread".
  const sweep = new RegExp(TAG_CANDIDATE_RE.source, TAG_CANDIDATE_RE.flags);
  let collisions = 0;
  let out = text.replace(sweep, (raw) => {
    collisions += 1;
    if (onCollision === "refuse") return raw; // counted here, thrown below
    return note(internValue(vault, "literal", raw).tag, "tag-collision");
  });
  if (onCollision === "refuse" && collisions > 0) throw new TagCollisionError(collisions);

  // ── 2. THE HOST'S PATTERNS, IN THE HOST'S ORDER ───────────────────────
  for (const { name, re } of patterns) {
    const cls = HOST_CLASS_TO_TAG_CLASS[name];
    if (cls === undefined) continue; // a host class with no tag class: tags.ts refuses at load
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    out = mapOutsideTags(out, (gap) =>
      gap.replace(new RegExp(re.source, flags), (match) =>
        note(internValue(vault, cls, match).tag, "pattern"),
      ),
    );
  }

  // ── 3. DECLARED NAMES ─────────────────────────────────────────────────
  out = replaceDeclaredNames(out, names, aliasing, vault, note);

  // ── 4. PROOF ──────────────────────────────────────────────────────────
  // 4a. Step 1's invariant, checked rather than believed: nothing tag-shaped
  //     survives that this function did not mint. If this ever fires, the
  //     masking in 4b/4c would be masking caller data, so it is a hard refusal.
  const masked = maskMintedTags(out);
  if (findTagCandidates(masked).length > 0) {
    throw new PseudonymError(
      "refused: a tag-shaped span survived the collision sweep — the mint/candidate " +
        "invariant in tags.ts is broken and restoration could not be trusted",
    );
  }

  // 4b. THE GATE. The host's own scanner, on the transmitted bytes, minus
  //     this package's own compiled-in tags. Throws `ResidualPiiError`
  //     carrying CLASS NAMES only.
  assertNoResidualPii(masked, { names });

  // 4c. The strict scan, on the unmasked bytes. 4b has already proved the
  //     masked scan clean — it throws otherwise — so ANY `declaredName` here
  //     is attributable to this package's own tags and nothing else. Not
  //     residue, but a downstream incompatibility: report it, do not hide it.
  const strict = residualPiiFindings(out, { names });
  const tagClassNameCollisions = strict.includes("declaredName") ? collidingTagClasses(names) : [];

  sealVault(vault);

  const findings: TokenizeFinding[] = vaultEntries(vault).map((e) => {
    const seen = counts.get(e.tag);
    return {
      tag: e.tag,
      cls: e.cls,
      occurrences: seen?.n ?? 0,
      via: seen?.via ?? "pattern",
      aliasForms: e.aliasForms,
    };
  });

  return { text: out, vault, findings, tagClassNameCollisions };
}

// ─────────────────────────────────────────────────────────────────────────

/**
 * Apply `fn` to the parts of `text` BETWEEN minted tags, never to a tag.
 *
 * Every replacement pass goes through here. It is what makes each pass'
 * correctness a local property — "does this regex do the right thing to
 * prose?" — instead of a global one that has to re-argue, for every new
 * pattern and every new class word, that nothing can match inside a tag.
 */
function mapOutsideTags(text: string, fn: (gap: string) => string): string {
  const re = new RegExp(TAG_MINT_RE.source, TAG_MINT_RE.flags);
  let out = "";
  let last = 0;
  for (const m of text.matchAll(re)) {
    out += fn(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + fn(text.slice(last));
}

/** Which tag class words a declared name (or a part of one) is spelled
 * inside. Compiled-in class names only — the name itself is never echoed. */
function collidingTagClasses(names: readonly string[]): TagClass[] {
  const hit = new Set<TagClass>();
  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed.length < 2) continue;
    const lowered = trimmed.toLowerCase();
    for (const cls of TAG_CLASSES) {
      if (cls.includes(lowered)) hit.add(cls);
    }
  }
  return [...hit].sort();
}

/**
 * Every declared name and every part of one, replaced in ONE pass over the
 * gaps between tags.
 *
 * One pass, not one per form, because an alternation sorted longest-first
 * gives "Jane Doe" priority over "Doe" for free — which is what keeps a full
 * name from being torn into two separate tags — and because a second pass
 * would scan text that already contains this pass' own output.
 *
 * Boundary rules are the host's, transcribed: the FULL name matches anywhere
 * (`redact` uses no `\b` for it, so "Jane-Doe" and "JaneDoe" are caught), a
 * PART matches only on word boundaries and only at 3+ characters.
 *
 * ⚠ AMBIGUOUS PARTS ARE NOT GUESSED. Declare "Jane Doe" and "John Doe" and a
 * bare "Doe" belongs to neither in particular. Unifying it with the first
 * declaration would silently attribute one person's sentence to the other —
 * the exact failure this package must not have. A shared part therefore
 * becomes its own identity: it still gets tokenized (it is still a name), it
 * still restores byte-exactly, and the model simply does not learn which of
 * the two it is. That is the honest answer to an ambiguous input.
 */
function replaceDeclaredNames(
  text: string,
  names: readonly string[],
  aliasing: "unify" | "distinct",
  vault: Vault,
  note: (tag: string, via: TokenizeFinding["via"]) => string,
): string {
  interface Form {
    readonly source: string;
    readonly literal: string;
    canonical: string | null; // null once ambiguous across declarations
  }
  const forms = new Map<string, Form>();

  const push = (literal: string, source: string, canonical: string): void => {
    const key = literal.toLowerCase();
    const seen = forms.get(key);
    if (seen === undefined) {
      forms.set(key, { source, literal, canonical });
      return;
    }
    if (seen.canonical !== canonical) seen.canonical = null; // shared: ambiguous
  };

  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed.length < 2) continue; // a one-char "name" would match everything
    push(trimmed, escapeRegExpLiteral(trimmed), trimmed);
    for (const part of trimmed.split(/\s+/).filter((p) => p.length >= 3)) {
      push(part, `\\b${escapeRegExpLiteral(part)}\\b`, trimmed);
    }
  }
  if (forms.size === 0) return text;

  const ordered = [...forms.values()].sort(
    (a, b) => b.literal.length - a.literal.length || a.literal.localeCompare(b.literal),
  );
  const re = new RegExp(ordered.map((f) => f.source).join("|"), "gi");

  return mapOutsideTags(text, (gap) =>
    gap.replace(re, (match) => {
      const form = forms.get(match.toLowerCase());
      // `match` came from this alternation, so the lookup hits — except for a
      // locale where `toLowerCase()` does not round-trip what the
      // case-insensitive regex matched. Leaving the match in place is the
      // FAIL-CLOSED branch, not a silent one: the name then survives into
      // step 4, and the proof refuses the payload rather than shipping it.
      if (form === undefined) return match;
      const canonical = aliasing === "unify" ? form.canonical : null;
      const entry =
        canonical === null
          ? internValue(vault, "person", match)
          : internValue(vault, "person", match, canonical);
      return note(entry.tag, "declared-name");
    }),
  );
}
