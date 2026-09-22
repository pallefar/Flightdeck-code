/**
 * ⭐ THE SEAM THAT STOPPED PROMPT → APP.
 *
 * `@spec` and `@codegen` both export a type called `MiniAppSpec` and they are
 * not the same document. `@spec` describes what the planner UNDERSTOOD —
 * `specVersion`, `minHostVersion`, `purpose`, `sourcePrompt`, `derived`, a
 * flat `routes` array. `@codegen` describes what an emitter can WRITE —
 * `domains` (required), each route carrying an `operation`. `generateSubApp`
 * parsed the first with the second's schema and refused every key, which is
 * `spec-contract.ts` behaving exactly as its header says it should: "the only
 * door in … a widening shows up as a parse failure here — loudly, at the
 * seam". Loud, correct, and unbridged.
 *
 * This is the bridge, and the rule it is built on is the one the gap note
 * asked for: UNWRAP AND GROUP WHAT IS DERIVABLE, REFUSE THE REST BY NAME.
 * Never coerce. A translator that guesses is worse than no translator,
 * because a guess ships as a working app that does something nobody asked
 * for.
 *
 * ⛔ WHAT IS NOT DERIVABLE, AND WHY THAT IS A PROPERTY OF THE INPUT.
 *
 * `@codegen`'s `propose` operation needs `proposalKind`, `ticketField`,
 * `fields` and `auditEvent`. A `@spec` route carries `id`, `method`, `path`,
 * `summary`, `kind` and `capabilities` — and NOTHING anywhere else in that
 * document names a field: `widgets` are `{id, title, kind: count|list}`,
 * `steps` carry a `kind` and no shape. So the fields of a proposal form
 * cannot be recovered from a `@spec` spec. They would have to be invented,
 * and inventing them means inventing what the app writes into the host's
 * inbox on someone's behalf.
 *
 * ⭐ OWNER RULING 2026-09-22 (8) CLOSES THIS WITHOUT INVENTING ANYTHING.
 * Proposing apps are generated only from a closed catalogue of proposal
 * templates the owner approved (`proposal-templates.ts`). A `@spec` propose
 * route names a template id — the only thing the model says about what a
 * proposal writes — and THIS is where that id becomes the template's
 * `proposalKind`, `ticketField`, `fields` and namespaced `auditEvent`. A
 * propose route that names no template, an unknown one, or one whose
 * approval does not hold (none, an unnamed approver, no real date, or
 * content changed since it was approved) is refused by name, and so is a
 * second route filing the same template. READ-ONLY MINI-APPS ARE UNCHANGED.
 */
import { CAPABILITY_SCOPES, type MiniAppSpec as CodegenSpec } from "../../codegen/src/spec-contract";
import type { MiniAppSpec as SpecSpec, SpecRoute } from "../../spec/src/schema";
import {
  PROPOSAL_TEMPLATES,
  approvedTemplateMenu,
  proposeOperation,
  resolveProposalTemplate,
  type ProposalTemplate,
  type TemplateResolution,
} from "./proposal-templates";

export interface TranslationRefusal {
  /** Where in the `@spec` document the problem is — a path, never a value. */
  readonly at: string;
  /** What `@codegen` needs that this document does not carry. */
  readonly needs: string;
}

export type Translation =
  | { readonly ok: true; readonly spec: CodegenSpec }
  | { readonly ok: false; readonly refusals: readonly TranslationRefusal[] };

type Operation = CodegenSpec["domains"][number]["routes"][number]["operation"];

/**
 * Which `@codegen` operation a `@spec` route means, or `null` when the route
 * names something this document cannot describe.
 *
 * Only two are derivable, and both are derivable EXACTLY — they take no
 * arguments, so there is nothing to invent:
 *
 *   read + `read:contracts`       → `list-contracts`
 *   read + `write:inbox-proposal` → `list-proposals`
 *
 * `list-rows` and `get-row` are absent on purpose: both name a `table`, and a
 * mini-app is database-free. A `propose` route is not derived here at all: it
 * is resolved through the approved template catalogue, in `translateSpec`.
 */
function operationFor(route: SpecRoute): Operation | null {
  if (route.kind !== "read") return null;
  if (route.capabilities.includes("read:contracts")) return { kind: "list-contracts" };
  if (route.capabilities.includes("write:inbox-proposal")) return { kind: "list-proposals" };
  return null;
}

/** What each template refusal needs, in words a person can act on. Never the
 * id the route named: that is model-written text, and a refusal names paths
 * and needs, not values. */
function templateNeeds(problem: Exclude<TemplateResolution, { ok: true }>["problem"], offered: string): string {
  switch (problem) {
    case "unknown-template":
      return `a proposal template from the approved catalogue (${offered}) — the one this route names is not in the approved catalogue`;
    case "unapproved":
      return "an approved proposal template — the one this route names has no approval record, and generation refuses an unapproved template";
    case "unnamed-approver":
      return "a proposal template approved by a named human — the approval on the one this route names does not name one";
    case "undated-approval":
      return "a proposal template whose approval carries a real ISO date — the one this route names has none";
    case "content-changed-since-approval":
      return "a re-approval — the proposal template this route names has changed since it was approved, so its approval no longer covers what it writes";
  }
}

/**
 * The domain a route belongs to: its FIRST path segment.
 *
 * Derived rather than chosen, so the same spec always produces the same file
 * layout — `@codegen` writes one `routes/<name>.ts` per domain, and a
 * grouping that depended on iteration order would rename files between runs.
 * A `:param` first segment has no name to take, and a bare `/` has no segment
 * at all; both are refused rather than bucketed under an invented name.
 */
function domainNameFor(path: string): string | null {
  const first = path.split("/").filter((s) => s.length > 0)[0];
  if (first === undefined || first.startsWith(":")) return null;
  return first;
}

/**
 * `catalogue` is a parameter so the refusals can be exercised against an
 * unapproved entry. Production passes none — `buildSubAppFromPrompt` calls
 * `translateSpec(spec)` — so the closed catalogue is the one that counts.
 */
export function translateSpec(
  source: SpecSpec,
  catalogue: readonly ProposalTemplate[] = PROPOSAL_TEMPLATES,
): Translation {
  const refusals: TranslationRefusal[] = [];
  const offered = approvedTemplateMenu(catalogue).map((choice) => choice.id).join(", ");
  const usedTemplates = new Set<string>();

  // ── What `@codegen`'s mini-app profile cannot emit at all ──────────────
  //
  // ⚠ REFUSED, NOT DROPPED. A mini-app is database-free, so `@codegen` has
  // nowhere to put a table; but a spec that declares one describes an app
  // that persists something, and quietly emitting the same app WITHOUT that
  // persistence is a different app with the same name. The planner should
  // not be emitting tables for this path — that is a fact about the planner,
  // and it belongs in a refusal a person reads, not in a silent deletion.
  if (source.tables.length > 0) {
    refusals.push({
      at: "tables",
      needs: `a database-free spec — the mini-app profile emits no schema, and this declares ${source.tables.length} table(s)`,
    });
  }

  // ⚠ THE SAME FIELD NAME, TWO DIFFERENT CONCEPTS — found by the compiler,
  // not by reading either schema.
  //
  //   @spec    settingsPanel: { tier: "ceiling" | "project" }
  //   @codegen settingsPanel: { tier: "workspace-admin" | "super-admin", label }
  //
  // @spec's `tier` is the APPROVALS vocabulary — which grant row governs this
  // app. @codegen's is WHO MAY OPEN THE PANEL. Neither value means anything
  // in the other's enum, and @codegen additionally needs a `label` that @spec
  // does not carry. A mapping here would be invention wearing a field name,
  // so a spec that asks for a settings panel is refused until one of the two
  // documents says which tier it means.
  if (source.settingsPanel !== null) {
    refusals.push({
      at: "settingsPanel",
      needs:
        '@codegen needs tier "workspace-admin" | "super-admin" and a label; @spec carries tier ' +
        `"${source.settingsPanel.tier}", which is the approvals vocabulary and names something else`,
    });
  }

  const domains = new Map<string, CodegenSpec["domains"][number]["routes"][number][]>();
  source.routes.forEach((route, index) => {
    const at = `routes[${index}]`;
    let operation: Operation | null;
    if (route.kind === "propose") {
      // ⭐ Owner ruling 2026-09-22 (8): the fields come from an approved
      // template, never from the route.
      if (route.template === undefined) {
        refusals.push({
          at: `${at}.template`,
          needs:
            offered === ""
              ? "an approved proposal template — none is approved, so no propose route can be generated (owner ruling 2026-09-22 (8))"
              : `an approved proposal template (one of: ${offered}) — the fields a proposal writes into the review inbox come from that template, never from the model (owner ruling 2026-09-22 (8))`,
        });
        return;
      }
      const resolved = resolveProposalTemplate(route.template, catalogue);
      if (!resolved.ok) {
        refusals.push({ at: `${at}.template`, needs: templateNeeds(resolved.problem, offered) });
        return;
      }
      if (usedTemplates.has(resolved.template.id)) {
        refusals.push({
          at: `${at}.template`,
          needs:
            "one route per proposal template — another route already files this one, and two routes sharing a template file proposals indistinguishable by filename (<app>-<kind>-<ticket>)",
        });
        return;
      }
      usedTemplates.add(resolved.template.id);
      operation = proposeOperation(resolved.template, source.id);
    } else {
      operation = operationFor(route);
    }
    if (operation === null) {
      refusals.push({
        at,
        needs: `a read route must declare read:contracts or write:inbox-proposal; this declares [${route.capabilities.join(", ")}]`,
      });
      return;
    }
    const name = domainNameFor(route.path);
    if (name === null) {
      refusals.push({
        at: `${at}.path`,
        needs: "a first path segment to name the domain file — @codegen writes one routes/<name>.ts per domain, and a bare / or a leading :param has no name to take",
      });
      return;
    }
    const routes = domains.get(name) ?? [];
    routes.push({ method: route.method, path: route.path, summary: route.summary, operation });
    domains.set(name, routes);
  });

  // A spec whose every route was refused would otherwise reach `@codegen`'s
  // `domains.min(1)` and come back as a schema error about a field this
  // translator is responsible for — the refusals above are the real reason.
  if (domains.size === 0 && refusals.length === 0) {
    refusals.push({ at: "routes", needs: "at least one route @codegen can emit" });
  }
  if (refusals.length > 0) return { ok: false, refusals };

  // ⭐ CAPABILITIES ARE INTERSECTED, NOT COPIED. Both packages spell the two
  // scopes identically today, and each keeps its own list on purpose. This
  // admits against @codegen's, so a scope @spec grows and @codegen has not
  // learned is refused by the parse below rather than carried into a manifest.
  const capabilities = source.capabilities.filter((c): c is (typeof CAPABILITY_SCOPES)[number] =>
    (CAPABILITY_SCOPES as readonly string[]).includes(c),
  );

  const spec: CodegenSpec = {
    id: source.id,
    label: source.label,
    version: source.version,
    icon: source.icon,
    navSection: source.navSection,
    // `purpose` is one sentence about what the app is for, which is exactly
    // what `summary` renders under the page title. @spec caps it at 280 and
    // @codegen at 300, so no truncation is possible and none is attempted.
    summary: source.purpose,
    capabilities,
    visibleToRoles: source.visibleToRoles,
    // Passed rather than defaulted, so the two packages' derivations must
    // AGREE: @codegen falls back to `id`, and if @spec's `derivationsFor`
    // ever stops matching, the parse fails here instead of the web loader
    // globbing a path that contributes nothing at mount time.
    webModuleId: source.derived.webModuleId,
    domains: [...domains.entries()].map(([name, routes]) => ({ name, routes })),
  };
  return { ok: true, spec };
}
