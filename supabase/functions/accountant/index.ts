// The accountant function: the only place the Anthropic API key is used. It keeps nothing: the phone sends the conversation
// so far, this adds the rulebook, the accountant's voice and the tools, asks Claude, and hands back what Claude said, either
// an answer or the tools it wants run. The tools run on the phone, where the money is.
//   POST /chat {who, messages} → {content, stop_reason}
// Only signed-in users of the app (anonymous sign-in counts). Nothing said is logged.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import {failure, logLine, params, readAsk, userOf} from "./lib.ts";
import {PROMPT_VERSION} from "./prompt.ts";

const key = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const model = Deno.env.get("ACCOUNTANT_MODEL") || "claude-opus-5-5";
const supabase = Deno.env.get("SUPABASE_URL") ?? "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
// one try per request: the phone says "busy, ask again" rather than keeping you waiting twice as long
const client = new Anthropic({apiKey: key, timeout: 60_000, maxRetries: 0});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json"}});

/** Asks Supabase Auth who the token belongs to. */
async function signedIn(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const r = await fetch(`${supabase}/auth/v1/user`, {headers: {authorization: auth, apikey: anon}}).catch(() => null);
  return r ? userOf(r.status, await r.json().catch(() => null)) : null;
}

Deno.serve(async req => {
  if (!key || !supabase || !anon) return json({error: "not_configured"}, 500);
  const door = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  if (req.method !== "POST" || door !== "chat") return json({error: "not_found"}, 404);
  if (!await signedIn(req)) return json({error: "signed_out"}, 401);

  const ask = readAsk(await req.text());
  if ("error" in ask) return json(ask, ask.error === "too_big" ? 413 : 400);

  const started = Date.now();
  try {
    const msg = await client.beta.messages.create(params(ask, model));
    const tools = msg.content.flatMap(b => b.type === "tool_use" ? [b.name] : []);
    console.log(logLine({who: ask.who, model: msg.model, ms: Date.now() - started, stop: msg.stop_reason, usage: msg.usage, tools}), PROMPT_VERSION);
    return json({content: msg.content, stop_reason: msg.stop_reason});
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    console.warn(logLine({who: ask.who, model, ms: Date.now() - started, stop: `error ${status ?? (e instanceof Error ? e.name : "unknown")}`, tools: []}));
    const f = failure(status);
    return json({error: f.error}, f.status);
  }
});
