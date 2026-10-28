import type { PageDocAdapters } from "../adapters.js";
import type { Locale } from "../schema/index.js";
export interface RenderContext {
    /** The language the reader asked for. */
    locale: Locale;
    /** The language the page is written in (doc.meta.sourceLocale). */
    sourceLocale: Locale;
    adapters: PageDocAdapters;
    /** Inside the editor canvas: links do not navigate. */
    editing: boolean;
    onBlockError?: ((blockId: string, error: unknown) => void) | undefined;
}
export interface Picked<T> {
    value: T;
    /** The language `value` is written in. */
    lang: Locale;
    /** True when `value` is not in the requested locale. */
    fallback: boolean;
}
/**
 * The value of a localized field: the requested locale, else the other
 * locale, else the source locale. Null only when the field is absent (the
 * schema requires at least one locale in a present field).
 */
export declare function pickLocalized<T>(value: {
    en?: T | undefined;
    de?: T | undefined;
} | undefined, locale: Locale, sourceLocale: Locale): Picked<T> | null;
/** Attributes for an element holding picked text: fallback text says which
 * language it is really in (WCAG 3.1.2) and that the translation is missing. */
export declare function langAttrs(picked: Picked<unknown>, locale: Locale): Record<string, string>;
/** The renderer's built-in words: the failed-block notice. */
export declare const BLOCK_ERROR_TEXT: Readonly<Record<Locale, string>>;
/** The renderer's other built-in words: media states, the video's Play
 * button, app and page button labels and the widget and app-card notices. */
export declare const UI_TEXT: {
    readonly mediaLoading: {
        readonly en: "Loading media…";
        readonly de: "Medien werden geladen …";
    };
    readonly mediaMissing: {
        readonly en: "This media is no longer available.";
        readonly de: "Dieses Medium ist nicht mehr verfügbar.";
    };
    readonly mediaForbidden: {
        readonly en: "You do not have access to this media.";
        readonly de: "Sie haben keinen Zugriff auf dieses Medium.";
    };
    readonly play: {
        readonly en: "Play video";
        readonly de: "Video abspielen";
    };
    readonly appEnter: {
        readonly en: "Open";
        readonly de: "Öffnen";
    };
    readonly appEnable: {
        readonly en: "Enable app";
        readonly de: "App aktivieren";
    };
    readonly appRequest: {
        readonly en: "Request access";
        readonly de: "Zugang anfragen";
    };
    readonly appPending: {
        readonly en: "Access requested";
        readonly de: "Zugang angefragt";
    };
    readonly appDenied: {
        readonly en: "Access denied";
        readonly de: "Zugang abgelehnt";
    };
    readonly appUnavailable: {
        readonly en: "Not available";
        readonly de: "Nicht verfügbar";
    };
    readonly pageGone: {
        readonly en: "Page no longer available";
        readonly de: "Seite nicht mehr verfügbar";
    };
    readonly noApps: {
        readonly en: "No apps available.";
        readonly de: "Keine Apps verfügbar.";
    };
    readonly widgetOffline: {
        readonly en: "Open in FlightDeck OS to see live data";
        readonly de: "In FlightDeck OS öffnen, um Live-Daten zu sehen";
    };
    readonly captionsLabel: {
        readonly en: "English";
        readonly de: "Deutsch";
    };
};
