/** Studio's copy of the fixed runtime `emitters/web.ts` emits.
 *
 * ── WHAT THIS IS ────────────────────────────────────────────────────
 * The generated page is a `PANELS` literal plus a runtime that is
 * byte-identical in every sub-app. `descriptor.ts` parses the literal;
 * this file is the runtime. Every behaviour below exists because the
 * emitted runtime has it, and `RUNTIME_MARKERS` fingerprints each one in
 * the generated source — so if the emitter changes, the drift check
 * refuses the preview instead of letting this quietly show the old
 * behaviour. The marker ids are named in the comments that follow.
 *
 * ── THE ONE DELIBERATE ADDITION ─────────────────────────────────────
 * Conformance findings are drawn ON the panels they concern. That is
 * Studio's, not the generated page's, and it is marked as such in the UI:
 * every pin is labelled `Studio`, sits in its own `.fd-pin` styling, and
 * is the one thing on this frame that will not exist in the host. The
 * alternative — a findings list in a different pane — makes a person
 * correlate `routes/clocks.ts:14` with a panel by hand, and that
 * correlation is the whole value.
 *
 * ── WHAT IT DOES NOT COPY ───────────────────────────────────────────
 * `fetch`. Requests go to the `MockCapabilityHost` instead, which is the
 * point of the exercise — a Fastify route set cannot run in a browser, and
 * pretending otherwise would be the fake preview this design exists to
 * avoid. The paths and the refusal shapes are real; the server is not. */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { MockCapabilityHost } from "../preview/adapter";
import type { FieldDescriptor, FormDescriptor, PanelDescriptor, WebModule } from "../preview/descriptor";
import type { Finding } from "../types";

interface Refusal {
  readonly status: number | null;
  readonly code: string | null;
  readonly scope: string | null;
  readonly detail: string;
}

class ApiRefusal extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.detail);
  }
}

type Call = (method: string, path: string, body?: unknown) => Promise<unknown>;

/** The emitted `call`, over the mock instead of `fetch` (marker
 * `fetch-prefix`, `refusal-class`). Async although the mock answers
 * synchronously, so the page's loading states are exercised rather than
 * skipped — a preview where nothing is ever pending hides the state a
 * person is most likely to have got wrong. */
function makeCall(host: MockCapabilityHost, onActivity: () => void): Call {
  return async (method, path, body) => {
    const res = host.handle(body === undefined ? { method, path } : { method, path, body });
    // The pane's request log, the audit trail and the proposal list are all
    // views of the adapter's state, and they are only interesting the
    // instant after a request. Telling the pane here is what keeps them
    // live without the pane polling an object it does not own.
    onActivity();
    await Promise.resolve();
    const parsed = res.body as Record<string, unknown> | null;
    if (res.status < 200 || res.status >= 300) {
      const issues = Array.isArray(parsed?.issues)
        ? (parsed.issues as Array<{ message?: string }>)
            .map((i) => i.message ?? "")
            .filter((m) => m.length > 0)
            .join("; ")
        : "";
      throw new ApiRefusal({
        status: res.status,
        code: typeof parsed?.code === "string" ? parsed.code : null,
        scope: typeof parsed?.scope === "string" ? parsed.scope : null,
        detail:
          issues.length > 0
            ? issues
            : typeof parsed?.error === "string"
              ? parsed.error
              : JSON.stringify(res.body).slice(0, 300),
      });
    }
    return parsed;
  };
}

/** One sentence per REAL condition a generated route can answer — routed
 * on the status and the body's `code`, never on the server's prose.
 * Markers `refusal-400`, `refusal-disabled`, `refusal-capability`. */
function refusalText(r: Refusal): string {
  if (r.status === 400) return "The server refused this input.";
  if (r.status === 403 && r.code === "subapp_disabled") return "This app is not enabled for this workspace.";
  if (r.status === 403 && r.code === "capability_denied") {
    return `This app's access to ${r.scope ?? "a capability"} is not granted here.`;
  }
  if (r.status === 403) return "Your role may not use this app.";
  if (r.status === 404) return "That record is not here any more — reload.";
  if (r.status === null) return "The server could not be reached.";
  return `The server answered ${String(r.status)}.`;
}

function RefusalBox({ refusal }: { readonly refusal: Refusal }) {
  return (
    <div className="errorbox" role="alert" data-status={refusal.status ?? "network"} data-code={refusal.code ?? ""}>
      {refusalText(refusal)}
      {refusal.detail.length > 0 && <code className="mono">{refusal.detail}</code>}
    </div>
  );
}

function toRefusal(error: unknown): Refusal {
  return error instanceof ApiRefusal
    ? error.refusal
    : { status: null, code: null, scope: null, detail: String(error) };
}

/** Marker `rows-shape`: a list answer is `{ rows }` or a bare array. */
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

function RowTable({ rows }: { readonly rows: ReadonlyArray<Record<string, unknown>> }) {
  if (rows.length === 0) return <p className="muted">Nothing here yet.</p>;
  const columns = Object.keys(rows[0] ?? {});
  return (
    <table>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column}>{column}</th>
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

/** Studio's annotation, not the generated page's. Labelled so nobody
 * mistakes it for something that will appear in the host. */
function FindingPin({ finding }: { readonly finding: Finding }) {
  return (
    <div className={`fd-pin${finding.severity === "error" ? " fd-pin--error" : ""}`}>
      <span className="fd-pin__rule">Studio · {finding.rule}</span>
      <span>
        {finding.message}
        {finding.line > 0 ? ` (${finding.file.split("/").pop() ?? finding.file}:${finding.line})` : ""}
      </span>
    </div>
  );
}

function fieldValue(field: FieldDescriptor, values: Record<string, string | boolean>): unknown {
  const raw = values[field.name];
  if (field.control === "checkbox") return raw === true;
  const text = typeof raw === "string" ? raw.trim() : "";
  // The emitted form posts "" for a blank REQUIRED field and omits an
  // optional one. That asymmetry is what produces the server's real 400,
  // so the mirror keeps it exactly.
  if (text.length === 0) return field.optional ? undefined : "";
  return field.control === "number" ? Number(text) : text;
}

function RouteForm({
  form,
  call,
  onDone,
}: {
  readonly form: FormDescriptor;
  readonly call: Call;
  readonly onDone: () => void;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    setOk(null);

    const body: Record<string, unknown> = {};
    for (const field of form.fields) {
      const value = fieldValue(field, values);
      if (value !== undefined) body[field.name] = value;
    }
    try {
      setOk(JSON.stringify(await call(form.method, form.path, body)));
      setValues({});
      onDone();
    } catch (error) {
      setRefusal(toRefusal(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} data-form={form.id}>
      <h4>{form.label}</h4>
      {form.fields.map((field) => {
        const value = values[field.name];
        return (
          <label key={field.name}>
            <span>
              {field.label}
              {field.optional ? " (optional)" : ""}
            </span>
            {field.control === "checkbox" ? (
              <input
                type="checkbox"
                checked={value === true}
                onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.checked }))}
              />
            ) : field.control === "select" ? (
              <select
                value={typeof value === "string" ? value : ""}
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
                value={typeof value === "string" ? value : ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
              />
            )}
          </label>
        );
      })}
      <button type="submit" disabled={busy} aria-busy={busy}>
        {busy ? "Working…" : "Submit"}
      </button>
      {refusal !== null && <RefusalBox refusal={refusal} />}
      {ok !== null && (
        <div className="okbox" role="status">
          <code className="mono">{ok}</code>
        </div>
      )}
    </form>
  );
}

function Panel({
  panel,
  call,
  generation,
  findings,
}: {
  readonly panel: PanelDescriptor;
  readonly call: Call;
  readonly generation: number;
  readonly findings: readonly Finding[];
}) {
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const listPath = panel.list?.path ?? null;

  const load = useCallback(async () => {
    if (listPath === null) return;
    setRefusal(null);
    try {
      setRows(asRows(await call("GET", listPath)));
    } catch (error) {
      setRows(null);
      setRefusal(toRefusal(error));
    }
  }, [listPath, call]);

  // `generation` bumps when an enable layer is toggled. The real page
  // would not re-fetch on its own — but a person flipping the kill switch
  // is asking "what does this look like now", and answering with the rows
  // from before the flip would be the wrong answer to that question.
  useEffect(() => {
    void load();
  }, [load, generation]);

  return (
    <section className="card" data-panel={panel.id}>
      <h3>{panel.title}</h3>
      {findings.map((finding, i) => (
        <FindingPin key={`${finding.rule}-${finding.line}-${i}`} finding={finding} />
      ))}
      {refusal !== null && <RefusalBox refusal={refusal} />}
      {listPath !== null && refusal === null && rows === null && <p className="muted">Loading…</p>}
      {rows !== null && <RowTable rows={rows} />}
      {panel.forms.map((form) => (
        <RouteForm key={form.id} form={form} call={call} onDone={() => void load()} />
      ))}
    </section>
  );
}

interface Props {
  readonly module: WebModule;
  readonly host: MockCapabilityHost;
  /** Changes when an enable layer is toggled, forcing every panel to
   * reload against the new state. */
  readonly generation: number;
  /** Findings pinned to the page as a whole. */
  readonly pageFindings: readonly Finding[];
  readonly findingsForPanel: (panelId: string) => readonly Finding[];
  /** Called after every request the page makes, so the pane beside the
   * frame can re-read the adapter's log, audit trail and proposals. */
  readonly onActivity: () => void;
}

export function GeneratedPageMirror({
  module,
  host,
  generation,
  pageFindings,
  findingsForPanel,
  onActivity,
}: Props) {
  const call = useMemo(() => makeCall(host, onActivity), [host, onActivity]);
  return (
    <div className="page">
      <h2>{module.title}</h2>
      {module.blurb.length > 0 && <p className="muted">{module.blurb}</p>}
      {pageFindings.map((finding, i) => (
        <FindingPin key={`${finding.rule}-${finding.line}-${i}`} finding={finding} />
      ))}
      {module.panels.length === 0 && (
        <p className="muted">This page declares no panels — the spec produced no routes to show.</p>
      )}
      {module.panels.map((panel) => (
        <Panel
          key={panel.id}
          panel={panel}
          call={call}
          generation={generation}
          findings={findingsForPanel(panel.id)}
        />
      ))}
    </div>
  );
}
