import { type PageDocV2 } from '../mirror/flightdeck/pagedoc/schema/index.js';
import { type History, type FieldPath } from '../mirror/flightdeck/web/src/pagedoc-editor/transactions.js';
export { markSaved } from '../mirror/flightdeck/web/src/pagedoc-editor/transactions.js';
import { type WidgetDescriptor } from '../contracts/os/flightdeck/server/widgets/types.js';
export interface DocumentPolicy {
    widgets: Readonly<Record<string, {
        configKeys: readonly string[];
        label: string;
        glyph: string;
    }>>;
}
export interface EditorState {
    doc: PageDocV2;
    history: History;
    selected: string | null;
    policy?: DocumentPolicy;
}
export declare const palette: readonly [{
    readonly key: "heading";
    readonly label: "Heading";
    readonly detail: "PageDoc content";
    readonly glyph: "H";
}, {
    readonly key: "text";
    readonly label: "Text";
    readonly detail: "PageDoc content";
    readonly glyph: "T";
}, {
    readonly key: "divider";
    readonly label: "Divider";
    readonly detail: "PageDoc structure";
    readonly glyph: "—";
}, {
    readonly key: "eval-score";
    readonly label: "Eval score";
    readonly detail: "OS StatTile · sample only";
    readonly glyph: "%";
}];
export type PaletteKey = typeof palette[number]['key'];
export declare function cataloguePolicy(rows: readonly {
    descriptor: WidgetDescriptor;
    label: string;
}[]): DocumentPolicy;
export declare function paletteFor(policy?: DocumentPolicy): readonly {
    key: string;
    label: string;
    detail: string;
    glyph: string;
}[];
export declare function validateDoc(input: unknown, policy?: DocumentPolicy): {
    ok: true;
    doc: PageDocV2;
} | {
    ok: false;
    code: import("../mirror/flightdeck/pagedoc/schema/index.js").PageDocFailureCode;
    issues: import("../mirror/flightdeck/pagedoc/schema/index.js").PageDocIssue[];
} | {
    ok: false;
    code: string;
};
export declare function initialDoc(): PageDocV2;
export declare function createPage(title: string): EditorState;
export declare function openDoc(input: unknown, policy?: DocumentPolicy): EditorState;
export declare function move(s: EditorState, id: string, parentId: string, index: number): EditorState;
export declare function remove(s: EditorState, id: string): EditorState;
export declare function step(s: EditorState, direction: 'undo' | 'redo'): EditorState;
export declare function edit(s: EditorState, path: FieldPath, value: unknown): EditorState;
export declare function layout(s: EditorState, sectionId: string, layout: PageDocV2['sections'][number]['layout']): EditorState;
export interface LocalDraft {
    doc: PageDocV2;
    notes: string;
    appearance: 'light' | 'dark';
    preview: 'desktop' | 'narrow';
    sample: 'mixed' | 'unknown' | 'pass';
}
export declare const STORAGE_KEY = "flightdeck.app-designer.local.v1";
type LocalStore = Pick<Storage, 'getItem' | 'setItem'>;
export declare function readLocal(store: Pick<Storage, 'getItem'>): LocalDraft | null;
export declare function saveLocal(store: LocalStore, value: LocalDraft): string;
export declare function insert(s: EditorState, key: string, parentId: string, index: number): EditorState;
