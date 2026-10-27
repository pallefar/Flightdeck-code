import type { FastifyRequest } from 'fastify';
import type { HostState } from './authority';

/** Structural SDK projection only; tested against non-executing AST extraction of the actual host declarations. */
export interface SubAppProjectAvailability { openable: boolean; blockedReason: string | null; nextStep: string; path?: string }
export interface SubAppProjectDirectory {
  workspace: { id: string; label: string };
  selectedProjectId: string;
  projects: Array<{ id: string; label: string; enabled: boolean; isDefault: boolean; path?: string; application: SubAppProjectAvailability; contractDesk: SubAppProjectAvailability }>;
}
export interface NativeHostContext {
  projectDirectory?(req: FastifyRequest): Promise<SubAppProjectDirectory>;
  reauthorizeRequest?(req: FastifyRequest): Promise<{ actor: string; effectiveRole: string } | null>;
}
export interface NativeRequestView {
  principal: { username: string; displayName: string; pending?: boolean } | null;
  workspace: { id: string; enabled: boolean } | null;
  project: { id: string; enabled: boolean } | null;
}
export interface NativeAdapterOptions {
  authRequired: boolean; workspacesEnabled: boolean;
  context: NativeHostContext;
  /** Trusted in-process projection of already resolved req.principal/workspace/project. NEVER a browser JSON object/header. */
  view(request: FastifyRequest): NativeRequestView;
  /** Additional HOST-OWNED nonsecret session/context revision source. NOT supplied by the inspected SDK; missing refuses.
   * Must freshly bind the actual request session, account/membership/custom-policy/enabled context and invalidate changes.
   * This remains a host implementation prerequisite, not a fabricated grant or cookie read in Studio. */
  epochs?: (request: FastifyRequest) => Promise<{ sessionVersion: string; authorityVersion: string } | null>;
}
/** No host module import/boot, dotenv, DB, cookie parsing, roster read or implicit role/owner/app-consent grant. */
export function createNativeContextAdapter(options: NativeAdapterOptions) {
  return {
    async current(request: FastifyRequest): Promise<HostState | null> {
      const ctx = options.context;
      if (!options.authRequired || !options.workspacesEnabled || !ctx.reauthorizeRequest || !ctx.projectDirectory || !options.epochs) return null;
      try {
        const first = options.view(request);
        if (!first.principal || first.principal.pending || !first.workspace?.enabled || !first.project?.enabled) return null;
        const actorId = first.principal.username; const workspaceId = first.workspace.id; const projectId = first.project.id;
        if (!actorId || actorId !== actorId.trim().toLowerCase()) return null;
        const initial = await ctx.reauthorizeRequest(request);
        if (!initial || initial.actor !== actorId || !initial.effectiveRole) return null;
        const directory = await ctx.projectDirectory(request);
        // Native directory rereads workspace membership; it is not generic Studio action permission.
        if (directory.workspace.id !== workspaceId || directory.selectedProjectId !== projectId || !directory.projects.some(p => p.id === projectId && p.enabled)) return null;
        const epochs = await options.epochs(request); if (!epochs) return null;
        const final = await ctx.reauthorizeRequest(request);
        const last = options.view(request);
        if (!final || final.actor !== actorId || final.effectiveRole !== initial.effectiveRole || !last.principal || last.principal.username !== actorId || last.principal.pending || !last.workspace?.enabled || last.workspace.id !== workspaceId || !last.project?.enabled || last.project.id !== projectId) return null;
        return { actorId, displayName: last.principal.displayName, workspaceId, projectId, ...epochs, active: true, pending: false, member: true, workspaceEnabled: true, projectEnabled: true };
      } catch { return null; }
    },
  };
}
