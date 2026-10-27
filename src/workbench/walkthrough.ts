/** A non-executing index of artifacts actually received. No inferred pages,
 * imports, model calls, installation or source evaluation. The preview's
 * existing bounded descriptor/route readers remain the only page readers. */
import { buildPreview } from "./preview/state";
import { classifyTier, TIERS, TIER_ORDER, tierRoot } from "./tree";
import { ALL_ENABLED, type Candidate, type WorkbenchView } from "./types";
import { readEmittedManifest } from "@codegen/testing/readEmittedManifest";

export interface ArtifactGroup {
  readonly id: string;
  readonly label: string;
  readonly folder: string;
  readonly paths: readonly string[];
}
export interface WalkthroughStep {
  readonly id: string;
  readonly kind: "manifest" | "server" | "page" | "section" | "registration" | "checks";
  readonly title: string;
  readonly facts: readonly string[];
  readonly tip: string;
  /** Fixed technical synopsis, never source/labels/prompts/config values. */
  readonly narration: string;
  readonly paths: readonly string[];
  readonly view: WorkbenchView;
  readonly sectionId?: string;
}
export interface WalkthroughPlan {
  readonly counts: { readonly artifacts: number; readonly sourceFiles: number; readonly hostEdits: number; readonly standalone: number; readonly pages: number; readonly sections: number; readonly capabilities: number };
  readonly groups: readonly ArtifactGroup[];
  readonly steps: readonly WalkthroughStep[];
  readonly unsupported: string | null;
  readonly manifestSupported: boolean;
}

export function buildWalkthrough(candidate: Candidate): WalkthroughPlan {
  // First-path semantics match the authoritative source selector. A duplicate
  // is not another artifact, another page, or another emitted host edit.
  const seenPaths = new Set<string>();
  const files = candidate.files.filter(file => { if (seenPaths.has(file.path)) return false; seenPaths.add(file.path); return true; });
  const manifests = files.filter(file => file.kind === "manifest");
  const groups: ArtifactGroup[] = [...(manifests.length === 0 ? [] : [{ id: "framework", label: "Manifest", folder: tierRoot("server", manifests.map(file => file.path)), paths: manifests.map(file => file.path) }]), ...TIER_ORDER.flatMap(tier => {
    const matches = files.filter(file => file.kind !== "manifest" && classifyTier(file) === tier);
    return matches.length === 0 ? [] : [{ id: tier, label: TIERS[tier].label, folder: tierRoot(tier, matches.map(file => file.path)), paths: matches.map(file => file.path) }];
  })];
  const manifestPaths = files.filter(file => file.kind === "manifest").map(file => file.path);
  const serverPaths = files.filter(file => ["routes-index", "routes-domain", "guard", "schema"].includes(file.kind)).map(file => file.path);
  const patchPaths = files.filter(file => classifyTier(file) === "host-edit").map(file => file.path);
  const testPaths = files.filter(file => file.kind === "host-test").map(file => file.path);
  let sourceManifest: Record<string, unknown> | null = null;
  const manifestFile = files.find(file => file.kind === "manifest");
  if (manifestFile !== undefined) { try { sourceManifest = readEmittedManifest(manifestFile.contents); } catch { /* Unsupported source stays unsupported, never evaluated. */ } }
  if (sourceManifest !== null && (!["id", "label", "version", "routePrefix", "navSection"].every(key => typeof sourceManifest?.[key] === "string") || !["capabilities", "visibleToRoles"].every(key => Array.isArray(sourceManifest?.[key]) && (sourceManifest?.[key] as unknown[]).every(value => typeof value === "string")))) sourceManifest = null;
  const strings = (key: string): string[] => Array.isArray(sourceManifest?.[key]) ? (sourceManifest[key] as unknown[]).filter((value): value is string => typeof value === "string") : [];
  const text = (key: string): string => typeof sourceManifest?.[key] === "string" ? sourceManifest[key] as string : "unsupported / absent";
  const manifest = { id: text("id"), label: text("label"), version: text("version"), routePrefix: text("routePrefix"), navSection: text("navSection"), visibleToRoles: strings("visibleToRoles"), capabilities: strings("capabilities") };
  const preview = buildPreview({ candidate: { ...candidate, files }, layers: () => ALL_ENABLED });
  const capabilities = [...new Set(manifest.capabilities)];
  const settings = sourceManifest?.settingsPanel;
  const settingsFacts = settings !== null && typeof settings === "object" && !Array.isArray(settings) && "label" in settings && "tier" in settings && "webComponentId" in settings && typeof settings.label === "string" && typeof settings.tier === "string" && typeof settings.webComponentId === "string"
    ? [`Settings contribution declared: ${settings.label} · ${settings.tier} · web component ${settings.webComponentId}. Module presence and host registration are not established.`] : [];
  const steps: WalkthroughStep[] = [
    { id: "manifest", kind: "manifest", title: "Manifest & capability declarations", view: "files", paths: manifestPaths,
      facts: [`${manifest.id} · ${manifest.label} · v${manifest.version}`, sourceManifest === null ? "Manifest source declarations unsupported / absent; received metadata is not substituted." : `Declared capabilities: ${capabilities.join(", ") || "none"}`, ...(manifestPaths.length === 0 ? ["Manifest source artifact is absent; only received metadata is available."] : [])],
      tip: "Declarations are requests, not grants. The host must independently authorize each capability in the current request scope.",
      narration: sourceManifest === null ? "The manifest source declarations are unsupported or absent. No capability grants have been inferred." : `The received manifest declares ${capabilities.length} capabilities. These declarations do not grant access.` },
    { id: "server", kind: "server", title: "Server routes & authorization boundary", view: "files", paths: serverPaths,
      facts: [`${serverPaths.length} received route, guard or schema artifacts.`, ...(!files.some(file => file.kind === "guard") ? ["Guard source: absent from the received candidate."] : []), ...(!files.some(file => file.kind === "schema") ? ["Schema source: absent from the received candidate."] : []), `Declared route prefix: ${manifest.routePrefix}`, sourceManifest === null ? "Visibility role declarations unsupported / absent." : `Visibility roles declared: ${manifest.visibleToRoles.join(", ") || "none"}`],
      tip: "Role visibility is a manifest declaration, not proof of effect-time authorization. Read the actual routes and guards; no server code runs in this walkthrough.",
      narration: "These received server files describe the routes and their authorization boundary. The walkthrough does not execute them." },
  ];
  let unsupported: string | null = null;
  if (preview.kind === "ready") {
    steps.push({ id: "page", kind: "page", title: `${preview.module.title} · emitted page`, view: "preview", paths: [preview.sourcePath],
      facts: ["Reader scope: one emitted Page/PANELS module. PageDoc configurations and additional web modules remain source-only.", `1 supported page descriptor; ${preview.module.panels.length} sections, not separate installed pages.`, sourceManifest === null ? "Navigation declaration unsupported / absent; no metadata fallback." : `Navigation declaration: ${manifest.navSection}; roles: ${manifest.visibleToRoles.join(", ") || "none"}`, ...settingsFacts],
      tip: "The descriptor mirror does not execute generated source. Its fidelity ledger distinguishes real structure, mocked data and absent host behavior.",
      narration: `One emitted page has ${preview.module.panels.length} declared sections. The preview is a scriptless descriptor mirror, not an installed application.` });
    for (const [index, panel] of preview.module.panels.entries()) {
      const routes = files.filter(file => file.kind === "routes-domain" && file.path.endsWith(`/routes/${panel.id}.ts`)).map(file => file.path);
      const facts: string[] = [];
      if (panel.list !== null) facts.push(`GET ${preview.module.routePrefix}${panel.list.path} · list descriptor · ${preview.scopes.has(`GET ${panel.list.path}`) ? "route scanned" : "route not identified"}`);
      for (const form of panel.forms) facts.push(`${form.method} ${preview.module.routePrefix}${form.path} · ${form.fields.length} declared fields · ${preview.scopes.has(`${form.method} ${form.path}`) ? "route scanned" : "route not identified"}`);
      steps.push({ id: `section-${index}`, kind: "section", sectionId: panel.id, title: panel.title, view: "preview", paths: [preview.sourcePath, ...routes], facts: facts.length === 0 ? ["No list or form request is declared in this section."] : facts,
        tip: "Request paths and field counts come from the received descriptor. A matching route scan is not runtime verification; preview rows and success bodies can be mocked.",
        narration: `This page section declares ${panel.list === null ? 0 : 1} list requests and ${panel.forms.length} forms. Actual host data and request authorization remain unverified.` });
    }
  } else {
    unsupported = preview.block.kind;
    steps.push({ id: "page", kind: "page", title: "Page walkthrough unsupported", view: "preview", paths: files.filter(file => file.kind === "web-module").map(file => file.path),
      facts: [`Descriptor unavailable: ${unsupported}. No page or section has been invented.`], tip: "Open the actual web source or the blocked Preview explanation. Unsupported descriptors are never evaluated as a fallback.", narration: "The page descriptor is unsupported. No page has been invented and generated source will not be executed." });
  }
  steps.push({ id: "registration", kind: "registration", title: "Host registration proposal", view: "files", paths: patchPaths,
    facts: patchPaths.length === 0 ? ["No host registration edit is present in this candidate."] : [`${patchPaths.length} proposed host edits received; not applied.`],
    tip: "Generated files are not an installed framework. Packages, host registration, enablement and deployment require separate authorized work.", narration: "Host edits, if present, are proposals only. No packages are installed and no host registration is applied by this walkthrough." });
  const errors = candidate.findings.filter(finding => finding.severity === "error").length;
  const warnings = candidate.findings.filter(finding => finding.severity === "warning").length;
  const rules = new Set(candidate.rulesRun).size;
  steps.push({ id: "checks", kind: "checks", title: "Generated tests & static evidence", view: "gate", paths: testPaths,
    facts: [`${rules} reported static rules; ${errors} errors; ${warnings} warnings.`, rules > 0 ? `Reported rules: ${[...new Set(candidate.rulesRun)].join(", ")}` : "No rules are reported as run.", `${testPaths.length} generated test artifacts; presence does not establish execution.`],
    tip: "This is a static conformance snapshot, not installed-host or production verification. Saving manual source edits does not rerun checks.", narration: `${rules} static rules are reported with ${errors} errors and ${warnings} warnings. Test files do not prove execution, and manual source edits have not been rechecked.` });
  return { manifestSupported: sourceManifest !== null, counts: { artifacts: files.length, sourceFiles: files.length - patchPaths.length, hostEdits: patchPaths.length, standalone: files.filter(file => classifyTier(file) === "standalone").length, pages: preview.kind === "ready" ? 1 : 0, sections: preview.kind === "ready" ? preview.module.panels.length : 0, capabilities: capabilities.length }, groups, steps, unsupported };
}
