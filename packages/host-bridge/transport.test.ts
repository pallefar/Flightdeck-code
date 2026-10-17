import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { createPrivateClient, loopbackOrigin } from './transport';
import { FIXTURE_PEER } from './fixture';

it('uses a pinned literal loopback peer with no redirect, retry, arbitrary URL/path or ambient forwarding', async () => {
  let redirects = 0; let calls = 0;
  const target = createServer((_req, res) => { redirects++; res.end('{}'); });
  await new Promise<void>(r => target.listen(0, '127.0.0.1', r));
  const targetOrigin = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
  const source = createServer((req, res) => { calls++; expect(req.url).toBe('/private/studio-drafts/invoke'); expect(req.headers.cookie).toBeUndefined(); expect(req.headers.authorization).toBeUndefined(); req.resume(); res.writeHead(307, { location: targetOrigin, 'content-type': 'application/json; charset=utf-8' }); res.end('{"error":"NONSECRET-upstream-detail"}'); });
  await new Promise<void>(r => source.listen(0, '127.0.0.1', r));
  try {
    const client = createPrivateClient(`http://127.0.0.1:${(source.address() as AddressInfo).port}`, FIXTURE_PEER);
    await expect(client.call('/private/studio-drafts/invoke', {})).rejects.toMatchObject({ status: 503, message: 'bridge refused' });
    await expect((client.call as (path: string, body: unknown) => Promise<unknown>)('http://evil.test/private/studio-drafts/invoke', {})).rejects.toMatchObject({ status: 404 });
    expect(calls).toBe(1); expect(redirects).toBe(0);
    for (const invalid of ['http://localhost:1234', 'https://127.0.0.1:1234', 'http://127.0.0.1:1234/path', 'http://user:pass@127.0.0.1:1234', 'http://[::1]:1234', 'http://127.0.0.2:1234', 'http://127.0.0.1:1234/']) expect(() => loopbackOrigin(invalid)).toThrow();
    expect(() => createPrivateClient(targetOrigin, 'short-browser-token')).toThrow();
  } finally { await Promise.all([promisify(source.close.bind(source))(), promisify(target.close.bind(target))()]); }
});
