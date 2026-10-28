/** Shared rendering for the COMPONENT widgets' three honesty outcomes.
 *
 * ⚠ IN `parts/`, NOT beside the widgets, and that is load-bearing:
 * `registry.ts` globs `./*.tsx` one level deep and excludes only the two engine
 * names in `NOT_WIDGETS`, so a helper dropped next to the widgets would become a
 * nameable `webComponentId` — a layout could place the helper itself. A
 * subdirectory is outside that glob.
 *
 * Exists because there are now exactly THREE component widgets that all have to
 * make the same three-way distinction `DeclarativeWidget` makes (failed /
 * unknown / value) and emit the same `data-widget-outcome` hooks. Three copies
 * of an honesty rule is how one of them quietly ends up rendering a 0 for "we
 * don't know", so it has one owner. (Two copies would not have justified this;
 * the rule of three is the trigger.)
 *
 * Adds no CSS — `.stat`/`.v`/`.l`/`.warnbox` are all pre-existing.
 */
import type { KeyboardEvent } from "react";
import { t } from "../../i18n";
import { navigate } from "../../nav";

/** Verbatim the repo's div-clickable convention (Dashboard.tsx:73-78 and the
 * identical helper in DeclarativeWidget.tsx) — what satisfies
 * tests/keyboardOperability.test.tsx alongside role="button". */
const onTileKey = (fn: () => void) => (e: KeyboardEvent<HTMLElement>) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fn();
  }
};

/** The em-dash. Identical to DeclarativeWidget's, and the same rule applies:
 * this is what "we could not read it" looks like, and it is never a 0. */
export const NO_DATA = "—";

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

export function StatTile({ label, testId, value, tone, to }: StatTileProps) {
  const unknown = value === null;
  // ⛔ The guard is HERE rather than at each call site, so it cannot be
  // forgotten by the next widget. Same rule the declarative renderer enforces.
  const effectiveTone = unknown ? undefined : tone;
  const go = to ? () => navigate(to) : undefined;
  return (
    <div
      className={`stat${go ? " clickable" : ""}`}
      data-widget={testId}
      data-widget-outcome={unknown ? "no-data" : "value"}
      data-tone={effectiveTone ?? "none"}
      {...(go
        ? {
            role: "button",
            tabIndex: 0,
            onClick: go,
            onKeyDown: onTileKey(go),
            "aria-label": `${label}: ${unknown ? NO_DATA : value}`,
          }
        : {})}
    >
      <div className={`v${effectiveTone ? ` ${effectiveTone}` : ""}`}>{unknown ? NO_DATA : value}</div>
      <div className="l">{label}</div>
    </div>
  );
}

/** A named source failure. Names the ROUTE, so an operator knows where to look
 * — matching the declarative renderer's own failure box rather than inventing a
 * second wording for the same event. */
export function WidgetFailed({
  label,
  route,
  testId,
}: {
  label: string;
  route: string;
  testId?: string;
}) {
  return (
    <div className="warnbox" data-widget={testId} data-widget-outcome="source-failed" data-source={route}>
      {label}: {t("widget.sourceFailed")} <span className="mono">{route}</span>
    </div>
  );
}

/** In flight. A skeleton, never a zero. */
export function WidgetLoading({ label, testId }: { label: string; testId?: string }) {
  return (
    <div className="stat" data-widget={testId} data-widget-outcome="loading">
      <div className="v muted">{NO_DATA}</div>
      <div className="l">{label}</div>
    </div>
  );
}
