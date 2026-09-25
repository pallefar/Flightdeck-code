/** A local copy of the host's `subAppManifestSchema` — the rules
 * `loadValidatedManifests` applies at boot.
 *
 * ⛔ WHY A COPY IS THE RIGHT ANSWER HERE. The host's schema is the one
 * that runs, and this package must not import the host: the gate runs in
 * Studio, against a candidate that has not been written anywhere yet,
 * possibly on a machine with no checkout of the host at all. The contract
 * document is explicit that if this and the host repo disagree, the host
 * repo wins — so the copy is transcribed from `server/subapps/types.ts`
 * field for field and carries the line reference in each comment.
 *
 * ⚠ NOT `.strict()`, because the host's is not either. `widgets` is an
 * optional additive field the host accepts without modelling, and a
 * manifest carrying one must validate here exactly as it would there.
 * Adding strictness would make this gate REFUSE apps the host would boot,
 * which is the one failure mode a gate must not have: it teaches people to
 * bypass it. */
import { z } from "zod";
import { CAPABILITIES, HOST_VERSION, LISTING_CATEGORIES, NAV_SECTIONS, ROLES, ROUTE_PREFIX_RE, SUBAPP_ID_RE, isVersionNewer } from "./derive";

const settingsPanelSchema = z.object({
  tier: z.enum(["workspace-admin", "super-admin"]),
  webComponentId: z.string().min(1),
  label: z.string().min(1),
});

/** apps-01 / apps-49 — the host's `subAppListingSchema`, transcribed. The
 * app-directory FACTS block, `.strict()` in the host (and so here): copy,
 * URLs, media and release state are human-owned per release, and an unknown
 * key there refuses to boot. Without this field the gate would strip a
 * generated `listing` unexamined and pass a manifest the host would not boot. */
const listingSchema = z
  .object({
    availability: z.enum(["available", "coming-soon"]),
    discoverable: z.boolean().default(false),
    category: z.enum(LISTING_CATEGORIES),
    requirements: z.array(z.string().regex(SUBAPP_ID_RE)).max(5).optional(),
    publisher: z.object({ name: z.string().min(1) }).strict(),
  })
  .strict();

export const subAppManifestSchema = z.object({
  /** Locked once shipped: the env var, the nav path and the table prefix
   * are all derived from it. */
  id: z.string().regex(SUBAPP_ID_RE, "must match /^[a-z0-9][a-z0-9-]*$/"),
  /** Rendered verbatim in the nav — literal English, not an i18n key. */
  label: z.string().min(1, "must not be empty"),
  version: z.string(),
  minHostVersion: z.string(),
  icon: z.string().min(1, "must not be empty"),
  /** Exact string match against the host's UI_NAV_SECTIONS. */
  navSection: z.enum(NAV_SECTIONS),
  /** One segment, no sub-path. */
  routePrefix: z.string().regex(ROUTE_PREFIX_RE, "must match /^\\/api\\/apps\\/[a-z0-9-]+$/"),
  webModuleId: z.string().min(1, "must not be empty"),
  capabilities: z.array(z.enum(CAPABILITIES)),
  /** Required and non-empty: this array is the whole RBAC derivation. */
  visibleToRoles: z.array(z.enum(ROLES)).min(1, "is required and must be non-empty"),
  settingsPanel: settingsPanelSchema.optional(),
  /** D-036 — `server/subapps/types.ts` (host fix/os-generated-subapp-launcher-rule
   * 7183ff8a, line 108): `generatedBy: z.literal("flightdeck-studio").optional()`.
   * The marker Studio's codegen stamps on every manifest it emits; the host's
   * `launcherSubappDefaults.test.ts` keys its stricter launcher rule (off by
   * default) on it. A LITERAL, as in the host: any other value is refused
   * here exactly as the host refuses it fail-loud at boot. Transcribed, not
   * widened — this object is not `.strict()`, so leaving the field out would
   * strip a misspelt marker and pass a manifest the host would not boot. */
  generatedBy: z.literal("flightdeck-studio").optional(),
  /** apps-01: optional app-directory facts (see listingSchema above). */
  listing: listingSchema.optional(),
});

export type SubAppManifestData = z.infer<typeof subAppManifestSchema>;

export interface ManifestIssue {
  /** Dotted path of the offending field, or `(root)`. */
  readonly path: string;
  /** The top-level field, for anchoring the finding to a source line. */
  readonly field: string | null;
  readonly message: string;
}

export function validateManifestData(data: unknown): ManifestIssue[] {
  const parsed = subAppManifestSchema.safeParse(data);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => {
    const first = issue.path[0];
    return {
      path: issue.path.length === 0 ? "(root)" : issue.path.join("."),
      field: typeof first === "string" ? first : null,
      message: issue.message,
    };
  });
}

/** `assertHostVersionCompatible`: a manifest asking for a newer host does
 * not get skipped, it stops the boot. */
export function exceedsHostCeiling(minHostVersion: unknown, hostVersion: string = HOST_VERSION): boolean {
  return typeof minHostVersion === "string" && isVersionNewer(minHostVersion, hostVersion);
}
