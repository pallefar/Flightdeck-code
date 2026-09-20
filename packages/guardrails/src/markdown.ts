/**
 * Scanning PROSE, where there are no field names to read.
 *
 * `classify()` is structure-aware: it knows a key from a value, so it can
 * apply the host's field-NAME denylists to keys and the host's value patterns
 * to values. A pasted Cowork workflow is markdown. It has no keys.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE LINE THIS FILE DRAWS, AND WHY IT IS WHERE IT IS
 * ─────────────────────────────────────────────────────────────────────────
 * The tempting implementation is to normalize the whole document and
 * substring-search every denylist against it. It is also useless, and the
 * single word that proves it is `address`: it is in `PII_DENIED_SUBSTRINGS`,
 * and "address the works-council question" is an ordinary sentence in every
 * workflow doc in this repo. A gate that refuses every document is a gate that
 * gets switched off in week one, and a switched-off gate protects nobody. The
 * host made the same judgement in the opposite direction and wrote it down —
 * `PII_DENIED_SEGMENTS` exists as a separate tier precisely because "city must
 * not block capacity".
 *
 * So three scopes, each matched where it is actually meaningful:
 *
 *   PII_PATTERNS            → the WHOLE document. They are value SHAPES. An
 *                             IBAN in prose is an IBAN.
 *   PII_DENIED_* field names → LABEL POSITIONS only (`Salary: …`, a table
 *                             header, a YAML key, a JSON key in a fence).
 *                             In a label, `salary` is a field. In a sentence,
 *                             it is a word.
 *   Art. 9 compounds        → the WHOLE document, normalized. "trade union
 *                             membership" does not occur by accident, and
 *                             normalizing joins it into `tradeunionmembership`
 *                             so the spacing of the prose does not matter.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LABELS ARE DATA TOO
 * ─────────────────────────────────────────────────────────────────────────
 * A transcript's labels are speaker names. So a finding from a label reports
 * the DENYLIST TOKEN it matched (a compiled-in constant) and a LINE NUMBER,
 * never the label text. Same rule as everywhere else in this package.
 */

import {
  PII_DENIED_SEGMENTS,
  PII_DENIED_SUBSTRINGS,
  SPECIAL_CATEGORY_SEGMENTS,
  SPECIAL_CATEGORY_SUBSTRINGS,
  normalizeToken,
} from "./lists";
import { type Finding, dedupe } from "./findings";
import { SCHEMA_METAKEYS, classifyText, looksLikeFieldPointer, nameHits } from "./classify";

/**
 * Provenance markers: a document that describes itself as coming from a
 * recording or an activity log is presumed to carry person data whether or
 * not a pattern fires.
 *
 * Sourced from the repo's own standing guardrail for this exact feature,
 * `.planning/todos/pending/2026-08-01-workflow-recorder-miniapps-subapp.md`:
 *
 *     "Recordings may contain PII (screen/voice) — same PII flag as the
 *      Signavio idea; human-approved-draft before anything executes."
 *
 * Tier 3, not 4: the claim is "this needs a named human to look", which is
 * exactly what tier 3 means here. Raising it to 4 would say the document
 * definitely contains restricted data, which this cannot know.
 */
export const RECORDING_PROVENANCE_TOKENS: readonly string[] = [
  "screenrecording",
  "voicerecording",
  "audiorecording",
  "sessionrecording",
  "recordedsession",
  "transcript",
  "activitylog",
  "dailylog",
  "screenshare",
  "callrecording",
];

interface Label {
  readonly text: string;
  readonly line: number;
}

/** `Salary: …`, `- **Salary:** …`, `**Date of birth:**  …`, `Salary = …`.
 * The trailing `\**` is not cosmetic: markdown bolds a label as `**Salary:**`,
 * so the emphasis markers sit AFTER the colon and a pattern that demanded
 * whitespace there matched none of the labels in a real pasted workflow. */
const KEY_VALUE = /^\s*(?:[-*+]\s+)?\*{0,2}\s*([A-Za-z][A-Za-z0-9 _/'-]{0,40}?)\s*\*{0,2}\s*[:=]\**(?:\s|$)/;
const JSON_KEY = /"([A-Za-z_][A-Za-z0-9_-]{0,40})"\s*:/g;

/** Label-position tokens, with the 1-based line they were found on. */
export function labelsOf(markdown: string): Label[] {
  const out: Label[] = [];
  const lines = markdown.split(/\r?\n/);
  lines.forEach((line, i) => {
    const n = i + 1;
    const kv = KEY_VALUE.exec(line);
    if (kv?.[1]) out.push({ text: kv[1], line: n });
    if (line.includes("|")) {
      // A table row. Every cell is a candidate label: a header row names the
      // columns, and a two-column key/value table names them in column one.
      for (const cell of line.split("|")) {
        const t = cell.trim().replace(/^\*+|\*+$/g, "");
        if (t && /^[A-Za-z][A-Za-z0-9 _/'-]{0,40}$/.test(t)) out.push({ text: t, line: n });
      }
    }
    for (const m of line.matchAll(JSON_KEY)) {
      if (m[1]) out.push({ text: m[1], line: n });
    }
  });
  return out;
}

/** Whole-document, normalized: letters and digits only, so wording and
 * punctuation cannot hide a compound token. */
function normalizeDocument(markdown: string): string {
  return normalizeToken(markdown);
}

/**
 * PROSE vs CODE — two conventions for where a field name lives, and a scanner
 * that knows only one of them has a hole in it.
 *
 *   prose  `**Salary:** €82.000`     — a label at the start of a line.
 *   code   `const rows = [{ salaryEur: 82000 }];`
 *                                     — an unquoted identifier key, mid-line.
 *
 * Scanning emitted TypeScript with the prose rules was a real hole, caught by
 * `__tests__/second-path.test.ts`: the JSON fixture copy of a record was
 * refused because its keys are quoted, while the IDENTICAL data in the `.ts`
 * file beside it was allowed, because a `.ts` object literal does not quote
 * its keys. That is the SEC-V5-02 shape with the two paths one directory
 * apart — the same data, one copy seen and one not, the suite green.
 *
 * The two styles also differ on `name`, in opposite directions and for good
 * reasons in both cases:
 *   - in a workflow doc, `Name:` labels a person, so it is a tier-3 finding;
 *   - in generated code, `name:` is the schema metakey of a table or column,
 *     and the field name is the VALUE beside it. See `SCHEMA_METAKEYS`.
 */
export type TextStyle = "prose" | "code";

/** Unquoted identifier keys: `salaryEur:`, `{ iban:`, `, dob:`. Anchored on a
 * preceding delimiter so `http://x` and a ternary's `? a : b` do not register.
 * Global and mid-line, unlike the prose label rules. */
const CODE_KEY = /(?:^|[{,;(\[\s])([A-Za-z_$][A-Za-z0-9_$]{0,40})\s*:/gm;
/** String and template literals, short enough to be an identifier. */
const CODE_LITERAL = /["'`]([^"'`\n]{1,64})["'`]/g;

function scanText(text: string, where: string, style: TextStyle): Finding[] {
  const findings: Finding[] = [];

  // 1. Value shapes, anywhere in the text. Style-independent: an IBAN is an
  //    IBAN in a sentence, in a comment and in a string literal.
  findings.push(...classifyText(text, where));

  // 2. Field names, wherever this style puts them.
  const push = (token: string, tier: 2 | 3 | 4, via: "field-name" | "special-category", at: string): void => {
    if (tier === 2) return; // business vocabulary is not a finding in free text
    findings.push({
      class: token,
      tier,
      via: via === "special-category" ? "special-category" : "label",
      where: at,
    });
  };

  if (style === "prose") {
    for (const label of labelsOf(text)) {
      for (const hit of nameHits(label.text)) push(hit.token, hit.tier, hit.via, `${where}:line ${label.line}`);
    }
  } else {
    const lineAt = (index: number): number => text.slice(0, index).split("\n").length;
    for (const m of text.matchAll(CODE_KEY)) {
      const key = m[1];
      if (!key) continue;
      const metakey = SCHEMA_METAKEYS.includes(normalizeToken(key));
      for (const hit of nameHits(key)) {
        // A metakey's own tier-3 segment hit is suppressed; the field name is
        // the value beside it, picked up by the literal pass below. A tier-4
        // substring hit is never suppressed.
        if (metakey && hit.tier === 3 && hit.via === "field-name") continue;
        push(hit.token, hit.tier, hit.via, `${where}:line ${lineAt(m.index ?? 0)}`);
      }
    }
    for (const m of text.matchAll(CODE_LITERAL)) {
      const literal = m[1];
      if (!literal || !looksLikeFieldPointer(literal)) continue;
      for (const hit of nameHits(literal)) push(hit.token, hit.tier, hit.via, `${where}:line ${lineAt(m.index ?? 0)}`);
    }
  }

  // 3. Unambiguous Art. 9 compounds and recording provenance, whole text.
  const normalized = normalizeDocument(text);
  for (const token of SPECIAL_CATEGORY_SUBSTRINGS) {
    if (normalized.includes(token)) {
      findings.push({ class: token, tier: 4, via: "special-category", where });
    }
  }
  for (const token of RECORDING_PROVENANCE_TOKENS) {
    if (normalized.includes(token)) {
      findings.push({ class: `provenance:${token}`, tier: 3, via: "label", where });
    }
  }

  return dedupe(findings);
}

/** A pasted Cowork workflow, a README, a comment — prose rules. */
export function classifyMarkdown(markdown: string, where = "<intake>"): Finding[] {
  return scanText(markdown, where, "prose");
}

/** Emitted source, tests, fixtures, snapshots — code rules. */
export function classifyCode(source: string, where = "<artifact>"): Finding[] {
  return scanText(source, where, "code");
}

/** Exported so a caller can see exactly which vocabularies prose is judged
 * against, without reading this file. Documentation that cannot go stale. */
export const PROSE_SCOPES = {
  wholeDocument: ["PII_PATTERNS", "SPECIAL_CATEGORY_SUBSTRINGS", "RECORDING_PROVENANCE_TOKENS"],
  labelPositionOnly: ["PII_DENIED_SUBSTRINGS", "PII_DENIED_SEGMENTS", "SPECIAL_CATEGORY_SEGMENTS"],
  counts: {
    deniedSubstrings: PII_DENIED_SUBSTRINGS.length,
    deniedSegments: PII_DENIED_SEGMENTS.length,
    specialSubstrings: SPECIAL_CATEGORY_SUBSTRINGS.length,
    specialSegments: SPECIAL_CATEGORY_SEGMENTS.length,
  },
} as const;
