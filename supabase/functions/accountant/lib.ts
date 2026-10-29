// The pure parts of the accountant function: no network, so they can be tested with `deno test`.
// The Anthropic API key is only ever used in index.ts, read from Supabase secrets.
import type Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import {RULES, TOOLS, VOICES, type Who} from "./prompt.ts";

type Message = Anthropic.Beta.Messages.BetaMessageParam;
export type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

/** A conversation as the phone sends it: whose it is, and every message so far, ending with the person's (or a tool result). */
export interface Ask { who: Who; messages: Message[] }

// A long conversation is still well under these; anything bigger isn't from the app.
export const MAX_BYTES = 256_000, MAX_MESSAGES = 160;

/**
 * Reads the phone's request. Only Tim or Frank, only the person's and the accountant's own messages (no system messages:
 * the rulebook is ours), starting and ending with the person's side. The API itself checks the blocks inside.
 */
export function readAsk(raw: string): Ask | {error: string} {
  if (new TextEncoder().encode(raw).length > MAX_BYTES) return {error: "too_big"};
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return {error: "bad_request"}; }
  const {who, messages} = (body ?? {}) as {who?: unknown; messages?: unknown};
  if (who !== "tim" && who !== "frank") return {error: "bad_request"};
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) return {error: "bad_request"};
  for (const m of messages) {
    if (!m || typeof m !== "object") return {error: "bad_request"};
    const {role, content} = m as {role?: unknown; content?: unknown};
    if (role !== "user" && role !== "assistant") return {error: "bad_request"};
    if (typeof content !== "string" && !Array.isArray(content)) return {error: "bad_request"};
  }
  if ((messages[0] as Message).role !== "user" || (messages[messages.length - 1] as Message).role !== "user") return {error: "bad_request"};
  return {who, messages: messages as Message[]};
}

/** Who's asking, from Supabase Auth's answer about their token: a signed-in user (anonymous counts), or no one. */
export function userOf(status: number, body: unknown): string | null {
  if (status !== 200 || !body || typeof body !== "object") return null;
  const {id, role} = body as {id?: unknown; role?: unknown};
  return typeof id === "string" && id && role === "authenticated" ? id : null;
}

/**
 * The request to Claude. Tools and system first and always the same, cached; the conversation after. Adaptive thinking at
 * medium effort. A request a safety filter wrongly declines is retried on the model's default fallback. If the rulebook
 * changes mid-conversation (a new deploy), old thinking is dropped rather than failing the question.
 */
export function params(ask: Ask, model: string): Params {
  return {
    model,
    max_tokens: 16000,
    thinking: {type: "adaptive", block_binding: {prefix_mismatch_behavior: "drop_block"}},
    output_config: {effort: "medium"},
    betas: ["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"],
    fallbacks: "default",
    tools: TOOLS,
    system: [{type: "text", text: RULES}, {type: "text", text: VOICES[ask.who], cache_control: {type: "ephemeral"}}],
    // and the conversation so far, so each tool round reads the earlier ones from the cache
    cache_control: {type: "ephemeral"},
    messages: ask.messages,
  };
}

/** What the phone is told when Claude can't be reached: a kind it can say calmly, never the provider's own message. */
export function failure(status: number | undefined): {status: number; error: string} {
  if (status === 429 || status === 529) return {status: 429, error: "busy"};
  if (status === 400 || status === 413) return {status: 400, error: "bad_request"};
  if (status === 401 || status === 403) return {status: 500, error: "not_configured"};
  return {status: 502, error: "unavailable"};
}

/** One log line per request: who, what model, how long, the tokens, why it stopped and which tools it asked for. Never what was said. */
export function logLine(x: {
  who: Who; model: string; ms: number; stop: string | null;
  usage?: {input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null};
  tools: string[];
}) {
  const u = x.usage ?? {};
  return JSON.stringify({
    who: x.who, model: x.model, ms: x.ms, stop: x.stop, tools: x.tools,
    in: u.input_tokens ?? 0, out: u.output_tokens ?? 0, cache_read: u.cache_read_input_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0,
  });
}
