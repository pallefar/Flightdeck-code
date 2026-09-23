/** The workbench's line icons (Atlas match, 2026-09-23).
 *
 * ── WHY THIS FILE AND NOT `lucide-react` ────────────────────────────
 * Flightdeck Atlas draws a monochrome stroke icon beside nearly every
 * label — view tabs, every sidebar nav item, primary and secondary
 * buttons, the corner of every stat tile, callouts and chips. Measured on
 * the running Atlas (:5173, 1440px, light): `.nav-item svg` is 18px,
 * `.view-tabs button svg` 17px, `.add-button svg` 16px and
 * `.metric-label svg` 15px, all `viewBox="0 0 24 24"`, all
 * `stroke="currentColor"` at `stroke-width: 2`, so an active or hovered
 * control's icon takes that control's own colour. Studio had exactly one
 * SVG in the whole workbench (the theme toggle) and drew its disclosure
 * with Unicode triangles.
 *
 * Atlas gets them from the `lucide-react` package. Studio does not take
 * that dependency, for the same reason and by the same method the OS used
 * when it hit this (`flightdeck/web/src/components/LineIcon.tsx`, branches
 * `feat/atlas-design-os` / `feat/front-page-reference-hub`): CLAUDE.md
 * rule 8 — the icons below are a couple of kilobytes of path data, and a
 * package for them would be uncontrolled code on someone else's release
 * schedule, permanently. `atlas-type-and-icons.test.tsx` pins that no
 * icon package appears in `package.json` and that every shipped name
 * renders.
 *
 * ⚠ The path data is NOT hand-drawn. Every node below was read out of
 * `lucide-react@1.31.0`'s own `__iconNode` exports — the exact version
 * and the exact set Flightdeck Atlas renders — so an icon here and the
 * same icon in Atlas are the same shape, not a resemblance.
 *
 * Icon path data from Lucide v1.31.0 (https://lucide.dev), under its
 * licence:
 *
 *   ISC License
 *   Copyright (c) 2026 Lucide Icons and Contributors
 *
 *   Permission to use, copy, modify, and/or distribute this software for
 *   any purpose with or without fee is hereby granted, provided that the
 *   above copyright notice and this permission notice appear in all
 *   copies.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL
 *   WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED
 *   WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
 *   AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL
 *   DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR
 *   PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
 *   TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
 *   PERFORMANCE OF THIS SOFTWARE.
 *
 * Of the icons below, chevron-down, chevron-right, monitor, plus, minus,
 * check, folder, download, info, clock, server, lock, lock-open and
 * layout-dashboard are derived from the Feather project: MIT License,
 * Copyright (c) 2013-present Cole Bemis. Permission is hereby granted,
 * free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the
 * Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software
 * is furnished to do so, subject to the following conditions: The above
 * copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software. THE SOFTWARE IS
 * PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */
import { createElement, type ReactElement } from "react";

type IconNode = ReadonlyArray<readonly [string, Readonly<Record<string, string>>]>;

const ICONS = {
  // Views.
  "play": [["path", { d: "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" }]],
  "folder-open": [["path", { d: "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" }]],
  "git-compare": [["circle", { cx: "18", cy: "18", r: "3" }], ["circle", { cx: "6", cy: "6", r: "3" }], ["path", { d: "M13 6h3a2 2 0 0 1 2 2v7" }], ["path", { d: "M11 18H8a2 2 0 0 1-2-2V9" }]],
  "monitor": [["rect", { width: "20", height: "14", x: "2", y: "3", rx: "2" }], ["line", { x1: "8", x2: "16", y1: "21", y2: "21" }], ["line", { x1: "12", x2: "12", y1: "17", y2: "21" }]],
  "shield-check": [["path", { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }], ["path", { d: "m9 12 2 2 4-4" }]],
  // The file tree's tiers and rows.
  "server": [["rect", { width: "20", height: "8", x: "2", y: "2", rx: "2", ry: "2" }], ["rect", { width: "20", height: "8", x: "2", y: "14", rx: "2", ry: "2" }], ["line", { x1: "6", x2: "6.01", y1: "6", y2: "6" }], ["line", { x1: "6", x2: "6.01", y1: "18", y2: "18" }]],
  "layout-dashboard": [["rect", { width: "7", height: "9", x: "3", y: "3", rx: "1" }], ["rect", { width: "7", height: "5", x: "14", y: "3", rx: "1" }], ["rect", { width: "7", height: "9", x: "14", y: "12", rx: "1" }], ["rect", { width: "7", height: "5", x: "3", y: "16", rx: "1" }]],
  "flask-conical": [["path", { d: "M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2" }], ["path", { d: "M6.453 15h11.094" }], ["path", { d: "M8.5 2h7" }]],
  "wrench": [["path", { d: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z" }]],
  "folder": [["path", { d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" }]],
  "file-code": [["path", { d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" }], ["path", { d: "M14 2v5a1 1 0 0 0 1 1h5" }], ["path", { d: "M10 12.5 8 15l2 2.5" }], ["path", { d: "m14 12.5 2 2.5-2 2.5" }]],
  // Disclosure. These two replace ▸ and ▾ everywhere.
  "chevron-right": [["path", { d: "m9 18 6-6-6-6" }]],
  "chevron-down": [["path", { d: "m6 9 6 6 6-6" }]],
  // Buttons.
  "sparkles": [["path", { d: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" }], ["path", { d: "M20 2v4" }], ["path", { d: "M22 4h-4" }], ["circle", { cx: "4", cy: "20", r: "2" }]],
  "circle-stop": [["circle", { cx: "12", cy: "12", r: "10" }], ["rect", { x: "9", y: "9", width: "6", height: "6", rx: "1" }]],
  "download": [["path", { d: "M12 15V3" }], ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }], ["path", { d: "m7 10 5 5 5-5" }]],
  "rotate-ccw": [["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }], ["path", { d: "M3 3v5h5" }]],
  "lock": [["rect", { width: "18", height: "11", x: "3", y: "11", rx: "2", ry: "2" }], ["path", { d: "M7 11V7a5 5 0 0 1 10 0v4" }]],
  "lock-open": [["rect", { width: "18", height: "11", x: "3", y: "11", rx: "2", ry: "2" }], ["path", { d: "M7 11V7a5 5 0 0 1 9.9-1" }]],
  "check": [["path", { d: "M20 6 9 17l-5-5" }]],
  "undo-2": [["path", { d: "M9 14 4 9l5-5" }], ["path", { d: "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" }]],
  "package": [["path", { d: "M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" }], ["path", { d: "M12 22V12" }], ["polyline", { points: "3.29 7 12 12 20.71 7" }], ["path", { d: "m7.5 4.27 9 5.15" }]],
  // Stat-tile corners, callouts and status marks.
  "octagon-alert": [["path", { d: "M12 16h.01" }], ["path", { d: "M12 8v4" }], ["path", { d: "M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z" }]],
  "triangle-alert": [["path", { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" }], ["path", { d: "M12 9v4" }], ["path", { d: "M12 17h.01" }]],
  "circle-check": [["circle", { cx: "12", cy: "12", r: "10" }], ["path", { d: "m9 12 2 2 4-4" }]],
  "list-checks": [["path", { d: "M13 5h8" }], ["path", { d: "M13 12h8" }], ["path", { d: "M13 19h8" }], ["path", { d: "m3 17 2 2 4-4" }], ["path", { d: "m3 7 2 2 4-4" }]],
  "info": [["circle", { cx: "12", cy: "12", r: "10" }], ["path", { d: "M12 16v-4" }], ["path", { d: "M12 8h.01" }]],
  "clock": [["circle", { cx: "12", cy: "12", r: "10" }], ["path", { d: "M12 6v6l4 2" }]],
  "ban": [["circle", { cx: "12", cy: "12", r: "10" }], ["path", { d: "M4.929 4.929 19.07 19.071" }]],
  "settings": [["path", { d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" }], ["circle", { cx: "12", cy: "12", r: "3" }]],
  // Diff-row change kinds and the tree's draft marks.
  "plus": [["path", { d: "M5 12h14" }], ["path", { d: "M12 5v14" }]],
  "minus": [["path", { d: "M5 12h14" }]],
  "pencil": [["path", { d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" }], ["path", { d: "m15 5 4 4" }]],
} as const satisfies Record<string, IconNode>;

export type LineIconName = keyof typeof ICONS;

/** Every name this module ships, so a test can render all of them and a
 * reviewer can see the set without reading the table. */
export const ICON_NAMES = Object.keys(ICONS) as readonly LineIconName[];

/** One line icon.
 *
 * Decorative by default (`aria-hidden`): every place the workbench uses
 * one, the control already carries its own text or `aria-label`, and a
 * second announcement of "folder" before "manifest.ts" is noise to a
 * screen reader, not information.
 *
 * The default size is Atlas's view-tab size. The three other sizes Atlas
 * uses are passed explicitly at the call site (18 sidebar, 16 button,
 * 15 stat-tile corner) so each one is visible where it is chosen. */
export function LineIcon({ name, size = 17 }: { readonly name: LineIconName; readonly size?: number }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name].map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}

/** Open or shut, as Atlas draws disclosure: chevron-down when the thing
 * below is showing, chevron-right when it is not. One helper because
 * three places in the workbench make exactly this choice. */
export function Chevron({ open, size }: { readonly open: boolean; readonly size?: number }): ReactElement {
  return <LineIcon name={open ? "chevron-down" : "chevron-right"} {...(size === undefined ? {} : { size })} />;
}
