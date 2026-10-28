import { type ReactNode } from "react";
import { type RichText } from "../schema/index.js";
import type { RenderContext } from "./context.js";
interface ClickLike {
    button: number;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    defaultPrevented: boolean;
    preventDefault(): void;
}
/** A same-origin link goes through the host's navigate adapter; a modified
 * click (new tab or window) and external or mailto links stay the browser's.
 * In the editor no link leaves the canvas (and the anchor has no href). */
export declare function onLinkClick(href: string, ctx: RenderContext): (e: ClickLike) => void;
/** One locale's rich text as a list of elements. */
export declare function renderRichText(text: RichText, ctx: RenderContext): ReactNode[];
export {};
