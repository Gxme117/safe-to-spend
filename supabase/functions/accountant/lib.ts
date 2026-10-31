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

/** When a sign-in token runs out (ms), from its own `exp`; null when it isn't a token we can read. */
export function tokenExp(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const {exp} = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {exp?: unknown};
    return typeof exp === "number" ? exp * 1000 : null;
  } catch { return null; }
}

/** Kept until this long (ms) before a token runs out, so one that's about to go is asked about again. */
export const SIGNED_IN_SPARE = 60_000;

/**
 * Tokens Supabase Auth has already said are signed in, so the later rounds of a conversation (the same token each time)
 * don't ask again: each kept until shortly before it runs out, at most `max` of them, the oldest going first. One instance
 * keeps it while it's warm; a new one asks again. A token signed out of before it runs out still works here until then.
 */
export function signedInCache(max = 500) {
  const seen = new Map<string, {user: string; until: number}>();
  return {
    get(token: string, now: number): string | null {
      const s = seen.get(token);
      if (s && s.until > now) return s.user;
      seen.delete(token);
      return null;
    },
    set(token: string, user: string, now: number) {
      const exp = tokenExp(token);
      if (exp === null || exp - SIGNED_IN_SPARE <= now) return;
      if (seen.size >= max) seen.delete(seen.keys().next().value!);
      seen.set(token, {user, until: exp - SIGNED_IN_SPARE});
    },
  };
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

// Their voices, for the line of each answer they say out loud (POST /say). The same voice, model, settings and delivery as
// their recorded openings (mobile/scripts/voice.py), chosen here, never by the phone, so this can only ever be one of them
// saying a short line. Credits go by the character, so MAX_SAY is what a line can cost at most.
// accent: how every one of his openings starts.
export const SPEAKERS: Record<Who, {voice: string; accent: string}> = {
  tim: {voice: "qxePw1S1QmBgjlU3GIy5", accent: "[softly, a little shy]"},
  frank: {voice: "QzTKubutNn9TjrB7Xb2Q", accent: "[strong New York accent, low and tired]"}, // Jerry B.
};
export const VOICE_MODEL = "eleven_v4";
export const MAX_SAY = 200;
export const sayUrl = (who: Who) =>
  `https://api.elevenlabs.io/v1/text-to-speech/${SPEAKERS[who].voice}/with-timestamps?output_format=mp3_22050_32`;

/** The line the phone wants said, and who says it: 1 to MAX_SAY characters, Tim or Frank (Frank when it doesn't say, as an
 *  app from before Tim spoke asks). */
export function readSay(raw: string): {who: Who; text: string} | {error: string} {
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return {error: "bad_request"}; }
  const {text, who = "frank"} = (body ?? {}) as {text?: unknown; who?: unknown};
  if (who !== "tim" && who !== "frank") return {error: "bad_request"};
  if (typeof text !== "string" || !text.trim()) return {error: "bad_request"};
  if (text.trim().length > MAX_SAY) return {error: "too_big"};
  return {who, text: text.trim()};
}

/** What ElevenLabs is asked for: his line, in his delivery, as his openings are. */
export const sayBody = (who: Who, text: string) =>
  ({text: `${SPEAKERS[who].accent} ${text}`, model_id: VOICE_MODEL, voice_settings: {speed: 1.0}});

export interface Alignment { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }
export type Span = {start: number; end: number};

/** When each word is said (ms), from ElevenLabs' timings per character, leaving out [audio tags], which come back with times
 *  of their own (the sigh): from a word's first character to its last letter. As scripts/frank_voice.py's spoken + words_of. */
export function spokenWords(a: Alignment): Span[] {
  const words: Span[] = [];
  let tag = false, inside = false;
  a.characters.forEach((c, i) => {
    if (c === "[") tag = true;
    if (tag) { tag = c !== "]"; return; }
    const s = Math.round(a.character_start_times_seconds[i] * 1000), e = Math.round(a.character_end_times_seconds[i] * 1000);
    if (/\s/.test(c)) inside = false;
    else if (!inside) { inside = true; words.push({start: s, end: e}); }
    else if (/[\p{L}\p{N}]/u.test(c)) words[words.length - 1].end = e;
  });
  return words;
}

/** What the phone gets back: the take, how long it is, and when each word is said. */
export function sayReply(got: {audio_base64?: unknown; alignment?: Alignment | null}): {audio: string; ms: number; words: Span[]} | null {
  if (typeof got.audio_base64 !== "string" || !got.alignment?.characters?.length) return null;
  const words = spokenWords(got.alignment), ends = got.alignment.character_end_times_seconds;
  return words.length ? {audio: got.audio_base64, ms: Math.round(ends[ends.length - 1] * 1000), words} : null;
}

/** What the phone is told when Claude can't be reached: a kind it can say calmly, never the provider's own message. */
export function failure(status: number | undefined): {status: number; error: string} {
  if (status === 429 || status === 529) return {status: 429, error: "busy"};
  if (status === 400 || status === 413) return {status: 400, error: "bad_request"};
  if (status === 401 || status === 403) return {status: 500, error: "not_configured"};
  return {status: 502, error: "unavailable"};
}

/** One log line per request: who, what model, how long (Claude's turn, and the sign-in check before it, or "cached"), the
 *  tokens, why it stopped and which tools it asked for. Never what was said. */
export function logLine(x: {
  who: Who; model: string; ms: number; auth: number | "cached"; stop: string | null;
  usage?: {input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null};
  tools: string[];
}) {
  const u = x.usage ?? {};
  return JSON.stringify({
    who: x.who, model: x.model, ms: x.ms, auth: x.auth, stop: x.stop, tools: x.tools,
    in: u.input_tokens ?? 0, out: u.output_tokens ?? 0, cache_read: u.cache_read_input_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0,
  });
}
