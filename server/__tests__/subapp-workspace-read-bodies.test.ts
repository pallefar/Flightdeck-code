import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { request, type IncomingMessage, type IncomingHttpHeaders, type OutgoingHttpHeaders } from 'node:http';
import { join } from 'node:path';
import { snapshotFixture } from '../../packages/subapp-workspace/testing';
import { MAX_SUBAPP_SNAPSHOT_BYTES, type SubappDocument, type SubappSummary } from '../../packages/subapp-workspace/schema';
import { createFileSubappWorkspaceStore } from '../subapp-workspace-store';
import { registerSubappWorkspaceRoutes } from '../subapp-workspace';

const authorization = 'Bearer DEVELOPMENT_ONLY_READ_BODY_FIXTURE';
const base = '/api/studio/workspaces/project-one/subapps';
const targets = [
  ['GET', 'collection'], ['HEAD', 'collection'],
  ['GET', 'document'], ['HEAD', 'document'],
] as const;
type Method = (typeof targets)[number][0];
type Target = (typeof targets)[number][1];
interface Response { status: number | undefined; headers: IncomingHttpHeaders; body: string }
let app: FastifyInstance;
let origin: string;
let root: string;
let draft: SubappDocument;
let summaries: SubappSummary[];
let storeAccesses: string[];
let authentications: Array<string | undefined>;

// Native HTTP, not Fetch/inject: GET/HEAD request bodies reach real loopback sockets.
function read(method: Method, target: Target, headers: OutgoingHttpHeaders, body: string | null = ''): Promise<Response> {
  const path = target === 'collection' ? base : `${base}/${draft.id}`;
  return new Promise((resolve, reject) => {
    // A full oversized upload plus Connection: close can reset before the early reply is read.
    // Keep only those transports persistent until response end; send the entire original body,
    // retain all socket-error rejection and destroy the owned request after exact readback.
    const connection = body !== null && Buffer.byteLength(body) > MAX_SUBAPP_SNAPSHOT_BYTES + 1_024 ? 'keep-alive' : 'close';
    const req = request(origin + path, { method, agent: false, headers: { connection, ...headers } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
        req.destroy();
      });
    });
    req.setTimeout(2_000, () => { req.destroy(new Error('loopback read timed out')); });
    req.on('error', reject);
    // null deliberately leaves the upload open: framing must be refused before waiting for bytes.
    if (body === null) req.flushHeaders();
    else req.end(body);
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(await realpath(process.env.TMPDIR!), 'subapp-read-bodies-'));
  const store = createFileSubappWorkspaceStore(join(root, 'private', 'drafts.json'));
  draft = await store.create('project-one', snapshotFixture(), 'alice');
  summaries = await store.list('project-one');
  storeAccesses = [];
  authentications = [];
  app = Fastify({ logger: false });
  registerSubappWorkspaceRoutes(app, {
    actor: 'alice',
    authenticate: header => { authentications.push(header); return header === authorization; },
    // Observe even method-property access; successful controls use the real file store.
    store: new Proxy(store, { get(target, property, receiver) {
      storeAccesses.push(String(property));
      return Reflect.get(target, property, receiver);
    } }),
  });
  origin = await app.listen({ host: '127.0.0.1', port: 0 });
});

afterEach(async () => {
  try { await app?.close(); }
  finally { if (root) await rm(root, { recursive: true, force: true }); }
});

function expectMalformed(response: Response, method: Method): void {
  expect(response.status).toBe(400);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).toBe(method === 'HEAD' ? '' : '{"error":"malformed request"}');
  expect(authentications).toEqual([authorization]);
  expect(storeAccesses).toEqual([]);
}

describe('private sub-app read body framing over real HTTP', () => {
  it('receives early refusal on a persistent connection during an oversized upload', async () => {
    const connections: Array<string | undefined> = [];
    const observe = (incoming: IncomingMessage): void => { connections.push(incoming.headers.connection); };
    // Synchronous native observation adds no async Fastify hook or alternate response path.
    app.server.prependListener('request', observe);
    try {
      const body = 'x'.repeat(2_002_000);
      const response = await read('GET', 'document', {
        authorization, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
      }, body);
      expectMalformed(response, 'GET');
      expect(connections).toEqual(['keep-alive']);
    } finally {
      app.server.removeListener('request', observe);
    }
  });

  it.each(targets)('rejects positive Content-Length on %s %s before store access', async (method, target) => {
    const body = '{"private":"READ_BODY_SENTINEL"}';
    const response = await read(method, target, {
      authorization, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
    }, body);
    expectMalformed(response, method);
  });

  it.each(targets)('rejects chunked bodies on %s %s before store access', async (method, target) => {
    const response = await read(method, target, {
      authorization, 'content-type': 'application/json', 'transfer-encoding': 'chunked',
    }, '{"private":"CHUNKED_READ_BODY_SENTINEL"}');
    expectMalformed(response, method);
  });

  it.each(targets)('rejects over-limit Content-Length on %s %s before store access', async (method, target) => {
    const body = 'x'.repeat(2_002_000);
    expect(Buffer.byteLength(body)).toBeGreaterThan(MAX_SUBAPP_SNAPSHOT_BYTES + 1_024);
    const response = await read(method, target, {
      authorization, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
    }, body);
    expectMalformed(response, method);
  });

  it.each(targets)('rejects over-limit chunked bodies on %s %s before store access', async (method, target) => {
    const body = 'x'.repeat(2_002_000);
    expect(Buffer.byteLength(body)).toBeGreaterThan(MAX_SUBAPP_SNAPSHOT_BYTES + 1_024);
    const response = await read(method, target, {
      authorization, 'content-type': 'application/json', 'transfer-encoding': 'chunked',
    }, body);
    expectMalformed(response, method);
  });

  it.each(targets)('rejects even zero-chunk stream framing on %s %s before store access', async (method, target) => {
    const response = await read(method, target, { authorization, 'transfer-encoding': 'chunked' });
    expectMalformed(response, method);
  });

  it.each(targets)('rejects Content-Length framing on %s %s without waiting for any body bytes', async (method, target) => {
    const response = await read(method, target, { authorization, 'content-length': '1' }, null);
    expectMalformed(response, method);
  });

  it.each(targets)('rejects chunked framing on %s %s without waiting for any chunks', async (method, target) => {
    const response = await read(method, target, { authorization, 'transfer-encoding': 'chunked' }, null);
    expectMalformed(response, method);
  });

  const refusedFraming = [
    ['positive-length', { 'content-length': '1' }, 'x'],
    ['chunked', { 'transfer-encoding': 'chunked' }, 'x'],
    ['over-limit-length', { 'content-length': '2002000' }, 'x'.repeat(2_002_000)],
    ['over-limit-chunked', { 'transfer-encoding': 'chunked' }, 'x'.repeat(2_002_000)],
    ['zero-chunk', { 'transfer-encoding': 'chunked' }, ''],
    ['pending-length', { 'content-length': '1' }, null],
    ['pending-chunked', { 'transfer-encoding': 'chunked' }, null],
  ] as const;
  const unauthenticatedCases = targets.flatMap(([method, target]) =>
    refusedFraming.map(([framing, headers, body]) => [method, target, framing, headers, body] as const));

  it.each(unauthenticatedCases)('authenticates %s %s before rejecting %s framing', async (method, target, _framing, headers, body) => {
    for (const credential of [undefined, 'Bearer INVALID_DEVELOPMENT_FIXTURE']) {
      const response = await read(method, target, {
        ...headers, ...(credential === undefined ? {} : { authorization: credential }),
        'content-type': 'application/json',
      }, body);
      expect(response.status).toBe(401);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toBe(method === 'HEAD' ? '' : '{"error":"authentication required"}');
      expect(storeAccesses).toEqual([]);
    }
    expect(authentications).toEqual([undefined, 'Bearer INVALID_DEVELOPMENT_FIXTURE']);
  });

  const emptyCases = targets.flatMap(([method, target]) =>
    [undefined, '0', '00'].map(length => [method, target, length] as const));

  it.each(emptyCases)('preserves %s %s reads with empty Content-Length %s', async (method, target, length) => {
    const response = await read(method, target, {
      authorization, ...(length === undefined ? {} : { 'content-length': length }),
    });
    const expected = target === 'collection' ? { drafts: summaries } : { draft };
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-length']).toBe(String(Buffer.byteLength(JSON.stringify(expected))));
    if (method === 'HEAD') expect(response.body).toBe('');
    else expect(JSON.parse(response.body)).toEqual(expected);
    expect(authentications).toEqual([authorization]);
    expect(storeAccesses).toEqual([target === 'collection' ? 'list' : 'get']);
  });
});
