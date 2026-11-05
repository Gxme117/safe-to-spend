// The accountant function: the only place the Anthropic and ElevenLabs API keys are used. It keeps nothing: the phone sends
// the conversation so far, this adds the rulebook, the accountant's voice and the tools, asks Claude, and hands back what
// Claude said, either an answer or the tools it wants run. The tools run on the phone, where the money is; a web search, or a
// shop's page opened for a purchase, runs on Anthropic's side, and comes back as part of what Claude said.
//   POST /chat {who, messages, research?, model?} → {content, stop_reason, usage}: usage is only token counts, for what a question
//     costs; model is a key from MODELS (lib.ts), picked on the phone
//   POST /say {who, text} → {audio (mp3, base64), ms, words}: Tim's or Frank's short spoken line, in his voice
//   POST /photo {q} → {url}: a photo of something he priced, for its card (Brave's image search on its name)
//   POST /line {where, paid, left, what} → {text}: Frank's line about a card payment, for the card island (then said by /say)
//   POST /shop {queries, match, exclude, max_price} → {products, partial?, stats}: the products a purchase question is about, with
//     their prices (each verified, search_listed or estimated) and photos, from Brave's web search and the shops' own pages (shop.ts)
// Only signed-in users of the app (anonymous sign-in counts), each up to a daily cap on what their questions cost (429 "limit";
// the accountant_usage table, supabase/migrations). Nothing said is logged.
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import {type Cap, capFor, costCents, DAILY_CAP_CENTS, exemptOf, failure, lineOf, lineParams, logLine, newQuestion, params, photoOf, photoUrl, readAsk, readLine, readPhoto, readSay, sayBody, sayReply, sayUrl, signedInCache, ukDay, userOf} from "./lib.ts";
import {PROMPT_VERSION} from "./prompt.ts";
import {BRAVE_CENTS, readShop, runShop, shopLog} from "./shop.ts";

const key = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const model = Deno.env.get("ACCOUNTANT_MODEL") || "claude-opus-5-5";
const supabase = Deno.env.get("SUPABASE_URL") ?? "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const voiceKey = Deno.env.get("ELEVENLABS_API_KEY") ?? ""; // their voices, for /say
const photoKey = Deno.env.get("BRAVE_API_KEY") ?? ""; // product photos, for /photo
// the daily cap's count is kept with the service role (no one's own key reaches it)
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const cap = Number(Deno.env.get("DAILY_CAP_CENTS")) || DAILY_CAP_CENTS;
const exempt = exemptOf(Deno.env.get("CAP_EXEMPT") ?? "");
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

/** Adds `cents` to what the user's questions have cost today (UK day) and returns the new total (0 just reads it); null when
 *  the count can't be reached, and the request goes through anyway: the cap is a safety net, not worth silencing them for. */
async function spend(user: string, cents: number): Promise<number | null> {
  if (!service) return null;
  const r = await fetch(`${supabase}/rest/v1/rpc/accountant_spend`, {
    method: "POST", signal: AbortSignal.timeout(5_000),
    headers: {apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json"},
    body: JSON.stringify({p_user: user, p_day: ukDay(new Date()), p_cents: cents}),
  }).catch(() => null);
  const total = r?.ok ? await r.json().catch(() => null) : null;
  if (typeof total !== "number") console.warn(JSON.stringify({door: "cap", status: r?.status ?? "error"}));
  return typeof total === "number" ? total : null;
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

/** Frank's line about a card payment, for the card island: Claude (Haiku) writes it from what the island shows. On the daily
 *  cap like a question. Only how it went is logged, never the shop or the line. */
async function line(req: Request, user: string, auth: number | "cached") {
  const facts = readLine(await req.text());
  if ("error" in facts) return json(facts, 400);
  const free = exempt.has(user), spent = free ? null : await spend(user, 0);
  if (spent !== null && capFor(spent, cap, true) === "limit") {
    console.log(JSON.stringify({door: "line", auth, stop: "limit"}));
    return json({error: "limit"}, 429);
  }
  const started = Date.now();
  try {
    const msg = await client.messages.create(lineParams(facts));
    if (!free) await spend(user, costCents(msg.model, msg.usage));
    const text = lineOf(msg.content);
    console.log(JSON.stringify({door: "line", model: msg.model, ms: Date.now() - started, auth, stop: msg.stop_reason,
      cents: costCents(msg.model, msg.usage), chars: text?.length ?? 0, cap: free ? "exempt" : spent === null ? "unchecked" : "ok"}));
    return text ? json({text}) : json({error: "unavailable"}, 502);
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    console.warn(JSON.stringify({door: "line", ms: Date.now() - started, auth, stop: `error ${status ?? (e instanceof Error ? e.name : "unknown")}`}));
    const f = failure(status);
    return json({error: f.error}, f.status);
  }
}

/** The products a purchase question is about (shop.ts): Brave's web search, then the shops' own pages and photos, each part on
 *  its own time limit, so what comes back is what was found in time. On the daily cap like a question (each Brave request counts
 *  half a cent); a question already under way may finish. Only counts and times are logged, never a search or a product. */
async function shop(req: Request, user: string, auth: number | "cached") {
  if (!photoKey) return json({error: "not_configured"}, 500);
  const ask = readShop(await req.text());
  if ("error" in ask) return json(ask, 400);
  const free = exempt.has(user), spent = free ? null : await spend(user, 0);
  if (spent !== null && capFor(spent, cap, false) === "limit") {
    console.log(JSON.stringify({door: "shop", auth, stop: "limit"}));
    return json({error: "limit"}, 429);
  }
  const out = await runShop(ask, {fetch, key: photoKey});
  if (!free && out.stats.brave) await spend(user, out.stats.brave * BRAVE_CENTS);
  console.log(shopLog(out.stats, auth, {cap: free ? "exempt" : spent === null ? "unchecked" : "ok", ...("error" in out ? {stop: out.error} : {})}));
  if ("error" in out) return json({error: out.error}, out.error === "not_configured" ? 500 : 502);
  return json(out);
}

/** A photo of something he priced: the first picture Brave's image search finds for its name. The name isn't logged. */
async function photo(req: Request, auth: number | "cached") {
  if (!photoKey) return json({error: "not_configured"}, 500);
  const ask = readPhoto(await req.text());
  if ("error" in ask) return json(ask, 400);
  const started = Date.now();
  const r = await fetch(photoUrl(ask.q), {
    signal: AbortSignal.timeout(8_000),
    headers: {"X-Subscription-Token": photoKey, accept: "application/json"},
  }).catch(() => null);
  const url = r?.ok ? photoOf(await r.json().catch(() => null), ask.q) : null;
  console.log(JSON.stringify({door: "photo", ms: Date.now() - started, auth, status: r?.status ?? "error", found: !!url}));
  if (url) return json({url});
  if (r?.ok) return json({error: "not_found"}, 404);
  const f = failure(r?.status);
  return json({error: f.error}, f.status);
}

Deno.serve(async req => {
  const door = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  if (!supabase || !anon || ((door === "chat" || door === "line") && !key)) return json({error: "not_configured"}, 500);
  if (req.method !== "POST" || !["chat", "say", "photo", "line", "shop"].includes(door ?? "")) return json({error: "not_found"}, 404);
  const checking = Date.now(), who = await signedIn(req);
  if (!who.user) return json({error: "signed_out"}, 401);
  const auth = who.cached ? "cached" : Date.now() - checking;
  if (door === "say") return say(req, auth);
  if (door === "photo") return photo(req, auth);
  if (door === "line") return line(req, who.user, auth);
  if (door === "shop") return shop(req, who.user, auth);

  const ask = readAsk(await req.text());
  if ("error" in ask) return json(ask, ask.error === "too_big" ? 413 : 400);

  // the daily cap: over it, Claude isn't asked (a question under way may finish, see capFor)
  const user = who.user, free = exempt.has(user), spent = free ? null : await spend(user, 0);
  const capped: Cap = free ? "exempt" : spent === null ? "unchecked" : "ok";
  if (spent !== null && capFor(spent, cap, newQuestion(ask.messages)) === "limit") {
    console.log(JSON.stringify({door: "chat", who: ask.who, auth, stop: "limit"}));
    return json({error: "limit"}, 429);
  }

  const started = Date.now(), request = params(ask, model);
  try {
    const msg = await client.beta.messages.create(request);
    const tools = msg.content.flatMap(b => b.type === "tool_use" ? [b.name] : []);
    if (!free) await spend(user, costCents(msg.model, msg.usage));
    console.log(logLine({who: ask.who, model: msg.model, ms: Date.now() - started, auth, stop: msg.stop_reason, usage: msg.usage, tools, cap: capped}), PROMPT_VERSION);
    return json({content: msg.content, stop_reason: msg.stop_reason, usage: msg.usage});
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    console.warn(logLine({who: ask.who, model: request.model, ms: Date.now() - started, auth, stop: `error ${status ?? (e instanceof Error ? e.name : "unknown")}`, tools: []}));
    const f = failure(status);
    // a request Claude refused: its reason goes back for the phone's development log (it names the part of the request that's
    // wrong, never what was said), so "bad_request" from Claude can be told apart from one of ours
    const detail = status === 400 && e instanceof Anthropic.APIError ? e.message.slice(0, 300) : undefined;
    return json({error: f.error, ...detail ? {detail, from: "claude"} : {}}, f.status);
  }
});
