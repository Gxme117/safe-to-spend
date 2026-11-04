// Talking to Tim and Frank's brain: the accountant function (supabase/functions/accountant), which holds the Anthropic key and
// asks Claude. This sends the conversation so far and brings back Claude's turn. Nothing said is logged here either.
import {File, Paths} from "expo-file-system";
import type {Transcript, Turn} from "@/lib/ai/converse";
import type {ModelKey} from "@/lib/ai/models";
import type {Who} from "@/lib/ai/tools";
import type {Take} from "@/lib/timSpeech";
import {accessToken, PUBLIC_KEY, SessionFail, SUPABASE} from "./session";

// The function's address isn't a secret. EXPO_PUBLIC_ACCOUNTANT_FN_URL in mobile/.env.local overrides it.
const FN = process.env.EXPO_PUBLIC_ACCOUNTANT_FN_URL?.trim() || `${SUPABASE}/functions/v1/accountant`;
// a round with a lot of thinking, or a few web searches, can take a while; past this, something's wrong (a little over the
// function's own 120s, so its answer gets here first)
const WAIT_MS = 130_000;

/** Why he couldn't answer: no connection, no answer in time, too many questions at once, his side's down, it isn't set up yet,
 *  or the chat's too big to send (too many photos or files in it). */
export type AccountantError = "offline" | "timeout" | "busy" | "unavailable" | "not-set-up" | "too-big";
export class AccountantFail extends Error {
  constructor(public kind: AccountantError, detail?: string) { super(detail ?? kind); }
}

async function post(door: "chat" | "say" | "photo", body: unknown, token: string, wait = WAIT_MS) {
  const stop = new AbortController(), t = setTimeout(() => stop.abort(), wait);
  try {
    return await fetch(`${FN}/${door}`, {
      method: "POST", signal: stop.signal,
      headers: {Authorization: `Bearer ${token}`, apikey: PUBLIC_KEY, "Content-Type": "application/json"},
      body: JSON.stringify(body),
    });
  } catch {
    throw new AccountantFail(stop.signal.aborted ? "timeout" : "offline");
  } finally { clearTimeout(t); }
}

/** Sends the conversation and returns Claude's turn: an answer, or the tools it wants run. `research`: this app can check what
 *  something costs on the shops' own pages and show it as a card (lib/ai/research.ts), so he's given the tools for it. */
export async function send(who: Who, messages: Transcript, model?: ModelKey): Promise<Turn> {
  const body = {who, messages, research: true, ...model ? {model} : {}};
  try {
    let r = await post("chat", body, await accessToken());
    // the server didn't know the token (it ran out, or the sign-in went): one more go with a new one
    if (r.status === 401) r = await post("chat", body, await accessToken(true));
    const j = await r.json().catch(() => ({})) as Partial<Turn> & {error?: string; detail?: string};
    if (r.ok && Array.isArray(j.content)) return {content: j.content, stop_reason: j.stop_reason ?? null, ...j.usage ? {usage: j.usage} : {}};
    if (r.status === 429) throw new AccountantFail("busy");
    // the conversation's grown past what the function takes: photos and PDFs go back whole every round
    if (r.status === 413) throw new AccountantFail("too-big");
    if (j.error === "not_configured") throw new AccountantFail("not-set-up", "the function has no key");
    throw new AccountantFail("unavailable", `${r.status} ${j.error ?? ""} ${j.detail ?? ""}`.trim());
  } catch (e) {
    if (e instanceof SessionFail) throw new AccountantFail(e.kind, e.message);
    throw e;
  }
}

// a line takes ElevenLabs a few seconds; past this, his answer's been on screen long enough without it
const SAY_MS = 20_000;
let takes = 0;

/** His line in his voice (Tim's or Frank's, `who`): recorded once by the function (ElevenLabs), kept in the phone's cache
 *  for replays, with when each word is said. Anything going wrong is null: he just doesn't say it, and nothing's said about it.
 *  `kind` "brief": Frank's briefing, all of it, so it may be longer than an answer's line. */
export async function say(who: Who, text: string, kind?: "brief"): Promise<Take | null> {
  const body = {who, text, ...kind ? {kind} : {}};
  try {
    let r = await post("say", body, await accessToken(), SAY_MS);
    if (r.status === 401) r = await post("say", body, await accessToken(true), SAY_MS);
    const j = await r.json().catch(() => ({})) as {audio?: unknown; ms?: unknown; words?: unknown};
    if (!r.ok || typeof j.audio !== "string" || typeof j.ms !== "number" || !Array.isArray(j.words)) return null;
    const file = new File(Paths.cache, `${who}-says-${Date.now()}-${takes++}.mp3`);
    await file.write(j.audio, {encoding: "base64"});
    return {uri: file.uri, ms: j.ms, words: j.words as Take["words"]};
  } catch (e) {
    console.warn(`${who} couldn't say it:`, e instanceof Error ? e.message : e);
    return null;
  }
}

const PHOTO_MS = 8_000;
// each product's photo, asked for once while the app's open; one that didn't come is asked for again next time
const photos = new Map<string, Promise<string | null>>();

/** A photo of something he priced, for its card: the function looks its name up (Brave's image search) and hands back the
 *  picture's address. Anything going wrong is null, and the card goes without. */
export function photo(q: string): Promise<string | null> {
  const known = photos.get(q);
  if (known) return known;
  const got = (async () => {
    try {
      let r = await post("photo", {q}, await accessToken(), PHOTO_MS);
      if (r.status === 401) r = await post("photo", {q}, await accessToken(true), PHOTO_MS);
      const j = await r.json().catch(() => ({})) as {url?: unknown};
      return r.ok && typeof j.url === "string" && j.url.startsWith("https://") ? j.url : null;
    } catch {
      return null;
    }
  })();
  photos.set(q, got);
  got.then(url => { if (!url) photos.delete(q); });
  return got;
}
