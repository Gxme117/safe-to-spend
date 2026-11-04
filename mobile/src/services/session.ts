// Who the app is to its own server: an anonymous Supabase sign-in, made once and kept fresh. No email, no password; it only
// lets the accountant function know the request comes from the app. Tokens live in the iOS Keychain, never in app state.
import * as SecureStore from "expo-secure-store";

// The project's address and its publishable key aren't secrets. EXPO_PUBLIC_SUPABASE_URL / _KEY in mobile/.env.local override them.
export const SUPABASE = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || "https://sgchailpcwkffckwnazp.supabase.co";
export const PUBLIC_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY?.trim() || "sb_publishable_OE0qTJsSKO5BGmfh94lToA_ot0xrFGj";

const K = {access: "sb.access", refresh: "sb.refresh", expires: "sb.expires"};

/** Why there's no session: no connection, anonymous sign-ins switched off on the project, or something else on Supabase's side. */
export type SessionError = "offline" | "not-set-up" | "unavailable";
export class SessionFail extends Error {
  constructor(public kind: SessionError, detail?: string) { super(detail ?? kind); }
}

async function auth(path: string, body: object) {
  let r: Response;
  try {
    r = await fetch(`${SUPABASE}/auth/v1/${path}`, {method: "POST", headers: {apikey: PUBLIC_KEY, "Content-Type": "application/json"}, body: JSON.stringify(body)});
  } catch { throw new SessionFail("offline"); }
  const j = await r.json().catch(() => ({})) as {access_token?: string; refresh_token?: string; expires_in?: number};
  return {status: r.status, session: r.ok && j.access_token ? j : null};
}

// in development, who you are to the server, once a run: the id that goes in the accountant function's CAP_EXEMPT
let noted = false;
function noteUser(token: string) {
  if (!__DEV__ || noted) return token;
  noted = true;
  try {
    const {sub} = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as {sub?: string};
    if (sub) console.log("Signed in to Supabase as", sub);
  } catch { /* not a token we can read */ }
  return token;
}

async function keep(s: {access_token?: string; refresh_token?: string; expires_in?: number}) {
  await SecureStore.setItemAsync(K.access, s.access_token!);
  if (s.refresh_token) await SecureStore.setItemAsync(K.refresh, s.refresh_token);
  await SecureStore.setItemAsync(K.expires, String(Date.now() + ((s.expires_in || 3600) - 60) * 1000));
  return noteUser(s.access_token!);
}

/**
 * A token for the app's server. The one we have while it's fresh; else a refreshed one; else a new anonymous sign-in.
 * `renew`: the server turned the last one down, so get another even if it looks fresh.
 */
export async function accessToken(renew = false): Promise<string> {
  const [access, expires] = await Promise.all([SecureStore.getItemAsync(K.access), SecureStore.getItemAsync(K.expires)]);
  if (!renew && access && Number(expires || 0) > Date.now()) return noteUser(access);
  const refresh = await SecureStore.getItemAsync(K.refresh);
  if (refresh) {
    const r = await auth("token?grant_type=refresh_token", {refresh_token: refresh});
    if (r.session) return keep(r.session);
    if (r.status >= 500) throw new SessionFail("unavailable", `refresh ${r.status}`);
    // turned down: that sign-in has gone, so start a new one
  }
  const r = await auth("signup", {});
  if (r.session) return keep(r.session);
  // 422: anonymous sign-ins are off for the project
  throw new SessionFail(r.status === 422 ? "not-set-up" : "unavailable", `signup ${r.status}`);
}
