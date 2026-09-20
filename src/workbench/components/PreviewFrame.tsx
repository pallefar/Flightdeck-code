/** The isolation boundary the preview renders inside.
 *
 * ── WHY AN IFRAME WHEN NOTHING GENERATED IS EXECUTED ────────────────
 * `descriptor.ts` never evaluates the generated file, so this frame is not
 * a sandbox against code execution — that threat was removed upstream. It
 * is here for the two things that are still real:
 *
 * 1. CSS. The generated page uses the HOST's class names — `page`, `card`,
 *    `muted`, `mono`, `errorbox`, `okbox` — because contract §9 keeps every
 *    sub-app's CSS in the shared `web/src/theme.css` and `web/src/subapps`
 *    holds zero stylesheets. Rendered in Studio's document, `.card` would
 *    pick up Studio's `.card`, and the preview would show the page dressed
 *    in a stylesheet it will never meet. A separate document means the only
 *    CSS in scope is the one handed in.
 * 2. Layout. The page must lay out against its own viewport, not against
 *    whatever width is left beside the findings rail.
 *
 * ── WHY `sandbox="allow-same-origin"` AND NOTHING ELSE ──────────────
 * Note what is NOT in that list. No `allow-scripts`: the frame's document
 * cannot run a script at all, so even a `<script>` that somehow reached it
 * is inert. No `allow-forms`: the mirror's forms are handled by React
 * listeners from the parent, so a real submit is never needed and a stray
 * one cannot navigate. No `allow-popups`, no `allow-top-navigation`.
 *
 * `allow-same-origin` is present, and it is the one trade-off worth
 * stating: it is what lets the parent reach `contentDocument` and portal
 * React into it. Without it there is no way to render Studio's components
 * inside the frame without shipping a script — and shipping a script into
 * the frame is precisely what `allow-scripts` would then have to permit.
 * Same-origin WITHOUT scripts is the strictly safer half of that pair:
 * the frame gains reachability, not capability. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  /** The frame's entire stylesheet, as text. */
  readonly css: string;
  readonly title: string;
  readonly children: ReactNode;
}

const STYLE_ID = "fd-frame-style";

export function PreviewFrame({ css, title, children }: Props) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const frame = ref.current;
    if (frame === null) return;

    /** Runs on mount and again on `load`. An `about:blank` frame usually
     * has its document ready synchronously after insertion, but not in
     * every browser and not after a re-parent — and a preview that works
     * "usually" is a preview that is blank in somebody's screenshot. Doing
     * both is cheap and the style-id check makes it idempotent. */
    const attach = (): void => {
      const doc = frame.contentDocument;
      if (doc === null) return;
      if (doc.getElementById(STYLE_ID) === null) {
        const style = doc.createElement("style");
        style.id = STYLE_ID;
        style.textContent = css;
        doc.head.appendChild(style);
      }
      setBody(doc.body);
    };

    attach();
    frame.addEventListener("load", attach);
    return () => frame.removeEventListener("load", attach);
  }, [css]);

  return (
    <>
      <iframe
        ref={ref}
        className="fd-preview__frame"
        title={title}
        sandbox="allow-same-origin"
      />
      {body === null ? null : createPortal(children, body)}
    </>
  );
}
