/** A LOCAL COPY of the host's `subAppManifestSchema` rules
 * (`server/subapps/types.ts`) plus the two boot-time checks that sit beside
 * it in `registry.ts`.
 *
 * ⛔ WHY COPY A SCHEMA. The host's copy is the one that runs, and
 * `loadValidatedManifests` is fail-LOUD: one malformed generated manifest
 * does not get skipped, it takes the whole server down at boot. Codegen
 * therefore has to answer "would this boot?" BEFORE it writes a file —
 * which means having the rules here, in a package that does not and must
 * not import the host.
 *
 * ⭐ WHAT KEEPS THE COPY HONEST. `__tests__/manifest-rules.test.ts` runs
 * this schema against the FOUR REAL hand-written manifests on disk
 * (`shell-reference`, `docusign`, `maps`, `advantage`), read as source text
 * and parsed by `testing/readEmittedManifest.ts`. If the host widens or
 * narrows a rule, a real manifest stops matching this copy and that test
 * goes red — the drift is caught by reality, not by a comment asking
 * someone to remember. The contract document says it plainly: if this and
 * the host repo disagree, the host repo wins. */
import { z } from "zod";
import { CAPABILITY_SCOPES, HOST_VERSION, NAV_SECTIONS, SUBAPP_ID_RE, WORKSPACE_ROLES } from "./spec-contract";

const ROUTE_PREFIX_RE = /^\/api\/apps\/[a-z0-9-]+$/;

/** ⛔ D-036 (option b, fail-closed). The marker codegen stamps on every
 * manifest it generates, exactly as the host's `subAppManifestSchema`
 * declares it: `z.literal("flightdeck-studio").optional()`. The host's
 * `tests/subapps/launcherSubappDefaults.test.ts` keys on this exact string
 * and holds a marked sub-app to a STRICTER launcher rule — off by default,
 * its kill switch never named in `scripts/start-postgres.sh`. It grants
 * nothing; a hand-written manifest omits it. */
export const GENERATED_BY = "flightdeck-studio" as const;

const settingsPanelSchema = z.object({
  tier: z.enum(["workspace-admin", "super-admin"]),
  webComponentId: z.string().min(1),
  label: z.string().min(1),
});

/** Field-for-field with `server/subapps/types.ts#subAppManifestSchema`.
 * NOT `.strict()` — the host's is not either, and `widgets` is an optional
 * additive field this copy deliberately accepts without modelling (D-26's
 * additive rule: a manifest carrying one must still validate here). */
export const subAppManifestSchema = z.object({
  id: z.string().regex(SUBAPP_ID_RE),
  label: z.string().min(1),
  version: z.string(),
  minHostVersion: z.string(),
  icon: z.string().min(1),
  navSection: z.enum(NAV_SECTIONS),
  routePrefix: z.string().regex(ROUTE_PREFIX_RE),
  webModuleId: z.string().min(1),
  capabilities: z.array(z.enum(CAPABILITY_SCOPES)),
  visibleToRoles: z.array(z.enum(WORKSPACE_ROLES)).min(1),
  settingsPanel: settingsPanelSchema.optional(),
  generatedBy: z.literal(GENERATED_BY).optional(),
});

export type SubAppManifestData = z.infer<typeof subAppManifestSchema>;

/** Numeric-segment compare, ported from `registry.ts#isVersionNewer` — a
 * lexical string compare would call "5.9.0" newer than "5.10.0". */
export function isVersionNewer(version: string, baseline: string): boolean {
  const a = version.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const b = baseline.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  return false;
}

export class ManifestRuleError extends Error {
  constructor(message: string, readonly issues: readonly string[]) {
    super(message);
  }
}

/** Everything the host checks at boot, in one call: the Zod shape, then
 * `assertHostVersionCompatible`'s host-version skew rule. Returns the
 * parsed data; throws `ManifestRuleError` naming every violation at once
 * (the host names only the first — a generator that reported one field per
 * run would be miserable to use). */
export function assertManifestWouldBoot(candidate: unknown, hostVersion: string = HOST_VERSION): SubAppManifestData {
  const parsed = subAppManifestSchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new ManifestRuleError(`generated manifest would fail loadValidatedManifests: ${issues.join("; ")}`, issues);
  }
  if (isVersionNewer(parsed.data.minHostVersion, hostVersion)) {
    const issue = `minHostVersion: requires host >= ${parsed.data.minHostVersion}, but the host is ${hostVersion}`;
    throw new ManifestRuleError(`generated manifest would refuse to boot: ${issue}`, [issue]);
  }
  return parsed.data;
}
