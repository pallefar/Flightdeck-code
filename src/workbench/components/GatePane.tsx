/** The conformance gate's findings, in full.
 *
 * ── WHY "RULES THAT RAN" IS ON THE SCREEN ───────────────────────────
 * `0 errors` is ambiguous and the ambiguity is dangerous: it reads the
 * same whether thirty rules ran and passed or whether the gate never
 * executed. The gate itself reports which rules it ran precisely so a
 * caller can tell those apart, and throwing that away in the UI wastes the
 * one thing that makes a clean result trustworthy. So the summary counts
 * rules that ran and came back clean, and says so when it cannot. */
import { useRef } from "react";
import { useArriveInserted } from "../../motion/useMotion";
import type { GateSummary } from "../selectors";
import type { Candidate, Finding, Severity } from "../types";
import { LineIcon, type LineIconName } from "./LineIcon";
import { Note } from "./Note";

interface Props {
  readonly candidate: Candidate | null;
  readonly summary: GateSummary;
  readonly filter: Severity | "all";
  readonly focusedRule: string | null;
  readonly onFilter: (filter: Severity | "all") => void;
  readonly onFocusRule: (rule: string | null) => void;
  readonly onReveal: (path: string) => void;
}

export function GatePane({
  candidate,
  summary,
  filter,
  focusedRule,
  onFilter,
  onFocusRule,
  onReveal,
}: Props) {
  // A filter that brings other findings brings them arriving, as Atlas's
  // project cards do under its filter tabs. Decoration only (src/motion/).
  const gateRef = useRef<HTMLDivElement>(null);
  useArriveInserted(gateRef, ".fd-finding", filter);

  if (candidate === null) {
    return <div className="fd-empty">No round selected.</div>;
  }

  const sorted = shownFindings(candidate.findings, filter);

  return (
    <div className="fd-gate" ref={gateRef}>
      <div className="fd-gate__summary">
        <Stat
          n={summary.errors}
          k="blocking"
          tone={summary.errors > 0 ? "error" : "ok"}
          caption="Findings that would refuse this write"
        />
        <Stat
          n={summary.warnings}
          k="warnings"
          tone={summary.warnings > 0 ? "warn" : "ok"}
          caption="Raised, but not blocking"
        />
        <Stat n={summary.rulesClean} k="rules clean" tone="ok" caption="Ran and found nothing" />
        <Stat n={summary.rulesRun} k="rules run" tone="plain" caption="Rules the gate executed" />
      </div>

      {summary.rulesRun === 0 ? (
        <Note warn>
          The gate reported no rules at all. That is not a pass — it means nothing was checked. Treat this
          candidate as unreviewed.
        </Note>
      ) : summary.shippable ? (
        <Note>
          Nothing blocking. {summary.rulesClean} of {summary.rulesRun} rules ran and found nothing; the rest
          raised the warnings below.
        </Note>
      ) : (
        <Note warn>
          {summary.errors} finding{summary.errors === 1 ? "" : "s"} would refuse this write. A generated
          manifest that breaks the host's schema takes the whole server down at boot, by design — which is why
          these block rather than warn.
        </Note>
      )}

      {candidate.notes.map((note, i) => (
        <Note key={i}>{note}</Note>
      ))}

      <div className="fd-filter" role="group" aria-label="Filter findings by severity">
        {(["all", "error", "warning"] as const).map((value) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => onFilter(value)}>
            {value === "all" ? `All (${candidate.findings.length})` : value === "error" ? `Blocking (${summary.errors})` : `Warnings (${summary.warnings})`}
          </button>
        ))}
      </div>

      {sorted.length === 0 && (
        <p className="fd-ledger__note">
          {candidate.findings.length === 0
            ? "The gate raised nothing on this candidate."
            : "No findings at this severity."}
        </p>
      )}

      {sorted.map(({ key, finding }) => (
        <FindingCard
          key={key}
          finding={finding}
          focused={finding.rule === focusedRule}
          onFocus={onFocusRule}
          onReveal={onReveal}
        />
      ))}
    </div>
  );
}

/** The findings `filter` shows, blocking first, then by file and line, each
 * with a React key that does not depend on the filter.
 *
 * ── WHY THE KEY IS NOT THE CARD'S PLACE IN THE LIST ─────────────────
 * useArriveInserted plays `arrive` on a card whose ELEMENT is new, and React
 * keeps a card's element only while its key stays the same. A key that
 * carried the card's place in the filtered list changed whenever a filter
 * moved a card that stayed (All -> Warnings moves every warning up), so
 * React remounted it and it faded out and rose back in although it never
 * left. So the key is what the finding is: rule, file, line and column,
 * plus a count for exact duplicates. That count runs over ALL of the
 * candidate's findings, never the filtered list, so a finding keeps its key
 * under every filter. Exported for the tests. */
export function shownFindings(
  findings: readonly Finding[],
  filter: Severity | "all",
): ReadonlyArray<{ readonly key: string; readonly finding: Finding }> {
  const seen = new Map<string, number>();
  const keyed = findings.map((finding) => {
    const base = `${finding.rule}-${finding.file}-${finding.line}-${finding.column}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { key: n === 0 ? base : `${base}#${n}`, finding };
  });
  return keyed
    .filter(({ finding }) => filter === "all" || finding.severity === filter)
    .sort(({ finding: a }, { finding: b }) =>
      a.severity === b.severity ? a.file.localeCompare(b.file) || a.line - b.line : a.severity === "error" ? -1 : 1,
    );
}

/** The corner icon for a tile's tone. It is not decoration: Atlas's
 * `.metric > strong` takes no colour at all, so the tone that used to be
 * a green/amber/red NUMBER has to land somewhere, and Atlas's answer is
 * the icon in the label row. Shape carries it — an octagon for something
 * that stops you, a triangle for something that warns you, a tick for
 * something that passed, a checklist for a plain count — which also
 * survives a monochrome print and a red/green colour deficiency, neither
 * of which the coloured number did. */
const TONE_ICONS: Readonly<Record<"error" | "warn" | "ok" | "plain", LineIconName>> = {
  error: "octagon-alert",
  warn: "triangle-alert",
  ok: "circle-check",
  plain: "list-checks",
};

function Stat({
  n,
  k,
  tone,
  caption,
}: {
  readonly n: number;
  readonly k: string;
  readonly tone: "error" | "warn" | "ok" | "plain";
  /** The line under the number, as Atlas's `.metric > span` carries. A
   * tile that says only "45 / rules run" leaves a reader to guess whether
   * that is a good number. */
  readonly caption: string;
}) {
  return (
    <div className={`fd-stat${tone === "plain" ? "" : ` fd-stat--${tone}`}`}>
      <div className="fd-stat__k">
        {k}
        <LineIcon name={TONE_ICONS[tone]} size={15} />
      </div>
      <div className="fd-stat__n">{n}</div>
      <div className="fd-stat__cap">{caption}</div>
    </div>
  );
}

function FindingCard({
  finding,
  focused,
  onFocus,
  onReveal,
}: {
  readonly finding: Finding;
  readonly focused: boolean;
  readonly onFocus: (rule: string | null) => void;
  readonly onReveal: (path: string) => void;
}) {
  return (
    <button
      type="button"
      className={`fd-finding fd-finding--${finding.severity}`}
      style={focused ? { borderColor: "var(--accent)" } : undefined}
      onClick={() => onReveal(finding.file)}
      onMouseEnter={() => onFocus(finding.rule)}
      onMouseLeave={() => onFocus(null)}
      onFocus={() => onFocus(finding.rule)}
      onBlur={() => onFocus(null)}
    >
      <span className="fd-finding__rule">
        <LineIcon name={finding.severity === "error" ? "octagon-alert" : "triangle-alert"} size={15} />
        {finding.rule}
      </span>
      <span className="fd-finding__msg">{finding.message}</span>
      <span className="fd-finding__where">
        {finding.file}
        {finding.line > 0 ? `:${finding.line}:${finding.column}` : " — about the file set"}
      </span>
      {finding.evidence !== null && <span className="fd-finding__ev">{finding.evidence}</span>}
    </button>
  );
}
