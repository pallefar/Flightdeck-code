import { type ReactNode } from "react";
import type { Block } from "../../schema/index.js";
import { type RenderContext } from "../context.js";
export type RichTextBlock = Extract<Block, {
    type: "richText";
}>;
export declare function renderRichTextBlock(block: RichTextBlock, ctx: RenderContext): ReactNode;
