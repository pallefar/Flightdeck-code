// The rich text block.
// PORTABLE: mirrored byte for byte into Atlas lib/pagedoc, so only react,
// react-dom, 'zod/v4' and relative paths inside flightdeck/pagedoc may be
// imported (scripts/check-pagedoc-portable.mjs).
import { createElement as h, type ReactNode } from "react";
import type { Block } from "../../schema/index.js";
import { langAttrs, pickLocalized, type RenderContext } from "../context.js";
import { renderRichText } from "../richText.js";

export type RichTextBlock = Extract<Block, { type: "richText" }>;

export function renderRichTextBlock(block: RichTextBlock, ctx: RenderContext): ReactNode {
  const text = pickLocalized(block.content, ctx.locale, ctx.sourceLocale);
  if (!text) return null;
  return h("div", { className: "pd-rich-text", ...langAttrs(text, ctx.locale) }, renderRichText(text.value, ctx));
}
