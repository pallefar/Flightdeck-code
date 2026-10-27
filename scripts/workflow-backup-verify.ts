import { verifyOfflineSnapshot } from '../server/workflow-backup';
// Deliberately no create/extract/restore/start/retry command. Fixed output only.
const [command, archive, catalog, ...extra] = process.argv.slice(2);
try {
  if (command !== 'verify' || !archive || !catalog || extra.length) throw new Error();
  const report = await verifyOfflineSnapshot(archive, catalog);
  process.stdout.write(JSON.stringify(report) + '\n');
} catch {
  process.stderr.write('offline backup refused; restore remains blocked\n');
  process.exitCode = 1;
}
