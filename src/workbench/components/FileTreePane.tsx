/** The file tree and the source view beside it.
 *
 * Two decorations carry most of the value, and both come from elsewhere in
 * the workbench rather than from the file itself: the `+n −n` this round
 * changed, and a dot for each finding the gate raised in that file. A tree
 * that shows only names makes a person open twelve files to find the two
 * that matter. */
import type { FileChange } from "../diff";
import type { DraftState } from "../editing";
import { TIERS, type Tier, type TreeNode } from "../tree";
import type { Finding, GeneratedFile } from "../types";
import { EditorPane, type EditorPaneProps } from "./EditorPane";
import { Chevron, LineIcon, type LineIconName } from "./LineIcon";

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
  /** Which files carry something of the person's. A dot in the tree is
   * the only way to see, without opening twelve files, that two of them
   * are yours and one of those is in conflict. */
  readonly draftStates?: ReadonlyMap<string, DraftState>;
  readonly locks?: ReadonlySet<string>;
  /** Everything the editor half needs. Omitted entirely in a read-only
   * embedding, which is how the pane renders with no store at all. */
  readonly editor?: Omit<EditorPaneProps, "file" | "findings">;
}

/** What a person's own copy of a file is doing, as a line icon rather
 * than the Unicode ●/◆/▲ this used to draw. Atlas never renders a status
 * as a typographic glyph, and at the 9px those needed they were closer to
 * dust than to a mark. `clean` has no mark at all — an untouched file is
 * the ordinary case and does not need an annotation. */
const MARK: Readonly<Record<Exclude<DraftState, "clean">, LineIconName>> = {
  dirty: "pencil",
  saved: "check",
  conflicted: "triangle-alert",
};

/** The tier's icon: what part of the host this tier drops into. */
const TIER_ICONS: Readonly<Record<Tier, LineIconName>> = {
  server: "server",
  web: "layout-dashboard",
  tests: "flask-conical",
  "host-edit": "wrench",
  other: "folder",
};

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
  draftStates,
  locks,
  editor,
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
                    <span className="fd-tree__twisty">
                      <Chevron open={!collapsed} size={14} />
                    </span>
                    <span className="fd-tree__icon">
                      <LineIcon name={TIER_ICONS[node.tier]} size={16} />
                    </span>
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
                <span className="fd-tree__twisty">
                  <Chevron open={!collapsed} size={14} />
                </span>
                <span className="fd-tree__icon">
                  <LineIcon name={collapsed ? "folder" : "folder-open"} size={16} />
                </span>
                <span className="fd-tree__name">{node.name}</span>
                <span className="fd-delta">{node.fileCount}</span>
              </button>
            );
          }

          const change = changes.get(node.path);
          const fileFindings = findings.get(node.path) ?? [];
          const dim = focusedRule !== null && !fileFindings.some((f) => f.rule === focusedRule);
          const draft = draftStates?.get(node.path);
          const locked = locks?.has(node.path) ?? false;
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
              <span className="fd-tree__icon">
                <LineIcon name="file-code" size={16} />
              </span>
              {locked && (
                <span className="fd-tree__lock" aria-label="locked">
                  <LineIcon name="lock" size={13} />
                </span>
              )}
              <span className="fd-tree__name">{node.name}</span>
              {draft !== undefined && draft !== "clean" && (
                <span className={`fd-tree__draft fd-tree__draft--${draft}`} aria-label={draft}>
                  <LineIcon name={MARK[draft]} size={13} />
                </span>
              )}
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
      {/* Keyed by path so the editor's own view state — read/edit mode,
          the reason a keystroke was refused — belongs to the file it was
          about, rather than following a person to the next one. */}
      <EditorPane
        key={file?.path ?? "(none)"}
        {...(editor ?? {})}
        file={file}
        findings={file === null ? [] : findings.get(file.path) ?? []}
      />
    </div>
  );
}
