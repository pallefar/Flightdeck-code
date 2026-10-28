import { type ReactNode } from "react";
import type { Block } from "../../schema/index.js";
import type { RenderContext } from "../context.js";
export type GalleryBlock = Extract<Block, {
    type: "gallery";
}>;
export declare function renderGallery(block: GalleryBlock, ctx: RenderContext): ReactNode;
