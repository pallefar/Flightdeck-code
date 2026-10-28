/** The em-dash. Identical to DeclarativeWidget's, and the same rule applies:
 * this is what "we could not read it" looks like, and it is never a 0. */
export declare const NO_DATA = "\u2014";
export interface StatTileProps {
    label: string;
    testId?: string;
    /** `null` means UNKNOWN — renders the em-dash and, critically, forces the
     * tone off regardless of what the caller passed. A caller cannot accidentally
     * colour an unknown value. */
    value: string | null;
    tone?: "green" | "amber" | "red";
    to?: string;
}
export declare function StatTile({ label, testId, value, tone, to }: StatTileProps): import("react").JSX.Element;
/** A named source failure. Names the ROUTE, so an operator knows where to look
 * — matching the declarative renderer's own failure box rather than inventing a
 * second wording for the same event. */
export declare function WidgetFailed({ label, route, testId, }: {
    label: string;
    route: string;
    testId?: string;
}): import("react").JSX.Element;
/** In flight. A skeleton, never a zero. */
export declare function WidgetLoading({ label, testId }: {
    label: string;
    testId?: string;
}): import("react").JSX.Element;
