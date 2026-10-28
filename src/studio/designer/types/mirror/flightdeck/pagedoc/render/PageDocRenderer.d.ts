import type { PageDocAdapters } from "../adapters.js";
import type { Locale, PageDocV2 } from "../schema/index.js";
import { type PageDocTheme } from "./root.js";
export interface PageDocRendererProps {
    doc: PageDocV2;
    /** The reader's language; missing text falls back (see pickLocalized). */
    locale: Locale;
    adapters: PageDocAdapters;
    /** Inside the editor canvas. */
    editing?: boolean;
    /** The host's default theme; the doc's own meta.theme wins. */
    theme?: PageDocTheme;
    /** Told about every block replaced by its fallback. */
    onBlockError?: (blockId: string, error: unknown) => void;
}
export declare function PageDocRenderer({ doc, locale, adapters, editing, theme, onBlockError }: PageDocRendererProps): import("react").FunctionComponentElement<import("./root.js").PageDocRootProps>;
