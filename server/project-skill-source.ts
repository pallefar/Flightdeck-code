import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { z } from "zod";

const identity = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const skillSchema = z.object({
  id: identity,
  version: z.string().trim().min(1).max(64),
  content: z.string().min(1).max(2000),
}).strict();
const skillsSchema = z.array(skillSchema).max(8).refine(
  skills => new Set(skills.map(s => s.id)).size === skills.length,
);
const bundleSchema = z.object({
  version: z.literal(1),
  projects: z.record(identity, z.object({ skills: skillsSchema }).strict()),
}).strict();

export interface ProjectSkill {
  readonly id: string;
  readonly version: string;
  readonly content: string;
}

/** Explicitly operator-bound context, never a caller-selected file path. */
export function loadProjectSkillsFile(file: string | undefined): (projectId: string) => Promise<readonly ProjectSkill[]> {
  return async projectId => {
    if (!identity.safeParse(projectId).success) throw new Error("Project identity is invalid");
    if (file === undefined) return [];
    let bundle: z.infer<typeof bundleSchema>;
    try {
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await handle.stat();
        const maxBytes = 256 * 1024;
        if (!stat.isFile() || stat.size > maxBytes) throw new Error("invalid bundle file");
        // A fixed buffer bounds acquisition even if the file grows after stat.
        const bytes = Buffer.alloc(maxBytes + 1);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null);
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        if (offset > maxBytes) throw new Error("invalid bundle size");
        bundle = bundleSchema.parse(JSON.parse(bytes.subarray(0, offset).toString("utf8")));
      } finally {
        await handle.close();
      }
    } catch {
      throw new Error("Project skill bundle is invalid or unreadable");
    }
    return Object.hasOwn(bundle.projects, projectId) ? bundle.projects[projectId]!.skills : [];
  };
}
