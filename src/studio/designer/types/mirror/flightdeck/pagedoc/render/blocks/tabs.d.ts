import { type ReactNode } from "react";
import type { Block } from "../../schema/index.js";
import { type RenderContext } from "../context.js";
export type TabsBlock = Extract<Block, {
    type: "tabs";
}>;
type Inner = TabsBlock["tabs"][number]["blocks"][number];
/** `renderBlock` is Section's per-block renderer (isolation included), passed in to avoid an import cycle. */
export declare function renderTabs(block: TabsBlock, ctx: RenderContext, renderBlock: (b: Inner, ctx: RenderContext) => ReactNode): ReactNode;
export {};
