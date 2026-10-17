/** Local presentation only. Timers never write candidate/files/locks/runs.
 * Explicit navigation is delegated and rechecked by the mounted Workbench. */
import type { WalkthroughPlan, WalkthroughStep } from "./walkthrough";

export interface TourState {
  readonly roundId: string | null;
  readonly mode: "empty" | "assembly" | "ready" | "walkthrough";
  readonly playing: boolean;
  readonly revealedGroups: number;
  readonly step: number;
  readonly historical: boolean;
}
export interface TourContext {
  readonly roundId: string | null;
  readonly latestRoundId: string | null;
  readonly plan: WalkthroughPlan | null;
  readonly buildReveal: boolean;
  readonly active: boolean;
  readonly motion?: boolean;
}
interface Actions {
  readonly navigate: (step: WalkthroughStep) => boolean | void;
  readonly narrate: (text: string) => boolean | void;
  readonly stopNarration: () => void;
}
const EMPTY: TourState = { roundId: null, mode: "empty", playing: false, revealedGroups: 0, step: 0, historical: false };
export const ASSEMBLY_MAX_MS = 3000;

export class TourPlayback {
  #state: TourState = EMPTY;
  #context: TourContext | null = null;
  #seen = new Set<string>();
  // Receipt can precede the parent's chat-to-IDE visibility handoff.
  #deferredRound: string | null = null;
  #listeners = new Set<() => void>();
  #timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly actions: Actions) {}
  getState = (): TourState => this.#state;
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => this.#listeners.delete(listener); };
  #set(patch: Partial<TourState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }
  #cancel(): void { if (this.#timer !== null) clearTimeout(this.#timer); this.#timer = null; }
  sync(context: TourContext): void {
    const wasActive = this.#context?.active === true;
    this.#context = context;
    if (context.roundId === this.#state.roundId) {
      const historical = context.roundId !== null && context.roundId !== context.latestRoundId;
      if (context.motion === false) {
        this.#deferredRound = null;
        if (context.roundId !== null) this.#seen.add(context.roundId);
        if (this.#state.mode === "assembly") this.skip();
        else if (this.#state.playing) this.pause();
      }
      if (context.roundId !== null && this.#deferredRound === context.roundId) {
        if (historical || !context.buildReveal) {
          this.#seen.add(context.roundId);
          this.#deferredRound = null;
        } else if (context.active && context.plan !== null) {
          this.#seen.add(context.roundId);
          this.#deferredRound = null;
          this.#set({ mode: "assembly", playing: true, revealedGroups: 0, step: 0, historical: false });
          this.#scheduleAssembly();
        }
      }
      if ((!context.active || historical) && (this.#state.playing || (wasActive && !context.active) || (historical && !this.#state.historical))) this.pause();
      if (context.plan !== null && this.#state.step >= context.plan.steps.length) { this.pause(); this.#set({ step: Math.max(0, context.plan.steps.length - 1) }); }
      if (historical !== this.#state.historical) this.#set({ historical });
      return;
    }
    this.#cancel();
    this.actions.stopNarration();
    this.#deferredRound = null;
    if (context.roundId === null || context.plan === null) {
      this.#seen.clear();
      this.#set(EMPTY);
      return;
    }
    const historical = context.roundId !== context.latestRoundId;
    const eligible = !historical && context.motion !== false && context.buildReveal && !this.#seen.has(context.roundId);
    const reveal = eligible && context.active;
    if (eligible && !context.active) this.#deferredRound = context.roundId;
    else this.#seen.add(context.roundId);
    this.#set({ roundId: context.roundId, mode: reveal ? "assembly" : "ready", playing: reveal, step: 0, revealedGroups: reveal ? 0 : context.plan.groups.length, historical });
    if (reveal) this.#scheduleAssembly();
  }
  #scheduleAssembly(): void {
    const context = this.#context;
    if (context?.plan === null || context === null) return;
    const count = context.plan.groups.length;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (!this.#context?.active || this.#context.roundId !== context.roundId || !this.#state.playing) return;
      const revealedGroups = this.#state.revealedGroups + 1;
      if (revealedGroups >= count) {
        this.#set({ mode: "ready", playing: false, revealedGroups: count });
        this.actions.narrate(`The complete draft has been received: ${context.plan?.counts.artifacts ?? 0} artifacts. This source view does not install packages or execute generated code.`);
      } else {
        this.#set({ revealedGroups });
        this.#scheduleAssembly();
      }
    }, ASSEMBLY_MAX_MS / Math.max(count, 1));
  }
  #present(): void {
    const step = this.#context?.plan?.steps[this.#state.step];
    if (step === undefined || !this.#context?.active) return;
    if (this.actions.navigate(step) === false) return;
    if (!this.#state.historical && this.actions.narrate(step.narration) === true) {
      // Pause only the presentation; do not cancel the accepted utterance.
      this.#cancel();
      if (this.#state.playing) this.#set({ playing: false });
    }
  }
  #scheduleStep(): void {
    if (!this.#state.playing) return;
    const roundId = this.#state.roundId;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (!this.#state.playing || !this.#context?.active || this.#context.roundId !== roundId) return;
      const last = (this.#context.plan?.steps.length ?? 0) - 1;
      if (this.#state.step >= last) { this.pause(); return; }
      this.#set({ step: this.#state.step + 1 });
      this.#present(); this.#scheduleStep();
    }, 3500);
  }
  play(): void {
    if (!this.#context?.active || this.#context.motion === false || this.#context.plan === null || this.#state.mode === "empty") return;
    this.#cancel();
    if (this.#state.mode === "assembly") { this.#set({ playing: true }); this.#scheduleAssembly(); return; }
    this.#set({ mode: "walkthrough", playing: true });
    this.#present(); this.#scheduleStep();
  }
  pause(): void { this.#cancel(); this.actions.stopNarration(); if (this.#state.playing) this.#set({ playing: false }); }
  #move(offset: number): void {
    if (!this.#context?.active || this.#context.plan === null || this.#state.mode === "empty") return;
    this.pause();
    this.#set({ mode: "walkthrough", revealedGroups: this.#context.plan.groups.length, step: Math.max(0, Math.min(this.#state.step + offset, this.#context.plan.steps.length - 1)) });
    this.#present();
  }
  next(): void { this.#move(1); }
  previous(): void { this.#move(-1); }
  replay(): void { this.pause(); if (this.#context?.plan === null || !this.#context?.active) return; this.#set({ step: 0 }); this.play(); }
  replayCreation(): void {
    if (!this.#context?.active || this.#context.motion === false || this.#context.plan === null || this.#state.historical) return;
    this.pause(); this.#set({ mode: "assembly", playing: true, revealedGroups: 0, step: 0 }); this.#scheduleAssembly();
  }
  skip(): void {
    this.pause();
    if (this.#context?.plan === null || this.#context === null) return;
    this.#set({ mode: "ready", playing: false, revealedGroups: this.#context.plan.groups.length });
  }
  stop(): void { this.skip(); }
  dispose(): void { this.pause(); }
}
