/**
 * classify() — the TE four-tier data classification, derived from the OS's
 * EXISTING vocabulary rather than from a new list of my own.
 *
 *   1 Public · 2 Internal · 3 Confidential · 4 Restricted/Highly Confidential
 *
 *   tier 4 — a `PII_DENIED_SUBSTRINGS` hit (salary, compensation, address,
 *            iban, bankaccount, ssn, socialsecurity, taxid, birthdate,
 *            dateofbirth), a Studio-authored restricted token, or a GDPR
 *            Art. 9 special category — on a KEY or in a VALUE.
 *   tier 3 — a value-pattern hit (email, iban, digits, amount, date), a
 *            `PII_DENIED_SEGMENTS` field name (person, name, email, phone,
 *            dob, street, postcode, city, ...), or a person-referring field
 *            name over a name-shaped value.
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
 * second location.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠ AND THE SECOND PATH IS NOT ALWAYS A PATH. IT IS OFTEN AN ENCODING.
 * ─────────────────────────────────────────────────────────────────────────
 * This file shipped with the identical bug one layer up, and it is worth
 * writing down precisely because the file already carried the paragraph above
 * and was still wrong.
 *
 * The walk visited every node — no anchor, no prefix, no early exit — and then
 * applied the host's field-name denylists to object KEYS ONLY. A string VALUE
 * got the five value patterns and nothing else. So one record:
 *
 *     const r = { employeeSalary: 82000, personName: "…", dateOfBirth: "…" };
 *
 *     classify(r)                        → tier 4, three findings
 *     classify({ payload: JSON.stringify(r) })
 *                                        → tier 1, ZERO findings
 *     classifyMarkdown(JSON.stringify(r)) → tier 4, three findings
 *     classifyCode(JSON.stringify(r))     → tier 4, three findings
 *
 * Same bytes, same person, three scanners, two verdicts — and `classify()`
 * was, when this was written, the only scanner behind `gateRegistration` AND
 * `gateModelRequest`, the outbound gate.
 *
 * ⚠ THAT IS NO LONGER TRUE OF THE OUTBOUND GATE, AND THE CHANGE MATTERS MORE
 * THAN ANY WIDENING BELOW. `gateModelRequest` now delegates to
 * `packages/envelope`, which does not scan a payload at all: it BUILDS a
 * request from compiled-in allowlists and refuses whatever cannot be
 * expressed in that shape. `classify()` runs there only to ANNOTATE a
 * refusal, so a human reading it learns what was in the payload. It is a
 * DETECTOR THAT ESCALATES, never an authority that certifies clean — a tier-1
 * verdict from it means "this detector recognised nothing", which is worth
 * exactly that much. `gateRegistration`, `gateWorkflowIntake` and
 * `gateGeneratedArtifacts` still rest on it, because their input genuinely IS
 * arbitrary; everything below is therefore still load-bearing there. That is SEC-V5-02 exactly: an identical copy of the data,
 * reachable by a second route the guard's scope never looked at, with the
 * suite green throughout. The second route was not a directory. It was
 * `JSON.stringify`.
 *
 * So the rule this file is now written to is:
 *
 *     ONE SCANNER, ONE ANSWER, WHATEVER THE REPRESENTATION.
 *
 * and it costs five concrete obligations, each of which is a representation
 * that reaches the same place:
 *
 *   1. a VALUE is scanned with the same vocabulary as a KEY — via the same
 *      text scanner `markdown.ts` uses, so the answer cannot differ by gate;
 *   2. a string that PARSES AS JSON is walked as the structure it is;
 *   3. a string that DECODES (base64, percent) is scanned decoded as well —
 *      bounded, and honest that it cannot be complete (`decodedVariants`);
 *   4. a container `Object.entries` cannot see — a `Map`, a `Set`, a
 *      non-enumerable property, a `Date`, a byte array — is walked anyway;
 *   5. matching FOLDS first (`foldToken`), so a fullwidth `ｓ` or a Cyrillic
 *      `а` is the letter it looks like rather than a letter that is deleted.
 *
 * Two older consequences, both still deliberate:
 *   - the walk does not stop at the first tier-4 hit (a refusal should be able
 *     to say how many places are affected, not just that one is);
 *   - a truncated walk is tier 4, not "clean so far" — fail-closed, the same
 *     way a missing `.pii-boundary` switch means CLOSED in the host script.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT DONE
 * ─────────────────────────────────────────────────────────────────────────
 * The scanner does not refuse on generic words in running prose. `markdown.ts`
 * carries the full argument and the word that proves it (`address`), and the
 * reasoning is unchanged by any of the above: a gate that fires on every
 * document gets switched off in week one, and a switched-off gate protects
 * nobody. Value scanning therefore applies the SAME scopes to a value that the
 * prose scanner applies to a document — labels, value shapes, unambiguous
 * Art. 9 compounds — and not a whole-document substring sweep.
 */

import {
  BUSINESS_SEGMENTS,
  PII_DENIED_SEGMENTS,
  PII_DENIED_SUBSTRINGS,
  PII_PATTERN_NAMES,
  SPECIAL_CATEGORY_SEGMENTS,
  SPECIAL_CATEGORY_SUBSTRINGS,
  STUDIO_PERSONAL_TOKENS,
  STUDIO_RESTRICTED_SUBSTRINGS,
  STUDIO_RESTRICTED_TOKENS,
  foldToken,
} from "./lists";
import {
  SCHEMA_METAKEYS,
  classifyText,
  compositeFindings,
  decodedVariants,
  isPersonReferent,
  looksLikeFieldPointer,
  looksLikePersonName,
  nameHits,
  parseEmbeddedJson,
} from "./names";
import { RECORDING_PROVENANCE_TOKENS, classifyProseAndCode } from "./markdown";
import {
  type Classification,
  type Finding,
  dedupe,
  joinPath,
  sanitizePath,
  sanitizePathSegment,
  tierOf,
} from "./findings";

/** Re-exported so every caller that already imports the matching layer from
 * here keeps working. The definitions live in `./names.ts` — see that file's
 * header for why they had to move out from under the walker. */
export {
  SCHEMA_METAKEYS,
  classifyText,
  compositeFindings,
  decodedVariants,
  deniedPiiField,
  isPersonReferent,
  looksLikeFieldPointer,
  looksLikeLabelPhrase,
  looksLikePersonName,
  nameHits,
  parseEmbeddedJson,
} from "./names";
export type { NameHit, NameHitOptions } from "./names";

/**
 * KEYS AND VALUES SWAP ROLES BETWEEN A RECORD AND A SCHEMA, and getting this
 * wrong makes the classifier useless in one direction and blind in the other.
 *
 *   record  `{ salaryEur: 82000 }`            — the KEY is the field name.
 *   schema  `{ name: "salaryEur", type: … }`  — the key is metadata; the
 *                                               VALUE is the field name.
 *
 * Applied in one mode only, each produces a characteristic failure:
 *
 *   record-mode on a spec  — every `tables[].name` and `columns[].name` hits
 *     the host's `name` segment, so EVERY mini-app spec classifies tier 3 and
 *     every registration needs an approval. A gate that fires on everything
 *     gets rubber-stamped, which is the same end state as no gate. (This was
 *     not hypothetical: it is what `gates.test.ts` caught on the first run.)
 *
 *   schema-mode on a record — `{ status: "person" }` would read an ordinary
 *     enum value as a field name.
 *
 * ⚠ THE MODE IS A READING OF FIELD-POINTER-SHAPED VALUES. IT IS NOT A SCOPE.
 * Both modes scan every node, both modes scan every value with the full text
 * scanner, both modes decode and both modes walk a `Map`. The difference is
 * exactly one rule: whether a bare identifier-shaped string is additionally
 * read as the NAME of a field. Anything else would be a second answer for the
 * same bytes, which is the bug at the top of this file.
 */
export type ClassifyMode = "record" | "schema";

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
  /** See `ClassifyMode`. Default `record`. */
  readonly mode?: ClassifyMode;
  /**
   * ⭐ THE CLOSED SET OF KEY NAMES THAT MAY BE WRITTEN DOWN.
   *
   * When given, a key that is not a member is reported as its ORDINAL rather
   * than by name — `facts.#0`, not `facts.salary_of_AnnaMueller_92000`. A
   * caller that knows the legitimate names should pass them: `gateModelRequest`
   * passes `FACT_KEY_ALLOWLIST`, because `packages/envelope` already refuses an
   * unlisted key positionally so that it is never written down, and the audit
   * body must not undo that one layer up.
   *
   * Without it the key falls through a DENYLIST whose fallback is the raw
   * string. See `sanitizePathSegment`.
   */
  readonly keyAllowlist?: readonly string[];
}

const DEFAULT_MAX_NODES = 50_000;

/** Longest sibling-fragment join considered. See `fragmentFindings`. */
const MAX_JOIN_CHARS = 512;
/** A fragment is short. A whole document is not a fragment. */
const MAX_FRAGMENT_CHARS = 40;

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
function findingsForPath(
  rawPath: string,
  safePath: string,
  parentRawPath: string,
  suppressMetakey: string | null = null,
): Finding[] {
  const inherited = new Set(parentRawPath === "" ? [] : nameHits(parentRawPath).map((h) => h.token));
  return nameHits(rawPath)
    .filter((h) => !inherited.has(h.token))
    .filter((h) => !(suppressMetakey !== null && h.tier === 3 && h.via === "field-name" && h.token === suppressMetakey))
    .map((h) => ({
      class: h.token,
      tier: h.tier,
      via: h.via,
      where: safePath,
    }));
}

/**
 * SIBLING FRAGMENTS — an IBAN that was never in any one field.
 *
 * `{ accountPartA: "DE8937040044", accountPartB: "X05320130" }` carries a
 * German IBAN and neither half reaches the pattern's 11-character minimum.
 * Six two-character fields carry the same IBAN and not one of them is a
 * finding. The record is not a record of fragments; it is a record of an IBAN
 * written down in pieces, and a mini-app that concatenates the pieces gets the
 * IBAN back. Splitting a value across keys is the value-side twin of splitting
 * a denied TOKEN across keys, which this walker has caught since day one
 * (`date.ofBirth`).
 *
 * Only the two STRUCTURED classes are considered on a join — an IBAN has a
 * country code and check digits, an email has a local part and a domain — so
 * an accidental join is unlikely to produce one. `digits`, `amount` and `date`
 * are deliberately excluded: concatenating two ordinary numbers produces a
 * longer number every time, and a gate that fires on every record of numbers
 * is the rubber-stamped gate again.
 *
 * ⚠ STATED FALSE-POSITIVE DIRECTION: a two-letter uppercase code stored beside
 * a long alphanumeric id can join into something the IBAN pattern accepts.
 * That over-refuses, which for an outbound gate is the safe direction, and the
 * finding names `iban` so a human can see what it thought it had.
 */
function fragmentFindings(entries: readonly [string, unknown][], where: string): Finding[] {
  const parts = entries
    .map(([, v]) => v)
    .filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_FRAGMENT_CHARS);
  if (parts.length < 2) return [];
  const joined = parts.join("");
  if (joined.length > MAX_JOIN_CHARS) return [];
  const already = new Set(parts.flatMap((p) => classifyText(p, where).map((f) => f.class)));
  const out: Finding[] = [];
  for (const f of classifyText(joined, where)) {
    if (f.class !== "iban" && f.class !== "email") continue;
    if (already.has(f.class)) continue;
    out.push({ class: f.class, tier: 3, via: "value-shape", where });
  }
  return out;
}

/**
 * classify — the public entry point. Accepts any JSON-shaped value: an object,
 * an array, a bare string, a number, a `Map`, a class instance.
 */
export function classify(input: unknown, options: ClassifyOptions = {}): Classification {
  const declaredNames = options.declaredNames ?? [];
  const keyAllowlist = options.keyAllowlist;
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const mode = options.mode ?? "record";
  const root = options.rootPath ?? "";
  const findings: Finding[] = [];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let truncated = false;

  /**
   * One string, read every way it can be read. This is the function the bug
   * at the top of this file was missing: it is the SAME scanner `markdown.ts`
   * gives a document, handed a value instead, plus the decodes and the
   * embedded structure.
   */
  const visitString = (value: string, rawPath: string, safePath: string, depth: number): void => {
    const where = safePath === "" ? "<root>" : safePath;
    // The prose AND code readings, unioned — a value can be either and a
    // scanner that guesses which is a scanner with a hole. This is the one
    // call that makes `{ payload: JSON.stringify(record) }` classify like
    // `record`.
    findings.push(...classifyProseAndCode(value, where));

    // In a schema, a field-pointer-shaped VALUE is a field name and gets the
    // host's denylists applied to it — that is where the disclosure lives.
    if (mode === "schema" && looksLikeFieldPointer(value)) {
      for (const h of nameHits(value)) {
        findings.push({ class: h.token, tier: h.tier, via: h.via, where });
      }
    }

    if (depth <= 0) return;

    // The serialised record: walked as the structure it is, so the findings
    // carry real paths rather than one line number.
    const embedded = parseEmbeddedJson(value);
    if (embedded !== null) {
      visit(embedded, joinPath(rawPath, "<json>"), joinPath(safePath, "<json>"), depth - 1);
    }

    // Decoded readings. Bounded and incomplete on purpose — `decodedVariants`
    // says exactly how incomplete.
    for (const decoded of decodedVariants(value)) {
      visitString(decoded, rawPath, safePath, depth - 1);
    }
  };

  const visit = (value: unknown, rawPath: string, safePath: string, depth = 3): void => {
    if (truncated) return;
    nodes += 1;
    if (nodes > maxNodes) {
      truncated = true;
      return;
    }

    if (typeof value === "string") {
      visitString(value, rawPath, safePath, depth);
      return;
    }
    if (value === null || value === undefined) return;
    if (typeof value === "bigint" || typeof value === "number" || typeof value === "boolean") {
      // A number is not scanned for patterns: the only class that could fire
      // on a bare integer is `digits`, and `digits` fires on every epoch
      // millisecond timestamp in every record in the system. What catches
      // `{ annualRemuneration: 82000 }` is the FIELD NAME, which is why the
      // Studio vocabulary in `lists.ts` exists. Stated, not hidden.
      return;
    }
    if (typeof value !== "object") return; // function, symbol

    if (seen.has(value)) return; // a cycle is the same data twice, already classified
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        // An index is a number: it needs no sanitising and leaks nothing.
        visit(item, joinPath(rawPath, `[${i}]`), joinPath(safePath, `[${i}]`), depth);
      });
      return;
    }

    // ── Containers `Object.entries` returns [] for ────────────────────────
    // `Object.entries(new Map(Object.entries(record)))` is `[]`, so a record
    // inside a Map was a silent early exit in a walker whose header promised
    // there were none. Same for a Set, same for a Date, same for a byte
    // array. Each of these is a second representation of data that reaches
    // exactly the same place.
    if (value instanceof Map) {
      let i = 0;
      for (const [k, v] of value) {
        const keyText = typeof k === "string" ? k : `[${i}]`;
        const safeKey =
          typeof k === "string" ? sanitizePathSegment(k, i, declaredNames, keyAllowlist) : `[${i}]`;
        const childRaw = joinPath(rawPath, keyText);
        const childSafe = joinPath(safePath, safeKey);
        if (typeof k === "string") {
          findings.push(...findingsForPath(childRaw, childSafe === "" ? "<root>" : childSafe, rawPath));
        } else {
          visit(k, joinPath(rawPath, `<key${i}>`), joinPath(safePath, `<key${i}>`), depth);
        }
        visit(v, childRaw, childSafe, depth);
        i += 1;
      }
      return;
    }
    if (value instanceof Set) {
      let i = 0;
      for (const v of value) {
        visit(v, joinPath(rawPath, `[${i}]`), joinPath(safePath, `[${i}]`), depth);
        i += 1;
      }
      return;
    }
    if (value instanceof Date) {
      // A date of birth held as a Date was invisible to a walker that only
      // scanned strings. Its ISO form is the same disclosure.
      // `T` is a word character, so `1987-04-12T00:00:00.000Z` does not match
      // the host's ISO date pattern — the `\b` after the day fails. The same
      // instant written with a space does. A representation that defeats the
      // pattern by one character is the theme of this file.
      if (!Number.isNaN(value.getTime())) {
        visitString(value.toISOString().replace("T", " "), rawPath, safePath, 0);
      }
      return;
    }
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
      const bytes =
        value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      if (bytes.byteLength > 0 && bytes.byteLength <= 65_536) {
        // `TextDecoder`, not `Buffer`: a WHATWG global that exists in the
        // host's browser bundle AND in Node, where `Buffer` only exists in
        // one of them. Same output — both substitute U+FFFD for invalid
        // sequences — and the replace below still strips those.
        visitString(new TextDecoder("utf-8").decode(bytes).replace(/�/g, " "), rawPath, safePath, 1);
      }
      return;
    }

    // ── Own properties, INCLUDING the non-enumerable ones ─────────────────
    // `Object.entries` returns own-enumerable keys only, so
    // `Object.defineProperty(carrier, "record", { enumerable: false, … })`
    // hid a whole record from a walk that visited "every node". A property
    // that a mini-app can read is a property this scanner has to read.
    //
    // ⚠ ACCESSORS ARE NOT INVOKED. Calling an arbitrary getter inside a
    // security scanner is a side effect the caller did not ask for, and a
    // getter can throw, block or mutate. A data property is read; an accessor
    // is reported as a location the scan could not see, at tier 3, which is
    // the fail-closed direction and is visible in the audit event rather than
    // silent.
    const entries: [string, unknown][] = [];
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) continue;
      if ("value" in descriptor) {
        entries.push([key, descriptor.value]);
      } else {
        findings.push({
          class: "unscanned-accessor",
          tier: 3,
          via: "value-shape",
          where: safePath === "" ? "<root>" : safePath,
        });
      }
    }

    entries.forEach(([key, child], ordinal) => {
      const safeKey = sanitizePathSegment(key, ordinal, declaredNames, keyAllowlist);
      const childRaw = joinPath(rawPath, key);
      const childSafe = joinPath(safePath, safeKey);
      const foldedKey = foldToken(key);
      const suppress = mode === "schema" && SCHEMA_METAKEYS.includes(foldedKey) ? foldedKey : null;
      const where = childSafe === "" ? "<root>" : childSafe;
      findings.push(...findingsForPath(childRaw, where, rawPath, suppress));
      // A person-referring field name over a name-shaped value. Both halves,
      // or nothing — see `PERSON_REFERENT_TOKENS`.
      if (typeof child === "string" && isPersonReferent(key) && looksLikePersonName(child)) {
        findings.push({ class: "personname", tier: 3, via: "value-shape", where });
      }
      visit(child, childRaw, childSafe, depth);
    });

    findings.push(...fragmentFindings(entries, safePath === "" ? "<root>" : safePath));
  };

  // The root path itself is classified before the walk: when a caller passes
  // `rootPath` (a file path, a table name), the NAME of the thing is as much
  // of a disclosure as its contents. It is sanitised segment by segment before
  // being reported, because a generated FILE NAME can carry a person as
  // readily as a field can — `fixtures/e.musterfrau@example.de.json` is a
  // disclosure in the path alone.
  const safeRoot = root === "" ? "" : sanitizePath(root, declaredNames);
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

  findings.push(...compositeFindings(findings));

  const deduped = dedupe(findings);
  return { tier: tierOf(deduped), findings: deduped };
}

/** Convenience for the common "is this allowed out of the building" question.
 * Categories 3 and 4 require explicit named-human approval; 1 and 2 do not. */
export function requiresApproval(tier: Classification["tier"]): boolean {
  return tier >= 3;
}

/**
 * The compiled-in class vocabulary — every `class` a finding from this package
 * can carry.
 *
 * It exists so the "a finding never invents a class name from the data"
 * property can be asserted against ONE list instead of against an import list
 * that has to be kept in step by hand. A class name that is not in here is a
 * value that escaped into a log line.
 */
export const FINDING_CLASSES: readonly string[] = [
  ...new Set<string>([
    ...PII_PATTERN_NAMES,
    ...PII_DENIED_SUBSTRINGS,
    ...PII_DENIED_SEGMENTS,
    ...BUSINESS_SEGMENTS,
    ...SPECIAL_CATEGORY_SUBSTRINGS,
    ...SPECIAL_CATEGORY_SEGMENTS,
    ...STUDIO_RESTRICTED_SUBSTRINGS,
    ...STUDIO_RESTRICTED_TOKENS,
    ...STUDIO_PERSONAL_TOKENS,
    ...RECORDING_PROVENANCE_TOKENS.map((t) => `provenance:${t}`),
    "scan-truncated",
    "unscanned-accessor",
  ]),
];
