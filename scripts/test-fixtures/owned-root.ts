// TEST ONLY: callers authorize an existing private TMPDIR, or an existing
// private homedir scratch anchor. Never create/chmod an ambient parent.
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

type Parent = { tmpdir?: string | undefined; home?: string };
const refused = (): never => { throw new Error('owned fixture refused'); };
const receipts: Record<string, unknown>[] = [];
function literal(path: string) {
  if (typeof path !== 'string' || !path.startsWith('/') || /[\\\x00-\x1f\x7f]/.test(path)
    || path.slice(1).split('/').some(p => !p || p === '.' || p === '..')) refused();
}
async function privateDirectory(path: string) {
  literal(path);
  const parts = path.slice(1).split('/');
  for (let i = 0; i <= parts.length; i++) {
    const info = await lstat(i ? '/' + parts.slice(0, i).join('/') : '/');
    if (!info.isDirectory() || info.isSymbolicLink()) refused();
  }
  const named = await lstat(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o7777) !== 0o700
      || info.dev !== named.dev || info.ino !== named.ino || await realpath(path) !== path) refused();
    return info;
  } finally { await handle.close(); }
}
export async function ownedFixtureParent(options?: Parent): Promise<string> {
  try {
    const tmpdir = options === undefined ? process.env.TMPDIR : options.tmpdir;
    let parent = tmpdir;
    if (parent === undefined) {
      const home = options?.home ?? homedir();
      await privateDirectory(home);
      parent = join(home, '.hermes/cache/scratch');
    }
    await privateDirectory(parent);
    return parent;
  } catch { return refused(); }
}
export async function createOwnedFixture(prefix: string, options?: Parent) {
  if (!/^[a-z][a-z0-9-]*-$/.test(prefix)) return refused();
  const parent = await ownedFixtureParent(options);
  const dir = await mkdtemp(join(parent, prefix));
  if (dirname(dir) !== parent) return refused();
  const identity = await privateDirectory(dir);
  let cleaned = false;
  const clean = async (evidence: Record<string, unknown> = {}) => {
    if (cleaned) return;
    try {
      await privateDirectory(parent);
      const current = await privateDirectory(dir);
      if (current.dev !== identity.dev || current.ino !== identity.ino || dirname(dir) !== parent) refused();
      // rm never receives caller input: this closure owns exactly this mkdtemp inode.
      // The private namespace must remain immutable while checked/removed; not openat race protection.
      await rm(dir, { recursive: true, force: false });
      const absent = await lstat(dir).then(() => false, (e: NodeJS.ErrnoException) => e.code === 'ENOENT');
      if (!absent) refused();
      cleaned = true;
      receipts.push({ ...evidence, dir, parent, uid: identity.uid, mode: identity.mode & 0o7777, dev: identity.dev, ino: identity.ino, absent: true });
    } catch { return refused(); }
  };
  try {
    const env: Record<string, string> = {
      HOME: join(dir, 'home'), TMPDIR: join(dir, 'tmp'),
      XDG_CONFIG_HOME: join(dir, 'config'), XDG_CACHE_HOME: join(dir, 'cache'),
      PATH: '/usr/local/bin:/usr/bin:/bin', TSX_DISABLE_CACHE: '1', NODE_DISABLE_COMPILE_CACHE: '1',
    };
    for (const key of ['HOME', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME'] as const) {
      await mkdir(env[key]!, { mode: 0o700 }); await privateDirectory(env[key]!);
    }
    return { dir, env, clean };
  } catch (error) { await clean(); throw error; }
}
export function fixtureCleanupReceipt(test: string | undefined) {
  process.stdout.write('[owned-fixture-cleanup]' + JSON.stringify({ test, roots: receipts.splice(0) }) + '\n');
}
