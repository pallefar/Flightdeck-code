import { z } from "zod";
export const MODEL_CONNECTION_IDS = ['codex-chatgpt', 'flightdeck', 'local', 'anthropic'] as const;
export const connectionIdSchema = z.enum(MODEL_CONNECTION_IDS);
export type ModelConnectionId = z.infer<typeof connectionIdSchema>;
const publicText = z.string().min(1).max(1000).refine(value => !/[\r\n\x00-\x1f]|https?:\/\/|\b(?:sk-|Bearer\s)/i.test(value));
const descriptorSchema = z.object({ id: connectionIdSchema, label: publicText, model: publicText.nullable(), status: z.enum(['configured', 'unavailable']), verification: z.literal('not-probed'), reason: publicText.optional() }).strict().refine(d => d.status !== 'configured' || d.model !== null);
export type ModelConnectionDescriptor = z.infer<typeof descriptorSchema>;
const descriptorsSchema = z.object({ connections: z.array(descriptorSchema).length(4), selectedId: connectionIdSchema.nullable() }).strict().refine(d => new Set(d.connections.map(c => c.id)).size === 4);
const healthSchema = z.object({ ok: z.literal(true), selectedId: connectionIdSchema.nullable(), model: publicText.nullable(), modelStatus: z.enum(['configured', 'unavailable', 'unselected']), verification: z.literal('not-probed'), processBuild: z.literal('registered-templates-v1').optional() }).strict();
const skillsSchema = z.object({ projectId: z.string().max(64), skillSourceState: z.enum(["loaded", "empty", "unavailable"]), skillSources: z.array(z.object({ id: publicText, version: publicText, contentHash: publicText }).strict()).max(100) }).strict();
export type ConnectionStatus = z.infer<typeof healthSchema> & z.infer<typeof descriptorsSchema> & z.infer<typeof skillsSchema>;
/** Bounded browser-only DTO reader; never exposes raw server/transport errors. */
export async function readStudioJson(response: Response, maxBytes = 32_000): Promise<unknown> {
  const invalid = () => new Error('Invalid connection response — no configuration verified.');
  if (!response.headers.get('content-type')?.includes('application/json')) throw invalid();
  const reader = response.body?.getReader(); if (!reader) throw invalid();
  let bytes = 0; let text = ''; const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > maxBytes) throw invalid();
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode(); return JSON.parse(text) as unknown;
  } catch { await reader.cancel().catch(() => {}); throw invalid(); }
  finally { reader.releaseLock(); }
}
export async function checkConnection(projectId: string, token: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<ConnectionStatus> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(projectId)) throw new Error("Project ID must be a lowercase project identifier, not a path or URL.");
  if (!token || /[\r\n]/.test(token)) throw new Error('Authentication refused. Check the operator token.');
  const read = async (url: string): Promise<unknown> => {
    let response: Response;
    try { response = await fetcher(url, { credentials: 'same-origin', cache: 'no-store', headers: { Authorization: `Bearer ${token}` }, ...(signal ? { signal } : {}) }); }
    catch { throw new Error('Studio server unavailable. Run npm run dev:server on port 8787.'); }
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Authentication refused. Check the operator token.' : `Studio connection returned HTTP ${response.status}. Check the updated server configuration.`);
    return readStudioJson(response);
  };
  const health = healthSchema.safeParse(await read('/api/studio/health'));
  if (!health.success) throw new Error('Invalid connection response — no configuration verified.');
  const descriptors = descriptorsSchema.safeParse(await read('/api/studio/model-connections'));
  if (!descriptors.success) throw new Error('Invalid connection response — no configuration verified.');
  const selected = descriptors.data.connections.find(d => d.id === descriptors.data.selectedId);
  if (health.data.selectedId !== descriptors.data.selectedId || health.data.model !== (selected?.model ?? null) || health.data.modelStatus !== (selected?.status ?? 'unselected')) throw new Error('Invalid connection response — inconsistent configuration.');
  const skills = skillsSchema.safeParse(await read(`/api/studio/projects/${projectId}/skills`));
  if (!skills.success || skills.data.projectId !== projectId) throw new Error('Invalid connection response — no configuration verified.');
  return { ...health.data, ...descriptors.data, ...skills.data };
}