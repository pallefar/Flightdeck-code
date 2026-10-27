// Isolated DEVELOPMENT ONLY: explicit nonsecret sentinels, never production identity/configuration.
// Run with npx tsx src/studio/__tests__/approvals-browser.fixture.ts, stop after browser checks.
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createServer } from '../../../server/index';
import { createFileWorkflowWorkspaceStore } from '../../../server/workflow-workspace-store';
import { WorkflowApprovalStore } from '../../../server/workflow-approval-store';
const dir = await mkdtemp(join(await realpath(process.env.TMPDIR!), 'approval-browser-development-'));
const token = 'development-only-nonsecret-operator-sentinel';
const options = { operator: { actor: 'Development Initiator', token }, workflowWorkspaceStore: createFileWorkflowWorkspaceStore(join(dir, 'workspace.json')) };
const app = createServer({ ...options, workflowApprovals: { store: new WorkflowApprovalStore(join(dir, 'approvals')),
 resolveIdentity: async req => req.headers.authorization !== `Bearer ${token}` ? null : { name: req.headers['x-development-reviewer'] === 'independent-test-sentinel' ? 'Development Independent Reviewer' : 'Development Initiator', active: true },
 authorize: async (_p, scope) => scope.projectId === 'development' && (!scope.nodeId || scope.reviewer === 'development-queue'),
} });
const disabled = createServer({ ...options, workflowWorkspaceStore: createFileWorkflowWorkspaceStore(join(dir, 'disabled-workspace.json')) });
const backend = await app.listen({ host: '127.0.0.1', port: 0 }), unavailable = await disabled.listen({ host: '127.0.0.1', port: 0 });
const vite = await createViteServer({ root: process.cwd(), server: { host: '127.0.0.1', port: 0, proxy: { '/api': backend, '/disabled-api': { target: unavailable, rewrite: path => path.replace('/disabled-api', '/api') } } } });
await vite.listen(); const address = vite.httpServer!.address();
if (typeof address !== 'object' || !address) throw new Error('fixture address unavailable');
console.log(JSON.stringify({ developmentOnly: true, browserUrl: `http://127.0.0.1:${address.port}/src/studio/__tests__/approvals-browser.html`, backend, unavailable }));
let stopping = false;
async function close() { if (stopping) return; stopping = true; await vite.close(); await app.close(); await disabled.close(); await rm(dir, { recursive: true, force: true }); process.exit(0); }
process.on('SIGTERM', () => { void close(); }); process.on('SIGINT', () => { void close(); });
