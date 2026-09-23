/** A callout, with the line icon Atlas leads its banners with.
 *
 * Atlas's `.demo-banner` and its management notice both open with a
 * stroke icon before the text (`globals.css:350-352`), and Studio's four
 * `.fd-note` call sites — the gate's summary line, the editor's refusal
 * and stale-line-number warnings, the diff's "no base" line and the run
 * pane's "no steps reported" — each wrote a bare `<p className="fd-note">`
 * instead. Four call sites is a recurrence, so this is one component
 * rather than the same two elements typed out four times; it is not a
 * callout *system*, and there is deliberately no third variant.
 *
 * `warn` is the amber management notice (a 3px bar on a tinted field);
 * without it this is the neutral banner. */
import { LineIcon } from "./LineIcon";

export function Note({
  warn = false,
  children,
}: {
  readonly warn?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <p className={`fd-note${warn ? " fd-note--warn" : ""}`}>
      <LineIcon name={warn ? "triangle-alert" : "info"} size={16} />
      <span>{children}</span>
    </p>
  );
}
