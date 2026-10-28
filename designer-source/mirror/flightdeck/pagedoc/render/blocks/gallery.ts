// The gallery block: a list of captioned images, each through the media adapter.
// PORTABLE: mirrored byte for byte into Atlas lib/pagedoc, so only react,
// react-dom, 'zod/v4' and relative paths inside flightdeck/pagedoc may be
// imported (scripts/check-pagedoc-portable.mjs).
import { createElement as h, type ReactNode } from "react";
import type { Block } from "../../schema/index.js";
import type { RenderContext } from "../context.js";
import { renderCaption, renderImage } from "./media.js";

export type GalleryBlock = Extract<Block, { type: "gallery" }>;

export function renderGallery(block: GalleryBlock, ctx: RenderContext): ReactNode {
  return h(
    "ul",
    { className: "pd-gallery" },
    block.items.map((item) =>
      h(
        "li",
        { key: item.id, className: "pd-gallery-item" },
        h(
          "figure",
          { className: "pd-gallery-figure" },
          renderImage(
            { mediaId: item.mediaRef.mediaId, alt: item.alt, decorative: item.decorative, className: "pd-gallery-img", lazy: true },
            ctx,
          ),
          renderCaption(item.caption, ctx),
        ),
      ),
    ),
  );
}
