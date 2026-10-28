/**
 * The PageDoc editor's ONE transaction model (pages-editor-transactions, plan
 * docs/PLAN-2026-09-25-ONBOARDING-APPS-PAGES-CRM.md Lane C, J2-J4; engine
 * decision docs/PAGES-ENGINE-DECISION.md: in-house, the zod doc IS the
 * editor state).
 *
 * Pure: no React, no DOM, no timers, no clock. Every editor surface (outline,
 * canvas, keyboard moves, drag, paste, import, restore, merge) goes through
 * `applyCommand`, which returns either
 *   { ok: true, doc, inverse, selectionAfter, focusAfter, label }
 * or a refusal
 *   { ok: false, code, messageKey, path }.
 * The input doc is never mutated, and every result is re-read with
 * `parsePageDoc`, so no command can produce a doc the store or Atlas would
 * refuse: a command that breaks a limit is refused with the limit's code.
 *
 * Block commands (insert, remove, move, moveBlockToTab, paste) all compile to
 * one internal `place` primitive, so a multi-select remove or move and its
 * undo are exact by construction. History replays inverses: undo applies the
 * stored inverse and keeps ITS inverse as the redo, so redo is exact even for
 * a paste (whose ids were freshly issued).
 *
 * Addressing is by id, never by array index: a block's container is a column
 * id or a tab id (ids are unique doc-wide), and a field path starts with a
 * node id (section, column, block, tab or list item) or "meta".
 *
 * The history (undo/redo, coalescing, cap), savepoints and the ok/refusal
 * shape come from the portable editor-core (flightdeck/editor-core, D-042),
 * which the deck editor shares; this module binds them to PageDoc commands.
 */
import * as core from "../../../editor-core/history.js";
import { refusal, type Refusal } from "../../../editor-core/result.js";
import {
  LIMITS,
  MEDIA_ID_PATTERN,
  columnCount,
  newPageDocId,
  parsePageDoc,
  reissueIds,
  type Block,
  type PageDocV2,
  type Section,
  type SectionLayout,
  type Tab,
} from "../../../pagedoc/schema/index.js";

// ---- constants ------------------------------------------------------------------

/** Undo steps kept (HISTORY_CAP) and the coalescing window (COALESCE_MS): editor-core's defaults. */
export { COALESCE_MS, HISTORY_CAP } from "../../../editor-core/history.js";
export { isDirty, isReachable, savepointAt, takeSavepoint, type Savepoint } from "../../../editor-core/savepoint.js";
/** Rich text commits after this long without input (or on blur / compositionend). */
export const RICH_TEXT_IDLE_MS = 1000;

export const REFUSAL_CODES = [
  "not_found",
  "empty_selection",
  "locked",
  "tabs_in_tabs",
  "structural_path",
  "min_tabs",
  "max_tabs",
  "invalid",
  "too_many_blocks",
  "doc_too_large",
  "block_too_large",
  "too_deep",
  "duplicate_id",
] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];

export const REPLACE_REASONS = ["import", "restore", "merge", "template"] as const;
export type ReplaceReason = (typeof REPLACE_REASONS)[number];

const L = {
  insert: "pageEditor.tx.insert",
  remove: "pageEditor.tx.remove",
  updateField: "pageEditor.tx.updateField",
  move: "pageEditor.tx.move",
  moveSection: "pageEditor.tx.moveSection",
  setSectionLayout: "pageEditor.tx.setSectionLayout",
  paste: "pageEditor.tx.paste",
  addTab: "pageEditor.tx.addTab",
  renameTab: "pageEditor.tx.renameTab",
  reorderTab: "pageEditor.tx.reorderTab",
  removeTab: "pageEditor.tx.removeTab",
  moveBlockToTab: "pageEditor.tx.moveBlockToTab",
  replaceMedia: "pageEditor.tx.replaceMedia",
} as const;
const replaceLabel = (r: ReplaceReason) => `pageEditor.tx.replaceDoc.${r}`;

/** Every label key a result can carry (the undo/redo announcements use them). */
export const TX_LABEL_KEYS: readonly string[] = [...Object.values(L), ...REPLACE_REASONS.map(replaceLabel)];

// ---- types ----------------------------------------------------------------------

type Path = Array<string | number>;
/** [nodeId | "meta", ...keys inside that node]. */
export type FieldPath = readonly [string, ...Array<string | number>];
/** A position in a block list: `parentId` is a column id or a tab id. */
export interface Target {
  parentId: string;
  index: number;
}
export interface PlaceEntry {
  block: Block;
  parentId: string;
  index: number;
}
export type TabLabel = Tab["label"];

export type Command =
  | { type: "insert"; block: Block; at: Target }
  | { type: "remove"; ids: readonly string[] }
  /**
   * `value: undefined` removes an optional field. `restore: true` marks an
   * inverse that puts a field back to absent: if the field is already absent
   * (a coalesced set-then-remove with no net effect), it succeeds as a no-op
   * instead of refusing with not_found. A plain remove of an absent field is
   * still refused.
   */
  | { type: "updateField"; path: FieldPath; value: unknown; restore?: true }
  /** `to.index` counts in the target list AFTER the moved blocks left it. */
  | { type: "move"; ids: readonly string[]; to: Target }
  | { type: "moveSection"; sectionId: string; toIndex: number }
  | { type: "setSectionLayout"; sectionId: string; layout: SectionLayout }
  /** Always re-issues every id (reissueIds), so a paste never duplicates one. */
  | { type: "paste"; blocks: readonly Block[]; at: Target }
  | { type: "addTab"; tabsId: string; label: TabLabel; index?: number }
  | { type: "renameTab"; tabId: string; label: TabLabel }
  | { type: "reorderTab"; tabId: string; toIndex: number }
  | { type: "removeTab"; tabId: string }
  | { type: "moveBlockToTab"; ids: readonly string[]; tabId: string; index: number }
  | { type: "replaceDoc"; doc: PageDocV2; reason: ReplaceReason }
  /**
   * Media "Replace" (pages-media-lifecycle): after the new file is uploaded,
   * every use of `from` in the draft points at `to`, as ONE undo step. The
   * old file stays in the library until nothing references it.
   */
  | { type: "replaceMedia"; from: string; to: string }
  // internal: the inverses the model hands back
  | { type: "setMediaAt"; paths: readonly Path[]; ids: readonly string[]; label: string }
  | { type: "place"; remove: readonly string[]; entries: readonly PlaceEntry[]; label: string }
  | { type: "restoreTab"; tabsId: string; tab: Tab; index: number; label: string }
  | { type: "restoreSection"; section: Section; label: string };

export type Focus =
  | { kind: "block"; id: string }
  /** The '+' insert button of an (empty) column or tab. */
  | { kind: "insert"; parentId: string }
  | { kind: "section"; id: string }
  | { kind: "tab"; id: string }
  | { kind: "field"; path: FieldPath }
  | { kind: "page" };

export interface TxOk {
  ok: true;
  doc: PageDocV2;
  inverse: Command;
  selectionAfter: string[];
  focusAfter: Focus;
  /** An i18n key naming the step (e.g. for 'Undone: Move'). */
  label: string;
  /** Set on field edits: equal keys within COALESCE_MS are one undo step. */
  coalesceKey?: string;
}
export type TxRefusal = Refusal<RefusalCode>;
export type TxResult = TxOk | TxRefusal;

export interface TxContext {
  /** Issues new ids (paste, new columns, new tabs). Defaults to newPageDocId. */
  makeId?: () => string;
}

const refuse = (code: RefusalCode, path: Path = []): TxRefusal => refusal("pageEditor.refusal", code, path);

// ---- walking the doc ------------------------------------------------------------

interface Container {
  list: Block[];
  sectionIndex: number;
  isTab: boolean;
  path: Path;
}
interface BlockLoc {
  block: Block;
  parentId: string;
  index: number;
  sectionIndex: number;
  /** The tabs block this block sits in, when it is inside a tab. */
  ownerTabsId: string | null;
  path: Path;
}

function containers(doc: PageDocV2): Map<string, Container> {
  const out = new Map<string, Container>();
  doc.sections.forEach((s, si) =>
    s.columns.forEach((c, ci) => {
      const cp: Path = ["sections", si, "columns", ci, "blocks"];
      out.set(c.id, { list: c.blocks, sectionIndex: si, isTab: false, path: cp });
      c.blocks.forEach((b, bi) => {
        if (b.type !== "tabs") return;
        b.tabs.forEach((t, ti) =>
          out.set(t.id, { list: t.blocks as Block[], sectionIndex: si, isTab: true, path: [...cp, bi, "tabs", ti, "blocks"] }),
        );
      });
    }),
  );
  return out;
}

function blockIndex(doc: PageDocV2): Map<string, BlockLoc> {
  const out = new Map<string, BlockLoc>();
  doc.sections.forEach((s, si) =>
    s.columns.forEach((c, ci) =>
      c.blocks.forEach((b, bi) => {
        const bp: Path = ["sections", si, "columns", ci, "blocks", bi];
        out.set(b.id, { block: b, parentId: c.id, index: bi, sectionIndex: si, ownerTabsId: null, path: bp });
        if (b.type !== "tabs") return;
        b.tabs.forEach((t, ti) =>
          t.blocks.forEach((x, xi) =>
            out.set(x.id, {
              block: x as Block,
              parentId: t.id,
              index: xi,
              sectionIndex: si,
              ownerTabsId: b.id,
              path: [...bp, "tabs", ti, "blocks", xi],
            }),
          ),
        );
      }),
    ),
  );
  return out;
}

/** Block ids in outline order: a tabs block, then its tabs' blocks. */
export function blockOrder(doc: PageDocV2): string[] {
  return [...blockIndex(doc).keys()];
}

const isLocked = (doc: PageDocV2, sectionIndex: number) => doc.sections[sectionIndex]?.lock === "content-only";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function validate(doc: PageDocV2): TxRefusal | null {
  const parsed = parsePageDoc(doc);
  if (parsed.ok) return null;
  const first = parsed.issues[0];
  const code = first?.code;
  const mapped: RefusalCode =
    code === "too_many_blocks" || code === "doc_too_large" || code === "block_too_large" || code === "too_deep" || code === "duplicate_id"
      ? code
      : "invalid";
  return refuse(mapped, first?.path ?? []);
}

// ---- selection ------------------------------------------------------------------

/** Existing ids only, once each, in outline order, without blocks whose tabs block is also selected. */
export function normalizeSelection(doc: PageDocV2, ids: readonly string[]): string[] {
  const want = new Set(ids);
  const index = blockIndex(doc);
  return [...index.values()]
    .filter((l) => want.has(l.block.id) && !(l.ownerTabsId !== null && want.has(l.ownerTabsId)))
    .map((l) => l.block.id);
}

/** Shift+click / Shift+Arrow: everything between anchor and target (inclusive), in outline order. */
export function selectRange(doc: PageDocV2, anchorId: string, targetId: string): string[] {
  const order = blockOrder(doc);
  const a = order.indexOf(anchorId);
  const b = order.indexOf(targetId);
  if (a < 0 || b < 0) return normalizeSelection(doc, [targetId]);
  return normalizeSelection(doc, order.slice(Math.min(a, b), Math.max(a, b) + 1));
}

/** Cmd/Ctrl+click: adds or removes one id. */
export function toggleSelection(selection: readonly string[], id: string): string[] {
  return selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id];
}

/** Checks a public multi-select: not empty, nothing stale. Returns the normalized ids. */
function checkSelection(doc: PageDocV2, ids: readonly string[]): string[] | TxRefusal {
  if (ids.length === 0) return refuse("empty_selection");
  const index = blockIndex(doc);
  const missing = ids.find((id) => !index.has(id));
  if (missing !== undefined) return refuse("not_found", [missing]);
  return normalizeSelection(doc, ids);
}

// ---- the place primitive -----------------------------------------------------------

/** Focus after blocks disappear: next sibling, else previous, else the container's '+'. */
function focusAfterRemoval(before: PageDocV2, removed: ReadonlySet<string>): Focus {
  const index = blockIndex(before);
  const first = [...index.values()].find((l) => removed.has(l.block.id));
  if (!first) return { kind: "page" };
  const list = containers(before).get(first.parentId)?.list ?? [];
  const next = list.slice(first.index + 1).find((b) => !removed.has(b.id));
  if (next) return { kind: "block", id: next.id };
  const prev = list
    .slice(0, first.index)
    .reverse()
    .find((b) => !removed.has(b.id));
  if (prev) return { kind: "block", id: prev.id };
  return { kind: "insert", parentId: first.parentId };
}

function applyPlace(doc: PageDocV2, remove: readonly string[], entries: readonly PlaceEntry[], label: string): TxResult {
  const beforeIndex = blockIndex(doc);
  const beforeContainers = containers(doc);
  // ids not on the page are skipped: public commands already refused a stale
  // selection (checkSelection), and an inverse names blocks it will re-add
  for (const id of remove) {
    const loc = beforeIndex.get(id);
    if (!loc) continue;
    if (isLocked(doc, loc.sectionIndex)) return refuse("locked", ["sections", loc.sectionIndex]);
  }
  for (const e of entries) {
    const c = beforeContainers.get(e.parentId);
    // a target inside a block this same command removes is gone after the detach
    if (c && isLocked(doc, c.sectionIndex)) return refuse("locked", ["sections", c.sectionIndex]);
    if (c?.isTab && e.block.type === "tabs") return refuse("tabs_in_tabs", c.path);
  }

  const next = clone(doc);
  const removeSet = new Set(remove);
  for (const id of remove) {
    const loc = blockIndex(next).get(id);
    if (!loc) continue; // already detached with its tabs block
    containers(next).get(loc.parentId)?.list.splice(loc.index, 1);
  }
  const sorted = [...entries].sort((a, b) => a.index - b.index);
  for (const e of sorted) {
    const c = containers(next).get(e.parentId);
    if (!c) return refuse("not_found", [e.parentId]);
    if (c.isTab && e.block.type === "tabs") return refuse("tabs_in_tabs", c.path);
    const at = Math.min(Math.max(0, Math.trunc(e.index)), c.list.length);
    c.list.splice(at, 0, clone(e.block));
  }
  const bad = validate(next);
  if (bad) return bad;

  // the inverse detaches everything this touched and puts back what existed before
  const affected = [...new Set([...remove, ...entries.map((e) => e.block.id)])];
  const prior: PlaceEntry[] = affected.flatMap((id) => {
    const loc = beforeIndex.get(id);
    return loc ? [{ block: clone(loc.block), parentId: loc.parentId, index: loc.index }] : [];
  });
  const inverse: Command = { type: "place", remove: affected, entries: prior, label };

  const placed = new Set(entries.map((e) => e.block.id));
  if (placed.size > 0) {
    const selection = blockOrder(next).filter((id) => placed.has(id));
    return { ok: true, doc: next, inverse, selectionAfter: selection, focusAfter: { kind: "block", id: selection[0]! }, label };
  }
  return { ok: true, doc: next, inverse, selectionAfter: [], focusAfter: focusAfterRemoval(doc, removeSet), label };
}

// ---- fields ------------------------------------------------------------------------

/** Keys a field edit may not touch: structure has its own commands (and lock is the pattern's). */
const STRUCTURAL_KEYS = new Set(["id", "type", "blocks", "columns", "tabs", "layout", "lock"]);
/** Keys that reach the prototype chain; a field path may never name them (fails closed). */
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const hasOwn = (o: object, k: string | number): boolean => Object.prototype.hasOwnProperty.call(o, k);
/** An array step must be an integer index inside the array, or exactly one past it (append). */
const badStep = (cur: Rec, k: string | number): boolean =>
  Array.isArray(cur)
    ? typeof k !== "number" || !Number.isInteger(k) || k < 0 || k > cur.length
    : typeof k !== "string";

type Rec = Record<string | number, unknown>;
const isObj = (v: unknown): v is Rec => typeof v === "object" && v !== null;

/** The node a field path starts at, and its doc path. */
function findNode(doc: PageDocV2, nodeId: string): { node: Rec; path: Path } | null {
  if (nodeId === "meta") return { node: doc.meta as unknown as Rec, path: ["meta"] };
  for (const [si, s] of doc.sections.entries()) {
    if (s.id === nodeId) return { node: s as unknown as Rec, path: ["sections", si] };
    for (const [ci, c] of s.columns.entries()) {
      if (c.id === nodeId) return { node: c as unknown as Rec, path: ["sections", si, "columns", ci] };
    }
  }
  for (const loc of blockIndex(doc).values()) {
    const b = loc.block as unknown as Rec;
    if (loc.block.id === nodeId) return { node: b, path: loc.path };
    if (loc.block.type === "tabs") {
      for (const [ti, t] of loc.block.tabs.entries()) {
        if (t.id === nodeId) return { node: t as unknown as Rec, path: [...loc.path, "tabs", ti] };
      }
    }
    const items = b.items;
    if (Array.isArray(items)) {
      for (const [ii, item] of items.entries()) {
        if (isObj(item) && item.id === nodeId) return { node: item, path: [...loc.path, "items", ii] };
      }
    }
  }
  return null;
}

function applyUpdateField(doc: PageDocV2, path: FieldPath, value: unknown, label: string, restore = false): TxResult {
  const [nodeId, ...keys] = path;
  if (keys.length === 0) return refuse("structural_path", [nodeId]);
  const first = keys[0];
  if ((typeof first === "string" && STRUCTURAL_KEYS.has(first)) || keys.includes("id")) {
    return refuse("structural_path", [nodeId, ...keys]);
  }
  if (keys.some((k) => typeof k === "string" && FORBIDDEN_KEYS.has(k))) return refuse("invalid", [nodeId, ...keys]);
  const next = clone(doc);
  const found = findNode(next, nodeId);
  if (!found) return refuse("not_found", [nodeId]);
  const result = (d: PageDocV2, inverse: Command): TxResult => ({
    ok: true,
    doc: d,
    inverse,
    selectionAfter: blockIndex(d).has(nodeId) ? [nodeId] : [],
    focusAfter: { kind: "field", path },
    label,
    coalesceKey: `field:${JSON.stringify(path)}`,
  });
  // Restoring an already-absent field changes nothing; its inverse is the same restore.
  const alreadyAbsent = () => result(doc, { type: "updateField", path, value: undefined, restore: true });

  let cur: Rec = found.node;
  let createdAt = -1;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    if (badStep(cur, k) || (Array.isArray(cur) && k === cur.length)) return refuse("invalid", [...found.path, ...keys.slice(0, i + 1)]);
    let child = hasOwn(cur, k) ? cur[k] : undefined;
    if (child === undefined) {
      if (value === undefined) return restore ? alreadyAbsent() : refuse("not_found", [...found.path, ...keys.slice(0, i + 1)]);
      if (Array.isArray(cur) || typeof keys[i + 1] === "number") return refuse("invalid", [...found.path, ...keys.slice(0, i + 1)]);
      child = {};
      cur[k] = child;
      if (createdAt < 0) createdAt = i;
    }
    if (!isObj(child)) return refuse("invalid", [...found.path, ...keys.slice(0, i + 1)]);
    cur = child;
  }
  const last = keys[keys.length - 1]!;
  if (badStep(cur, last)) return refuse("invalid", [...found.path, ...keys]);
  // An edit that grows an array cannot be undone by writing back its old
  // (absent) slot, so its inverse restores a snapshot of the whole array.
  const arraySnapshot = Array.isArray(cur) && last === cur.length ? clone(cur) : null;
  const old = hasOwn(cur, last) ? cur[last] : undefined;
  if (value === undefined) {
    if (Array.isArray(cur)) return refuse("invalid", [...found.path, ...keys]);
    if (old === undefined) return restore ? alreadyAbsent() : refuse("not_found", [...found.path, ...keys]);
    delete cur[last];
  } else {
    cur[last] = clone(value);
  }
  const bad = validate(next);
  if (bad) return bad;

  const inverse: Command =
    createdAt >= 0
      ? { type: "updateField", path: [nodeId, ...keys.slice(0, createdAt + 1)], value: undefined, restore: true }
      : arraySnapshot
        ? { type: "updateField", path: [nodeId, ...keys.slice(0, -1)], value: arraySnapshot }
        : old === undefined
          ? { type: "updateField", path, value: undefined, restore: true }
          : { type: "updateField", path, value: clone(old) };
  return result(next, inverse);
}

// ---- sections and tabs ---------------------------------------------------------------

function findTabs(doc: PageDocV2, tabsId: string) {
  const loc = blockIndex(doc).get(tabsId);
  if (!loc || loc.block.type !== "tabs") return null;
  return { block: loc.block, loc };
}

function findTab(doc: PageDocV2, tabId: string) {
  for (const loc of blockIndex(doc).values()) {
    if (loc.block.type !== "tabs") continue;
    const index = loc.block.tabs.findIndex((t) => t.id === tabId);
    if (index >= 0) return { block: loc.block, loc, index };
  }
  return null;
}

const ok = (doc: PageDocV2, inverse: Command, focusAfter: Focus, label: string, selectionAfter: string[] = []): TxResult => {
  const bad = validate(doc);
  return bad ?? { ok: true, doc, inverse, selectionAfter, focusAfter, label };
};

function applySectionLayout(doc: PageDocV2, sectionId: string, layout: SectionLayout, makeId: () => string): TxResult {
  const si = doc.sections.findIndex((s) => s.id === sectionId);
  if (si < 0) return refuse("not_found", [sectionId]);
  if (isLocked(doc, si)) return refuse("locked", ["sections", si]);
  const next = clone(doc);
  const s = next.sections[si]!;
  const before = clone(s);
  const want = columnCount(layout);
  if (want < s.columns.length) {
    // never drop content: the dropped columns' blocks join the last kept column
    const dropped = s.columns.splice(want);
    s.columns[want - 1]!.blocks.push(...dropped.flatMap((c) => c.blocks));
  }
  while (s.columns.length < want) s.columns.push({ id: makeId(), blocks: [] });
  s.layout = layout;
  if (want < 2 && s.phone === "hide-second") s.phone = "stack";
  return ok(next, { type: "restoreSection", section: before, label: L.setSectionLayout }, { kind: "section", id: sectionId }, L.setSectionLayout);
}

// ---- media references --------------------------------------------------------------------

/** Paths (from the doc root) of every object whose own `mediaId` is `id`. */
function mediaPaths(doc: PageDocV2, id: string): Path[] {
  const out: Path[] = [];
  const walk = (v: unknown, at: Path) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...at, i]));
    else if (v !== null && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (k === "mediaId") {
          if (x === id) out.push(at);
        } else walk(x, [...at, k]);
      }
    }
  };
  walk(doc, []);
  return out;
}

/** Sets `mediaId` at each path to the matching id; the inverse puts the old ones back. */
function applySetMediaAt(doc: PageDocV2, paths: readonly Path[], ids: readonly string[], label: string): TxResult {
  if (paths.length === 0 || paths.length !== ids.length) return refuse("not_found");
  const next = clone(doc);
  const old: string[] = [];
  for (const [i, p] of paths.entries()) {
    let cur: unknown = next;
    for (const k of p) cur = cur !== null && typeof cur === "object" && hasOwn(cur, k) ? (cur as Record<string | number, unknown>)[k] : undefined;
    if (cur === null || typeof cur !== "object" || !hasOwn(cur, "mediaId") || typeof (cur as { mediaId: unknown }).mediaId !== "string") {
      return refuse("not_found", [...p]);
    }
    old.push((cur as { mediaId: string }).mediaId);
    (cur as { mediaId: string }).mediaId = ids[i]!;
  }
  return ok(next, { type: "setMediaAt", paths: paths.map((p) => [...p]), ids: old, label }, { kind: "page" }, label);
}

// ---- applyCommand ----------------------------------------------------------------------

/** Applies one command to a doc. Pure: `doc` is never mutated. */
export function applyCommand(doc: PageDocV2, cmd: Command, ctx: TxContext = {}): TxResult {
  const makeId = ctx.makeId ?? newPageDocId;
  switch (cmd.type) {
    case "insert":
      return applyPlace(doc, [], [{ block: cmd.block, parentId: cmd.at.parentId, index: cmd.at.index }], L.insert);

    case "remove": {
      const sel = checkSelection(doc, cmd.ids);
      if (!Array.isArray(sel)) return sel;
      return applyPlace(doc, sel, [], L.remove);
    }

    case "move":
    case "moveBlockToTab": {
      const to: Target = cmd.type === "move" ? cmd.to : { parentId: cmd.tabId, index: cmd.index };
      const label = cmd.type === "move" ? L.move : L.moveBlockToTab;
      if (cmd.type === "moveBlockToTab" && !containers(doc).get(cmd.tabId)?.isTab) return refuse("not_found", [cmd.tabId]);
      const sel = checkSelection(doc, cmd.ids);
      if (!Array.isArray(sel)) return sel;
      const index = blockIndex(doc);
      const entries = sel.map((id, i) => ({ block: index.get(id)!.block, parentId: to.parentId, index: to.index + i }));
      return applyPlace(doc, sel, entries, label);
    }

    case "paste": {
      const fresh = reissueIds([...cmd.blocks], makeId);
      return applyPlace(doc, [], fresh.map((block, i) => ({ block, parentId: cmd.at.parentId, index: cmd.at.index + i })), L.paste);
    }

    case "place":
      return applyPlace(doc, cmd.remove, cmd.entries, cmd.label);

    case "updateField":
      return applyUpdateField(doc, cmd.path, cmd.value, L.updateField, cmd.restore === true);

    case "moveSection": {
      const from = doc.sections.findIndex((s) => s.id === cmd.sectionId);
      if (from < 0) return refuse("not_found", [cmd.sectionId]);
      const next = clone(doc);
      const [s] = next.sections.splice(from, 1);
      const to = Math.min(Math.max(0, Math.trunc(cmd.toIndex)), next.sections.length);
      next.sections.splice(to, 0, s!);
      return ok(next, { type: "moveSection", sectionId: cmd.sectionId, toIndex: from }, { kind: "section", id: cmd.sectionId }, L.moveSection);
    }

    case "setSectionLayout":
      return applySectionLayout(doc, cmd.sectionId, cmd.layout, makeId);

    case "restoreSection": {
      const si = doc.sections.findIndex((s) => s.id === cmd.section.id);
      if (si < 0) return refuse("not_found", [cmd.section.id]);
      const next = clone(doc);
      const current = next.sections[si]!;
      next.sections[si] = clone(cmd.section);
      return ok(next, { type: "restoreSection", section: current, label: cmd.label }, { kind: "section", id: cmd.section.id }, cmd.label);
    }

    case "addTab": {
      const t = findTabs(doc, cmd.tabsId);
      if (!t) return refuse("not_found", [cmd.tabsId]);
      if (isLocked(doc, t.loc.sectionIndex)) return refuse("locked", ["sections", t.loc.sectionIndex]);
      if (t.block.tabs.length >= LIMITS.maxTabs) return refuse("max_tabs", [...t.loc.path, "tabs"]);
      const tab: Tab = { id: makeId(), label: clone(cmd.label), blocks: [] };
      const index = cmd.index ?? t.block.tabs.length;
      return applyCommand(doc, { type: "restoreTab", tabsId: cmd.tabsId, tab, index, label: L.addTab }, ctx);
    }

    case "restoreTab": {
      const t = findTabs(doc, cmd.tabsId);
      if (!t) return refuse("not_found", [cmd.tabsId]);
      if (isLocked(doc, t.loc.sectionIndex)) return refuse("locked", ["sections", t.loc.sectionIndex]);
      if (t.block.tabs.length >= LIMITS.maxTabs) return refuse("max_tabs", [...t.loc.path, "tabs"]);
      const next = clone(doc);
      const tabs = findTabs(next, cmd.tabsId)!.block.tabs;
      tabs.splice(Math.min(Math.max(0, Math.trunc(cmd.index)), tabs.length), 0, clone(cmd.tab));
      return ok(next, { type: "removeTab", tabId: cmd.tab.id }, { kind: "tab", id: cmd.tab.id }, cmd.label);
    }

    case "removeTab": {
      const t = findTab(doc, cmd.tabId);
      if (!t) return refuse("not_found", [cmd.tabId]);
      if (isLocked(doc, t.loc.sectionIndex)) return refuse("locked", ["sections", t.loc.sectionIndex]);
      if (t.block.tabs.length <= LIMITS.minTabs) return refuse("min_tabs", [...t.loc.path, "tabs"]);
      const next = clone(doc);
      const tabs = findTabs(next, t.block.id)!.block.tabs;
      const [removed] = tabs.splice(t.index, 1);
      const neighbour = tabs[t.index] ?? tabs[t.index - 1];
      return ok(
        next,
        { type: "restoreTab", tabsId: t.block.id, tab: removed!, index: t.index, label: L.removeTab },
        neighbour ? { kind: "tab", id: neighbour.id } : { kind: "block", id: t.block.id },
        L.removeTab,
      );
    }

    case "renameTab": {
      const r = applyUpdateField(doc, [cmd.tabId, "label"], cmd.label, L.renameTab);
      if (!r.ok || r.inverse.type !== "updateField") return r;
      return { ...r, inverse: { type: "renameTab", tabId: cmd.tabId, label: r.inverse.value as TabLabel }, focusAfter: { kind: "tab", id: cmd.tabId } };
    }

    case "reorderTab": {
      const t = findTab(doc, cmd.tabId);
      if (!t) return refuse("not_found", [cmd.tabId]);
      if (isLocked(doc, t.loc.sectionIndex)) return refuse("locked", ["sections", t.loc.sectionIndex]);
      const next = clone(doc);
      const tabs = findTabs(next, t.block.id)!.block.tabs;
      const [moved] = tabs.splice(t.index, 1);
      tabs.splice(Math.min(Math.max(0, Math.trunc(cmd.toIndex)), tabs.length), 0, moved!);
      return ok(next, { type: "reorderTab", tabId: cmd.tabId, toIndex: t.index }, { kind: "tab", id: cmd.tabId }, L.reorderTab);
    }

    case "replaceMedia": {
      if (!MEDIA_ID_PATTERN.test(cmd.to)) return refuse("invalid");
      const paths = mediaPaths(doc, cmd.from);
      if (paths.length === 0) return refuse("not_found");
      return applySetMediaAt(doc, paths, paths.map(() => cmd.to), L.replaceMedia);
    }

    case "setMediaAt":
      return applySetMediaAt(doc, cmd.paths, cmd.ids, cmd.label);

    case "replaceDoc": {
      const label = replaceLabel(cmd.reason);
      return ok(clone(cmd.doc), { type: "replaceDoc", doc: clone(doc), reason: cmd.reason }, { kind: "page" }, label);
    }
  }
}

// ---- history (editor-core, bound to PageDoc commands) -----------------------------------

export type HistoryEntry = core.HistoryEntry<Command>;
export type History = core.History<Command>;

export const emptyHistory = (): History => core.emptyHistory<Command>();

/** Ends the open coalescing step (blur, save, undo/redo). Never drops a step. */
export const seal = (h: History): History => core.seal(h);

/** A save (manual or autosave) keeps the whole history; it only closes the open step. */
export const markSaved = seal;

/** Records an applied result. `now` is the caller's clock in ms. */
export const record = (h: History, result: TxOk, now: number): History => core.record(h, result, now);

/** Applies and records a command; a refusal leaves both the doc and the history as they were. */
export function commit(
  doc: PageDocV2,
  h: History,
  cmd: Command,
  now: number,
  ctx: TxContext = {},
): { doc: PageDocV2; history: History; result: TxResult } {
  const result = applyCommand(doc, cmd, ctx);
  if (!result.ok) return { doc, history: h, result };
  return { doc: result.doc, history: record(h, result, now), result };
}

export interface StepResult {
  doc: PageDocV2;
  history: History;
  selectionAfter: string[];
  focusAfter: Focus;
  label: string;
}

const toStep = (s: core.Stepped<Command, TxOk> | null): StepResult | null =>
  s && {
    doc: s.result.doc,
    history: s.history,
    selectionAfter: s.result.selectionAfter,
    focusAfter: s.result.focusAfter,
    label: s.label,
  };

/** Undoes the newest step, or returns null when there is none (or it no longer applies). */
export const undo = (doc: PageDocV2, h: History, ctx: TxContext = {}): StepResult | null =>
  toStep(core.undo<PageDocV2, Command, TxOk>(doc, h, (d, c) => applyCommand(d, c, ctx)));

/** Redoes the newest undone step, or returns null when there is none. */
export const redo = (doc: PageDocV2, h: History, ctx: TxContext = {}): StepResult | null =>
  toStep(core.redo<PageDocV2, Command, TxOk>(doc, h, (d, c) => applyCommand(d, c, ctx)));

// ---- the rich-text commit contract ----------------------------------------------------

export interface RichTextGateState {
  composing: boolean;
  dirty: boolean;
  lastInputAt: number;
}
export type RichTextGateEvent = {
  type: "input" | "compositionstart" | "compositionend" | "blur" | "tick";
  now: number;
};

/**
 * When a rich-text field hands its content to `updateField`: once on blur,
 * after RICH_TEXT_IDLE_MS without input, or at compositionend. While an IME
 * composition is open nothing commits (not even on blur or idle), so a
 * half-composed character never becomes an undo step. Inside the field the
 * editor's own undo handles text; this is the doc-level step.
 */
export const richTextGate = {
  initial: (): RichTextGateState => ({ composing: false, dirty: false, lastInputAt: 0 }),
  step(state: RichTextGateState, ev: RichTextGateEvent): { state: RichTextGateState; commit: boolean } {
    switch (ev.type) {
      case "input":
        return { state: { ...state, dirty: true, lastInputAt: ev.now }, commit: false };
      case "compositionstart":
        return { state: { ...state, composing: true }, commit: false };
      case "compositionend":
        return { state: { composing: false, dirty: false, lastInputAt: ev.now }, commit: true };
      case "blur":
        if (state.composing) return { state, commit: false };
        return { state: { ...state, dirty: false }, commit: state.dirty };
      case "tick":
        if (state.composing || !state.dirty || ev.now - state.lastInputAt < RICH_TEXT_IDLE_MS) return { state, commit: false };
        return { state: { ...state, dirty: false }, commit: true };
    }
  },
};
