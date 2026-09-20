/** The chat pane: the transcript, and the composer under it.
 *
 * Each Studio turn that produced a sub-app carries a chip back to that
 * round. Rounds are append-only, so every chip stays live for the whole
 * session — which is what makes "show me what round 2 looked like" a click
 * rather than a regeneration. */
import { useEffect, useRef, useState } from "react";
import type { Round, Turn } from "../types";

interface Props {
  readonly turns: readonly Turn[];
  readonly rounds: readonly Round[];
  readonly selectedRoundId: string | null;
  readonly busy: boolean;
  readonly onSubmit: (text: string) => void;
  readonly onSelectRound: (roundId: string) => void;
}

export function ChatPane({ turns, rounds, selectedRoundId, busy, onSubmit, onSelectRound }: Props) {
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
                  <span className="fd-roundchip__n">#{round.ordinal}</span>
                  {round.candidate.manifest.label}
                  <Verdict errors={round.candidate.findings.filter((f) => f.severity === "error").length} />
                </button>
              )}
            </article>
          );
        })}
      </div>

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
        <button type="button" className="fd-composer__send" disabled={busy || draft.trim().length === 0} onClick={send}>
          Build
        </button>
      </div>
    </section>
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
