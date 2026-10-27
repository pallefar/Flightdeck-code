import { createServer, request as httpRequest } from 'node:http';
import type { RequestOptions } from 'node:https';
import { request as httpsRequest } from 'node:https';
import { lookup } from 'node:dns/promises';
import { getDefaultAutoSelectFamily } from 'node:net';
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { requestJson } from './transport';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('node:https', () => ({ request: vi.fn() }));
afterEach(() => { vi.mocked(lookup).mockReset(); vi.mocked(httpsRequest).mockReset(); });

it('connects a hostname resource through the checked DNS pin with automatic family selection', async () => {
  expect(getDefaultAutoSelectFamily()).toBe(true);
  const address = { address: '93.184.216.34', family: 4 };
  vi.mocked(lookup).mockResolvedValue([address] as never);
  let hits = 0;
  const lookupRequests: boolean[] = [];
  const callbackShapes: string[] = [];
  const server = createServer((req, res) => {
    hits++;
    expect(req.headers.host).toBe(`resource.test:${(server.address() as { port: number }).port}`);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ checked: true }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  vi.mocked(httpsRequest).mockImplementation(((url: URL, options: RequestOptions, callback: Parameters<typeof httpRequest>[2]) => {
    expect(url.hostname).toBe('resource.test');
    expect(url.protocol).toBe('https:');
    expect(options.agent).toBe(false);
    const pin = options.lookup!;
    // Only the trusted fixture substitutes TLS with owned loopback HTTP. The
    // actual Node socket still requests and validates the native lookup shape.
    return httpRequest(`http://resource.test:${port}/measure`, {
      ...options,
      lookup: (hostname, lookupOptions, done) => {
        lookupRequests.push(lookupOptions.all === true);
        pin(hostname, lookupOptions, ((error: Error | null, result: string | Array<{ address: string; family: number }>, family?: number) => {
          if (error) { done(error, '', 4); return; }
          callbackShapes.push(Array.isArray(result) ? 'array' : 'scalar');
          if (Array.isArray(result)) {
            expect(result).toEqual([address]);
            done(null, result.map(value => ({ ...value, address: '127.0.0.1' })));
          } else {
            expect(result).toBe(address.address);
            // Preserve the callback's shape, including the old broken scalar
            // response to all:true, so Node itself rejects the original code.
            done(null, '127.0.0.1', family!);
          }
        }) as never);
      },
    }, callback!);
  }) as typeof httpsRequest);
  try {
    const result = await requestJson(`https://resource.test:${port}/measure`, { method: 'GET' }, {}).then(value => ({ ok: true, value }), error => ({ ok: false, statusCode: error.statusCode }));
    expect(lookup).toHaveBeenCalledExactlyOnceWith('resource.test', { all: true });
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    expect(lookupRequests).toEqual([true]);
    expect(callbackShapes).toEqual(['array']);
    expect(result).toMatchObject({ ok: true, value: { value: { checked: true } } });
    expect(hits).toBe(1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('returns only the checked address in scalar and all-address callback shapes', async () => {
  const address = { address: '93.184.216.34', family: 4 };
  vi.mocked(lookup).mockResolvedValue([address, { address: '8.8.8.8', family: 4 }] as never);
  const observed: Array<{ error: Error | null; result: unknown; family?: number | undefined }> = [];
  let requestOptions: RequestOptions | undefined;
  let requestedURL: string | undefined;
  vi.mocked(httpsRequest).mockImplementation(((url: URL, options: RequestOptions) => {
    requestedURL = url.href; requestOptions = options;
    const pin = options.lookup!;
    pin('unrelated.test', { all: false }, (error, result, family) => {
      observed.push({ error, result, family });
    });
    pin('unrelated.test', { all: true }, ((error: Error | null, result: Array<{ address: string; family: number }>) => {
      observed.push({ error, result: Array.isArray(result) ? result.map(value => ({ ...value })) : result });
      if (Array.isArray(result)) result[0]!.address = '169.254.169.254';
    }) as never);
    pin('resource.test', { all: true }, ((error: Error | null, result: unknown) => {
      observed.push({ error, result });
    }) as never);
    throw new Error('trusted fixture stops before any external socket');
  }) as typeof httpsRequest);
  await expect(requestJson('https://resource.test/measure', { method: 'GET' }, {})).rejects.toMatchObject({ statusCode: 502 });
  // Assert outside the request seam so production error sanitization cannot
  // accidentally turn an assertion failure into the expected 502 result.
  expect(requestedURL).toBe('https://resource.test/measure');
  expect(requestOptions?.agent).toBe(false);
  expect(requestOptions?.hostname).toBeUndefined();
  expect(requestOptions?.rejectUnauthorized).not.toBe(false);
  expect(observed).toEqual([
    { error: null, result: address.address, family: 4 },
    { error: null, result: [address] },
    { error: null, result: [address] },
  ]);
  expect(lookup).toHaveBeenCalledExactlyOnceWith('resource.test', { all: true });
  expect(httpsRequest).toHaveBeenCalledTimes(1);
});

it.each([
  [],
  [{ address: '127.0.0.1', family: 4 }],
  [{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }],
  [{ address: '93.184.216.34', family: 4 }, { address: '::1', family: 6 }],
].map(addresses => ({ addresses })))('retains refusal of empty or unsafe DNS answer sets %# before HTTPS', async ({ addresses }) => {
  vi.mocked(lookup).mockResolvedValue(addresses as never);
  await expect(requestJson('https://resource.test/measure', { method: 'GET' }, {})).rejects.toMatchObject({ statusCode: 403 });
  expect(lookup).toHaveBeenCalledExactlyOnceWith('resource.test', { all: true });
  expect(httpsRequest).not.toHaveBeenCalled();
});
