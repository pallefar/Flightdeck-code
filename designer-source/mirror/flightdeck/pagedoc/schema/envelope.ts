// The PageDoc v2 envelope. PORTABLE: mirrored byte for byte into Atlas
// lib/pagedoc, so only react, react-dom, 'zod/v4' and relative paths inside
// flightdeck/pagedoc may be imported (scripts/check-pagedoc-portable.mjs).
//
// { schemaVersion: 2, meta: {...}, sections: [...] }
//
// The server-owned page record (class, review requirement, visibility, slug,
// page_id) lives OUTSIDE the doc (plan section 7, Lane C: "Server-owned
// classification"), so an author cannot change it by editing or importing a
// doc. `meta` holds only what readers see and approval covers.
import { z } from "zod/v4";
import { LIMITS } from "./limits.js";
import { localeSchema, localizedPlain } from "./localized.js";
import { sectionSchema } from "./layout.js";

export const PAGEDOC_SCHEMA_VERSION = 2;

export const PAGEDOC_THEME_VALUES = ["default", "calm", "accent"] as const;

export const pageMetaSchema = z.strictObject({
  /** The language the page is written in; the other one is a translation. */
  sourceLocale: localeSchema,
  title: localizedPlain(LIMITS.maxTitleChars),
  description: localizedPlain(300).optional(),
  theme: z.enum(PAGEDOC_THEME_VALUES).optional(),
});
export type PageMeta = z.infer<typeof pageMetaSchema>;

export const pageDocV2Schema = z.strictObject({
  schemaVersion: z.literal(PAGEDOC_SCHEMA_VERSION),
  meta: pageMetaSchema,
  sections: z.array(sectionSchema).max(LIMITS.maxSections),
});
export type PageDocV2 = z.infer<typeof pageDocV2Schema>;
