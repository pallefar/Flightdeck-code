/**
 * EDITOR-CORE HISTORY (deck-editor-core, docs/PLAN-2026-09-26-PRESENTATION-STUDIO.md,
 * D-042). The undo/redo stack extracted from the PageDoc transactions
 * (web/src/pagedoc-editor/transactions.ts), made generic over the document D
 * and the command C so the PageDoc editor and the deck editor share one model.
 *
 * Pure: no React, no DOM, no timers, no clock. `now` is always the caller's.
 *
 * Model. History replays inverses: undo applies the stored inverse and keeps
 * ITS inverse as the redo, so redo is exact even for a command that issued
 * fresh ids. A new op clears the redo stack. Commands that carry the same
 * `coalesceKey` within `coalesceMs` of the previous step merge into it (one undo
 * step for a burst of typing); `seal` closes the open step (blur, save, undo,
 * redo) without dropping anything. The stack keeps at most `cap` steps; the
 * oldest falls off.
 *
 * Positions (the savepoint/dirty design lives in savepoint.ts). Every step gets
 * a `seq` number that is never reused, and a coalesced edit takes a FRESH seq
 * because it changed the document. The history's position is the seq of the
 * newest undoable step, or `floor` when there is none: floor is 0 for the
 * document as opened and becomes the seq of the last step the cap evicted, so
 * the bottom of a capped stack never looks like the opened document.
 */
import type { Applied } from "./result.js";
/** Undo steps kept; the oldest falls off. */
export declare const HISTORY_CAP = 100;
/** Edits with the same coalesce key closer together than this are one undo step. */
export declare const COALESCE_MS = 600;
export interface HistoryEntry<C> {
    /** Applied by undo. */
    undo: C;
    /** Applied by redo; set when the step is undone (the undo's own inverse). */
    redo: C | null;
    label: string;
    key: string | null;
    at: number;
    /** The position this step leads to; unique within one history. */
    seq: number;
}
export interface History<C> {
    readonly past: readonly HistoryEntry<C>[];
    readonly future: readonly HistoryEntry<C>[];
    /** When true the next edit starts a new step even inside the coalescing window. */
    readonly sealed: boolean;
    /** The position below past[0]: 0 = as opened, else the seq of the last evicted step. */
    readonly floor: number;
    /** The seq the next new position gets. */
    readonly nextSeq: number;
}
export interface HistoryOptions {
    cap?: number;
    coalesceMs?: number;
}
export declare const emptyHistory: <C>() => History<C>;
/** Ends the open coalescing step (blur, save, undo/redo). Never drops a step. */
export declare const seal: <C>(h: History<C>) => History<C>;
/** The current position: the newest undoable step's seq, or the floor. */
export declare const position: <C>(h: History<C>) => number;
/** Records an applied result. `now` is the caller's clock in ms. Clears redo. */
export declare function record<C>(h: History<C>, result: Applied<unknown, C>, now: number, opts?: HistoryOptions): History<C>;
/** An undo/redo step: the applied result and the history after it. */
export interface Stepped<C, R> {
    result: R;
    history: History<C>;
    label: string;
}
type Apply<D, C, R> = (doc: D, cmd: C) => R | {
    ok: false;
};
/** Undoes the newest step, or returns null when there is none (or it no longer applies). */
export declare function undo<D, C, R extends Applied<D, C>>(doc: D, h: History<C>, apply: Apply<D, C, R>): Stepped<C, R> | null;
/** Redoes the newest undone step, or returns null when there is none. */
export declare function redo<D, C, R extends Applied<D, C>>(doc: D, h: History<C>, apply: Apply<D, C, R>): Stepped<C, R> | null;
export {};
