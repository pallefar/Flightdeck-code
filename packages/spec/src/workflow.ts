/**
 * The Cowork-workflow reader: markdown in, a structured document out.
 *
 * In this codebase a workflow *is* a skill file - YAML frontmatter carrying `name` and a long
 * `description`, then prose sections, one of which (`## Procedure`) is a numbered list that
 * `skills/orchestrate-workflow/SKILL.md` drives as gates. Converting one into a mini app
 * starts here: this module only reads. It decides nothing about capabilities, nav sections or
 * refusals - that is `workflowPlan.ts`, which is where the contract rules live.
 *
 * Two constraints shape the module:
 *
 *  1. **The markdown arrives in the request body.** Studio runs inside Flightdeck OS as a
 *     sub-app, and a sub-app route reaches the host only through the injected capability
 *     adapter (`readContracts` / `writeInboxProposal` / `listOwnInboxProposals` /
 *     `auditAppend` / `resolveSigningAuthority`). None of those reads a file, so there is no
 *     `fs` here and there must never be one: reading the repo from a route is a capability
 *     escape (contract §5.3). The only input is a string somebody posted.
 *  2. **No YAML dependency.** The frontmatter these files use is a handful of top-level keys
 *     and folded block scalars, so it is parsed here rather than pulling a parser into a
 *     package whose whole point is to be deterministic and dependency-light. Anything richer
 *     than that is reported as an unread key, never half-guessed.
 *
 * Everything below is mechanical: splitting, folding, stripping inline markdown. A judgement
 * call - which section is the procedure when the document does not say - is surfaced as a
 * candidate list for the caller to ask about, not resolved in here.
 */

/** Frontmatter as read. `keys` holds every top-level scalar, including ones we do not use. */
export interface WorkflowFrontmatter {
  readonly name: string | null;
  readonly description: string | null;
  readonly keys: Readonly<Record<string, string>>;
}

export interface WorkflowSection {
  /** The heading text, without the `##`. */
  readonly heading: string;
  readonly level: number;
  readonly body: string;
  readonly lines: readonly string[];
}

/** One numbered item of the procedure, with its markdown flattened to readable English. */
export interface WorkflowStep {
  /** The document's own numbering - `1`, `2b`. Kept verbatim so the page matches the doc. */
  readonly ordinal: string;
  /** The bolded lead-in where the document has one, otherwise the opening clause. */
  readonly title: string;
  /** The rest of the item. Empty when the item is a single clause. */
  readonly detail: string;
  /** Title and detail rejoined - what the classifier reads. */
  readonly text: string;
  /** The item exactly as written, markdown and all, for evidence quotes. */
  readonly raw: string;
}

export interface WorkflowDoc {
  readonly frontmatter: WorkflowFrontmatter;
  /** The `#` heading, when the file has one. */
  readonly title: string | null;
  readonly sections: readonly WorkflowSection[];
  /** Which section the steps were taken from, and whether that took a guess. */
  readonly stepsSection: { readonly heading: string; readonly inferred: boolean } | null;
  readonly steps: readonly WorkflowStep[];
  /** Every section that carries a numbered list - the answer set when the document is unclear. */
  readonly stepSectionCandidates: readonly string[];
  /** The markdown as posted. Provenance for the generated files. */
  readonly source: string;
}

export type WorkflowParse =
  | { readonly ok: true; readonly doc: WorkflowDoc }
  | { readonly ok: false; readonly issues: readonly string[] };

export interface ParseWorkflowOptions {
  /**
   * The section heading to read steps from, when the document has no `## Procedure` and the
   * caller has since asked a person which one it is.
   */
  readonly stepsSection?: string;
}

/** The heading a Cowork workflow is expected to put its numbered steps under. */
export const PROCEDURE_HEADING = "Procedure";

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const STEP_RE = /^ {0,3}(\d{1,3}[a-z]?)[.)]\s+(.+)$/;
const FENCE_RE = /^\s*(?:```|~~~)/;

const isBlank = (line: string): boolean => line.trim() === "";

/** Folded scalars keep paragraph breaks and drop single newlines, the way YAML's `>` does. */
function foldBlock(lines: readonly string[], literal: boolean): string {
  if (literal) {
    return lines.map((line) => line.trim()).join("\n").trim();
  }
  const out: string[] = [];
  for (const line of lines) {
    if (isBlank(line)) {
      out.push("\n\n");
      continue;
    }
    if (out.length > 0 && !out[out.length - 1]?.endsWith("\n")) {
      out.push(" ");
    }
    out.push(line.trim());
  }
  return out.join("").trim();
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed.charAt(0);
    const last = trimmed.charAt(trimmed.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/**
 * Reads the top-level `key: value` pairs of a skill's frontmatter, including `>`/`|` block
 * scalars. Nested mappings and sequences are skipped rather than flattened - a key we cannot
 * read honestly is a key we do not report.
 */
function parseFrontmatter(lines: readonly string[]): WorkflowFrontmatter {
  const keys: Record<string, string> = {};
  const keyRe = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const match = keyRe.exec(line);
    if (!match) {
      continue;
    }
    const key = match[1] ?? "";
    const inline = (match[2] ?? "").trim();

    if (inline === "" || /^[>|][-+]?\d*$/.test(inline)) {
      const block: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        const next = lines[j] ?? "";
        if (isBlank(next)) {
          block.push(next);
          continue;
        }
        if (!/^\s/.test(next)) {
          break;
        }
        block.push(next);
      }
      i = j - 1;
      const folded = foldBlock(block, inline.startsWith("|"));
      if (folded !== "") {
        keys[key] = folded;
      }
      continue;
    }
    keys[key] = unquote(inline);
  }

  return {
    name: keys["name"] ?? null,
    description: keys["description"] ?? null,
    keys,
  };
}

/** `**Read state**` -> `Read state`; `` `manifest.json` `` -> `manifest.json`. */
export function flattenInline(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const TITLE_LIMIT = 120;

/** Trailing separators a title should not keep once the detail has been split off. */
const TRAILING_PUNCTUATION = /[\s.,;:—–-]+$/;

/**
 * Splits an item into a title and the rest. A bolded lead-in is the document telling us where
 * the split is; without one we take the opening clause up to an em dash, colon or sentence end
 * and fall back to a word-boundary cut. No meaning is invented either way.
 */
function splitTitle(raw: string): { title: string; detail: string } {
  const bold = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*[,—–:-]?\s*([\s\S]*)$/.exec(raw);
  if (bold) {
    const title = flattenInline(bold[1] ?? "").replace(TRAILING_PUNCTUATION, "");
    if (title !== "" && title.length <= TITLE_LIMIT) {
      return { title, detail: flattenInline(bold[2] ?? "") };
    }
  }

  const flat = flattenInline(raw);
  const separator = /\s(?:—|–)\s|:\s|;\s|\.\s/.exec(flat.slice(0, TITLE_LIMIT + 20));
  if (separator && separator.index > 0) {
    const head = flat.slice(0, separator.index).replace(TRAILING_PUNCTUATION, "");
    if (head !== "" && head.length <= TITLE_LIMIT) {
      return { title: head, detail: flat.slice(separator.index + separator[0].length).trim() };
    }
  }

  if (flat.length <= TITLE_LIMIT) {
    return { title: flat.replace(TRAILING_PUNCTUATION, ""), detail: "" };
  }
  const cut = flat.lastIndexOf(" ", TITLE_LIMIT);
  const head = flat.slice(0, cut > 20 ? cut : TITLE_LIMIT).replace(TRAILING_PUNCTUATION, "");
  return { title: head, detail: flat.slice(head.length).trim() };
}

/**
 * Pulls the numbered items out of one section body. A line is a new item when it starts with
 * `1.`/`2b.`; anything indented under it belongs to it. Un-indented prose ends the item, so a
 * closing paragraph never gets glued onto the last step.
 */
function readSteps(lines: readonly string[]): WorkflowStep[] {
  const steps: WorkflowStep[] = [];
  let ordinal: string | null = null;
  let buffer: string[] = [];
  let pendingBlank = false;
  let fenced = false;

  const flush = (): void => {
    if (ordinal === null) {
      return;
    }
    const raw = buffer.join("\n").trim();
    const { title, detail } = splitTitle(raw);
    const text = detail === "" ? title : `${title} ${detail}`;
    steps.push({ ordinal, title, detail, text, raw });
    ordinal = null;
    buffer = [];
  };

  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      fenced = !fenced;
      if (ordinal !== null) {
        buffer.push(line);
      }
      continue;
    }
    if (fenced) {
      if (ordinal !== null) {
        buffer.push(line);
      }
      continue;
    }

    const step = STEP_RE.exec(line);
    if (step) {
      flush();
      pendingBlank = false;
      ordinal = step[1] ?? null;
      buffer = [step[2] ?? ""];
      continue;
    }

    if (ordinal === null) {
      continue;
    }
    if (isBlank(line)) {
      pendingBlank = true;
      continue;
    }
    if (/^\s{2,}\S/.test(line)) {
      if (pendingBlank) {
        buffer.push("");
        pendingBlank = false;
      }
      buffer.push(line.trim());
      continue;
    }
    flush();
    pendingBlank = false;
  }

  flush();
  return steps;
}

function splitSections(lines: readonly string[]): { title: string | null; sections: WorkflowSection[] } {
  let title: string | null = null;
  const sections: WorkflowSection[] = [];
  let current: { heading: string; level: number; lines: string[] } | null = null;
  let fenced = false;

  const close = (): void => {
    if (current) {
      sections.push({
        heading: current.heading,
        level: current.level,
        lines: [...current.lines],
        body: current.lines.join("\n").trim(),
      });
      current = null;
    }
  };

  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      fenced = !fenced;
      current?.lines.push(line);
      continue;
    }
    const heading = fenced ? null : HEADING_RE.exec(line);
    if (heading) {
      const level = (heading[1] ?? "#").length;
      const text = flattenInline(heading[2] ?? "");
      if (level === 1 && title === null) {
        close();
        title = text;
        continue;
      }
      close();
      current = { heading: text, level, lines: [] };
      continue;
    }
    current?.lines.push(line);
  }

  close();
  return { title, sections };
}

const headingMatches = (heading: string, wanted: string): boolean =>
  heading.toLowerCase().replace(/\s+/g, " ").trim() === wanted.toLowerCase();

/**
 * Reads a Cowork workflow. Returns `ok: false` only when there is nothing to convert - an
 * empty body, no headings at all, or no numbered list anywhere. A document that merely leaves
 * a judgement open parses fine and carries the candidates in `stepSectionCandidates`.
 */
export function parseWorkflowMarkdown(markdown: string, options: ParseWorkflowOptions = {}): WorkflowParse {
  if (typeof markdown !== "string" || markdown.trim() === "") {
    return { ok: false, issues: ["the workflow body was empty - post the skill's markdown, not a file path"] };
  }

  const normalized = markdown.replace(/\r\n?/g, "\n");
  const allLines = normalized.split("\n");

  let frontmatterLines: string[] = [];
  let bodyLines = allLines;
  let firstContent = 0;
  while (firstContent < allLines.length && isBlank(allLines[firstContent] ?? "")) {
    firstContent += 1;
  }
  if ((allLines[firstContent] ?? "").trim() === "---") {
    const end = allLines.findIndex((line, index) => index > firstContent && line.trim() === "---");
    if (end > firstContent) {
      frontmatterLines = allLines.slice(firstContent + 1, end);
      bodyLines = allLines.slice(end + 1);
    }
  }

  const frontmatter = parseFrontmatter(frontmatterLines);
  const { title, sections } = splitSections(bodyLines);

  const candidates = sections.filter((section) => readSteps(section.lines).length > 0);
  const candidateHeadings = candidates.map((section) => section.heading);

  const asked = options.stepsSection?.trim() ?? "";
  const chosen =
    asked !== ""
      ? candidates.find((section) => headingMatches(section.heading, asked)) ?? null
      : candidates.find((section) => headingMatches(section.heading, PROCEDURE_HEADING)) ?? null;

  let stepsSection: WorkflowDoc["stepsSection"] = null;
  let steps: WorkflowStep[] = [];

  if (chosen) {
    stepsSection = { heading: chosen.heading, inferred: false };
    steps = readSteps(chosen.lines);
  } else if (asked !== "") {
    return {
      ok: false,
      issues: [
        `the workflow has no section called "${asked}" that carries a numbered list${
          candidateHeadings.length > 0 ? ` - it has ${candidateHeadings.map((h) => `"${h}"`).join(", ")}` : ""
        }`,
      ],
    };
  } else if (candidates.length === 1) {
    const only = candidates[0];
    if (only) {
      stepsSection = { heading: only.heading, inferred: true };
      steps = readSteps(only.lines);
    }
  } else if (candidates.length === 0) {
    return {
      ok: false,
      issues: [
        'the workflow has no numbered steps - a Cowork workflow carries a "## Procedure" section of numbered steps',
      ],
    };
  }

  return {
    ok: true,
    doc: {
      frontmatter,
      title,
      sections,
      stepsSection,
      steps,
      stepSectionCandidates: candidateHeadings,
      source: normalized,
    },
  };
}
