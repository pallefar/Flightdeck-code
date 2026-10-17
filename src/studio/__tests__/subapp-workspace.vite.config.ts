import { defineConfig, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import baseConfig from '../../../vite.config';
import Fastify from 'fastify';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { registerSubappWorkspaceRoutes } from '../../../server/subapp-workspace';
import { createFileSubappWorkspaceStore } from '../../../server/subapp-workspace-store';

/** Isolated synthetic loopback fixture, never the real Studio/operator store. */
export default defineConfig(async () => {
  const scratch = await realpath(process.env.SUBAPP_FIXTURE_SCRATCH ?? join(homedir(), '.hermes/cache/scratch'));
  const root = await mkdtemp(join(scratch, 'subapp-workspace-browser-'));
  const app = Fastify({ logger: false }); const requests: { method: string; url: string }[] = [];
  app.addHook('onRequest', async request => { requests.push({ method: request.method, url: request.url }); });
  registerSubappWorkspaceRoutes(app, {
    actor: 'synthetic-browser-fixture', authenticate: value => value === 'Bearer synthetic-subapp-fixture',
    store: createFileSubappWorkspaceStore(join(root, 'source.json')),
  });
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  return {
    ...(baseConfig.resolve ? { resolve: baseConfig.resolve } : {}),
    plugins: [react(), {
      name: 'owned-subapp-workspace-fixture',
      configureServer(server: ViteDevServer) {
        server.middlewares.use('/__subapp_fixture_evidence', (_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ requests })); });
        server.httpServer?.once('close', () => { void app.close().then(() => rm(root, { recursive: true, force: true })); });
      },
    }],
    server: { host: '127.0.0.1', port: 5196, strictPort: true, hmr: false, proxy: { '/api': address } },
  };
});
