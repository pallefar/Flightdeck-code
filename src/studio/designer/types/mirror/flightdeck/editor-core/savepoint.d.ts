/**
 * EDITOR-CORE SAVEPOINTS (deck-editor-core, docs/PLAN-2026-09-26-PRESENTATION-STUDIO.md).
 * New design: the PageDoc transactions only had `markSaved = seal`.
 *
 * A savepoint is the history POSITION (history.ts) at which the document was
 * last saved (or opened). The document is DIRTY exactly when the current
 * position is not the savepoint's position. Consequences, each pinned in
 * tests/editorCore/history.test.ts:
 * - Undo past the savepoint: dirty. Redo (or undo) back onto it: clean again,
 *   because undo/redo move between positions without minting new ones.
 * - Any new op mints a new position, so it is dirty, even when it happens to
 *   recreate the saved content (dirty is about history, not a deep compare).
 * - An edit coalesced into the saved step mints a fresh position too, so it is
 *   dirty; `takeSavepoint` also seals, so after a save the next edit is always
 *   a separate undo step.
 * - A new op after undoing past the savepoint clears the redo branch that held
 *   it; the savepoint is then unreachable and the document stays dirty until
 *   the next save. The same holds when the cap evicts the saved step: the
 *   bottom of a capped stack is a position of its own (the floor), never the
 *   opened document.
 * A save never clears the history.
 *
 * Pure: no React, no DOM, no clock.
 */
import { type History } from "./history.js";
export interface Savepoint {
    readonly position: number;
}
/** The savepoint for the history as it is now (a freshly opened document: `savepointAt(emptyHistory())`). */
export declare const savepointAt: <C>(h: History<C>) => Savepoint;
/** A save: seals the open step and returns the savepoint for the current position. */
export declare function takeSavepoint<C>(h: History<C>): {
    history: History<C>;
    savepoint: Savepoint;
};
/** True when the document is not the one the savepoint recorded. */
export declare const isDirty: <C>(h: History<C>, sp: Savepoint) => boolean;
/** True when undo or redo can still get back to the savepoint. */
export declare function isReachable<C>(h: History<C>, sp: Savepoint): boolean;
