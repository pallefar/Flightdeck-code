export const binding = {
  actorId: 'author', workspaceId: 'workspace', projectId: 'project',
  modelId: 'fixture-model', modelBindingId: 'fixture-binding', contextEpoch: 'context-1', policyEpoch: 'policy-1',
};
export const limits = {
  maxModelCalls: 4, maxToolCalls: 12, maxConcurrent: 2, maxDurationMs: 10000,
  maxInputBytes: 128000, maxOutputBytes: 128000, maxTotalOutputBytes: 512000,
  maxTokensPerCall: 512, maxTotalOutputTokens: 2048, maxEvents: 64,
};
export const allow = async () => ({ allowed: true, binding: { ...binding } });
export const graph = {
  version: 1 as const, id: 'draft', name: 'Draft',
  nodes: [
    { id: 'start', type: 'manual', label: 'Start', position: { x: 0, y: 0 }, config: {} },
    { id: 'review', type: 'approval', label: 'Review', position: { x: 100, y: 0 }, config: { reviewer: 'independent', reason: 'Protected review' } },
    { id: 'end', type: 'output', label: 'End', position: { x: 200, y: 0 }, config: {} },
  ],
  edges: [{ id: 'a', source: 'start', target: 'review' }, { id: 'b', source: 'review', target: 'end' }],
  customBlocks: [],
};
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
export function brokerOptions() { return { binding: { ...binding }, limits: { ...limits }, authorize: allow, protectedGraph: structuredClone(graph) }; }
