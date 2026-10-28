import { type ReactNode } from "react";
import type { Block } from "../../schema/index.js";
import { type RenderContext } from "../context.js";
export type HeroBlock = Extract<Block, {
    type: "hero";
}>;
export declare function renderHero(block: HeroBlock, ctx: RenderContext): ReactNode;
