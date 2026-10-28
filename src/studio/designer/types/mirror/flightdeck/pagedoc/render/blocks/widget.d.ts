import { type ReactNode } from "react";
import type { Block } from "../../schema/index.js";
import { type RenderContext } from "../context.js";
export type WidgetBlock = Extract<Block, {
    type: "widget";
}>;
export declare function renderWidget(block: WidgetBlock, ctx: RenderContext): ReactNode;
