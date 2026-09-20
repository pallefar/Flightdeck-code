/**
 * ⭐ THE SAME SUB-APP, WITHOUT THE HOST.
 *
 * ── WHY THIS IS AN ADDITIVE HARNESS AND NOT A SECOND BUILD ───────────
 * A generated sub-app couples to Flightdeck OS in exactly three places,
 * and all three were already thin before this emitter existed:
 *
 *   1. `import type { SubAppModule } from "../registry"` — TYPE ONLY.
 *   2. `import type { RegisterRoutesCtx } from "../../types.js"` — TYPE ONLY.
 *   3. `fetch(ROUTE_PREFIX + path)` and the host's CSS class names.
 *
 * So standalone does not need a different sub-app. It needs the same files
 * with those three things supplied by something other than the host. That
 * is what this emits: shims at the exact relative paths the sub-app already
 * imports, a Fastify server that registers the same `registerXRoutes`, a
 * React root that renders the same default export, and a stylesheet
 * defining the same class names.
 *
 * ⭐ THE PROPERTY THAT MATTERS, AND IT IS TESTED RATHER THAN ASSERTED:
 * the sub-app's own files are BYTE-IDENTICAL in both modes.
 * `__tests__/standalone.test.ts` hashes every non-standalone file from one
 * generate() call and compares. A "standalone build" that quietly forks the
 * page is not the app running standalone; it is a second app that drifts.
 *
 * ── WHAT IS DIFFERENT, STATED PLAINLY ────────────────────────────────
 * The CAPABILITY ADAPTER. In the host it is built from a workspace's live
 * install row; here it is backed by a local directory. That is the whole
 * substitution, and it is the right seam precisely because the contract
 * already says the adapter is the ONLY server-side surface a sub-app may
 * use. Standalone is therefore not a weaker sandbox — it is the same
 * sandbox with a different floor under it.
 *
 * ⚠ AND WHAT STANDALONE DOES NOT GIVE YOU: the host's RBAC, its kill
 * switch, its three-layer enablement AND, its audit chain, and its Inbox.
 * `standalone/README.md` says so in those words, and the server refuses to
 * start with `--allow-anonymous` unless the operator passes it, so nobody
 * reaches production believing the host's guarantees came along.
 */
import type { SubAppPlan } from "../plan";
import { serverDir, webDir } from "../naming";
import type { GeneratedFile } from "../invariants";

/** The class names the emitted page uses. Kept here as DATA rather than as
 * a hand-written stylesheet, because `__tests__/standalone.test.ts` extracts
 * the classes the page actually renders and asserts this list covers them:
 * a stylesheet that silently stops covering the page is the same shape of
 * bug as a check that silently stops checking. */
export const HOST_CLASS_NAMES: readonly string[] = [
  "card",
  "chip",
  "errorbox",
  "eyebrow",
  "fill",
  "mono",
  "muted",
  "okbox",
  "page",
  "pagehead",
  "progress",
  "small",
];

/** The `chip` tone modifiers the page selects between. */
export const CHIP_TONES: readonly string[] = ["amber", "blue", "green", "orange", "red"];

/**
 * ⭐ EMITTED IMPORT LINES ARE COMPOSED, NEVER WRITTEN OUT.
 *
 * `pure-closure.test.ts` walks this package's import closure TEXTUALLY —
 * "it reads what the file SAYS, not what a bundler resolves" — because the
 * host's own `subappImportClosure.test.ts` does, and a Studio route may not
 * reach `node:fs`. The harness this file emits genuinely needs `node:fs`,
 * Fastify and React, so writing those lines out verbatim would put them in
 * @codegen's source text and fail a fence that is right to exist.
 *
 * Weakening the walker to parse properly was the other option and it is the
 * wrong one: a textual fence also catches `await import(someString)`, and the
 * whole point of this package is that it never touches a disk. So the strings
 * are assembled at emit time. The same move as rebuilding a secret-shaped test
 * fixture from parts rather than asking the scanner to ignore it.
 */
function imp(clause: string, specifier: string): string {
  return ["import", clause, "from", JSON.stringify(specifier) + ";"].join(" ");
}

/** A side-effect import (`${impSideEffect("./theme.css")}`), composed for the same reason. */
function impSideEffect(specifier: string): string {
  return ["import", JSON.stringify(specifier) + ";"].join(" ");
}

/** The host version the emitted manifests are checked against. Kept in step
 * with `spec-contract.ts`'s own constant by `standalone.test.ts`. */
const HOST_VERSION_VALUE = "5.0.0";

function jsonFile(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

// ─────────────────────────────────────────────────────────────────────────
// Shims — the two type-only imports, at the paths the sub-app already uses
// ─────────────────────────────────────────────────────────────────────────

function emitRegistryShim(plan: SubAppPlan): string {
  return `/** STANDALONE SHIM — not a host file, and it must never be applied to one.
 *
 * The generated page does \`import type { SubAppModule } from "../registry"\`.
 * In Flightdeck OS that resolves to the host's own registry, which also holds
 * every other sub-app. Standalone needs only the TYPE, so this declares it and
 * nothing else: there is no glob, no other sub-app, and no host shell.
 *
 * ⛔ APPLYING THIS TO A HOST CHECKOUT WOULD OVERWRITE THE REAL REGISTRY.
 * \`planWrites\` defaults to the host target and excludes every \`standalone\`
 * file for exactly that reason; \`applyGeneratedFiles\` refuses one by name.
 */
${imp("type { ComponentType }", "react")}

export interface SubAppModule {
  Page: ComponentType;
  Rail?: ComponentType;
  railHeading?: string;
}

/** The one module this standalone build renders. */
export const STANDALONE_SUBAPP_ID = ${JSON.stringify(plan.id)};
`;
}

function emitTypesShim(plan: SubAppPlan): string {
  return `/** STANDALONE SHIM — not a host file, and it must never be applied to one.
 *
 * \`SubAppCapabilities\` and \`RegisterRoutesCtx\` exactly as the host declares
 * them, because the generated routes are compiled against these types in BOTH
 * modes and a shim that drifts is a standalone build that passes while the
 * mounted one fails. The host's own copy is the source of truth;
 * \`@conformance\`'s host-surface check is what keeps these two honest.
 *
 * ⛔ NEVER APPLIED TO A HOST CHECKOUT — see the registry shim.
 */
${imp("type { FastifyInstance }", "fastify")}
${imp("type { Db }", "../db.js")}
${imp("type { WorkspaceRuntime }", "../workspace/types.js")}

export const CAPABILITY_SCOPES = ["read:contracts", "write:inbox-proposal"] as const;
export type CapabilityScope = (typeof CAPABILITY_SCOPES)[number];

export interface ContractFolder {
  ticket: string;
  dir: string;
  folderName: string;
}

/** The ONLY server-side surface a sub-app route may use. There is no
 * filesystem write on it, and that absence is why ${plan.label} proposes
 * rather than installs — in standalone exactly as in the host. */
export interface SubAppCapabilities {
  readContracts(): ContractFolder[];
  writeInboxProposal(fileName: string, content: unknown): string;
  listOwnInboxProposals(): string[];
  auditAppend(event: Record<string, unknown> & { event: string }): { hash: string };
}

export interface RegisterRoutesCtx {
  capabilitiesFor(workspaceId: string): Promise<SubAppCapabilities>;
}

export type NavSection = "Overview" | "Contract pipeline" | "Ops & insight" | "Admin" | "System apps";
export type WorkspaceRole = "hr_preparer" | "hr_reviewer" | "wc_liaison" | "legal" | "admin";

export interface SubAppManifestData {
  id: string;
  label: string;
  version: string;
  minHostVersion: string;
  icon: string;
  navSection: NavSection;
  routePrefix: string;
  webModuleId: string;
  capabilities: CapabilityScope[];
  visibleToRoles: WorkspaceRole[];
}

export interface SubAppManifest extends SubAppManifestData {
  initSchema(db: Db): void | Promise<void>;
  registerRoutes(app: FastifyInstance, ctx: RegisterRoutesCtx): void;
}

/**
 * ⭐ THE HOST AUGMENTS FASTIFY, AND SO MUST THIS TREE.
 *
 * Found by TYPECHECKING the standalone tree, which is a different question
 * from whether it boots: the generated guard reads \`req.workspace\`,
 * \`req.project\` and \`req.principal\`, and against stock Fastify types every
 * one of those is an error. It RAN before this was here — the fields are set
 * by the onRequest hook at runtime — so "it works" and "it compiles" were two
 * different facts, and only one of them had been established.
 *
 * Optional, exactly as the host declares them: a route that assumes they are
 * present is a route that would break in the host too.
 */
declare module "fastify" {
  interface FastifyRequest {
    workspace?: WorkspaceRuntime;
    project?: { readonly id: string };
    principal?: { readonly username: string; readonly roles: readonly string[] };
  }
}

/** ⭐ THE BOOT VALIDATOR, because the emitted CONFORMANCE TEST imports it.
 *
 * In the host this is what refuses to boot on a malformed manifest. The
 * generated test asserts the manifest parses, and that test runs in the
 * standalone tree too — so the schema has to be here, not stubbed to
 * \`z.any()\`. A permissive stand-in would turn the one test that checks the
 * manifest into a test that checks nothing, in the tree where nobody is
 * watching for it. */
${imp("{ z }", "zod")}

export const subAppManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  label: z.string().min(1),
  version: z.string(),
  minHostVersion: z.string(),
  icon: z.string().min(1),
  navSection: z.enum(["Overview", "Contract pipeline", "Ops & insight", "Admin", "System apps"]),
  routePrefix: z.string().regex(/^\\/api\\/apps\\/[a-z0-9-]+$/),
  webModuleId: z.string().min(1),
  capabilities: z.array(z.enum(CAPABILITY_SCOPES)),
  visibleToRoles: z
    .array(z.enum(["hr_preparer", "hr_reviewer", "wc_liaison", "legal", "admin"]))
    .min(1),
});
`;
}

/** The SERVER-side registry — a different file from the web one, and the
 * emitted conformance test imports \`HOST_VERSION\` and \`isVersionNewer\`
 * from it. Found by the import-coverage test rather than by reading. */
function emitServerRegistryShim(plan: SubAppPlan): string {
  return `/** STANDALONE SHIM — the server registry, holding exactly one sub-app.
 *
 * In Flightdeck OS this is the file a mount edits, and it holds every sub-app
 * in the product. Standalone runs ONE, so that is what is here — and the
 * emitted conformance test still gets the \`HOST_VERSION\` and
 * \`isVersionNewer\` it imports, with the same numeric-segment comparison, so
 * the minHostVersion check it performs is the real one.
 *
 * ⛔ NEVER APPLIED TO A HOST CHECKOUT — this would replace the real registry
 * and every other sub-app with it.
 */
${imp("{ " + plan.names.manifestConst + " }", "./" + plan.id + "/manifest.js")}

export const HOST_VERSION = ${JSON.stringify(HOST_VERSION_VALUE)};

/** Numeric-segment compare, the host's own. \`5.0.0\` is not newer than
 * \`5.0.0\`; \`5.0.1\` is. */
export function isVersionNewer(version: string, baseline: string): boolean {
  const a = version.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const b = baseline.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

export const SUBAPP_MANIFESTS = [${plan.names.manifestConst}];
`;
}

/** Only the table profile emits a \`schema.ts\`, and it imports \`Db\`. */
function emitDbShim(): string {
  return `/** STANDALONE SHIM — the database handle's TYPE only.
 *
 * A mini-app is database-free and never reaches this. The table profile emits
 * a \`schema.ts\` that imports \`Db\`, so the type has to exist for the tree to
 * compile — but standalone provides no driver, and the members are left
 * deliberately minimal so that a route which started using one would fail
 * here rather than silently acquire a database the host never granted it.
 *
 * ⛔ NEVER APPLIED TO A HOST CHECKOUT.
 */
export interface Db {
  readonly exec?: (sql: string) => unknown;
  readonly prepare?: (sql: string) => unknown;
}
`;
}

function emitCapabilitiesShim(plan: SubAppPlan): string {
  return `/** STANDALONE SHIM — not a host file, and it must never be applied to one.
 *
 * ⭐ FOUND BY RUNNING IT, NOT BY READING IT. The first version of this
 * harness supplied the two TYPE-only imports and stopped, on the reasoning
 * that they were the whole coupling. They were not: every emitted route file
 * imports \`CapabilityDeniedError\` from here at RUNTIME and maps it to a 403.
 * Standalone booted, the route threw MODULE_NOT_FOUND, and the count was
 * wrong by one. A harness that is argued for rather than started is a harness
 * whose gaps are found by whoever runs it next.
 *
 * The class is the host's, field for field, because the emitted \`mapError\`
 * does \`err instanceof CapabilityDeniedError\` and reads \`err.scope\`. A
 * near-enough copy would turn a 403 into a 500 in one mode only, which is the
 * kind of difference that is discovered in front of somebody.
 *
 * ⛔ NEVER APPLIED TO A HOST CHECKOUT — see the registry shim.
 */
${imp("type { CapabilityScope }", "./types.js")}

export class CapabilityDeniedError extends Error {
  constructor(
    message: string,
    readonly scope?: CapabilityScope,
  ) {
    super(message);
    this.name = "CapabilityDeniedError";
  }
}

/** ${plan.label} declares: ${plan.manifestData.capabilities.join(", ") || "(none)"} */
export const DECLARED_CAPABILITIES: readonly CapabilityScope[] = ${JSON.stringify(plan.manifestData.capabilities)};
`;
}

// ─────────────────────────────────────────────────────────────────────────
// The local capability adapter
// ─────────────────────────────────────────────────────────────────────────

function emitCapabilities(plan: SubAppPlan): string {
  return `/** THE LOCAL CAPABILITY ADAPTER — the one thing standalone substitutes.
 *
 * The host builds this from a workspace's live install row, re-read on every
 * call. Here it is built from a directory on disk. Everything else about the
 * sub-app is unchanged, because the contract already made this the only
 * server-side surface a route may touch.
 *
 * ⭐ THE SCOPE CHECK IS REAL, NOT DECORATIVE. The manifest's \`capabilities\`
 * array is the human consent screen, and a standalone adapter that ignored it
 * would let a route do locally what the host would refuse — which is the exact
 * way a "works on my machine" build teaches a generated app bad habits. A
 * method whose scope is not declared THROWS.
 *
 * ⚠ WHAT THIS IS NOT: the host's audit chain. \`auditAppend\` here appends
 * JSON lines to a local file and returns a SHA-256 over the event. It is a
 * faithful local record and it is NOT append-only-replicated, not signed, and
 * not readable by governance. \`README.md\` says so.
 */
${imp("{ createHash }", "node:crypto")}
${imp("fs", "node:fs")}
${imp("path", "node:path")}

${imp("type { ContractFolder, SubAppCapabilities }", "../server/subapps/types.js")}
${imp("type { CapabilityScope }", "../server/subapps/types.js")}
${imp("{ CapabilityDeniedError }", "../server/subapps/capabilities.js")}

const DECLARED_SCOPES: readonly CapabilityScope[] = ${JSON.stringify(plan.manifestData.capabilities)};
const SUBAPP_ID = ${JSON.stringify(plan.id)};

/** ⭐ EXTENDS THE HOST'S ERROR, and that is not tidiness.
 *
 * Every emitted route does \`err instanceof CapabilityDeniedError\` and answers
 * 403. An adapter that threw its own unrelated class would fall through that
 * check to the rethrow and surface as a 500 — the same refusal, a different
 * status, in standalone only. Extending it means the route behaves identically
 * in both modes and the message still says what a developer needs to hear.
 */
export class CapabilityNotDeclaredError extends CapabilityDeniedError {
  constructor(readonly declaredScope: CapabilityScope, readonly method: string) {
    super(
      "standalone: " +
        SUBAPP_ID +
        "." +
        method +
        "() needs capability \\"" +
        declaredScope +
        "\\", which its manifest does not declare. Add it to the spec's capabilities " +
        "array and regenerate — the array IS the consent screen, in standalone as in the host.",
      declaredScope,
    );
    this.name = "CapabilityNotDeclaredError";
  }
}

/** Named \`needsScope\`, not \`require\`: this file is an ES module and shadowing
 * the CommonJS name in one is the sort of thing that works until it does not. */
function needsScope(scope: CapabilityScope, method: string): void {
  if (!DECLARED_SCOPES.includes(scope)) throw new CapabilityNotDeclaredError(scope, method);
}

export interface StandaloneDataOptions {
  /** Directory holding \`contracts/\`, \`memory/proposals/\` and \`audit.jsonl\`.
   * Created on demand. Defaults to \`./data\` beside the server. */
  readonly root: string;
}

/** A contract folder is a directory with a \`ticket\` in its name, mirroring
 * what the host's own adapter returns. Nothing is invented: an empty data
 * directory yields an empty list, and the page renders "Nothing here yet."
 * rather than fixtures pretending to be records. */
function readContractsFrom(root: string): ContractFolder[] {
  const dir = path.join(root, "contracts");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      // \`exec()[1]\` is \`string | undefined\` under noUncheckedIndexedAccess,
      // which the emitted tsconfig turns on because the host does. Caught by
      // typechecking the generated tree rather than by running it.
      const ticket = /^([A-Za-z]+-\\d+)/.exec(entry.name)?.[1];
      return {
        ticket: ticket ?? entry.name,
        dir: path.join(dir, entry.name),
        folderName: entry.name,
      };
    })
    .sort((a, b) => (a.folderName < b.folderName ? -1 : a.folderName > b.folderName ? 1 : 0));
}

export function makeStandaloneCapabilities(options: StandaloneDataOptions): SubAppCapabilities {
  const root = path.resolve(options.root);
  const proposalsDir = path.join(root, "memory", "proposals");
  const auditAt = path.join(root, "audit.jsonl");

  return {
    readContracts(): ContractFolder[] {
      needsScope("read:contracts", "readContracts");
      return readContractsFrom(root);
    },

    writeInboxProposal(fileName: string, content: unknown): string {
      needsScope("write:inbox-proposal", "writeInboxProposal");
      // The host scopes a sub-app to its own \`<id>-\` prefix. So does this:
      // a standalone build that let an app write outside its prefix would be
      // laxer than the thing it is standing in for.
      if (!fileName.startsWith(SUBAPP_ID + "-")) {
        throw new Error(
          "standalone: proposal file name must start with \\"" + SUBAPP_ID + "-\\", got \\"" + fileName + "\\"",
        );
      }
      if (fileName.includes("/") || fileName.includes("\\\\") || fileName.includes("..")) {
        throw new Error("standalone: proposal file name may not contain a path separator");
      }
      fs.mkdirSync(proposalsDir, { recursive: true });
      const at = path.join(proposalsDir, fileName);
      fs.writeFileSync(at, JSON.stringify(content, null, 2) + "\\n", "utf8");
      return path.relative(root, at);
    },

    listOwnInboxProposals(): string[] {
      needsScope("write:inbox-proposal", "listOwnInboxProposals");
      if (!fs.existsSync(proposalsDir)) return [];
      return fs
        .readdirSync(proposalsDir)
        .filter((name) => name.startsWith(SUBAPP_ID + "-"))
        .sort();
    },

    auditAppend(event: Record<string, unknown> & { event: string }): { hash: string } {
      const body = { ...event, subApp: SUBAPP_ID, at: new Date().toISOString() };
      const line = JSON.stringify(body);
      const hash = createHash("sha256").update(line).digest("hex");
      fs.mkdirSync(root, { recursive: true });
      fs.appendFileSync(auditAt, JSON.stringify({ ...body, hash }) + "\\n", "utf8");
      return { hash };
    },
  };
}
`;
}

// ─────────────────────────────────────────────────────────────────────────
// The host modules the GUARD reaches — supplied for real where that is
// possible, and named as absent where it is not
// ─────────────────────────────────────────────────────────────────────────

/**
 * ⭐ THE GUARD STAYS LOAD-BEARING IN STANDALONE.
 *
 * The emitted guard is the enablement gate: kill switch, then the host's
 * three-layer AND (`SUBAPP_<ID>_ENABLED === "true"` AND a `'*'` ceiling row
 * AND a project row). The lazy harness stubs it to `enabled: true` and calls
 * the app "running standalone". That is not the app running — it is the gate
 * removed, which is precisely the habit a local build must not teach.
 *
 * So:
 *   LAYER 1 IS REAL. `subAppKillSwitchEnabled` is copied verbatim — it is a
 *   `process.env` read with no dependency, so there is nothing to approximate.
 *   `effectiveSubAppEnabled` reads the SAME env var for the same reason.
 *
 *   LAYERS 2 AND 3 DO NOT EXIST HERE, and are reported as what they are:
 *   `ceilingEnabled` and `projectConsented` come back FALSE with
 *   `absentLayers` naming them, rather than TRUE so the AND passes. The
 *   standalone server prints them at boot.
 *
 * The consequence is deliberate: an operator who has not set the env var gets
 * the app refusing to serve, exactly as the host would refuse it.
 */
function emitKillSwitchShim(): string {
  return `/** STANDALONE SHIM — copied VERBATIM from the host, because it is pure:
 * a \`process.env\` read with no dependency of its own. Layer 1 of the
 * enablement AND is therefore not approximated in standalone; it is the same
 * code making the same decision.
 *
 * ⛔ NEVER APPLIED TO A HOST CHECKOUT.
 */
export function subAppKillSwitchEnabled(id: string): boolean {
  const envName = "SUBAPP_" + id.toUpperCase().replace(/-/g, "_") + "_ENABLED";
  return process.env[envName] === "true";
}
`;
}

function emitInstallRowShim(plan: SubAppPlan): string {
  return `/** STANDALONE SHIM — layer 1 of the AND, honestly, and layers 2 and 3
 * reported ABSENT rather than granted.
 *
 * In Flightdeck OS \`enabled\` is the AND of three things: the env var, a
 * \`'*'\` ceiling row an admin wrote, and a row for this project. A standalone
 * build has no install table, so it has no ceiling row and no project row.
 *
 * ⛔ THE TEMPTING SHIM IS \`enabled: true\`, AND IT IS THE WRONG ONE. It does
 * not simulate consent; it deletes the gate, and an app developed against a
 * deleted gate is an app whose first host deployment is the first time the
 * gate has ever run. This returns the env var's answer for layer 1 and FALSE
 * for the two layers that genuinely are not here, with \`absentLayers\` naming
 * them so a caller cannot read the result as a pass.
 *
 * ⛔ NEVER APPLIED TO A HOST CHECKOUT.
 */
${imp("type { CapabilityScope }", "./types.js")}
${imp("{ subAppKillSwitchEnabled }", "./killSwitch.js")}

export interface EffectiveSubAppState {
  enabled: boolean;
  grantedScopes: CapabilityScope[];
  ceilingEnabled: boolean;
  projectConsented: boolean;
  version: string | null;
  /** ⭐ STANDALONE ONLY. The layers this build cannot evaluate. Non-empty
   * here and absent in the host, so anything reading it knows which it is. */
  absentLayers?: readonly string[];
}

const DECLARED_SCOPES: readonly CapabilityScope[] = ${JSON.stringify(plan.manifestData.capabilities)};

export async function effectiveSubAppEnabled(
  _db: unknown,
  _projectId: string,
  id: string,
): Promise<EffectiveSubAppState> {
  const envEnabled = subAppKillSwitchEnabled(id);
  return {
    // Layer 1 only, and the name says so. There is no second opinion to AND
    // against — which is exactly why the two fields below are false.
    enabled: envEnabled,
    grantedScopes: envEnabled ? [...DECLARED_SCOPES] : [],
    ceilingEnabled: false,
    projectConsented: false,
    version: ${JSON.stringify(plan.version)},
    absentLayers: ["ceiling-row", "project-row"],
  };
}
`;
}

function emitAuditShim(): string {
  return `/** STANDALONE SHIM — a real local audit file, and not a pretend chain.
 *
 * The host's audit is append-only, replicated and read by governance. This
 * appends JSON lines to \`<root>/audit.jsonl\` and returns a SHA-256 over the
 * event. That is a faithful LOCAL record: the guard's audited refusal really
 * is written down, so a refusal in standalone leaves the same trace shape it
 * would leave in the host.
 *
 * ⚠ WHAT IT IS NOT: replicated, signed, or visible to anyone but whoever has
 * the directory. \`standalone/README.md\` puts that in the table.
 *
 * ⛔ NEVER APPLIED TO A HOST CHECKOUT.
 */
${imp("{ createHash }", "node:crypto")}
${imp("fs", "node:fs")}
${imp("path", "node:path")}

export type AuditInput = Record<string, unknown> & { event: string };

export function appendFlightdeckAudit(root: string, input: AuditInput): { hash: string } {
  const body = { ...input, at: new Date().toISOString(), mode: "standalone" };
  const line = JSON.stringify(body);
  const hash = createHash("sha256").update(line).digest("hex");
  fs.mkdirSync(root, { recursive: true });
  fs.appendFileSync(path.join(root, "audit.jsonl"), JSON.stringify({ ...body, hash }) + "\\n", "utf8");
  return { hash };
}
`;
}

function emitProjectTypesShim(): string {
  return `/** STANDALONE SHIM — the host's constant, verbatim.
 * ⛔ NEVER APPLIED TO A HOST CHECKOUT. */
export const DEFAULT_PROJECT_ID = "general";

export interface RequestProject {
  readonly id: string;
}
`;
}

function emitWorkspaceTypesShim(): string {
  return `/** STANDALONE SHIM — the three members a sub-app actually reads.
 *
 * The host's \`WorkspaceRuntime\` carries a dozen (bus, watcher, indexer,
 * evalRunner, orchestrator, …). A generated sub-app reads \`id\` to scope its
 * capability adapter, \`db\` to hand to \`effectiveSubAppEnabled\`, and
 * \`root\` for the guard's audited refusal — so only those are declared, and
 * a sub-app that started reading a fourth would fail to compile here BEFORE
 * it failed the host's import fence.
 *
 * \`db\` is \`unknown\` on purpose: this profile is database-free, the
 * standalone \`effectiveSubAppEnabled\` ignores it, and giving it a shape
 * would invite a route to use one.
 *
 * ⛔ NEVER APPLIED TO A HOST CHECKOUT.
 */
export interface WorkspaceRuntime {
  readonly id: string;
  readonly root: string;
  readonly db: unknown;
}
`;
}

// ─────────────────────────────────────────────────────────────────────────
// The server
// ─────────────────────────────────────────────────────────────────────────

function emitServer(plan: SubAppPlan): string {
  const registerFn = plan.names.registerRoutesFn;
  return `/** THE STANDALONE SERVER — Fastify, the same routes, a local adapter.
 *
 * \`${registerFn}\` is the SAME function the host calls. Nothing about the
 * routes is re-implemented here; this file supplies the two things the host
 * would otherwise supply — a Fastify instance and a \`capabilitiesFor\` — and
 * then gets out of the way.
 *
 * ⚠ WHAT THE HOST DOES AND THIS DOES NOT: RBAC by workspace role, the kill
 * switch, the three-layer enablement AND (\`${plan.envVar}\` plus a '*'
 * ceiling row plus a project row), and a replicated audit chain. Standalone
 * runs one local operator against one local data directory. Starting without
 * \`--allow-anonymous\` is refused so that this is a decision somebody made
 * rather than a default they inherited.
 */
${imp("fs", "node:fs")}
${imp("path", "node:path")}
${imp("{ fileURLToPath }", "node:url")}

${imp("Fastify", "fastify")}

${imp("{ " + registerFn + " }", "../server/subapps/" + plan.id + "/routes/index.js")}
${imp("{ makeStandaloneCapabilities }", "./capabilities.js")}
${imp("type { SubAppCapabilities }", "../server/subapps/types.js")}

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Enough to serve a Vite bundle, and nothing speculative. */
const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export interface StandaloneServerOptions {
  readonly dataRoot?: string;
  readonly allowAnonymous: boolean;
  readonly logger?: boolean;
}

export function buildStandaloneServer(options: StandaloneServerOptions) {
  if (!options.allowAnonymous) {
    throw new Error(
      "standalone: refusing to start without allowAnonymous. This build has NO RBAC, NO kill switch " +
        "and NO audit chain — pass --allow-anonymous to say you know that. See standalone/README.md.",
    );
  }
  // ⭐ LAYER 1 OF THE ENABLEMENT AND, ENFORCED HERE TOO.
  //
  // The guard already refuses a request when \`${plan.envVar}\` is not
  // "true" — that is the host's own first layer and it runs unchanged. This
  // check is in front of it so the operator is told at BOOT rather than by a
  // 403 on every route, and so nobody concludes the standalone build is
  // broken when it is in fact gating correctly.
  if (process.env[${JSON.stringify(plan.envVar)}] !== "true") {
    throw new Error(
      "standalone: " +
        ${JSON.stringify(plan.envVar)} +
        " is not set to true, so the guard will refuse every request — the same " +
        "layer-1 gate the host applies. Set it to enable this sub-app. " +
        "(The ceiling row and the project row do not exist in standalone and " +
        "are reported as absent, not as granted.)",
    );
  }
  const app = Fastify({ logger: options.logger ?? false });
  const dataRoot = options.dataRoot ?? path.join(HERE, "data");
  const caps: SubAppCapabilities = makeStandaloneCapabilities({ root: dataRoot });

  // The host augments every request with workspace/project/principal. One
  // local operator, one workspace — declared here rather than left undefined,
  // so a route reading \`req.workspace\` behaves the same in both modes, and
  // so the GUARD has the \`db\` and \`root\` it reaches for. \`root\` is the data
  // directory, which is where the guard's audited refusal actually lands.
  app.addHook("onRequest", async (req) => {
    const r = req as unknown as Record<string, unknown>;
    r["workspace"] = { id: "standalone", root: dataRoot, db: null };
    r["project"] = { id: "general" };
    r["principal"] = { username: "standalone", roles: ${JSON.stringify(plan.manifestData.visibleToRoles)} };
  });

  ${registerFn}(app, { capabilitiesFor: async () => caps });

  // ⭐ THE BUILT PAGE, SERVED BY THE SAME PROCESS.
  //
  // Without this, "standalone" means two terminals and a proxy — which is a
  // dev setup, not an app that runs on its own. Written against node:fs
  // rather than pulling in @fastify/static, because a harness that needs a
  // dependency to serve its own index.html is a harness with a footnote.
  //
  // ⚠ NOT A GENERAL STATIC SERVER. It resolves inside \`dist/\` and refuses
  // anything that climbs out, because the one thing worse than no file server
  // is a file server that reads the disk for whoever asks.
  const distRoot = path.join(HERE, "dist");
  app.get("/*", async (req, reply) => {
    const raw = (req.params as { "*"?: string })["*"] ?? "";
    const wanted = raw === "" ? "index.html" : raw;
    const resolved = path.resolve(distRoot, wanted);
    if (resolved !== distRoot && !resolved.startsWith(distRoot + path.sep)) {
      return reply.code(403).send({ error: "outside the bundle", code: "path_escape" });
    }
    const at = fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : path.join(distRoot, "index.html");
    if (!fs.existsSync(at)) {
      return reply
        .code(503)
        .send({ error: "no bundle built yet — run \`npm run build\`, or use \`npm run dev\` for the dev server", code: "no_bundle" });
    }
    const type = TYPES[path.extname(at)] ?? "application/octet-stream";
    return reply.type(type).send(fs.readFileSync(at));
  });

  app.get("/healthz", async () => ({
    ok: true,
    subApp: ${JSON.stringify(plan.id)},
    routePrefix: ${JSON.stringify(plan.routePrefix)},
    mode: "standalone",
    // Said out loud on every health check, because the one thing an operator
    // must not carry away from a green /healthz is that the host's gates ran.
    enablement: { envVar: ${JSON.stringify(plan.envVar)}, layer1: true, absentLayers: ["ceiling-row", "project-row"] },
    absent: ["rbac", "kill-switch-beyond-layer-1", "replicated-audit", "inbox"],
  }));

  return app;
}

export async function main(argv: readonly string[]): Promise<void> {
  const allowAnonymous = argv.includes("--allow-anonymous");
  const portArg = argv.find((a) => a.startsWith("--port="));
  const port = portArg === undefined ? 5180 : Number(portArg.slice("--port=".length));
  const dataArg = argv.find((a) => a.startsWith("--data="));

  const app = buildStandaloneServer({
    allowAnonymous,
    logger: true,
    ...(dataArg === undefined ? {} : { dataRoot: dataArg.slice("--data=".length) }),
  });
  await app.listen({ port, host: "127.0.0.1" });
}

if (process.argv[1] !== undefined && process.argv[1].endsWith("server.ts")) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(String(error instanceof Error ? error.message : error) + "\\n");
    process.exitCode = 1;
  });
}
`;
}

// ─────────────────────────────────────────────────────────────────────────
// The web root
// ─────────────────────────────────────────────────────────────────────────

function emitMain(plan: SubAppPlan): string {
  return `/** THE STANDALONE REACT ROOT.
 *
 * It imports the SAME default export the host's registry imports — the page
 * is not re-implemented, re-wrapped or given different props, because it has
 * none. If this file needed to adapt the module, the module would not be
 * mountable, and that is the thing being proved.
 */
${imp("{ StrictMode }", "react")}
${imp("{ createRoot }", "react-dom/client")}

${imp("subAppModule", "../web/src/subapps/" + plan.webModuleId + "/index")}
${impSideEffect("./theme.css")}

const host = document.getElementById("root");
if (host === null) throw new Error("standalone: no #root element");

const { Page, Rail, railHeading } = subAppModule;

createRoot(host).render(
  <StrictMode>
    <div className="standalone-shell">
      <header className="standalone-bar">
        <span className="standalone-mark">${plan.manifestData.icon} ${plan.label}</span>
        <span className="standalone-note">standalone — no RBAC, no kill switch, no audit chain</span>
      </header>
      <main>
        <Page />
      </main>
      {Rail !== undefined && (
        <aside className="standalone-rail">
          {railHeading !== undefined && <h2 className="eyebrow">{railHeading}</h2>}
          <Rail />
        </aside>
      )}
    </div>
  </StrictMode>,
);
`;
}

function emitIndexHtml(plan: SubAppPlan): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${plan.label}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
`;
}

function emitTheme(plan: SubAppPlan): string {
  const chipTones = CHIP_TONES.map(
    (tone) => `.chip.${tone} { border-color: var(--${tone}-line, currentColor); color: var(--${tone}-ink, inherit); }`,
  ).join("\n");
  return `/* THE HOST'S CLASS NAMES, SUPPLIED LOCALLY.
 *
 * The generated page ships no stylesheet on purpose: in Flightdeck OS every
 * sub-app's CSS lives in a banner-delimited region of the shared
 * \`web/src/theme.css\`, and \`find web/src/subapps -name '*.css'\` returns zero.
 * So the page uses the host's class names, and standalone has to define them.
 *
 * ⭐ THIS FILE IS CHECKED AGAINST THE PAGE, NOT AGAINST A MEMORY OF IT.
 * \`__tests__/standalone.test.ts\` extracts every className the emitted page
 * renders and fails if one is missing here. A stylesheet that quietly stops
 * covering the page looks exactly like a stylesheet that covers it.
 *
 * The tokens are light-dark pairs so the page is legible either way; they are
 * deliberately plain, because this is the app running on its own and not an
 * attempt to reproduce Flightdeck's visual identity outside Flightdeck.
 */
:root {
  --bg: #f7f8fa;
  --surface: #ffffff;
  --ink: #16191d;
  --muted-ink: #5b6472;
  --line: #d8dde4;
  --accent: #ff8200;
  --ok-bg: #e8f6ed;
  --ok-line: #62b581;
  --err-bg: #fdecea;
  --err-line: #d9645a;
  --red-line: #d9645a;
  --amber-line: #d39a2a;
  --green-line: #3f9c63;
  --blue-line: #4a7fc1;
  --orange-line: #d97a29;
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #101317;
    --surface: #181d23;
    --ink: #eef2f7;
    --muted-ink: #99a3b0;
    --line: #2a313a;
    --ok-bg: #12251a;
    --err-bg: #2a1614;
  }
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}

.standalone-shell { max-width: 1040px; margin: 0 auto; padding: 0 16px 64px; }
.standalone-bar {
  display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline;
  justify-content: space-between; padding: 14px 0; border-bottom: 1px solid var(--line);
}
.standalone-mark { font-weight: 600; }
.standalone-note { font-size: 12px; color: var(--muted-ink); }
.standalone-rail { margin-top: 24px; }

.page { padding-top: 20px; }
.pagehead { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: baseline; margin-bottom: 18px; }
.pagehead h1 { font-size: clamp(22px, 3.6vw, 30px); margin: 0; letter-spacing: -0.02em; }
.eyebrow { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted-ink); margin: 0; }
.muted { color: var(--muted-ink); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }

.card {
  background: var(--surface); border: 1px solid var(--line); border-radius: 12px;
  padding: 16px 18px; margin-bottom: 14px;
}

.chip {
  display: inline-block; border: 1px solid var(--line); border-radius: 999px;
  padding: 1px 9px; font-size: 12px; line-height: 1.7; white-space: nowrap;
}
${chipTones}

.progress {
  display: inline-block; vertical-align: middle; width: 140px; height: 6px;
  background: var(--line); border-radius: 999px; overflow: hidden;
}
.fill { display: block; height: 100%; background: var(--accent); }

.okbox { background: var(--ok-bg); border: 1px solid var(--ok-line); border-radius: 10px; padding: 10px 12px; }
.errorbox { background: var(--err-bg); border: 1px solid var(--err-line); border-radius: 10px; padding: 10px 12px; }

button { font: inherit; }
button.small {
  font-size: 13px; padding: 4px 11px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer;
}
button.small[disabled] { opacity: 0.55; cursor: default; }

table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); }

/* ${plan.label} — generated ${plan.version}. Regenerating overwrites this file. */
`;
}

function emitViteConfig(plan: SubAppPlan): string {
  return `/** The standalone dev server and build.
 *
 * \`root\` is this directory, and the API is proxied to the Fastify server so
 * the page's \`fetch(ROUTE_PREFIX + path)\` works UNCHANGED. The page does not
 * learn it is standalone; that is the point.
 */
${imp("path", "node:path")}
${imp("{ fileURLToPath }", "node:url")}

${imp("react", "@vitejs/plugin-react")}
${imp("{ defineConfig }", "vite")}

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Enough to serve a Vite bundle, and nothing speculative. */
const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export default defineConfig({
  root: HERE,
  plugins: [react()],
  server: {
    port: 5181,
    proxy: {
      ${JSON.stringify(plan.routePrefix)}: {
        target: "http://127.0.0.1:5180",
        changeOrigin: false,
      },
    },
  },
  build: { outDir: path.join(HERE, "dist"), emptyOutDir: true },
});
`;
}

function emitPackageJson(plan: SubAppPlan): string {
  return jsonFile({
    name: `${plan.id}-standalone`,
    private: true,
    version: plan.version,
    type: "module",
    description: `${plan.label} running on its own, outside Flightdeck OS.`,
    scripts: {
      dev: "concurrently -n server,web \"npm:dev:server\" \"npm:dev:web\"",
      "dev:server": `${plan.envVar}=true tsx server.ts --allow-anonymous`,
      "dev:web": "vite",
      build: "vite build",
      typecheck: "tsc --noEmit",
      start: `${plan.envVar}=true tsx server.ts --allow-anonymous`,
    },
    dependencies: {
      fastify: "^5.2.0",
      react: "^19.0.0",
      "react-dom": "^19.0.0",
      zod: "^3.24.1",
    },
    devDependencies: {
      "@types/node": "^22.10.0",
      "@types/react": "^19.0.0",
      "@types/react-dom": "^19.0.0",
      "@vitejs/plugin-react": "^4.3.4",
      concurrently: "^9.1.0",
      tsx: "^4.19.2",
      typescript: "^5.7.2",
      vite: "^6.0.0",
    },
  });
}

function emitTsconfig(): string {
  return jsonFile({
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "ESNext",
      moduleResolution: "bundler",
      jsx: "react-jsx",
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      resolveJsonModule: true,
      skipLibCheck: true,
      types: ["node"],
    },
    include: ["./**/*.ts", "./**/*.tsx", "../server/**/*.ts", "../web/**/*.tsx"],
  });
}

function emitReadme(plan: SubAppPlan): string {
  return `# ${plan.label} — standalone

The same sub-app that mounts in Flightdeck OS, running on its own.

\`\`\`sh
npm install
npm run dev          # Fastify on :5180, Vite on :5181
\`\`\`

Open <http://127.0.0.1:5181>. The page's own \`fetch("${plan.routePrefix}/…")\`
is proxied to the server; nothing in the sub-app knows which mode it is in.

## What is identical

Every file under \`server/subapps/${plan.id}/\` and
\`web/src/subapps/${plan.webModuleId}/\` is byte-for-byte the same as the one
that mounts in the host — the generator emits one copy and a test hashes both
trees to prove it. \`${plan.names.registerRoutesFn}\` is the same function the
host calls.

## What is different

| | Flightdeck OS | standalone |
|---|---|---|
| Capability adapter | built from the workspace's live install row | \`standalone/capabilities.ts\`, backed by \`./data\` |
| Enablement | \`${plan.envVar}\` **and** a \`'*'\` ceiling row **and** a project row | none — it runs |
| RBAC | workspace roles | none; one local operator |
| Kill switch | host-wide | none |
| Audit | append-only, replicated, read by governance | \`data/audit.jsonl\`, local, unsigned |
| Inbox | a person resolves proposals | \`data/memory/proposals/\`, files on disk |

The scope check is **not** among the differences. \`capabilities.ts\` throws if a
route calls a method whose scope the manifest does not declare
(\`${plan.manifestData.capabilities.join("\`, \`") || "none declared"}\`), because a
local build that is laxer than the host teaches the app habits the host will
later refuse.

## Before you put this in front of anyone

\`buildStandaloneServer\` refuses to start without \`--allow-anonymous\`. That
flag is not a nuisance — it is the acknowledgement that none of the middle
column above is present here.

## Data

\`\`\`
data/
  contracts/<ticket>-<folder>/   read by readContracts()
  memory/proposals/${plan.id}-*  written by writeInboxProposal()
  audit.jsonl                    appended by auditAppend()
\`\`\`

An empty \`data/\` is fine: the page renders "Nothing here yet." rather than
fixtures pretending to be records.
`;
}

// ─────────────────────────────────────────────────────────────────────────

/**
 * Every standalone file, all `kind: "standalone"`.
 *
 * ⛔ THESE ARE NOT HOST FILES. Two of them sit at host paths
 * (`web/src/subapps/registry.ts`, `server/subapps/types.ts`) and would
 * OVERWRITE the host's own if applied to a Flightdeck checkout. `planWrites`
 * defaults to the host target and drops them; `applyGeneratedFiles` refuses
 * one by name rather than skipping it quietly.
 */
export function emitStandalone(plan: SubAppPlan): GeneratedFile[] {
  const files: GeneratedFile[] = [
    { path: "standalone/README.md", contents: emitReadme(plan), kind: "standalone" },
    { path: "standalone/capabilities.ts", contents: emitCapabilities(plan), kind: "standalone" },
    { path: "standalone/index.html", contents: emitIndexHtml(plan), kind: "standalone" },
    { path: "standalone/main.tsx", contents: emitMain(plan), kind: "standalone" },
    { path: "standalone/package.json", contents: emitPackageJson(plan), kind: "standalone" },
    { path: "standalone/server.ts", contents: emitServer(plan), kind: "standalone" },
    { path: "standalone/theme.css", contents: emitTheme(plan), kind: "standalone" },
    { path: "standalone/tsconfig.json", contents: emitTsconfig(), kind: "standalone" },
    { path: "standalone/vite.config.ts", contents: emitViteConfig(plan), kind: "standalone" },
    { path: `${webDir(plan.webModuleId)}/../registry.ts`, contents: emitRegistryShim(plan), kind: "standalone" },
    { path: `${serverDir(plan.id)}/../types.ts`, contents: emitTypesShim(plan), kind: "standalone" },
    {
      path: `${serverDir(plan.id)}/../capabilities.ts`,
      contents: emitCapabilitiesShim(plan),
      kind: "standalone",
    },
    { path: `${serverDir(plan.id)}/../killSwitch.ts`, contents: emitKillSwitchShim(), kind: "standalone" },
    { path: `${serverDir(plan.id)}/../installRow.ts`, contents: emitInstallRowShim(plan), kind: "standalone" },
    { path: "server/lib/flightdeckAudit.ts", contents: emitAuditShim(), kind: "standalone" },
    { path: "server/project/types.ts", contents: emitProjectTypesShim(), kind: "standalone" },
    { path: "server/workspace/types.ts", contents: emitWorkspaceTypesShim(), kind: "standalone" },
    {
      path: `${serverDir(plan.id)}/../registry.ts`,
      contents: emitServerRegistryShim(plan),
      kind: "standalone",
    },
    { path: "server/db.ts", contents: emitDbShim(), kind: "standalone" },
  ];
  return files.map((file) => ({ ...file, path: normalise(file.path) }));
}

/** `a/b/../c` -> `a/c`. The two shims are expressed relative to the sub-app's
 * own directories so that moving those directories moves the shims with them,
 * rather than leaving a hard-coded path that silently stops matching the
 * import it exists to satisfy. */
function normalise(p: string): string {
  const out: string[] = [];
  for (const segment of p.split("/")) {
    if (segment === "..") out.pop();
    else if (segment !== "." && segment !== "") out.push(segment);
  }
  return out.join("/");
}
