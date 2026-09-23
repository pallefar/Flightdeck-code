/** The chat pane: the transcript, and the composer under it.
 *
 * Each Studio turn that produced a sub-app carries a chip back to that
 * round. Rounds are append-only, so every chip stays live for the whole
 * session — which is what makes "show me what round 2 looked like" a click
 * rather than a regeneration. */
import { useEffect, useRef, useState } from "react";
import { runProgress, type Run } from "../run";
import type { Round, Turn } from "../types";
import { LineIcon } from "./LineIcon";

interface Props {
  readonly turns: readonly Turn[];
  readonly rounds: readonly Round[];
  readonly selectedRoundId: string | null;
  readonly busy: boolean;
  readonly onSubmit: (text: string) => void;
  readonly onSelectRound: (roundId: string) => void;
  /** The run in flight, for the ticker under the composer. Optional: the
   * pane renders without one, it just says less. */
  readonly run?: Run | null;
  /** Stop the round. When absent no stop button is drawn — a dead one
   * would be worse than none, because the whole value of this control is
   * that a person believes it. */
  readonly onStop?: (() => void) | undefined;
}

export function ChatPane({
  turns,
  rounds,
  selectedRoundId,
  busy,
  onSubmit,
  onSelectRound,
  run = null,
  onStop,
}: Props) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  // Follow the tail as a turn streams. `scrollTop` rather than
  // `scrollIntoView` because the latter scrolls the whole workbench when
  // the pane is not the scrolling ancestor.
  useEffect(() => {
    const log = logRef.current;
    if (log !== null) log.scrollTop = log.scrollHeight;
  }, [turns]);

  function send(): void {
    const text = draft.trim();
    if (text.length === 0 || busy) return;
    onSubmit(text);
    setDraft("");
  }

  return (
    <section className="fd-chat" aria-label="Chat">
      <header className="fd-chat__head">
        <span className="fd-chat__title">Flightdeck Studio</span>
        <span className="fd-chat__sub">
          {rounds.length === 0 ? "no rounds yet" : `${rounds.length} round${rounds.length === 1 ? "" : "s"}`}
        </span>
      </header>

      <div className="fd-chat__log" ref={logRef}>
        {turns.length === 0 && (
          <p className="fd-ledger__note">
            Describe the mini-app you want. Studio plans it against the sub-app contract, generates the source,
            runs the conformance gate, and shows you all three.
          </p>
        )}
        {turns.map((turn) => {
          const round = turn.roundId === null ? null : rounds.find((r) => r.id === turn.roundId) ?? null;
          return (
            <article key={turn.id} className={`fd-turn fd-turn--${turn.role} fd-turn--${turn.status}`}>
              <span className="fd-turn__who">{turn.role === "you" ? "You" : "Studio"}</span>
              <div className="fd-turn__body">
                {turn.text}
                {turn.status === "streaming" && <span className="fd-turn__caret" aria-label="generating" />}
              </div>
              {round !== null && (
                <button
                  type="button"
                  className="fd-roundchip"
                  aria-pressed={round.id === selectedRoundId}
                  onClick={() => onSelectRound(round.id)}
                >
                  <LineIcon name="package" size={15} />
                  <span className="fd-roundchip__n">#{round.ordinal}</span>
                  {round.candidate.manifest.label}
                  <Verdict errors={round.candidate.findings.filter((f) => f.severity === "error").length} />
                </button>
              )}
            </article>
          );
        })}
      </div>

      {busy && <Ticker run={run} />}

      <div className="fd-composer">
        <textarea
          value={draft}
          placeholder={busy ? "Generating…" : "A tool for tracking works-council consultation clocks…"}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a newline. A prompt describing a
            // mini-app is usually one paragraph, and needing a mouse to
            // send it is a tax on every round.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          aria-label="Describe the mini-app"
        />
        {busy && onStop !== undefined ? (
          // While a round is in flight the primary button IS stop. Leaving
          // a disabled "Build" as the only thing under a person's cursor,
          // with the cancel hidden on another pane, is how a workbench
          // makes somebody watch a bad round finish.
          <button
            type="button"
            className="fd-stop"
            disabled={run?.abortRequested ?? false}
            onClick={onStop}
          >
            <LineIcon name="circle-stop" size={16} />
            {run?.abortRequested === true ? "Stopping…" : "Stop"}
          </button>
        ) : (
          <button type="button" className="fd-composer__send" disabled={busy || draft.trim().length === 0} onClick={send}>
            <LineIcon name="sparkles" size={16} />
            Build
          </button>
        )}
      </div>
    </section>
  );
}

/** What it is doing, right now, where the person is already looking. The
 * run pane has the detail; this is the one line that says whether the
 * silence is a typecheck or a hang. */
function Ticker({ run }: { readonly run: Run | null }) {
  const progress = runProgress(run);
  if (progress.current === null) {
    return <p className="fd-ticker">Working…</p>;
  }
  return (
    <p className="fd-ticker">
      <span className="fd-ticker__n mono">
        {Math.min(progress.done + 1, progress.total)}/{progress.total}
      </span>
      {progress.current.label}
      {progress.current.detail !== null && (
        <span className="fd-ticker__detail mono">{progress.current.detail}</span>
      )}
    </p>
  );
}

function Verdict({ errors }: { readonly errors: number }) {
  return errors === 0 ? (
    <span className="fd-dot" style={{ background: "var(--green)" }} aria-label="gate clean" />
  ) : (
    <span className="fd-roundchip__n" style={{ color: "var(--red)" }}>
      {errors} blocking
    </span>
  );
}
