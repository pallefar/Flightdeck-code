import { type ReactNode } from "react";
import { type RenderContext } from "../context.js";
type Localized = {
    en?: string | undefined;
    de?: string | undefined;
} | undefined;
/** A localized plain text in the given element, or nothing when absent. */
export declare function localizedText(tag: string, className: string, value: Localized, ctx: RenderContext): ReactNode;
export {};
