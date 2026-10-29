// Banks linked through TrueLayer (Open Banking). The client secret never comes near the phone: the bank function
// (supabase/functions/bank) opens the login and swaps codes for tokens. With those, the app reads balances and payments
// from TrueLayer itself. Tokens live in the iOS Keychain under each link's id, never in app state.
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import {mainOf, type TlAccount, type TlBalance, type TlTx} from "@/lib/truelayer";
import {MonzoFail} from "./monzo";

// The bank function's address isn't a secret. EXPO_PUBLIC_BANK_FN_URL in mobile/.env.local overrides it.
const FN = process.env.EXPO_PUBLIC_BANK_FN_URL?.trim() || "https://sgchailpcwkffckwnazp.supabase.co/functions/v1/bank";
// TrueLayer's sandbox (the Mock bank) for now; live is https://api.truelayer.com
const API = process.env.EXPO_PUBLIC_TRUELAYER_API?.trim() || "https://api.truelayer-sandbox.com";

const K = (id: string) => ({access: `tl.${id}.access`, refresh: `tl.${id}.refresh`, expires: `tl.${id}.expires`});
const get = (k: string) => SecureStore.getItemAsync(k);
const put = (k: string, v: string) => SecureStore.setItemAsync(k, v);

async function call(url: string, init?: RequestInit) {
  try { return await fetch(url, init); } catch { throw new MonzoFail("offline"); }
}

/** Asks the bank function for tokens: with the login's code the first time, the refresh token after. */
async function tokens(id: string, door: "token" | "refresh", body: Record<string, string>) {
  const r = await call(`${FN}/${door}`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
  const j = await r.json().catch(() => ({})) as {access_token?: string; refresh_token?: string; expires_in?: number; error?: string};
  // refused: the code's used up, or the bank's access has run out or been taken back. Either way it's a new login
  if (!r.ok || !j.access_token) throw new MonzoFail(r.status === 400 ? "needs-login" : "other", `${door} ${r.status} ${j.error || ""}`.trim());
  const k = K(id);
  await put(k.access, j.access_token);
  if (j.refresh_token) await put(k.refresh, j.refresh_token);   // always keep the newest
  await put(k.expires, String(Date.now() + ((j.expires_in || 3600) - 60) * 1000));
}

/**
 * Pick your bank and approve on its own page, in a browser sheet that closes by itself when the login comes back into the app.
 * Returns the new link's id, or null if you closed the sheet.
 */
export async function linkBank(): Promise<string | null> {
  const back = Linking.createURL("link-bank");
  const r = await WebBrowser.openAuthSessionAsync(`${FN}/start?back=${encodeURIComponent(back)}`, back);
  if (r.type !== "success") return null;
  const q = Linking.parse(r.url).queryParams || {};
  const code = typeof q.code === "string" ? q.code : "";
  if (!code) {
    // you said no on the bank's page: nothing to say
    if (q.error === "access_denied") return null;
    throw new MonzoFail("other", `login ${String(q.error || "no code")}`);
  }
  const id = "tl_" + Math.random().toString(36).slice(2, 10);
  await tokens(id, "token", {code});
  return id;
}

async function api<T>(id: string, path: string): Promise<T> {
  const k = K(id);
  const refresh = async () => {
    const rt = await get(k.refresh);
    if (!rt) throw new MonzoFail("needs-login", "no refresh token");
    await tokens(id, "refresh", {refresh_token: rt});
  };
  if (Number(await get(k.expires) || 0) < Date.now()) await refresh();
  const go = async () => call(API + path, {headers: {Authorization: `Bearer ${await get(k.access)}`}});
  let r = await go();
  if (r.status === 401) { await refresh(); r = await go(); }
  if (r.status === 401 || r.status === 403) throw new MonzoFail("needs-login", `${path.split("?")[0]} ${r.status}`);
  if (!r.ok) throw new MonzoFail("other", `${path.split("?")[0]} ${r.status}`);
  return r.json() as Promise<T>;
}

/** Every account in the linked bank, each one's balance, and the main account's payments since `since`. */
export async function fetchLink(id: string, since: string) {
  const {results: accounts} = await api<{results: TlAccount[]}>(id, "/data/v1/accounts");
  const balances: Record<string, TlBalance> = {};
  for (const a of accounts) {
    const {results} = await api<{results: TlBalance[]}>(id, `/data/v1/accounts/${encodeURIComponent(a.account_id)}/balance`);
    balances[a.account_id] = results[0] || {};
  }
  const main = mainOf(accounts);
  const to = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const txs = main
    ? (await api<{results: TlTx[]}>(id, `/data/v1/accounts/${encodeURIComponent(main.account_id)}/transactions?from=${since}&to=${to}`)).results
    : [];
  return {accounts, balances, txs};
}

/** Forget a linked bank's tokens on this phone. */
export async function unlink(id: string) {
  await Promise.all(Object.values(K(id)).map(k => SecureStore.deleteItemAsync(k)));
}
