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
import { z } from "../../../../../vendor/zod/index.js";
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
export declare const WIDGET_SOURCES: readonly ["state", "ops", "inbox", "contracts", "apps", "sessions", "processes"];
export type WidgetSource = (typeof WIDGET_SOURCES)[number];
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
export declare const PII_DENIED_SEGMENTS: readonly string[];
export declare const PII_DENIED_SUBSTRINGS: readonly string[];
/** The denied field name in `path`, or null when it is clean. Returns the
 * OFFENDING TOKEN rather than a boolean so the refusal can name it — a
 * "widget rejected" with no reason is the kind of error an admin works around
 * by guessing. Exported because both this module's schema and the layout-save
 * route need the same answer, and two copies would drift. */
export declare function deniedPiiField(path: string): string | null;
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
export declare const WIDGET_LIVE_EVENTS: readonly ["state.changed", "index.rebuilt", "contract.updated", "qc.updated", "eval.completed", "config.integrity-alarm", "kb.indexed"];
export type WidgetLiveEvent = (typeof WIDGET_LIVE_EVENTS)[number];
export declare const declarativeSpecSchema: z.ZodEffects<z.ZodObject<{
    source: z.ZodObject<{
        endpoint: z.ZodEnum<["state", "ops", "inbox", "contracts", "apps", "sessions", "processes"]>;
        /** May be empty: "the whole response" is a legitimate selection for a view
         * that consumes an array (a list over GET /api/apps, say). */
        path: z.ZodString;
        filter: z.ZodOptional<z.ZodObject<{
            field: z.ZodString;
            op: z.ZodEnum<["eq", "ne", "gt", "lt", "in"]>;
            value: z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber]>, "many">]>;
        }, "strip", z.ZodTypeAny, {
            value: string | number | boolean | (string | number)[];
            field: string;
            op: "in" | "eq" | "ne" | "gt" | "lt";
        }, {
            value: string | number | boolean | (string | number)[];
            field: string;
            op: "in" | "eq" | "ne" | "gt" | "lt";
        }>>;
        /** Bounded so one widget can never ask a page to render an unbounded list. */
        limit: z.ZodOptional<z.ZodNumber>;
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
        refreshOn: z.ZodOptional<z.ZodArray<z.ZodEnum<["state.changed", "index.rebuilt", "contract.updated", "qc.updated", "eval.completed", "config.integrity-alarm", "kb.indexed"]>, "many">>;
    }, "strip", z.ZodTypeAny, {
        path: string;
        endpoint: "state" | "ops" | "inbox" | "contracts" | "apps" | "sessions" | "processes";
        filter?: {
            value: string | number | boolean | (string | number)[];
            field: string;
            op: "in" | "eq" | "ne" | "gt" | "lt";
        } | undefined;
        limit?: number | undefined;
        refreshOn?: ("state.changed" | "index.rebuilt" | "contract.updated" | "qc.updated" | "eval.completed" | "config.integrity-alarm" | "kb.indexed")[] | undefined;
    }, {
        path: string;
        endpoint: "state" | "ops" | "inbox" | "contracts" | "apps" | "sessions" | "processes";
        filter?: {
            value: string | number | boolean | (string | number)[];
            field: string;
            op: "in" | "eq" | "ne" | "gt" | "lt";
        } | undefined;
        limit?: number | undefined;
        refreshOn?: ("state.changed" | "index.rebuilt" | "contract.updated" | "qc.updated" | "eval.completed" | "config.integrity-alarm" | "kb.indexed")[] | undefined;
    }>;
    view: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"metric">;
        /** `count` renders the LENGTH of a selected array — stated explicitly
         * rather than letting `int` silently mean two things depending on what
         * the pointer happened to resolve to.
         *
         * There is deliberately no `duration`: nothing needs one yet, and a format
         * whose unit nobody has fixed (days? ms? seconds?) would be guessed
         * differently by the next author than by the renderer. Add it when a real
         * widget needs it, together with its unit. */
        format: z.ZodEnum<["int", "count", "usd", "pct", "text"]>;
        /** The UNCONDITIONAL tone. Applies only when no `toneWhen` rule matches,
         * and — enforced in the renderer, not here — never when the value is
         * unknown. */
        tone: z.ZodOptional<z.ZodEnum<["neutral", "green", "amber", "red"]>>;
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
        toneWhen: z.ZodOptional<z.ZodArray<z.ZodObject<{
            op: z.ZodEnum<["eq", "ne", "gt", "lt", "gte", "lte"]>;
            value: z.ZodUnion<[z.ZodNumber, z.ZodString, z.ZodBoolean]>;
            tone: z.ZodEnum<["neutral", "green", "amber", "red"]>;
        }, "strip", z.ZodTypeAny, {
            tone: "green" | "red" | "amber" | "neutral";
            value: string | number | boolean;
            op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
        }, {
            tone: "green" | "red" | "amber" | "neutral";
            value: string | number | boolean;
            op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
        }>, "many">>;
        navigateTo: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "metric";
        format: "text" | "int" | "count" | "usd" | "pct";
        tone?: "green" | "red" | "amber" | "neutral" | undefined;
        toneWhen?: {
            tone: "green" | "red" | "amber" | "neutral";
            value: string | number | boolean;
            op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
        }[] | undefined;
        navigateTo?: string | undefined;
    }, {
        type: "metric";
        format: "text" | "int" | "count" | "usd" | "pct";
        tone?: "green" | "red" | "amber" | "neutral" | undefined;
        toneWhen?: {
            tone: "green" | "red" | "amber" | "neutral";
            value: string | number | boolean;
            op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
        }[] | undefined;
        navigateTo?: string | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"list">;
        rowLabel: z.ZodString;
        rowMeta: z.ZodOptional<z.ZodString>;
        navigateTo: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "list";
        rowLabel: string;
        navigateTo?: string | undefined;
        rowMeta?: string | undefined;
    }, {
        type: "list";
        rowLabel: string;
        navigateTo?: string | undefined;
        rowMeta?: string | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"sparkline">;
        valueAt: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "sparkline";
        valueAt?: string | undefined;
    }, {
        type: "sparkline";
        valueAt?: string | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"status">;
        okWhen: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "status";
        okWhen?: string | undefined;
    }, {
        type: "status";
        okWhen?: string | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"actions">;
        rowLabel: z.ZodString;
        targetAt: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "actions";
        rowLabel: string;
        targetAt?: string | undefined;
    }, {
        type: "actions";
        rowLabel: string;
        targetAt?: string | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"markdown">;
        body: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        type: "markdown";
        body: string;
    }, {
        type: "markdown";
        body: string;
    }>]>;
}, "strip", z.ZodTypeAny, {
    source: {
        path: string;
        endpoint: "state" | "ops" | "inbox" | "contracts" | "apps" | "sessions" | "processes";
        filter?: {
            value: string | number | boolean | (string | number)[];
            field: string;
            op: "in" | "eq" | "ne" | "gt" | "lt";
        } | undefined;
        limit?: number | undefined;
        refreshOn?: ("state.changed" | "index.rebuilt" | "contract.updated" | "qc.updated" | "eval.completed" | "config.integrity-alarm" | "kb.indexed")[] | undefined;
    };
    view: {
        type: "metric";
        format: "text" | "int" | "count" | "usd" | "pct";
        tone?: "green" | "red" | "amber" | "neutral" | undefined;
        toneWhen?: {
            tone: "green" | "red" | "amber" | "neutral";
            value: string | number | boolean;
            op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
        }[] | undefined;
        navigateTo?: string | undefined;
    } | {
        type: "list";
        rowLabel: string;
        navigateTo?: string | undefined;
        rowMeta?: string | undefined;
    } | {
        type: "sparkline";
        valueAt?: string | undefined;
    } | {
        type: "status";
        okWhen?: string | undefined;
    } | {
        type: "actions";
        rowLabel: string;
        targetAt?: string | undefined;
    } | {
        type: "markdown";
        body: string;
    };
}, {
    source: {
        path: string;
        endpoint: "state" | "ops" | "inbox" | "contracts" | "apps" | "sessions" | "processes";
        filter?: {
            value: string | number | boolean | (string | number)[];
            field: string;
            op: "in" | "eq" | "ne" | "gt" | "lt";
        } | undefined;
        limit?: number | undefined;
        refreshOn?: ("state.changed" | "index.rebuilt" | "contract.updated" | "qc.updated" | "eval.completed" | "config.integrity-alarm" | "kb.indexed")[] | undefined;
    };
    view: {
        type: "metric";
        format: "text" | "int" | "count" | "usd" | "pct";
        tone?: "green" | "red" | "amber" | "neutral" | undefined;
        toneWhen?: {
            tone: "green" | "red" | "amber" | "neutral";
            value: string | number | boolean;
            op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
        }[] | undefined;
        navigateTo?: string | undefined;
    } | {
        type: "list";
        rowLabel: string;
        navigateTo?: string | undefined;
        rowMeta?: string | undefined;
    } | {
        type: "sparkline";
        valueAt?: string | undefined;
    } | {
        type: "status";
        okWhen?: string | undefined;
    } | {
        type: "actions";
        rowLabel: string;
        targetAt?: string | undefined;
    } | {
        type: "markdown";
        body: string;
    };
}>, {
    source: {
        path: string;
        endpoint: "state" | "ops" | "inbox" | "contracts" | "apps" | "sessions" | "processes";
        filter?: {
            value: string | number | boolean | (string | number)[];
            field: string;
            op: "in" | "eq" | "ne" | "gt" | "lt";
        } | undefined;
        limit?: number | undefined;
        refreshOn?: ("state.changed" | "index.rebuilt" | "contract.updated" | "qc.updated" | "eval.completed" | "config.integrity-alarm" | "kb.indexed")[] | undefined;
    };
    view: {
        type: "metric";
        format: "text" | "int" | "count" | "usd" | "pct";
        tone?: "green" | "red" | "amber" | "neutral" | undefined;
        toneWhen?: {
            tone: "green" | "red" | "amber" | "neutral";
            value: string | number | boolean;
            op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
        }[] | undefined;
        navigateTo?: string | undefined;
    } | {
        type: "list";
        rowLabel: string;
        navigateTo?: string | undefined;
        rowMeta?: string | undefined;
    } | {
        type: "sparkline";
        valueAt?: string | undefined;
    } | {
        type: "status";
        okWhen?: string | undefined;
    } | {
        type: "actions";
        rowLabel: string;
        targetAt?: string | undefined;
    } | {
        type: "markdown";
        body: string;
    };
}, {
    source: {
        path: string;
        endpoint: "state" | "ops" | "inbox" | "contracts" | "apps" | "sessions" | "processes";
        filter?: {
            value: string | number | boolean | (string | number)[];
            field: string;
            op: "in" | "eq" | "ne" | "gt" | "lt";
        } | undefined;
        limit?: number | undefined;
        refreshOn?: ("state.changed" | "index.rebuilt" | "contract.updated" | "qc.updated" | "eval.completed" | "config.integrity-alarm" | "kb.indexed")[] | undefined;
    };
    view: {
        type: "metric";
        format: "text" | "int" | "count" | "usd" | "pct";
        tone?: "green" | "red" | "amber" | "neutral" | undefined;
        toneWhen?: {
            tone: "green" | "red" | "amber" | "neutral";
            value: string | number | boolean;
            op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
        }[] | undefined;
        navigateTo?: string | undefined;
    } | {
        type: "list";
        rowLabel: string;
        navigateTo?: string | undefined;
        rowMeta?: string | undefined;
    } | {
        type: "sparkline";
        valueAt?: string | undefined;
    } | {
        type: "status";
        okWhen?: string | undefined;
    } | {
        type: "actions";
        rowLabel: string;
        targetAt?: string | undefined;
    } | {
        type: "markdown";
        body: string;
    };
}>;
export type DeclarativeSpec = z.infer<typeof declarativeSpecSchema>;
declare const widgetSize: z.ZodObject<{
    w: z.ZodNumber;
    h: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    w: number;
    h: number;
}, {
    w: number;
    h: number;
}>;
export type WidgetSize = z.infer<typeof widgetSize>;
/** D6: two values only. The app has three real tiers (workspace → project →
 * process) but a widget is either available everywhere or belongs to one
 * project; workspace and process inherit from the project layer. Four-way
 * scope resolution is what produces permanent "why is my widget not showing"
 * tickets. */
export declare const WIDGET_SCOPES: readonly ["global", "project"];
export type WidgetScope = (typeof WIDGET_SCOPES)[number];
/** Mirrors `subapps/types.ts`'s WORKSPACE_ROLE_VALUES. Declared here rather
 * than imported so this module stays free of that file's Fastify/db imports
 * and remains safe for the web bundle; the "shell chrome role list" test
 * asserts the two stay identical. super_admin is an INSTANCE role and is
 * deliberately absent, same as there. */
export declare const WIDGET_ROLE_VALUES: readonly ["hr_preparer", "hr_reviewer", "wc_liaison", "legal", "admin"];
export type WidgetRole = (typeof WIDGET_ROLE_VALUES)[number];
/** Phase 67 plan 04 (E-01): the OS gained two roles (hrss_team_lead, hrss_manager) that are NOT widget or page roles. A role outside
 * WIDGET_ROLE_VALUES reads as `null`, which every caller already treats as deny (no palette, no pages, no media, no templates):
 * fail closed, never widened. This keeps the type and the behaviour the same as before the roles existed. */
export declare function asWidgetRole(role: string): WidgetRole | null;
export declare const widgetDescriptorSchema: z.ZodEffects<z.ZodObject<{
    id: z.ZodString;
    /** An i18n KEY, never display text — the `PAGES[].labelKey` convention.
     * A widget INSTANCE may additionally carry a free-text `title` (see
     * widgetInstanceSchema); that is user data and correctly untranslated.
     * Keeping the two fields separate is what lets the i18n coverage test
     * stay meaningful. */
    labelKey: z.ZodString;
    icon: z.ZodString;
    category: z.ZodEnum<["metric", "list", "chart", "status", "action", "content"]>;
    scope: z.ZodEnum<["global", "project"]>;
    defaultSize: z.ZodObject<{
        w: z.ZodNumber;
        h: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        w: number;
        h: number;
    }, {
        w: number;
        h: number;
    }>;
    minSize: z.ZodObject<{
        w: z.ZodNumber;
        h: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        w: number;
        h: number;
    }, {
        w: number;
        h: number;
    }>;
    maxSize: z.ZodOptional<z.ZodObject<{
        w: z.ZodNumber;
        h: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        w: number;
        h: number;
    }, {
        w: number;
        h: number;
    }>>;
    resizable: z.ZodBoolean;
    /** REQUIRED and non-empty, exactly as `visibleToRoles` is for a sub-app
     * (APP-03 / Pitfall 5): a schema-valid widget can never produce zero
     * derived RBAC coverage, which is the GET-default-allow gap that rule
     * closes. Do not make this optional "for convenience". */
    visibleToRoles: z.ZodArray<z.ZodEnum<["hr_preparer", "hr_reviewer", "wc_liaison", "legal", "admin"]>, "many">;
    /** sdk-31: the version of the instance `config` shape this widget reads.
     * Absent = 1. A component widget bumps it when its config shape changes,
     * and an instance stored under an older `v` is then REFUSED (named
     * "needs update", resettable) instead of being handed a blob the component
     * would misread. See `resolveInstanceConfig`. */
    configVersion: z.ZodOptional<z.ZodNumber>;
    render: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
        kind: z.ZodLiteral<"declarative">;
        spec: z.ZodEffects<z.ZodObject<{
            source: z.ZodObject<{
                endpoint: z.ZodEnum<["state", "ops", "inbox", "contracts", "apps", "sessions", "processes"]>;
                /** May be empty: "the whole response" is a legitimate selection for a view
                 * that consumes an array (a list over GET /api/apps, say). */
                path: z.ZodString;
                filter: z.ZodOptional<z.ZodObject<{
                    field: z.ZodString;
                    op: z.ZodEnum<["eq", "ne", "gt", "lt", "in"]>;
                    value: z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodArray<z.ZodUnion<[z.ZodString, z.ZodNumber]>, "many">]>;
                }, "strip", z.ZodTypeAny, {
                    value: string | number | boolean | (string | number)[];
                    field: string;
                    op: "in" | "eq" | "ne" | "gt" | "lt";
                }, {
                    value: string | number | boolean | (string | number)[];
                    field: string;
                    op: "in" | "eq" | "ne" | "gt" | "lt";
                }>>;
                /** Bounded so one widget can never ask a page to render an unbounded list. */
                limit: z.ZodOptional<z.ZodNumber>;
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
                refreshOn: z.ZodOptional<z.ZodArray<z.ZodEnum<["state.changed", "index.rebuilt", "contract.updated", "qc.updated", "eval.completed", "config.integrity-alarm", "kb.indexed"]>, "many">>;
            }, "strip", z.ZodTypeAny, {
                path: string;
                endpoint: "state" | "ops" | "inbox" | "contracts" | "apps" | "sessions" | "processes";
                filter?: {
                    value: string | number | boolean | (string | number)[];
                    field: string;
                    op: "in" | "eq" | "ne" | "gt" | "lt";
                } | undefined;
                limit?: number | undefined;
                refreshOn?: ("state.changed" | "index.rebuilt" | "contract.updated" | "qc.updated" | "eval.completed" | "config.integrity-alarm" | "kb.indexed")[] | undefined;
            }, {
                path: string;
                endpoint: "state" | "ops" | "inbox" | "contracts" | "apps" | "sessions" | "processes";
                filter?: {
                    value: string | number | boolean | (string | number)[];
                    field: string;
                    op: "in" | "eq" | "ne" | "gt" | "lt";
                } | undefined;
                limit?: number | undefined;
                refreshOn?: ("state.changed" | "index.rebuilt" | "contract.updated" | "qc.updated" | "eval.completed" | "config.integrity-alarm" | "kb.indexed")[] | undefined;
            }>;
            view: z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
                type: z.ZodLiteral<"metric">;
                /** `count` renders the LENGTH of a selected array — stated explicitly
                 * rather than letting `int` silently mean two things depending on what
                 * the pointer happened to resolve to.
                 *
                 * There is deliberately no `duration`: nothing needs one yet, and a format
                 * whose unit nobody has fixed (days? ms? seconds?) would be guessed
                 * differently by the next author than by the renderer. Add it when a real
                 * widget needs it, together with its unit. */
                format: z.ZodEnum<["int", "count", "usd", "pct", "text"]>;
                /** The UNCONDITIONAL tone. Applies only when no `toneWhen` rule matches,
                 * and — enforced in the renderer, not here — never when the value is
                 * unknown. */
                tone: z.ZodOptional<z.ZodEnum<["neutral", "green", "amber", "red"]>>;
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
                toneWhen: z.ZodOptional<z.ZodArray<z.ZodObject<{
                    op: z.ZodEnum<["eq", "ne", "gt", "lt", "gte", "lte"]>;
                    value: z.ZodUnion<[z.ZodNumber, z.ZodString, z.ZodBoolean]>;
                    tone: z.ZodEnum<["neutral", "green", "amber", "red"]>;
                }, "strip", z.ZodTypeAny, {
                    tone: "green" | "red" | "amber" | "neutral";
                    value: string | number | boolean;
                    op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
                }, {
                    tone: "green" | "red" | "amber" | "neutral";
                    value: string | number | boolean;
                    op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
                }>, "many">>;
                navigateTo: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "metric";
                format: "text" | "int" | "count" | "usd" | "pct";
                tone?: "green" | "red" | "amber" | "neutral" | undefined;
                toneWhen?: {
                    tone: "green" | "red" | "amber" | "neutral";
                    value: string | number | boolean;
                    op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
                }[] | undefined;
                navigateTo?: string | undefined;
            }, {
                type: "metric";
                format: "text" | "int" | "count" | "usd" | "pct";
                tone?: "green" | "red" | "amber" | "neutral" | undefined;
                toneWhen?: {
                    tone: "green" | "red" | "amber" | "neutral";
                    value: string | number | boolean;
                    op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
                }[] | undefined;
                navigateTo?: string | undefined;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"list">;
                rowLabel: z.ZodString;
                rowMeta: z.ZodOptional<z.ZodString>;
                navigateTo: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "list";
                rowLabel: string;
                navigateTo?: string | undefined;
                rowMeta?: string | undefined;
            }, {
                type: "list";
                rowLabel: string;
                navigateTo?: string | undefined;
                rowMeta?: string | undefined;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"sparkline">;
                valueAt: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "sparkline";
                valueAt?: string | undefined;
            }, {
                type: "sparkline";
                valueAt?: string | undefined;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"status">;
                okWhen: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "status";
                okWhen?: string | undefined;
            }, {
                type: "status";
                okWhen?: string | undefined;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"actions">;
                rowLabel: z.ZodString;
                targetAt: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                type: "actions";
                rowLabel: string;
                targetAt?: string | undefined;
            }, {
                type: "actions";
                rowLabel: string;
                targetAt?: string | undefined;
            }>, z.ZodObject<{
                type: z.ZodLiteral<"markdown">;
                body: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                type: "markdown";
                body: string;
            }, {
                type: "markdown";
                body: string;
            }>]>;
        }, "strip", z.ZodTypeAny, {
            source: {
                path: string;
                endpoint: "state" | "ops" | "inbox" | "contracts" | "apps" | "sessions" | "processes";
                filter?: {
                    value: string | number | boolean | (string | number)[];
                    field: string;
                    op: "in" | "eq" | "ne" | "gt" | "lt";
                } | undefined;
                limit?: number | undefined;
                refreshOn?: ("state.changed" | "index.rebuilt" | "contract.updated" | "qc.updated" | "eval.completed" | "config.integrity-alarm" | "kb.indexed")[] | undefined;
            };
            view: {
                type: "metric";
                format: "text" | "int" | "count" | "usd" | "pct";
                tone?: "green" | "red" | "amber" | "neutral" | undefined;
                toneWhen?: {
                    tone: "green" | "red" | "amber" | "neutral";
                    value: string | number | boolean;
                    op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
                }[] | undefined;
                navigateTo?: string | undefined;
            } | {
                type: "list";
                rowLabel: string;
                navigateTo?: string | undefined;
                rowMeta?: string | undefined;
            } | {
                type: "sparkline";
                valueAt?: string | undefined;
            } | {
                type: "status";
                okWhen?: string | undefined;
            } | {
                type: "actions";
                rowLabel: string;
                targetAt?: string | undefined;
            } | {
                type: "markdown";
                body: string;
            };
        }, {
            source: {
                path: string;
                endpoint: "state" | "ops" | "inbox" | "contracts" | "apps" | "sessions" | "processes";
                filter?: {
                    value: string | number | boolean | (string | number)[];
                    field: string;
                    op: "in" | "eq" | "ne" | "gt" | "lt";
                } | undefined;
                limit?: number | undefined;
                refreshOn?: ("state.changed" | "index.rebuilt" | "contract.updated" | "qc.updated" | "eval.completed" | "config.integrity-alarm" | "kb.indexed")[] | undefined;
            };
            view: {
                type: "metric";
                format: "text" | "int" | "count" | "usd" | "pct";
                tone?: "green" | "red" | "amber" | "neutral" | undefined;
                toneWhen?: {
                    tone: "green" | "red" | "amber" | "neutral";
                    value: string | number | boolean;
                    op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
                }[] | undefined;
                navigateTo?: string | undefined;
            } | {
                type: "list";
                rowLabel: string;
                navigateTo?: string | undefined;
                rowMeta?: string | undefined;
            } | {
                type: "sparkline";
                valueAt?: string | undefined;
            } | {
                type: "status";
                okWhen?: string | undefined;
            } | {
                type: "actions";
                rowLabel: string;
                targetAt?: string | undefined;
            } | {
                type: "markdown";
                body: string;
            };
        }>, {
            source: {
                path: string;
                endpoint: "state" | "ops" | "inbox" | "contracts" | "apps" | "sessions" | "processes";
                filter?: {
                    value: string | number | boolean | (string | number)[];
                    field: string;
                    op: "in" | "eq" | "ne" | "gt" | "lt";
                } | undefined;
                limit?: number | undefined;
                refreshOn?: ("state.changed" | "index.rebuilt" | "contract.updated" | "qc.updated" | "eval.completed" | "config.integrity-alarm" | "kb.indexed")[] | undefined;
            };
            view: {
                type: "metric";
                format: "text" | "int" | "count" | "usd" | "pct";
                tone?: "green" | "red" | "amber" | "neutral" | undefined;
                toneWhen?: {
                    tone: "green" | "red" | "amber" | "neutral";
                    value: string | number | boolean;
                    op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
                }[] | undefined;
                navigateTo?: string | undefined;
            } | {
                type: "list";
                rowLabel: string;
                navigateTo?: string | undefined;
                rowMeta?: string | undefined;
            } | {
                type: "sparkline";
                valueAt?: string | undefined;
            } | {
                type: "status";
                okWhen?: string | undefined;
            } | {
                type: "actions";
                rowLabel: string;
                targetAt?: string | undefined;
            } | {
                type: "markdown";
                body: string;
            };
        }, {
            source: {
                path: string;
                endpoint: "state" | "ops" | "inbox" | "contracts" | "apps" | "sessions" | "processes";
                filter?: {
                    value: string | number | boolean | (string | number)[];
                    field: string;
                    op: "in" | "eq" | "ne" | "gt" | "lt";
                } | undefined;
                limit?: number | undefined;
                refreshOn?: ("state.changed" | "index.rebuilt" | "contract.updated" | "qc.updated" | "eval.completed" | "config.integrity-alarm" | "kb.indexed")[] | undefined;
            };
            view: {
                type: "metric";
                format: "text" | "int" | "count" | "usd" | "pct";
                tone?: "green" | "red" | "amber" | "neutral" | undefined;
                toneWhen?: {
                    tone: "green" | "red" | "amber" | "neutral";
                    value: string | number | boolean;
                    op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
                }[] | undefined;
                navigateTo?: string | undefined;
            } | {
                type: "list";
                rowLabel: string;
                navigateTo?: string | undefined;
                rowMeta?: string | undefined;
            } | {
                type: "sparkline";
                valueAt?: string | undefined;
            } | {
                type: "status";
                okWhen?: string | undefined;
            } | {
                type: "actions";
                rowLabel: string;
                targetAt?: string | undefined;
            } | {
                type: "markdown";
                body: string;
            };
        }>;
    }, "strip", z.ZodTypeAny, {
        kind: "declarative";
        spec: {
            source: {
                path: string;
                endpoint: "state" | "ops" | "inbox" | "contracts" | "apps" | "sessions" | "processes";
                filter?: {
                    value: string | number | boolean | (string | number)[];
                    field: string;
                    op: "in" | "eq" | "ne" | "gt" | "lt";
                } | undefined;
                limit?: number | undefined;
                refreshOn?: ("state.changed" | "index.rebuilt" | "contract.updated" | "qc.updated" | "eval.completed" | "config.integrity-alarm" | "kb.indexed")[] | undefined;
            };
            view: {
                type: "metric";
                format: "text" | "int" | "count" | "usd" | "pct";
                tone?: "green" | "red" | "amber" | "neutral" | undefined;
                toneWhen?: {
                    tone: "green" | "red" | "amber" | "neutral";
                    value: string | number | boolean;
                    op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
                }[] | undefined;
                navigateTo?: string | undefined;
            } | {
                type: "list";
                rowLabel: string;
                navigateTo?: string | undefined;
                rowMeta?: string | undefined;
            } | {
                type: "sparkline";
                valueAt?: string | undefined;
            } | {
                type: "status";
                okWhen?: string | undefined;
            } | {
                type: "actions";
                rowLabel: string;
                targetAt?: string | undefined;
            } | {
                type: "markdown";
                body: string;
            };
        };
    }, {
        kind: "declarative";
        spec: {
            source: {
                path: string;
                endpoint: "state" | "ops" | "inbox" | "contracts" | "apps" | "sessions" | "processes";
                filter?: {
                    value: string | number | boolean | (string | number)[];
                    field: string;
                    op: "in" | "eq" | "ne" | "gt" | "lt";
                } | undefined;
                limit?: number | undefined;
                refreshOn?: ("state.changed" | "index.rebuilt" | "contract.updated" | "qc.updated" | "eval.completed" | "config.integrity-alarm" | "kb.indexed")[] | undefined;
            };
            view: {
                type: "metric";
                format: "text" | "int" | "count" | "usd" | "pct";
                tone?: "green" | "red" | "amber" | "neutral" | undefined;
                toneWhen?: {
                    tone: "green" | "red" | "amber" | "neutral";
                    value: string | number | boolean;
                    op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
                }[] | undefined;
                navigateTo?: string | undefined;
            } | {
                type: "list";
                rowLabel: string;
                navigateTo?: string | undefined;
                rowMeta?: string | undefined;
            } | {
                type: "sparkline";
                valueAt?: string | undefined;
            } | {
                type: "status";
                okWhen?: string | undefined;
            } | {
                type: "actions";
                rowLabel: string;
                targetAt?: string | undefined;
            } | {
                type: "markdown";
                body: string;
            };
        };
    }>, z.ZodObject<{
        kind: z.ZodLiteral<"component">;
        webComponentId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        kind: "component";
        webComponentId: string;
    }, {
        kind: "component";
        webComponentId: string;
    }>]>;
    /** The config keys a page-doc widget block may carry for this widget
     * (pages-widget-containment). Absent means NONE — fail closed: a page doc
     * cannot hand a widget a key its descriptor never declared. The grid
     * layout's opaque `config` is not checked against it. */
    configKeys: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    id: string;
    icon: string;
    scope: "global" | "project";
    render: {
        kind: "declarative";
        spec: {
            source: {
                path: string;
                endpoint: "state" | "ops" | "inbox" | "contracts" | "apps" | "sessions" | "processes";
                filter?: {
                    value: string | number | boolean | (string | number)[];
                    field: string;
                    op: "in" | "eq" | "ne" | "gt" | "lt";
                } | undefined;
                limit?: number | undefined;
                refreshOn?: ("state.changed" | "index.rebuilt" | "contract.updated" | "qc.updated" | "eval.completed" | "config.integrity-alarm" | "kb.indexed")[] | undefined;
            };
            view: {
                type: "metric";
                format: "text" | "int" | "count" | "usd" | "pct";
                tone?: "green" | "red" | "amber" | "neutral" | undefined;
                toneWhen?: {
                    tone: "green" | "red" | "amber" | "neutral";
                    value: string | number | boolean;
                    op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
                }[] | undefined;
                navigateTo?: string | undefined;
            } | {
                type: "list";
                rowLabel: string;
                navigateTo?: string | undefined;
                rowMeta?: string | undefined;
            } | {
                type: "sparkline";
                valueAt?: string | undefined;
            } | {
                type: "status";
                okWhen?: string | undefined;
            } | {
                type: "actions";
                rowLabel: string;
                targetAt?: string | undefined;
            } | {
                type: "markdown";
                body: string;
            };
        };
    } | {
        kind: "component";
        webComponentId: string;
    };
    minSize: {
        w: number;
        h: number;
    };
    labelKey: string;
    category: "content" | "action" | "status" | "list" | "metric" | "chart";
    defaultSize: {
        w: number;
        h: number;
    };
    resizable: boolean;
    visibleToRoles: ("legal" | "hr_preparer" | "hr_reviewer" | "wc_liaison" | "admin")[];
    maxSize?: {
        w: number;
        h: number;
    } | undefined;
    configVersion?: number | undefined;
    configKeys?: string[] | undefined;
}, {
    id: string;
    icon: string;
    scope: "global" | "project";
    render: {
        kind: "declarative";
        spec: {
            source: {
                path: string;
                endpoint: "state" | "ops" | "inbox" | "contracts" | "apps" | "sessions" | "processes";
                filter?: {
                    value: string | number | boolean | (string | number)[];
                    field: string;
                    op: "in" | "eq" | "ne" | "gt" | "lt";
                } | undefined;
                limit?: number | undefined;
                refreshOn?: ("state.changed" | "index.rebuilt" | "contract.updated" | "qc.updated" | "eval.completed" | "config.integrity-alarm" | "kb.indexed")[] | undefined;
            };
            view: {
                type: "metric";
                format: "text" | "int" | "count" | "usd" | "pct";
                tone?: "green" | "red" | "amber" | "neutral" | undefined;
                toneWhen?: {
                    tone: "green" | "red" | "amber" | "neutral";
                    value: string | number | boolean;
                    op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
                }[] | undefined;
                navigateTo?: string | undefined;
            } | {
                type: "list";
                rowLabel: string;
                navigateTo?: string | undefined;
                rowMeta?: string | undefined;
            } | {
                type: "sparkline";
                valueAt?: string | undefined;
            } | {
                type: "status";
                okWhen?: string | undefined;
            } | {
                type: "actions";
                rowLabel: string;
                targetAt?: string | undefined;
            } | {
                type: "markdown";
                body: string;
            };
        };
    } | {
        kind: "component";
        webComponentId: string;
    };
    minSize: {
        w: number;
        h: number;
    };
    labelKey: string;
    category: "content" | "action" | "status" | "list" | "metric" | "chart";
    defaultSize: {
        w: number;
        h: number;
    };
    resizable: boolean;
    visibleToRoles: ("legal" | "hr_preparer" | "hr_reviewer" | "wc_liaison" | "admin")[];
    maxSize?: {
        w: number;
        h: number;
    } | undefined;
    configVersion?: number | undefined;
    configKeys?: string[] | undefined;
}>, {
    id: string;
    icon: string;
    scope: "global" | "project";
    render: {
        kind: "declarative";
        spec: {
            source: {
                path: string;
                endpoint: "state" | "ops" | "inbox" | "contracts" | "apps" | "sessions" | "processes";
                filter?: {
                    value: string | number | boolean | (string | number)[];
                    field: string;
                    op: "in" | "eq" | "ne" | "gt" | "lt";
                } | undefined;
                limit?: number | undefined;
                refreshOn?: ("state.changed" | "index.rebuilt" | "contract.updated" | "qc.updated" | "eval.completed" | "config.integrity-alarm" | "kb.indexed")[] | undefined;
            };
            view: {
                type: "metric";
                format: "text" | "int" | "count" | "usd" | "pct";
                tone?: "green" | "red" | "amber" | "neutral" | undefined;
                toneWhen?: {
                    tone: "green" | "red" | "amber" | "neutral";
                    value: string | number | boolean;
                    op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
                }[] | undefined;
                navigateTo?: string | undefined;
            } | {
                type: "list";
                rowLabel: string;
                navigateTo?: string | undefined;
                rowMeta?: string | undefined;
            } | {
                type: "sparkline";
                valueAt?: string | undefined;
            } | {
                type: "status";
                okWhen?: string | undefined;
            } | {
                type: "actions";
                rowLabel: string;
                targetAt?: string | undefined;
            } | {
                type: "markdown";
                body: string;
            };
        };
    } | {
        kind: "component";
        webComponentId: string;
    };
    minSize: {
        w: number;
        h: number;
    };
    labelKey: string;
    category: "content" | "action" | "status" | "list" | "metric" | "chart";
    defaultSize: {
        w: number;
        h: number;
    };
    resizable: boolean;
    visibleToRoles: ("legal" | "hr_preparer" | "hr_reviewer" | "wc_liaison" | "admin")[];
    maxSize?: {
        w: number;
        h: number;
    } | undefined;
    configVersion?: number | undefined;
    configKeys?: string[] | undefined;
}, {
    id: string;
    icon: string;
    scope: "global" | "project";
    render: {
        kind: "declarative";
        spec: {
            source: {
                path: string;
                endpoint: "state" | "ops" | "inbox" | "contracts" | "apps" | "sessions" | "processes";
                filter?: {
                    value: string | number | boolean | (string | number)[];
                    field: string;
                    op: "in" | "eq" | "ne" | "gt" | "lt";
                } | undefined;
                limit?: number | undefined;
                refreshOn?: ("state.changed" | "index.rebuilt" | "contract.updated" | "qc.updated" | "eval.completed" | "config.integrity-alarm" | "kb.indexed")[] | undefined;
            };
            view: {
                type: "metric";
                format: "text" | "int" | "count" | "usd" | "pct";
                tone?: "green" | "red" | "amber" | "neutral" | undefined;
                toneWhen?: {
                    tone: "green" | "red" | "amber" | "neutral";
                    value: string | number | boolean;
                    op: "eq" | "ne" | "gt" | "lt" | "gte" | "lte";
                }[] | undefined;
                navigateTo?: string | undefined;
            } | {
                type: "list";
                rowLabel: string;
                navigateTo?: string | undefined;
                rowMeta?: string | undefined;
            } | {
                type: "sparkline";
                valueAt?: string | undefined;
            } | {
                type: "status";
                okWhen?: string | undefined;
            } | {
                type: "actions";
                rowLabel: string;
                targetAt?: string | undefined;
            } | {
                type: "markdown";
                body: string;
            };
        };
    } | {
        kind: "component";
        webComponentId: string;
    };
    minSize: {
        w: number;
        h: number;
    };
    labelKey: string;
    category: "content" | "action" | "status" | "list" | "metric" | "chart";
    defaultSize: {
        w: number;
        h: number;
    };
    resizable: boolean;
    visibleToRoles: ("legal" | "hr_preparer" | "hr_reviewer" | "wc_liaison" | "admin")[];
    maxSize?: {
        w: number;
        h: number;
    } | undefined;
    configVersion?: number | undefined;
    configKeys?: string[] | undefined;
}>;
export type WidgetDescriptor = z.infer<typeof widgetDescriptorSchema>;
/** The surfaces a layout can be stored for. `page:<slug>` covers the custom,
 * widget-only pages an admin composes (§1.6 of the spec) — validated by
 * `surfaceSchema` below rather than enumerated, since slugs are user data. */
export declare const UI_SURFACES: readonly ["dashboard", "os-desktop", "rail", "start"];
export type UiSurface = (typeof UI_SURFACES)[number];
export declare const GRID_COLUMNS = 12;
export declare const widgetInstanceSchema: z.ZodEffects<z.ZodObject<{
    instanceId: z.ZodString;
    widgetId: z.ZodString;
    x: z.ZodNumber;
    y: z.ZodNumber;
    w: z.ZodNumber;
    h: z.ZodNumber;
    /** Free text typed by an admin. User data, deliberately untranslated. */
    title: z.ZodOptional<z.ZodString>;
    config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    /** sdk-31: the descriptor `configVersion` this `config` was written for.
     * Absent = 1, so every layout stored before this field existed reads as
     * v1 and is unchanged. Never defaulted in the schema: a parsed layout must
     * round-trip byte for byte. */
    v: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    x: number;
    y: number;
    widgetId: string;
    w: number;
    h: number;
    instanceId: string;
    title?: string | undefined;
    config?: Record<string, unknown> | undefined;
    v?: number | undefined;
}, {
    x: number;
    y: number;
    widgetId: string;
    w: number;
    h: number;
    instanceId: string;
    title?: string | undefined;
    config?: Record<string, unknown> | undefined;
    v?: number | undefined;
}>, {
    x: number;
    y: number;
    widgetId: string;
    w: number;
    h: number;
    instanceId: string;
    title?: string | undefined;
    config?: Record<string, unknown> | undefined;
    v?: number | undefined;
}, {
    x: number;
    y: number;
    widgetId: string;
    w: number;
    h: number;
    instanceId: string;
    title?: string | undefined;
    config?: Record<string, unknown> | undefined;
    v?: number | undefined;
}>;
export type WidgetInstance = z.infer<typeof widgetInstanceSchema>;
/** sdk-31: what the host may do with an instance's stored config.
 *
 * `ok` is the ONLY outcome that carries a config. The two refusals carry none
 * on purpose, so no caller can hand a mismatched blob to a component by
 * accident. There are no code-defined migrations: an older config is not
 * translated, it is offered a reset (`resetInstanceConfig`); a newer one was
 * written by a build this one does not understand and is left untouched. */
export type InstanceConfigResolution = {
    state: "ok";
    config: Record<string, unknown>;
} | {
    state: "needs-update";
    have: number;
    want: number;
} | {
    state: "unsupported-future";
    have: number;
    want: number;
};
export declare function resolveInstanceConfig(desc: Pick<WidgetDescriptor, "configVersion">, inst: Pick<WidgetInstance, "v" | "config">): InstanceConfigResolution;
/** "Reset to defaults": the instance without its config, stamped with the
 * descriptor's version (omitted when that is 1, the absent default). Geometry
 * and the admin's title are kept — only the config is the component's. */
export declare function resetInstanceConfig(desc: Pick<WidgetDescriptor, "configVersion">, inst: WidgetInstance): WidgetInstance;
export declare const layoutDocSchema: z.ZodEffects<z.ZodObject<{
    /** Pinned literal, not a number: a document written by a future version
     * must be REFUSED loudly rather than half-read by this one. */
    version: z.ZodLiteral<1>;
    surface: z.ZodEffects<z.ZodString, string, string>;
    widgets: z.ZodArray<z.ZodEffects<z.ZodObject<{
        instanceId: z.ZodString;
        widgetId: z.ZodString;
        x: z.ZodNumber;
        y: z.ZodNumber;
        w: z.ZodNumber;
        h: z.ZodNumber;
        /** Free text typed by an admin. User data, deliberately untranslated. */
        title: z.ZodOptional<z.ZodString>;
        config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        /** sdk-31: the descriptor `configVersion` this `config` was written for.
         * Absent = 1, so every layout stored before this field existed reads as
         * v1 and is unchanged. Never defaulted in the schema: a parsed layout must
         * round-trip byte for byte. */
        v: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
        widgetId: string;
        w: number;
        h: number;
        instanceId: string;
        title?: string | undefined;
        config?: Record<string, unknown> | undefined;
        v?: number | undefined;
    }, {
        x: number;
        y: number;
        widgetId: string;
        w: number;
        h: number;
        instanceId: string;
        title?: string | undefined;
        config?: Record<string, unknown> | undefined;
        v?: number | undefined;
    }>, {
        x: number;
        y: number;
        widgetId: string;
        w: number;
        h: number;
        instanceId: string;
        title?: string | undefined;
        config?: Record<string, unknown> | undefined;
        v?: number | undefined;
    }, {
        x: number;
        y: number;
        widgetId: string;
        w: number;
        h: number;
        instanceId: string;
        title?: string | undefined;
        config?: Record<string, unknown> | undefined;
        v?: number | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    version: 1;
    surface: string;
    widgets: {
        x: number;
        y: number;
        widgetId: string;
        w: number;
        h: number;
        instanceId: string;
        title?: string | undefined;
        config?: Record<string, unknown> | undefined;
        v?: number | undefined;
    }[];
}, {
    version: 1;
    surface: string;
    widgets: {
        x: number;
        y: number;
        widgetId: string;
        w: number;
        h: number;
        instanceId: string;
        title?: string | undefined;
        config?: Record<string, unknown> | undefined;
        v?: number | undefined;
    }[];
}>, {
    version: 1;
    surface: string;
    widgets: {
        x: number;
        y: number;
        widgetId: string;
        w: number;
        h: number;
        instanceId: string;
        title?: string | undefined;
        config?: Record<string, unknown> | undefined;
        v?: number | undefined;
    }[];
}, {
    version: 1;
    surface: string;
    widgets: {
        x: number;
        y: number;
        widgetId: string;
        w: number;
        h: number;
        instanceId: string;
        title?: string | undefined;
        config?: Record<string, unknown> | undefined;
        v?: number | undefined;
    }[];
}>;
export type LayoutDoc = z.infer<typeof layoutDocSchema>;
/** Which tier a stored layout belongs to. `global` is the shipped/instance
 * default a super_admin edits; `project` is the per-project layout a
 * workspace admin edits. Mirrors WIDGET_SCOPES deliberately — a project-scoped
 * widget can only ever be placed on a project-scoped layout, and
 * `assertPlaceable` below is the one place that is enforced. */
export declare const LAYOUT_TIERS: readonly ["global", "project"];
export type LayoutTier = (typeof LAYOUT_TIERS)[number];
/** The D6 containment rule, in one function so the route and the store cannot
 * disagree: a project widget must not leak onto the global default, because
 * that default is what every OTHER project falls back to. */
export declare function assertPlaceable(
/** Only the widget ids are read, so a page doc's widget blocks
 * (server/pagedoc/containment.ts) go through this same rule unchanged. */
doc: {
    widgets: ReadonlyArray<{
        widgetId: string;
    }>;
}, tier: LayoutTier, descriptorFor: (widgetId: string) => WidgetDescriptor | undefined): {
    ok: true;
} | {
    ok: false;
    error: string;
};
export {};
