/** HOST STAND-IN — not emitted. See `src/server/db.ts`.
 *
 * `SubAppManifest`, `SubAppCapabilities` and `RegisterRoutesCtx` as
 * `flightdeck/server/subapps/types.ts` declares them, minus the Zod schema
 * (validation is the host's job at boot) and minus `widgets`/`AuthorityResolution`
 * (Studio declares neither). The field rules that matter are in the TYPES here
 * and in the contract doc; `@conformance`'s manifest check is the thing that
 * actually enforces them on emitted text. */
import type { FastifyInstance } from "fastify";
import type { Db } from "../db.js";

export const CAPABILITY_SCOPES = ["read:contracts", "write:inbox-proposal"] as const;
export type CapabilityScope = (typeof CAPABILITY_SCOPES)[number];

/** Exact string equality against the host's `UI_NAV_SECTIONS`. A manifest
 * naming a section the shell does not know does not error — it silently forms
 * an accordion group of its own, which is why this is a closed union. */
export type NavSection = "Overview" | "Contract pipeline" | "Ops & insight" | "Admin" | "System apps";

/** `super_admin` is an INSTANCE role and is deliberately absent, matching the
 * host's own `WORKSPACE_ROLE_VALUES`. */
export type WorkspaceRole = "hr_preparer" | "hr_reviewer" | "wc_liaison" | "legal" | "admin";

export interface ContractFolder {
  ticket: string;
  dir: string;
  folderName: string;
}

/** The ONLY server-side surface a sub-app route may use to touch contracts,
 * proposals and the audit log. There is no filesystem write on it, and that
 * absence is the whole reason Studio proposes rather than installs. */
export interface SubAppCapabilities {
  readContracts(): ContractFolder[];
  writeInboxProposal(fileName: string, content: unknown): string;
  /** Filenames under `memory/proposals/` that THIS sub-app wrote — its own
   * `<id>-` prefix only. Gated by `write:inbox-proposal`. Exists so a writer
   * can be idempotent without a filesystem import of its own. */
  listOwnInboxProposals(): string[];
  auditAppend(event: Record<string, unknown> & { event: string }): { hash: string };
}

export interface RegisterRoutesCtx {
  /** Built from that workspace's OWN live install row, re-read on every call. */
  capabilitiesFor(workspaceId: string): Promise<SubAppCapabilities>;
}

export interface SubAppManifestData {
  /** `/^[a-z0-9][a-z0-9-]*$/`. LOCKED once shipped: the env var, the nav path
   * and the table prefix are all derived from it. */
  id: string;
  /** Literal English, rendered verbatim. Not an i18n key. */
  label: string;
  version: string;
  /** Must be `<= 5.0.0` or the server refuses to boot. */
  minHostVersion: string;
  icon: string;
  navSection: NavSection;
  /** `/^\/api\/apps\/[a-z0-9-]+$/` — one segment, no sub-path. */
  routePrefix: string;
  /** Directory name under `web/src/subapps/`. */
  webModuleId: string;
  /** The array IS the human consent screen. Declare the narrowest set. */
  capabilities: CapabilityScope[];
  /** Required and NON-EMPTY: a schema-valid manifest can never produce zero
   * derived RBAC coverage. */
  visibleToRoles: WorkspaceRole[];
}

export interface SubAppManifest extends SubAppManifestData {
  initSchema(db: Db): void | Promise<void>;
  registerRoutes(app: FastifyInstance, ctx: RegisterRoutesCtx): void;
}
