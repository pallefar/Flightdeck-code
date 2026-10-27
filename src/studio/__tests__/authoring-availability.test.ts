import { expect, it, vi } from 'vitest';
import { readAuthoringAvailability } from '../authoring';
import { createServer } from '../../../server/index';
import { createMemoryGrantStore } from '../../../packages/approvals/src/store';

it.each([
  { enabled: 'yes' }, { maxModelCalls: 7 }, { maxToolCalls: 17 }, { executed: true }, { deployed: true },
  { connectionIds: ['local'] }, { engine: 'native-v2' }, { privateMaterial: 'must never be reflected' },
])('rejects inconsistent native metadata without reflecting its body %#', async changed => {
  const body = { engine: 'native-v1', enabled: true, connectionIds: ['anthropic'], maxModelCalls: 6, maxToolCalls: 16, draftOnly: true, executed: false, deployed: false, ...changed };
  await expect(readAuthoringAvailability('development-only', new AbortController().signal, async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }))).rejects.toThrow('Native authoring metadata unavailable. No native draft requested; no fallback is attempted.');
});
it('treats a missing older-server metadata route as unavailable without selecting or sending', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('not installed', { status: 404 }));
  expect(await readAuthoringAvailability('development-only', new AbortController().signal, fetcher)).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]).toMatchObject(['/api/studio/authoring', { method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store' }]);
});
it.each(['', 'contains\r\nheader'])('rejects invalid operator metadata input before transport %#', async token => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(readAuthoringAvailability(token, new AbortController().signal, fetcher)).rejects.toThrow('Native authoring metadata unavailable');
  expect(fetcher).not.toHaveBeenCalled();
});

it('cancels even an abort-ignoring metadata fetch and discards its late response', async () => {
  let deliver!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(() => new Promise(resolve => { deliver = resolve; }));
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const abort = new AbortController();
  let rejected = false;
  const pending = readAuthoringAvailability('development-only', abort.signal, fetcher);
  const outcome = pending.catch(error => { rejected = true; return error; });
  abort.abort();
  try {
    await new Promise(resolve => setImmediate(resolve));
    expect(rejected).toBe(true);
  } finally {
    deliver(new Response(new ReadableStream<Uint8Array>({ cancel })));
    expect((await outcome).name).toBe('AbortError');
  }
  await new Promise(resolve => setImmediate(resolve));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('bounds stalled availability headers without aborting the caller or accepting a late reply', async () => {
  vi.useFakeTimers();
  const abort = new AbortController();
  let deliver!: (response: Response) => void;
  let transportSignal: AbortSignal | undefined;
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const fetcher = vi.fn<typeof fetch>((_url, init) => {
    transportSignal = init?.signal ?? undefined;
    return new Promise(resolve => { deliver = resolve; });
  });
  let settled = 'pending';
  const pending = readAuthoringAvailability('development-only', abort.signal, fetcher);
  const outcome = pending.then(() => { settled = 'accepted'; }, error => { settled = 'rejected'; return error; });
  try {
    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe('rejected');
    expect(transportSignal?.aborted).toBe(true);
    expect(abort.signal.aborted).toBe(false);
  } finally {
    deliver(new Response(new ReadableStream<Uint8Array>({ cancel })));
    await outcome;
    vi.useRealTimers();
  }
  expect((await outcome).message).toContain('Native authoring metadata unavailable');
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('bounds an unresponsive metadata body without awaiting its cancel promise', async () => {
  vi.useFakeTimers();
  const abort = new AbortController();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const stream = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); }, cancel });
  const pending = readAuthoringAvailability('development-only', abort.signal, async () => new Response(stream, { headers: { 'content-type': 'application/json' } }));
  const outcome = pending.catch(error => error);
  try {
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await outcome).message).toContain('Native authoring metadata unavailable');
    expect(abort.signal.aborted).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it.each([200, 404, 503])('removes its deadline and caller-abort listener after metadata HTTP %s', async status => {
  vi.useFakeTimers();
  const abort = new AbortController();
  let transportSignal: AbortSignal | undefined;
  const metadata = { engine: 'native-v1', enabled: true, connectionIds: ['anthropic'], maxModelCalls: 6, maxToolCalls: 16, draftOnly: true, executed: false, deployed: false };
  const fetcher: typeof fetch = async (_url, init) => {
    transportSignal = init?.signal ?? undefined;
    return new Response(JSON.stringify(metadata), { status, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await readAuthoringAvailability('development-only', abort.signal, fetcher).catch(error => error);
    if (status === 200) expect(result).toEqual(metadata);
    else if (status === 404) expect(result).toBeNull();
    else expect(result.message).toContain('Native authoring metadata unavailable');
    expect(vi.getTimerCount()).toBe(0);
    abort.abort();
    expect(transportSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(transportSignal?.aborted).toBe(false);
  } finally { vi.useRealTimers(); }
});

it('cancels a hung metadata stream without awaiting an untrusted cancellation promise', async () => {
  let pulling!: () => void; const started = new Promise<void>(resolve => { pulling = resolve; });
  const stream = new ReadableStream<Uint8Array>({ pull() { pulling(); return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } });
  const abort = new AbortController();
  const pending = readAuthoringAvailability('development-only', abort.signal, async () => new Response(stream, { headers: { 'content-type': 'application/json' } }));
  const outcome = pending.then(() => 'accepted', error => error.name);
  await started; abort.abort();
  expect(await Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve('hung'), 40))])).toBe('AbortError');
});

it('loads only the strict authenticated no-probe metadata from the actual server root', async () => {
  const operator = { actor: 'Karsten Haldan', token: 'development-authoring-metadata-only' };
  const llm = vi.fn();
  const app = createServer({ operator, llm, llmBindingId: 'development-authoring', store: createMemoryGrantStore(), nativeAuthoringEnabled: true });
  const calls: string[] = [];
  const transport: typeof fetch = async (url, init) => {
    calls.push(String(url));
    const response = await app.inject({ method: 'GET', url: String(url), headers: Object.fromEntries(new Headers(init?.headers)) });
    return new Response(response.body, { status: response.statusCode, headers: { 'content-type': 'application/json' } });
  };
  try {
    const status = await readAuthoringAvailability(operator.token, new AbortController().signal, transport);
    expect(status).toEqual({ engine: 'native-v1', enabled: true, connectionIds: ['anthropic'], maxModelCalls: 6, maxToolCalls: 16, draftOnly: true, executed: false, deployed: false });
    expect(calls).toEqual(['/api/studio/authoring']);
    expect(llm).not.toHaveBeenCalled();
  } finally { await app.close(); }
});
