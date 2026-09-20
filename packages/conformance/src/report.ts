/** Rendering a report for a human.
 *
 * Grouped by file and ordered by line, because the reader is looking at a
 * diff — and each line carries the rule id first so the same string can be
 * pasted into a repair prompt, a test name or an issue. */
import { RULES, type Finding } from "./finding";
import type { GateReport } from "./gate";

export function formatFinding(item: Finding): string {
  const where = item.line === 0 ? item.file : `${item.file}:${item.line}:${item.column}`;
  const evidence = item.evidence === null || item.evidence.length === 0 ? "" : `\n      ${item.evidence}`;
  return `  ${item.severity === "error" ? "✗" : "!"} [${item.rule}] ${where}\n      ${item.message}${evidence}`;
}

export function formatReport(report: GateReport): string {
  const head = report.ok
    ? `PASS — ${report.id ?? "sub-app"} conforms (${report.filesChecked} files, ${report.checks.length} checks, ${report.rules.length} rules)`
    : `REFUSED — ${report.id ?? "sub-app"} breaks ${report.errors.length} rule${report.errors.length === 1 ? "" : "s"} (${report.filesChecked} files, ${report.checks.length} checks)`;

  if (report.findings.length === 0) return head;

  const lines = [head, ""];
  let lastFile = "";
  for (const item of report.findings) {
    if (item.file !== lastFile) {
      lines.push(`${item.file}`);
      lastFile = item.file;
    }
    lines.push(formatFinding(item));
  }

  const warnings = report.warnings.length;
  if (warnings > 0) {
    lines.push("", `${warnings} warning${warnings === 1 ? "" : "s"} do not block the write.`);
  }
  return lines.join("\n");
}

/** One line per rule the gate applies — for a `--list-rules` flag or a
 * docs page that has to stay in step with the code. */
export function formatRuleCatalog(): string {
  return Object.entries(RULES)
    .map(([id, spec]) => `${id}  ${spec.severity === "error" ? "error  " : "warning"}  ${spec.title} (contract ${spec.contract})`)
    .join("\n");
}
