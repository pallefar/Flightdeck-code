import { mkdir, open, rmdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { WorkspaceError } from './workflow-workspace-store';
export async function syncDirectory(path: string): Promise<void> { const h = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try {
    await h.sync();
}
finally {
    await h.close();
} }
/** Crashed locks are never automatically reclaimed: investigate before retry. */
export async function workflowFileLock<T>(path: string, work: () => Promise<T>): Promise<T> {
    for (let i = 0;; i++) {
        try {
            await mkdir(path, { mode: 0o700 });
            break;
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
                throw error;
            if (i >= 100)
                throw new WorkspaceError(409);
            await new Promise(r => setTimeout(r, 20));
        }
    }
    try {
        return await work();
    }
    finally {
        await rmdir(path);
    }
}
