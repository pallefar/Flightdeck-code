/** Can this candidate be previewed, and if not, exactly why.
 *
 * ── THE LADDER ──────────────────────────────────────────────────────
 * An honest "cannot preview this yet, here is why" beats a fake preview,
 * so every refusal below is a named case with the thing a person would do
 * about it — never a spinner that never resolves and never a blank frame.
 *
 * ── WHY GATE ERRORS DO NOT BLANKET-BLOCK THE PREVIEW ────────────────
 * The tempting rule is "any error from the conformance gate, no preview".
 * It is wrong, and wrong in the direction that costs a person the most.
 * Most gate errors are about the SERVER — a handler that skipped its
 * guard (FD-G001), a query outside the table prefix (FD-S002), a node
 * builtin in a mounted module (FD-C001). None of those stops the PAGE
 * from rendering, and the page is what the person needs to look at while
 * deciding whether the thing they described is the thing they got.
 * Blocking on them hides the only working half of the screen and teaches
 * people that the preview tab is broken.
 *
 * Only two findings actually make a preview impossible, and they are
 * exactly the two about the web module's existence and its export. Those
 * are `BLOCKING_RULES`. Everything else is ATTRIBUTED — pinned to the
 * panel or the page region it affects and drawn on top of the preview, so
 * a `read:contracts` route with no guard is a red mark on the panel that
 * calls it rather than a line in a list somewhere else. That is what
 * "findings as first-class content" has to mean to be worth anything. */
import type { Candidate, Finding } from "../types";
import { MockCapabilityHost, type ScopeMap, scanScopes } from "./adapter";
import { readWebModule, type WebModule } from "./descriptor";
import { buildLedger, type LedgerRow } from "./fidelity";

/** The only two findings that make a preview impossible rather than
 * merely alarming: no web module at the path the manifest names, and a
 * web module that does not default-export a Page. */
export const BLOCKING_RULES: readonly string[] = ["FD-X002", "FD-X003"];

export type PreviewBlock =
  | { readonly kind: "no-candidate" }
  | { readonly kind: "no-web-module"; readonly expected: string }
  | { readonly kind: "gate-blocked"; readonly findings: readonly Finding[] }
  | { readonly kind: "renderer-drift"; readonly missing: readonly string[] }
  | { readonly kind: "unparsable"; readonly detail: string };

/** Where a finding lands on the preview. */
export type Attachment =
  | { readonly target: "page" }
  | { readonly target: "panel"; readonly panelId: string }
  | { readonly target: "server" };

export interface AttributedFinding {
  readonly finding: Finding;
  readonly attachment: Attachment;
}

export interface PreviewReady {
  readonly kind: "ready";
  readonly module: WebModule;
  readonly host: MockCapabilityHost;
  readonly scopes: ScopeMap;
  readonly ledger: readonly LedgerRow[];
  readonly attributed: readonly AttributedFinding[];
  /** Web module path, so the pane can say what it is showing. */
  readonly sourcePath: string;
}

export type PreviewState = PreviewReady | ({ readonly kind: "blocked" } & { readonly block: PreviewBlock });

export function isReady(state: PreviewState): state is PreviewReady {
  return state.kind === "ready";
}

/** The panel a finding belongs to.
 *
 * A finding in `server/subapps/<id>/routes/entries.ts` is about the routes
 * the `entries` panel calls, because the emitter names the file after the
 * domain and the panel after the same domain. So the basename IS the
 * panel id, and a server-side finding can be drawn on the piece of UI it
 * actually affects instead of in a list the reviewer has to correlate by
 * hand. When the basename matches no panel — `routes/index.ts`, `guard.ts`
 * — it falls through to `server`, which is honest: it affects the app, not
 * one panel. */
export function attach(finding: Finding, panelIds: ReadonlySet<string>): Attachment {
  const path = finding.file;
  if (path.startsWith("web/src/subapps/")) return { target: "page" };
  if (path.endsWith("/manifest.ts")) return { target: "page" };
  const match = /\/routes\/([^/]+)\.ts$/.exec(path);
  const domain = match?.[1];
  if (domain !== undefined && domain !== "index" && panelIds.has(domain)) {
    return { target: "panel", panelId: domain };
  }
  return { target: "server" };
}

export interface BuildOptions {
  readonly candidate: Candidate | null;
  /** Read live from the store every request — contract §5.2, and the
   * reason the preview's toggles need no remount. */
  readonly layers: () => import("../types").EnableLayers;
}

export function buildPreview(options: BuildOptions): PreviewState {
  const { candidate } = options;
  if (candidate === null) return { kind: "blocked", block: { kind: "no-candidate" } };

  const blocking = candidate.findings.filter(
    (f) => f.severity === "error" && BLOCKING_RULES.includes(f.rule),
  );
  if (blocking.length > 0) {
    return { kind: "blocked", block: { kind: "gate-blocked", findings: blocking } };
  }

  const webFile = candidate.files.find((file) => file.kind === "web-module");
  if (webFile === undefined) {
    return {
      kind: "blocked",
      block: {
        kind: "no-web-module",
        expected: `web/src/subapps/${candidate.manifest.webModuleId}/index.tsx`,
      },
    };
  }

  const read = readWebModule(webFile.contents);
  if (!read.ok) {
    return {
      kind: "blocked",
      block:
        read.reason === "renderer-drift"
          ? { kind: "renderer-drift", missing: read.missing }
          : { kind: "unparsable", detail: read.detail },
    };
  }

  const module = read.module;
  const routeSources = candidate.files
    .filter((file) => file.kind === "routes-domain" || file.kind === "routes-index")
    .map((file) => file.contents);
  const scopes = scanScopes(routeSources, module.routePrefix);

  const host = new MockCapabilityHost({
    subAppId: candidate.manifest.id,
    capabilities: candidate.manifest.capabilities,
    panels: module.panels,
    scopes,
    layers: options.layers,
  });

  const panelIds = new Set(module.panels.map((panel) => panel.id));
  const attributed: AttributedFinding[] = candidate.findings.map((finding) => ({
    finding,
    attachment: attach(finding, panelIds),
  }));

  return {
    kind: "ready",
    module,
    host,
    scopes,
    sourcePath: webFile.path,
    ledger: buildLedger({
      scopesScanned: scopes.size > 0,
      hasCapabilities: candidate.manifest.capabilities.length > 0,
      // The same condition `MockCapabilityHost.#rows` applies: columns come
      // from a panel's own forms, so a panel without one fabricates nothing.
      fabricatesRows: module.panels.some((panel) => panel.forms.length > 0),
    }),
    attributed,
  };
}

/** Findings pinned to one panel, worst first. */
export function findingsFor(
  attributed: readonly AttributedFinding[],
  panelId: string,
): Finding[] {
  return attributed
    .filter((a) => a.attachment.target === "panel" && a.attachment.panelId === panelId)
    .map((a) => a.finding)
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}

export function findingsOn(
  attributed: readonly AttributedFinding[],
  target: Attachment["target"],
): Finding[] {
  return attributed
    .filter((a) => a.attachment.target === target)
    .map((a) => a.finding)
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}
