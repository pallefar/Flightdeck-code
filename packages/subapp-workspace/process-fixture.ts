/** Executed only by the real-process concurrency fixture, never imported by production. */
import { once } from 'node:events';
import { createFileSubappWorkspaceStore, SubappWorkspaceError } from '../../server/subapp-workspace-store';
import { snapshotFixture } from './testing';

const [file, action, id] = process.argv.slice(2);
if (!file || !['create', 'update'].includes(action ?? '') || !process.send) throw new Error('fixture arguments required');
const store = createFileSubappWorkspaceStore(file);
const saved = action === 'update' && id ? await store.get('project-one', id) : undefined;
const snapshot = saved?.snapshot ?? snapshotFixture();
if (saved) snapshot.files[0]!.contents += `\n// development process ${process.pid}\n`;
process.send({ ready: true });
await once(process, 'message');
try {
  const draft = action === 'update' && id ? await store.update('project-one', id, snapshot, 1, 'fixture-writer') : await store.create('project-one', snapshot, 'fixture-writer');
  process.send({ result: { status: 200, id: draft.id, revision: draft.revision } });
} catch (error) {
  if (!(error instanceof SubappWorkspaceError)) throw error;
  process.send({ result: { status: error.statusCode } });
}
process.disconnect();
