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
 * obligation in the host. See README of this package.
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
): string {
  for (const name of declaredNames) {
    const trimmed = name.trim();
    if (trimmed.length < 2) continue; // a one-char "name" would match everything
    if (new RegExp(escapeRegExpLiteral(trimmed), "i").test(raw)) return initials(trimmed);
    for (const part of trimmed.split(/\s+/).filter((p) => p.length >= 3)) {
      if (new RegExp(`\\b${escapeRegExpLiteral(part)}\\b`, "i").test(raw)) return initials(part);
    }
  }
  for (const { name, re } of PII_PATTERNS) {
    if (new RegExp(re.source, re.flags.replace("g", "")).test(raw)) return `<${name}>`;
  }
  if (!IDENTIFIER.test(raw)) return `<key#${ordinal}>`;
  return raw;
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
