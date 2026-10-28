import { z } from "../../../../vendor/zod/v4/index.js";
import { type PageDocV2 } from "./envelope.js";
export * from "./envelope.js";
export * from "./localized.js";
export * from "./text.js";
export * from "./blocksCore.js";
export * from "./blocksContent.js";
export * from "./layout.js";
export * from "./limits.js";
/** Every schema version this tree can read (after migration). */
export declare const SUPPORTED_VERSIONS: readonly number[];
/** Kept for the portable-tree slice's callers; the same list. */
export declare const PAGEDOC_READABLE_VERSIONS: readonly number[];
/** A doc's `schemaVersion` field: only the current version parses. */
export declare const pageDocVersionSchema: z.ZodLiteral<2>;
export type PageDocIssueCode = "schema" | "version" | "doc_too_large" | "block_too_large" | "too_many_blocks" | "duplicate_id" | "too_deep";
export interface PageDocIssue {
    code: PageDocIssueCode;
    path: Array<string | number>;
    message: string;
}
export type PageDocFailureCode = "invalid" | "too_new" | "too_old";
export type ParsePageDocResult = {
    ok: true;
    doc: PageDocV2;
} | {
    ok: false;
    code: PageDocFailureCode;
    issues: PageDocIssue[];
};
export type MigratePageDocResult = {
    ok: true;
    doc: unknown;
} | {
    ok: false;
    code: PageDocFailureCode;
    issues: PageDocIssue[];
};
/** Brings an older doc up to the current version. It does not validate the
 * result (parsePageDoc does) and never mutates its input. */
export declare function migratePageDoc(input: unknown): MigratePageDocResult;
/** Reads a doc from any source (store, import, Atlas feed, template). */
export declare function parsePageDoc(input: unknown): ParsePageDocResult;
/** A fresh id matching LIMITS.idPattern: 16 random lower-case letters/digits. */
export declare function newPageDocId(): string;
/**
 * Returns a copy of a doc, a section, or a list of blocks in which every node
 * `id` is new and unique. The plan (section 7, Lane C) runs it on every
 * paste, duplicate and JSON import of blocks or pages. Internal
 * references are remapped: by convention a property named `...Ref` (one id)
 * or `...Refs` (a list of ids) that points at an id inside the copied value
 * follows it; a reference to something outside the copy is left as it is.
 * A widget block's `config` is opaque data owned by the widget: an `id` or
 * `...Ref` key there is a value (e.g. a customer id), not a node, so it is
 * copied unchanged.
 * The input is never mutated.
 */
export declare function reissueIds<T>(value: T, makeId?: () => string): T;
