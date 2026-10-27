import { z } from 'zod';
import { readStudioJson } from './connection';

const availabilitySchema = z.object({
  engine: z.literal('native-v1'), enabled: z.boolean(), connectionIds: z.tuple([z.literal('anthropic')]),
  maxModelCalls: z.literal(6), maxToolCalls: z.literal(16),
  draftOnly: z.literal(true), executed: z.literal(false), deployed: z.literal(false),
}).strict();
export type AuthoringAvailability = z.infer<typeof availabilitySchema>;
const unavailable = () => new Error('Native authoring metadata unavailable. No native draft requested; no fallback is attempted.');
const current = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); };

/** Own the source reader so abort cannot hang behind an untrusted cancel promise. */
async function readMetadata(response: Response, signal: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  let sink!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { sink = controller; },
    async pull(controller) {
      try {
        current(signal); const part = await reader.read(); current(signal);
        if (part.done) controller.close(); else controller.enqueue(part.value);
      } catch { cancel(); controller.error(unavailable()); }
    },
    cancel,
  }, { highWaterMark: 0 });
  const aborted = () => { cancel(); sink.error(new DOMException('Cancelled', 'AbortError')); };
  signal.addEventListener('abort', aborted, { once: true });
  try { current(signal); return await readStudioJson(new Response(stream, { headers: response.headers }), 4096); }
  finally { signal.removeEventListener('abort', aborted); cancel(); try { reader.releaseLock(); } catch { /* Pending cancelled pull retains its own lock until settlement. */ } }
}

async function loadAuthoringAvailability(token: string, signal: AbortSignal, fetcher: typeof fetch): Promise<AuthoringAvailability | null> {
  current(signal);
  if (!token || /[\x00-\x20\x7f-\x9f]/.test(token)) throw unavailable();
  try {
    const response = await fetcher('/api/studio/authoring', { method: 'GET', signal, cache: 'no-store', credentials: 'omit', redirect: 'error', headers: { Authorization: `Bearer ${token}` } });
    if (signal.aborted) { void response.body?.cancel().catch(() => {}); current(signal); }
    if (response.status === 404) { void response.body?.cancel().catch(() => {}); return null; }
    if (response.status !== 200) { void response.body?.cancel().catch(() => {}); throw unavailable(); }
    const value = await readMetadata(response, signal);
    current(signal);
    const parsed = availabilitySchema.safeParse(value);
    if (!parsed.success) throw unavailable();
    return parsed.data;
  } catch { current(signal); throw unavailable(); }
}

export const AUTHORING_AVAILABILITY_DEADLINE_MS = 5_000;

/** Bounded configuration read, not a model probe, engine selection or hard real-time deadline. */
export async function readAuthoringAvailability(token: string, signal: AbortSignal, fetcher: typeof fetch = (...args) => fetch(...args)): Promise<AuthoringAvailability | null> {
  current(signal);
  const owned = new AbortController();
  const forwardAbort = () => owned.abort();
  signal.addEventListener('abort', forwardAbort, { once: true });
  let aborted!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    aborted = () => reject(new DOMException('Cancelled', 'AbortError'));
    owned.signal.addEventListener('abort', aborted, { once: true });
  });
  const deadline = setTimeout(() => owned.abort(), AUTHORING_AVAILABILITY_DEADLINE_MS);
  try {
    // loadAuthoringAvailability still observes late responses and cancels their bodies.
    return await Promise.race([loadAuthoringAvailability(token, owned.signal, fetcher), cancelled]);
  } catch { current(signal); throw unavailable(); }
  finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', forwardAbort);
    owned.signal.removeEventListener('abort', aborted);
  }
}
