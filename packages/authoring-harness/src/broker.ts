import type Anthropic from '@anthropic-ai/sdk';
import { builtinRegistry, configSchemas, graphSchema } from '../../workflow/graph';
import { preservesWorkflowSteps } from '../../workflow/preservation';
import { registrySchemas } from './schemas';
import { toolInputs, nativeTools } from './tools';
import { toolUse } from './native';
import type { PolicyRequest } from './internal';
import { copyJson, digest, fail, Run, runs } from './internal';

export interface Binding {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly modelId: string;
  readonly modelBindingId: string;
  readonly contextEpoch: string;
  readonly policyEpoch: string;
}
export interface Limits {
  readonly maxModelCalls: number; readonly maxToolCalls: number; readonly maxConcurrent: number;
  readonly maxDurationMs: number; readonly maxInputBytes: number; readonly maxOutputBytes: number;
  readonly maxTotalOutputBytes: number; readonly maxTokensPerCall: number;
  readonly maxTotalOutputTokens: number; readonly maxEvents: number;
}
export interface BrokerOptions {
  readonly binding: Binding;
  readonly limits: Limits;
  readonly authorize: (request: PolicyRequest) => Promise<{ allowed: boolean; binding: Binding }>;
  /** Trusted original graph, or explicit null for a new draft. Never model-supplied protection. */
  readonly protectedGraph: unknown;
}

export function createDraftBroker(options: BrokerOptions) {
  const run = new Run(options);
  const protectedGraph = options.protectedGraph === null ? null : graphSchema.parse(copyJson(options.protectedGraph, run.limits.maxInputBytes));
  const protectedSteps = protectedGraph?.nodes.map(node => node.id) ?? [];
  const protectedGates = protectedGraph?.nodes.filter(node => node.type === 'approval') ?? [];
  const catalog = copyJson({ blocks: builtinRegistry.map(block => ({ ...block, availability: 'draft-only-adapter-not-probed' })) }, run.limits.maxOutputBytes);
  // These executable identities are private and pinned before ANY policy await. No extension registry.
  const handlers = Object.freeze({
    read_block_catalog: (_input: unknown) => catalog,
    read_block_schema: (input: unknown) => {
      const { type } = toolInputs.read_block_schema.parse(input);
      return { type, schema: registrySchemas[type], validation: 'structural-projection-runtime-refinements-authoritative', availability: 'draft-only-adapter-not-probed' };
    },
    propose_workflow_draft: (input: unknown) => {
      const { graph } = toolInputs.propose_workflow_draft.parse(input);
      const proposal = graphSchema.parse(graph);
      if (!preservesWorkflowSteps(proposal, protectedSteps, protectedGates.map(node => node.id))) fail('invalid');
      if (protectedGates.some(gate => {
        const candidate = proposal.nodes.find(node => node.id === gate.id);
        // Normalize only approval configs through their authoritative schema;
        // ordered dictionaries elsewhere in the graph retain their semantics.
        return !candidate || candidate.type !== gate.type || digest(configSchemas.approval.parse(candidate.config)) !== digest(configSchemas.approval.parse(gate.config));
      })) fail('invalid');
      return { status: 'draft-proposed', graph: proposal, executed: false, approved: false, deployed: false };
    },
  });
  async function dispatch(name: string, input: unknown, signal?: AbortSignal, toolUseId?: string): Promise<unknown> {
    if (!Object.hasOwn(handlers, name)) fail('denied');
    const identity = name as keyof typeof handlers;
    const handler = handlers[identity];
    const pinned = copyJson(input, run.limits.maxInputBytes);
    if (!toolInputs[identity].safeParse(pinned).success) fail('invalid');
    return run.execute(identity, digest(toolUseId === undefined ? pinned : { input: pinned, toolUseId }), () => {
      let result: unknown;
      try { result = handler(pinned); } catch { fail('invalid'); }
      return toolUseId === undefined ? result : { type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify(result), is_error: false };
    }, signal);
  }
  const broker = Object.freeze({
    tools: nativeTools,
    invoke: (name: string, input: unknown, signal?: AbortSignal) => dispatch(name, input, signal),
    async invokeNative(block: unknown, signal?: AbortSignal): Promise<Anthropic.ToolResultBlockParam> {
      const pinned = copyJson(block, run.limits.maxInputBytes);
      const parsed = toolUse.safeParse(pinned);
      if (!parsed.success) fail('invalid');
      return dispatch(parsed.data.name, parsed.data.input, signal, parsed.data.id) as Promise<Anthropic.ToolResultBlockParam>;
    },
    events: () => run.events(),
    snapshot: () => run.snapshot(),
    close: () => run.close(),
  });
  runs.set(broker, run);
  return broker;
}
export type DraftBroker = ReturnType<typeof createDraftBroker>;
