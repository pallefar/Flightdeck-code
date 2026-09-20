/** The conformance gate's findings, in full.
 *
 * ── WHY "RULES THAT RAN" IS ON THE SCREEN ───────────────────────────
 * `0 errors` is ambiguous and the ambiguity is dangerous: it reads the
 * same whether thirty rules ran and passed or whether the gate never
 * executed. The gate itself reports which rules it ran precisely so a
 * caller can tell those apart, and throwing that away in the UI wastes the
 * one thing that makes a clean result trustworthy. So the summary counts
 * rules that ran and came back clean, and says so when it cannot. */
import type { GateSummary } from "../selectors";
import type { Candidate, Finding, Severity } from "../types";

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
  if (candidate === null) {
    return <div className="fd-empty">No round selected.</div>;
  }

  const findings =
    filter === "all" ? candidate.findings : candidate.findings.filter((f) => f.severity === filter);
  const sorted = [...findings].sort((a, b) =>
    a.severity === b.severity ? a.file.localeCompare(b.file) || a.line - b.line : a.severity === "error" ? -1 : 1,
  );

  return (
    <div className="fd-gate">
      <div className="fd-gate__summary">
        <Stat n={summary.errors} k="blocking" tone={summary.errors > 0 ? "error" : "ok"} />
        <Stat n={summary.warnings} k="warnings" tone={summary.warnings > 0 ? "warn" : "ok"} />
        <Stat n={summary.rulesClean} k="rules clean" tone="ok" />
        <Stat n={summary.rulesRun} k="rules run" tone="plain" />
      </div>

      {summary.rulesRun === 0 ? (
        <p className="fd-note fd-note--warn">
          The gate reported no rules at all. That is not a pass — it means nothing was checked. Treat this
          candidate as unreviewed.
        </p>
      ) : summary.shippable ? (
        <p className="fd-note">
          Nothing blocking. {summary.rulesClean} of {summary.rulesRun} rules ran and found nothing; the rest
          raised the warnings below.
        </p>
      ) : (
        <p className="fd-note fd-note--warn">
          {summary.errors} finding{summary.errors === 1 ? "" : "s"} would refuse this write. A generated
          manifest that breaks the host's schema takes the whole server down at boot, by design — which is why
          these block rather than warn.
        </p>
      )}

      {candidate.notes.map((note, i) => (
        <p className="fd-note" key={i}>
          {note}
        </p>
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

      {sorted.map((finding, i) => (
        <FindingCard
          key={`${finding.rule}-${finding.file}-${finding.line}-${i}`}
          finding={finding}
          focused={finding.rule === focusedRule}
          onFocus={onFocusRule}
          onReveal={onReveal}
        />
      ))}
    </div>
  );
}

function Stat({
  n,
  k,
  tone,
}: {
  readonly n: number;
  readonly k: string;
  readonly tone: "error" | "warn" | "ok" | "plain";
}) {
  return (
    <div className={`fd-stat${tone === "plain" ? "" : ` fd-stat--${tone}`}`}>
      <div className="fd-stat__n mono">{n}</div>
      <div className="fd-stat__k">{k}</div>
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
      <span className="fd-finding__rule">{finding.rule}</span>
      <span className="fd-finding__msg">{finding.message}</span>
      <span className="fd-finding__where">
        {finding.file}
        {finding.line > 0 ? `:${finding.line}:${finding.column}` : " — about the file set"}
      </span>
      {finding.evidence !== null && <span className="fd-finding__ev">{finding.evidence}</span>}
    </button>
  );
}
