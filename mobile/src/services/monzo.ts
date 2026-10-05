// Talking to Monzo. Your client ID and secret, and the tokens, live in the iOS Keychain (expo-secure-store):
// never in the repo, never in app state. This is a personal Monzo developer client, for your own account only.
import * as SecureStore from "expo-secure-store";
import {today} from "@/lib/dates";
import {findAll, type SetupFound} from "@/lib/found";
import {REDIRECT_URI, type RawPot, type RawTx, setupSince, totalPence, type Synced} from "@/lib/monzo";

const API = "https://api.monzo.com";
const K = {id: "monzo.clientId", secret: "monzo.clientSecret", access: "monzo.access", refresh: "monzo.refresh", expires: "monzo.expires", login: "monzo.loginState"};

/** What went wrong, in terms the app can say plainly. */
export type MonzoError = "needs-approval" | "needs-login" | "bad-client" | "offline" | "other";
export class MonzoFail extends Error {
  constructor(public kind: MonzoError, detail = "") { super(detail || kind); }
}

const get = (k: string) => SecureStore.getItemAsync(k);
const put = (k: string, v: string) => SecureStore.setItemAsync(k, v);

/** A blank secret keeps the one already saved. */
export async function saveClient(id: string, secret: string) { await put(K.id, id.trim()); if (secret.trim()) await put(K.secret, secret.trim()); }

// For development: put the client in mobile/.env.local (git ignores it; never commit it, the repo is public) and you skip typing it.
// Expo builds these into the app, so this only suits your own phone.
const ENV = {id: process.env.EXPO_PUBLIC_MONZO_CLIENT_ID?.trim() || "", secret: process.env.EXPO_PUBLIC_MONZO_CLIENT_SECRET?.trim() || ""};
export const clientFromEnv = !!(ENV.id && ENV.secret);
// A client typed in on this phone wins over the built-in one: someone else using this build connects with their own.
async function client() {
  const own = {id: (await get(K.id)) || "", secret: (await get(K.secret)) || ""};
  return own.id && own.secret ? own : clientFromEnv ? ENV : own;
}
export async function hasClient() { const c = await client(); return !!(c.id && c.secret); }
export async function clientId() { return (await client()).id; }

/** A fresh random state for each login, remembered in case the app restarts while you're in your email. */
export async function startLogin() {
  const st = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  await put(K.login, st);
  return st;
}
export async function loginState() { return (await get(K.login)) || ""; }

async function call(path: string, init?: RequestInit) {
  try { return await fetch(API + path, init); } catch { throw new MonzoFail("offline"); }
}

async function saveTokens(r: Response) {
  if (!r.ok) {
    const why = await r.json().then((j: {code?: string}) => j.code || "", () => "");
    // a wrong client ID or secret, as opposed to a code that's used up or out of date
    if (why.includes("could_not_authenticate")) throw new MonzoFail("bad-client", why);
    throw new MonzoFail(r.status === 400 || r.status === 401 ? "needs-login" : "other", `token ${r.status} ${why}`);
  }
  const j = await r.json() as {access_token: string; refresh_token?: string; expires_in: number};
  await put(K.access, j.access_token);
  if (j.refresh_token) await put(K.refresh, j.refresh_token);   // Monzo rotates it: always keep the newest
  await put(K.expires, String(Date.now() + (j.expires_in - 60) * 1000));
}

async function tokenRequest(fields: Record<string, string>) {
  const {id, secret} = await client();
  if (!id || !secret) throw new MonzoFail("needs-login", "no client");
  return call("/oauth2/token", {
    method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({...fields, client_id: id, client_secret: secret}).toString(),
  });
}

/** Swap the code from the pasted link for tokens. After this, Monzo still waits for you to approve in its app. */
export async function connect(code: string) {
  await saveTokens(await tokenRequest({grant_type: "authorization_code", redirect_uri: REDIRECT_URI, code}));
  await SecureStore.deleteItemAsync(K.login);
}

async function refresh() {
  const rt = await get(K.refresh);
  if (!rt) throw new MonzoFail("needs-login", "no refresh token");
  await saveTokens(await tokenRequest({grant_type: "refresh_token", refresh_token: rt}));
}

async function api<T>(path: string): Promise<T> {
  if (Number(await get(K.expires) || 0) < Date.now()) await refresh();
  const go = async () => call(path, {headers: {Authorization: `Bearer ${await get(K.access)}`}});
  let r = await go();
  if (r.status === 401) { await refresh(); r = await go(); }
  if (r.status === 403) throw new MonzoFail("needs-approval");
  if (r.status === 401) throw new MonzoFail("needs-login");
  if (!r.ok) {
    const why = await r.json().then((j: {code?: string; message?: string}) => `${j.code || ""} ${j.message || ""}`.trim(), () => "");
    throw new MonzoFail("other", `${path.split("?")[0]} ${r.status} ${why}`.trim());
  }
  return r.json() as Promise<T>;
}

const PAGE = 100;
/** Transactions since a time, oldest first. Monzo sends 100 at a time, so keep asking from the last one until it runs out. */
async function fetchTxs(q: string, since: string, pages = 20) {
  const all: RawTx[] = [];
  for (let page = 0; page < pages; page++) {
    // `since` goes as-is, as in Monzo's docs: a time like 2026-10-01T00:00:00Z or a payment id, both safe in a URL
    const path = `/transactions?account_id=${q}&since=${since}&limit=${PAGE}&expand[]=merchant`;
    const {transactions} = await api<{transactions: RawTx[]}>(path).catch(e => {
      if (e instanceof MonzoFail) e.message += ` [since=${since}]`;
      throw e;
    });
    all.push(...transactions);
    if (transactions.length < PAGE) break;
    since = transactions[transactions.length - 1].id;
  }
  return all;
}

async function mainAccount() {
  const {accounts} = await api<{accounts: {id: string; closed?: boolean}[]}>("/accounts?account_type=uk_retail");
  const acc = accounts.find(a => !a.closed);
  if (!acc) throw new MonzoFail("other", "no open current account");
  return acc;
}

/**
 * What setup shows before the app has anywhere to keep a full sync: the main account plus all its pots, in pence,
 * and what about 3 months of payments say about your pay and payday. Read once, straight after
 * you approve, and never saved. If the payments can't be read, setup just asks as if you hadn't connected.
 */
export async function fetchSetupBank(): Promise<{totalPence: number; found: SetupFound | null}> {
  const q = encodeURIComponent((await mainAccount()).id);
  const bal = await api<{balance: number}>(`/balance?account_id=${q}`);
  const {pots} = await api<{pots: RawPot[]}>(`/pots?current_account_id=${q}`);
  // 3 months is more payments than a sync: room for 5,000, so the newest are never cut off
  const found = await fetchTxs(q, setupSince(Date.now()), 50).then(txs => findAll(txs, today()), () => null);
  return {totalPence: totalPence(bal.balance, pots), found};
}

/** The main account's balance, its pots, and its transactions since `since`, as Monzo has them right now. */
export async function fetchBank(since: string): Promise<Synced> {
  const acc = await mainAccount();
  const q = encodeURIComponent(acc.id);
  const bal = await api<{balance: number}>(`/balance?account_id=${q}`);
  const {pots} = await api<{pots: RawPot[]}>(`/pots?current_account_id=${q}`);
  const txs = await fetchTxs(q, since);
  return {accountId: acc.id, mainPence: bal.balance, pots, txs};
}

/** Forget everything Monzo-related on this phone. */
export async function disconnect() {
  await Promise.all(Object.values(K).map(k => SecureStore.deleteItemAsync(k)));
}
