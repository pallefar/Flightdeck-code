/** The file tree and the source view beside it.
 *
 * Two decorations carry most of the value, and both come from elsewhere in
 * the workbench rather than from the file itself: the `+n −n` this round
 * changed, and a dot for each finding the gate raised in that file. A tree
 * that shows only names makes a person open twelve files to find the two
 * that matter. */
import { useEffect, useId, useRef, useState } from "react";
import type { FileChange } from "../diff";
import type { DraftState } from "../editing";
import { searchTree, TIERS, type TreeNode } from "../tree";
import type { Finding, GeneratedFile } from "../types";
import { EditorPane, type EditorPaneProps } from "./EditorPane";

interface Props {
  readonly nodes: readonly TreeNode[];
  /** Search only the complete authoritative file set, never fake buffers. */
  readonly files?: readonly GeneratedFile[];
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
  /** Retained source editors need their own authoritative draft/baseline. */
  readonly editorFor?: (path: string) => Omit<EditorPaneProps, "file" | "findings">;
  readonly receivedPaths?: ReadonlySet<string> | null;
  readonly focused?: boolean;
  readonly onExitFocus?: () => void;
}

const MARK: Readonly<Record<DraftState, string>> = {
  clean: "",
  dirty: "●",
  saved: "◆",
  conflicted: "▲",
};

export function FileTreePane({
  nodes,
  files,
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
  editorFor,
  receivedPaths = null,
  focused = false,
  onExitFocus,
}: Props) {
  const [query, setQuery] = useState("");
  const [explorerOpen, setExplorerOpen] = useState(true);
  const toggle = useRef<HTMLButtonElement>(null);
  const opened = useRef<string[]>([]);
  const editorPaths = useRef(new Set<string>());
  const id = useId();
  useEffect(() => {
    const media = window.matchMedia("(max-width: 680px)");
    const update = () => setExplorerOpen(!media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  if (selectedPath !== null && !opened.current.includes(selectedPath)) opened.current = [...opened.current, selectedPath].slice(-8);
  if (selectedPath !== null) editorPaths.current.add(selectedPath);
  const sourceTabs = opened.current.filter(path => files?.some(source => source.path === path) ?? path === selectedPath);
  const visibleNodes = files === undefined ? nodes : searchTree(files, query, collapsedDirs);
  const choose = (path: string) => {
    onSelect(path);
    if (window.matchMedia("(max-width: 680px)").matches) {
      setExplorerOpen(false);
      toggle.current?.focus();
    }
  };
  return (
    <div className="fd-files">
      <div className="fd-source-tabs" role="group" aria-label="Open sources">
        <button ref={toggle} type="button" className="fd-explorer-toggle" aria-label="Toggle file explorer" aria-expanded={explorerOpen && !focused} aria-controls={`${id}-explorer`} onClick={() => { if (focused) { onExitFocus?.(); setExplorerOpen(true); } else setExplorerOpen(open => !open); }}><span aria-hidden="true">☷</span> Files</button>
        {sourceTabs.map(path => <button type="button" className="fd-source-tab" key={path} title={path} aria-pressed={path === selectedPath} onClick={() => choose(path)}>{path.split("/").pop()}<span className="fd-source-tab__dot" aria-hidden="true">{draftStates?.get(path) === "dirty" ? "●" : draftStates?.get(path) === "saved" ? "◆" : ""}</span></button>)}
      </div>
      <div className="fd-files__workspace">
      <aside className="fd-explorer" id={`${id}-explorer`} hidden={!explorerOpen || focused} inert={!explorerOpen || focused}>
        {files !== undefined && <div className="fd-explorer__search"><label><span className="fd-explorer__caption">EXPLORER <span>{files.length} sources</span></span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search source paths…" aria-label="Search source paths" /></label>{query.length > 0 && <button type="button" onClick={() => setQuery("")} aria-label="Clear source search">Clear</button>}</div>}
      <nav className="fd-tree" aria-label="Generated files" onKeyDown={event => {
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const index = event.key === "ArrowDown" ? Math.min(current + 1, buttons.length - 1) : event.key === "ArrowUp" ? Math.max(current - 1, 0) : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : null;
        if (index === null) return;
        event.preventDefault();
        buttons[index]?.focus();
      }}>
        {visibleNodes.length === 0 && <p className="fd-note">No source paths match this search.</p>}
        {visibleNodes.map((node) => {
          if (node.type === "tier") {
            const collapsed = query.trim().length === 0 && collapsedDirs.has(node.path);
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
            const collapsed = query.trim().length === 0 && collapsedDirs.has(node.path);
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
          const draft = draftStates?.get(node.path);
          const locked = locks?.has(node.path) ?? false;
          return (
            <button
              type="button"
              key={node.path}
              className={`fd-tree__row${dim ? " fd-tree__row--dim" : ""}`}
              style={{ paddingLeft: 12 + node.depth * 13 }}
              aria-current={node.path === selectedPath}
              data-received-highlight={receivedPaths === null ? undefined : receivedPaths.has(node.path)}
              onClick={() => choose(node.path)}
              title={node.path}
            >
              {locked && (
                <span className="fd-tree__lock" aria-label="locked">
                  ⌷
                </span>
              )}
              <span className="fd-tree__name">{node.name}</span>
              {draft !== undefined && draft !== "clean" && (
                <span className={`fd-tree__draft fd-tree__draft--${draft}`} aria-label={draft}>
                  {MARK[draft]}
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
      </aside>
      {/* Reference navigation retains visited textareas, their selection,
          mode and undo buffer. Hidden sources are inert, not reparented.
          A scoped store reset removes the entire candidate pane. */}
      {editorFor !== undefined && files !== undefined ? [...editorPaths.current].flatMap(path => {
        const source = files.find(item => item.path === path);
        return source === undefined ? [] : [<div className="fd-source-slot" data-source-path={path} key={path} hidden={selectedPath !== path} inert={selectedPath !== path}><EditorPane {...editorFor(path)} file={source} findings={findings.get(path) ?? []} /></div>];
      }) : <EditorPane key={file?.path ?? "(none)"} {...(editor ?? {})} file={file} findings={file === null ? [] : findings.get(file.path) ?? []} />}
      </div>
    </div>
  );
}
