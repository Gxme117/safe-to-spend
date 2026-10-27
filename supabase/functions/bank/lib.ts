// The pure parts of the bank function: no network, so they can be tested with `deno test`.
// TrueLayer's client secret is only ever used in index.ts, read from Supabase secrets.

export type Env = "sandbox" | "live";

/** What Pinch asks the bank for: read only, and offline_access so it keeps working after the first hour. */
export const SCOPES = "info accounts balance transactions offline_access";

/** The sandbox only has TrueLayer's Mock bank; live is every UK bank, Open Banking or OAuth. */
const PROVIDERS: Record<Env, string> = {sandbox: "uk-cs-mock", live: "uk-ob-all uk-oauth-all"};

export const authHost = (env: Env) => env === "live" ? "https://auth.truelayer.com" : "https://auth.truelayer-sandbox.com";

/** A login only ever goes back into the app (its own scheme, or Expo Go), never anywhere else. */
export const allowedBack = (back: string) => /^(moneytracker|exp):\/\/./.test(back);

/** The app's address travels through TrueLayer in `state`, so the callback knows where to send the code. */
export const packState = (back: string) => btoa(JSON.stringify({back})).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function readState(state: string | null): string | null {
  if (!state) return null;
  try {
    const b64 = state.replace(/-/g, "+").replace(/_/g, "/");
    const {back} = JSON.parse(atob(b64 + "=".repeat((4 - b64.length % 4) % 4)));
    return typeof back === "string" && allowedBack(back) ? back : null;
  } catch {
    return null;
  }
}

/** TrueLayer's login page, where you pick your bank and approve. */
export function authUrl(env: Env, clientId: string, redirectUri: string, back: string) {
  const q = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: redirectUri,
    scope: SCOPES, providers: PROVIDERS[env], state: packState(back),
  });
  return `${authHost(env)}/?${q}`;
}

/** The app's address with the one-time code (or what went wrong) added. Never tokens. */
export function backWith(back: string, add: Record<string, string>) {
  const sep = back.includes("?") ? "&" : "?";
  return back + sep + new URLSearchParams(add);
}

/** The form TrueLayer's token endpoint takes: a code the first time, a refresh token after. */
export function tokenForm(
  clientId: string, secret: string, redirectUri: string,
  grant: {code: string} | {refresh_token: string},
) {
  const f = new URLSearchParams({client_id: clientId, client_secret: secret});
  if ("code" in grant) {
    f.set("grant_type", "authorization_code");
    f.set("code", grant.code);
    f.set("redirect_uri", redirectUri);
  } else {
    f.set("grant_type", "refresh_token");
    f.set("refresh_token", grant.refresh_token);
  }
  return f;
}
