// The divider block: a thematic break.
// PORTABLE: mirrored byte for byte into Atlas lib/pagedoc, so only react,
// react-dom, 'zod/v4' and relative paths inside flightdeck/pagedoc may be
// imported (scripts/check-pagedoc-portable.mjs).
import { createElement as h, type ReactNode } from "react";

export function renderDivider(): ReactNode {
  return h("hr", { className: "pd-divider" });
}
