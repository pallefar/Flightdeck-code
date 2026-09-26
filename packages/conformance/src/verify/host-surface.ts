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

/** Exactly the shape \`manifest-schema.ts\` in this package validates —
 * two independent derivations of the same contract clause, which is the
 * house rule. */
export interface SettingsPanel {
  readonly tier: "workspace-admin" | "super-admin";
  readonly webComponentId: string;
  readonly label: string;
}

/** Contract §8: an audit event names FIELDS, never PII values — a rule
 * about what goes in the strings, which a type cannot express. The key
 * set is open because the contract does not close it, and inventing a
 * closed one would reject correct code. */
export interface AuditEvent {
  readonly event: string;
  readonly actor?: string;
  readonly fields?: readonly string[];
  readonly reason?: string;
  readonly [key: string]: unknown;
}

/** ⚠ OPEN ON PURPOSE. The contract names \`ctx.capabilitiesFor(id)\` as the
 * only door and \`auditAppend\` as the only way to write an audit event
 * (§5.3, §5.5); it does not enumerate the rest of the adapter. So those
 * two are pinned and everything else is \`any\` — the gate does not invent
 * a member list for a host it cannot see, and FD-C004 still enforces the
 * audit rule on the source. The methods are NOT optional: consent is
 * all-or-nothing and scopes come from the ceiling row at call time
 * (§4), so an ungranted capability refuses at runtime rather than being
 * absent at compile time. */
export interface SubAppCapabilities {
  auditAppend(event: AuditEvent): void;
  readContracts(...args: readonly any[]): Promise<readonly any[]>;
  proposeInboxItem(proposal: any): Promise<{ readonly path: string }>;
  [member: string]: any;
}

export interface RegisterRoutesCtx {
  capabilitiesFor(subAppId: string): SubAppCapabilities;
}

export interface SubAppManifest {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  readonly minHostVersion: string;
  /** sdk-60: optional exclusive upper host bound. */
  readonly maxHostVersion?: string;
  readonly icon: string;
  readonly navSection: NavSection;
  readonly routePrefix: string;
  readonly webModuleId: string;
  readonly capabilities: readonly Capability[];
  readonly visibleToRoles: readonly Role[];
  readonly settingsPanel?: SettingsPanel;
  readonly widgets?: readonly unknown[];
  /** D-036: the marker Studio's codegen stamps on every generated manifest. */
  readonly generatedBy?: "flightdeck-studio";
  /** apps-01: the app-directory facts block (facts only, never copy). */
  readonly listing?: {
    readonly availability: "available" | "coming-soon";
    /** Required: the host types this as z.infer (the OUTPUT), where \`.default(false)\` makes it required. */
    readonly discoverable: boolean;
    readonly category: "documents" | "signing" | "analytics" | "knowledge" | "location" | "developer";
    readonly requirements?: readonly string[];
    readonly publisher: { readonly name: string };
  };
  /** sdk-21: declared outbound operations (shape only; grants nothing). */
  readonly integrations?: readonly unknown[];
  /** sdk-44: Builder palette steps (shape only; runs nothing). */
  readonly workflowSteps?: readonly unknown[];
  /** sdk-63: declared Postgres migrations, the host's subAppMigrationSchema. */
  readonly migrations?: readonly {
    readonly node_id: string;
    readonly file: string;
    readonly class: "immutable" | "generated";
    readonly phase?: "expand" | "backfill" | "validate" | "contract" | "unknown";
    readonly after?: readonly string[];
  }[];
  /** sdk-42: Builder starting processes (shape only; scaffolds nothing). */
  readonly workflowTemplates?: readonly { readonly key: string; readonly labelKey: string; readonly file: string }[];
  /** upd-app-schema-range: the inclusive app schema range this version needs. */
  readonly appSchema?: { readonly min: number; readonly max: number };
  initSchema(db: Db): void | Promise<void>;
  registerRoutes(app: FastifyInstance, ctx: RegisterRoutesCtx): void | Promise<void>;
  /** The host declares this (OS-04 host-surface contributions) and acts on
   * it at boot. A GENERATED mini-app may not: the gate refuses it (FD-M008),
   * and \`never\` makes the compiler refuse it too, so the two stages agree. */
  readonly contributions?: never;
  /** The host's optional onboarding probe (x-subapp-first-object-probe). Refused
   * by the gate (FD-M008) for a generated mini-app, and \`never\` here. */
  readonly firstObject?: never;
}

/** The host's Zod schema, which \`loadValidatedManifests\` applies
 * fail-loud at boot. A generated sub-app's own host test imports it to
 * re-assert the same thing from inside the host repo. */
export const subAppManifestSchema: {
  parse(value: unknown): SubAppManifest;
  safeParse(value: unknown): { readonly success: boolean; readonly data?: SubAppManifest; readonly error?: any };
};

export type SubAppRequest = FastifyRequest;
`;

/** ⚠ DECLARED FOR COMPILATION ONLY. A sub-app's MOUNTED code may not
 * import this — FD-I002 and FD-C003 refuse it, and those run before the
 * compiler does. A sub-app's own host test in \`tests/subapps/<id>/\` is
 * not mounted and legitimately reads the registry, the same way every
 * hand-written host test does. There is deliberately no RUNTIME stub for
 * it: if mounted code ever reached this module the probe would fail to
 * resolve it, which is the answer it deserves. */
const REGISTRY_DTS = `import type { SubAppManifest } from "./types.js";

export const SUBAPP_MANIFESTS: SubAppManifest[];
export const HOST_VERSION: string;
export function isVersionNewer(version: string, baseline: string): boolean;
`;

const DB_DTS = `/** Whatever the host hands \`initSchema\`. Rows are \`any\` on purpose —
 * see the header of host-surface.ts — but the METHOD list is closed,
 * because \`initSchema(db)\` is a seam the contract does pin and a typo
 * there is worth catching. */
export interface PreparedStatement {
  run(...params: readonly any[]): any;
  all(...params: readonly any[]): readonly any[];
  get(...params: readonly any[]): any;
  finalize(): void;
}

export interface Db {
  exec(sql: string): Promise<void> | void;
  run(sql: string, params?: readonly any[]): Promise<any> | any;
  all(sql: string, params?: readonly any[]): Promise<readonly any[]>;
  get(sql: string, params?: readonly any[]): Promise<any>;
  prepare(sql: string): PreparedStatement;
}
`;

const WORKSPACE_DTS = `import type { Db } from "../db.js";

export interface WorkspaceRuntime {
  readonly id: string;
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

/** Contract §4: granted scopes come from the ceiling row and are re-read
 * per call, so a capability the workspace did not grant has to refuse at
 * CALL time. That refusal needs a type. */
export class CapabilityDeniedError extends Error {
  constructor(message?: string);
  /** ⚠ OPEN. The gate knows this refusal EXISTS, because the contract
   * requires one; it knows nothing about what it carries, and an invented
   * member list would reject correct code for using a field the real one
   * has. */
  readonly [detail: string]: any;
}

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
    principal?: { readonly username: string; readonly roles: readonly string[]; readonly [key: string]: unknown };
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

const RT_CAPABILITIES = `export class CapabilityDeniedError extends Error {
  constructor(message) { super(message); this.name = "CapabilityDeniedError"; }
}

export function capabilitiesFor(subAppId, grantedScopes) {
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
    "server/subapps/registry": REGISTRY_DTS,
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
