import { Component, type ReactNode } from "react";
import type { Locale } from "../schema/index.js";
/** Stands in for a block that failed; keeps its slot and its id. */
export declare function BlockFallback({ blockId, locale }: {
    blockId: string;
    locale: Locale;
}): import("react").DetailedReactHTMLElement<{
    className: string;
    "data-pd-id": string;
    lang: "en" | "de";
}, HTMLElement>;
export interface BlockBoundaryProps {
    blockId: string;
    locale: Locale;
    onError?: ((blockId: string, error: unknown) => void) | undefined;
    children?: ReactNode;
}
export declare class BlockBoundary extends Component<BlockBoundaryProps, {
    failed: boolean;
}> {
    state: {
        failed: boolean;
    };
    static getDerivedStateFromError(): {
        failed: boolean;
    };
    componentDidCatch(error: unknown): void;
    render(): ReactNode;
}
