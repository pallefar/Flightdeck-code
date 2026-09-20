/** The file tree and the source view beside it.
 *
 * Two decorations carry most of the value, and both come from elsewhere in
 * the workbench rather than from the file itself: the `+n −n` this round
 * changed, and a dot for each finding the gate raised in that file. A tree
 * that shows only names makes a person open twelve files to find the two
 * that matter. */
import { useMemo } from "react";
import type { FileChange } from "../diff";
import { TIERS, type TreeNode } from "../tree";
import type { Finding, GeneratedFile } from "../types";

interface Props {
  readonly nodes: readonly TreeNode[];
  readonly selectedPath: string | null;
  readonly changes: ReadonlyMap<string, FileChange>;
  readonly findings: ReadonlyMap<string, readonly Finding[]>;
  readonly collapsedDirs: ReadonlySet<string>;
  /** When set, rows the focused rule does not touch are dimmed. */
  readonly focusedRule: string | null;
  readonly file: GeneratedFile | null;
  readonly onSelect: (path: string) => void;
  readonly onToggle: (path: string) => void;
}

export function FileTreePane({
  nodes,
  selectedPath,
  changes,
  findings,
  collapsedDirs,
  focusedRule,
  file,
  onSelect,
  onToggle,
}: Props) {
  return (
    <div className="fd-files">
      <nav className="fd-tree" aria-label="Generated files">
        {nodes.map((node) => {
          if (node.type === "tier") {
            const collapsed = collapsedDirs.has(node.path);
            return (
              <button
                type="button"
                key={node.path}
                className={`fd-tree__tier fd-tree__row${node.tier === "host-edit" ? " fd-tree__tier--edit" : ""}`}
                onClick={() => onToggle(node.path)}
                aria-expanded={!collapsed}
              >
                <span style={{ display: "block", width: "100%" }}>
                  <span className="fd-tree__tierlabel">
                    <span className="fd-tree__twisty">{collapsed ? "▸" : "▾"}</span>
                    {TIERS[node.tier].label}
                    <span className="fd-delta">{node.fileCount}</span>
                  </span>
                  <span className="fd-tree__tierblurb">{TIERS[node.tier].blurb}</span>
                </span>
              </button>
            );
          }

          if (node.type === "dir") {
            const collapsed = collapsedDirs.has(node.path);
            return (
              <button
                type="button"
                key={node.path}
                className="fd-tree__row"
                style={{ paddingLeft: 12 + node.depth * 13 }}
                onClick={() => onToggle(node.path)}
                aria-expanded={!collapsed}
              >
                <span className="fd-tree__twisty">{collapsed ? "▸" : "▾"}</span>
                <span className="fd-tree__name">{node.name}</span>
                <span className="fd-delta">{node.fileCount}</span>
              </button>
            );
          }

          const change = changes.get(node.path);
          const fileFindings = findings.get(node.path) ?? [];
          const dim = focusedRule !== null && !fileFindings.some((f) => f.rule === focusedRule);
          return (
            <button
              type="button"
              key={node.path}
              className={`fd-tree__row${dim ? " fd-tree__row--dim" : ""}`}
              style={{ paddingLeft: 12 + node.depth * 13 }}
              aria-current={node.path === selectedPath}
              onClick={() => onSelect(node.path)}
              title={node.path}
            >
              <span className="fd-tree__name">{node.name}</span>
              {fileFindings.slice(0, 3).map((finding, i) => (
                <span key={i} className={`fd-dot fd-dot--${finding.severity}`} aria-label={finding.severity} />
              ))}
              {change !== undefined && change.kind !== "unchanged" && (
                <span className="fd-delta">
                  {change.added > 0 && <span className="fd-delta__add">+{change.added}</span>}{" "}
                  {change.removed > 0 && <span className="fd-delta__del">−{change.removed}</span>}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <SourceView file={file} findings={file === null ? [] : findings.get(file.path) ?? []} />
    </div>
  );
}

function SourceView({
  file,
  findings,
}: {
  readonly file: GeneratedFile | null;
  readonly findings: readonly Finding[];
}) {
  const lines = useMemo(() => (file === null ? [] : file.contents.replace(/\n$/, "").split("\n")), [file]);
  const bySeverity = useMemo(() => {
    const map = new Map<number, Finding>();
    for (const finding of findings) {
      // The worse of two findings on a line wins the row's colour;
      // otherwise a warning drawn second hides an error drawn first.
      const existing = map.get(finding.line);
      if (existing === undefined || (existing.severity === "warning" && finding.severity === "error")) {
        map.set(finding.line, finding);
      }
    }
    return map;
  }, [findings]);

  if (file === null) {
    return (
      <div className="fd-source">
        <div className="fd-empty">Select a file.</div>
      </div>
    );
  }

  const name = file.path.split("/").pop() ?? file.path;
  return (
    <div className="fd-source">
      <header className="fd-source__head">
        <span className="fd-source__path">
          {file.path.slice(0, file.path.length - name.length)}
          <b>{name}</b>
        </span>
        <span className="fd-tabs__spacer" />
        <span className="fd-tabs__id">
          {lines.length} line{lines.length === 1 ? "" : "s"}
        </span>
      </header>
      <div className="fd-code">
        <table>
          <tbody>
            {lines.map((line, i) => {
              const finding = bySeverity.get(i + 1);
              return (
                <tr key={i} data-finding={finding?.severity}>
                  <td className="fd-ln">{i + 1}</td>
                  <td>
                    {line}
                    {finding !== undefined && (
                      <span className="fd-finding__where">  ← {finding.rule} {finding.message}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
