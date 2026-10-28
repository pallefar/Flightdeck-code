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
import { type Refusal } from "../../../editor-core/result.js";
import { type Block, type PageDocV2, type Section, type SectionLayout, type Tab } from "../../../pagedoc/schema/index.js";
/** Undo steps kept (HISTORY_CAP) and the coalescing window (COALESCE_MS): editor-core's defaults. */
export { COALESCE_MS, HISTORY_CAP } from "../../../editor-core/history.js";
export { isDirty, isReachable, savepointAt, takeSavepoint, type Savepoint } from "../../../editor-core/savepoint.js";
/** Rich text commits after this long without input (or on blur / compositionend). */
export declare const RICH_TEXT_IDLE_MS = 1000;
export declare const REFUSAL_CODES: readonly ["not_found", "empty_selection", "locked", "tabs_in_tabs", "structural_path", "min_tabs", "max_tabs", "invalid", "too_many_blocks", "doc_too_large", "block_too_large", "too_deep", "duplicate_id"];
export type RefusalCode = (typeof REFUSAL_CODES)[number];
export declare const REPLACE_REASONS: readonly ["import", "restore", "merge", "template"];
export type ReplaceReason = (typeof REPLACE_REASONS)[number];
/** Every label key a result can carry (the undo/redo announcements use them). */
export declare const TX_LABEL_KEYS: readonly string[];
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
export type Command = {
    type: "insert";
    block: Block;
    at: Target;
} | {
    type: "remove";
    ids: readonly string[];
}
/**
 * `value: undefined` removes an optional field. `restore: true` marks an
 * inverse that puts a field back to absent: if the field is already absent
 * (a coalesced set-then-remove with no net effect), it succeeds as a no-op
 * instead of refusing with not_found. A plain remove of an absent field is
 * still refused.
 */
 | {
    type: "updateField";
    path: FieldPath;
    value: unknown;
    restore?: true;
}
/** `to.index` counts in the target list AFTER the moved blocks left it. */
 | {
    type: "move";
    ids: readonly string[];
    to: Target;
} | {
    type: "moveSection";
    sectionId: string;
    toIndex: number;
} | {
    type: "setSectionLayout";
    sectionId: string;
    layout: SectionLayout;
}
/** Always re-issues every id (reissueIds), so a paste never duplicates one. */
 | {
    type: "paste";
    blocks: readonly Block[];
    at: Target;
} | {
    type: "addTab";
    tabsId: string;
    label: TabLabel;
    index?: number;
} | {
    type: "renameTab";
    tabId: string;
    label: TabLabel;
} | {
    type: "reorderTab";
    tabId: string;
    toIndex: number;
} | {
    type: "removeTab";
    tabId: string;
} | {
    type: "moveBlockToTab";
    ids: readonly string[];
    tabId: string;
    index: number;
} | {
    type: "replaceDoc";
    doc: PageDocV2;
    reason: ReplaceReason;
}
/**
 * Media "Replace" (pages-media-lifecycle): after the new file is uploaded,
 * every use of `from` in the draft points at `to`, as ONE undo step. The
 * old file stays in the library until nothing references it.
 */
 | {
    type: "replaceMedia";
    from: string;
    to: string;
} | {
    type: "setMediaAt";
    paths: readonly Path[];
    ids: readonly string[];
    label: string;
} | {
    type: "place";
    remove: readonly string[];
    entries: readonly PlaceEntry[];
    label: string;
} | {
    type: "restoreTab";
    tabsId: string;
    tab: Tab;
    index: number;
    label: string;
} | {
    type: "restoreSection";
    section: Section;
    label: string;
};
export type Focus = {
    kind: "block";
    id: string;
}
/** The '+' insert button of an (empty) column or tab. */
 | {
    kind: "insert";
    parentId: string;
} | {
    kind: "section";
    id: string;
} | {
    kind: "tab";
    id: string;
} | {
    kind: "field";
    path: FieldPath;
} | {
    kind: "page";
};
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
/** Block ids in outline order: a tabs block, then its tabs' blocks. */
export declare function blockOrder(doc: PageDocV2): string[];
/** Existing ids only, once each, in outline order, without blocks whose tabs block is also selected. */
export declare function normalizeSelection(doc: PageDocV2, ids: readonly string[]): string[];
/** Shift+click / Shift+Arrow: everything between anchor and target (inclusive), in outline order. */
export declare function selectRange(doc: PageDocV2, anchorId: string, targetId: string): string[];
/** Cmd/Ctrl+click: adds or removes one id. */
export declare function toggleSelection(selection: readonly string[], id: string): string[];
/** Applies one command to a doc. Pure: `doc` is never mutated. */
export declare function applyCommand(doc: PageDocV2, cmd: Command, ctx?: TxContext): TxResult;
export type HistoryEntry = core.HistoryEntry<Command>;
export type History = core.History<Command>;
export declare const emptyHistory: () => History;
/** Ends the open coalescing step (blur, save, undo/redo). Never drops a step. */
export declare const seal: (h: History) => History;
/** A save (manual or autosave) keeps the whole history; it only closes the open step. */
export declare const markSaved: (h: History) => History;
/** Records an applied result. `now` is the caller's clock in ms. */
export declare const record: (h: History, result: TxOk, now: number) => History;
/** Applies and records a command; a refusal leaves both the doc and the history as they were. */
export declare function commit(doc: PageDocV2, h: History, cmd: Command, now: number, ctx?: TxContext): {
    doc: PageDocV2;
    history: History;
    result: TxResult;
};
export interface StepResult {
    doc: PageDocV2;
    history: History;
    selectionAfter: string[];
    focusAfter: Focus;
    label: string;
}
/** Undoes the newest step, or returns null when there is none (or it no longer applies). */
export declare const undo: (doc: PageDocV2, h: History, ctx?: TxContext) => StepResult | null;
/** Redoes the newest undone step, or returns null when there is none. */
export declare const redo: (doc: PageDocV2, h: History, ctx?: TxContext) => StepResult | null;
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
export declare const richTextGate: {
    initial: () => RichTextGateState;
    step(state: RichTextGateState, ev: RichTextGateEvent): {
        state: RichTextGateState;
        commit: boolean;
    };
};
