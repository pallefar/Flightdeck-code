import { useId, useLayoutEffect, useRef, useState } from "react";
import type { TourPlayback, TourState } from "../tour-playback";
import type { WalkthroughPlan } from "../walkthrough";

interface Props {
  readonly plan: WalkthroughPlan;
  readonly state: TourState;
  readonly playback: TourPlayback;
  readonly historical: boolean;
  readonly motion?: boolean;
  readonly sourceEdited: boolean;
  readonly onRevealFile: (path: string) => void;
}
/** A disclosure, not a second product window. Every reference opens the
 * authoritative existing source editor; every page uses the existing preview. */
export function ArchitectureTour({ plan, state, playback, historical, motion = true, sourceEdited, onRevealFile }: Props) {
  const [open, setOpen] = useState(false);
  const [moduleStrip, setModuleStrip] = useState<boolean | null>(null);
  const [replayCycle, setReplayCycle] = useState(0);
  const opener = useRef<HTMLButtonElement>(null);
  const receipt = useRef<HTMLDivElement>(null);
  const id = useId();
  const step = plan.steps[state.step] ?? plan.steps[0];
  const assembly = state.mode === "assembly";
  // Automatic receipt stays in the fixed bar; only an explicit disclosure
  // opens the full inspectable pieces. Neither changes source geometry.
  const showModules = moduleStrip ?? open;
  const currentGroup = assembly ? plan.groups[Math.min(state.revealedGroups, plan.groups.length - 1)] ?? null : null;
  const counts = `${plan.counts.artifacts} artifacts · ${plan.counts.pages} supported page${plan.counts.pages === 1 ? "" : "s"} · ${plan.counts.sections} sections · ${plan.manifestSupported ? `${plan.counts.capabilities} capabilities` : "capability declarations unsupported"}`;
  const close = () => { playback.stop(); setOpen(false); setModuleStrip(null); opener.current?.focus(); };
  useLayoutEffect(() => {
    const rail = receipt.current;
    if (rail === null || !assembly) return;
    const keepArrivalVisible = () => {
      const piece = rail.querySelector<HTMLElement>('[data-module-state="arriving"]');
      if (piece === null || rail.clientWidth === 0) return;
      const bounds = rail.getBoundingClientRect();
      const arriving = piece.getBoundingClientRect();
      // Scroll this decorative rail only, never scrollIntoView: that would
      // move the source/workspace or an ancestor conversation viewport.
      if (arriving.left < bounds.left) rail.scrollLeft += arriving.left - bounds.left;
      else if (arriving.right > bounds.right) rail.scrollLeft += arriving.right - bounds.right;
    };
    keepArrivalVisible();
    const resize = new ResizeObserver(keepArrivalVisible);
    resize.observe(rail);
    return () => resize.disconnect();
  }, [assembly, state.revealedGroups, state.roundId, replayCycle]);
  return <section className="fd-tour" aria-label="Sub-app architecture walkthrough" data-mode={assembly ? "assembly" : state.mode} data-playing={state.playing} onKeyDown={event => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <div className="fd-tour__bar">
      <div className="fd-tour__actions"><button ref={opener} type="button" className="fd-tour__opener" aria-label="Open architecture walkthrough" aria-expanded={open} aria-controls={`${id}-details`} onClick={() => { if (open) close(); else { setOpen(true); setModuleStrip(null); } }}><span aria-hidden="true">{open ? "▾" : "▸"}</span> Walkthrough</button><button type="button" className="fd-tour__modules-toggle" aria-label={showModules ? "Hide received modules" : "Show received modules"} aria-expanded={showModules} aria-controls={`${id}-modules`} onClick={() => { playback.pause(); setModuleStrip(!showModules); }}>Modules <span className="mono">{plan.groups.length}</span></button></div>
      <div className="fd-tour__identity"><span className="fd-tour__scope">{assembly ? "Draft received · assembling source view" : historical ? "Historical design · read only · narration off" : "Design walkthrough · not installed / no source execution"}</span><div ref={receipt} className="fd-tour__receipt" aria-label={`Received module assembly · ${counts}`} title={currentGroup === null ? counts : `Received ${currentGroup.label.toLowerCase()} · ${currentGroup.paths.length} artifacts · all source actions remain available`}>
        {plan.groups.map((group, index) => <span key={group.id} className="fd-receipt-piece" data-module={group.id} data-module-state={!assembly || index < state.revealedGroups ? "placed" : index === state.revealedGroups ? "arriving" : "socket"}><span className="fd-module__face" aria-hidden="true" key={`${state.roundId}-${replayCycle}-${state.revealedGroups}-${state.mode}`}>{group.label}<span className="mono">{group.paths.length}</span></span></span>)}
        {plan.groups.length === 0 && <span>No source artifacts received</span>}
      </div></div>
      <div className="fd-tour__transport" role="group" aria-label="Walkthrough playback">
        <button type="button" aria-label="Previous walkthrough step" title="Previous step" disabled={assembly || state.step === 0} onClick={() => { setOpen(true); playback.previous(); }}>←</button>
        <button type="button" className="fd-tour__play" disabled={!motion} aria-label={state.playing ? "Pause walkthrough" : "Play walkthrough"} onClick={() => { if (state.playing) playback.pause(); else { setOpen(true); playback.play(); } }}>{state.playing ? "Pause" : "Play"}</button>
        <button type="button" aria-label="Next walkthrough step" title="Next step" disabled={assembly || state.step >= plan.steps.length - 1} onClick={() => { setOpen(true); playback.next(); }}>→</button>
        <button type="button" aria-label={assembly ? "Skip received-artifact reveal" : "Stop walkthrough"} onClick={() => playback.stop()}>{assembly ? "Skip" : "Stop"}</button>
      </div>
    </div>
    <div className="fd-tour__presentation" hidden={!showModules && !open} inert={!showModules && !open}>
    <p className="fd-tour__counts">{counts}</p>
    {assembly && currentGroup !== null && <p className="fd-tour__arrival" key={currentGroup.id}><span>Received {currentGroup.label.toLowerCase()} · {currentGroup.paths.length} artifact{currentGroup.paths.length === 1 ? "" : "s"}</span><code>{currentGroup.folder || "Candidate paths"}</code><span>All source actions remain available.</span></p>}
    <div id={`${id}-modules`} className="fd-tour__modules" hidden={!showModules} inert={!showModules}>
    <div className="fd-modules" role="group" aria-label="Received modules · visual placement only">
      {plan.groups.map((group, index) => <button type="button" key={group.id} className="fd-module" data-module={group.id} data-module-state={!assembly || index < state.revealedGroups ? "placed" : index === state.revealedGroups ? "arriving" : "socket"} title={group.paths[0]} aria-label={`${group.label} · ${group.paths.length} received artifact${group.paths.length === 1 ? "" : "s"} · open ${group.paths[0] ?? "source"}`} onClick={() => { playback.pause(); const path = group.paths[0]; if (path !== undefined) onRevealFile(path); }}>
        <span className="fd-module__face" aria-hidden="true" key={`${state.roundId}-${replayCycle}-${state.revealedGroups}-${state.mode}`}><span className="fd-module__type">{group.id === "framework" ? "MANIFEST" : group.id === "host-edit" ? "PROPOSED EDIT" : group.id.toUpperCase()}</span><strong>{group.label}</strong><span className="fd-module__count">{group.paths.length} received artifact{group.paths.length === 1 ? "" : "s"}</span></span>
      </button>)}
      {plan.groups.length === 0 && <span className="fd-ledger__note">No source artifacts received; no module pieces invented.</span>}
    </div>
    <p className="fd-modules__scope">Sockets show placement, not missing source or installation.{plan.counts.hostEdits === 0 ? " No host edit received." : " Host edits remain proposed."}</p>
    </div>
    <div id={`${id}-details`} className="fd-tour__details" hidden={!open} inert={!open}>
      <div className="fd-tour__heading"><strong>{step?.title}</strong><span className="mono">{state.step + 1} / {plan.steps.length}</span><button type="button" aria-label="Close architecture walkthrough" onClick={close}>Close</button></div>
      {step !== undefined && <><ul className="fd-tour__facts">{step.facts.map((fact, index) => <li key={index}>{fact}</li>)}</ul><p className="fd-tour__tip"><b>Tip</b> {step.tip}</p><div className="fd-tour__references" aria-label="Actual source references">{step.paths.map(path => <button type="button" key={path} title={path} onClick={() => { playback.pause(); onRevealFile(path); }}><code>{path}</code></button>)}</div></>}
      {sourceEdited && <p className="fd-tour__caution">Working-source edits are present. Descriptors reflect saved text; static checks still describe the generated snapshot.</p>}
      <div className="fd-tour__replay"><span>{plan.counts.sourceFiles} source files · {plan.counts.hostEdits} proposed host edits · {plan.counts.standalone} standalone artifacts (included in source count)</span><button type="button" disabled={historical} onClick={() => { setReplayCycle(cycle => cycle + 1); playback.replayCreation(); }}>Replay creation</button><button type="button" onClick={() => playback.replay()}>Replay walkthrough</button></div>
    </div>
    </div>
  </section>;
}
