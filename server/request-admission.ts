import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { PlannerLlmLike } from '../packages/pipeline/src/gated-planner';
const limit = z.number().int().min(1).max(100);
const configuration = z.object({
  global: limit.default(4), actor: limit.default(2), project: limit.default(2),
  deadlineMs: z.number().int().min(1).max(300000).default(30000),
  drainMs: z.number().int().min(1).max(30000).default(5000),
}).strict();
export interface RequestAdmissionOptions { global?: number; actor?: number; project?: number; deadlineMs?: number; drainMs?: number }
export interface AdmissionPermit {
  readonly signal: AbortSignal;
  track<T>(work: (signal: AbortSignal) => Promise<T>, upstream?: AbortSignal): Promise<T>;
  release(): Promise<void>;
}
/** Process-local, zero-queue admission. Scope identities must already be authenticated/validated. */
export class RequestAdmission {
  private active = 0;
  private accepting = true;
  private readonly controllers = new Set<AbortController>();
  private readonly actors = new Map<string, number>();
  private readonly projects = new Map<string, number>();
  private readonly limits: z.infer<typeof configuration>;
  private readonly drained = new Set<() => void>();
  constructor(options: RequestAdmissionOptions = {}) {
    if (Object.values(options).some(value => value === undefined)) throw new Error('invalid request admission options');
    const parsed = configuration.safeParse(options);
    if (!parsed.success) throw new Error('invalid request admission options');
    this.limits = parsed.data;
  }
  snapshot() { return { active: this.active, actors: this.actors.size, projects: this.projects.size, accepting: this.accepting }; }
  stop() { this.accepting = false; for (const controller of this.controllers) controller.abort(); }
  async close(): Promise<void> {
    this.stop();
    if (!this.active) return;
    await new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(timer); this.drained.delete(done); resolve(); };
      const timer = setTimeout(() => { this.drained.delete(done); reject(new Error('request admission drain incomplete')); }, this.limits.drainMs);
      this.drained.add(done);
    });
  }
  acquire(actor: string, project = '@unscoped', request?: FastifyRequest): AdmissionPermit | undefined {
    actor = actor.trim().toLowerCase();
    const a = this.actors.get(actor) ?? 0, p = this.projects.get(project) ?? 0;
    if (!this.accepting || this.active >= this.limits.global || a >= this.limits.actor || p >= this.limits.project) return undefined;
    this.active++; this.actors.set(actor, a + 1); this.projects.set(project, p + 1);
    const controller = new AbortController(); this.controllers.add(controller);
    const abort = () => controller.abort();
    request?.raw.on('aborted', abort);
    const socket = request?.raw.socket;
    socket?.on('close', abort);
    const disconnected = () => { if (!request?.raw.complete) abort(); };
    request?.raw.on('close', disconnected);
    const timer = setTimeout(abort, this.limits.deadlineMs); timer.unref();
    const pending = new Set<Promise<unknown>>();
    let releasing: Promise<void> | undefined;
    return {
      signal: controller.signal,
      track: <T>(work: (signal: AbortSignal) => Promise<T>, upstream?: AbortSignal): Promise<T> => {
        const signal = upstream ? AbortSignal.any([controller.signal, upstream]) : controller.signal;
        if (releasing || signal.aborted) return Promise.reject(new Error('request work unavailable'));
        const operation = Promise.resolve().then(() => { if (signal.aborted) throw new Error('request work unavailable'); return work(signal); });
        // Observe both outcomes without creating an unhandled rejecting finally promise.
        pending.add(operation);
        void operation.then(() => pending.delete(operation), () => pending.delete(operation));
        return operation;
      },
      release: () => releasing ??= (async () => {
        // Engine deadlines can settle the route while a soft-aborted adapter is still running.
        while (pending.size) await Promise.allSettled([...pending]);
        clearTimeout(timer); request?.raw.off('aborted', abort); request?.raw.off('close', disconnected); socket?.off('close', abort);
        this.controllers.delete(controller); this.active--;
        for (const [map, key] of [[this.actors, actor], [this.projects, project]] as const) {
          const remaining = map.get(key)! - 1;
          if (remaining === 0) map.delete(key); else map.set(key, remaining);
        }
        if (!this.active) for (const done of [...this.drained]) done();
      })(),
    };
  }
}
/** No repair attempts, retries after failure, or fresh work after deadline/disconnect. */
export function admittedModel(llm: PlannerLlmLike, permit: AdmissionPermit): PlannerLlmLike {
  let failed = false;
  return async request => {
    if (failed || request.purpose === 'repair' || request.attempt > 1 || permit.signal.aborted) throw new Error('model work unavailable');
    try { return await permit.track(signal => llm({ ...request, signal } as Parameters<PlannerLlmLike>[0] & { signal: AbortSignal })); }
    catch { failed = true; throw new Error('model work unavailable'); }
  };
}
export function admissionRefused(reply: FastifyReply) {
  return reply.header('Retry-After', '1').code(429).send({ error: 'request capacity unavailable' });
}
