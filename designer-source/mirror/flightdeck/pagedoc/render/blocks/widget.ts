// The widget slot: whatever the host's widget runtime renders, or, where the
// host shows no live data (it returns null), a notice pointing to the OS.
// PORTABLE: mirrored byte for byte into Atlas lib/pagedoc, so only react,
// react-dom, 'zod/v4' and relative paths inside flightdeck/pagedoc may be
// imported (scripts/check-pagedoc-portable.mjs).
import { createElement as h, type ReactNode } from "react";
import type { Block } from "../../schema/index.js";
import { UI_TEXT, type RenderContext } from "../context.js";

export type WidgetBlock = Extract<Block, { type: "widget" }>;

export function renderWidget(block: WidgetBlock, ctx: RenderContext): ReactNode {
  const live = ctx.adapters.widget({
    blockId: block.id,
    widgetId: block.widgetId,
    ...(block.config ? { config: block.config } : {}),
  });
  return h(
    "div",
    { className: "pd-widget", "data-pd-widget": block.widgetId },
    live ?? h("p", { className: "pd-widget-notice" }, UI_TEXT.widgetOffline[ctx.locale]),
  );
}
