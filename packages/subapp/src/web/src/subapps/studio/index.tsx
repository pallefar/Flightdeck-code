/** Studio's page — the front end a person uses inside the console.
 *
 * ⭐ WHAT THIS PAGE IS FOR, AND WHY IT IS NOT A PROMPT BOX. Studio's engine —
 * the workflow reader, the generator, the contract gate — is forty-six modules
 * of Studio's own source. It does not travel into a Flightdeck checkout,
 * because a sub-app that drags its authoring repo in behind it is a sub-app
 * the host cannot build: the vendored tree fails the host's own
 * `npm run typecheck`, which is a stack of its compliance gate. So generation
 * happens in Studio and produces a BUNDLE, and this page is where that bundle
 * is checked by the host and filed for review.
 *
 * ⭐ THE ONE THING THIS PAGE MUST NEVER LET SOMEBODY MISBELIEVE is that the
 * button installs an app. It does not. Studio runs as a sub-app, a sub-app
 * route reaches the host only through the injected capability adapter, and
 * that adapter has no filesystem write — so the furthest this page can go is
 * ONE file under `memory/proposals/`. A human applies it. That sentence is on
 * the screen before anything is pasted, on the button itself, and in the
 * answer afterwards, because it is the product's shape and not a disclaimer.
 *
 * ⭐ THE SECOND THING IT MUST NOT LET SOMEBODY MISBELIEVE is that Studio's
 * gate is this host's verdict. It is not. The bundle's `gate` block reports a
 * run that happened somewhere this server cannot see; the `admission` block is
 * what this host concluded, here, from the bundle's own bytes. The two are
 * rendered as two panels with two headings, and the one with authority says
 * so. Flattening them into a single green tick is the exact misreading the
 * split exists to prevent.
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
  bg: "var(--bg, #0e1720)",
  surface: "var(--surface, #17242f)",
  ink: "var(--ink, #eef2f7)",
  muted: "var(--muted, #a7b6c3)",
  line: "var(--line, #304553)",
  accent: "var(--te, #e98300)",
  green: "var(--green, #87c3a7)",
  amber: "var(--amber, #c9b687)",
  red: "var(--red, #ff807d)",
} as const;

/* ── What the server can answer ─────────────────────────────────────────── */

interface Refusal {
  status: number | null;
  code: string | null;
  scope: string | null;
  detail: string;
}

interface AdmissionFinding {
  rule: string;
  severity: string;
  file: string;
  message: string;
}

interface Admission {
  ok: boolean;
  checks: string[];
  findings: AdmissionFinding[];
  errors: AdmissionFinding[];
  warnings: AdmissionFinding[];
  filesChecked: number;
}

interface GateFinding {
  rule: string;
  severity: string;
  file: string;
  line: number;
  message: string;
  evidence: string | null;
}

interface ReportedGate {
  reportedBy: string;
  reportedAt: string;
  ok: boolean;
  checks: string[];
  findings: GateFinding[];
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

interface Verdict {
  status: "admissible" | "not_admissible";
  subAppId: string;
  label: string;
  spec: SpecSummary;
  fileSummaries: FileSummary[];
  registry: RegistryEdit;
  admission: Admission;
  gate: ReportedGate;
  warnings: string[];
}

interface Proposed {
  status: "proposed" | "already_proposed";
  subAppId: string;
  proposalPath: string;
  note: string;
}

/** `POST /proposals` answers either arm: the proposal it filed, or the
 * refusal it would have shown in a dry run — because the bundle in the
 * textarea can have been edited between the two calls. */
function isProposed(answer: Verdict | Proposed): answer is Proposed {
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
  // 422 is not a transport failure — it is the host's considered refusal of a
  // well-formed bundle, and the body IS the answer. Only a genuine
  // transport/permission problem becomes a Refusal.
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
  if (r.status === 400) return "That is not a Studio bundle this host can read.";
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

/** The host's own verdict. The panel with authority, and the one a reviewer
 * should read first — so it is rendered first and said to be the host's. */
function AdmissionPanel({ admission }: { admission: Admission }) {
  return (
    <div data-admission-ok={admission.ok ? "true" : "false"}>
      <h4 style={{ margin: "16px 0 0" }}>What this host checked for itself</h4>
      <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
        Re-derived here, from the bundle&apos;s own bytes, by code that ships with this server. This is the verdict that
        decides whether a proposal can be filed.
      </p>
      <div style={rowStyle}>
        <Chip tone={admission.ok ? "green" : "red"}>{admission.ok ? "Admitted" : "Refused"}</Chip>
        <span className="muted">
          {String(admission.checks.length)} checks ran over {String(admission.filesChecked)} files
          {admission.errors.length > 0 && ", " + String(admission.errors.length) + " blocking"}
          {admission.warnings.length > 0 && ", " + String(admission.warnings.length) + " advisory"}
        </span>
      </div>
      {admission.checks.length > 0 && (
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
          Checked: {admission.checks.join(", ")}.
        </p>
      )}
      {admission.findings.map((finding, i) => (
        <div key={finding.rule + String(i)} style={findingStyle} data-rule={finding.rule} data-severity={finding.severity}>
          <Chip tone={finding.severity === "error" ? "red" : "amber"}>{finding.rule}</Chip>{" "}
          <span className="mono">{finding.file}</span> — {finding.message}
        </div>
      ))}
    </div>
  );
}

/** What the bundle SAYS about itself. Provenance, and labelled as such. */
function ReportedGatePanel({ gate }: { gate: ReportedGate }) {
  return (
    <div data-gate-ok={gate.ok ? "true" : "false"}>
      <h4 style={{ margin: "16px 0 0" }}>What the bundle reports about itself</h4>
      <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
        A claim, not a credential: this run happened in{" "}
        <span className="mono">{gate.reportedBy}</span>, somewhere this server cannot see, and it arrived in the same
        request as the files it is about. It is recorded for the reviewer and it admits nothing on its own.
      </p>
      <div style={rowStyle}>
        <Chip tone={gate.ok ? "" : "red"}>{gate.ok ? "Reported clean" : "Reported blocked"}</Chip>
        <span className="muted">
          {String(gate.checks.length)} checks reported, {String(gate.findings.length)} findings, at{" "}
          <span className="mono">{gate.reportedAt}</span>
        </span>
      </div>
      {gate.findings.map((finding, i) => (
        <div key={finding.rule + String(i)} style={findingStyle} data-rule={finding.rule} data-severity={finding.severity}>
          <Chip tone={finding.severity === "error" ? "red" : "amber"}>{finding.rule}</Chip>{" "}
          <span className="mono">{finding.file}</span>
          {finding.line > 0 && <span className="muted">{":" + String(finding.line)}</span>} — {finding.message}
        </div>
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
  const [bundleText, setBundleText] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [filed, setFiled] = useState<Proposed | null>(null);
  const [onFile, setOnFile] = useState<string[] | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [busy, setBusy] = useState<"" | "check" | "file">("");

  const loadProposals = useCallback(async () => {
    try {
      const answer = (await call("GET", "/proposals")) as { proposals?: unknown } | null;
      const list = answer === null || !Array.isArray(answer.proposals) ? [] : (answer.proposals as string[]);
      setOnFile(list);
    } catch {
      // A page that cannot list what is on file is still a page that can
      // check a bundle. The refusal that matters is the one on the action a
      // person just took, not on a background read they did not ask for.
      setOnFile(null);
    }
  }, []);

  useEffect(() => {
    void loadProposals();
  }, [loadProposals]);

  /** Parsed in the browser purely so a typo is a local message rather than a
   * round trip. The server parses it again, strictly, and that parse is the
   * one that counts — nothing here is a validation the host relies on. */
  const parseBundle = useCallback((): unknown | null => {
    try {
      return JSON.parse(bundleText) as unknown;
    } catch (err) {
      setRefusal({ status: null, code: "local_parse", scope: null, detail: (err as Error).message });
      return null;
    }
  }, [bundleText]);

  const check = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      if (busy !== "" || bundleText.trim().length === 0) return;
      setBusy("check");
      setRefusal(null);
      setFiled(null);
      const body = parseBundle();
      if (body === null) {
        setBusy("");
        setVerdict(null);
        return;
      }
      try {
        setVerdict((await call("POST", "/admit", body)) as Verdict);
      } catch (err) {
        setVerdict(null);
        setRefusal(refusalOf(err));
      } finally {
        setBusy("");
      }
    },
    [busy, bundleText, parseBundle],
  );

  const file = useCallback(async () => {
    if (busy !== "" || verdict === null || verdict.status !== "admissible") return;
    setBusy("file");
    setRefusal(null);
    const body = parseBundle();
    if (body === null) {
      setBusy("");
      return;
    }
    try {
      const answer = (await call("POST", "/proposals", body)) as Verdict | Proposed;
      if (isProposed(answer)) {
        setFiled(answer);
        await loadProposals();
      } else {
        // The bundle was edited between the check and the filing, and now
        // refuses.
        setVerdict(answer);
      }
    } catch (err) {
      setRefusal(refusalOf(err));
    } finally {
      setBusy("");
    }
  }, [busy, verdict, parseBundle, loadProposals]);

  return (
    <div className="page">
      <div className="pagehead">
        <div className="eyebrow">Flightdeck Studio</div>
        <h2>File a generated mini-app for review</h2>
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
        <h3>The bundle</h3>
        <p className="muted">
          Paste the JSON Studio produced when it converted the workflow. The conversion itself runs in Studio, not here:
          its reader, generator and contract gate are forty-six modules of Studio&apos;s own source, and a sub-app that
          dragged them into this repository would be a sub-app this host could not build. What travels is the result.
        </p>
        <form onSubmit={(event) => void check(event)}>
          <textarea
            style={areaStyle}
            value={bundleText}
            spellCheck={false}
            aria-label="Studio bundle JSON"
            placeholder={'{\n  "bundle": "studio-mini-app/1",\n  "subAppId": "wc-clock",\n  …\n}'}
            onChange={(event) => setBundleText(event.target.value)}
          />
          <div style={rowStyle}>
            <button type="submit" disabled={busy !== "" || bundleText.trim().length === 0} aria-busy={busy === "check"}>
              {busy === "check" ? "Checking…" : "Check this bundle"}
            </button>
            <span className="muted">Runs this host&apos;s own admission checks. Writes nothing.</span>
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

      {verdict !== null && (
        <>
          <div className="card" data-status={verdict.status} data-subapp={verdict.subAppId}>
            <h3>
              {verdict.spec.icon} {verdict.label}
            </h3>
            <p className="muted">{verdict.spec.purpose}</p>
            <div style={gridStyle}>
              <div style={factStyle}>
                <span className="muted">Sub-app id</span>
                <span className="mono">{verdict.spec.id}</span>
              </div>
              <div style={factStyle}>
                <span className="muted">Nav section</span>
                <span>{verdict.spec.navSection}</span>
              </div>
              <div style={factStyle}>
                <span className="muted">Route prefix</span>
                <span className="mono">{verdict.spec.routePrefix}</span>
              </div>
              <div style={factStyle}>
                <span className="muted">Kill switch</span>
                <span className="mono">{verdict.spec.enableEnvVar}</span>
              </div>
              <div style={factStyle}>
                <span className="muted">Host floor</span>
                <span className="mono">{verdict.spec.minHostVersion}</span>
              </div>
              <div style={factStyle}>
                <span className="muted">Capabilities</span>
                <span>
                  {verdict.spec.capabilities.length === 0 ? (
                    <span className="muted">none — the app only shows things</span>
                  ) : (
                    verdict.spec.capabilities.map((c) => (
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
                  {verdict.spec.visibleToRoles.map((r) => (
                    <Chip key={r} tone="">
                      {r}
                    </Chip>
                  ))}
                </span>
              </div>
            </div>
          </div>

          {verdict.spec.steps.length > 0 && (
            <div className="card">
              <h3>The procedure, as the app will show it</h3>
              <p className="muted">
                The steps in the document&apos;s own order and its own numbering. A step marked &ldquo;a person decides
                this&rdquo; is rendered and stopped at — the generated page reports the order, it never enforces or
                advances it.
              </p>
              <StepRail steps={verdict.spec.steps} />
            </div>
          )}

          <div className="card">
            <h3>What would be proposed</h3>
            <ul style={gridStyle}>
              {verdict.fileSummaries.map((f) => (
                <li key={f.path} data-kind={f.kind}>
                  <span className="mono">{f.path}</span> <Chip tone="">{f.kind}</Chip>{" "}
                  <span className="muted">{String(f.bytes)} bytes</span>
                </li>
              ))}
            </ul>
            <p className="muted" style={{ marginTop: 12 }}>
              Plus the edit a human still has to make by hand, because a sub-app is code-declared and{" "}
              <span className="mono">{verdict.registry.file}</span> is a host file Studio cannot reach:
            </p>
            <pre className="mono" style={{ ...findingStyle, whiteSpace: "pre-wrap" }}>
              {[verdict.registry.importLine, ...verdict.registry.entryLines].join("\n")}
            </pre>

            <AdmissionPanel admission={verdict.admission} />
            <ReportedGatePanel gate={verdict.gate} />

            {verdict.warnings.length > 0 && (
              <div style={gridStyle}>
                {verdict.warnings.map((warning, i) => (
                  <div key={String(i)} className="muted" style={{ fontSize: 12 }}>
                    <Chip tone="amber">narrowed</Chip> {warning}
                  </div>
                ))}
              </div>
            )}

            <div style={rowStyle}>
              <button
                type="button"
                disabled={busy !== "" || verdict.status !== "admissible"}
                aria-busy={busy === "file"}
                onClick={() => void file()}
              >
                {busy === "file" ? "Filing…" : "File the proposal (installs nothing)"}
              </button>
              <span className="muted">
                {verdict.status === "admissible" ? (
                  <>
                    Writes one file to <span className="mono">memory/proposals/</span>. A human applies it.
                  </>
                ) : (
                  <>This host refused the bundle, so there is nothing to file. The findings above are the reason.</>
                )}
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
