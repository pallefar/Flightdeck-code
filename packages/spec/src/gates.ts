/**
 * The gates: a pure, synchronous function from a model draft to an outcome.
 *
 * This is where "do not guess" stops being a prompt instruction and becomes a property of
 * the system. Nothing here calls a model, reads a clock or touches the network, so every rule
 * below is directly testable - and a model that ignores its instructions cannot get past it.
 *
 * The governing asymmetry:
 *
 *   Narrowing is free.  Dropping an unused scope, a route whose scope was refused, or a widget
 *                       we cannot render needs no permission - it can only reduce what the
 *                       generated app may do. We do it and record a warning.
 *   Widening always asks. A capability, a role or a nav section that is not in the user's own
 *                       words becomes a clarifying question, never a default. A guessed
 *                       capability is a consent violation: the capabilities array *is* the
 *                       screen a human signs (contract §5.9).
 */

import {
  CAPABILITIES,
  HOST_VERSION,
  MAX_LOGICAL_TABLE_NAME_LENGTH,
  MAX_TABLE_NAME_LENGTH,
  SUBAPP_ID_PATTERN,
  derivationsFor,
  isCapability,
  isRole,
  normalizeNavSection,
  tablePrefixFor,
} from "./vocabulary";
import type { Capability, NavSection, Role } from "./vocabulary";
import { normalizeForMatch, quoteIsGrounded, slugify, snakeify } from "./text";
import { formatIssues, iconSchema, labelSchema, miniAppSpecSchema, routePathSchema } from "./schema";
import type { MiniAppSpec, SpecRoute, SpecTable, SpecTableColumn, SpecWidget } from "./schema";
import type { DraftRoute, PlannerDraft } from "./draft";
import {
  capabilityConsentQuestion,
  idCollisionQuestion,
  missingFieldQuestion,
  modelRaisedQuestion,
  navSectionQuestion,
  orderQuestions,
  proposalTemplateQuestion,
  rolesQuestion,
  unknownCapabilityQuestion,
} from "./questions";
import type { ProposalTemplateChoice } from "./templates";
import type { ClarifyingQuestion, SpecField } from "./questions";
import type { PlanOutcome, PlanWarning, WarningCode } from "./outcome";

export interface GateContext {
  /** The user's original words. The primary consent source. */
  readonly prompt: string;
  /** Answers to earlier clarifying questions, keyed by `ClarifyingQuestion.id`. */
  readonly answers: Readonly<Record<string, string>>;
  /** Ids already shipped - an id is locked once shipped, so a collision must be asked about. */
  readonly existingSubAppIds: readonly string[];
  readonly hostVersion: string;
  /** Version stamped on the generated manifest. */
  readonly appVersion: string;
  /**
   * The approved proposal templates a propose route may name (owner ruling 2026-09-22 (8)).
   * Supplied by the caller - `@pipeline` passes the approved catalogue's menu - and absent
   * means empty: a planner that was offered nothing admits no propose route at all.
   */
  readonly proposalTemplates?: readonly ProposalTemplateChoice[];
}

export const DEFAULT_APP_VERSION = "0.1.0";

const SPEC_FIELDS: readonly SpecField[] = [
  "id",
  "label",
  "icon",
  "navSection",
  "purpose",
  "visibleToRoles",
  "capabilities",
  "routes",
  "tables",
];

const AFFIRMATIVE =
  /^\s*["\u2018\u2019\u201c\u201d']?\s*(y|yes|yep|yeah|sure|ok|okay|fine|grant|granted|approve|approved|allow|allowed|confirm|confirmed|go ahead|do it)\b/i;
const NEGATIVE =
  /^\s*["\u2018\u2019\u201c\u201d']?\s*(n|no|nope|never|deny|denied|reject|rejected|don'?t|do not|must not|remove|drop|without)\b/i;

const COLUMN_TYPE_ALIASES: Readonly<Record<string, SpecTableColumn["type"]>> = {
  text: "text",
  string: "text",
  varchar: "text",
  char: "text",
  uuid: "text",
  date: "timestamptz",
  datetime: "timestamptz",
  timestamp: "timestamptz",
  timestamptz: "timestamptz",
  int: "integer",
  integer: "integer",
  number: "integer",
  numeric: "integer",
  bigint: "integer",
  bool: "boolean",
  boolean: "boolean",
  json: "jsonb",
  jsonb: "jsonb",
  object: "jsonb",
};

interface ConsentAnswers {
  readonly granted: ReadonlySet<Capability>;
  readonly denied: ReadonlySet<Capability>;
  /** Answers safe to quote as evidence - denials are excluded so a "no" cannot ground a "yes". */
  readonly quotableSources: readonly string[];
}

/** Reads `answers` for replies to capability consent questions. Ambiguous replies grant nothing. */
export function readConsentAnswers(answers: Readonly<Record<string, string>>): ConsentAnswers {
  const granted = new Set<Capability>();
  const denied = new Set<Capability>();
  const quotable: string[] = [];

  for (const [key, value] of Object.entries(answers)) {
    if (typeof value !== "string" || value.trim() === "") {
      continue;
    }
    if (key.startsWith("consent:")) {
      const capability = key.slice("consent:".length);
      if (!isCapability(capability)) {
        continue;
      }
      if (NEGATIVE.test(value)) {
        denied.add(capability);
        continue; // a refusal never becomes quotable evidence
      }
      if (AFFIRMATIVE.test(value)) {
        granted.add(capability);
      }
      quotable.push(value);
      continue;
    }
    quotable.push(value);
  }

  return { granted, denied, quotableSources: quotable };
}

const sortCapabilities = (values: Iterable<Capability>): Capability[] =>
  [...new Set(values)].sort((a, b) => CAPABILITIES.indexOf(a) - CAPABILITIES.indexOf(b));

/** A role counts as consented when the user named it, in the prompt or in an answer. */
function roleNamedIn(role: Role, sources: readonly string[]): boolean {
  const needle = normalizeForMatch(role);
  return sources.some((source) => normalizeForMatch(source).includes(needle));
}

/**
 * Mechanical repairs only: drop a route prefix the model repeated, collapse slashes, slug a
 * segment the model wrote as prose. A segment that survives none of that - `..`, punctuation,
 * an empty `:param` - returns null so the caller asks instead of inventing a different route.
 */
function normalizeRoutePath(raw: string): string | null {
  const stripped = raw
    .trim()
    .replace(/^\/api\/apps\/[a-z0-9-]+/i, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");
  if (stripped === "") {
    return "/";
  }

  const parts = stripped.split("/");
  const segments = parts[0] === "" ? parts.slice(1) : parts;
  const normalized: string[] = [];

  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      return null;
    }
    if (segment.startsWith(":")) {
      const param = segment.slice(1).replace(/[^A-Za-z0-9]/g, "");
      if (param === "" || /^[0-9]/.test(param)) {
        return null;
      }
      normalized.push(`:${param.charAt(0).toLowerCase()}${param.slice(1)}`);
      continue;
    }
    const slug = slugify(segment);
    if (slug === "") {
      return null;
    }
    normalized.push(slug);
  }

  const path = `/${normalized.join("/")}`;
  return routePathSchema.safeParse(path).success ? path : null;
}

interface NormalizedRoute {
  readonly route: SpecRoute;
  readonly requested: readonly Capability[];
}

/**
 * The proposal template a propose route names, trimmed; `null` for none. Matched against the
 * menu by exact equality - the catalogue is literal, like the host, so a near-miss spelling
 * is a question rather than a correction.
 */
function templateOf(route: DraftRoute): string | null {
  const template = route.template?.trim() ?? "";
  return template === "" ? null : template;
}

/**
 * Turns a model draft into a spec, a set of questions, or a refusal. Pure and synchronous.
 */
export function evaluateDraft(draft: PlannerDraft, context: GateContext): PlanOutcome {
  const understanding = draft.understanding.trim();
  const consent = readConsentAnswers(context.answers);
  const consentSources = [context.prompt, ...consent.quotableSources];

  if (draft.blocked) {
    return {
      status: "blocked",
      rule: draft.blocked.rule,
      explanation: draft.blocked.explanation.trim(),
      evidence: draft.blocked.evidence.trim(),
      evidenceGrounded: quoteIsGrounded(draft.blocked.evidence, [context.prompt]),
      contractRule:
        draft.blocked.rule === "propose-not-mutate"
          ? "contract §5.7 - a mini app may propose, never auto-advance or resolve a gated or statutory step"
          : "contract §5 - the request cannot be built inside the sub-app contract",
      understanding,
    };
  }

  const questions: ClarifyingQuestion[] = [];
  const warnings: PlanWarning[] = [];
  const warn = (code: WarningCode, message: string): void => {
    warnings.push({ code, message });
  };

  const body = draft.spec;

  // --- questions the model raised itself -------------------------------------------------
  for (const clarification of draft.clarifications) {
    const field = SPEC_FIELDS.find((candidate) => candidate === clarification.field.trim());
    if (!field) {
      warn(
        "clarification-unknown-field",
        `dropped a model question about "${clarification.field}", which is not a spec field`,
      );
      continue;
    }
    questions.push(modelRaisedQuestion(field, clarification.question, clarification.options));
  }

  // --- id ---------------------------------------------------------------------------------
  let id: string | null = null;
  const rawId = body.id?.trim() ?? "";
  if (rawId === "") {
    questions.push(
      missingFieldQuestion(
        "id",
        "What should this mini app's id be (lowercase and hyphenated, for example works-council-gaps)?",
        "idLocked",
      ),
    );
  } else {
    const candidate = SUBAPP_ID_PATTERN.test(rawId) ? rawId : slugify(rawId);
    if (candidate !== rawId) {
      warn("id-normalized", `normalized id "${rawId}" to "${candidate}"`);
    }
    if (candidate.length < 3 || !SUBAPP_ID_PATTERN.test(candidate)) {
      questions.push(
        missingFieldQuestion(
          "id",
          `"${rawId}" cannot be a sub-app id - what lowercase, hyphenated id should it have?`,
          "idLocked",
        ),
      );
    } else if (context.existingSubAppIds.includes(candidate)) {
      questions.push(idCollisionQuestion(candidate));
    } else {
      id = candidate;
    }
  }

  // --- label, icon, purpose ---------------------------------------------------------------
  const label = body.label?.trim() ?? "";
  if (label === "") {
    questions.push(
      missingFieldQuestion("label", "What should this mini app be called in the nav?", "failLoud"),
    );
  } else if (!labelSchema.safeParse(label).success) {
    questions.push(
      missingFieldQuestion(
        "label",
        `"${label}" cannot be the nav label - it is rendered verbatim, so what should it read?`,
        "failLoud",
      ),
    );
  }

  const icon = body.icon?.trim() ?? "";
  if (icon === "") {
    questions.push(
      missingFieldQuestion("icon", "Which emoji should this mini app use as its icon?", "failLoud"),
    );
  } else if (!iconSchema.safeParse(icon).success) {
    questions.push(
      missingFieldQuestion(
        "icon",
        `"${icon}" is not an emoji - which emoji should this mini app use as its icon?`,
        "failLoud",
      ),
    );
  }

  let purpose = body.purpose?.trim() ?? "";
  if (purpose === "" && understanding !== "") {
    purpose = understanding;
    warn("purpose-from-understanding", "used the restated goal as the purpose line");
  }
  if (purpose === "") {
    questions.push(
      missingFieldQuestion("purpose", "In one sentence, what should this mini app do?", "failLoud"),
    );
  }

  // --- nav section ------------------------------------------------------------------------
  let navSection: NavSection | null = null;
  const rawNav = body.navSection?.trim() ?? "";
  if (rawNav === "") {
    questions.push(navSectionQuestion(null));
  } else {
    const normalized = normalizeNavSection(rawNav);
    if (!normalized) {
      questions.push(navSectionQuestion(rawNav));
    } else {
      if (normalized !== rawNav) {
        warn("nav-section-normalized", `matched nav section "${rawNav}" to "${normalized}"`);
      }
      navSection = normalized;
    }
  }

  // --- visibleToRoles ---------------------------------------------------------------------
  let visibleToRoles: Role[] = [];
  const rawRoles = [...new Set(body.visibleToRoles?.roles.map((role) => role.trim()).filter(Boolean) ?? [])];
  if (rawRoles.length === 0) {
    questions.push(rolesQuestion([]));
  } else if (!rawRoles.every(isRole)) {
    questions.push(rolesQuestion(rawRoles));
  } else {
    const roles = rawRoles.filter(isRole);
    const evidence = body.visibleToRoles?.evidence ?? null;
    const grounded =
      (evidence !== null && quoteIsGrounded(evidence, consentSources)) ||
      roles.every((role) => roleNamedIn(role, consentSources));
    if (!grounded) {
      // Who sees HR data is a disclosure decision; an unquoted audience is a guess.
      questions.push(rolesQuestion([]));
    } else {
      visibleToRoles = roles;
    }
  }

  // --- capabilities: consent ---------------------------------------------------------------
  const consented = new Set<Capability>();
  for (const claim of body.capabilities) {
    const capability = claim.capability.trim();
    if (!isCapability(capability)) {
      questions.push(unknownCapabilityQuestion(capability));
      continue;
    }
    if (consent.denied.has(capability)) {
      continue;
    }
    if (consent.granted.has(capability) || quoteIsGrounded(claim.evidence, consentSources)) {
      consented.add(capability);
      continue;
    }
    questions.push(
      capabilityConsentQuestion(
        capability,
        `The request does not say the app may ${capability === "read:contracts" ? "read contract records" : "write into the review inbox"}, and no quote from it backs that scope.`,
      ),
    );
  }
  for (const capability of consent.granted) {
    consented.add(capability);
  }

  // --- routes -------------------------------------------------------------------------------
  const normalizedRoutes: NormalizedRoute[] = [];
  const usedRouteIds = new Set<string>();
  const seenEndpoints = new Set<string>();

  for (const draftRoute of body.routes) {
    const path = normalizeRoutePath(draftRoute.path);
    if (path === null) {
      questions.push(
        missingFieldQuestion(
          "routes",
          `Route "${draftRoute.summary.trim() || draftRoute.path}" has a path I cannot use ("${draftRoute.path}") - what path below the route prefix should it answer on?`,
          "failLoud",
        ),
      );
      continue;
    }

    const endpoint = `${draftRoute.method} ${path}`;
    if (seenEndpoints.has(endpoint)) {
      warn("route-dropped", `dropped a duplicate route for ${endpoint}`);
      continue;
    }
    seenEndpoints.add(endpoint);

    const requested = new Set<Capability>();
    let unknownCapability = false;
    for (const raw of draftRoute.capabilities) {
      const capability = raw.trim();
      if (!isCapability(capability)) {
        questions.push(unknownCapabilityQuestion(capability));
        unknownCapability = true;
        continue;
      }
      requested.add(capability);
    }
    if (draftRoute.kind === "propose") {
      requested.add("write:inbox-proposal");
    }
    if (draftRoute.kind === "read" && requested.delete("write:inbox-proposal")) {
      warn(
        "route-write-scope-stripped",
        `route "${draftRoute.summary.trim()}" is read-only, so write:inbox-proposal was removed from it`,
      );
    }
    if (unknownCapability) {
      continue;
    }

    const template = templateOf(draftRoute);
    if (draftRoute.kind === "read" && template !== null) {
      warn(
        "route-template-stripped",
        `route "${draftRoute.summary.trim()}" is read-only, so its proposal template was removed - only a propose route files one`,
      );
    }

    const summary = draftRoute.summary.trim() || `${draftRoute.method} ${path}`;
    let routeId = slugify(draftRoute.id ?? summary) || slugify(`${draftRoute.method}${path}`);
    if (routeId === "") {
      routeId = `route-${normalizedRoutes.length + 1}`;
    }
    routeId = routeId.slice(0, 48).replace(/-$/, "");
    if (usedRouteIds.has(routeId)) {
      let suffix = 2;
      while (usedRouteIds.has(`${routeId}-${suffix}`)) {
        suffix += 1;
      }
      routeId = `${routeId}-${suffix}`;
    }
    usedRouteIds.add(routeId);

    normalizedRoutes.push({
      route: {
        id: routeId,
        method: draftRoute.method,
        path,
        summary: summary.slice(0, 160),
        kind: draftRoute.kind,
        capabilities: sortCapabilities(requested),
        ...(draftRoute.kind === "propose" && template !== null ? { template } : {}),
      },
      requested: sortCapabilities(requested),
    });
  }

  // --- capabilities: what the routes actually need ------------------------------------------
  const menu = context.proposalTemplates ?? [];
  const keptRoutes: SpecRoute[] = [];
  for (const entry of normalizedRoutes) {
    const refused = entry.requested.filter((capability) => consent.denied.has(capability));
    if (refused.length > 0) {
      warn(
        "route-dropped",
        `dropped route "${entry.route.summary}" because consent for ${refused.join(", ")} was declined`,
      );
      continue;
    }
    const missing = entry.requested.filter((capability) => !consented.has(capability));
    for (const capability of missing) {
      questions.push(
        capabilityConsentQuestion(
          capability,
          `Route "${entry.route.summary}" (${entry.route.method} ${entry.route.path}) would need a scope the request never granted.`,
        ),
      );
    }
    // Owner ruling 2026-09-22 (8): what a proposal writes comes from an approved template,
    // and only the menu the caller offered counts as approved. Asked AFTER the declined-
    // consent drop above, so a route that is not going to exist is not asked about.
    if (entry.route.kind === "propose") {
      const template = entry.route.template;
      if (template === undefined || !menu.some((choice) => choice.id === template)) {
        questions.push(proposalTemplateQuestion(entry.route.id, entry.route.summary, menu));
      }
    }
    keptRoutes.push(entry.route);
  }

  for (const capability of consent.denied) {
    warn("capability-denied", `did not declare ${capability}: consent was declined`);
  }

  const required = new Set<Capability>();
  for (const route of keptRoutes) {
    for (const capability of route.capabilities) {
      required.add(capability);
    }
  }
  for (const capability of consented) {
    if (!required.has(capability)) {
      warn(
        "capability-unused",
        `dropped ${capability}: no route uses it, and the manifest declares the narrowest set (contract §5.9)`,
      );
    }
  }
  const capabilities = sortCapabilities([...required].filter((capability) => consented.has(capability)));

  if (keptRoutes.length === 0 && !questions.some((question) => question.field === "routes")) {
    questions.push(
      missingFieldQuestion(
        "routes",
        "What should the first screen of this mini app show or do?",
        "failLoud",
      ),
    );
  }

  // --- tables -------------------------------------------------------------------------------
  const tables: SpecTable[] = [];
  if (id !== null) {
    const prefix = tablePrefixFor(id);
    const usedTableNames = new Set<string>();
    for (const draftTable of body.tables) {
      let name = snakeify(draftTable.name).replace(/^_+|_+$/g, "");
      if (name === "" || /^[0-9]/.test(name)) {
        warn("table-dropped", `dropped table "${draftTable.name}": not a usable identifier`);
        continue;
      }
      const budget = Math.min(MAX_LOGICAL_TABLE_NAME_LENGTH, MAX_TABLE_NAME_LENGTH - prefix.length);
      if (name.length > budget) {
        const truncated = name.slice(0, Math.max(1, budget)).replace(/_+$/, "");
        warn("table-name-truncated", `shortened table "${name}" to "${truncated}" to fit Postgres identifiers`);
        name = truncated;
      }
      if (usedTableNames.has(name)) {
        warn("table-dropped", `dropped duplicate table "${name}"`);
        continue;
      }

      const columns: SpecTableColumn[] = [];
      const usedColumnNames = new Set<string>();
      for (const draftColumn of draftTable.columns) {
        const columnName = snakeify(draftColumn.name).replace(/^_+|_+$/g, "");
        if (columnName === "" || /^[0-9]/.test(columnName) || usedColumnNames.has(columnName)) {
          continue;
        }
        usedColumnNames.add(columnName);
        const alias = COLUMN_TYPE_ALIASES[draftColumn.type.trim().toLowerCase()];
        if (!alias) {
          warn(
            "column-type-defaulted",
            `stored ${name}.${columnName} as text: "${draftColumn.type}" is not a type the generator emits`,
          );
        }
        columns.push({
          name: columnName,
          type: alias ?? "text",
          nullable: draftColumn.nullable,
          pii: draftColumn.pii,
        });
      }
      if (columns.length === 0) {
        warn("table-dropped", `dropped table "${name}": it declared no usable columns`);
        continue;
      }

      usedTableNames.add(name);
      tables.push({
        name,
        fullName: `${prefix}${name}`,
        purpose: draftTable.purpose.trim().slice(0, 160) || `Working data for ${name}.`,
        columns,
      });
    }
  }

  // --- widgets --------------------------------------------------------------------------------
  const widgets: SpecWidget[] = [];
  const usedWidgetIds = new Set<string>();
  for (const draftWidget of body.widgets) {
    const kind = draftWidget.kind.trim().toLowerCase();
    if (kind !== "count" && kind !== "list") {
      warn("widget-dropped", `dropped widget "${draftWidget.title}": unsupported kind "${draftWidget.kind}"`);
      continue;
    }
    const title = draftWidget.title.trim();
    const widgetId = slugify(draftWidget.id ?? title).slice(0, 48).replace(/-$/, "");
    if (title === "" || widgetId === "" || usedWidgetIds.has(widgetId)) {
      warn("widget-dropped", `dropped widget "${draftWidget.title}": missing or duplicate identity`);
      continue;
    }
    usedWidgetIds.add(widgetId);
    widgets.push({ id: widgetId, title: title.slice(0, 64), kind });
  }

  // --- decide ---------------------------------------------------------------------------------
  if (questions.length > 0) {
    return {
      status: "needs_input",
      questions: orderQuestions(questions),
      understanding,
      warnings,
      draft,
    };
  }

  if (id === null || navSection === null) {
    // Unreachable: both paths above push a question. Fail loudly rather than emit half a spec.
    return {
      status: "invalid_draft",
      issues: ["internal: a required field was missing but no question was raised"],
      raw: null,
      attempts: 1,
    };
  }

  const candidate: MiniAppSpec = {
    specVersion: 1,
    id,
    label,
    version: context.appVersion,
    minHostVersion: context.hostVersion,
    icon,
    navSection,
    purpose,
    sourcePrompt: context.prompt,
    capabilities,
    visibleToRoles,
    derived: derivationsFor(id),
    routes: keptRoutes,
    tables,
    widgets,
    settingsPanel: body.settingsPanel,
  };

  const parsed = miniAppSpecSchema.safeParse(candidate);
  if (!parsed.success) {
    return { status: "invalid_draft", issues: formatIssues(parsed.error), raw: null, attempts: 1 };
  }

  return { status: "planned", spec: parsed.data, understanding, warnings };
}

export const defaultGateContext = (prompt: string): GateContext => ({
  prompt,
  answers: {},
  existingSubAppIds: [],
  hostVersion: HOST_VERSION,
  appVersion: DEFAULT_APP_VERSION,
});
