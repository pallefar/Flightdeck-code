import { createHash, randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { createAnthropicToolPort } from '../packages/authoring-harness/src/anthropic-port';
import type { DraftBroker } from '../packages/authoring-harness/src/broker';
import { runs } from '../packages/authoring-harness/src/internal';
import type { Effort } from '../packages/providers/src/types';
import { AnthropicProvider } from '../packages/providers/src/anthropic';
import { plannerLlm } from '../packages/providers/src/planner-bridge';
import type { PlannerLlmLike } from '../packages/providers/src/planner-bridge';
import { DEFAULT_MODEL } from '../packages/providers/src/models';
import { isEffort } from '../packages/providers/src/types';
import { openAiCompatibleLlm, validateModelApprovedOrigins, validateModelBaseUrl, validateModelName } from '../packages/providers/src/openai-compatible';
import { MODEL_TRANSPORT_POLICY_ID } from '../packages/providers/src/model-transport';
import { CODEX_SAFETY_BLOCKER } from '../packages/providers/src/codex-subscription';

export const MODEL_CONNECTION_IDS = ['codex-chatgpt', 'flightdeck', 'local', 'anthropic'] as const;
export type ModelConnectionId = typeof MODEL_CONNECTION_IDS[number];
/** The only connection data suitable for a browser response. No destination or secret. */
export interface ModelConnectionDescriptor {
  readonly id: ModelConnectionId;
  readonly label: string;
  readonly model: string | null;
  readonly status: 'configured' | 'unavailable';
  readonly verification: 'not-probed';
  readonly reason?: string;
}
export type NativeModelPort = ReturnType<typeof createAnthropicToolPort>;
/** Server-only native model operation; never part of a browser descriptor. */
export interface NativeAuthoringCapability {
  readonly kind: 'anthropic-messages-v1';
  assertCurrent(): void;
  createPort(broker: DraftBroker, system: string): NativeModelPort;
}
export interface ResolvedModelConnection {
  readonly descriptor: ModelConnectionDescriptor;
  /** Server-only exact-context review binding; not a credential or permission. */
  readonly bindingId: string;
  readonly llm: PlannerLlmLike;
  readonly nativeAuthoring?: NativeAuthoringCapability;
}
export interface ModelConnectionsOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Trusted deterministic test fixture only: replaces sockets, never origin policy. */
  readonly localFetch?: typeof fetch;
  readonly anthropicClient?: Anthropic;
  /** Future approved host bridge. Current host task vocabulary has no Studio task. */
  readonly flightdeckLlm?: PlannerLlmLike;
  readonly flightdeckModel?: string;
  /** Must change when gateway, approved task contract, provider or policy changes. */
  readonly flightdeckBindingId?: string;
}
export interface ModelConnectionRegistry {
  readonly descriptors: readonly ModelConnectionDescriptor[];
  readonly selectedId: ModelConnectionId | undefined;
  resolve(id: string): ResolvedModelConnection;
  resolveSelected(): ResolvedModelConnection;
}
const labels: Record<ModelConnectionId, string> = {
  'codex-chatgpt': 'ChatGPT subscription (native Codex)',
  flightdeck: 'Flightdeck model service',
  local: 'Local / OpenAI-compatible model',
  anthropic: 'Anthropic API',
};
type NativeFactory = (bindingId: string, assertCurrent: () => void) => NativeAuthoringCapability;
// Preserve the exact admitted SDK without exposing it through either server capability or DTO.
const nativeFactories = new WeakMap<NativeAuthoringCapability, NativeFactory>();
function admitsNative(client: Anthropic): boolean {
  try {
    // Installed-SDK configuration admission, not confinement of a hostile injected client.
    const options = (client as unknown as { _options?: { defaultHeaders?: unknown; defaultQuery?: unknown } })._options;
    return client instanceof Anthropic && client.baseURL === 'https://api.anthropic.com' && client.logLevel === 'off'
      && Array.isArray(client.middleware) && client.middleware.length === 0 && typeof client.messages?.create === 'function'
      && !['body', 'method', 'headers', 'signal'].some(key => Object.hasOwn(client.fetchOptions ?? {}, key))
      && options !== undefined && options.defaultHeaders === undefined && options.defaultQuery === undefined;
  } catch { return false; }
}
/** Server-only session rebinding. Foreign capabilities cannot widen this SDK admission. */
export function rebindNativeAuthoring(original: NativeAuthoringCapability, bindingId: string, assertCurrent: () => void): NativeAuthoringCapability | undefined {
  return nativeFactories.get(original)?.(bindingId, () => { original.assertCurrent(); assertCurrent(); });
}
function anthropicNative(client: Anthropic, model: string, effort: Effort, bindingId: string): NativeAuthoringCapability {
  const apiKey = client.apiKey, authToken = client.authToken, webhookKey = client.webhookKey;
  const messages = client.messages, send = messages.create;
  let stale = false;
  const assertClient = () => {
    if (!admitsNative(client) || client.apiKey !== apiKey || client.authToken !== authToken || client.webhookKey !== webhookKey
      || client.messages !== messages || client.messages.create !== send) stale = true;
    if (stale) throw new Error('Model connection request failed');
  };
  const factory: NativeFactory = (exactBindingId, assertFresh) => {
    const assertCurrent = () => { assertFresh(); assertClient(); };
    const capability: NativeAuthoringCapability = Object.freeze({
      kind: 'anthropic-messages-v1' as const,
      assertCurrent,
      createPort(broker: DraftBroker, system: string): NativeModelPort {
        assertCurrent();
        const binding = runs.get(broker)?.binding;
        if (binding?.modelId !== model || binding.modelBindingId !== exactBindingId) throw new Error('Model connection request failed');
        const port = createAnthropicToolPort({ client, effort, broker, system });
        return Object.freeze({ async complete(...args: Parameters<NativeModelPort['complete']>) {
          assertCurrent();
          // No race: stale results fail only after the original broker/SDK operation settles.
          try { return await port.complete(...args); }
          finally { assertCurrent(); }
        } });
      },
    });
    nativeFactories.set(capability, factory);
    return capability;
  };
  return factory(bindingId, () => {});
}
function knownId(id: string): id is ModelConnectionId {
  return (MODEL_CONNECTION_IDS as readonly string[]).includes(id);
}
/** Runtime output check is not authorization: call this only inside gatedPlannerLlm. */
function boundedPlanner(llm: PlannerLlmLike): PlannerLlmLike {
  return async request => {
    try {
      if (typeof request.system !== 'string' || typeof request.user !== 'string' || Buffer.byteLength(JSON.stringify(request)) > 256000) throw new Error();
      const result = await llm(request);
      if (typeof result?.text !== 'string' || Buffer.byteLength(result.text) > 256000 || (result.truncated !== undefined && typeof result.truncated !== 'boolean')) throw new Error();
      if (!result.truncated) {
        const parsed: unknown = JSON.parse(result.text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      }
      return {text: result.text, truncated: result.truncated ?? false};
    } catch { throw new Error('Model connection request failed'); }
  };
}
/** Construction and list/resolve never probe, bill, read OAuth files or change destinations. */
export function createModelConnections(options: ModelConnectionsOptions = {}): ModelConnectionRegistry {
  const env = options.env ?? process.env;
  const selected = env.STUDIO_MODEL_CONNECTION;
  if (selected !== undefined && !knownId(selected)) throw new Error('Unknown model connection selection');
  const selectedId = selected as ModelConnectionId | undefined;
  const descriptions = new Map<ModelConnectionId, ModelConnectionDescriptor>();
  const connections = new Map<ModelConnectionId, ResolvedModelConnection>();
  for (const id of MODEL_CONNECTION_IDS) {
    descriptions.set(id, {id, label: labels[id], model: null, status: 'unavailable', verification: 'not-probed', reason:
      id === 'codex-chatgpt' ? CODEX_SAFETY_BLOCKER : id === 'flightdeck' ? 'Approved Studio host bridge/task contract is not configured' : 'Connection is not configured'});
  }
  function configure(id: ModelConnectionId, model: string, target: string, llm: PlannerLlmLike, native?: { client: Anthropic; effort: Effort }): void {
    validateModelName(model);
    const descriptor = Object.freeze({id, label: labels[id], model, status: 'configured' as const, verification: 'not-probed' as const});
    descriptions.set(id, descriptor);
    // A rebuilt Anthropic credential instance requires fresh review, even for the same key.
    const bindingId = createHash('sha256').update(JSON.stringify(['studio-model-binding-v1', id, target, model, ...(id === 'anthropic' ? [randomUUID()] : [])])).digest('hex');
    const nativeAuthoring = native && admitsNative(native.client) ? anthropicNative(native.client, model, native.effort, bindingId) : undefined;
    connections.set(id, Object.freeze({descriptor, bindingId, llm: boundedPlanner(llm), ...(nativeAuthoring ? { nativeAuthoring } : {})}));
  }
  function attempt(id: ModelConnectionId, action: () => void): void {
    try { action(); }
    catch {
      connections.delete(id);
      descriptions.set(id, {id, label: labels[id], model: null, status: 'unavailable', verification: 'not-probed', reason: 'Invalid model connection configuration'});
    }
  }
  if (env.STUDIO_LOCAL_BASE_URL !== undefined || env.STUDIO_LOCAL_MODEL !== undefined || env.STUDIO_LOCAL_API_KEY !== undefined) attempt('local', () => {
    if (!env.STUDIO_LOCAL_BASE_URL || !env.STUDIO_LOCAL_MODEL) throw new Error();
    const rawOrigins=env.STUDIO_MODEL_APPROVED_ORIGINS;
    if(rawOrigins!==undefined && Buffer.byteLength(rawOrigins)>4096) throw new Error();
    const approvedOrigins=validateModelApprovedOrigins(rawOrigins===undefined ? [] : JSON.parse(rawOrigins));
    const llm = openAiCompatibleLlm({baseUrl: env.STUDIO_LOCAL_BASE_URL, model: env.STUDIO_LOCAL_MODEL,approvedOrigins,
      ...(env.STUDIO_LOCAL_API_KEY === undefined ? {} : {apiKey: env.STUDIO_LOCAL_API_KEY}),
      ...(options.localFetch === undefined ? {} : {fetchImpl: options.localFetch})});
    configure('local', env.STUDIO_LOCAL_MODEL, JSON.stringify([validateModelBaseUrl(env.STUDIO_LOCAL_BASE_URL),MODEL_TRANSPORT_POLICY_ID,approvedOrigins]), llm);
  });
  if (options.flightdeckLlm && options.flightdeckModel && options.flightdeckBindingId) attempt('flightdeck', () => {
    if (!options.flightdeckBindingId || options.flightdeckBindingId.length > 200 || /[\r\n]/.test(options.flightdeckBindingId)) throw new Error();
    configure('flightdeck', options.flightdeckModel!, options.flightdeckBindingId, options.flightdeckLlm!);
  });
  if (env.ANTHROPIC_API_KEY !== undefined || env.ANTHROPIC_AUTH_TOKEN !== undefined || options.anthropicClient) attempt('anthropic', () => {
    const model = env.STUDIO_ANTHROPIC_MODEL ?? env.FLIGHTDECK_MODEL ?? DEFAULT_MODEL;
    validateModelName(model);
    const effort = env.FLIGHTDECK_EFFORT ?? 'high';
    if (!isEffort(effort)) throw new Error();
    for (const secret of [env.ANTHROPIC_API_KEY, env.ANTHROPIC_AUTH_TOKEN]) if (secret !== undefined && (!secret.trim() || /[\r\n]/.test(secret))) throw new Error();
    // SDK construction otherwise merges ambient headers outside the explicit startup snapshot.
    if (!options.anthropicClient && process.env.ANTHROPIC_CUSTOM_HEADERS !== undefined) throw new Error();
    const client = options.anthropicClient ?? new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY ?? null, authToken: env.ANTHROPIC_AUTH_TOKEN ?? null, webhookKey: null,
      baseURL: 'https://api.anthropic.com', maxRetries: 0, timeout: 30000, logLevel: 'off',
      fetch: (url, init) => fetch(url, {...init, redirect: 'error'}),
    });
    configure('anthropic', model, JSON.stringify(['https://api.anthropic.com', effort]), plannerLlm(new AnthropicProvider({model, effort, client})), { client, effort });
  });
  const descriptors = Object.freeze(MODEL_CONNECTION_IDS.map(id => Object.freeze(descriptions.get(id)!)));
  function resolve(id: string): ResolvedModelConnection {
    if (!knownId(id)) throw new Error('Unknown model connection');
    const connection = connections.get(id);
    if (!connection) throw new Error('Model connection unavailable');
    return connection;
  }
  return Object.freeze({descriptors, selectedId, resolve, resolveSelected: () => {
    if (!selectedId) throw new Error('No model connection selected');
    return resolve(selectedId);
  }});
}
