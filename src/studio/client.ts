import { parseStudioResult, type StudioResult } from "./result";
import { connectionIdSchema, readStudioJson, type ModelConnectionId } from './connection';
import { customBlockSchema } from '../../packages/workflow/graph';
import { z } from 'zod';
export interface CreateRequest { connectionId: ModelConnectionId; authoringEngine?: 'native-v1'; prompt: string; projectId?: string; answers?: Record<string, string>; reviewedSkillHash?: string }
export async function createDraft(request: CreateRequest, token: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<StudioResult> {
  if (!connectionIdSchema.safeParse(request.connectionId).success) throw new Error('Select a model connection before creating a draft.');
  if (request.authoringEngine !== undefined && (request.authoringEngine !== 'native-v1' || request.connectionId !== 'anthropic')) throw new Error('Native authoring requires the supported native-v1 engine and Anthropic connection. No fallback is attempted.');
  if (typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 8000) throw new Error('Request must contain 1–8000 characters. No draft requested.');
  let response: Response;
  try {
    response = await fetcher("/api/studio/create", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(request), signal, credentials: "same-origin" });
  } catch (error) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    throw new Error("Studio server unavailable — no draft accepted. Check your Studio deployment URL and server availability. Development only: npm run dev:server provides the local API.");
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("Authentication refused. Enter the operator token configured as STUDIO_OPERATOR_TOKEN on the Studio server.");
    if (response.status === 404) throw new Error("Studio create API unavailable — no draft accepted. Verify that your deployment serves /api/studio/create. Development only: npm run dev:server provides the local API.");
    if (response.status === 409) throw new Error(request.authoringEngine === 'native-v1' ? 'Native authoring is unavailable for this server or connection. No fallback is attempted.' : 'Selected model connection unavailable or unselected. Check connection configuration and select a usable destination; no fallback is attempted.');
    if (response.status === 429) throw new Error('Studio is busy — request not accepted. No automatic retry; send again explicitly when ready.');
    if (response.status === 503) throw new Error('Studio authoring is unavailable — no draft accepted. Check server-side service availability. No automatic retry.');
    throw new Error(`Studio server returned HTTP ${response.status} — no draft accepted. Check server-side service availability; no automatic retry.`);
  }
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error("Invalid Studio response — expected JSON, no draft accepted."); }
  const result = parseStudioResult(body);
  if ((result.status === "workflow-proposed" || result.status === "workflow-graph-proposed") && request.projectId !== undefined && result.projectId !== request.projectId) throw new Error("Invalid Studio response — project scope does not match the requested project. No draft accepted.");
  return result;
}

export async function proposeBlock(prompt: string, connectionId: ModelConnectionId, token: string, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  if (!connectionIdSchema.safeParse(connectionId).success) throw new Error('Select a model connection before proposing a block.');
  try {
    const response = await fetcher('/api/studio/blocks/propose', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ prompt, connectionId }), signal });
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!response.ok) throw new Error();
    const result = z.object({ status: z.literal('block-proposed'), block: customBlockSchema, reviewRequired: z.literal(true) }).strict().parse(await readStudioJson(response, 256_000));
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    return result.block;
  } catch {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    throw new Error('Block proposal refused or unavailable. Check the selected model connection; no fallback is attempted.');
  }
}
