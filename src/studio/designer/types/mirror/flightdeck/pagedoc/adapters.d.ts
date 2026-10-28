import type { ReactNode } from "react";
/** The version of the contract below. */
export declare const PAGEDOC_ADAPTER_CONTRACT_VERSION = 3;
/**
 * A media item as the host currently has it. `ready.url` is an address the
 * host made for bytes it already fetched (typically a blob: URL). A missing
 * or forbidden item carries no address at all, so the renderer cannot leak one.
 */
export type PageDocMediaState = {
    status: "loading";
} | {
    status: "ready";
    url: string;
} | {
    status: "missing";
} | {
    status: "forbidden";
};
export interface PageDocMediaAdapter {
    /**
     * Called while rendering. The first call for an id may start the host's
     * fetch (behind its own rights check) and return `loading`; the host
     * re-renders the page when the state changes. The renderer asks only for
     * what it shows: below-the-fold media (every image but the hero's, and video
     * posters) only once it nears the viewport, never during a server render,
     * and a video's bytes and caption tracks only after Play.
     */
    resolve(mediaId: string): PageDocMediaState;
}
/**
 * What the reader can do with a sub-app (app cards, CTAs):
 * - enter: open it;
 * - enable: the reader may switch it on here;
 * - request: the reader may ask for access;
 * - pending: an access request is waiting;
 * - denied: access was refused;
 * - unavailable: none of the above.
 */
export type PageDocAppState = "enter" | "enable" | "request" | "pending" | "denied" | "unavailable";
/** The app states a reader can act on; the renderer passes one to appAction. */
export type PageDocAppAction = Extract<PageDocAppState, "enter" | "enable" | "request">;
/** What an app card shows about a sub-app. */
export interface PageDocAppCard {
    name: string;
    tagline?: string;
}
/** A widget block's request to the host's gated widget runtime. */
export interface PageDocWidgetRequest {
    blockId: string;
    widgetId: string;
    config?: Readonly<Record<string, unknown>>;
}
export interface PageDocAdapters {
    /** The host's media fetcher (see PageDocMediaAdapter). */
    media: PageDocMediaAdapter;
    /** The href of another page, addressed by its immutable page_id (never by slug); null when the page is gone or the reader cannot open it. */
    resolvePage(pageId: string): string | null;
    /** Client-side navigation to a same-origin path ('/...'); the renderer calls it instead of a full page load. */
    navigate(href: string): void;
    /** The host's widget runtime (the OS WidgetHost is OS-only, so it is injected); null where live data cannot be shown (Atlas). */
    widget(request: PageDocWidgetRequest): ReactNode | null;
    /** The reader's state for a sub-app. */
    appState(appId: string): PageDocAppState;
    /** The reader pressed an app CTA or card button in an actionable state. */
    appAction(appId: string, action: PageDocAppAction): void;
    /** The name (and tagline) of a sub-app; null when the reader may not learn it exists. */
    appCard(appId: string): PageDocAppCard | null;
    /** The sub-apps this reader may see, in the host's order (app cards with source 'all-visible'). */
    visibleApps(): readonly string[];
}
