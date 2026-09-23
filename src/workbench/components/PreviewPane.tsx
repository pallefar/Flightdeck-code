/** The preview pane: the frame, the switches, and the ledger beside it.
 *
 * ── THE BLOCKED STATES ARE THE POINT ────────────────────────────────
 * Most of this file is the cases where there is nothing to show. That is
 * the right proportion. A preview for a target that cannot always be
 * previewed is judged on how it behaves when it cannot: every refusal
 * below names the cause in the contract's own terms and says what to do
 * next, because "Preview unavailable" over a grey rectangle is
 * indistinguishable from a bug in Studio.
 *
 * ── WHY THE SWITCHES ────────────────────────────────────────────────
 * Contract §4's three-layer AND and §9's capability grant are the two
 * things a generated sub-app most often gets wrong, and neither is
 * visible by reading the page. Putting them on the preview bar turns
 * "does this handler guard correctly" from a code-reading exercise into
 * one click. */
import { useCallback, useMemo, useState } from "react";
import { HOST_FRAME_CSS } from "../theme";
import type { EnableLayers, Finding } from "../types";
import type { HostSnapshot } from "../preview/adapter";
import { countBy, type LedgerRow } from "../preview/fidelity";
import { findingsFor, findingsOn, type PreviewState } from "../preview/state";
import { GeneratedPageMirror } from "./GeneratedPageMirror";
import { LineIcon, type LineIconName } from "./LineIcon";
import { PreviewFrame } from "./PreviewFrame";

interface Props {
  readonly state: PreviewState;
  readonly enable: EnableLayers;
  readonly onEnable: (patch: Partial<EnableLayers>) => void;
  readonly onRevealFile: (path: string) => void;
}

export function PreviewPane({ state, enable, onEnable, onRevealFile }: Props) {
  // Bumping this reloads every panel against the layers as they now are.
  const generation = useMemo(
    () => Number(enable.killSwitch) * 4 + Number(enable.ceiling) * 2 + Number(enable.project),
    [enable],
  );
  const [snapshot, setSnapshot] = useState<HostSnapshot>({ log: [], audit: [], proposals: [] });
  // `host` is stable for as long as the candidate is, so this identity is
  // stable too — the mirror memoises its `call` on it and would rebuild
  // every panel's loader on each render otherwise.
  const refresh = useCallback(() => {
    setSnapshot(state.kind === "ready" ? state.host.snapshot() : { log: [], audit: [], proposals: [] });
  }, [state]);

  if (state.kind !== "ready") {
    return (
      <div className="fd-preview">
        <div className="fd-preview__stage">
          <Blocked state={state} onRevealFile={onRevealFile} />
        </div>
      </div>
    );
  }

  const { module, host, attributed, ledger } = state;
  const pageFindings = findingsOn(attributed, "page");
  const serverFindings = findingsOn(attributed, "server");

  return (
    <div className="fd-preview">
      <div className="fd-preview__stage">
        <div className="fd-preview__bar">
          <span className="fd-tabs__id">{module.routePrefix}</span>
          <Switch
            label="Kill switch"
            title="SUBAPP_<ID>_ENABLED === &quot;true&quot; — layer 1 of §4"
            on={enable.killSwitch}
            onChange={(killSwitch) => onEnable({ killSwitch })}
          />
          <Switch
            label="Ceiling row"
            title="The '*' row — layer 2, and the only source of granted scopes"
            on={enable.ceiling}
            onChange={(ceiling) => onEnable({ ceiling })}
          />
          <Switch
            label="Project row"
            title="This project's install row — layer 3. May switch off, never widen."
            on={enable.project}
            onChange={(project) => onEnable({ project })}
          />
          <span className="fd-tabs__spacer" />
          <button
            type="button"
            className="fd-tab"
            onClick={() => {
              host.reset();
              refresh();
            }}
          >
            <LineIcon name="rotate-ccw" size={15} />
            Reset mock
          </button>
        </div>

        <PreviewFrame css={HOST_FRAME_CSS} title={`${module.title} — preview`}>
          <GeneratedPageMirror
            module={module}
            host={host}
            generation={generation}
            pageFindings={pageFindings}
            findingsForPanel={(panelId) => findingsFor(attributed, panelId)}
            onActivity={refresh}
          />
        </PreviewFrame>
      </div>

      <aside className="fd-preview__side">
        <h3 className="fd-side__h">
          What this preview is ({countBy(ledger, "real")} real · {countBy(ledger, "mocked")} mocked ·{" "}
          {countBy(ledger, "absent")} absent)
        </h3>
        <Ledger rows={ledger} />

        {serverFindings.length > 0 && (
          <>
            <h3 className="fd-side__h">Findings this frame cannot show</h3>
            {serverFindings.map((finding, i) => (
              <FindingLine key={`${finding.rule}-${i}`} finding={finding} onReveal={onRevealFile} />
            ))}
          </>
        )}

        <h3 className="fd-side__h">Requests</h3>
        {snapshot.log.length === 0 ? (
          <p className="fd-ledger__note">Interact with the page to see what the adapter answered and why.</p>
        ) : (
          <div className="fd-log">
            {snapshot.log.slice(-14).reverse().map((entry) => (
              <div className="fd-log__row" key={entry.seq}>
                <span className={`fd-log__status--${entry.status < 300 ? "ok" : entry.status < 500 ? "refused" : "error"}`}>
                  {entry.status}
                </span>
                <span>
                  {entry.method} {entry.path}
                </span>
                <span className="fd-log__why">{entry.why}</span>
              </div>
            ))}
          </div>
        )}

        {snapshot.proposals.length > 0 && (
          <>
            <h3 className="fd-side__h">Proposals (§7 — nothing was advanced)</h3>
            <div className="fd-log">
              {snapshot.proposals.map((proposal) => (
                <div key={proposal.seq}>{proposal.path}</div>
              ))}
            </div>
          </>
        )}

        {snapshot.audit.length > 0 && (
          <>
            <h3 className="fd-side__h">Audit (§8 — field names, never values)</h3>
            <div className="fd-log">
              {snapshot.audit.map((event) => (
                <div key={event.seq}>
                  {event.action} · {event.fields.join(", ")}
                  {event.leak !== null && (
                    <span className="fd-log__status--error"> leaked the value of {event.leak}</span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function Switch({
  label,
  title,
  on,
  onChange,
}: {
  readonly label: string;
  readonly title: string;
  readonly on: boolean;
  readonly onChange: (on: boolean) => void;
}) {
  return (
    <label className={`fd-toggle${on ? "" : " fd-toggle--off"}`} title={title}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Ledger({ rows }: { readonly rows: readonly LedgerRow[] }) {
  return (
    <div className="fd-ledger">
      {rows.map((row) => (
        <div className="fd-ledger__row" key={row.aspect}>
          <span className={`fd-ledger__tag fd-ledger__tag--${row.fidelity}`}>{row.fidelity}</span>
          <span>
            <span className="fd-ledger__aspect">{row.aspect}</span>
            <br />
            <span className="fd-ledger__note">{row.note}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function FindingLine({
  finding,
  onReveal,
}: {
  readonly finding: Finding;
  readonly onReveal: (path: string) => void;
}) {
  return (
    <button type="button" className={`fd-finding fd-finding--${finding.severity}`} onClick={() => onReveal(finding.file)}>
      <span className="fd-finding__rule">
        <LineIcon name={finding.severity === "error" ? "octagon-alert" : "triangle-alert"} size={15} />
        {finding.rule}
      </span>
      <span className="fd-finding__msg">{finding.message}</span>
      <span className="fd-finding__where">
        {finding.file}
        {finding.line > 0 ? `:${finding.line}` : ""}
      </span>
    </button>
  );
}

/** Every way a preview can be unavailable, each one named.
 *
 * The shape is always the same: what happened, why it means no preview,
 * and the next action. A person who reads one of these should never have
 * to ask whether Studio is broken. */
function Blocked({
  state,
  onRevealFile,
}: {
  readonly state: PreviewState;
  readonly onRevealFile: (path: string) => void;
}) {
  if (state.kind === "ready") return null;
  const block = state.block;

  switch (block.kind) {
    case "no-candidate":
      return (
        <Shell icon="clock" title="Nothing to preview yet">
          <p className="fd-blocked__why">
            Describe the mini-app you want in the chat. When a round produces a sub-app, its page renders here
            against a mocked capability adapter.
          </p>
        </Shell>
      );

    case "no-web-module":
      return (
        <Shell icon="ban" title="This sub-app has no page">
          <p className="fd-blocked__why">
            The manifest names a web module, but the candidate contains no file at{" "}
            <code className="mono">{block.expected}</code>. The host globs that exact path and lazy-mounts{" "}
            <code className="mono">.Page</code> from it, so as generated this sub-app would mount its routes and
            show nothing in the console.
          </p>
          <p className="fd-blocked__next">
            A server-only sub-app is legal. If that is what you meant, there is nothing to fix and nothing to
            preview. If not, ask for a page in the next round.
          </p>
        </Shell>
      );

    case "gate-blocked":
      return (
        <Shell icon="triangle-alert" title="The gate refused the page itself">
          <p className="fd-blocked__why">
            These findings are about the web module's existence or its export, so there is no page to render.
            Every other finding still lets the preview run — only these two do not.
          </p>
          {block.findings.map((finding, i) => (
            <FindingLine key={`${finding.rule}-${i}`} finding={finding} onReveal={onRevealFile} />
          ))}
        </Shell>
      );

    case "renderer-drift":
      return (
        <Shell icon="settings" title="This preview is out of date, not your app">
          <p className="fd-blocked__why">
            The preview renders the generated page by parsing its descriptor and re-implementing the fixed runtime
            that codegen emits around it. That runtime has changed: the behaviours below are no longer in the
            generated file, so what you would see here would be Studio's older behaviour, not your app's.
          </p>
          <ul className="fd-blocked__list">
            {block.missing.map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
          <p className="fd-blocked__next">
            Showing a stale preview would be worse than showing none. Update the mirror in{" "}
            <code className="mono">preview/descriptor.ts</code> and{" "}
            <code className="mono">components/GeneratedPageMirror.tsx</code> to match the emitter.
          </p>
        </Shell>
      );

    case "unparsable":
      return (
        <Shell icon="ban" title="The page's descriptor could not be read">
          <p className="fd-blocked__why">
            The preview reads the generated page's <code className="mono">PANELS</code> literal rather than
            executing the file — model-written source must never run in Studio's origin. This one is not a
            literal this parser accepts: {block.detail}.
          </p>
          <p className="fd-blocked__next">
            That usually means the file was hand-edited after generation. Open it in the Files pane and compare
            it with what codegen emits.
          </p>
        </Shell>
      );
  }
}

function Shell({
  icon,
  title,
  children,
}: {
  readonly icon: LineIconName;
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="fd-blocked">
      <span className="fd-blocked__icon">
        <LineIcon name={icon} size={26} />
      </span>
      <span className="fd-blocked__title">{title}</span>
      {children}
    </div>
  );
}
