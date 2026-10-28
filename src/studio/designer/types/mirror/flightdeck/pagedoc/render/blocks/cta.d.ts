import { type ReactNode } from "react";
import type { PageDocAppState } from "../../adapters.js";
import { type Block, type CtaButton } from "../../schema/index.js";
import { type RenderContext } from "../context.js";
export type CtaBlock = Extract<Block, {
    type: "cta";
}>;
/** A button for a sub-app in its current state. `authorLabel` wins only in `authorState`. */
export declare function appButton(appId: string, className: string, ctx: RenderContext, authorLabel?: {
    text: ReactNode;
    attrs: Record<string, string>;
    state: PageDocAppState;
}): ReactNode;
/** A CTA button (the CTA block's and the hero's). */
export declare function renderCtaButton(button: CtaButton, ctx: RenderContext): ReactNode;
export declare function renderCta(block: CtaBlock, ctx: RenderContext): ReactNode;
