import { lstat } from 'node:fs/promises';
import { join } from 'node:path';

const refused = () => new Error('Studio bootstrap state refused');

/**
 * Deny only. The operator owns a stopped, trusted, immutable bootstrap root.
 * Metadata checks do not protect against a hostile concurrent namespace swap.
 */
export async function assertBootstrapStateUnmarked(stateDir) {
  try {
    // Validate before looking up any supplied path; never normalize traversal.
    if (typeof stateDir !== 'string' || !stateDir.startsWith('/') ||
        stateDir.includes('\\') || /[\x00-\x1f\x7f]/.test(stateDir)) throw refused();
    const parts = stateDir.slice(1).split('/');
    if (parts.some(part => !part || part === '.' || part === '..')) throw refused();

    for (let i = 0; i <= parts.length; i++) {
      const path = i === 0 ? '/' : '/' + parts.slice(0, i).join('/');
      let info;
      try {
        info = await lstat(path);
      } catch (error) {
        // Only the final component may be freshly absent. Never create it here.
        if (i === parts.length && error?.code === 'ENOENT') return;
        throw refused();
      }
      if (!info.isDirectory() || info.isSymbolicLink()) throw refused();
      if (i === parts.length &&
          ((info.mode & 0o7777) !== 0o700 || info.uid !== process.getuid())) throw refused();
    }

    try {
      // Any entry kind denies. Do not open, read, follow or mutate the marker.
      await lstat(join(stateDir, '.restore-blocked'));
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw refused();
    }
    throw refused();
  } catch {
    // Native errors may include private paths; expose only this fixed category.
    throw refused();
  }
}
