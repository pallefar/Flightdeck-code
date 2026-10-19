import { createStore } from "../workbench/store";
import type { Candidate, GeneratedFileKind } from "../workbench/types";
import { createDraft, type CreateRequest } from "./client";
import type { ProposedSubapp, StudioResult } from "./result";
import type { ProcessTemplateId } from '../process-studio/contracts';
export interface RegisteredTemplateReceipt {
  projectId: string; templateId: ProcessTemplateId; templateVersion: string;
  artifactId: string; prd: string;
}
export interface StudioTurn {
  id: string; requestId: string; role: 'you' | 'studio';
  status: 'requesting' | 'settled' | 'cancelled' | 'error'; text: string;
  destination: { connectionId: CreateRequest['connectionId'] | 'registered-template'; projectId?: string };
}
export interface StudioState {
  phase: "idle" | "requesting" | "result" | "cancelled" | "error";
  result: StudioResult | null; error: string | null;
  transcript: readonly StudioTurn[]; acceptedRequestId: string | null;
}
export const TRANSCRIPT_LIMIT = 24;
function summary(result: StudioResult): string {
  const outcome = result.status === 'subapp-result' ? result.outcome : result;
  const routing = 'determination' in result ? `Model routing: ${result.determination.target === 'workflow' ? 'Workflow' : 'Sub-app'}. ${result.determination.reason}\n` : '';
  if (outcome.status === 'workflow-graph-proposed') return `${routing}Workflow draft received: ${outcome.graph.name}. Local graph only; review required; not deployed.`.slice(0, 2000);
  if (outcome.status === 'workflow-proposed') return `${routing}Workflow draft received: ${outcome.workflow.name}. Review required; not deployed.`.slice(0, 2000);
  if (outcome.status === 'proposed') return `${routing}Sub-app draft received: ${outcome.generated.plan.label}. ${outcome.generated.files.filter(file => file.kind !== 'standalone').length} source files. Review required; not deployed.`.slice(0, 2000);
  if (outcome.status === 'needs_input') return `${routing}Input needed. ${outcome.understanding ?? ''}`.slice(0, 2000);
  const reason = 'decision' in outcome ? outcome.decision.reason : 'explanation' in outcome ? outcome.explanation : 'issues' in outcome ? outcome.issues.join('\n') : 'refusals' in outcome ? outcome.refusals.map(item => `${item.at}: ${item.needs}`).join('\n') : '';
  return `${routing}${outcome.status === 'model-request-refused' && outcome.review ? 'Exact-context review required before sending.' : 'Draft not accepted.'} ${reason}`.slice(0, 2000);
}

function candidateFrom(outcome: ProposedSubapp): Candidate {
  const { plan, files, warnings } = outcome.generated;
  const kinds: readonly string[] = ["manifest", "guard", "routes-index", "routes-domain", "schema", "web-module", "host-test", "patch", "unknown"];
  return {
    manifest: { id: plan.id, label: plan.label, version: plan.version, summary: plan.summary ?? null, routePrefix: plan.routePrefix, webModuleId: plan.webModuleId, envVar: plan.envVar, tablePrefix: plan.tablePrefix, icon: plan.manifestData.icon, navSection: plan.manifestData.navSection, capabilities: plan.manifestData.capabilities, visibleToRoles: plan.manifestData.visibleToRoles },
    files: files.filter((file) => file.kind !== "standalone").map((file) => ({ ...file, kind: kinds.includes(file.kind) ? file.kind as GeneratedFileKind : "unknown" })),
    findings: outcome.conformance.findings, rulesRun: outcome.conformance.rules, notes: warnings,
  };
}

/** No mount effects, storage, host mutations, or simulated execution. */
export class StudioController {
  readonly workbench = createStore();
  #state: StudioState = { phase: "idle", result: null, error: null, transcript: [], acceptedRequestId: null };
  #listeners = new Set<() => void>();
  #abort: AbortController | null = null;
  #request: CreateRequest | null = null;
  #token: string | null = null;
  #turn: string | undefined;
  #sequence = 0;
  #requestId: string | null = null;
  #composerEpoch = 0;
  #requestComposerEpoch = -1;
  readonly #fetcher: typeof fetch;
  constructor(fetcher: typeof fetch = (...args) => fetch(...args)) { this.#fetcher = (...args) => fetcher(...args); }
  getState = (): StudioState => this.#state;
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
  #set(state: StudioState): void { this.#state = state; for (const listener of this.#listeners) listener(); }
  #settled(status: StudioTurn['status'], text: string): readonly StudioTurn[] {
    return this.#state.transcript.map(turn => turn.requestId === this.#requestId && turn.role === 'studio' ? { ...turn, status, text: text.slice(0, 2000) } : turn);
  }
  /** Only for a client-validated, exact-review-bound template receipt.
   * Parent still owns authentication, scope freshness and source replacement.
   * No model request/determination or host authority is invented here.
   */
  acceptRegisteredTemplate(outcome: ProposedSubapp, receipt: RegisteredTemplateReceipt): boolean {
    if (this.#abort !== null || this.workbench.getState().busy) return false;
    if (!outcome.conformance.ok || outcome.conformance.findings.some(finding => finding.severity === 'error') || outcome.artifacts.decision !== 'allow') return false;
    const snapshot = structuredClone(outcome);
    const turn = this.workbench.prompt(receipt.prd);
    if (turn === null) return false;
    this.clearReceivedHandoff();
    const text = `Registered template: ${receipt.templateId}, version ${receipt.templateVersion}. No model invoked. ${snapshot.generated.files.filter(file => file.kind !== 'standalone').length} source files received. Draft — not deployed. Artifact: ${receipt.artifactId}`;
    this.workbench.settle(turn, candidateFrom(snapshot), text);
    const requestId = `template-${++this.#sequence}`;
    const destination: StudioTurn['destination'] = { connectionId: 'registered-template', projectId: receipt.projectId };
    const transcript: readonly StudioTurn[] = [...this.#state.transcript,
      { id: `${requestId}-you`, requestId, role: 'you', status: 'settled', text: receipt.prd.slice(0, 8000), destination },
      { id: `${requestId}-studio`, requestId, role: 'studio', status: 'settled', text, destination },
    ].slice(-TRANSCRIPT_LIMIT) as StudioTurn[];
    this.#set({ phase: 'idle', result: null, error: null, transcript, acceptedRequestId: null });
    return true;
  }
  async submit(request: CreateRequest, token: string, turnId?: string): Promise<void> {
    await this.#submit(request, token, turnId, request.prompt);
  }
  async #submit(request: CreateRequest, token: string, turnId: string | undefined, userText: string, composerEpoch = this.#composerEpoch): Promise<void> {
    if (this.#abort !== null) return;
    this.#requestComposerEpoch = composerEpoch;
    request = { ...request, ...(request.answers === undefined ? {} : { answers: { ...request.answers } }) };
    const abort = new AbortController();
    const requestId = `request-${++this.#sequence}`;
    this.#requestId = requestId;
    this.#abort = abort; this.#request = request; this.#token = token; this.#turn = turnId;
    const destination = { connectionId: request.connectionId, ...(request.projectId ? { projectId: request.projectId } : {}) };
    const transcript: readonly StudioTurn[] = [...this.#state.transcript,
      { id: `${requestId}-you`, requestId, role: 'you', status: 'settled', text: userText.slice(0, 8000), destination },
      { id: `${requestId}-studio`, requestId, role: 'studio', status: 'requesting', text: 'Requesting routed draft', destination },
    ].slice(-TRANSCRIPT_LIMIT) as StudioTurn[];
    this.#set({ phase: "requesting", result: null, error: null, transcript, acceptedRequestId: null });
    try {
      const result = await createDraft(request, token, abort.signal, this.#fetcher);
      if (abort.signal.aborted || this.#abort !== abort) return;
      if (result.status === "subapp-result" && result.outcome.status === "proposed") {
        const turn = turnId ?? this.workbench.prompt(request.prompt);
        if (turn !== null) this.workbench.settle(turn, candidateFrom(result.outcome), "Draft — not deployed. Server-generated source and conformance evidence received. Host typecheck and mount have not been run by this frontend.");
      } else if (turnId !== undefined) {
        this.workbench.abort(turnId, "No subapp candidate. See Studio routing result above.");
      }
      this.#set({ phase: "result", result, error: null, transcript: this.#settled('settled', summary(result)), acceptedRequestId: requestId });
    } catch (error) {
      if (abort.signal.aborted || this.#abort !== abort) return;
      const message = error instanceof Error ? error.message : "Studio request failed.";
      if (turnId !== undefined) this.workbench.fail(turnId, message);
      this.#set({ phase: "error", result: null, error: message, transcript: this.#settled('error', message), acceptedRequestId: null });
    } finally {
      if (this.#abort === abort) { this.#abort = null; this.#turn = undefined; }
    }
  }
  async approveSkillSend(token: string): Promise<void> {
    if (token !== this.#token) { this.reset(); return; }
    const result = this.#state.result;
    if (!this.skillSendReviewCurrent || this.#request === null || result?.status !== "model-request-refused" || result.review === undefined) return;
    await this.#submit({ ...this.#request, reviewedSkillHash: result.review.hash }, token, undefined, `Send reviewed context\nFingerprint: ${result.review.hash}`, this.#requestComposerEpoch);
  }
  get skillSendReviewCurrent(): boolean { return this.#requestComposerEpoch === this.#composerEpoch; }
  /** Revoke only the send capability; retain the immutable request, response and editor drafts. */
  invalidateSkillSendReview(): void {
    this.#composerEpoch++;
    this.#set({ ...this.#state });
  }
  async answer(answers: Record<string, string>, token: string): Promise<void> {
    if (token !== this.#token) { this.reset(); return; }
    const result = this.#state.result;
    const outcome = result?.status === 'subapp-result' ? result.outcome : result;
    if (this.#request === null || outcome?.status !== 'needs_input') return;
    await this.#submit({ ...this.#request, answers: { ...this.#request.answers, ...answers } }, token, undefined, `Answers\n${Object.entries(answers).map(([id, answer]) => `${id}: ${answer}`).join('\n')}`, this.#requestComposerEpoch);
  }
  cancel(): void {
    if (this.#abort === null) return;
    this.#abort.abort(); this.#abort = null;
    if (this.#turn !== undefined) this.workbench.abort(this.#turn);
    this.#turn = undefined;
    this.#set({ phase: "cancelled", result: null, error: null, transcript: this.#settled('cancelled', 'Request cancelled. No draft accepted. Cancellation does not guarantee a server-side model call already started was stopped.'), acceptedRequestId: null });
  }
  /** Detach obsolete chat routing after an explicit saved-source replacement; retain source/history. */
  clearReceivedHandoff(): void {
    this.cancel(); this.#request = null; this.#token = null; this.#requestId = null; this.#requestComposerEpoch = -1;
    this.#set({ phase: 'idle', result: null, error: null, transcript: this.#state.transcript, acceptedRequestId: null });
  }
  reset(): void {
    this.cancel(); this.#request = null; this.#token = null; this.#requestId = null;
    this.workbench.reset();
    this.#set({ phase: 'idle', result: null, error: null, transcript: [], acceptedRequestId: null });
  }
}
