// Talking to Tim and Frank's brain: the accountant function (supabase/functions/accountant), which holds the Anthropic key and
// asks Claude. This sends the conversation so far and brings back Claude's turn. Nothing said is logged here either.
import {File, Paths} from "expo-file-system";
import type {Transcript, Turn} from "@/lib/ai/converse";
import type {Who} from "@/lib/ai/tools";
import type {Take} from "@/lib/timSpeech";
import {accessToken, PUBLIC_KEY, SessionFail, SUPABASE} from "./session";

// The function's address isn't a secret. EXPO_PUBLIC_ACCOUNTANT_FN_URL in mobile/.env.local overrides it.
const FN = process.env.EXPO_PUBLIC_ACCOUNTANT_FN_URL?.trim() || `${SUPABASE}/functions/v1/accountant`;
// a round with a lot of thinking can take a while; past this, something's wrong
const WAIT_MS = 70_000;

/** Why he couldn't answer: no connection, no answer in time, too many questions at once, his side's down, or it isn't set up yet. */
export type AccountantError = "offline" | "timeout" | "busy" | "unavailable" | "not-set-up";
export class AccountantFail extends Error {
  constructor(public kind: AccountantError, detail?: string) { super(detail ?? kind); }
}

async function post(door: "chat" | "say", body: unknown, token: string, wait = WAIT_MS) {
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

/** Sends the conversation and returns Claude's turn: an answer, or the tools it wants run. */
export async function send(who: Who, messages: Transcript): Promise<Turn> {
  try {
    let r = await post("chat", {who, messages}, await accessToken());
    // the server didn't know the token (it ran out, or the sign-in went): one more go with a new one
    if (r.status === 401) r = await post("chat", {who, messages}, await accessToken(true));
    const j = await r.json().catch(() => ({})) as Partial<Turn> & {error?: string};
    if (r.ok && Array.isArray(j.content)) return {content: j.content, stop_reason: j.stop_reason ?? null};
    if (r.status === 429) throw new AccountantFail("busy");
    if (j.error === "not_configured") throw new AccountantFail("not-set-up", "the function has no key");
    throw new AccountantFail("unavailable", `${r.status} ${j.error ?? ""}`.trim());
  } catch (e) {
    if (e instanceof SessionFail) throw new AccountantFail(e.kind, e.message);
    throw e;
  }
}

// a line takes ElevenLabs a few seconds; past this, his answer's been on screen long enough without it
const SAY_MS = 20_000;
let takes = 0;

/** His line in his voice (Tim's or Frank's, `who`): recorded once by the function (ElevenLabs), kept in the phone's cache
 *  for replays, with when each word is said. Anything going wrong is null: he just doesn't say it, and nothing's said about it. */
export async function say(who: Who, text: string): Promise<Take | null> {
  try {
    let r = await post("say", {who, text}, await accessToken(), SAY_MS);
    if (r.status === 401) r = await post("say", {who, text}, await accessToken(true), SAY_MS);
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
