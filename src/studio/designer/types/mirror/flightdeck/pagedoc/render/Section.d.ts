import type { Section as SectionData } from "../schema/index.js";
import type { RenderContext } from "./context.js";
export declare function Section({ section, ctx }: {
    section: SectionData;
    ctx: RenderContext;
}): import("react").DetailedReactHTMLElement<{
    className: string;
    "data-pd-id": string;
}, HTMLElement>;
