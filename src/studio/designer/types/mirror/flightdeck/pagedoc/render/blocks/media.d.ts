import { type ReactNode } from "react";
import type { PageDocMediaState } from "../../adapters.js";
import type { Block } from "../../schema/index.js";
import { type RenderContext } from "../context.js";
export type MediaBlock = Extract<Block, {
    type: "media";
}>;
type Localized = {
    en?: string | undefined;
    de?: string | undefined;
} | undefined;
/** The placeholder for a media item that is not ready. A decorative one says nothing. */
export declare function mediaStatus(state: PageDocMediaState, decorative: boolean, ctx: RenderContext): ReactNode;
/** How close to the viewport lazy media starts resolving. */
export declare const NEAR_VIEWPORT_MARGIN = "200px";
export interface ImageOptions {
    mediaId: string;
    alt: Localized;
    decorative?: boolean | undefined;
    className: string;
    /** Below-the-fold images resolve only near the viewport; the hero stays eager. */
    lazy?: boolean;
    focal?: {
        x: number;
        y: number;
    } | undefined;
}
/** An image through the media adapter: an <img> when ready, else its status. */
export declare function renderImage(o: ImageOptions, ctx: RenderContext): ReactNode;
export declare function renderCaption(value: Localized, ctx: RenderContext): ReactNode;
export declare function renderMedia(block: MediaBlock, ctx: RenderContext): ReactNode;
export {};
