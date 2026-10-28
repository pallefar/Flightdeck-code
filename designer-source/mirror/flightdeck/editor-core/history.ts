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
export const HISTORY_CAP = 100;
/** Edits with the same coalesce key closer together than this are one undo step. */
export const COALESCE_MS = 600;

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

export const emptyHistory = <C>(): History<C> => ({ past: [], future: [], sealed: false, floor: 0, nextSeq: 1 });

/** Ends the open coalescing step (blur, save, undo/redo). Never drops a step. */
export const seal = <C>(h: History<C>): History<C> => (h.sealed ? h : { ...h, sealed: true });

/** The current position: the newest undoable step's seq, or the floor. */
export const position = <C>(h: History<C>): number => h.past[h.past.length - 1]?.seq ?? h.floor;

/** Records an applied result. `now` is the caller's clock in ms. Clears redo. */
export function record<C>(h: History<C>, result: Applied<unknown, C>, now: number, opts: HistoryOptions = {}): History<C> {
  const cap = opts.cap ?? HISTORY_CAP;
  const coalesceMs = opts.coalesceMs ?? COALESCE_MS;
  const last = h.past[h.past.length - 1];
  const key = result.coalesceKey ?? null;
  const seq = h.nextSeq;
  if (!h.sealed && last && key !== null && last.key === key && now - last.at <= coalesceMs) {
    return { ...h, past: [...h.past.slice(0, -1), { ...last, at: now, seq }], future: [], sealed: false, nextSeq: seq + 1 };
  }
  const entry: HistoryEntry<C> = { undo: result.inverse, redo: null, label: result.label, key, at: now, seq };
  const past = [...h.past, entry];
  const evict = past.length - cap;
  return {
    past: evict > 0 ? past.slice(evict) : past,
    future: [],
    sealed: false,
    floor: evict > 0 ? past[evict - 1]!.seq : h.floor,
    nextSeq: seq + 1,
  };
}

/** An undo/redo step: the applied result and the history after it. */
export interface Stepped<C, R> {
  result: R;
  history: History<C>;
  label: string;
}

type Apply<D, C, R> = (doc: D, cmd: C) => R | { ok: false };

/** Undoes the newest step, or returns null when there is none (or it no longer applies). */
export function undo<D, C, R extends Applied<D, C>>(doc: D, h: History<C>, apply: Apply<D, C, R>): Stepped<C, R> | null {
  const entry = h.past[h.past.length - 1];
  if (!entry) return null;
  const r = apply(doc, entry.undo);
  if (!r.ok) return null;
  return {
    result: r,
    history: { ...h, past: h.past.slice(0, -1), future: [...h.future, { ...entry, redo: r.inverse }], sealed: true },
    label: entry.label,
  };
}

/** Redoes the newest undone step, or returns null when there is none. */
export function redo<D, C, R extends Applied<D, C>>(doc: D, h: History<C>, apply: Apply<D, C, R>): Stepped<C, R> | null {
  const entry = h.future[h.future.length - 1];
  if (!entry || entry.redo === null) return null;
  const r = apply(doc, entry.redo);
  if (!r.ok) return null;
  return {
    result: r,
    history: { ...h, past: [...h.past, { ...entry, undo: r.inverse, redo: null }], future: h.future.slice(0, -1), sealed: true },
    label: entry.label,
  };
}
