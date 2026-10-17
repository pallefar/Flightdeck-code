// Test-only identities and literal-loopback DEVELOPMENT connectors. Never production configuration.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from '../index';
import { createFileWorkflowWorkspaceStore } from '../workflow-workspace-store';
import { WorkflowApprovalStore } from '../workflow-approval-store';
import { ResourceStore } from '../../packages/resources/store';
import { ResourceRegistry } from '../../packages/resources/registry';
import { graphInput, graphOutput } from '../../packages/resources/development-mcp';
export const fixtureOperator = { actor: 'Alice Operator', token: 'fixture-operator-token-at-least-24-chars' };
export const fixtureReviewer = { authorization: 'Bearer fixture-reviewer-independent' };
export function fixtureRuntime(root: string, origin: string, resourceAllowed: () => boolean | Promise<boolean> = () => true) {
    const resourceStore = new ResourceStore(join(root, 'resources'));
    const registry = new ResourceRegistry([
        { id: 'measure', kind: 'rest', projects: ['project-one'], endpoint: origin + '/measure', method: 'GET', input: { type: 'object', properties: {}, required: [], additionalProperties: false }, output: { type: 'object', properties: { hits: { type: 'number' } }, required: ['hits'], additionalProperties: false } },
        { id: 'validate', kind: 'mcp', projects: ['project-one'], endpoint: origin + '/mcp', tool: 'validate_graph', readOnly: true, input: graphInput, output: graphOutput },
        { id: 'finish', kind: 'rest', projects: ['project-one'], endpoint: origin + '/finish', method: 'GET', query: { valid: 'valid' }, input: { type: 'object', properties: { valid: { type: 'boolean' } }, required: ['valid'], additionalProperties: false }, output: { type: 'object', properties: { receivedValid: { type: 'boolean' }, finishes: { type: 'number' } }, required: ['receivedValid', 'finishes'], additionalProperties: false } },
    ], { developmentOrigins: [origin] });
    const workspace = createFileWorkflowWorkspaceStore(join(root, 'workspace.json'));
    const approvals = new WorkflowApprovalStore(join(root, 'approvals'));
    const app = createServer({ operator: fixtureOperator, workflowWorkspaceStore: workspace,
        workflowResources: { store: resourceStore, registry, authorize: async (actor, project, action) => actor === fixtureOperator.actor && project === 'project-one' && (action !== 'execute' || resourceAllowed()) },
        workflowApprovals: { store: approvals, resolveIdentity: async (req) => req.headers.authorization === fixtureReviewer.authorization ? { name: 'Bob Reviewer', active: true } : req.headers.authorization === `Bearer ${fixtureOperator.token}` ? { name: fixtureOperator.actor, active: true } : null,
            authorize: async (identity, s) => s.projectId === 'project-one' && (!s.nodeId || s.reviewer === 'finance-queue') && (!s.nodeId || identity.name === 'Bob Reviewer') },
    });
    return { app, workspace, approvals, resourceStore, registry };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [root, origin, id, contextDigest, mode] = process.argv.slice(2);
    if (!root || !origin || !id || !contextDigest)
        throw new Error('fixture arguments required');
    const { app, workspace, approvals } = fixtureRuntime(root, origin);
    if (mode === 'crash-claimed' || mode === 'crash-approved') {
        await approvals.locked(id, async () => {
            const record = await approvals.read(id);
            await approvals.write({ ...record, state: 'approved', revision: 2, decisionBy: 'Bob Reviewer', decidedAt: new Date().toISOString() });
            if (mode === 'crash-claimed') {
                await approvals.claim(id);
                await workspace.beginResume!('project-one', record.run.draftId, record.run.id, record.run);
            }
            process.exit(17); // actual abrupt exit; permanent claim and lock survive
        });
    }
    else {
        const response = await app.inject({ method: 'POST', url: `/api/studio/workspaces/project-one/approvals/${id}/decisions`, headers: fixtureReviewer, payload: { approvalId: id, revision: 1, decision: 'approve', contextDigest } });
        process.stdout.write(JSON.stringify({ status: response.statusCode, body: response.json() }));
        await app.close();
    }
}
