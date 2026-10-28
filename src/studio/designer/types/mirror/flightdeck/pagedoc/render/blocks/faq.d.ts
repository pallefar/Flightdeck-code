import { type ReactNode } from "react";
import type { Block } from "../../schema/index.js";
import { type RenderContext } from "../context.js";
export type FaqBlock = Extract<Block, {
    type: "faq";
}>;
export declare function renderFaq(block: FaqBlock, ctx: RenderContext): ReactNode;
