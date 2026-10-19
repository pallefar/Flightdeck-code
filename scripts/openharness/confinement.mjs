// Native negative controls run BEFORE package acquisition or SDK import.
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { existsSync, writeFileSync } from 'node:fs';
const checks = [];
const check = (id, ok) => { assert.equal(ok, true, id); checks.push({ id, passed: true }); };
let denied = false;
await new Promise((resolve, reject) => {
  const socket = createConnection({ host: '127.0.0.1', port: 9 });
  socket.setTimeout(2000, () => { socket.destroy(); reject(Error('native network control timed out')); });
  socket.once('error', error => { denied = error.code === 'EPERM' || error.code === 'EACCES'; resolve(); });
  socket.once('connect', () => { socket.destroy(); reject(Error('native network control was allowed')); });
});
check('native-loopback-socket-os-denied', denied);
let writeDenied = false;
try { writeFileSync(process.argv[2], 'DEVELOPMENT confinement negative control', { flag: 'wx' }); }
catch (error) { writeDenied = error.code === 'EPERM' || error.code === 'EACCES'; }
check('outside-owned-root-write-os-denied', writeDenied && !existsSync(process.argv[2]));
writeFileSync(process.argv[3], JSON.stringify({ checks, passed: checks.length, policy: 'macOS sandbox-exec deny network*; writes only owned scratch' }, null, 2) + '\n');
