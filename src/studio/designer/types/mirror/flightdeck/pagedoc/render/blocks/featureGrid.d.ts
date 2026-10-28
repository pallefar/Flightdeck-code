import { type ReactNode } from "react";
import type { Block } from "../../schema/index.js";
import type { RenderContext } from "../context.js";
export type FeatureGridBlock = Extract<Block, {
    type: "featureGrid";
}>;
export declare function renderFeatureGrid(block: FeatureGridBlock, ctx: RenderContext): ReactNode;
