/**
 * The FINDING — what a guardrail is allowed to say about what it caught.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ONE RULE
 * ─────────────────────────────────────────────────────────────────────────
 * A finding names the CLASS and the WHERE. It never carries the matched
 * value. This is not a Studio invention; it is the host's rule, stated in
 * `envelope.ts` above `PII_PATTERNS`:
 *
 *     "Findings are reported by NAME only — never the matched text — so an
 *      audit event, a log line and a 422 body can all say what tripped
 *      without reproducing the thing that tripped it."
 *
 * A guardrail that logs the secret it caught has moved the secret from one
 * place to a second, more widely-read place. It is worse than no guardrail,
 * because it also carries an assurance.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE PART THAT IS EASY TO GET WRONG: `where` IS ALSO DATA
 * ─────────────────────────────────────────────────────────────────────────
 * `where` is a path, and a path is made of object KEYS. Keys are not always
 * schema names. `{ "Jane Q. Doe": { salary: 82000 } }` puts a person's name
 * in the path, and a finding that echoes the path verbatim leaks the person
 * while reporting that it protected them. The host hit the same shape from
 * the other side and documented it (`envelope.ts`, the closed key policy):
 * a fact key was "a free-text channel straight to the wire, the audit event,
 * the refusal messages and the edge function's 400 bodies", and the example
 * that defeated it — `salary_of_Jane_Doe_92000` — "produces ZERO findings
 * under this module's own PII_PATTERNS".
 *
 * So `sanitizePathSegment` below is a security control, not cosmetics:
 *   - a segment matching a PII class  → `<email>`-style class name;
 *   - a declared name                 → its initials, the host's own recipe;
 *   - a segment that is not shaped like an identifier (spaces, punctuation,
 *     non-ASCII, or > 40 chars) → its ORDINAL position, `<key#3>`, because a
 *     position is enough to find the field again and carries nothing;
 *   - anything else — a plain identifier, i.e. a schema name — verbatim.
 *
 * ⚠ RESIDUAL, STATED: a single-token proper noun used as an object key
 * (`{ Mariusz: {...} }`) is identifier-shaped and IS echoed unless the caller
 * declares it via `declaredNames`. Declaring known names is the caller's one
 * obligation here, exactly as `redact({ names })` makes it the caller's one
 * obligation in the host. The same residual is restated where it bites in
 * `classify.ts` (`SCHEMA_METAKEYS`) and asserted as current behaviour in
 * `__tests__/no-value-leak.test.ts` — an undeclared name is reported
 * positionally, never verbatim.
 */

import { PII_PATTERNS } from "./lists";

export type Tier = 1 | 2 | 3 | 4;

/** How a finding was reached. Part of the finding because a refusal that says
 * "tier 4" without saying whether it read a NAME or a VALUE cannot be acted
 * on: one is fixed by renaming a field, the other by not sending the data. */
export type FindingVia =
  | "value-pattern" // a PII_PATTERNS match inside a string value
  | "field-name" // a PII_DENIED_* match on a key or path segment
  | "special-category" // a GDPR Art. 9 token on a key or label
  | "label" // a markdown/prose label in key position
  | "value-shape" // a CONTENT-derived judgement about a value: a name-shaped
  // value under a person-referring key, a class reassembled from sibling
  // fragments, a composite (age + date = date of birth), or a node the scan
  // could not read. Separated from `value-pattern` because it is a heuristic
  // over content rather than a regex the host also runs, and a human reading
  // a refusal is owed that distinction.
  | "artifact-path"; // the FILE PATH of a generated artifact

export interface Finding {
  /** The class name. Always drawn from a compiled-in constant list — never
   * from the scanned data. This is what makes a finding loggable. */
  readonly class: string;
  readonly tier: Tier;
  readonly via: FindingVia;
  /** Sanitised location. See the header: this field is data-derived and goes
   * through `sanitizePathSegment`. */
  readonly where: string;
  /** Character offset of the first match within the scanned string, when the
   * finding came from a value. A number cannot carry a name. */
  readonly offset?: number;
  /** How many matches of this class at this location. Also just a number. */
  readonly count?: number;
}

export interface Classification {
  readonly tier: Tier;
  readonly findings: readonly Finding[];
}

/** HIGHER TIER WINS. The whole classification scheme rests on this one line:
 * where a thing could be two tiers it takes the higher, never the lower. */
export function maxTier(a: Tier, b: Tier): Tier {
  return (a > b ? a : b) as Tier;
}

export function tierOf(findings: readonly Finding[]): Tier {
  let tier: Tier = 1;
  for (const f of findings) tier = maxTier(tier, f.tier);
  return tier;
}

/** The host's `initials()` from `envelope.ts`, transcribed — one declared name
 * reduced to initials. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  return parts.map((p) => (p[0] ?? "").toUpperCase() + ".").join(" ");
}

export function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** An identifier: what a schema field is called. Anything else is treated as
 * possibly-data and reported positionally. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$-]{0,39}$/;

/**
 * Reduce one raw object key to something safe to put in a log line.
 * `ordinal` is the key's position among its siblings, used when the key
 * itself cannot be shown.
 */
export function sanitizePathSegment(
  raw: string,
  ordinal: number,
  declaredNames: readonly string[] = [],
  allow?: readonly string[],
): string {
  // ⭐ ALLOWLIST FIRST, AND IT IS THE ONLY BRANCH THAT ENDS IN `raw`.
  //
  // Everything below this is a denylist whose fallback was `return raw` —
  // "I did not recognise it, so it travels". That is the inversion of the rule
  // the rest of this system runs on, and it was measured: a caller who names a
  // fact key `notes_ibanDE02120300000000202051` got the complete IBAN written
  // verbatim into `audit.locations`, up to MAX_LOCATIONS_IN_EVENT of them per
  // refused request, into an append-only replicated chain. A bare IBAN was
  // caught and the disguised one was not, which is the wrong way round.
  //
  // When a caller knows the closed set of names that may legitimately appear
  // — `gateModelRequest` does: `FACT_KEY_ALLOWLIST` — it passes it here and a
  // non-member becomes its ORDINAL, exactly as `packages/envelope` already
  // refuses an unlisted key positionally so it is never written down.
  if (allow !== undefined) return allow.includes(raw) ? raw : `<key#${ordinal}>`;

  for (const name of declaredNames) {
    const trimmed = name.trim();
    if (trimmed.length < 2) continue; // a one-char "name" would match everything
    if (new RegExp(escapeRegExpLiteral(trimmed), "i").test(raw)) return initials(trimmed);
    for (const part of trimmed.split(/\s+/).filter((p) => p.length >= 3)) {
      if (new RegExp(`\\b${escapeRegExpLiteral(part)}\\b`, "i").test(raw)) return initials(part);
    }
  }
  // ⚠ THE SEGMENT AND ITS PIECES. A path segment is not prose: `notes_iban…`,
  // `salaryEUR92000` and `x.dob-19850317` glue a label to a value, and the
  // host's patterns are anchored with `\b`, which a glued-on prefix kills. So
  // each pattern is tried against the whole segment AND against the segment
  // split on the separators and case changes that identifiers actually use.
  // This is still a denylist — see the allowlist branch above for the control
  // that does not depend on recognising anything.
  for (const candidate of [raw, ...splitIdentifier(raw)]) {
    for (const { name, re } of PII_PATTERNS) {
      if (new RegExp(re.source, re.flags.replace("g", "")).test(candidate)) return `<${name}>`;
    }
  }
  if (!IDENTIFIER.test(raw)) return `<key#${ordinal}>`;
  return raw;
}

/**
 * A segment's pieces, as an identifier is actually written: `notes_ibanDE02…`
 * yields `notes`, `ibanDE02…` and `DE02…`. Used only to give the PII patterns
 * something their `\b` anchors can match against.
 */
function splitIdentifier(raw: string): string[] {
  const out = new Set<string>();
  for (const piece of raw.split(/[^A-Za-z0-9]+/)) {
    if (piece === "") continue;
    out.add(piece);
    // camelCase / letters-then-digits: `ibanDE02…` -> `DE02…`, `salaryEUR92000`
    for (const m of piece.matchAll(/[A-Z][A-Za-z0-9]*|\d[\dA-Za-z]*/g)) out.add(m[0]);
  }
  out.delete(raw);
  return [...out];
}

/**
 * A whole path — object path or FILE path — reduced segment by segment.
 *
 * Exported and used by every caller that puts a path in a `where`, because the
 * one that forgot was a real leak caught by `__tests__/no-value-leak.test.ts`:
 * `gateGeneratedArtifacts` passed a generated file's raw path straight into
 * the finding, and a generated file can be named after the thing it contains
 * (`fixtures/e.musterfrau@example.de.seed.json`). A path is data. There is one
 * sanitiser so there is one place to get it right.
 */
export function sanitizePath(
  raw: string,
  declaredNames: readonly string[] = [],
  allow?: readonly string[],
): string {
  return raw
    .split("/")
    .map((seg, i) => sanitizePathSegment(seg, i, declaredNames, allow))
    .join("/");
}

export function joinPath(parent: string, segment: string): string {
  return parent === "" ? segment : `${parent}.${segment}`;
}

/** Deduplicate findings that say the same thing about the same place, keeping
 * the first offset seen and summing counts. Twelve identical findings are
 * noise; one with `count: 12` is a fact. */
export function dedupe(findings: readonly Finding[]): Finding[] {
  const byKey = new Map<string, Finding>();
  for (const f of findings) {
    const key = `${f.class}\u0000${f.via}\u0000${f.where}`;
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, f);
      continue;
    }
    byKey.set(key, { ...seen, count: (seen.count ?? 1) + (f.count ?? 1) });
  }
  return [...byKey.values()].sort(
    (a, b) => b.tier - a.tier || a.class.localeCompare(b.class) || a.where.localeCompare(b.where),
  );
}
