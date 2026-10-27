import { constants } from 'node:fs';
import { lstat, mkdtemp, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { createFileWorkflowWorkspaceStore, workspaceGraphSchema, WorkspaceError, type WorkflowDraft } from '../../server/workflow-workspace-store';
import { BridgeError, bodyDigest, targetFor, type Binding, type WireRequest } from './authority';

const MARKER = 'isolated-host-bridge-draft-fixture-v1\n';
/** Always creates a NEW private root; never initializes or adopts a legacy workspace. */
export async function createDraftRoot(parent: string): Promise<string> {
  const directory = await mkdtemp(join(await realpath(parent), 'host-bridge-drafts-'));
  const f = await open(join(directory, '.host-bridge-drafts'), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await f.writeFile(MARKER); await f.sync(); } finally { await f.close(); }
  return directory;
}
export interface DraftHooks { beforeWrite?: () => Promise<void>; afterRead?: () => Promise<void> }
export async function openDraftService(root: string, hooks: DraftHooks = {}) {
  if (!isAbsolute(root) || resolve(root) !== root || await realpath(root) !== root) throw new BridgeError(503);
  const dir = await lstat(root);
  if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o777) !== 0o700 || (process.getuid && dir.uid !== process.getuid())) throw new BridgeError(503);
  const marker = await open(join(root, '.host-bridge-drafts'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { const s = await marker.stat(); if (!s.isFile() || s.nlink !== 1 || s.size !== Buffer.byteLength(MARKER) || (s.mode & 0o777) !== 0o600 || await marker.readFile('utf8') !== MARKER) throw new BridgeError(503); }
  finally { await marker.close(); }
  const counters = { readEntries: 0, writeEntries: 0, modelSends: 0, credentials: 0, executions: 0, approvals: 0, activations: 0, installs: 0, publications: 0 };
  return {
    counters,
    async execute(wire: WireRequest, binding: Readonly<Binding>, recheck: () => Promise<Readonly<Binding>>): Promise<{ status: number; body: { workspaceId: string; projectId: string; draft?: WorkflowDraft; drafts?: WorkflowDraft[] } }> {
      const target = targetFor(wire.method, wire.path);
      if (wire.method !== binding.method || wire.path !== binding.path || bodyDigest(wire.body) !== binding.bodyDigest || target.workspaceId !== binding.workspaceId || target.projectId !== binding.projectId || target.action !== binding.action) throw new BridgeError(403);
      // The injective tuple encoding is never a filesystem path, and is separate from every legacy store root.
      const namespace = [target.workspaceId, target.projectId].map(id => Buffer.from(id).toString('hex'));
      const store = createFileWorkflowWorkspaceStore(join(root, 'tuples', namespace[0]!, namespace[1]!, 'workspace.json'));
      const scope = { workspaceId: target.workspaceId, projectId: target.projectId };
      const check = async () => { const current = await recheck(); if (JSON.stringify(current) !== JSON.stringify(binding)) throw new BridgeError(403); };
      try {
        if (target.action === 'draft.list' || target.action === 'draft.read') {
          await check(); counters.readEntries++;
          const draft = target.draftId ? await store.get(target.projectId, target.draftId) : undefined;
          const drafts = target.action === 'draft.list' ? await store.list(target.projectId) : undefined;
          await hooks.afterRead?.(); await check(); // No private DTO returned after an awaited read without fresh authority.
          if (target.action === 'draft.read' && !draft) throw new BridgeError(404);
          return { status: 200, body: { ...scope, ...(draft ? { draft } : {}), ...(drafts ? { drafts } : {}) } };
        }
        let json: unknown;
        try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(wire.body)); } catch { throw new BridgeError(400); }
        const parsed = (target.action === 'draft.create' ? z.object({ graph: workspaceGraphSchema }).strict() : z.object({ graph: workspaceGraphSchema, expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict()).safeParse(json);
        if (!parsed.success) throw new BridgeError(400);
        await hooks.beforeWrite?.(); await check();
        // Entry check is immediately before the existing async store API, NOT atomic with its lock/read/fsync/rename.
        counters.writeEntries++;
        const draft = target.action === 'draft.create'
          ? await store.create(target.projectId, parsed.data.graph, binding.actorId)
          : await store.update(target.projectId, target.draftId!, parsed.data.graph, 'expectedRevision' in parsed.data ? parsed.data.expectedRevision as number : 0, binding.actorId);
        await check();
        return { status: target.action === 'draft.create' ? 201 : 200, body: { ...scope, draft } };
      } catch (error) {
        if (error instanceof BridgeError) throw error;
        if (error instanceof WorkspaceError) throw new BridgeError(error.statusCode);
        throw new BridgeError(503);
      }
    },
  };
}
export type DraftService = Awaited<ReturnType<typeof openDraftService>>;
