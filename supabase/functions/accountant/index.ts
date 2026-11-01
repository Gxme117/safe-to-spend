// The accountant function: the only place the Anthropic and ElevenLabs API keys are used. It keeps nothing: the phone sends
// the conversation so far, this adds the rulebook, the accountant's voice and the tools, asks Claude, and hands back what
// Claude said, either an answer or the tools it wants run. The tools run on the phone, where the money is; a web search runs on
// Anthropic's side, and comes back as part of what Claude said.
//   POST /chat {who, messages} → {content, stop_reason}
//   POST /say {who, text} → {audio (mp3, base64), ms, words}: Tim's or Frank's short spoken line, in his voice
// Only signed-in users of the app (anonymous sign-in counts). Nothing said is logged.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import {failure, logLine, params, readAsk, readSay, sayBody, sayReply, sayUrl, signedInCache, userOf} from "./lib.ts";
import {PROMPT_VERSION} from "./prompt.ts";

const key = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const model = Deno.env.get("ACCOUNTANT_MODEL") || "claude-opus-5-5";
const supabase = Deno.env.get("SUPABASE_URL") ?? "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const voiceKey = Deno.env.get("ELEVENLABS_API_KEY") ?? ""; // their voices, for /say
// one try per request: the phone says "busy, ask again" rather than keeping you waiting twice as long. Long enough for a few web
// searches, and short of the 150s Supabase gives a function to answer
const client = new Anthropic({apiKey: key, timeout: 120_000, maxRetries: 0});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json"}});

const seen = signedInCache();

/** Who the token belongs to: asks Supabase Auth, unless it already said so for this token (`cached`). */
async function signedIn(req: Request): Promise<{user: string | null; cached?: boolean}> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return {user: null};
  const token = auth.slice("Bearer ".length), now = Date.now(), known = seen.get(token, now);
  if (known) return {user: known, cached: true};
  const r = await fetch(`${supabase}/auth/v1/user`, {headers: {authorization: auth, apikey: anon}}).catch(() => null);
  const user = r ? userOf(r.status, await r.json().catch(() => null)) : null;
  if (user) seen.set(token, user, now);
  return {user};
}

/** Tim or Frank says one short line of his answer out loud: ElevenLabs records it in his voice, with when each word is said.
 *  auth: how long the sign-in check before it took (ms, or "cached"), for the log. */
async function say(req: Request, auth: number | "cached") {
  if (!voiceKey) return json({error: "not_configured"}, 500);
  const line = readSay(await req.text());
  if ("error" in line) return json(line, line.error === "too_big" ? 413 : 400);
  const started = Date.now();
  const r = await fetch(sayUrl(line.who), {
    method: "POST", signal: AbortSignal.timeout(30_000),
    headers: {"xi-api-key": voiceKey, "content-type": "application/json"},
    body: JSON.stringify(sayBody(line.who, line.text)),
  }).catch(() => null);
  const got = r?.ok ? sayReply(await r.json().catch(() => ({}))) : null;
  console.log(JSON.stringify({door: "say", who: line.who, chars: line.text.length, ms: Date.now() - started, auth, status: r?.status ?? "error"}));
  if (got) return json(got);
  const f = failure(r?.status);
  return json({error: f.error}, f.status);
}

Deno.serve(async req => {
  const door = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  if (!supabase || !anon || (door === "chat" && !key)) return json({error: "not_configured"}, 500);
  if (req.method !== "POST" || (door !== "chat" && door !== "say")) return json({error: "not_found"}, 404);
  const checking = Date.now(), who = await signedIn(req);
  if (!who.user) return json({error: "signed_out"}, 401);
  const auth = who.cached ? "cached" : Date.now() - checking;
  if (door === "say") return say(req, auth);

  const ask = readAsk(await req.text());
  if ("error" in ask) return json(ask, ask.error === "too_big" ? 413 : 400);

  const started = Date.now();
  try {
    const msg = await client.beta.messages.create(params(ask, model));
    const tools = msg.content.flatMap(b => b.type === "tool_use" ? [b.name] : []);
    console.log(logLine({who: ask.who, model: msg.model, ms: Date.now() - started, auth, stop: msg.stop_reason, usage: msg.usage, tools}), PROMPT_VERSION);
    return json({content: msg.content, stop_reason: msg.stop_reason});
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    console.warn(logLine({who: ask.who, model, ms: Date.now() - started, auth, stop: `error ${status ?? (e instanceof Error ? e.name : "unknown")}`, tools: []}));
    const f = failure(status);
    return json({error: f.error}, f.status);
  }
});
