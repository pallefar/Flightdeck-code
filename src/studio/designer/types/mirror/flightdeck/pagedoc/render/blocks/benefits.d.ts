import { type ReactNode } from "react";
import type { Block } from "../../schema/index.js";
import type { RenderContext } from "../context.js";
export type BenefitsBlock = Extract<Block, {
    type: "benefits";
}>;
export declare function renderBenefits(block: BenefitsBlock, ctx: RenderContext): ReactNode;
