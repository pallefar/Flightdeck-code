import { z } from 'zod';
import { RULES, type RuleId } from '../../packages/conformance/src/finding';
import { safeSubappValue, snapshotSchema, type SubappSnapshot } from '../../packages/subapp-workspace/schema';
import type { WorkingSourceReport } from './subapp-source-validation';

export type WorkingSourceReceipt = WorkingSourceReport & { readonly sourceHash: string };
/** Trusted transport seam for isolated tests, never a candidate-supplied adapter. */
export interface WorkingSourceWorker {
  postMessage(value: unknown): void;
  terminate(): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}
export interface WorkingSourceRunnerOptions { readonly workerFactory?: () => WorkingSourceWorker }

// Protocol names only: importing the gate here would put the checker on the UI thread.
const STATIC_CHECK_NAMES = ['manifest', 'import-closure', 'capability-escape', 'guard-first', 'no-cached-boolean', 'table-prefix', 'mount'] as const;
const count = z.number().int().min(0).max(10_000_000);
const findingSchema = z.object({
  rule: z.string().max(32), severity: z.enum(['error', 'warning']), file: z.string().min(1).max(240),
  line: count, column: count, title: z.string().max(200),
}).strict().refine(finding => Object.hasOwn(RULES, finding.rule) &&
  RULES[finding.rule as RuleId].title === finding.title && RULES[finding.rule as RuleId].severity === finding.severity);
const receiptSchema = z.object({
  scope: z.literal('working-source-static-only'), ok: z.boolean(), staticChecksComplete: z.boolean(),
  executed: z.literal(false), typechecked: z.literal(false),
  checks: z.array(z.enum(STATIC_CHECK_NAMES)).max(STATIC_CHECK_NAMES.length).refine(checks => new Set(checks).size === checks.length),
  errorCount: count, warningCount: count, findings: z.array(findingSchema).max(100),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(receipt => {
  const complete = receipt.checks.length === STATIC_CHECK_NAMES.length && receipt.checks.every((name, index) => name === STATIC_CHECK_NAMES[index]);
  return receipt.staticChecksComplete === complete && receipt.ok === (receipt.errorCount === 0 && complete) &&
    receipt.findings.length === Math.min(100, receipt.errorCount + receipt.warningCount) &&
    receipt.findings.filter(finding => finding.severity === 'error').length <= receipt.errorCount &&
    receipt.findings.filter(finding => finding.severity === 'warning').length <= receipt.warningCount;
});
const replySchema = z.object({ type: z.literal('result'), receipt: receiptSchema }).strict();

export async function validateWorkingSource(snapshot: SubappSnapshot, signal: AbortSignal, options: WorkingSourceRunnerOptions = {}): Promise<WorkingSourceReceipt> {
  if (signal.aborted) throw new DOMException('Working-source validation cancelled.', 'AbortError');
  // Native admission and the deep schema snapshot happen before any await/post.
  const parsed = snapshotSchema.safeParse(snapshot);
  if (!parsed.success) throw new Error('Working source exceeds snapshot bounds or has an invalid artifact inventory.');
  return new Promise((resolve, reject) => {
    let worker: WorkingSourceWorker | undefined;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (receipt?: WorkingSourceReceipt, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (worker) {
        for (const [type, listener] of [['message', onMessage], ['error', onError], ['messageerror', onError]] as const) {
          try { worker.removeEventListener(type, listener); } catch { /* cleanup is best-effort for trusted test transports */ }
        }
        try { worker.terminate(); } catch { /* never expose transport details */ }
      }
      if (error) reject(error); else resolve(receipt!);
    };
    const fail = () => finish(undefined, new Error('Working-source static validation unavailable.'));
    const onMessage: EventListener = event => {
      try {
        const value: unknown = (event as MessageEvent).data;
        if (!safeSubappValue(value, 64_000)) { fail(); return; }
        const reply = replySchema.safeParse(value);
        if (!reply.success || reply.data.receipt.findings.some(finding => finding.file !== '(candidate)' &&
          !parsed.data.files.some(file => file.path === finding.file))) { fail(); return; }
        finish(reply.data.receipt);
      } catch { fail(); }
    };
    const onError: EventListener = event => { event.preventDefault(); fail(); };
    const onAbort = () => finish(undefined, new DOMException('Working-source validation cancelled.', 'AbortError'));
    try {
      worker = options.workerFactory?.() ?? new Worker(new URL('./subapp-source-validation.worker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.addEventListener('messageerror', onError);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) { onAbort(); return; }
      timer = setTimeout(() => finish(undefined, new Error('Working-source static validation timed out.')), 10_000);
      worker.postMessage(parsed.data);
    } catch { fail(); }
  });
}
