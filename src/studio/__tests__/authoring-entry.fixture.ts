// DEVELOPMENT ONLY: actual root/native SDK with fake fetch; never production credentials or providers.
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';
import { pathToFileURL } from 'node:url';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { FastifyRequest } from 'fastify';
import { createServer } from '../../../server/index';
import { createModelConnections } from '../../../server/model-connections';
import { createMemoryGrantStore } from '../../../packages/approvals/src/store';
import { createFileWorkflowWorkspaceStore } from '../../../server/workflow-workspace-store';
import { createFileSubappWorkspaceStore } from '../../../server/subapp-workspace-store';
import { ResourceStore } from '../../../packages/resources/store';
import { ResourceRegistry } from '../../../packages/resources/registry';
import base from '../../../vite.config';

const model = 'development-native-not-live';
const token = 'development-only-public-authoring-sentinel';
const graph = { version: 1, id: 'conditional', name: 'Conditional routing', customBlocks: [], nodes: [
  { id: 'start', type: 'manual', label: 'Manual input', position: { x: 40, y: 80 }, config: {} },
  { id: 'route', type: 'branch', label: 'Check request', position: { x: 250, y: 80 }, config: { field: 'approved', operator: 'equals', value: true } },
  { id: 'accepted', type: 'output', label: 'Accepted', position: { x: 470, y: 40 }, config: {} },
  { id: 'other', type: 'output', label: 'Other', position: { x: 470, y: 240 }, config: {} },
], edges: [{ id: 'first', source: 'start', target: 'route' }, { id: 'yes', source: 'route', sourcePort: 'true', target: 'accepted' }, { id: 'no', source: 'route', sourcePort: 'false', target: 'other' }] };
const spec = { profile: 'mini-app', id: 'review-form', label: 'Review form', icon: '📋', navSection: 'Contract pipeline', summary: 'Prepare a review proposal.', capabilities: ['write:inbox-proposal'], visibleToRoles: ['legal'], domains: [{ name: 'reviews', title: 'Reviews', routes: [{ method: 'POST', path: '/propose', summary: 'Prepare a proposal', operation: { kind: 'propose', proposalKind: 'review', ticketField: 'ticket', fields: [{ name: 'ticket', type: 'string', optional: false }], auditEvent: 'review-form.proposed' } }] }] };

export async function createAuthoringEntryFixture() {
  if (process.env.STUDIO_FRONTEND_ASSET_ROOT !== undefined) throw new Error('Fixture refuses ambient frontend configuration');
  const root = await mkdtemp(join(await realpath(join(homedir(), '.hermes/cache/scratch')), 'authoring-entry-browser-'));
  const sdkCalls: { native: boolean; tools: string[] }[] = [];
  const http: { method: string; url: string; engine?: string }[] = [];
  const client = new Anthropic({ apiKey: 'synthetic-not-a-provider-key', authToken: null, webhookKey: null, logLevel: 'off', maxRetries: 0, baseURL: 'https://api.anthropic.com', fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); const native = Array.isArray(body.tools);
    sdkCalls.push({ native, tools: native ? body.tools.map((tool: { name: string }) => tool.name) : [] });
    let content: unknown[];
    if (!native) {
      const target = JSON.parse(body.messages[0].content).prompt === 'Create a local conditional routing workflow.' ? 'workflow' : 'subapp';
      content = [{ type: 'text', text: JSON.stringify({ target, reason: target === 'workflow' ? 'A conditional graph.' : 'A proposal form.' }) }];
    } else {
      const subapp = body.tools[0].name === 'read_subapp_contract';
      const initial = body.messages.length === 1;
      const name = initial ? subapp ? 'read_subapp_contract' : 'read_block_catalog' : subapp ? 'propose_subapp_spec' : 'propose_workflow_draft';
      content = [{ type: 'tool_use', id: `fixture_call_${sdkCalls.length}`, name, input: initial ? {} : subapp ? { spec, understanding: 'A review proposal form.' } : { graph } }];
    }
    return new Response(JSON.stringify({ id: `fixture_msg_${sdkCalls.length}`, type: 'message', role: 'assistant', model, content, stop_reason: native ? 'tool_use' : 'end_turn', stop_sequence: null, container: null, stop_details: null, usage: { input_tokens: 5, output_tokens: 4, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }), { headers: { 'content-type': 'application/json' } });
  } });
  const app = createServer({ operator: { actor: 'Karsten Haldan', token }, nativeAuthoringEnabled: true,
    modelConnections: createModelConnections({ env: { STUDIO_ANTHROPIC_MODEL: model, FLIGHTDECK_EFFORT: 'low' }, anthropicClient: client }),
    anthropicSessionSetup: { enabled: false }, store: createMemoryGrantStore(), projectSkillSource: async () => [],
    workflowWorkspaceStore: createFileWorkflowWorkspaceStore(join(root, 'workflows.json')),
    subappWorkspaceStore: createFileSubappWorkspaceStore(join(root, 'subapps.json')),
    workflowResources: { store: new ResourceStore(join(root, 'resources')), registry: new ResourceRegistry([], {}), authorize: async () => false },
  });
  app.addHook('preHandler', async (request: FastifyRequest) => {
    const engine = request.url === '/api/studio/create' ? (request.body as { authoringEngine?: string })?.authoringEngine : undefined;
    http.push({ method: request.method, url: request.url, ...(engine ? { engine } : {}) });
  });
  app.get('/__authoring_fixture/metrics', async () => ({ developmentOnly: true, sdkCalls, http }));
  return { app, root, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await createAuthoringEntryFixture();
  const address = await fixture.app.listen({ host: '127.0.0.1', port: 0 });
  const vite = await createViteServer({ configFile: false, root: process.cwd(), ...(base.resolve ? { resolve: base.resolve } : {}), plugins: [react()], server: { host: '127.0.0.1', port: 0, hmr: false, proxy: { '/api': address, '/__authoring_fixture': address } } });
  await vite.listen(); const endpoint = vite.httpServer!.address(); if (!endpoint || typeof endpoint === 'string') throw new Error('Missing owned fixture address');
  console.log(JSON.stringify({ developmentOnly: true, processPid: process.pid, backend: address, url: `http://127.0.0.1:${endpoint.port}/src/studio/__tests__/authoring-entry.browser.html`, root: fixture.root }));
  let closing = false; const close = async () => { if (closing) return; closing = true; await vite.close(); await fixture.close(); process.exit(0); };
  process.on('SIGTERM', () => void close()); process.on('SIGINT', () => void close());
}
