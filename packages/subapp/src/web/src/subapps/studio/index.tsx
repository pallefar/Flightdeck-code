/** Studio's page — the front end a person uses inside the console.
 *
 * Paste a Cowork workflow, see what Studio read out of it, see what the
 * contract gate said about the files it would generate, and file the proposal.
 *
 * ⭐ THE ONE THING THIS PAGE MUST NEVER LET SOMEBODY MISBELIEVE is that the
 * button installs an app. It does not. Studio runs as a sub-app, a sub-app
 * route reaches the host only through the injected capability adapter, and that
 * adapter has no filesystem write — so the furthest this page can go is ONE
 * file under `memory/proposals/`. A human applies it. That sentence is on the
 * screen before anything is pasted, on the button itself, and in the answer
 * afterwards, because it is the product's shape and not a disclaimer.
 *
 * ── THREE DELIBERATE PROPERTIES, EACH FORCED BY THE HOST ────────────────
 * 1. It calls `fetch` through a local helper rather than the host's `api`
 *    client. Adding a method to `web/src/api.ts` would be a second host edit
 *    beside this sub-app's own directories, and a page that quietly required
 *    one would be a page that does not actually drop in.
 * 2. Its strings are literal English, not `t()` keys — forced, not preferred.
 *    `import.meta.glob` covers the web MODULE but not i18n: a dictionary needs
 *    a hand-written static import plus a spread in `web/src/i18n.ts`, AND an
 *    update to the EXACT frozen key counts in `tests/subapps/i18nSplit.test.ts`
 *    (`TOTAL_KEYS = 4071`, not `toBeGreaterThan`). Shipping one i18n key turns
 *    a host test red. The floor, `shell-reference`, ships no dictionary either.
 *    ⚠ Known gap, stated rather than hidden: this page is English-only.
 * 3. It ships NO stylesheet. `find web/src/subapps -name '*.css'` returns zero
 *    in the host — every sub-app's CSS lives in a banner-delimited region of
 *    the shared `web/src/theme.css`. So the classes below are the host's own
 *    (`page`, `pagehead`, `eyebrow`, `card`, `chip` + its tone modifiers,
 *    `mono`, `muted`, `errorbox`, `okbox`), and what no host class covers is an
 *    inline style whose every colour is `var(--token, <literal>)`: the token so
 *    the page follows the host's theme toggle, the literal so it still reads
 *    correctly anywhere the stylesheet has not loaded.
 *
 * Refusals are routed on the HTTP status and the body's `code`, never on the
 * server's prose — that prose is developer-facing English, and splicing it into
 * a sentence is how a person ends up reading a stack trace fragment. */
import { useCallback, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import type { SubAppModule } from "../registry";

const ROUTE_PREFIX = "/api/apps/studio";

const T = {
  bg: "var(--bg, #07090d)",
  surface: "var(--surface, #11161f)",
  ink: "var(--ink, #eef2f7)",
  muted: "var(--muted, #8b96a5)",
  line: "var(--line, #1f2733)",
  accent: "var(--te, #ff8200)",
  green: "var(--green, #2fd472)",
  amber: "var(--amber, #ffc24b)",
  red: "var(--red, #ff5b4d)",
} as const;

/* ── What the server can answer ─────────────────────────────────────────── */

interface Refusal {
  status: number | null;
  code: string | null;
  scope: string | null;
  detail: string;
}

interface Question {
  id: string;
  field: string;
  severity: string;
  question: string;
  because: string;
  options: string[] | null;
}

interface PlanWarning {
  code: string;
  message: string;
}

interface Finding {
  rule: string;
  severity: string;
  file: string;
  line: number;
  column: number;
  message: string;
  evidence: string | null;
}

interface StepSummary {
  ordinal: string;
  title: string;
  kind: "display" | "read" | "propose";
  gated: boolean;
}

interface SpecSummary {
  id: string;
  label: string;
  icon: string;
  version: string;
  minHostVersion: string;
  navSection: string;
  routePrefix: string;
  webModuleId: string;
  enableEnvVar: string;
  purpose: string;
  capabilities: string[];
  visibleToRoles: string[];
  steps: StepSummary[];
}

interface GateSummary {
  ok: boolean;
  checks: string[];
  findings: Finding[];
  errors: Finding[];
  warnings: Finding[];
  filesChecked: number;
}

interface FileSummary {
  path: string;
  kind: string;
  bytes: number;
}

interface RegistryEdit {
  file: string;
  importLine: string;
  entryLines: string[];
}

type Conversion =
  | { status: "needs_input"; understanding: string; questions: Question[]; warnings: PlanWarning[] }
  | {
      status: "blocked";
      understanding: string;
      rule: string;
      explanation: string;
      evidence: string;
      evidenceGrounded: boolean;
      contractRule: string;
    }
  | { status: "unreadable"; issues: string[] }
  | { status: "rejected"; issues: string[] }
  | { status: "gate_blocked"; subAppId: string; gate: GateSummary; warnings: string[] }
  | {
      status: "ready";
      understanding: string;
      subAppId: string;
      label: string;
      spec: SpecSummary;
      fileSummaries: FileSummary[];
      registry: RegistryEdit;
      gate: GateSummary;
      warnings: string[];
    };

interface Proposed {
  status: "proposed" | "already_proposed";
  subAppId: string;
  proposalPath: string;
  note: string;
}

/** `POST /proposals` answers either arm: the proposal it filed, or the refusal
 * it would have shown in a preview — because the workflow in the textarea can
 * have been edited between the two calls. */
function isProposed(answer: Conversion | Proposed): answer is Proposed {
  return answer.status === "proposed" || answer.status === "already_proposed";
}

/* ── The client ─────────────────────────────────────────────────────────── */

class ApiRefusal extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.detail);
  }
}

function refusalOf(err: unknown): Refusal {
  return err instanceof ApiRefusal ? err.refusal : { status: null, code: null, scope: null, detail: String(err) };
}

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  // Built up rather than passed with undefined members: the host compiles under
  // exactOptionalPropertyTypes, where `headers: undefined` is an error.
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
  // 422 is not a transport failure — it is the pipeline's considered refusal,
  // and the body IS the answer. Only a genuine transport/permission problem
  // becomes a Refusal.
  if (res.status === 422 && parsed !== null) return parsed;
  if (!res.ok) {
    const raw = parsed === null || !Array.isArray(parsed.issues) ? [] : (parsed.issues as Array<{ message?: string }>);
    const issues = raw
      .map((i) => i.message ?? "")
      .filter((m) => m.length > 0)
      .join("; ");
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

/** One sentence per REAL condition, routed on the status and the body's code. */
function refusalText(r: Refusal): string {
  if (r.status === 400) return "The server refused this input.";
  if (r.status === 403 && r.code === "subapp_disabled") return "Studio is not enabled for this workspace.";
  if (r.status === 403 && r.code === "capability_denied") {
    return "Studio's access to " + (r.scope ?? "a capability") + " is not granted here.";
  }
  if (r.status === 403) return "Your role may not use this app.";
  if (r.status === null) return "The server could not be reached.";
  return "The server answered " + String(r.status) + ".";
}

/* ── Styles the host's classes do not cover ─────────────────────────────── */

const noticeStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "flex-start",
  padding: "12px 16px",
  borderRadius: 14,
  border: "1px solid " + T.line,
  borderLeft: "3px solid " + T.accent,
  background: T.surface,
  margin: "0 0 20px",
};
const areaStyle: CSSProperties = {
  width: "100%",
  minHeight: 220,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  lineHeight: 1.55,
  padding: 12,
  borderRadius: 12,
  border: "1px solid " + T.line,
  background: T.bg,
  color: T.ink,
  resize: "vertical",
};
const rowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 12 };
const gridStyle: CSSProperties = { display: "grid", gap: 6, margin: "10px 0 0" };
const factStyle: CSSProperties = { display: "grid", gridTemplateColumns: "150px minmax(0, 1fr)", gap: 10, fontSize: 13 };
const railStyle: CSSProperties = { listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 8 };
const stepStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "34px minmax(0, 1fr)",
  gap: 12,
  alignItems: "start",
  padding: "10px 14px",
  borderRadius: 14,
  border: "1px solid " + T.line,
  background: T.surface,
};
const ordinalStyle: CSSProperties = {
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
const findingStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid " + T.line,
  background: T.bg,
  fontSize: 12,
  marginTop: 6,
};
const labelStyle: CSSProperties = { minWidth: 130, fontSize: 12, color: T.muted };
const questionStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid " + T.line,
  background: T.bg,
  marginTop: 10,
};

function Chip({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={tone.length > 0 ? "chip " + tone : "chip"}>{children}</span>;
}

function RefusalBox({ refusal }: { refusal: Refusal }) {
  return (
    <div className="errorbox" role="alert" data-status={refusal.status ?? "network"} data-code={refusal.code ?? ""}>
      {refusalText(refusal)} {refusal.detail.length > 0 && <code className="mono">{refusal.detail}</code>}
    </div>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  return (
    <div style={findingStyle} data-rule={finding.rule} data-severity={finding.severity}>
      <Chip tone={finding.severity === "error" ? "red" : "amber"}>{finding.rule}</Chip>{" "}
      <span className="mono">{finding.file}</span>
      {finding.line > 0 && <span className="muted">{":" + String(finding.line)}</span>} — {finding.message}
      {finding.evidence !== null && finding.evidence.length > 0 && (
        <div className="mono muted" style={{ marginTop: 4 }}>
          {finding.evidence}
        </div>
      )}
    </div>
  );
}

function GatePanel({ gate }: { gate: GateSummary }) {
  return (
    <div data-gate-ok={gate.ok ? "true" : "false"}>
      <div style={rowStyle}>
        <Chip tone={gate.ok ? "green" : "red"}>{gate.ok ? "Contract gate passed" : "Contract gate blocked"}</Chip>
        <span className="muted">
          {String(gate.checks.length)} checks ran over {String(gate.filesChecked)} files
          {gate.errors.length > 0 && ", " + String(gate.errors.length) + " blocking"}
          {gate.warnings.length > 0 && ", " + String(gate.warnings.length) + " advisory"}
        </span>
      </div>
      {gate.checks.length > 0 && (
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
          Checked: {gate.checks.join(", ")}.
        </p>
      )}
      {gate.findings.map((finding, i) => (
        <FindingRow key={finding.rule + String(i)} finding={finding} />
      ))}
    </div>
  );
}

function StepRail({ steps }: { steps: StepSummary[] }) {
  return (
    <ul style={railStyle}>
      {steps.map((step) => (
        <li key={step.ordinal} style={stepStyle} data-step={step.ordinal} data-kind={step.kind}>
          <span style={ordinalStyle}>{step.ordinal}</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: T.ink }}>{step.title}</div>
            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
              <Chip tone={step.kind === "propose" ? "amber" : step.kind === "read" ? "blue" : ""}>{step.kind}</Chip>
              {step.gated && <Chip tone="red">A person decides this</Chip>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ── The page ───────────────────────────────────────────────────────────── */

function StudioPage() {
  const [workflow, setWorkflow] = useState("");
  const [source, setSource] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [conversion, setConversion] = useState<Conversion | null>(null);
  const [filed, setFiled] = useState<Proposed | null>(null);
  const [onFile, setOnFile] = useState<string[] | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "propose">("");

  const loadProposals = useCallback(async () => {
    try {
      const answer = (await call("GET", "/proposals")) as { proposals?: unknown } | null;
      const list = answer === null || !Array.isArray(answer.proposals) ? [] : (answer.proposals as string[]);
      setOnFile(list);
    } catch {
      // A page that cannot list what is on file is still a page that can
      // convert. The refusal that matters is the one on the action a person
      // just took, not on a background read they did not ask for.
      setOnFile(null);
    }
  }, []);

  useEffect(() => {
    void loadProposals();
  }, [loadProposals]);

  const body = useCallback((): Record<string, unknown> => {
    const payload: Record<string, unknown> = { workflow };
    if (Object.keys(answers).length > 0) payload.answers = answers;
    if (source.trim().length > 0) payload.source = source.trim();
    return payload;
  }, [workflow, answers, source]);

  const preview = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (busy !== "" || workflow.trim().length === 0) return;
      setBusy("preview");
      setRefusal(null);
      setFiled(null);
      try {
        setConversion((await call("POST", "/preview", body())) as Conversion);
      } catch (err) {
        setConversion(null);
        setRefusal(refusalOf(err));
      } finally {
        setBusy("");
      }
    },
    [busy, workflow, body],
  );

  const propose = useCallback(async () => {
    if (busy !== "" || conversion === null || conversion.status !== "ready") return;
    setBusy("propose");
    setRefusal(null);
    try {
      const answer = (await call("POST", "/proposals", body())) as Conversion | Proposed;
      if (isProposed(answer)) {
        setFiled(answer);
        await loadProposals();
      } else {
        // The workflow was edited between preview and file, and now refuses.
        setConversion(answer);
      }
    } catch (err) {
      setRefusal(refusalOf(err));
    } finally {
      setBusy("");
    }
  }, [busy, conversion, body, loadProposals]);

  return (
    <div className="page">
      <div className="pagehead">
        <div className="eyebrow">Flightdeck Studio</div>
        <h2>Convert a Cowork workflow into a mini-app</h2>
      </div>

      {/* Said before anything is pasted, because it is the shape of the
          product and not a footnote to it. */}
      <div style={noticeStyle} role="note">
        <span aria-hidden="true" style={{ fontSize: 18, lineHeight: "20px" }}>
          🛠️
        </span>
        <div>
          <strong>Studio proposes. It does not install.</strong>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Filing a proposal writes exactly one file under <span className="mono">memory/proposals/</span> and changes
            nothing else. The generated source stays text until a human adds those files to the host repo and makes the{" "}
            <span className="mono">registry.ts</span> edit. Studio has no filesystem write — the capability adapter it
            runs behind does not have one — so there is no path here that could install an app, only one that asks.
          </p>
        </div>
      </div>

      <div className="card">
        <h3>The workflow</h3>
        <p className="muted">
          Paste a Cowork workflow — YAML frontmatter with <span className="mono">name</span> and{" "}
          <span className="mono">description</span>, then a <span className="mono">## Procedure</span> of numbered
          steps. Studio reads the markdown you post; it never opens a file, because a sub-app route has no filesystem
          read.
        </p>
        <form onSubmit={(event) => void preview(event)}>
          <textarea
            style={areaStyle}
            value={workflow}
            spellCheck={false}
            aria-label="Workflow markdown"
            placeholder={"---\nname: my-workflow\ndescription: …\n---\n\n## Procedure\n1. **Read state** — …"}
            onChange={(event) => setWorkflow(event.target.value)}
          />
          <div style={rowStyle}>
            <label style={labelStyle} htmlFor="studio-source">
              Where it came from
            </label>
            <input
              id="studio-source"
              value={source}
              placeholder="skills/orchestrate-workflow/SKILL.md"
              onChange={(event) => setSource(event.target.value)}
              style={{
                flex: "1 1 260px",
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid " + T.line,
                background: T.bg,
                color: T.ink,
              }}
            />
          </div>
          <div style={rowStyle}>
            <button type="submit" disabled={busy !== "" || workflow.trim().length === 0} aria-busy={busy === "preview"}>
              {busy === "preview" ? "Reading…" : "Read the workflow"}
            </button>
            <span className="muted">Runs the spec reader, the generator and the contract gate. Writes nothing.</span>
          </div>
        </form>
        {refusal !== null && <RefusalBox refusal={refusal} />}
      </div>

      {onFile !== null && onFile.length > 0 && (
        <div className="card">
          <h3>Already on file</h3>
          <p className="muted">
            Proposals Studio has filed and nobody has resolved yet. Each one is a sub-app waiting for a human in the
            Inbox.
          </p>
          <ul style={gridStyle}>
            {onFile.map((name) => (
              <li key={name} className="mono">
                memory/proposals/{name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {conversion !== null && conversion.status === "needs_input" && (
        <div className="card" data-status="needs_input">
          <h3>Studio needs a few answers first</h3>
          <p className="muted">{conversion.understanding}</p>
          <p className="muted">
            None of these is guessable. <span className="mono">navSection</span> is matched by exact string equality
            against the host&apos;s own five sections, and a manifest that gets a required field wrong takes the whole
            server down at boot — so Studio asks instead of choosing.
          </p>
          {conversion.questions.map((question) => (
            <div key={question.id} style={questionStyle} data-question={question.id}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{question.question}</div>
              <div className="muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>
                {question.because}
              </div>
              {question.options === null ? (
                <input
                  value={answers[question.id] ?? ""}
                  aria-label={question.question}
                  onChange={(event) => setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))}
                  style={{
                    width: "100%",
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid " + T.line,
                    background: T.surface,
                    color: T.ink,
                  }}
                />
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {question.options.map((option) => {
                    const chosen = (answers[question.id] ?? "").split(/,\s*/).includes(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={chosen}
                        onClick={() =>
                          setAnswers((prev) => {
                            // Several roles can be right at once; one nav
                            // section and one icon cannot. The field says
                            // which, so the control follows the field rather
                            // than asking the person to know.
                            const multi = question.field === "visibleToRoles";
                            if (!multi) return { ...prev, [question.id]: option };
                            const current = (prev[question.id] ?? "").split(/,\s*/).filter((v) => v.length > 0);
                            const next = current.includes(option)
                              ? current.filter((v) => v !== option)
                              : [...current, option];
                            return { ...prev, [question.id]: next.join(", ") };
                          })
                        }
                        style={{
                          padding: "4px 10px",
                          borderRadius: 99,
                          border: "1px solid " + (chosen ? T.accent : T.line),
                          background: chosen ? T.accent : T.surface,
                          color: chosen ? "#0b0f16" : T.ink,
                          fontSize: 12,
                        }}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          <div style={rowStyle}>
            <button type="button" disabled={busy !== ""} onClick={() => void preview()}>
              {busy === "preview" ? "Reading…" : "Read it again with these answers"}
            </button>
          </div>
        </div>
      )}

      {conversion !== null && conversion.status === "blocked" && (
        <div className="card" data-status="blocked">
          <h3>Refused</h3>
          <div className="errorbox" role="alert">
            {conversion.explanation}
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            The sentence this is about{conversion.evidenceGrounded ? "" : " (paraphrased — not found verbatim)"}:
          </p>
          <blockquote className="mono" style={findingStyle}>
            {conversion.evidence}
          </blockquote>
          <p className="muted">
            {conversion.contractRule} — a mini-app may show a gated step and stop there. It may never advance, approve
            or resolve one. This is not narrowed or asked about; it is refused.
          </p>
        </div>
      )}

      {conversion !== null && (conversion.status === "unreadable" || conversion.status === "rejected") && (
        <div className="card" data-status={conversion.status}>
          <h3>{conversion.status === "unreadable" ? "That does not read as a workflow" : "Not generatable"}</h3>
          {conversion.issues.map((issue, i) => (
            <div key={String(i)} className="errorbox" role="alert">
              {issue}
            </div>
          ))}
        </div>
      )}

      {conversion !== null && conversion.status === "gate_blocked" && (
        <div className="card" data-status="gate_blocked">
          <h3>The contract gate blocked this app</h3>
          <p className="muted">
            The files were generated and then judged, and they broke the sub-app contract. Nothing was written and no
            proposal was filed. A generated sub-app that violates the manifest schema does not get skipped at boot — it
            takes the whole Flightdeck server down, along with every other sub-app on it.
          </p>
          <GatePanel gate={conversion.gate} />
        </div>
      )}

      {conversion !== null && conversion.status === "ready" && (
        <>
          <div className="card" data-status="ready" data-subapp={conversion.subAppId}>
            <h3>
              {conversion.spec.icon} {conversion.label}
            </h3>
            <p className="muted">{conversion.understanding}</p>
            <div style={gridStyle}>
              <div style={factStyle}>
                <span className="muted">Sub-app id</span>
                <span className="mono">{conversion.spec.id}</span>
              </div>
              <div style={factStyle}>
                <span className="muted">Nav section</span>
                <span>{conversion.spec.navSection}</span>
              </div>
              <div style={factStyle}>
                <span className="muted">Route prefix</span>
                <span className="mono">{conversion.spec.routePrefix}</span>
              </div>
              <div style={factStyle}>
                <span className="muted">Kill switch</span>
                <span className="mono">{conversion.spec.enableEnvVar}</span>
              </div>
              <div style={factStyle}>
                <span className="muted">Host floor</span>
                <span className="mono">{conversion.spec.minHostVersion}</span>
              </div>
              <div style={factStyle}>
                <span className="muted">Capabilities</span>
                <span>
                  {conversion.spec.capabilities.length === 0 ? (
                    <span className="muted">none — the app only shows things</span>
                  ) : (
                    conversion.spec.capabilities.map((c) => (
                      <Chip key={c} tone="amber">
                        {c}
                      </Chip>
                    ))
                  )}
                </span>
              </div>
              <div style={factStyle}>
                <span className="muted">Visible to</span>
                <span>
                  {conversion.spec.visibleToRoles.map((r) => (
                    <Chip key={r} tone="">
                      {r}
                    </Chip>
                  ))}
                </span>
              </div>
              <div style={factStyle}>
                <span className="muted">Tables</span>
                <span>
                  <Chip tone="green">none</Chip>{" "}
                  <span className="muted">a mini-app is database-free: no schema.ts, no DDL, no migration</span>
                </span>
              </div>
            </div>
            <p className="muted" style={{ marginTop: 12 }}>
              {conversion.spec.purpose}
            </p>
          </div>

          <div className="card">
            <h3>The procedure, as the app will show it</h3>
            <p className="muted">
              The steps in the document&apos;s own order and its own numbering. A step marked &ldquo;a person decides
              this&rdquo; is rendered and stopped at — the generated page reports the order, it never enforces or
              advances it.
            </p>
            <StepRail steps={conversion.spec.steps} />
          </div>

          <div className="card">
            <h3>What would be proposed</h3>
            <ul style={gridStyle}>
              {conversion.fileSummaries.map((file) => (
                <li key={file.path} data-kind={file.kind}>
                  <span className="mono">{file.path}</span> <Chip tone="">{file.kind}</Chip>{" "}
                  <span className="muted">{String(file.bytes)} bytes</span>
                </li>
              ))}
            </ul>
            <p className="muted" style={{ marginTop: 12 }}>
              Plus the edit a human still has to make by hand, because a sub-app is code-declared and{" "}
              <span className="mono">{conversion.registry.file}</span> is a host file Studio cannot reach:
            </p>
            <pre className="mono" style={{ ...findingStyle, whiteSpace: "pre-wrap" }}>
              {[conversion.registry.importLine, ...conversion.registry.entryLines].join("\n")}
            </pre>
            <GatePanel gate={conversion.gate} />
            {conversion.warnings.length > 0 && (
              <div style={gridStyle}>
                {conversion.warnings.map((warning, i) => (
                  <div key={String(i)} className="muted" style={{ fontSize: 12 }}>
                    <Chip tone="amber">narrowed</Chip> {warning}
                  </div>
                ))}
              </div>
            )}
            <div style={rowStyle}>
              <button type="button" disabled={busy !== ""} aria-busy={busy === "propose"} onClick={() => void propose()}>
                {busy === "propose" ? "Filing…" : "File the proposal (installs nothing)"}
              </button>
              <span className="muted">
                Writes one file to <span className="mono">memory/proposals/</span>. A human applies it.
              </span>
            </div>
          </div>
        </>
      )}

      {filed !== null && (
        <div className="okbox" role="status" data-already-filed={filed.status === "already_proposed" ? "true" : "false"}>
          {filed.status === "already_proposed" ? "Nothing was written — " : "Filed — "}
          <span className="mono">{filed.proposalPath}</span>. {filed.note}
        </div>
      )}
    </div>
  );
}

const studioModule: SubAppModule = { Page: StudioPage };
export default studioModule;
