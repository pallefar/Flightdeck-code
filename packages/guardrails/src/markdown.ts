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
import { classifyText, nameHits } from "./classify";

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

const KEY_VALUE = /^\s*(?:[-*+]\s+)?\*{0,2}\s*([A-Za-z][A-Za-z0-9 _/'-]{0,40}?)\s*\*{0,2}\s*[:=](?:\s|$)/;
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

export function classifyMarkdown(markdown: string, where = "<intake>"): Finding[] {
  const findings: Finding[] = [];

  // 1. Value shapes, anywhere in the document.
  findings.push(...classifyText(markdown, where));

  // 2. Field names, in label positions only.
  for (const label of labelsOf(markdown)) {
    for (const hit of nameHits(label.text)) {
      if (hit.tier === 2) continue; // business vocabulary in a label is not a finding
      findings.push({
        class: hit.token,
        tier: hit.tier,
        via: hit.via === "special-category" ? "special-category" : "label",
        where: `${where}:line ${label.line}`,
      });
    }
  }

  // 3. Unambiguous Art. 9 compounds and recording provenance, whole document.
  const normalized = normalizeDocument(markdown);
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
