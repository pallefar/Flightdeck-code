import { z } from 'zod';

const text = z.string().max(512000);
const nativeId = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/);
export const toolUse = z.object({
  type: z.literal('tool_use'), id: nativeId, name: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  input: z.record(z.unknown()), caller: z.object({ type: z.literal('direct') }).strict().optional(),
  toolset_name: z.null().optional(),
}).strict();
const plainText = z.object({ type: z.literal('text'), text, citations: z.null().optional() }).strict();
const thinking = z.object({ type: z.literal('thinking'), thinking: text, signature: text.min(1) }).strict();
const redacted = z.object({ type: z.literal('redacted_thinking'), data: text.min(1) }).strict();
const assistantBlock = z.union([plainText, thinking, redacted, toolUse]);
const toolResult = z.object({ type: z.literal('tool_result'), tool_use_id: nativeId, content: z.union([text, z.array(plainText).max(100)]), is_error: z.boolean().optional() }).strict();
export const turnSchema = z.object({ messages: z.array(z.union([
  z.object({ role: z.literal('user'), content: z.union([text, z.array(z.union([plainText, toolResult])).max(100)]) }).strict(),
  z.object({ role: z.literal('assistant'), content: z.union([text, z.array(assistantBlock).max(100)]) }).strict(),
])).min(1).max(100) }).strict();
const tokens = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const messageSchema = z.object({
  id: nativeId, type: z.literal('message'), role: z.literal('assistant'), model: z.string().min(1).max(200),
  content: z.array(assistantBlock).max(100),
  stop_reason: z.enum(['end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'pause_turn', 'refusal', 'model_context_window_exceeded']),
  stop_sequence: text.nullable(), container: z.null(), stop_details: z.unknown(),
  usage: z.object({ input_tokens: tokens, output_tokens: tokens, cache_creation_input_tokens: tokens.nullable().optional(), cache_read_input_tokens: tokens.nullable().optional(), server_tool_use: z.null().optional() }).passthrough(),
}).strict();

// Truncated tool input is opaque. It is never parsed/dispatched or re-sent.
export const truncatedMessageSchema = messageSchema.extend({
  content: z.array(z.union([plainText, thinking, redacted, toolUse.extend({ input: z.unknown() })])).max(100),
});
