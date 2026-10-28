/** Widget contract (Phase 1, D1) — the descriptor a widget is declared by, the
 * declarative spec that lets one be authored as CONFIG rather than code, and
 * the layout document an admin's arrangement is stored as.
 *
 * Fail-loud Zod validation, deliberately mirroring `server/subapps/types.ts`
 * rather than `workspace/registry.ts`'s "adopt as is" leniency: a broken
 * descriptor must never load with a hole in RBAC or PII coverage. The same
 * reasoning applies twice as hard here, because unlike a sub-app manifest
 * (which ships in code and is reviewed) a widget descriptor can arrive from a
 * stored layout an admin edited at runtime.
 *
 * D1 gives a widget two possible bodies:
 *   - `declarative` — a named source + a JSON pointer + a view type. Works at
 *     runtime, no rebuild, safe to author from the UI.
 *   - `component`   — an ordinary `web/src/widgets/<id>.tsx` module, for what
 *     config genuinely cannot express. The escape hatch, not the default.
 *
 * ⚠ This module is imported by BOTH stacks. `web/src/subapps/{maps,advantage}`
 * already import types and pure helpers from `server/` by relative path, so
 * that is an established seam here — but it means nothing in this file may
 * import `node:*`, a Fastify type, or the db. It is pure schema.
 */
import { z } from "zod";

/** Same slug convention as `subapps/types.ts`'s SUBAPP_ID_RE. A widget id is a
 * LOCKED operational contract once shipped: stored layouts reference it, so
 * renaming one orphans every layout that placed it. */
const WIDGET_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** An instance id is generated per placement, not authored — the same widget
 * may appear twice on one surface with different config, so the INSTANCE is
 * what a layout keys on. */
const INSTANCE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// ───────────────────────────────────────────────────────────────────────────
// BOUNDARY 1 — a declarative widget names a SOURCE, never a URL.
// ───────────────────────────────────────────────────────────────────────────
/** The complete set of readers a declarative widget can reach. Each entry maps
 * to ONE already-existing, already-RBAC-filtered route (see
 * `web/src/widgets/sources.ts` for the client-side mapping), so a widget can
 * never widen what its viewer is permitted to see: if the caller cannot read
 * /api/ops, the widget renders its named "unavailable" state, not data.
 *
 * This being an enum rather than a string is the whole boundary. A
 * caller-supplied URL would make every stored layout a potential SSRF/exfil
 * vector authored through an admin UI. Do NOT widen this to accept a path.
 * Adding a source is a deliberate, reviewable act — the same discipline
 * `CAPABILITY_SCOPES` in subapps/types.ts is held to. */
export const WIDGET_SOURCES = [
  "state",
  "ops",
  "inbox",
  "contracts",
  "apps",
  "sessions",
  "processes",
] as const;
export type WidgetSource = (typeof WIDGET_SOURCES)[number];

// ───────────────────────────────────────────────────────────────────────────
// BOUNDARY 2 — the pointer is a restricted-charset path. No expressions.
// ───────────────────────────────────────────────────────────────────────────
/** A dotted/bracketed JSON pointer into the source response — `queueSummary.open`,
 * `items[0].ticket`. Restricted charset and bounded length ON PURPOSE: an
 * expression language here would be a code-execution surface reachable from a
 * config document that admins edit. There is no `eval`, no arithmetic, no
 * function call, and there never should be — if a widget needs computation,
 * that is precisely what the `component` escape hatch is for. */
const POINTER_RE = /^[A-Za-z0-9_.[\]-]+$/;
const pointer = z.string().min(1).max(120).regex(POINTER_RE, "path must be a plain dotted/bracketed pointer");
/** Same, but permitted to be empty — "the whole response". */
const pointerOrRoot = z.string().max(120).regex(/^[A-Za-z0-9_.[\]-]*$/, "path must be a plain dotted/bracketed pointer");

/** A click target. Constrained to this app's own console routes: an
 * unconstrained string would let a stored layout carry `javascript:` or an
 * off-site URL and turn every widget into an open redirect. */
const navigateTo = z
  .string()
  .max(200)
  .regex(/^\/console(\/[A-Za-z0-9\-_/]*)?(\?[A-Za-z0-9\-_=&%.]*)?$/, "navigateTo must be a /console route");

// ───────────────────────────────────────────────────────────────────────────
// BOUNDARY 3 — PII cannot be selected, and that is enforced here.
// ───────────────────────────────────────────────────────────────────────────
/** CLAUDE.md's data-handling rule: raw PII stays in the ticket's `input/`;
 * names are masked in digests and summaries; salary and address are NEVER
 * rendered in list/overview views. A widget IS an overview view.
 *
 * So a declarative widget must be *unable* to select those fields, rather than
 * relying on whoever authors one to remember the rule. A guardrail that
 * depends on the author remembering it is not a guardrail — and unlike the
 * hand-written pages this rule already governs, widget configs are authored at
 * runtime by admins, with no code review in the path.
 *
 * Two tiers, because the risks differ:
 *   SEGMENTS   — exact match on a normalized path segment. Used for fields
 *                whose NAME is generic enough that a substring test would
 *                produce false positives ("city" must not block "capacity").
 *   SUBSTRINGS — matched anywhere in the normalized path. Reserved for tokens
 *                that have no legitimate appearance in an overview at all.
 * `component` widgets are NOT filtered by this: they are code, they go through
 * review, and blocking them here would only push authors to work around it. */
export const PII_DENIED_SEGMENTS: readonly string[] = [
  "person",
  "personname",
  "employeename",
  "candidatename",
  "name",
  "firstname",
  "lastname",
  "surname",
  "email",
  "phone",
  "mobile",
  "dob",
  "street",
  "postcode",
  "zip",
  "city",
  "houseno",
  "housenumber",
];
export const PII_DENIED_SUBSTRINGS: readonly string[] = [
  "salary",
  "compensation",
  "address",
  "iban",
  "bankaccount",
  "ssn",
  "socialsecurity",
  "taxid",
  "birthdate",
  "dateofbirth",
];

/** Lowercase and strip everything that is not a letter or digit, so
 * `salary_eur`, `salaryEUR` and `salary-eur` all normalize alike. */
function normalize(part: string): string {
  return part.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The denied field name in `path`, or null when it is clean. Returns the
 * OFFENDING TOKEN rather than a boolean so the refusal can name it — a
 * "widget rejected" with no reason is the kind of error an admin works around
 * by guessing. Exported because both this module's schema and the layout-save
 * route need the same answer, and two copies would drift. */
export function deniedPiiField(path: string): string | null {
  const whole = normalize(path);
  for (const bad of PII_DENIED_SUBSTRINGS) {
    if (whole.includes(bad)) return bad;
  }
  for (const seg of path.split(/[.[\]]+/)) {
    if (!seg) continue;
    const n = normalize(seg);
    if (PII_DENIED_SEGMENTS.includes(n)) return n;
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// The declarative spec
// ───────────────────────────────────────────────────────────────────────────
const filterSchema = z.object({
  field: pointer,
  op: z.enum(["eq", "ne", "gt", "lt", "in"]),
  value: z.union([z.string().max(120), z.number(), z.boolean(), z.array(z.union([z.string().max(120), z.number()])).max(20)]),
});

/** The live (SSE) events a widget may declare as a refresh trigger.
 *
 * An allowlist rather than a free string, even though `useLive` itself takes
 * arbitrary names and an unknown name would simply never fire. Two reasons: a
 * silent no-op is the worst failure mode for a "keep this fresh" declaration,
 * and this list doubles as the documentation of what a config author can
 * actually react to. Every entry is an event some page already subscribes to.
 *
 * Widened only with an event the server genuinely publishes — check
 * `useLive([...])` call sites before adding one. */
export const WIDGET_LIVE_EVENTS = [
  "state.changed",
  "index.rebuilt",
  "contract.updated",
  "qc.updated",
  "eval.completed",
  "config.integrity-alarm",
  "kb.indexed",
] as const;
export type WidgetLiveEvent = (typeof WIDGET_LIVE_EVENTS)[number];

const sourceSchema = z.object({
  endpoint: z.enum(WIDGET_SOURCES),
  /** May be empty: "the whole response" is a legitimate selection for a view
   * that consumes an array (a list over GET /api/apps, say). */
  path: pointerOrRoot,
  filter: filterSchema.optional(),
  /** Bounded so one widget can never ask a page to render an unbounded list. */
  limit: z.number().int().min(1).max(100).optional(),
  /** Live events that re-read this source.
   *
   * Without this a widget was mount-fetch ONLY, which is fine for a palette
   * preview and wrong for a dashboard: the page it replaces subscribes to
   * `state.changed` / `index.rebuilt` / `contract.updated` / `qc.updated` /
   * `eval.completed` and deliberately does not refetch by hand anywhere,
   * because it relies on those. A widget without this therefore goes stale, and
   * worse, a "rebuild the index" action would leave its own divergence warning
   * on screen after the rebuild succeeded.
   *
   * Absent means mount-fetch, which stays the right default for static and
   * rarely-changing sources — subscribing everything to everything would make
   * one SSE event re-read every endpoint on the surface. */
  refreshOn: z.array(z.enum(WIDGET_LIVE_EVENTS)).max(6).optional(),
});

const tone = z.enum(["neutral", "green", "amber", "red"]);

/** A data-conditional tone rule. First match wins; see `toneWhen`. */
const toneRule = z.object({
  op: z.enum(["eq", "ne", "gt", "lt", "gte", "lte"]),
  value: z.union([z.number(), z.string().max(60), z.boolean()]),
  tone,
});

/** The view vocabulary. Deliberately small and closed — every entry here is a
 * renderer that has to exist on the web side, so this list growing is a code
 * change, not a config change. */
const viewSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("metric"),
    /** `count` renders the LENGTH of a selected array — stated explicitly
     * rather than letting `int` silently mean two things depending on what
     * the pointer happened to resolve to.
     *
     * There is deliberately no `duration`: nothing needs one yet, and a format
     * whose unit nobody has fixed (days? ms? seconds?) would be guessed
     * differently by the next author than by the renderer. Add it when a real
     * widget needs it, together with its unit. */
    format: z.enum(["int", "count", "usd", "pct", "text"]),
    /** The UNCONDITIONAL tone. Applies only when no `toneWhen` rule matches,
     * and — enforced in the renderer, not here — never when the value is
     * unknown. */
    tone: tone.optional(),
    /** Data-conditional tone, first match wins, falling back to `tone`.
     *
     * ⛔ THIS EXISTS TO CLOSE AN HONESTY HOLE, not for prettiness. `tone` alone
     * is taken verbatim from the descriptor and was applied to whatever the
     * view rendered — including the em-dash that means "we don't know". The
     * shipped `ops-open-gates` descriptor pinned `tone: "amber"`, so zero open
     * gates rendered amber where Dashboard.tsx renders green (0 gates is GOOD
     * news), and an unresolvable pointer rendered amber too. A colour is a
     * claim about the data; a static colour on an unknown value is a false one.
     *
     * Compared against the raw pointer value, except for `format: "count"`
     * where it is compared against the array's LENGTH — otherwise a rule would
     * be written against an array and never match anything.
     *
     * Bounded at 6: this is a threshold list, not a rules engine. Anything
     * needing more is a `component` widget. */
    toneWhen: z.array(toneRule).max(6).optional(),
    navigateTo: navigateTo.optional(),
  }),
  z.object({
    type: z.literal("list"),
    rowLabel: pointer,
    rowMeta: pointer.optional(),
    navigateTo: navigateTo.optional(),
  }),
  z.object({ type: z.literal("sparkline"), valueAt: pointer.optional() }),
  z.object({ type: z.literal("status"), okWhen: z.string().max(60).optional() }),
  z.object({ type: z.literal("actions"), rowLabel: pointer, targetAt: pointer.optional() }),
  /** Static content — the one view with no source read at all (its `source`
   * is still required by the schema but ignored; `endpoint: "state"` with an
   * empty path is the conventional filler). */
  z.object({ type: z.literal("markdown"), body: z.string().max(2000) }),
]);

export const declarativeSpecSchema = z
  .object({ source: sourceSchema, view: viewSchema })
  .superRefine((spec, ctx) => {
    // Every pointer a declarative widget can read through, checked in ONE
    // place. Missing one here is how PII reaches a rendered surface, so the
    // list is derived from the view union rather than spot-checked.
    const paths: Array<[string, string]> = [["source.path", spec.source.path]];
    if (spec.source.filter) paths.push(["source.filter.field", spec.source.filter.field]);
    const v = spec.view;
    if (v.type === "list" || v.type === "actions") {
      paths.push(["view.rowLabel", v.rowLabel]);
      if (v.type === "list" && v.rowMeta) paths.push(["view.rowMeta", v.rowMeta]);
      if (v.type === "actions" && v.targetAt) paths.push(["view.targetAt", v.targetAt]);
    }
    if (v.type === "sparkline" && v.valueAt) paths.push(["view.valueAt", v.valueAt]);
    for (const [where, p] of paths) {
      if (!p) continue;
      const bad = deniedPiiField(p);
      if (bad) {
        ctx.addIssue({
          code: "custom",
          path: where.split("."),
          message: `selects a PII-denied field (${bad}); a declarative widget may not render personal data`,
        });
      }
    }
  });
export type DeclarativeSpec = z.infer<typeof declarativeSpecSchema>;

// ───────────────────────────────────────────────────────────────────────────
// The descriptor
// ───────────────────────────────────────────────────────────────────────────
const widgetSize = z.object({
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(12),
});
export type WidgetSize = z.infer<typeof widgetSize>;

/** D6: two values only. The app has three real tiers (workspace → project →
 * process) but a widget is either available everywhere or belongs to one
 * project; workspace and process inherit from the project layer. Four-way
 * scope resolution is what produces permanent "why is my widget not showing"
 * tickets. */
export const WIDGET_SCOPES = ["global", "project"] as const;
export type WidgetScope = (typeof WIDGET_SCOPES)[number];

/** Mirrors `subapps/types.ts`'s WORKSPACE_ROLE_VALUES. Declared here rather
 * than imported so this module stays free of that file's Fastify/db imports
 * and remains safe for the web bundle; the "shell chrome role list" test
 * asserts the two stay identical. super_admin is an INSTANCE role and is
 * deliberately absent, same as there. */
export const WIDGET_ROLE_VALUES = ["hr_preparer", "hr_reviewer", "wc_liaison", "legal", "admin"] as const;
export type WidgetRole = (typeof WIDGET_ROLE_VALUES)[number];

/** Phase 67 plan 04 (E-01): the OS gained two roles (hrss_team_lead, hrss_manager) that are NOT widget or page roles. A role outside
 * WIDGET_ROLE_VALUES reads as `null`, which every caller already treats as deny (no palette, no pages, no media, no templates):
 * fail closed, never widened. This keeps the type and the behaviour the same as before the roles existed. */
export function asWidgetRole(role: string): WidgetRole | null {
  return (WIDGET_ROLE_VALUES as readonly string[]).includes(role) ? (role as WidgetRole) : null;
}

/** An instance-config version: an integer >= 1. Bounded only so a stored
 * layout cannot carry an absurd number; nothing counts up to it. */
const configVersion = z.number().int().min(1).max(1000);

export const widgetDescriptorSchema = z
  .object({
    id: z.string().regex(WIDGET_ID_RE),
    /** An i18n KEY, never display text — the `PAGES[].labelKey` convention.
     * A widget INSTANCE may additionally carry a free-text `title` (see
     * widgetInstanceSchema); that is user data and correctly untranslated.
     * Keeping the two fields separate is what lets the i18n coverage test
     * stay meaningful. */
    labelKey: z.string().min(1).max(80),
    icon: z.string().min(1).max(8),
    category: z.enum(["metric", "list", "chart", "status", "action", "content"]),
    scope: z.enum(WIDGET_SCOPES),
    defaultSize: widgetSize,
    minSize: widgetSize,
    maxSize: widgetSize.optional(),
    resizable: z.boolean(),
    /** REQUIRED and non-empty, exactly as `visibleToRoles` is for a sub-app
     * (APP-03 / Pitfall 5): a schema-valid widget can never produce zero
     * derived RBAC coverage, which is the GET-default-allow gap that rule
     * closes. Do not make this optional "for convenience". */
    visibleToRoles: z.array(z.enum(WIDGET_ROLE_VALUES)).min(1),
    /** sdk-31: the version of the instance `config` shape this widget reads.
     * Absent = 1. A component widget bumps it when its config shape changes,
     * and an instance stored under an older `v` is then REFUSED (named
     * "needs update", resettable) instead of being handed a blob the component
     * would misread. See `resolveInstanceConfig`. */
    configVersion: configVersion.optional(),
    render: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("declarative"), spec: declarativeSpecSchema }),
      z.object({ kind: z.literal("component"), webComponentId: z.string().min(1).max(64) }),
    ]),
    /** The config keys a page-doc widget block may carry for this widget
     * (pages-widget-containment). Absent means NONE — fail closed: a page doc
     * cannot hand a widget a key its descriptor never declared. The grid
     * layout's opaque `config` is not checked against it. */
    configKeys: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)).max(20).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.minSize.w > d.defaultSize.w || d.minSize.h > d.defaultSize.h) {
      ctx.addIssue({ code: "custom", path: ["minSize"], message: "minSize exceeds defaultSize" });
    }
    if (d.maxSize && (d.maxSize.w < d.defaultSize.w || d.maxSize.h < d.defaultSize.h)) {
      ctx.addIssue({ code: "custom", path: ["maxSize"], message: "maxSize is below defaultSize" });
    }
  });
export type WidgetDescriptor = z.infer<typeof widgetDescriptorSchema>;

// ───────────────────────────────────────────────────────────────────────────
// The layout document
// ───────────────────────────────────────────────────────────────────────────
/** The surfaces a layout can be stored for. `page:<slug>` covers the custom,
 * widget-only pages an admin composes (§1.6 of the spec) — validated by
 * `surfaceSchema` below rather than enumerated, since slugs are user data. */
export const UI_SURFACES = ["dashboard", "os-desktop", "rail", "start"] as const;
export type UiSurface = (typeof UI_SURFACES)[number];

const surfaceSchema = z.string().max(80).refine(
  (s) => (UI_SURFACES as readonly string[]).includes(s) || /^page:[a-z0-9][a-z0-9-]{0,40}$/.test(s),
  "surface must be a known surface or page:<slug>",
);

export const GRID_COLUMNS = 12;

export const widgetInstanceSchema = z
  .object({
    instanceId: z.string().regex(INSTANCE_ID_RE),
    widgetId: z.string().regex(WIDGET_ID_RE),
    x: z.number().int().min(0).max(GRID_COLUMNS - 1),
    y: z.number().int().min(0).max(199),
    w: z.number().int().min(1).max(GRID_COLUMNS),
    h: z.number().int().min(1).max(12),
    /** Free text typed by an admin. User data, deliberately untranslated. */
    title: z.string().max(80).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    /** sdk-31: the descriptor `configVersion` this `config` was written for.
     * Absent = 1, so every layout stored before this field existed reads as
     * v1 and is unchanged. Never defaulted in the schema: a parsed layout must
     * round-trip byte for byte. */
    v: configVersion.optional(),
  })
  .superRefine((i, ctx) => {
    if (i.x + i.w > GRID_COLUMNS) {
      ctx.addIssue({
        code: "custom",
        path: ["w"],
        message: `x+w must not exceed the ${GRID_COLUMNS}-column grid`,
      });
    }
  });
export type WidgetInstance = z.infer<typeof widgetInstanceSchema>;

/** sdk-31: what the host may do with an instance's stored config.
 *
 * `ok` is the ONLY outcome that carries a config. The two refusals carry none
 * on purpose, so no caller can hand a mismatched blob to a component by
 * accident. There are no code-defined migrations: an older config is not
 * translated, it is offered a reset (`resetInstanceConfig`); a newer one was
 * written by a build this one does not understand and is left untouched. */
export type InstanceConfigResolution =
  | { state: "ok"; config: Record<string, unknown> }
  | { state: "needs-update"; have: number; want: number }
  | { state: "unsupported-future"; have: number; want: number };

export function resolveInstanceConfig(
  desc: Pick<WidgetDescriptor, "configVersion">,
  inst: Pick<WidgetInstance, "v" | "config">,
): InstanceConfigResolution {
  const want = desc.configVersion ?? 1;
  const have = inst.v ?? 1;
  if (have < want) return { state: "needs-update", have, want };
  if (have > want) return { state: "unsupported-future", have, want };
  return { state: "ok", config: inst.config ?? {} };
}

/** "Reset to defaults": the instance without its config, stamped with the
 * descriptor's version (omitted when that is 1, the absent default). Geometry
 * and the admin's title are kept — only the config is the component's. */
export function resetInstanceConfig(
  desc: Pick<WidgetDescriptor, "configVersion">,
  inst: WidgetInstance,
): WidgetInstance {
  const { config: _config, v: _v, ...rest } = inst;
  const want = desc.configVersion ?? 1;
  return want > 1 ? { ...rest, v: want } : rest;
}

export const layoutDocSchema = z
  .object({
    /** Pinned literal, not a number: a document written by a future version
     * must be REFUSED loudly rather than half-read by this one. */
    version: z.literal(1),
    surface: surfaceSchema,
    widgets: z.array(widgetInstanceSchema).max(60),
  })
  .superRefine((doc, ctx) => {
    const seen = new Set<string>();
    for (const w of doc.widgets) {
      if (seen.has(w.instanceId)) {
        ctx.addIssue({
          code: "custom",
          path: ["widgets"],
          message: `duplicate instanceId ${w.instanceId}`,
        });
      }
      seen.add(w.instanceId);
    }
  });
export type LayoutDoc = z.infer<typeof layoutDocSchema>;

/** Which tier a stored layout belongs to. `global` is the shipped/instance
 * default a super_admin edits; `project` is the per-project layout a
 * workspace admin edits. Mirrors WIDGET_SCOPES deliberately — a project-scoped
 * widget can only ever be placed on a project-scoped layout, and
 * `assertPlaceable` below is the one place that is enforced. */
export const LAYOUT_TIERS = ["global", "project"] as const;
export type LayoutTier = (typeof LAYOUT_TIERS)[number];

/** The D6 containment rule, in one function so the route and the store cannot
 * disagree: a project widget must not leak onto the global default, because
 * that default is what every OTHER project falls back to. */
export function assertPlaceable(
  /** Only the widget ids are read, so a page doc's widget blocks
   * (server/pagedoc/containment.ts) go through this same rule unchanged. */
  doc: { widgets: ReadonlyArray<{ widgetId: string }> },
  tier: LayoutTier,
  descriptorFor: (widgetId: string) => WidgetDescriptor | undefined,
): { ok: true } | { ok: false; error: string } {
  for (const w of doc.widgets) {
    const d = descriptorFor(w.widgetId);
    if (!d) return { ok: false, error: `unknown widget ${w.widgetId}` };
    if (tier === "global" && d.scope === "project") {
      return { ok: false, error: `widget ${w.widgetId} is project-scoped and cannot sit on the global default` };
    }
  }
  return { ok: true };
}
