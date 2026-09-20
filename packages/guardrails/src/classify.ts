/**
 * classify() — the TE four-tier data classification, derived from the OS's
 * EXISTING vocabulary rather than from a new list of my own.
 *
 *   1 Public · 2 Internal · 3 Confidential · 4 Restricted/Highly Confidential
 *
 *   tier 4 — a `PII_DENIED_SUBSTRINGS` hit (salary, compensation, address,
 *            iban, bankaccount, ssn, socialsecurity, taxid, birthdate,
 *            dateofbirth) or a GDPR Art. 9 special category.
 *   tier 3 — a `PII_PATTERNS` hit in a value (email, iban, digits, amount,
 *            date) or a `PII_DENIED_SEGMENTS` field name (person, name,
 *            email, phone, dob, street, postcode, city, ...).
 *   tier 2 — contract/ticket data carrying no person fields.
 *   tier 1 — everything else.
 *
 * Where a thing could be two tiers it takes the HIGHER. Never the lower.
 * That is `maxTier` in `./findings.ts` and it is applied in exactly one place,
 * `tierOf`, so there is no second opinion to drift.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE SEC-V5-02 LESSON, WHICH IS THE WHOLE SHAPE OF THIS FILE
 * ─────────────────────────────────────────────────────────────────────────
 * `scripts/check-contracts-boundary.sh` records what happened when a guard was
 * anchored on one path prefix: Phase 30 untracked `contracts/INDEX.json`, an
 * identical-shape snapshot of the same 1101 rows / 921 distinct persons stayed
 * tracked at `archive/snapshots-2026-06-24/contracts-INDEX.json`, and all 25
 * `piiGitBoundary` tests passed the whole time. Its conclusion:
 *
 *     "An untrack that removes a file from ONE path while an identical copy
 *      lives at another is not a boundary closure — so the guard must name
 *      paths, not prefixes."
 *
 * The failure was not a bad list. It was a SCOPE that never looked at the
 * second location. So this walker has no anchor, no prefix, no allowlisted
 * root and no early exit: every node of the input is visited and classified
 * on its own, and the result is the MAXIMUM over all of them. Person data
 * reachable by a second path is caught by the second path, because the second
 * path was walked too. `__tests__/second-path.test.ts` is that property
 * restated as a test, in this package's own terms.
 *
 * Two consequences, both deliberate:
 *   - the walk does not stop at the first tier-4 hit (a refusal should be able
 *     to say how many places are affected, not just that one is);
 *   - a truncated walk is tier 4, not "clean so far" — fail-closed, the same
 *     way a missing `.pii-boundary` switch means CLOSED in the host script.
 */

import {
  BUSINESS_SEGMENTS,
  PII_DENIED_SEGMENTS,
  PII_DENIED_SUBSTRINGS,
  PII_PATTERNS,
  SPECIAL_CATEGORY_SEGMENTS,
  SPECIAL_CATEGORY_SUBSTRINGS,
  normalizeToken,
} from "./lists";
import {
  type Classification,
  type Finding,
  dedupe,
  joinPath,
  sanitizePathSegment,
  tierOf,
} from "./findings";

export interface ClassifyOptions {
  /** Names the caller KNOWS are in the data — the ticket's person, the
   * requester. Same contract as the host's `redact({ names })`: declaring
   * them is the caller's one obligation, and in exchange they are masked out
   * of every reported path and asserted absent from serialised output. */
  readonly declaredNames?: readonly string[];
  /** Fail-closed ceiling on nodes visited. Exceeding it yields `scan-truncated`
   * at tier 4 rather than a clean-looking partial result. */
  readonly maxNodes?: number;
  /** Path the findings are reported relative to. Used by `gateGeneratedArtifacts`
   * so a finding says which FILE it is in. */
  readonly rootPath?: string;
}

const DEFAULT_MAX_NODES = 50_000;

// ─────────────────────────────────────────────────────────────────────────
// Field names
// ─────────────────────────────────────────────────────────────────────────

export interface NameHit {
  readonly token: string;
  readonly tier: 2 | 3 | 4;
  readonly via: "field-name" | "special-category";
}

/**
 * Every denylist token in `path`, not just the first.
 *
 * The host's `deniedPiiField` returns the FIRST offending token because it
 * only needs to name a reason for one rejection. A classifier needs all of
 * them: `person.salary` is tier 4 for `salary` and tier 3 for `person`, and a
 * refusal that mentions only one of those under-reports what was exposed.
 * `deniedPiiField` below preserves the host's exact first-token behaviour for
 * parity checking; this is the superset.
 */
export function nameHits(path: string): NameHit[] {
  const hits: NameHit[] = [];
  const whole = normalizeToken(path);
  // Split on path separators too, not just object-path punctuation. The host's
  // `deniedPiiField` only ever sees a widget field pointer, so `.` and `[]`
  // are all it needs; `nameHits` also judges FILE paths for
  // `gateGeneratedArtifacts`, and without `/` a segment rule could never fire
  // on `data/person/name.json` — the exact-segment tier would be dead for
  // every artifact path. Additive: a field pointer never contains a slash.
  const segments = path
    .split(/[.[\]/\\]+/)
    .filter(Boolean)
    .map(normalizeToken)
    .filter(Boolean);

  for (const bad of SPECIAL_CATEGORY_SUBSTRINGS) {
    if (whole.includes(bad)) hits.push({ token: bad, tier: 4, via: "special-category" });
  }
  for (const bad of SPECIAL_CATEGORY_SEGMENTS) {
    if (segments.includes(bad)) hits.push({ token: bad, tier: 4, via: "special-category" });
  }
  for (const bad of PII_DENIED_SUBSTRINGS) {
    if (whole.includes(bad)) hits.push({ token: bad, tier: 4, via: "field-name" });
  }
  for (const bad of PII_DENIED_SEGMENTS) {
    if (segments.includes(bad)) hits.push({ token: bad, tier: 3, via: "field-name" });
  }
  for (const bad of BUSINESS_SEGMENTS) {
    if (segments.includes(bad)) hits.push({ token: bad, tier: 2, via: "field-name" });
  }
  return hits;
}

/**
 * The host's `deniedPiiField` from `flightdeck/server/widgets/types.ts`,
 * transcribed byte-for-byte in behaviour: the FIRST denied token in `path`, or
 * null. Kept even though `nameHits` supersedes it, because the divergence test
 * asserts the HOST's function still consults the two lists in this order —
 * substrings over the whole path first, then segments. A host that reordered
 * those tiers would change what "tier 4" means here without changing a single
 * list entry, and a list-only comparison would not see it.
 */
export function deniedPiiField(path: string): string | null {
  const whole = normalizeToken(path);
  for (const bad of PII_DENIED_SUBSTRINGS) {
    if (whole.includes(bad)) return bad;
  }
  for (const seg of path.split(/[.[\]]+/)) {
    if (!seg) continue;
    const n = normalizeToken(seg);
    if (PII_DENIED_SEGMENTS.includes(n)) return n;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Values
// ─────────────────────────────────────────────────────────────────────────

/**
 * Every PII class present in `text`, with the offset of the first occurrence
 * and how many there were. The matched text is read and immediately dropped —
 * `m[0]` is never stored, never returned and never interpolated into a
 * message. `m.index` is a number and a number cannot carry a name.
 */
export function classifyText(text: string, where: string): Finding[] {
  const out: Finding[] = [];
  for (const { name, re } of PII_PATTERNS) {
    const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    let first = -1;
    let count = 0;
    for (const m of text.matchAll(rx)) {
      if (first < 0) first = m.index ?? 0;
      count += 1;
    }
    if (count > 0) out.push({ class: name, tier: 3, via: "value-pattern", where, offset: first, count });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// The walk
// ─────────────────────────────────────────────────────────────────────────

/**
 * The name findings introduced AT this node — the hits on the full path minus
 * the hits its parent already had.
 *
 * Without the subtraction, `salary` matches the whole normalized path at every
 * one of a salary object's descendants, so a record with twelve fields under
 * `employeeSalary` produces thirteen tier-4 findings that all say the same
 * thing about the same disclosure. That is not extra safety, it is an audit
 * event nobody reads.
 *
 * The subtraction is by TOKEN, not by node, so the cross-segment catch is
 * kept: `date.ofBirth` normalizes whole to `dateofbirth`, which the parent
 * `date` does not match, so it is still reported here — and splitting a denied
 * token across two keys remains a detected evasion rather than a loophole.
 */
function findingsForPath(rawPath: string, safePath: string, parentRawPath: string): Finding[] {
  const inherited = new Set(parentRawPath === "" ? [] : nameHits(parentRawPath).map((h) => h.token));
  return nameHits(rawPath)
    .filter((h) => !inherited.has(h.token))
    .map((h) => ({
      class: h.token,
      tier: h.tier,
      via: h.via,
      where: safePath,
    }));
}

/**
 * classify — the public entry point. Accepts any JSON-shaped value: an object,
 * an array, a bare string, a number.
 */
export function classify(input: unknown, options: ClassifyOptions = {}): Classification {
  const declaredNames = options.declaredNames ?? [];
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const root = options.rootPath ?? "";
  const findings: Finding[] = [];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let truncated = false;

  const visit = (value: unknown, rawPath: string, safePath: string): void => {
    if (truncated) return;
    nodes += 1;
    if (nodes > maxNodes) {
      truncated = true;
      return;
    }

    if (typeof value === "string") {
      findings.push(...classifyText(value, safePath === "" ? "<root>" : safePath));
      return;
    }
    if (value === null || typeof value !== "object") return;

    if (seen.has(value)) return; // a cycle is the same data twice, already classified
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        // An index is a number: it needs no sanitising and leaks nothing.
        visit(item, joinPath(rawPath, `[${i}]`), joinPath(safePath, `[${i}]`));
      });
      return;
    }

    const entries = Object.entries(value as Record<string, unknown>);
    entries.forEach(([key, child], ordinal) => {
      const safeKey = sanitizePathSegment(key, ordinal, declaredNames);
      const childRaw = joinPath(rawPath, key);
      const childSafe = joinPath(safePath, safeKey);
      findings.push(...findingsForPath(childRaw, childSafe === "" ? "<root>" : childSafe, rawPath));
      visit(child, childRaw, childSafe);
    });
  };

  // The root path itself is classified before the walk: when a caller passes
  // `rootPath` (a file path, a table name), the NAME of the thing is as much
  // of a disclosure as its contents. It is sanitised segment by segment before
  // being reported, because a generated FILE NAME can carry a person as
  // readily as a field can — `fixtures/e.musterfrau@example.de.json` is a
  // disclosure in the path alone.
  const safeRoot =
    root === ""
      ? ""
      : root
          .split("/")
          .map((seg, i) => sanitizePathSegment(seg, i, declaredNames))
          .join("/");
  if (root !== "") findings.push(...findingsForPath(root, safeRoot, ""));
  visit(input, root, safeRoot);

  if (truncated) {
    findings.push({
      class: "scan-truncated",
      tier: 4,
      via: "field-name",
      where: safeRoot === "" ? "<root>" : safeRoot,
      count: nodes,
    });
  }

  const deduped = dedupe(findings);
  return { tier: tierOf(deduped), findings: deduped };
}

/** Convenience for the common "is this allowed out of the building" question.
 * Categories 3 and 4 require explicit named-human approval; 1 and 2 do not. */
export function requiresApproval(tier: Classification["tier"]): boolean {
  return tier >= 3;
}
