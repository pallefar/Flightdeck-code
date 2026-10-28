import { type ReactNode } from "react";
/** The closed theme preset set; each host maps --pd-* to its own tokens. */
export declare const PAGEDOC_THEMES: readonly ["default", "calm", "accent"];
export type PageDocTheme = (typeof PAGEDOC_THEMES)[number];
export interface PageDocRootProps {
    theme: PageDocTheme;
    /** BCP 47 language of the rendered text. */
    lang: string;
    /** Inside the editor canvas. */
    editing?: boolean;
    children?: ReactNode;
}
/** The element every rendered doc sits in; pagedoc.css scopes to `.pd-root`. */
export declare function PageDocRoot({ theme, lang, editing, children }: PageDocRootProps): import("react").DetailedReactHTMLElement<{
    "data-pd-editing"?: string | undefined;
    className: string;
    "data-pd-theme": "accent" | "default" | "calm";
    lang: string;
}, HTMLElement>;
