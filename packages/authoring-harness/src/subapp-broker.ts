import type Anthropic from '@anthropic-ai/sdk';
import type { BrokerOptions } from './broker';
import { CAPABILITY_SCOPES, miniAppSpecSchema, NAV_SECTIONS, WORKSPACE_ROLES } from '../../codegen/src/spec-contract';
import { copyJson, digest, fail, Run, runs } from './internal';
import { toolUse } from './native';
import { subappNativeTools, subappToolInputs } from './subapp-tools';
import type { SubappDraftSpec } from './subapp-tools';

export interface SubappSpecReceipt {
  readonly status: 'subapp-spec-proposed'; readonly spec: SubappDraftSpec; readonly understanding: string;
  readonly executed: false; readonly approved: false; readonly deployed: false;
}
export type SubappBrokerOptions = Omit<BrokerOptions, 'protectedGraph'> & { readonly protectedGraph: null };

/** Separate fixed tool registry; shares the accepted Run ledger and native port. */
export function createSubappDraftBroker(options: SubappBrokerOptions) {
  if (options?.protectedGraph !== null) fail('invalid');
  const run = new Run(options);
  const contract = copyJson({
    profile: 'mini-app', validation: 'bounded-subset-and-miniAppSpecSchema-authoritative', authority: 'declarative-only-no-host-grants',
    inputSchema: subappNativeTools[1]!.input_schema,
    vocabulary: { capabilities: CAPABILITY_SCOPES, visibleToRoles: WORKSPACE_ROLES, navSections: NAV_SECTIONS, operations: ['list-contracts', 'list-proposals', 'propose'] },
    limitations: ['No tables, settings panels, arbitrary source, files, filesystem paths or credentials.', 'Only bounded HTTP route paths, GET list operations and POST proposal forms.', 'Audience/capability consent and source evidence are validated by the trusted parent pipeline, not this schema.'],
  }, run.limits.maxOutputBytes);
  const handlers = Object.freeze({
    read_subapp_contract: (_input: unknown) => contract,
    propose_subapp_spec: (input: unknown): SubappSpecReceipt => {
      const parsed = subappToolInputs.propose_subapp_spec.parse(input);
      // The actual generator input validator remains authoritative; never generate here.
      if (!miniAppSpecSchema.safeParse(parsed.spec).success) fail('invalid');
      return { status: 'subapp-spec-proposed', spec: parsed.spec, understanding: parsed.understanding, executed: false, approved: false, deployed: false };
    },
  });
  async function dispatch(name: string, input: unknown, signal?: AbortSignal, toolUseId?: string): Promise<unknown> {
    if (!Object.hasOwn(handlers, name)) fail('denied');
    const identity = name as keyof typeof handlers;
    const handler = handlers[identity];
    const pinned = copyJson(input, run.limits.maxInputBytes);
    if (!subappToolInputs[identity].safeParse(pinned).success) fail('invalid');
    return run.execute(identity, digest({ name: identity, input: pinned, ...(toolUseId === undefined ? {} : { toolUseId }) }), () => {
      let result: unknown;
      try { result = handler(pinned); } catch { fail('invalid'); }
      return toolUseId === undefined ? result : { type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify(result), is_error: false };
    }, signal);
  }
  const broker = Object.freeze({
    tools: subappNativeTools,
    invoke: (name: string, input: unknown, signal?: AbortSignal) => dispatch(name, input, signal),
    async invokeNative(block: unknown, signal?: AbortSignal): Promise<Anthropic.ToolResultBlockParam> {
      const pinned = copyJson(block, run.limits.maxInputBytes);
      const parsed = toolUse.safeParse(pinned);
      if (!parsed.success) fail('invalid');
      return dispatch(parsed.data.name, parsed.data.input, signal, parsed.data.id) as Promise<Anthropic.ToolResultBlockParam>;
    },
    events: () => run.events(), snapshot: () => run.snapshot(), close: () => run.close(),
  });
  runs.set(broker, run);
  return broker;
}
export type SubappDraftBroker = ReturnType<typeof createSubappDraftBroker>;
