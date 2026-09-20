/** The target platform, modelled twice: once as types to compile against,
 * once as running code to mount against.
 *
 * ⭐ WHY A SURFACE AND NOT A CHECKOUT. "Does this compile?" is not a
 * question you can ask about a sub-app on its own. `manifest.ts` imports
 * `../types.js`, the guard imports `../killSwitch.js`, a route imports
 * `ctx.capabilitiesFor`. Typechecking the candidate alone would report
 * nine unresolved modules and nothing else — the interesting errors (a
 * handler that returns the wrong shape, a column that is not in the row
 * type, a promise that was never awaited) all live in the seams between
 * the sub-app and the host. So the seam is declared here, from
 * `docs/FLIGHTDECK-SUBAPP-CONTRACT.md` §2-§5, and the candidate is
 * compiled against it.
 *
 * ⛔ THIS IS A MODEL, NOT THE HOST. Studio does not have the host repo on
 * disk, and a surface that drifts from the real one would reject correct
 * code — the one failure mode this package refuses to have. Two
 * consequences, both deliberate:
 *
 *   • Every declaration below is as WIDE as the contract permits. Where
 *     the contract pins a shape (the manifest's fields, the guard's
 *     signature) it is exact; where it does not (what a row from
 *     `db.all` contains) it is `unknown[]`, never an invented row type.
 *     A wide surface can miss an error. A narrow wrong one invents them,
 *     and people route around a gate that cries wolf.
 *   • It is REPLACEABLE. `verifySubApp({ hostSurface })` takes a surface
 *     built from a real checkout, and everything downstream of here —
 *     the compiler host, the sandbox, the mount probe — contains not one
 *     line that knows what a sub-app is.
 *
 * `runtime` is the same seam as executable stubs. Every one of them is a
 * RECORDER: it reports what the generated code asked for and returns a
 * plausible empty answer, so the probe can watch a handler's real
 * behaviour instead of inferring it from the source text. */

export interface HostSurface {
  /** Extensionless repo-relative module path -> `.d.ts` source. */
  readonly types: Readonly<Record<string, string>>;
  /** The same modules as ESM JavaScript, for the sandboxed mount. Each
   * one delegates to `globalThis.__fdProbe`, which the harness owns. */
  readonly runtime: Readonly<Record<string, string>>;
  /** Module augmentations the host performs, keyed the same way. These
   * declare no module of their own; they are added to the program so the
   * augmentation is in scope. */
  readonly ambient: Readonly<Record<string, string>>;
}

const TYPES_DTS = `import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db } from "../db.js";

export type NavSection = "Overview" | "Contract pipeline" | "Ops & insight" | "Admin" | "System apps";
export type Capability = "read:contracts" | "write:inbox-proposal";
export type Role = "hr_preparer" | "hr_reviewer" | "wc_liaison" | "legal" | "admin";
export type SettingsTier = "workspace" | "project" | "user";

/** Contract §8: an audit event names FIELDS, never PII values. \`fields\`
 * is a list of names for that reason. */
export interface AuditEvent {
  readonly event: string;
  readonly actor?: string;
  readonly fields?: readonly string[];
  readonly reason?: string;
}

export interface SubAppCapabilities {
  /** Contract §5.5: the only way to append an audit event. Never
   * construct the hash. */
  auditAppend(event: AuditEvent): void;
  /** Present only when "read:contracts" was declared AND granted. */
  readContracts?(): Promise<readonly unknown[]>;
  /** Present only when "write:inbox-proposal" was declared AND granted. */
  proposeInboxItem?(proposal: unknown): Promise<{ readonly path: string }>;
}

export interface RegisterRoutesCtx {
  capabilitiesFor(subAppId: string): SubAppCapabilities;
}

export interface SubAppManifest {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  readonly minHostVersion: string;
  readonly icon: string;
  readonly navSection: NavSection;
  readonly routePrefix: string;
  readonly webModuleId: string;
  readonly capabilities: readonly Capability[];
  readonly visibleToRoles: readonly Role[];
  readonly settingsPanel?: SettingsTier;
  readonly widgets?: readonly unknown[];
  initSchema(db: Db): void | Promise<void>;
  registerRoutes(app: FastifyInstance, ctx: RegisterRoutesCtx): void | Promise<void>;
}

export type SubAppRequest = FastifyRequest;
`;

const DB_DTS = `/** Whatever the host hands \`initSchema\`. Rows are \`unknown\` on
 * purpose — see the header of host-surface.ts. */
export interface Db {
  exec(sql: string): Promise<void> | void;
  run(sql: string, params?: readonly unknown[]): Promise<unknown> | unknown;
  all(sql: string, params?: readonly unknown[]): Promise<readonly any[]>;
  get(sql: string, params?: readonly unknown[]): Promise<any>;
}
`;

const WORKSPACE_DTS = `import type { Db } from "../db.js";

export interface WorkspaceRuntime {
  readonly root: string;
  readonly db: Db;
}
`;

const PROJECT_DTS = `export const DEFAULT_PROJECT_ID: string;
export interface ProjectRef {
  readonly id: string;
}
`;

const KILL_SWITCH_DTS = `/** Contract §4, layer one. Reads the environment ON EVERY CALL — the
 * whole reason a sub-app must never capture it at module level. */
export function subAppKillSwitchEnabled(subAppId: string): boolean;
`;

const INSTALL_ROW_DTS = `import type { Db } from "../db.js";

export interface EffectiveInstallState {
  readonly enabled: boolean;
  /** Contract §4: from the ceiling row only. A project row can narrow,
   * never widen. */
  readonly grantedScopes: readonly string[];
}

export function effectiveSubAppEnabled(
  db: Db,
  projectId: string,
  subAppId: string,
): Promise<EffectiveInstallState | null>;
`;

const CAPABILITIES_DTS = `import type { SubAppCapabilities } from "./types.js";

export function capabilitiesFor(subAppId: string, grantedScopes: readonly string[]): SubAppCapabilities;
`;

const AUDIT_DTS = `import type { AuditEvent } from "../subapps/types.js";

/** Contract §5.5. The ONLY sanctioned way to write an audit event. */
export function appendFlightdeckAudit(workspaceRoot: string, event: AuditEvent): void;
`;

const WEB_REGISTRY_DTS = `/** What \`web/src/subapps/<id>/index.tsx\` must default-export. The web
 * loader globs that exact path and lazy-mounts \`.Page\`. */
export interface SubAppModule {
  readonly Page: (...args: never[]) => unknown;
}
`;

/** The host augments Fastify's request. Without this, every
 * `req.workspace` in generated code is a type error against the real
 * `fastify` types — a false positive about the host, not the candidate. */
const FASTIFY_AUGMENTATION = `import type { WorkspaceRuntime } from "./workspace/types.js";

declare module "fastify" {
  interface FastifyRequest {
    workspace?: WorkspaceRuntime;
    project?: { readonly id: string };
    principal?: { readonly username: string; readonly roles: readonly string[] };
  }
}
export {};
`;

// ── The same seam, executable. ──────────────────────────────────────────
// Each stub is a thin delegate to the probe recorder so that the harness,
// not this file, decides what "enabled" means for a given scenario.

const RT_KILL_SWITCH = `export function subAppKillSwitchEnabled(subAppId) {
  return globalThis.__fdProbe.killSwitch(subAppId);
}
`;

const RT_INSTALL_ROW = `export async function effectiveSubAppEnabled(db, projectId, subAppId) {
  return globalThis.__fdProbe.installRow(projectId, subAppId);
}
`;

const RT_AUDIT = `export function appendFlightdeckAudit(workspaceRoot, event) {
  globalThis.__fdProbe.audit(workspaceRoot, event);
}
`;

const RT_PROJECT = `export const DEFAULT_PROJECT_ID = "default";
`;

const RT_CAPABILITIES = `export function capabilitiesFor(subAppId, grantedScopes) {
  return globalThis.__fdProbe.capabilities(subAppId, grantedScopes ?? []);
}
`;

/** Type-only modules still need a file on disk: a generated file may
 * import a value from them tomorrow, and a missing module would then be
 * reported as a candidate defect rather than a gap in this surface. */
const RT_EMPTY = `export {};
`;

export const FLIGHTDECK_HOST_SURFACE: HostSurface = {
  types: {
    "server/subapps/types": TYPES_DTS,
    "server/subapps/killSwitch": KILL_SWITCH_DTS,
    "server/subapps/installRow": INSTALL_ROW_DTS,
    "server/subapps/capabilities": CAPABILITIES_DTS,
    "server/db": DB_DTS,
    "server/lib/flightdeckAudit": AUDIT_DTS,
    "server/project/types": PROJECT_DTS,
    "server/workspace/types": WORKSPACE_DTS,
    "web/src/subapps/registry": WEB_REGISTRY_DTS,
  },
  runtime: {
    "server/subapps/types": RT_EMPTY,
    "server/subapps/killSwitch": RT_KILL_SWITCH,
    "server/subapps/installRow": RT_INSTALL_ROW,
    "server/subapps/capabilities": RT_CAPABILITIES,
    "server/db": RT_EMPTY,
    "server/lib/flightdeckAudit": RT_AUDIT,
    "server/project/types": RT_PROJECT,
    "server/workspace/types": RT_EMPTY,
    "web/src/subapps/registry": RT_EMPTY,
  },
  ambient: { "server/_fd_host_augmentation": FASTIFY_AUGMENTATION },
};
