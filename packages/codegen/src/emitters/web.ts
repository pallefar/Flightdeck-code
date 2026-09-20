/** `web/src/subapps/<webModuleId>/index.tsx` — the page, default-exporting
 * a `SubAppModule`.
 *
 * ── THE FRONT END IS THE POINT OF A CONVERTED WORKFLOW ───────────────
 * A Cowork workflow is a skill: frontmatter plus a `## Procedure` of
 * numbered steps that a person holds in their head — step 3 waits on step
 * 2, step 5 is statutory, this step needs the folder and produces the
 * draft. Emitting that as a stack of unlabelled forms throws away the only
 * part that was hard to write down. So the page's primary surface is a
 * STEP RAIL: the steps in order, each with its gate, its state, what it
 * needs, what it produced, and — for the steps this app can actually
 * perform — the control that performs it. Routes no step names fall
 * through to "Other actions" below, so nothing the spec declared becomes
 * unreachable.
 *
 * ── WHERE "STATE" COMES FROM WHEN THERE IS NO DATABASE ───────────────
 * A mini-app stores nothing. Its only durable trace is the files it wrote
 * under `memory/proposals/`, which `caps.listOwnInboxProposals()` returns
 * scoped to its own id. So a step is "proposed" when a proposal whose
 * filename carries that step's `<id>-<proposalKind>-` prefix exists, and
 * that is the FURTHEST state this page can honestly show: a human resolves
 * it in the Inbox, and the page says so in as many words rather than
 * drawing a tick. Contract rule 7 — propose, don't mutate — is not a
 * limitation being worked around here; it is what the rail renders.
 *
 * ⚠ AND THE PAGE NEVER BLOCKS A STEP. A step whose predecessor has no
 * proposal reads "Waiting on step N" and keeps its control enabled. The
 * app cannot see work done outside itself (most steps of a real workflow
 * happen elsewhere), so disabling the control would be the app making a
 * judgment it has no state for. It reports the order; it does not enforce
 * it. "Bots write facts, not judgments."
 *
 * ── THREE DELIBERATE DEPARTURES FROM `shell-reference/index.tsx` ─────
 * 1. It calls `fetch` through a local helper instead of the host's `api`
 *    client. Adding a method to `web/src/api.ts` is an edit to a HOST file,
 *    and this generator emits exactly two host edits: the sub-app's own
 *    directories and the registry patch. A page that quietly required a
 *    third would be a page that does not actually drop in.
 * 2. Its strings are literal English, not `t()` keys — and this one is
 *    forced, not preferred. `import.meta.glob` covers the web MODULE but
 *    not i18n: a dictionary needs a hand-written static import plus a
 *    spread in `web/src/i18n.ts`, AND an update to the frozen key counts
 *    in `tests/subapps/i18nSplit.test.ts`, which assert EXACT totals
 *    (`TOTAL_KEYS = 4071`, not `toBeGreaterThan`). A generated sub-app
 *    shipping one i18n key turns a host test red until a human edits two
 *    more files. The contract's own reading: emit the count delta, or emit
 *    no i18n at all. This emitter emits none, which is why `registry.ts`
 *    stays the ONLY host edit codegen asks for — and why `shell-reference`,
 *    the documented floor, ships no dictionary either.
 *    ⚠ KNOWN GAP, stated rather than hidden: a generated page is therefore
 *    English-only, and the emitted header says so in the file itself.
 * 3. It ships NO stylesheet. `find web/src/subapps -name '*.css'` returns
 *    zero in the host: every sub-app's CSS lives in a banner-delimited
 *    region of the shared `web/src/theme.css`, and
 *    `tests/keyboardOperability.test.tsx` reads only that file. So the page
 *    uses the host's OWN class names (`page`, `pagehead`, `eyebrow`,
 *    `card`, `chip` + its `.amber`/`.red`/`.blue`/`.green`/`.orange`
 *    modifiers, `progress`, `mono`, `muted`, `errorbox`, `okbox`) and adds
 *    none. What no host class covers — the step card's own grid — is an
 *    inline style whose every colour is `var(--token, <literal>)`: the
 *    token so the page follows the host's theme toggle, the literal so it
 *    still reads correctly anywhere the stylesheet is not loaded. The
 *    literals are the host's dark values (--bg #07090d, --surface #11161f,
 *    --ink #eef2f7, --muted #8b96a5, --line #1f2733, --te #ff8200,
 *    --green #2fd472, --amber #ffc24b, --red #ff5b4d).
 *
 * ── WHY THE PAGE IS DATA-DRIVEN ──────────────────────────────────────
 * The obvious emitter unrolls one bespoke component per route and produces
 * a file that grows linearly in ugliness with the spec. This one emits
 * `WORKFLOW` and `PANELS` — the spec, as data — plus a fixed renderer that
 * is the same text in every generated app. Two payoffs: the emitted file
 * stays reviewable at any spec size, and the part that could contain a bug
 * is written once here rather than re-synthesised per app. Studio's own
 * preview (`src/workbench/preview/descriptor.ts`) depends on exactly that:
 * it PARSES those literals rather than executing model-written text, and
 * fingerprints the fixed runtime so it refuses instead of showing a stale
 * mirror.
 *
 * Refusals are routed on STATUS and the body's `code`, never on prose —
 * the discipline `shell-reference/index.tsx` sets, kept here because it is
 * the difference between a page that explains a 403 and one that shows a
 * server sentence to a person who cannot act on it. */
import { banner, joinLines, str } from "../emit";
import type { PlannedDomain, PlannedRoute, PlannedWorkflowStep, SubAppPlan } from "../plan";

interface FieldDescriptor {
  name: string;
  label: string;
  control: "text" | "number" | "checkbox" | "select";
  options: string[] | null;
  optional: boolean;
}

export function emitWebModule(plan: SubAppPlan): string {
  const panels = plan.domains.map((domain) => panelLiteral(plan, domain));
  return joinLines([
    banner([
      `${plan.label} — GENERATED page. Default-exports a \`SubAppModule\`; the web loader globs this exact path (\`web/src/subapps/${plan.webModuleId}/index.tsx\`) and lazy-mounts \`.Page\`.`,
      "",
      plan.workflow === null
        ? "This app was not converted from a workflow, so the page renders its routes as panels."
        : `Converted from the "${plan.workflow.name}" workflow. The step rail below is its \`## Procedure\`: the steps in order, each one's gate, what it needs, what it produced, and the control that performs it where this app can.`,
      "",
      "A step's state is read from the proposals this sub-app itself wrote (`listOwnInboxProposals`) — the only durable trace a database-free mini-app has. \"Proposed\" is the furthest state it can show: a human resolves the proposal in the Inbox. Nothing here advances or approves a step (contract rule 7).",
      "",
      "The rail never DISABLES a step whose predecessor is unproposed: most steps of a real workflow happen outside this app, so it reports the order rather than enforcing it.",
      "",
      "Every panel and step below is derived from the spec. The renderer under them is fixed text, identical in every generated sub-app.",
      "",
      "⚠ English-only, deliberately. A dictionary would need a static import and a spread in `web/src/i18n.ts` AND an update to the EXACT frozen key counts in `tests/subapps/i18nSplit.test.ts` — so shipping one i18n key turns a host test red. Emitting none is what keeps `registry.ts` the only host edit this sub-app asks for.",
      "No stylesheet ships with this page: sub-app CSS lives in a banner-delimited region of the shared `web/src/theme.css`, and zero `.css` files exist under `web/src/subapps`. The class names below are the host's existing ones; the inline styles name host CSS variables with the host's own dark values as fallbacks.",
      "",
      "Refusals are routed on the HTTP status and the body's `code` — never on the server's prose, which is developer-facing English and must not land inside a translated sentence later.",
    ]),
    `import { Fragment, useCallback, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";`,
    `import type { SubAppModule } from "../registry";`,
    "",
    `const ROUTE_PREFIX = ${str(plan.routePrefix)};`,
    `const APP_TITLE = ${str(plan.label)};`,
    `const APP_BLURB = ${str(plan.summary ?? `${plan.label} — generated by Flightdeck Studio.`)};`,
    `const APP_ICON = ${str(plan.manifestData.icon)};`,
    "",
    RUNTIME_TYPES,
    "",
    workflowLiteral(plan),
    "",
    "const PANELS: PanelDescriptor[] = [",
    panels.join("\n"),
    "];",
    "",
    TOKENS,
    "",
    STYLES,
    "",
    RUNTIME,
    "",
    STEP_RAIL,
    "",
    PANEL_RENDERER,
    "",
    PAGE,
    "",
    "const subAppModule: SubAppModule = { Page: GeneratedPage };",
    "export default subAppModule;",
    "",
  ]);
}

/** `WORKFLOW` — the `## Procedure`, as data. `null` when the spec carried
 * no workflow, which keeps the renderer's shape identical either way: the
 * rail component is always mounted and answers `null` itself, so the file
 * never contains a component nothing references. */
function workflowLiteral(plan: SubAppPlan): string {
  const workflow = plan.workflow;
  if (workflow === null) {
    return joinLines([
      "/** This sub-app was not converted from a workflow. The rail below",
      " * renders nothing and the page is its panels. */",
      "const WORKFLOW: WorkflowDescriptor | null = null;",
    ]);
  }
  const lines: string[] = [
    "/** The workflow's `## Procedure`, step for step. `action` binds a step",
    " * to one of this app's own routes; a step without one happens outside",
    " * this app and says so on screen. */",
    "const WORKFLOW: WorkflowDescriptor | null = {",
    `  name: ${str(workflow.name)},`,
    `  description: ${workflow.description === null ? "null" : str(workflow.description)},`,
    `  source: ${workflow.source === null ? "null" : str(workflow.source)},`,
    `  proposalsPath: ${workflow.proposalsPath === null ? "null" : str(workflow.proposalsPath)},`,
    "  steps: [",
  ];
  for (const step of workflow.steps) lines.push(stepLiteral(step));
  lines.push("  ],", "};");
  return lines.join("\n");
}

function stepLiteral(step: PlannedWorkflowStep): string {
  const parts: string[] = [
    "    {",
    `      n: ${String(step.n)},`,
    `      title: ${str(step.title)},`,
    `      detail: ${step.detail === null ? "null" : str(step.detail)},`,
    `      needs: [${step.needs.map(str).join(", ")}],`,
    `      produces: [${step.produces.map(str).join(", ")}],`,
    `      gate: ${str(step.gate)},`,
  ];
  if (step.action === null) {
    parts.push("      action: null,");
  } else {
    parts.push(
      "      action: {",
      `        formId: ${str(step.action.formId)},`,
      `        method: ${str(step.action.method)},`,
      `        path: ${str(step.action.subPath)},`,
      `        label: ${str(step.action.label)},`,
      `        proposalPrefix: ${step.action.proposalPrefix === null ? "null" : str(step.action.proposalPrefix)},`,
      "      },",
    );
  }
  parts.push("    },");
  return parts.join("\n");
}

function panelLiteral(plan: SubAppPlan, domain: PlannedDomain): string {
  const list = domain.routes.find((r) => r.method === "GET");
  const forms = domain.routes.filter((r) => r.bodyConstName !== null);
  const parts: string[] = [
    "  {",
    `    id: ${str(domain.name)},`,
    `    title: ${str(domain.title)},`,
    list === undefined
      ? "    list: null,"
      : `    list: { path: ${str(subPathFor(plan, list))}, label: ${str(list.summary ?? `Load ${domain.title.toLowerCase()}`)} },`,
    "    forms: [",
  ];
  for (const form of forms) {
    parts.push(
      "      {",
      `        id: ${str(form.formId)},`,
      `        method: ${str(form.method)},`,
      `        path: ${str(subPathFor(plan, form))},`,
      `        label: ${str(form.summary ?? `${form.method} ${form.subPath}`)},`,
      `        fields: [${fieldDescriptors(form).map(fieldLiteral).join(", ")}],`,
      "      },",
    );
  }
  parts.push("    ],", "  },");
  return parts.join("\n");
}

/** The page fetches `ROUTE_PREFIX + subPath`, so the emitted descriptor
 * carries the sub-path only — one place for the prefix, on both sides. */
function subPathFor(plan: SubAppPlan, route: PlannedRoute): string {
  return route.fullPath.slice(plan.routePrefix.length);
}

function fieldDescriptors(route: PlannedRoute): FieldDescriptor[] {
  return route.fields.map((field) => ({
    name: field.name,
    label: humanize(field.name),
    control: field.type === "boolean" ? "checkbox" : field.type === "enum" ? "select" : field.type === "string" ? "text" : "number",
    options: field.type === "enum" ? [...(field.values ?? [])] : null,
    optional: field.optional === true,
  }));
}

function fieldLiteral(field: FieldDescriptor): string {
  const options = field.options === null ? "null" : `[${field.options.map(str).join(", ")}]`;
  return `{ name: ${str(field.name)}, label: ${str(field.label)}, control: ${str(field.control)}, options: ${options}, optional: ${String(field.optional)} }`;
}

function humanize(camel: string): string {
  const spaced = camel.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const RUNTIME_TYPES = `interface FieldDescriptor {
  name: string;
  label: string;
  control: "text" | "number" | "checkbox" | "select";
  options: string[] | null;
  optional: boolean;
}

interface FormDescriptor {
  id: string;
  method: string;
  path: string;
  label: string;
  fields: FieldDescriptor[];
}

interface PanelDescriptor {
  id: string;
  title: string;
  list: { path: string; label: string } | null;
  forms: FormDescriptor[];
}

/** The route a workflow step is performed by. \`proposalPrefix\` is the
 * exact \`memory/proposals/\` filename prefix that route writes — matching
 * it against this sub-app's own proposal list is how a step is known to
 * have been proposed. Null for a step whose action only reads. */
interface StepAction {
  formId: string;
  method: string;
  path: string;
  label: string;
  proposalPrefix: string | null;
}

interface StepDescriptor {
  n: number;
  title: string;
  detail: string | null;
  needs: string[];
  produces: string[];
  gate: "human" | "statutory" | "auto";
  action: StepAction | null;
}

interface WorkflowDescriptor {
  name: string;
  description: string | null;
  source: string | null;
  /** Sub-path of this app's \`list-proposals\` route, when it has one.
   * Null means the rail can file proposals but cannot show which steps
   * already have one. */
  proposalsPath: string | null;
  steps: StepDescriptor[];
}

interface Refusal {
  status: number | null;
  code: string | null;
  scope: string | null;
  detail: string;
}

type StepState = "proposed" | "ready" | "waiting" | "manual";

interface StepStatus {
  state: StepState;
  /** The earlier step whose proposal is missing, when this one is waiting. */
  blockedBy: number | null;
  /** What the step produced, once it has: the proposal's path. */
  proposalPath: string | null;
}`;

/** Host CSS variables with the host's own dark values as fallbacks. The
 * variable is what makes the page follow the console's theme toggle
 * (theme.css defines a light \`:root\` and a dark \`[data-theme="dark"]\`);
 * the literal is what keeps it legible anywhere the stylesheet is not
 * loaded, such as Studio's own preview. */
const TOKENS = `const T = {
  bg: "var(--bg, #07090d)",
  surface: "var(--surface, #11161f)",
  ink: "var(--ink, #eef2f7)",
  muted: "var(--muted, #8b96a5)",
  line: "var(--line, #1f2733)",
  accent: "var(--te, #ff8200)",
  green: "var(--green, #2fd472)",
  amber: "var(--amber, #ffc24b)",
  red: "var(--red, #ff5b4d)",
} as const;`;

const STYLES = `const railStyle: CSSProperties = { listStyle: "none", margin: "0 0 26px", padding: 0, display: "grid", gap: 10 };
const stepStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "30px minmax(0, 1fr)",
  gap: 14,
  alignItems: "start",
  padding: "14px 16px",
  borderRadius: 16,
  border: "1px solid " + T.line,
  background: T.surface,
};
const headRow: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, justifyContent: "space-between" };
const titleStyle: CSSProperties = { fontWeight: 600, fontSize: 14, color: T.ink };
const detailStyle: CSSProperties = { margin: "6px 0 0", fontSize: 13 };
const metaRow: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 8 };
const metaLabel: CSSProperties = { fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", minWidth: 62 };
const actionRow: CSSProperties = { marginTop: 10, paddingTop: 10, borderTop: "1px dashed " + T.line };
const summaryRow: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, margin: "0 0 14px" };
/** ⚠ BOUNDED. \`flex: 1 1 180px\` let an always-empty track stretch across ~500px
 * of a 1040px column, where it reads as a stray grey rule rather than a meter.
 * A progress bar should be the size of the thing it measures. */
const trackStyle: CSSProperties = { flex: "0 1 180px", minWidth: 120, maxWidth: 220 };
const fieldRow: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, margin: "6px 0" };
const fieldLabel: CSSProperties = { minWidth: 120, fontSize: 12, color: T.muted };

function badgeStyle(state: StepState): CSSProperties {
  const base: CSSProperties = {
    width: 30,
    height: 30,
    borderRadius: 99,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
    border: "1px solid " + T.line,
    background: T.bg,
    color: T.muted,
  };
  if (state === "proposed") return { ...base, background: T.amber, borderColor: "transparent", color: "#0b0f16" };
  if (state === "ready") return { ...base, background: T.accent, borderColor: "transparent", color: "#0b0f16" };
  if (state === "manual") return { ...base, borderStyle: "dashed" };
  return base;
}`;

const RUNTIME = `class ApiRefusal extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.detail);
  }
}

function refusalOf(err: unknown): Refusal {
  return err instanceof ApiRefusal ? err.refusal : { status: null, code: null, scope: null, detail: String(err) };
}

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  // Built up rather than passed with undefined members: the host compiles
  // under exactOptionalPropertyTypes, where \`headers: undefined\` is an error.
  const init: RequestInit = { method, credentials: "same-origin" };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(ROUTE_PREFIX + path, init);
  } catch (err) {
    throw new ApiRefusal({ status: null, code: null, scope: null, detail: (err as Error).message });
  }
  const text = await res.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const raw = parsed === null || !Array.isArray(parsed.issues) ? [] : (parsed.issues as Array<{ message?: string }>);
    const issues = raw.map((i) => i.message ?? "").filter((m) => m.length > 0).join("; ");
    const code = parsed === null ? null : parsed.code;
    const scope = parsed === null ? null : parsed.scope;
    const error = parsed === null ? null : parsed.error;
    throw new ApiRefusal({
      status: res.status,
      code: typeof code === "string" ? code : null,
      scope: typeof scope === "string" ? scope : null,
      detail: issues.length > 0 ? issues : typeof error === "string" ? error : text.slice(0, 300),
    });
  }
  return parsed;
}

/** One sentence per REAL condition a generated route can answer. Routed on
 * the status and the body's code — never on the server's prose. */
function refusalText(r: Refusal): string {
  if (r.status === 400) return "The server refused this input.";
  if (r.status === 403 && r.code === "subapp_disabled") return "This app is not enabled for this workspace.";
  if (r.status === 403 && r.code === "capability_denied") {
    return "This app's access to " + (r.scope ?? "a capability") + " is not granted here.";
  }
  if (r.status === 403) return "Your role may not use this app.";
  if (r.status === 404) return "That record is not here any more — reload.";
  if (r.status === null) return "The server could not be reached.";
  return "The server answered " + String(r.status) + ".";
}

function RefusalBox({ refusal }: { refusal: Refusal }) {
  return (
    <div className="errorbox" role="alert" data-status={refusal.status ?? "network"} data-code={refusal.code ?? ""}>
      {refusalText(refusal)} {refusal.detail.length > 0 && <code className="mono">{refusal.detail}</code>}
    </div>
  );
}

function Chip({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={tone.length > 0 ? "chip " + tone : "chip"}>{children}</span>;
}

function asRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  const rows = (payload as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** The filenames this sub-app's own \`list-proposals\` route answered with.
 * Read off \`fileName\` rather than the full path so the prefix match below
 * is against the name the propose route actually wrote. */
function proposalNames(payload: unknown): string[] {
  const out: string[] = [];
  for (const row of asRows(payload)) {
    const name = row.fileName;
    if (typeof name === "string") out.push(name);
  }
  return out;
}

/** \`folderName\` -> "Folder name". The API's key, read out loud.
 *
 * A table headed \`ticket | dir | folderName\` is a JSON dump with a border:
 * those are the server's field names, and the reader is a works-council
 * officer, not the person who wrote the route. This does the smallest honest
 * thing \u2014 split the camelCase, sentence-case the result \u2014 and does NOT
 * invent a label the data does not support: an unrecognised key still shows
 * its own words, just as words. */
function humanColumn(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (spaced.length === 0) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** What the route answered, as fields rather than as a stringified blob.
 *
 * This was \`setOk(JSON.stringify(answer))\` rendered in a monospace box, so a
 * successful filing confirmed itself with
 * \`{"proposal":"memory/proposals/wc-clock-review-TE-4711.json","hash":"9f2a\u2026"}\`.
 * That is the shape of the response, not the answer to "did it work?", and the
 * one part a person needs \u2014 the path a human will open in the Inbox \u2014 is the
 * hardest part of it to read.
 *
 * ⚠ NOTHING IS INVENTED HERE. The keys are whatever the route sent, run through
 * the same \`humanColumn\` as the table; a non-object answer still prints
 * verbatim. The change is presentation, and it drops nothing. */
function OkAnswer({ answer }: { answer: unknown }) {
  if (answer === null || typeof answer !== "object" || Array.isArray(answer)) {
    return <code className="mono">{String(answer)}</code>;
  }
  const entries = Object.entries(answer as Record<string, unknown>);
  if (entries.length === 0) return <span>Done.</span>;
  return (
    <>
      <strong>Done.</strong>
      <dl style={{ margin: "6px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px" }}>
        {entries.map(([key, value]) => (
          <Fragment key={key}>
            <dt className="muted" style={{ fontSize: 12 }}>
              {humanColumn(key)}
            </dt>
            <dd className="mono" style={{ margin: 0, overflowWrap: "anywhere" }}>
              {typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)}
            </dd>
          </Fragment>
        ))}
      </dl>
    </>
  );
}

function RowTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (rows.length === 0) return <p className="muted">Nothing here yet.</p>;
  const columns = Object.keys(rows[0] ?? {});
  return (
    <table>
      <thead>
        <tr>
          {columns.map((column) => (
            // \`title\` keeps the RAW key one hover away, because somebody
            // debugging a route needs the name the server actually sent.
            <th key={column} title={column}>
              {humanColumn(column)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={cellText(row.id) || String(index)}>
            {columns.map((column) => (
              <td key={column} className="mono">
                {cellText(row[column])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RouteForm({ form, onDone }: { form: FormDescriptor; onDone: (answer: unknown) => void }) {
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [ok, setOk] = useState<unknown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    setOk(null);
    const body: Record<string, unknown> = {};
    for (const field of form.fields) {
      const raw = values[field.name];
      if (field.control === "checkbox") {
        body[field.name] = raw === true;
        continue;
      }
      const text = typeof raw === "string" ? raw.trim() : "";
      if (text.length === 0) {
        if (!field.optional) body[field.name] = "";
        continue;
      }
      body[field.name] = field.control === "number" ? Number(text) : text;
    }
    try {
      const answer = await call(form.method, form.path, body);
      setOk(answer);
      setValues({});
      onDone(answer);
    } catch (err) {
      setRefusal(refusalOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} data-form={form.id}>
      {form.fields.map((field) => (
        <label key={field.name} style={fieldRow}>
          <span style={fieldLabel}>
            {field.label}
            {field.optional ? " (optional)" : ""}
          </span>
          {field.control === "checkbox" ? (
            <input
              type="checkbox"
              checked={values[field.name] === true}
              onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.checked }))}
            />
          ) : field.control === "select" ? (
            <select
              value={typeof values[field.name] === "string" ? (values[field.name] as string) : ""}
              onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
            >
              <option value="">—</option>
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={field.control === "number" ? "number" : "text"}
              value={typeof values[field.name] === "string" ? (values[field.name] as string) : ""}
              onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
            />
          )}
        </label>
      ))}
      <button type="submit" disabled={busy} aria-busy={busy}>
        {busy ? "Working…" : form.label}
      </button>
      {refusal && <RefusalBox refusal={refusal} />}
      {ok !== null && (
        <div className="okbox" role="status">
          <OkAnswer answer={ok} />
        </div>
      )}
    </form>
  );
}`;

const STEP_RAIL = `/** \`method + "-" + path\`, the same key codegen gives a route's form id —
 * so a step's action and a panel's entry for the same route agree without
 * either side carrying the other's spelling. */
function routeKey(method: string, path: string): string {
  return method.toLowerCase() + "-" + path;
}

function boundRouteKeys(): Set<string> {
  const out = new Set<string>();
  for (const step of WORKFLOW === null ? [] : WORKFLOW.steps) {
    if (step.action !== null) out.add(step.action.formId);
  }
  return out;
}

/** Routes the rail already renders. The panels below it skip these, so a
 * step's control appears once, in the step. */
const BOUND_ROUTES = boundRouteKeys();

/** Does this panel still have anything to show once the rail has taken
 * its routes? Used by the page to decide whether the "Other actions"
 * heading has anything under it, and by the panel itself. One predicate,
 * so a heading can never appear above nothing. */
function panelIsVisible(panel: PanelDescriptor): boolean {
  const list = panel.list;
  if (list !== null && !BOUND_ROUTES.has(routeKey("GET", list.path))) return true;
  return panel.forms.some((form) => !BOUND_ROUTES.has(form.id));
}

function formFor(formId: string): FormDescriptor | null {
  for (const panel of PANELS) {
    for (const form of panel.forms) {
      if (form.id === formId) return form;
    }
  }
  return null;
}

/** Where a step stands, from the only evidence this app has: the proposals
 * it wrote itself, plus anything filed during this session.
 *
 * "Proposed" is terminal here on purpose. The proposal sits in the approval
 * Inbox and a human resolves it; nothing this page can call would advance
 * it, and drawing a tick would claim otherwise. */
function statusOf(
  step: StepDescriptor,
  steps: StepDescriptor[],
  proposals: string[],
  filed: Record<number, string>,
): StepStatus {
  const local = filed[step.n];
  if (step.action === null) {
    return { state: "manual", blockedBy: null, proposalPath: null };
  }
  const prefix = step.action.proposalPrefix;
  const match = prefix === null ? undefined : proposals.find((name) => name.startsWith(prefix));
  if (local !== undefined || match !== undefined) {
    const fromList = match === undefined ? null : "memory/proposals/" + match;
    const path = local !== undefined && local.length > 0 ? local : fromList;
    return { state: "proposed", blockedBy: null, proposalPath: path };
  }
  for (const earlier of steps) {
    if (earlier.n >= step.n || earlier.action === null) continue;
    const earlierPrefix = earlier.action.proposalPrefix;
    if (earlierPrefix === null) continue;
    const done = filed[earlier.n] !== undefined || proposals.some((name) => name.startsWith(earlierPrefix));
    if (!done) return { state: "waiting", blockedBy: earlier.n, proposalPath: null };
  }
  return { state: "ready", blockedBy: null, proposalPath: null };
}

function gateChip(gate: StepDescriptor["gate"]): { tone: string; label: string } {
  if (gate === "statutory") return { tone: "red", label: "Statutory gate" };
  if (gate === "auto") return { tone: "green", label: "Auto" };
  return { tone: "blue", label: "Human review" };
}

function stateChip(status: StepStatus): { tone: string; label: string } {
  if (status.state === "proposed") return { tone: "amber", label: "Proposed — with a human" };
  if (status.state === "ready") return { tone: "orange", label: "Ready" };
  if (status.state === "waiting") return { tone: "", label: "Waiting on step " + String(status.blockedBy ?? 0) };
  return { tone: "", label: "Outside this app" };
}

function MetaLine({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div style={metaRow}>
      <span className="muted" style={metaLabel}>
        {label}
      </span>
      {items.map((item) => (
        <Chip key={item} tone="">
          {item}
        </Chip>
      ))}
    </div>
  );
}

/** A step whose action only READS: no body to build, so it gets a button
 * that loads and a table, not a form. */
function StepReader({ action }: { action: StepAction }) {
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      setRows(asRows(await call(action.method, action.path)));
    } catch (err) {
      setRows(null);
      setRefusal(refusalOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className="small" onClick={() => void load()} disabled={busy} aria-busy={busy}>
        {busy ? "Working…" : action.label}
      </button>
      {refusal && <RefusalBox refusal={refusal} />}
      {rows !== null && <RowTable rows={rows} />}
    </div>
  );
}

function StepCard({
  step,
  status,
  onFiled,
}: {
  step: StepDescriptor;
  status: StepStatus;
  onFiled: (n: number, proposalPath: string | null) => void;
}) {
  const action = step.action;
  const form = action === null ? null : formFor(action.formId);
  const gate = gateChip(step.gate);
  const state = stateChip(status);
  return (
    <li style={stepStyle} data-step={step.n} data-state={status.state} data-gate={step.gate}>
      <span className="mono" style={badgeStyle(status.state)}>
        {step.n}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={headRow}>
          <span style={titleStyle}>{step.title}</span>
          <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <Chip tone={gate.tone}>{gate.label}</Chip>
            <Chip tone={state.tone}>{state.label}</Chip>
          </span>
        </div>
        {step.detail !== null && (
          <p className="muted" style={detailStyle}>
            {step.detail}
          </p>
        )}
        <MetaLine label="Needs" items={step.needs} />
        <MetaLine label="Produces" items={step.produces} />
        {status.proposalPath !== null && (
          <div className="okbox" role="status" style={{ marginTop: 8 }}>
            Filed for approval — <code className="mono">{status.proposalPath}</code>. A person resolves it in the Inbox; this
            app cannot.
          </div>
        )}
        {action === null ? (
          <p className="muted" style={detailStyle}>
            This step happens outside this app.
          </p>
        ) : (
          <div style={actionRow}>
            {status.state === "waiting" && (
              <p className="muted" style={{ margin: "0 0 6px", fontSize: 12 }}>
                Step {status.blockedBy} has no proposal from this app yet. If it was done elsewhere, carry on.
              </p>
            )}
            {form === null ? (
              <StepReader action={action} />
            ) : (
              <RouteForm form={form} onDone={(answer) => onFiled(step.n, proposalPathOf(answer))} />
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function proposalPathOf(answer: unknown): string | null {
  const path = (answer as { proposalPath?: unknown } | null)?.proposalPath;
  return typeof path === "string" ? path : null;
}

function WorkflowRail({ workflow }: { workflow: WorkflowDescriptor | null }) {
  const [proposals, setProposals] = useState<string[]>([]);
  const [filed, setFiled] = useState<Record<number, string>>({});
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const proposalsPath = workflow === null ? null : workflow.proposalsPath;

  const load = useCallback(async () => {
    if (proposalsPath === null) return;
    try {
      setProposals(proposalNames(await call("GET", proposalsPath)));
      setRefusal(null);
    } catch (err) {
      setRefusal(refusalOf(err));
    }
  }, [proposalsPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const onFiled = useCallback(
    (n: number, proposalPath: string | null) => {
      setFiled((prev) => ({ ...prev, [n]: proposalPath ?? "" }));
      void load();
    },
    [load],
  );

  if (workflow === null) return null;

  const steps = workflow.steps;
  const statuses = steps.map((step) => statusOf(step, steps, proposals, filed));
  const proposable = steps.filter((step) => step.action !== null && step.action.proposalPrefix !== null).length;
  const proposed = statuses.filter((status) => status.state === "proposed").length;
  const percent = proposable === 0 ? 0 : Math.round((proposed / proposable) * 100);
  const elsewhere = steps.length - proposable;

  return (
    <section data-workflow={workflow.name}>
      <div style={summaryRow}>
        {/* ⭐ THE DENOMINATOR IS NOT THE WORKFLOW, AND NOW IT SAYS SO.
            This read "0 of 2 proposable steps filed" beside a half-page
            progress track, on a SIX-step workflow. The words were accurate and
            the composition was not: the most prominent number on the page
            measured a third of the procedure, and an empty bar next to it
            reads as "nothing has happened" about all of it — when four of the
            six steps were never this app's to do. The count of steps that
            happen elsewhere is the missing half of the sentence. */}
        <span className="chip">
          <b className="mono">{String(proposed)}</b> of <b className="mono">{String(proposable)}</b>{" "}
          {proposable === 1 ? "step" : "steps"} this app can file
        </span>
        <span className="progress" style={trackStyle}>
          <span className="fill" style={{ width: String(percent) + "%" }} />
        </span>
        {elsewhere > 0 && (
          <span className="muted" style={{ fontSize: 12 }}>
            {String(elsewhere)} of {String(steps.length)} happen outside this app
          </span>
        )}
        {workflow.source !== null && (
          // The skill this workflow was converted FROM. It is provenance, not
          // navigation, so it stops competing with the numbers beside it.
          <span className="muted mono" style={{ fontSize: 11, opacity: 0.75 }}>
            from {workflow.source}
          </span>
        )}
      </div>
      {proposalsPath === null && (
        <p className="muted" style={{ margin: "0 0 12px", fontSize: 12 }}>
          This app declares no proposal listing, so step state is only what you file in this session.
        </p>
      )}
      {refusal && <RefusalBox refusal={refusal} />}
      <ol style={railStyle}>
        {steps.map((step, index) => (
          <StepCard
            key={step.n}
            step={step}
            status={statuses[index] ?? { state: "manual", blockedBy: null, proposalPath: null }}
            onFiled={onFiled}
          />
        ))}
      </ol>
    </section>
  );
}`;

const PANEL_RENDERER = `function Panel({ panel }: { panel: PanelDescriptor }) {
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const listPath = panel.list === null || BOUND_ROUTES.has(routeKey("GET", panel.list.path)) ? null : panel.list.path;
  const forms = panel.forms.filter((form) => !BOUND_ROUTES.has(form.id));

  const load = useCallback(async () => {
    if (listPath === null) return;
    setRefusal(null);
    try {
      setRows(asRows(await call("GET", listPath)));
    } catch (err) {
      setRows(null);
      setRefusal(refusalOf(err));
    }
  }, [listPath]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!panelIsVisible(panel)) return null;

  return (
    <section className="card" data-panel={panel.id}>
      <h3>{panel.title}</h3>
      {refusal && <RefusalBox refusal={refusal} />}
      {listPath !== null && !refusal && rows === null && <p className="muted">Loading…</p>}
      {rows !== null && <RowTable rows={rows} />}
      {forms.map((form) => (
        <RouteForm key={form.id} form={form} onDone={() => undefined} />
      ))}
    </section>
  );
}`;

const PAGE = `function GeneratedPage() {
  const panels = PANELS.filter(panelIsVisible);
  return (
    <div className="page">
      <div className="pagehead">
        <div className="eyebrow">{WORKFLOW === null ? "FLIGHTDECK MINI-APP" : "WORKFLOW"}</div>
        <h1>
          <span aria-hidden="true">{APP_ICON}</span> {APP_TITLE}
        </h1>
        <p>{WORKFLOW !== null && WORKFLOW.description !== null ? WORKFLOW.description : APP_BLURB}</p>
      </div>
      <WorkflowRail workflow={WORKFLOW} />
      {WORKFLOW !== null && panels.length > 0 && (
        <div style={{ margin: "0 0 10px" }}>
          <h3 style={{ margin: 0 }}>Other actions</h3>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 12 }}>
            Routes this app declares that no step above names.
          </p>
        </div>
      )}
      {panels.map((panel) => (
        <Panel key={panel.id} panel={panel} />
      ))}
    </div>
  );
}`;
