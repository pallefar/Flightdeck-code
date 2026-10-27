import type { PlannerRequestLike, PlannerCompletionLike } from './planner-bridge';
import { requestModelResponse } from './model-transport';

export type CancelablePlannerLlm = (
  request: PlannerRequestLike & {readonly signal?: AbortSignal},
) => Promise<PlannerCompletionLike>;
export interface OpenAiCompatibleOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
  /** Trusted startup allowlist; exact canonical HTTPS origins only. */
  readonly approvedOrigins?: readonly string[];
  /** Trusted deterministic test transport only; policy validation still applies. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}
export function validateModelName(model: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model)) {
    throw new Error('Invalid model connection configuration');
  }
}
/** Strict, bounded trusted startup policy. No wildcard, URL normalization or DNS work. */
export function validateModelApprovedOrigins(origins: readonly string[] = []): readonly string[] {
  try {
    if (!Array.isArray(origins) || origins.length > 16 || new Set(origins).size !== origins.length || JSON.stringify(origins).length > 4096) throw new Error();
    for (const origin of origins) {
      if (typeof origin !== 'string' || origin.length > 256 || /[\\\\\s?#]/.test(origin)) throw new Error();
      const url = new URL(origin);
      if (url.protocol !== 'https:' || url.port === '0' || url.origin !== origin || url.username || url.password ||
          !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(url.hostname)) throw new Error();
    }
    return Object.freeze([...origins].sort());
  } catch { throw new Error('Invalid model connection configuration'); }
}
/** Literal canonical loopback HTTP only; reject URL-parser normalization tricks. */
export function validateModelBaseUrl(baseUrl: string): string {
  try {
    if (typeof baseUrl !== 'string' || baseUrl.length > 2048 || baseUrl.trim() !== baseUrl || /[\\\\\s?#]/.test(baseUrl)) throw new Error();
    const url = new URL(baseUrl);
    const authority = /^https?:\/\/([^/]+)/.exec(baseUrl)?.[1];
    const loopback = /^(127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/.test(authority ?? '');
    const canonical = `${url.origin}${url.pathname}`;
    if (!authority || url.port === '0' || authority.includes('@') || url.username || url.password || url.search || url.hash ||
        (baseUrl !== canonical && baseUrl !== canonical.replace(/\/$/, '')) ||
        !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) throw new Error();
    return canonical.replace(/\/$/, '');
  } catch { throw new Error('Invalid model connection configuration'); }
}
/** One nonstreaming structured completion; no tools, redirects, retries or raw error causes. */
export function openAiCompatibleLlm(options: OpenAiCompatibleOptions): CancelablePlannerLlm {
  const model=options.model,apiKey=options.apiKey,fetchImpl=options.fetchImpl;
  validateModelName(model);
  const baseUrl = validateModelBaseUrl(options.baseUrl);
  const approvedOrigins = validateModelApprovedOrigins(options.approvedOrigins);
  if (new URL(baseUrl).protocol === 'https:' && !approvedOrigins.includes(new URL(baseUrl).origin)) {
    throw new Error('Invalid model connection configuration');
  }
  const url = `${baseUrl}/chat/completions`;
  const timeoutMs = options.timeoutMs ?? 30000;
  const maxBytes = options.maxResponseBytes ?? 256000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 ||
      !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1000000 ||
      (apiKey !== undefined && (!apiKey || /[\r\n]/.test(apiKey)))) {
    throw new Error('Invalid model connection configuration');
  }
  return async request => {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let cancellation:Promise<void>|undefined;
    const cancelBody=()=>{if(reader && !cancellation) cancellation=reader.cancel().catch(()=>{});};
    controller.signal.addEventListener('abort',cancelBody,{once:true});
    const abort = () => controller.abort();
    request.signal?.addEventListener('abort', abort, {once: true});
    const timer = setTimeout(abort, timeoutMs);

    try {
      if (request.signal?.aborted || typeof request.system !== 'string' || typeof request.user !== 'string') throw new Error();
      const bodyJson = JSON.stringify({
        model,
        stream: false,
        response_format: {type: 'json_object'},
        max_tokens: 16000,
        messages: [{role: 'system', content: request.system}, {role: 'user', content: request.user}],
      });
      if (new TextEncoder().encode(bodyJson).byteLength > 256000) throw new Error();
      // Await the original operation: abort alone must not release admission capacity.
      return await (async () => {
        const headers = {
          'content-type': 'application/json',
          ...(apiKey ? {authorization: `Bearer ${apiKey}`} : {}),
        };
        const response = fetchImpl ? await fetchImpl(url, {
          signal: controller.signal,
          method: 'POST',
          redirect: 'error',
          headers,
          body: bodyJson,
        }) : await requestModelResponse(url,{signal:controller.signal,headers,body:bodyJson,maxBytes,approvedOrigins});
        if (controller.signal.aborted || !response.ok || response.redirected || !response.body) {
          await response.body?.cancel().catch(() => {});
          throw new Error();
        }
        reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const next = await reader.read();
          if(controller.signal.aborted) throw new Error();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > maxBytes) throw new Error();
          chunks.push(next.value);
        }
        const joined = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          joined.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const body = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(joined));
        if (!Array.isArray(body.choices) || body.choices.length !== 1) throw new Error();
        const choice = body.choices[0];
        if (choice.message?.tool_calls || choice.message?.function_call ||
            typeof choice.message?.content !== 'string' || !['stop', 'length'].includes(choice.finish_reason)) throw new Error();
        const text = choice.message.content;
        const truncated = choice.finish_reason === 'length';
        if (!truncated) {
          const parsed: unknown = JSON.parse(text);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        }
        return {text, truncated};
      })();
    } catch { throw new Error('Model connection request failed'); }
    finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', abort);

      controller.abort();
      cancelBody();
      await cancellation;
      controller.signal.removeEventListener('abort',cancelBody);
    }
  };
}
