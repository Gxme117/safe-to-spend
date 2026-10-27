// The bank function: the only place TrueLayer's client secret is used. It holds nothing and reads no bank data;
// the app reads balances and payments straight from TrueLayer with the access token it gets here.
//   GET  /start?back=…      → TrueLayer's login page
//   GET  /callback          → back into the app with the one-time code
//   POST /token {code}      → tokens
//   POST /refresh {refresh_token} → new tokens
import {allowedBack, authHost, authUrl, backWith, type Env, readState, tokenForm} from "./lib.ts";

const env: Env = Deno.env.get("TL_ENV") === "live" ? "live" : "sandbox";
const clientId = Deno.env.get("TL_CLIENT_ID") ?? "";
const secret = Deno.env.get("TL_CLIENT_SECRET") ?? "";
const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/bank/callback`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json"}});
const go = (url: string) => new Response(null, {status: 302, headers: {location: url}});

async function tokens(grant: {code: string} | {refresh_token: string}) {
  const r = await fetch(`${authHost(env)}/connect/token`, {
    method: "POST", body: tokenForm(clientId, secret, redirectUri, grant),
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok) return json({error: t.error ?? "token_failed"}, r.status >= 500 ? 502 : 400);
  return json({access_token: t.access_token, refresh_token: t.refresh_token, expires_in: t.expires_in});
}

Deno.serve(async req => {
  if (!clientId || !secret) return json({error: "not_configured"}, 500);
  const url = new URL(req.url);
  const door = url.pathname.split("/").filter(Boolean).pop();

  if (req.method === "GET" && door === "start") {
    const back = url.searchParams.get("back") ?? "";
    if (!allowedBack(back)) return json({error: "bad_back"}, 400);
    return go(authUrl(env, clientId, redirectUri, back));
  }
  if (req.method === "GET" && door === "callback") {
    const back = readState(url.searchParams.get("state"));
    if (!back) return json({error: "bad_state"}, 400);
    const code = url.searchParams.get("code");
    return go(backWith(back, code ? {code} : {error: url.searchParams.get("error") ?? "no_code"}));
  }
  if (req.method === "POST" && (door === "token" || door === "refresh")) {
    const body = await req.json().catch(() => ({}));
    if (door === "token" && typeof body.code === "string") return tokens({code: body.code});
    if (door === "refresh" && typeof body.refresh_token === "string") return tokens({refresh_token: body.refresh_token});
    return json({error: "bad_request"}, 400);
  }
  return json({error: "not_found"}, 404);
});
