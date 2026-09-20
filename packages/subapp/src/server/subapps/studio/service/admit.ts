/** The host's OWN opinion of a bundle, formed from the bundle's own bytes.
 *
 * ⭐ WHY THIS EXISTS AT ALL. `bundle.ts` decides what is well-formed. This
 * decides what is ADMISSIBLE — what the host is willing to write into
 * `memory/proposals/` for a person to read and act on. The two are different
 * questions, and the second one is the one with teeth: a proposal is a list of
 * source files with repo paths beside them, written so that a human can paste
 * them into this repository. Anything that arrives claiming a path is claiming
 * a place in somebody's checkout.
 *
 * ⛔ THE BUNDLE'S `gate` BLOCK IS NOT A VERDICT. It is a report of a run that
 * happened in Studio, which is somewhere this process cannot see, sent over
 * HTTP by whoever could reach the route. It is recorded as provenance and
 * refused when it reports a failure, and that is all it is allowed to do.
 * Everything with consequences is re-derived here, from the file contents, by
 * code that lives in this repository and compiles with it.
 *
 * ── WHY THESE SEVEN CHECKS AND NOT @conformance's THIRTY-EIGHT ──────────
 * Studio's gate judges whether a generated sub-app is a GOOD sub-app: table
 * prefixes, i18n wiring, unreferenced files, whether it would typecheck. That
 * is the right question at generation time and it needs the whole engine to
 * answer. It is not the question here. Here the question is narrower and
 * sharper: if a person trusts this proposal and pastes it in, what is the
 * worst that happens? So these checks cover exactly the answers to that —
 * where the files land, whether the manifest would boot, whether the route
 * source can reach a disk, whether its handlers check enable-state, and
 * whether the registry lines are data or code. Seven checks, no dependencies,
 * and every one of them re-derived rather than believed.
 *
 * A check that finds nothing still reports that it RAN. A report listing no
 * findings and no checks would be indistinguishable from a clean one, and the
 * route refuses a bundle whose admission ran zero checks for that reason. */
import type { StudioBundle } from "./bundle.js";
import { MAX_BUNDLE_BYTES, bundleBytes } from "./bundle.js";

/* ══════════════════════════════════════════════════════════════════════════
 * What the host itself is
 *
 * These five lists are the host's, not Studio's. They are literals here
 * rather than imports because importing the host's `registry.ts` to read them
 * would drag every sibling sub-app into this file's static import closure —
 * the exact thing `tests/subapps/subappImportClosure.test.ts` fails on
 * (contract rule 4). `tests/subapps/studio/studioAdmission.test.ts` pins them
 * beside the manifest Studio itself declares, so a drift shows up as a red
 * test rather than as an admitted proposal.
 * ═══════════════════════════════════════════════════════════════════════ */

/** Exact string equality against the shell's `UI_NAV_SECTIONS`. A manifest
 * naming a section the shell does not know does not error — it silently forms
 * an accordion group of its own, which is a wrong-output bug. */
export const HOST_NAV_SECTIONS = ["Overview", "Contract pipeline", "Ops & insight", "Admin", "System apps"] as const;

/** `super_admin` is an INSTANCE role and is deliberately absent, matching the
 * host's own `WORKSPACE_ROLE_VALUES`. */
export const HOST_ROLES = ["hr_preparer", "hr_reviewer", "wc_liaison", "legal", "admin"] as const;

/** The whole consent vocabulary. The array in a manifest IS the human consent
 * screen, so a scope the host cannot grant must never reach one. */
export const HOST_CAPABILITIES = ["read:contracts", "write:inbox-proposal"] as const;

/** The host this build is. A manifest demanding more refuses to boot — and it
 * refuses LOUDLY, taking every other sub-app down with it. */
export const HOST_VERSION = "5.0.0";

/** Bare specifiers a mounted sub-app module may name. The host carries these
 * two and a sub-app that names a third does not install — it fails the host's
 * build. An allowlist, not a blocklist: a blocklist only names the escapes
 * somebody already thought of. */
const ALLOWED_BARE_IMPORTS = new Set(["zod", "fastify"]);

/** Host modules a sub-app's server file may reach, as paths relative to
 * `server/`. LEAVES only: `registry.ts` and `installRoutes.ts` are absent
 * because reaching either one pulls every sibling sub-app into the closure. */
const ALLOWED_HOST_MODULES = new Set([
  "subapps/types",
  "subapps/capabilities",
  "subapps/installRow",
  "subapps/killSwitch",
  "lib/flightdeckAudit",
  "workspace/types",
  "project/types",
  "db",
]);

/* ══════════════════════════════════════════════════════════════════════════
 * Findings
 * ═══════════════════════════════════════════════════════════════════════ */

export type AdmissionSeverity = "error" | "warning";

/** Deliberately in an `ADM-` namespace rather than `@conformance`'s `FD-`.
 * These are the host's admission rules, decided here; borrowing the gate's
 * ids would suggest the gate ran, and it did not. */
export type AdmissionRule =
  | "ADM-001"
  | "ADM-010"
  | "ADM-020"
  | "ADM-030"
  | "ADM-040"
  | "ADM-050"
  | "ADM-060"
  | "ADM-070";

export interface AdmissionFinding {
  readonly rule: AdmissionRule;
  readonly severity: AdmissionSeverity;
  /** The bundle file this is about, or `(bundle)` when it is about the whole
   * payload rather than one file. */
  readonly file: string;
  /** One sentence, addressed to whoever has to fix it. Names what was found,
   * never "invalid input". */
  readonly message: string;
}

export const BUNDLE_SCOPE = "(bundle)";

export interface AdmissionReport {
  readonly ok: boolean;
  /** Every check that RAN, by name. A partial run can never be mistaken for a
   * clean one. */
  readonly checks: readonly string[];
  readonly findings: readonly AdmissionFinding[];
  readonly errors: readonly AdmissionFinding[];
  readonly warnings: readonly AdmissionFinding[];
  readonly filesChecked: number;
}

function err(rule: AdmissionRule, file: string, message: string): AdmissionFinding {
  return { rule, severity: "error", file, message };
}

function warn(rule: AdmissionRule, file: string, message: string): AdmissionFinding {
  return { rule, severity: "warning", file, message };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Small pure helpers
 * ═══════════════════════════════════════════════════════════════════════ */

/** `"1.2.3"` -> `[1,2,3]`, padded. Anything non-numeric returns null so a
 * version the host cannot compare is refused rather than treated as zero. */
function versionParts(value: string): [number, number, number] | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const out: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,6}$/.test(part)) return null;
    out.push(Number(part));
  }
  return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0];
}

/** True when `candidate` asks for a host strictly newer than `host`. */
export function demandsNewerHost(candidate: string, host: string): boolean {
  const a = versionParts(candidate);
  const b = versionParts(host);
  if (a === null || b === null) return true;
  for (let i = 0; i < 3; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

/** Normalises a POSIX path, resolving `.` and `..`. Returns null when the path
 * climbs above its own root — which is the answer that matters. */
function normalize(pathValue: string): string | null {
  const out: string[] = [];
  for (const segment of pathValue.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

/** Every module specifier a source file names, including dynamic `import()`
 * and `require()`. A regex rather than a parser because the host carries no
 * parser a sub-app may import, and because the answer only has to be
 * CONSERVATIVE: a specifier this misses is one the check does not clear, and
 * `ADM-040` refuses anything it cannot classify. */
function specifiersOf(source: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const spec = match[1];
      if (spec !== undefined) out.push(spec);
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * The checks
 * ═══════════════════════════════════════════════════════════════════════ */

/* ── The frame every path in a bundle is written in ─────────────────────
 * Paths are relative to the HOST PACKAGE root — the directory this server
 * runs from, the one holding `server/`, `web/` and `tests/`. That is the
 * frame `@codegen` emits in and the frame `REGISTRY_PATH` is written in, so
 * a bundle's paths are the paths a human `cd`s to. A bundle that spelled
 * them from some outer checkout root would not be wrong so much as
 * unanswerable: this process cannot know what is above it. */
const SERVER_ROOT = "server/subapps";
const WEB_ROOT = "web/src/subapps";
const TEST_ROOT = "tests/subapps";
const REGISTRY_PATH = `${SERVER_ROOT}/registry.ts`;

/** ADM-010 — everything the host derives from `id` must equal its derivation.
 * `id` is locked once shipped because the env var, the nav path, the route
 * prefix and the table prefix all come from it; a bundle whose `routePrefix`
 * disagrees with its `id` would mount at one path and be killed by an env var
 * named for another. */
function checkIdDerivations(bundle: StudioBundle): AdmissionFinding[] {
  const found: AdmissionFinding[] = [];
  const id = bundle.spec.id;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    found.push(err("ADM-010", BUNDLE_SCOPE, `sub-app id ${JSON.stringify(id)} is not /^[a-z0-9][a-z0-9-]*$/`));
    return found;
  }
  if (id === "studio") {
    found.push(err("ADM-010", BUNDLE_SCOPE, 'a bundle may not propose the id "studio": that is this sub-app, and applying it would replace the thing that filed the proposal'));
  }
  if (bundle.subAppId !== id) {
    found.push(err("ADM-010", BUNDLE_SCOPE, `the bundle says subAppId ${JSON.stringify(bundle.subAppId)} but its spec says ${JSON.stringify(id)}`));
  }
  const routePrefix = `/api/apps/${id}`;
  if (bundle.spec.routePrefix !== routePrefix) {
    found.push(err("ADM-010", BUNDLE_SCOPE, `routePrefix ${JSON.stringify(bundle.spec.routePrefix)} is not the derivation of id ${JSON.stringify(id)}, which is ${JSON.stringify(routePrefix)}`));
  }
  if (bundle.spec.webModuleId !== id) {
    found.push(err("ADM-010", BUNDLE_SCOPE, `webModuleId ${JSON.stringify(bundle.spec.webModuleId)} must equal the id ${JSON.stringify(id)}: the host's web loader looks the module up by directory name`));
  }
  const envVar = `SUBAPP_${id.toUpperCase().replace(/-/g, "_")}_ENABLED`;
  if (bundle.spec.enableEnvVar !== envVar) {
    found.push(err("ADM-010", BUNDLE_SCOPE, `enableEnvVar ${JSON.stringify(bundle.spec.enableEnvVar)} is not the derivation of id ${JSON.stringify(id)}, which is ${JSON.stringify(envVar)}`));
  }
  return found;
}

/** ADM-020 — every proposed path lands inside the new sub-app's own three
 * directories, and nowhere else.
 *
 * ⭐ THE SINGLE MOST LOAD-BEARING CHECK IN THIS FILE. A proposal is a list of
 * paths with source beside them, addressed to a person who will write them
 * into this repository. A path of `../../../.github/workflows/ci.yml`, or of
 * `flightdeck/server/subapps/registry.ts`, is not a mini-app — it is an edit
 * to the host wearing a mini-app's clothes, and the person pasting it has
 * every reason to think the host checked. This is the host checking. */
function checkFileContainment(bundle: StudioBundle): AdmissionFinding[] {
  const found: AdmissionFinding[] = [];
  const id = bundle.spec.id;
  const roots = [`${SERVER_ROOT}/${id}/`, `${WEB_ROOT}/${id}/`, `${TEST_ROOT}/${id}/`];
  const seen = new Set<string>();

  for (const file of bundle.files) {
    const raw = file.path;
    if (raw.includes("\\") || raw.includes("\0") || /[\u0000-\u001f]/.test(raw)) {
      found.push(err("ADM-020", raw, "path contains a backslash or a control character"));
      continue;
    }
    if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) {
      found.push(err("ADM-020", raw, "path is absolute; a proposal names repo-relative paths only"));
      continue;
    }
    const normalized = normalize(raw);
    if (normalized === null) {
      found.push(err("ADM-020", raw, "path climbs above the repository root with `..`"));
      continue;
    }
    if (normalized !== raw) {
      found.push(err("ADM-020", raw, `path is not in normal form (it normalises to ${JSON.stringify(normalized)}); a proposal names each file exactly once, spelled one way`));
      continue;
    }
    if (seen.has(normalized)) {
      found.push(err("ADM-020", raw, "the bundle names this path twice, so one of the two contents would be lost"));
      continue;
    }
    seen.add(normalized);
    if (!roots.some((root) => normalized.startsWith(root))) {
      found.push(err("ADM-020", raw, `path is outside the sub-app's own directories; a bundle for ${JSON.stringify(id)} may only add files under ${roots.join(", ")}`));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(normalized)) {
      found.push(err("ADM-020", raw, "a sub-app ships TypeScript only: no stylesheet, no JSON, no asset. Every sub-app's CSS lives in the host's shared theme.css."));
    }
  }

  const server = [...seen].filter((p) => p.startsWith(`${SERVER_ROOT}/${id}/`));
  const web = [...seen].filter((p) => p.startsWith(`${WEB_ROOT}/${id}/`));
  if (!server.includes(`${SERVER_ROOT}/${id}/manifest.ts`)) {
    found.push(err("ADM-020", BUNDLE_SCOPE, `the bundle proposes no ${SERVER_ROOT}/${id}/manifest.ts; a sub-app is its manifest`));
  }
  if (web.length === 0) {
    found.push(err("ADM-020", BUNDLE_SCOPE, `the bundle proposes no web module under ${WEB_ROOT}/${id}/; the manifest names one and the console would fail to mount it`));
  }
  if (!server.some((p) => p.endsWith("/schema.ts"))) {
    // Not a problem — the mini-app floor. Said out loud so a reviewer can see
    // the absence was noticed rather than missed.
    found.push(warn("ADM-020", BUNDLE_SCOPE, "no schema.ts: this is a database-free mini-app, which is the floor Studio generates to"));
  }
  return found;
}

/** ADM-030 — would `loadValidatedManifests` accept this at boot? Validation is
 * fail-loud: one malformed manifest takes the whole server down, along with
 * every other sub-app on it. */
function checkManifestLiterals(bundle: StudioBundle): AdmissionFinding[] {
  const found: AdmissionFinding[] = [];
  const spec = bundle.spec;
  if (!(HOST_NAV_SECTIONS as readonly string[]).includes(spec.navSection)) {
    found.push(err("ADM-030", BUNDLE_SCOPE, `navSection ${JSON.stringify(spec.navSection)} is not one of the host's sections (${HOST_NAV_SECTIONS.join(", ")}); the match is exact string equality and a near miss silently forms an accordion group of its own`));
  }
  if (spec.visibleToRoles.length === 0) {
    found.push(err("ADM-030", BUNDLE_SCOPE, "visibleToRoles is empty; it is required and non-empty, because a schema-valid manifest can never produce zero derived RBAC coverage"));
  }
  for (const role of spec.visibleToRoles) {
    if (!(HOST_ROLES as readonly string[]).includes(role)) {
      found.push(err("ADM-030", BUNDLE_SCOPE, `visibleToRoles names ${JSON.stringify(role)}, which is not a workspace role (${HOST_ROLES.join(", ")})`));
    }
  }
  for (const scope of spec.capabilities) {
    if (!(HOST_CAPABILITIES as readonly string[]).includes(scope)) {
      found.push(err("ADM-030", BUNDLE_SCOPE, `capabilities names ${JSON.stringify(scope)}, which the host cannot grant (${HOST_CAPABILITIES.join(", ")}); the array IS the human consent screen`));
    }
  }
  if (demandsNewerHost(spec.minHostVersion, HOST_VERSION)) {
    found.push(err("ADM-030", BUNDLE_SCOPE, `minHostVersion ${JSON.stringify(spec.minHostVersion)} is newer than this host (${HOST_VERSION}); the server refuses to boot on it`));
  }
  if (spec.label.trim().length === 0 || spec.icon.trim().length === 0) {
    found.push(err("ADM-030", BUNDLE_SCOPE, "label and icon must both be non-empty: the shell renders them verbatim"));
  }
  if (spec.steps.length === 0) {
    found.push(warn("ADM-030", BUNDLE_SCOPE, "the spec carries no steps, so the generated page has no procedure to show"));
  }
  return found;
}

/** ADM-040 — can any proposed server module reach a disk, a database or a
 * sibling sub-app? Contract rule 3 and rule 4. An import that is merely
 * PRESENT in a mounted module's closure fails the host's own fence, whether or
 * not the code ever calls it — so this reads specifiers, not call sites. */
function checkCapabilityEscape(bundle: StudioBundle): AdmissionFinding[] {
  const found: AdmissionFinding[] = [];
  const id = bundle.spec.id;
  const serverPrefix = `${SERVER_ROOT}/${id}/`;

  for (const file of bundle.files) {
    if (!file.path.startsWith(serverPrefix)) continue;
    const dir = file.path.slice(0, file.path.lastIndexOf("/"));

    for (const spec of specifiersOf(file.contents)) {
      if (spec.startsWith("node:")) {
        found.push(err("ADM-040", file.path, `imports ${JSON.stringify(spec)}; a mounted sub-app module may not reach a node builtin — the capability adapter is the only surface it gets`));
        continue;
      }
      if (!spec.startsWith(".")) {
        if (!ALLOWED_BARE_IMPORTS.has(spec)) {
          found.push(err("ADM-040", file.path, `imports ${JSON.stringify(spec)}; a mounted sub-app module may name only ${[...ALLOWED_BARE_IMPORTS].join(" and ")}, which are the packages the host already carries`));
        }
        continue;
      }
      const resolved = normalize(`${dir}/${spec}`);
      if (resolved === null) {
        found.push(err("ADM-040", file.path, `imports ${JSON.stringify(spec)}, which climbs above the repository root`));
        continue;
      }
      if (resolved.startsWith(serverPrefix)) continue;
      if (!resolved.startsWith("server/")) {
        found.push(err("ADM-040", file.path, `imports ${JSON.stringify(spec)}, which resolves to ${JSON.stringify(resolved)} — outside the server tier; a server module may not reach across into web/ or tests/`));
        continue;
      }
      const leaf = resolved.slice("server/".length).replace(/\.js$/, "").replace(/\/index$/, "");
      if (!ALLOWED_HOST_MODULES.has(leaf)) {
        found.push(err("ADM-040", file.path, `imports ${JSON.stringify(spec)}, which resolves to the host module ${JSON.stringify(leaf)}. A sub-app imports from the LEAVES (installRow, killSwitch, types, capabilities, flightdeckAudit) — never registry.ts or installRoutes.ts, which would drag every sibling sub-app into this file's import closure.`));
      }
    }

    // Contract rule 2: never cache a boolean. A module-level `process.env`
    // read turns the kill switch into a restart-only control, which is the
    // opposite of what an operator reaches for it for.
    if (file.contents.includes("process.env")) {
      found.push(err("ADM-040", file.path, "reads process.env; enable-state is re-read per request through the host's leaves, never captured at module level"));
    }
  }
  return found;
}

/** ADM-050 — does every handler check enable-state BEFORE it does anything?
 *
 * The shell's manifest-derived RBAC rule enforces ROLES ONLY. Nothing in the
 * host checks enable-state for a sub-app's own routes, so a handler that
 * checked second would do real work with the kill switch off. "First" is
 * checked positionally, because "calls the guard somewhere" is the shape this
 * is easy to get almost right in. */
function checkGuardFirst(bundle: StudioBundle): AdmissionFinding[] {
  const found: AdmissionFinding[] = [];
  const id = bundle.spec.id;
  const serverPrefix = `${SERVER_ROOT}/${id}/`;
  const beforeGuard = ["safeParse", "req.body", "req.params", "req.query", "capabilitiesFor", "rt.db"];
  let handlersSeen = 0;

  for (const file of bundle.files) {
    if (!file.path.startsWith(serverPrefix)) continue;
    const source = file.contents;
    const handlers = source.split(/\bapp\.(?:get|post|put|patch|delete)\s*\(/).slice(1);
    if (handlers.length === 0) continue;

    // The guard must be IMPORTED, not assumed: a name that is merely spelled
    // correctly resolves to nothing at runtime.
    const guardNames = [...source.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*["'][^"']*guard\.js["']/g)]
      .flatMap((match) => (match[1] ?? "").split(","))
      .map((name) => name.trim())
      .filter((name) => /^require[A-Za-z0-9]*Enabled$/.test(name));
    if (guardNames.length === 0) {
      found.push(err("ADM-050", file.path, "registers handlers but imports no require<Id>Enabled guard from ./guard.js; the guard has to be imported, not assumed"));
      continue;
    }

    for (const handler of handlers) {
      handlersSeen += 1;
      const guardAt = Math.min(
        ...guardNames.map((name) => {
          const at = handler.indexOf(name);
          return at === -1 ? Number.MAX_SAFE_INTEGER : at;
        }),
      );
      if (guardAt === Number.MAX_SAFE_INTEGER) {
        found.push(err("ADM-050", file.path, `a handler never calls ${guardNames.join(" or ")}; with the kill switch off it would run anyway`));
        continue;
      }
      for (const token of beforeGuard) {
        const at = handler.indexOf(token);
        if (at !== -1 && at < guardAt) {
          found.push(err("ADM-050", file.path, `a handler reaches ${JSON.stringify(token)} before it calls the enable guard; the guard must be the first statement, not the first interesting one`));
        }
      }
    }
  }

  if (handlersSeen === 0) {
    found.push(warn("ADM-050", BUNDLE_SCOPE, "no route handler was found in the proposed server files, so there was nothing for this check to hold to the rule"));
  }
  return found;
}

/** ADM-060 — the registry lines are DATA a human pastes into a host file. An
 * `entryLines` array that carried a statement would be arbitrary code arriving
 * in a proposal and landing in `registry.ts`, and the person pasting it is
 * trusting the review screen that showed it to them. */
function checkRegistryEdit(bundle: StudioBundle): AdmissionFinding[] {
  const found: AdmissionFinding[] = [];
  const id = bundle.spec.id;
  const registry = bundle.registry;

  if (registry.file !== REGISTRY_PATH) {
    found.push(err("ADM-060", BUNDLE_SCOPE, `the registry edit names ${JSON.stringify(registry.file)}; the only host file a sub-app's mount edits is ${REGISTRY_PATH}`));
  }
  const importPattern = new RegExp(`^import \\{ [A-Za-z_$][A-Za-z0-9_$]* \\} from "\\./${id}/manifest\\.js";$`);
  if (!importPattern.test(registry.importLine.trim())) {
    found.push(err("ADM-060", BUNDLE_SCOPE, `the registry import line is not a single named import of ./${id}/manifest.js: ${JSON.stringify(registry.importLine)}`));
  }
  for (const line of registry.entryLines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("//")) continue;
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*,?$/.test(trimmed)) {
      found.push(err("ADM-060", BUNDLE_SCOPE, `the registry entry line ${JSON.stringify(line)} is not a bare identifier or a comment; SUBAPP_MANIFESTS takes manifest names, and anything else in these lines is code arriving in a proposal`));
    }
  }
  return found;
}

/** ADM-070 — what Studio's gate REPORTED, taken as a claim.
 *
 * A claim can only do two things here: be refused when it reports a failure,
 * and be recorded as provenance. It is never the reason a bundle is admitted —
 * that is what the six checks above are for. A bundle claiming a clean run
 * that named no checks is refused outright, because "no findings" and "nothing
 * ran" look identical from here and only one of them is a pass. */
function checkReportedGate(bundle: StudioBundle): AdmissionFinding[] {
  const found: AdmissionFinding[] = [];
  const gate = bundle.gate;
  if (!gate.ok) {
    found.push(err("ADM-070", BUNDLE_SCOPE, "the bundle reports its own contract gate as blocked; a proposal is not the place to record a run somebody already knows failed"));
  }
  if (gate.checks.length === 0) {
    found.push(err("ADM-070", BUNDLE_SCOPE, 'the bundle reports a passing gate that names no checks. "Nothing was wrong" and "nothing ran" are not the same answer, and only one of them is a pass.'));
  }
  const errors = gate.findings.filter((finding) => finding.severity === "error");
  if (errors.length > 0) {
    found.push(err("ADM-070", BUNDLE_SCOPE, `the bundle reports ok but carries ${String(errors.length)} error finding(s), the first being ${errors[0]?.rule ?? "?"}; the report contradicts itself`));
  }
  if (gate.filesChecked < bundle.files.length) {
    found.push(warn("ADM-070", BUNDLE_SCOPE, `the reported gate checked ${String(gate.filesChecked)} files but the bundle carries ${String(bundle.files.length)}; some of what is being proposed was not judged by it`));
  }
  return found;
}

/* ══════════════════════════════════════════════════════════════════════════
 * The admission
 * ═══════════════════════════════════════════════════════════════════════ */

interface NamedCheck {
  readonly name: string;
  readonly run: (bundle: StudioBundle) => AdmissionFinding[];
}

/** In the order a reviewer asks the questions: is it the app it says it is,
 * where would the files land, would the manifest boot, what can the code
 * reach, does it check before it acts, are the registry lines data, and what
 * did the thing that generated it claim. */
export const ADMISSION_CHECKS: readonly NamedCheck[] = [
  { name: "id-derivations", run: checkIdDerivations },
  { name: "file-containment", run: checkFileContainment },
  { name: "manifest-literals", run: checkManifestLiterals },
  { name: "capability-escape", run: checkCapabilityEscape },
  { name: "guard-first", run: checkGuardFirst },
  { name: "registry-edit", run: checkRegistryEdit },
  { name: "reported-gate", run: checkReportedGate },
];

export function admitBundle(bundle: StudioBundle): AdmissionReport {
  const findings: AdmissionFinding[] = [];
  const checks: string[] = [];

  const bytes = bundleBytes(bundle);
  checks.push("bundle-size");
  if (bytes > MAX_BUNDLE_BYTES) {
    findings.push(err("ADM-001", BUNDLE_SCOPE, `the bundle's files total ${String(bytes)} bytes, over the ${String(MAX_BUNDLE_BYTES)}-byte ceiling for one proposal`));
  }

  for (const check of ADMISSION_CHECKS) {
    try {
      findings.push(...check.run(bundle));
    } catch (error) {
      // A check that throws has not passed the bundle. It fails closed, under
      // its own finding, so "admission said yes" can never mean "admission
      // threw and somebody caught it".
      findings.push(err("ADM-001", BUNDLE_SCOPE, `the ${check.name} check did not complete: ${error instanceof Error ? error.message : String(error)}`));
    }
    checks.push(check.name);
  }

  const errors = findings.filter((finding) => finding.severity === "error");
  const warnings = findings.filter((finding) => finding.severity === "warning");
  return {
    ok: errors.length === 0,
    checks,
    findings,
    errors,
    warnings,
    filesChecked: bundle.files.length,
  };
}
