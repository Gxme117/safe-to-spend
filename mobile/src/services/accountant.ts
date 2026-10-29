// Talking to Tim and Frank's brain: the accountant function (supabase/functions/accountant), which holds the Anthropic key and
// asks Claude. This sends the conversation so far and brings back Claude's turn. Nothing said is logged here either.
import type {Transcript, Turn} from "@/lib/ai/converse";
import type {Who} from "@/lib/ai/tools";
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

async function post(who: Who, messages: Transcript, token: string) {
  const stop = new AbortController(), t = setTimeout(() => stop.abort(), WAIT_MS);
  try {
    return await fetch(`${FN}/chat`, {
      method: "POST", signal: stop.signal,
      headers: {Authorization: `Bearer ${token}`, apikey: PUBLIC_KEY, "Content-Type": "application/json"},
      body: JSON.stringify({who, messages}),
    });
  } catch {
    throw new AccountantFail(stop.signal.aborted ? "timeout" : "offline");
  } finally { clearTimeout(t); }
}

/** Sends the conversation and returns Claude's turn: an answer, or the tools it wants run. */
export async function send(who: Who, messages: Transcript): Promise<Turn> {
  try {
    let r = await post(who, messages, await accessToken());
    // the server didn't know the token (it ran out, or the sign-in went): one more go with a new one
    if (r.status === 401) r = await post(who, messages, await accessToken(true));
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
