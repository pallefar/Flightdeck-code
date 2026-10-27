/** A LOCAL CORE METADATA projection of the host's `subAppManifestSchema`
 * (`server/subapps/types.ts`) and minimum-host-version check.
 *
 * Generated files must pass strict literal admission in readEmittedManifest
 * before these metadata rules. Hand-written host source is a separate seam:
 * readHostManifestMetadata projects literal core fields with a position-based
 * omission ledger, without importing or executing host modules.
 *
 * __tests__/manifest-rules.test.ts pins local core schema expressions against
 * authoritative host AST (including resolved enum/regex aliases and nested
 * settingsPanel), rejects any unmodelled required host field, and validates
 * all four real manifests' core metadata. Optional additive schemas and
 * callback implementations are explicitly outside this projection. These
 * checks do not establish full host boot/runtime or installed-host validation. */
import { z } from "zod";
import { CAPABILITY_SCOPES, HOST_VERSION, NAV_SECTIONS, SUBAPP_ID_RE, WORKSPACE_ROLES } from "./spec-contract";

const ROUTE_PREFIX_RE = /^\/api\/apps\/[a-z0-9-]+$/;

const settingsPanelSchema = z.object({
  tier: z.enum(["workspace-admin", "super-admin"]),
  webComponentId: z.string().min(1),
  label: z.string().min(1),
});

/** Core metadata fields, not the complete additive host schema.
 * NOT `.strict()` — the host strips unknown keys. Authoritative AST checks
 * ensure every unmodelled schema field remains explicitly optional. */
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

/** Core metadata shape and minimum host-version compatibility, not a full
 * host boot guarantee. The historical name is retained for generated callers.
 * Optional additive schemas, callbacks, registry uniqueness and newer host
 * compatibility/install gates need their separate conformance/runtime checks.
 * Returns parsed core data; reports all core violations at once. */
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
