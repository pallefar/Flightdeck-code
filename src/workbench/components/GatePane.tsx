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
import type { FileGateVerdict } from "../download";
import type { GateSummary } from "../selectors";
import type { Candidate, Finding, Severity } from "../types";
import { LineIcon, type LineIconName } from "./LineIcon";
import { Note } from "./Note";

/** The gate over the files as the person SAVED them — the verdict the
 * "Download candidate" button follows. `verdict: null` is a gate that could
 * not run. */
export interface EditedGate {
  readonly verdict: FileGateVerdict | null;
  readonly summary: GateSummary;
}

interface Props {
  readonly candidate: Candidate | null;
  /** Studio's own verdict, on the text it generated. */
  readonly summary: GateSummary;
  /** Present only when saved edits change the file set. It then leads the
   * pane, and Studio's verdict follows it as a second section — before this
   * the pane showed Studio's verdict alone, so a saved edit that broke the
   * host's schema left this tab clean while the Download button refused. */
  readonly edited?: EditedGate | undefined;
  readonly filter: Severity | "all";
  readonly focusedRule: string | null;
  readonly onFilter: (filter: Severity | "all") => void;
  readonly onFocusRule: (rule: string | null) => void;
  readonly onReveal: (path: string) => void;
}

export function GatePane({
  candidate,
  summary,
  edited,
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

  const shared = { filter, focusedRule, onFilter, onFocusRule, onReveal };
  const studio = (
    <Verdict whose="studio" findings={candidate.findings} summary={summary} notes={candidate.notes} {...shared} />
  );

  if (edited === undefined) {
    return (
      <div className="fd-gate" ref={gateRef}>
        {studio}
      </div>
    );
  }

  return (
    <div className="fd-gate" ref={gateRef}>
      <section aria-label="Your edited files">
        <h2 className="fd-side__h">Your edited files</h2>
        <p className="fd-ledger__note">
          The gate, run again over the files as you saved them. This is the verdict "Download candidate" follows.
        </p>
        {edited.verdict === null ? (
          <Note warn>
            The conformance gate could not run on your edited files. That is not a pass — treat them as blocking;
            nothing can be downloaded until it runs.
          </Note>
        ) : (
          <Verdict whose="edited" findings={edited.verdict.findings} summary={edited.summary} notes={[]} {...shared} />
        )}
      </section>
      <section aria-label="Studio's generation">
        <h2 className="fd-side__h">Studio&apos;s generation</h2>
        <p className="fd-ledger__note">Studio&apos;s own verdict on the text it generated this round, before your edits.</p>
        {studio}
      </section>
    </div>
  );
}

/** One verdict: the tiles, what they mean, the filter and the findings.
 * `whose` changes only the words — what a blocking finding refuses, and
 * whose files the gate ran over. The filter is one state for the pane, so
 * with two sections it filters both. */
function Verdict({
  whose,
  findings,
  summary,
  notes,
  filter,
  focusedRule,
  onFilter,
  onFocusRule,
  onReveal,
}: {
  readonly whose: "studio" | "edited";
  readonly findings: readonly Finding[];
  readonly summary: GateSummary;
  readonly notes: readonly string[];
  readonly filter: Severity | "all";
  readonly focusedRule: string | null;
  readonly onFilter: (filter: Severity | "all") => void;
  readonly onFocusRule: (rule: string | null) => void;
  readonly onReveal: (path: string) => void;
}) {
  const sorted = shownFindings(findings, filter);
  const refused = whose === "edited" ? "the download" : "this write";

  return (
    <>
      <div className="fd-gate__summary">
        <Stat
          n={summary.errors}
          k="blocking"
          tone={summary.errors > 0 ? "error" : "ok"}
          caption={whose === "edited" ? "Findings that block the download" : "Findings that would refuse this write"}
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
          {summary.errors} finding{summary.errors === 1 ? "" : "s"} would refuse {refused}. A generated
          manifest that breaks the host's schema takes the whole server down at boot, by design — which is why
          these block rather than warn.
        </Note>
      )}

      {notes.map((note, i) => (
        <Note key={i}>{note}</Note>
      ))}

      <div
        className="fd-filter"
        role="group"
        aria-label={whose === "edited" ? "Filter the findings on your edited files by severity" : "Filter findings by severity"}
      >
        {(["all", "error", "warning"] as const).map((value) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => onFilter(value)}>
            {value === "all" ? `All (${findings.length})` : value === "error" ? `Blocking (${summary.errors})` : `Warnings (${summary.warnings})`}
          </button>
        ))}
      </div>

      {sorted.length === 0 && (
        <p className="fd-ledger__note">
          {findings.length === 0
            ? whose === "edited"
              ? "The gate raised nothing on your edited files."
              : "The gate raised nothing on this candidate."
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
    </>
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
