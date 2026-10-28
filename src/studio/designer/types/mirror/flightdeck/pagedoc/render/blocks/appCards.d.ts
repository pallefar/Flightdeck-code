import { type ReactNode } from "react";
import type { Block } from "../../schema/index.js";
import { type RenderContext } from "../context.js";
export type AppCardsBlock = Extract<Block, {
    type: "appCards";
}>;
export declare function renderAppCards(block: AppCardsBlock, ctx: RenderContext): ReactNode;
