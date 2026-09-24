/** The Connect dialog and the Connected/Demo indicator beside the theme
 * switch.
 *
 * ── WHERE THE TOKEN IS WHILE A PERSON TYPES IT ──────────────────────
 * In this component's React state — the controlled input's value — and
 * nowhere else. On Connect it is handed to the client (`src/api/studioClient.ts`),
 * which keeps it in one closure variable for the life of the tab; this
 * component then clears its own copy. It is never put in a URL, an attribute,
 * storage or a log. The field is `type="password"` with `autocomplete="off"`,
 * and the form never navigates, so there is no submission for a browser's
 * password manager to offer to keep.
 *
 * Like every pane, it takes plain props and reaches for nothing, so it renders
 * under `react-dom/server` in `components.test.tsx`. */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import type { ConnectResult, ConnectionState } from "../../api/studioClient";

/** What the workbench is handed to offer a connection at all. Absent means no
 * indicator and no dialog — a control that could do nothing is not drawn. */
export interface WorkbenchConnection {
  readonly state: ConnectionState;
  readonly connect: (token: string) => Promise<ConnectResult>;
  readonly disconnect: () => void;
}

/** One sentence per way a connect can fail. Exported so a test can hold each
 * one distinct. */
export function connectErrorText(reason: Extract<ConnectResult, { ok: false }>["reason"]): string {
  switch (reason) {
    case "empty-token":
      return "Paste the operator token first.";
    case "unreachable":
      return "The Studio server did not answer. Is it running (npm run dev:server)?";
    case "protocol-error":
      return "Something answered, but not the Studio server's health probe.";
  }
}

/** What `harnessMode` means to the person reading it. */
function answersFrom(mode: string | null): string {
  switch (mode) {
    case "off":
      return "the live model";
    case "playback":
      return "recorded fixtures (playback), not the model";
    case "record":
      return "the live model, recording fixtures";
    case "injected":
      return "a test double";
    default:
      return mode === null ? "unknown" : mode;
  }
}

interface IndicatorProps {
  readonly state: ConnectionState;
  readonly onOpen: () => void;
}

export function ConnectionIndicator({ state, onOpen }: IndicatorProps) {
  const connected = state.status === "connected";
  const title = connected
    ? `Connected to the Studio server (${state.health.model}). The server checks the token on every build; if it refuses it, Studio disconnects. Prompts still run the built-in wc-clock demo until they are wired to the server.`
    : "Demo: not connected to a Studio server. Prompts run the built-in wc-clock demo. Click to connect with the operator token.";
  return (
    <button
      type="button"
      className={`fd-conn${connected ? " fd-conn--on" : ""}`}
      aria-haspopup="dialog"
      title={title}
      onClick={onOpen}
    >
      <span className="fd-conn__dot" aria-hidden="true" />
      {connected ? "Connected" : "Demo"}
    </button>
  );
}

interface DialogProps {
  readonly state: ConnectionState;
  readonly onConnect: (token: string) => Promise<ConnectResult>;
  readonly onDisconnect: () => void;
  readonly onClose: () => void;
}

export function ConnectDialog({ state, onConnect, onDisconnect, onClose }: DialogProps) {
  // ⛔ The token, while it is being typed. See the file header.
  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus moves INTO the dialog when it opens — the token field when there is
  // one (`autoFocus`), the dialog itself otherwise — so Escape reaches it and a
  // keyboard user is not left behind on the button that opened it.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.contains(document.activeElement)) dialog.focus();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailure(null);
    void onConnect(token).then((result) => {
      setPending(false);
      if (result.ok) {
        setToken("");
        onClose();
      } else {
        setFailure(connectErrorText(result.reason));
      }
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") onClose();
  };

  const notice =
    failure ??
    (state.status === "disconnected" && state.reason === "token-rejected"
      ? "The server refused the token, so Studio disconnected. Paste the current STUDIO_OPERATOR_TOKEN."
      : null);

  return (
    <div
      className="fd-conn-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="fd-conn-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fd-conn-title"
        onKeyDown={onKeyDown}
      >
        <span className="fd-pagehead__eyebrow">Studio server</span>
        <h2 id="fd-conn-title" className="fd-conn-dialog__h">
          {state.status === "connected" ? "Connected" : "Connect to the Studio server"}
        </h2>

        {state.status === "connected" ? (
          <>
            <dl className="fd-conn-dialog__facts">
              <dt>Model</dt>
              <dd>{state.health.model}</dd>
              <dt>Model key</dt>
              <dd>{state.health.modelKeyConfigured ? "configured" : "not configured"}</dd>
              <dt>Answers from</dt>
              <dd>{answersFrom(state.health.harnessMode)}</dd>
            </dl>
            <p className="fd-conn-dialog__p">
              The server checks the token on every build; if it refuses it, Studio disconnects. Prompts still run
              the built-in wc-clock demo until they are wired to this server.
            </p>
            <div className="fd-conn-dialog__acts">
              <button type="button" className="fd-lockbtn" onClick={onClose}>
                Close
              </button>
              <button
                type="button"
                className="fd-lockbtn"
                onClick={() => {
                  onDisconnect();
                  onClose();
                }}
              >
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="fd-conn-dialog__p">
              Paste the operator token the server was started with (STUDIO_OPERATOR_TOKEN). It is held in this
              tab&apos;s memory only: never saved to this browser&apos;s storage, and gone when you reload or close
              the tab.
            </p>
            <label className="fd-conn-dialog__label">
              Operator token
              <input
                className="fd-conn-dialog__input"
                type="password"
                name="studio-operator-token"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
            {notice !== null && (
              <p className="fd-conn-dialog__alert" role="alert">
                {notice}
              </p>
            )}
            <div className="fd-conn-dialog__acts">
              <button type="button" className="fd-lockbtn" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="fd-save" disabled={pending || token.trim() === ""}>
                {pending ? "Connecting…" : "Connect"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** The dialog's and the indicator's own rules, on the workbench's existing
 * tokens — no new colour. Kept beside the component rather than in
 * `theme.ts`, which the Atlas reskin owns. */
export const CONNECT_CSS = `
.fd-tabs > .fd-conn { flex: 0 0 auto; }
.fd-conn {
  display: inline-flex; align-items: center; gap: 7px;
  border: 1px solid var(--line); border-radius: 999px; padding: 5px 11px;
  background: var(--surface); color: var(--muted); box-shadow: var(--shadow-xs);
  font-size: 12px; font-weight: 600; white-space: nowrap; cursor: pointer;
}
.fd-conn:hover { color: var(--ink); border-color: var(--accent); }
.fd-conn__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--amber); }
.fd-conn--on { color: var(--ink); }
.fd-conn--on .fd-conn__dot { background: var(--green); }
.fd-conn-backdrop {
  position: absolute; inset: 0; z-index: 50;
  display: flex; align-items: center; justify-content: center; padding: 16px;
  background: color-mix(in srgb, var(--ink) 28%, transparent);
}
.fd-conn-dialog {
  width: min(460px, 100%); max-height: 100%; overflow-y: auto;
  background: var(--surface); color: var(--ink);
  border: 1px solid var(--line); border-radius: var(--r-lg); box-shadow: var(--shadow-hover);
  padding: 22px 24px; outline: none;
}
.fd-conn-dialog__h { margin: 6px 0 10px; font-size: 22px; font-weight: 500; letter-spacing: -.5px; }
.fd-conn-dialog__p { margin: 0 0 14px; color: var(--muted); font-size: 13px; line-height: 1.5; }
.fd-conn-dialog__label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 600; color: var(--muted); }
.fd-conn-dialog__input {
  font: inherit; font-size: 14px; font-weight: 400; color: var(--ink);
  background: var(--bg); border: 1px solid var(--line-strong); border-radius: var(--r-md); padding: 8px 10px;
}
.fd-conn-dialog__input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.fd-conn-dialog__alert {
  margin: 12px 0 0; padding: 8px 11px; border-radius: var(--r-md);
  border-left: 3px solid var(--red); background: var(--red-bg); color: var(--ink); font-size: 13px;
}
.fd-conn-dialog__facts { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0 0 14px; font-size: 13px; }
.fd-conn-dialog__facts dt { color: var(--muted); font-weight: 600; }
.fd-conn-dialog__facts dd { margin: 0; }
.fd-conn-dialog__acts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
`;
