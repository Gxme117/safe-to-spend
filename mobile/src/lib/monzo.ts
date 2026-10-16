// Monzo, without the network: building the login link, reading the link Safari lands on, and turning
// what the API returned into app state. The calls themselves live in services/monzo.ts.
import {addDays, isoD} from "./dates";
import {isReceived, occurrences} from "./income";
import {r2} from "./money";
import type {AppState, Bank, Ctx, IsoDate, Pot, PotRole, Tx} from "./types";

// Monzo's sign-in finishes with a redirect. Expo Go can't catch a fixed one, so the client is registered
// with this dead address: Safari shows an error page, and you copy the link (which holds the code) from its address bar.
// It must match the client's redirect URL at developers.monzo.com exactly, or Monzo's page just says "Network error".
// EXPO_PUBLIC_MONZO_REDIRECT_URI in mobile/.env.local overrides it.
export const REDIRECT_URI = process.env.EXPO_PUBLIC_MONZO_REDIRECT_URI?.trim() || "https://localhost/monzo";
export const MONZO_AUTH = "https://auth.monzo.com/";

export function authUrl(clientId: string, state: string) {
  const q = new URLSearchParams({client_id: clientId, redirect_uri: REDIRECT_URI, response_type: "code", state});
  return `${MONZO_AUTH}?${q}`;
}

/** The code from the pasted link, only if its state matches the login we started (so a stale or foreign link is refused). */
export function parseRedirect(url: string, expectState: string): string | null {
  const m = url.trim().match(/[?&]code=([^&#\s]+)/), st = url.trim().match(/[?&]state=([^&#\s]+)/);
  if (!m || !st || decodeURIComponent(st[1]) !== expectState) return null;
  return decodeURIComponent(m[1]);
}

/** A pot as the Monzo API sends it (amounts in pence). */
export interface RawPot { id: string; name: string; balance: number; goal_amount?: number | null; deleted?: boolean }

/** Everything in the account, in pence: the main account plus every pot. Matches the balance after the first sync. */
export const totalPence = (mainPence: number, pots: RawPot[]) =>
  mainPence + pots.filter(p => !p.deleted).reduce((a, p) => a + (p.balance || 0), 0);
/** A transaction as the Monzo API sends it, with the merchant expanded. Spending is negative, in pence. */
export interface RawTx {
  id: string; amount: number; created: string; description?: string; category?: string;
  decline_reason?: string; merchant?: {name?: string; logo?: string} | string | null;
  scheme?: string;                            // how it moved: "bacs" is a direct debit, "mastercard" the card (not in Monzo's docs, so never relied on alone)
  counterparty?: {name?: string} | null;      // the person or company at the other end of a bank transfer
}
export interface Synced { accountId: string; mainPence: number; pots: RawPot[]; txs: RawTx[] }

/** Where a sync starts reading payments: a day before the last one (to catch late ones), or the start of this month the first time. */
export function syncSince(bank: Bank | undefined, now: number): string {
  const d = new Date(now);
  const from = bank ? new Date(Date.parse(bank.asOf) - 864e5) : new Date(d.getFullYear(), d.getMonth(), 1);
  // Monzo refuses milliseconds ("bad_param.since"): 2026-10-01T00:00:00Z, not 2026-10-01T00:00:00.000Z
  return from.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// Monzo's categories that match the app's own. Anything else is asked about, not guessed.
const MONZO_CAT: Record<string, string> = {eating_out: "eating", groceries: "groceries", transport: "transport", personal_care: "personal", family: "family"};

/** The shop's logo link, as Monzo sends it. Only https links: anything else is left out. */
const txLogo = (t: RawTx) => {
  const l = typeof t.merchant === "object" ? t.merchant?.logo?.trim() : undefined;
  return l && l.startsWith("https://") ? l : undefined;
};
/**
 * Who's at the other end: the shop, else the person or company, else the description.
 * A transfer's description is its reference, which Monzo fills in with your own name, so it comes last.
 */
export const payee = (t: RawTx) => String((typeof t.merchant === "object" && t.merchant?.name) || t.counterparty?.name || t.description || "Monzo").trim().slice(0, 60);
/** A payment's name in the app: who it was with. */
export const txName = payee;
/** The name payments were saved with before transfers used the person's name: the shop, else the reference. */
const oldName = (t: RawTx) => String((typeof t.merchant === "object" && t.merchant?.name) || t.description || "Monzo").trim().slice(0, 60);
// "ACME LTD SALARY 0925" or "ACME LTD SEPT PAY" → "acme ltd salary", "acme ltd pay": a reference's numbers and month change every time
const MONTH = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/g;
export const plain = (s: string) => s.toLowerCase().replace(/\d+/g, " ").replace(MONTH, " ").replace(/\s+/g, " ").trim();
const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "");

/**
 * New card payments and money in, as payments. Skips ones already saved, declines and moves between pots.
 * They're stamped just before the sync, so the balance (which Monzo already lowered) doesn't drop twice,
 * and keep when they really happened (paidAt) so lists still put the newest first.
 */
export function importTxs(ctx: Ctx, raw: RawTx[], stamp: number, newId: () => string): Tx[] {
  const known = new Set(ctx.txs.map(t => t.monzoId).filter(Boolean));
  const cats = new Set(ctx.state.categories.map(c => c.id));
  const out: Tx[] = [];
  for (const t of raw) {
    if (!t?.id || known.has(t.id) || t.decline_reason || !t.amount) continue;
    if (String(t.description || "").startsWith("pot_") || t.category === "savings") continue;
    known.add(t.id);
    const date = isoD(new Date(t.created)), note = txName(t), amount = r2(Math.abs(t.amount) / 100);
    const row: Tx = {id: newId(), type: t.amount < 0 ? "expense" : "income", amount, cat: "monzo-in", note, date, created: stamp - 1, paidAt: Date.parse(t.created), monzoId: t.id};
    const logo = txLogo(t);
    if (logo) row.logo = logo;
    if (t.amount < 0) {
      const cat = MONZO_CAT[t.category || ""];
      if (cat && cats.has(cat)) row.cat = cat; else { row.cat = "other"; row.needsCat = true; }
    } else {
      // pay that matches an income source counts as that payday arriving
      // who pays it, when setup saw that in Monzo; otherwise the income's name. Either can be in the reference or the payer's name
      const text = `${t.description || ""} ${t.counterparty?.name || ""}`, who = plain(text);
      const src = ctx.state.incomes.find(x => {
        const p = plain(x.payer || "");
        // letters only on both sides, so "Nando's" finds "NANDOS"
        return p ? who.includes(p) : letters(text).includes(letters(x.name.split(" ")[0]));
      });
      const due = src && occurrences(src, addDays(date, -4), addDays(date, 4))[0];
      if (src && due && !isReceived({...ctx, txs: [...ctx.txs, ...out]}, src.id, due)) Object.assign(row, {cat: src.id, srcId: src.id, forDate: due, note: ""});
    }
    out.push(row);
  }
  return out;
}

/** A pay Monzo saw land, to fill in setup's pay question. */
export interface SeenPay { amount: number; from: string; date: IsoDate }

/**
 * How far back setup reads: about 3 months, enough to see what repeats. Monzo only shares 90 days once
 * 5 minutes have passed since you approved, so this stays just inside that.
 */
export const setupSince = (now: number) => new Date(now - 89 * 864e5).toISOString().replace(/\.\d{3}Z$/, "Z");

/** The biggest money in Monzo files as income. Nothing filed as income: no guess (a friend paying you back isn't pay). */
export function lastPay(raw: RawTx[]): SeenPay | null {
  let best: RawTx | null = null;
  for (const t of raw) {
    if (!t?.id || t.decline_reason || !(t.amount > 0) || t.category !== "income" || String(t.description || "").startsWith("pot_")) continue;
    if (!best || t.amount > best.amount) best = t;
  }
  return best ? {amount: r2(best.amount / 100), from: txName(best), date: isoD(new Date(best.created))} : null;
}

export interface Backfill { monzoId: string; paidAt?: number; logo?: string; note?: string }
/**
 * Saved Monzo payments missing a time or logo (synced before those were kept), with what Monzo says now.
 * Transfers saved under their reference (often your own name) get the person's name, unless the name was changed since.
 */
export function missingDetails(txs: Tx[], raw: RawTx[]): Backfill[] {
  const byId = new Map(raw.filter(t => t?.id).map(t => [t.id, t]));
  return txs.flatMap(t => {
    const r = t.monzoId ? byId.get(t.monzoId) : undefined;
    if (!r) return [];
    const at = t.paidAt ? undefined : Date.parse(r.created);
    const fill: Backfill = {monzoId: t.monzoId!};
    if (at !== undefined && !Number.isNaN(at)) fill.paidAt = at;
    if (!t.logo) { const logo = txLogo(r); if (logo) fill.logo = logo; }
    const name = txName(r);
    if (t.note && t.note === oldName(r) && t.note !== name) fill.note = name;
    return fill.paidAt !== undefined || fill.logo || fill.note ? [fill] : [];
  });
}

const spendTotal = (b: Pick<Bank, "main" | "pots">) => r2(b.main + b.pots.filter(p => p.role === "spend").reduce((a, p) => a + p.balance, 0));

/** Money put aside in pots that aren't spending money. Never counted in the daily number. */
export const aside = (b?: Bank) => b ? r2(b.pots.filter(p => p.role !== "spend").reduce((a, p) => a + p.balance, 0)) : 0;

/**
 * The bank's numbers are the truth: re-anchor the balance to main account + spending pots.
 * Pots keep the role you gave them. New pots count until you set them aside: the total comes first, sorting it out comes after.
 */
export function applySync(state: AppState, got: Synced, now: number): AppState {
  const old = new Map((state.bank?.pots || []).map(p => [p.id, p]));
  const pots: Pot[] = got.pots.filter(p => !p.deleted).map(p => ({
    id: p.id, name: p.name.trim(), balance: r2((p.balance || 0) / 100), role: old.get(p.id)?.role ?? "spend",
    ...(p.goal_amount ? {goal: r2(p.goal_amount / 100)} : {}),
  }));
  const bank: Bank = {source: "Monzo", accountId: got.accountId, main: r2(got.mainPence / 100), pots, asOf: new Date(now).toISOString()};
  return {...state, bank, balance: spendTotal(bank), balanceSetAt: now, balanceAsOf: isoD(new Date(now))};
}

/** Moving a pot in or out of spending money shifts the balance by that pot, without losing payments logged since the sync. */
export function setPotRole(state: AppState, id: string, role: PotRole): AppState {
  const pot = state.bank?.pots.find(p => p.id === id);
  if (!state.bank || !pot || pot.role === role) return state;
  return {
    ...state,
    balance: r2(state.balance + (role === "spend" ? pot.balance : -pot.balance)),
    bank: {...state.bank, pots: state.bank.pots.map(p => p.id === id ? {...p, role} : p)},
  };
}
