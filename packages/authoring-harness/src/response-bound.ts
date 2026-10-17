import type { Middleware } from '@anthropic-ai/sdk/core/middleware';
import { fail } from './internal';

/** Consume only the bounded original body, awaiting reads AND cancellation, before SDK JSON decoding. */
export function boundedResponse(maxBytes: number): Middleware {
  return async (request, next) => {
    const response = await next(request);
    if (!response.body) return response;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) fail('budget');
        chunks.push(chunk.value);
      }
      return new Response(Buffer.concat(chunks, bytes), { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      // No Promise.race: a hung original read/cancel keeps this request admitted.
      try { await reader.cancel(); } catch { /* The original failure remains authoritative. */ }
      throw error;
    } finally { reader.releaseLock(); }
  };
}
