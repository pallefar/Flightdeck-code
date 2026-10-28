/**
 * EDITOR-CORE RESULT (deck-editor-core, docs/PLAN-2026-09-26-PRESENTATION-STUDIO.md).
 *
 * The one result shape every editor command returns, extracted from the PageDoc
 * transactions (web/src/pagedoc-editor/transactions.ts):
 *   { ok: true, doc, inverse, label, coalesceKey? , ...document-specific extras }
 * or a refusal
 *   { ok: false, code, messageKey, path }.
 * A refusal never changes the document or the history. Its messageKey is an
 * i18n key namespaced by the editor ("pageEditor.refusal", "deckEditor.refusal").
 *
 * Portable: pure TypeScript, no imports outside this directory, no React, no DOM.
 */
/** A path into the document where a refusal applies (ids, keys, indices). */
export type ResultPath = Array<string | number>;
/** What the history needs from an applied command. Editors extend it. */
export interface Applied<D, C> {
    ok: true;
    doc: D;
    /** The command that exactly undoes this one. */
    inverse: C;
    /** An i18n key naming the step (e.g. for 'Undone: Move'). */
    label: string;
    /** Equal keys within the coalescing window are one undo step. */
    coalesceKey?: string;
}
export interface Refusal<Code extends string = string> {
    ok: false;
    code: Code;
    messageKey: string;
    path: ResultPath;
}
export type EditorResult<Ok extends {
    ok: true;
}, Code extends string = string> = Ok | Refusal<Code>;
/** Builds a refusal whose messageKey is `${namespace}.${code}`. */
export declare const refusal: <Code extends string>(namespace: string, code: Code, path?: ResultPath) => Refusal<Code>;
