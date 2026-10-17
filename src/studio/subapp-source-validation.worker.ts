import { snapshotSchema } from '../../packages/subapp-workspace/schema';
import { checkWorkingSource } from './subapp-source-validation';
import type { WorkingSourceReceipt } from './subapp-source-validation-runner';

// A dedicated local module worker, never an evaluator or a host/model transport.
const port = globalThis as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(value: unknown): void;
};
port.addEventListener('message', event => {
  void (async () => {
    try {
      const parsed = snapshotSchema.safeParse(event.data);
      if (!parsed.success) throw new Error('Invalid snapshot');
      const report = checkWorkingSource(parsed.data);
      const bytes = new TextEncoder().encode(JSON.stringify(parsed.data.files));
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      const sourceHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      const receipt: WorkingSourceReceipt = { ...report, sourceHash };
      port.postMessage({ type: 'result', receipt });
    } catch {
      port.postMessage({ type: 'error' });
    }
  })();
});
