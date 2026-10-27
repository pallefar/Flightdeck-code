import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

it('executable demo defaults disabled and explicitly scoped synthetic mode exercises durable draft readback', async () => {
  const run = promisify(execFile);
  const disabled = await run(process.execPath, ['--import', 'tsx', 'examples/host-bridge-draft.ts'], { cwd: process.cwd() });
  expect(JSON.parse(disabled.stdout)).toMatchObject({ mode: 'disabled', disabledStatus: 503, hostMounted: false, liveHostSessionValidated: false });
  const allowed = await run(process.execPath, ['--import', 'tsx', 'examples/host-bridge-draft.ts', '--synthetic-drafts'], { cwd: process.cwd() });
  const result = JSON.parse(allowed.stdout);
  expect(result).toMatchObject({ mode: 'isolated-synthetic-drafts', disabledStatus: 503, namespaceIsolation: true, reconstructedExact: true, stableCanonicalActor: true, hostMounted: false, liveHostSessionValidated: false, effects: { modelSends: 0, credentials: 0, executions: 0, approvals: 0, activations: 0, installs: 0, publications: 0 } });
});
