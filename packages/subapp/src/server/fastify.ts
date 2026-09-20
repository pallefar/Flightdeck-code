/** HOST STAND-IN — not emitted. See `src/server/db.ts`.
 *
 * The host decorates `FastifyRequest` in three separate files
 * (`workspace/resolve.ts`, `project/resolve.ts`, `lib/rbac.ts`), each with its
 * own `declare module "fastify"`. The emitted guard reads all three properties,
 * so all three augmentations have to be in scope for it to typecheck here.
 *
 * ⚠ THIS AUGMENTATION IS PROGRAM-WIDE, and that is the one thing in this tree
 * that reaches outside the package: TypeScript merges it into every file that
 * imports `fastify`. It is declared to be shape-identical to the host's three,
 * so a file written against the host and a file written against this see the
 * same `FastifyRequest`. Nothing else in this package widens a shared type. */
import type { RequestProject } from "./project/types.js";
import type { WorkspaceRuntime } from "./workspace/types.js";

declare module "fastify" {
  interface FastifyRequest {
    /** `server/workspace/resolve.ts:44` — null when no workspace resolved. */
    workspace: WorkspaceRuntime | null;
    /** `server/project/resolve.ts:40`. */
    project: RequestProject | null;
    /** `server/lib/rbac.ts:28` — null when auth is off, never a stand-in name. */
    principal: { username: string; displayName: string } | null;
  }
}

export {};
