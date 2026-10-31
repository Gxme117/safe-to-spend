// Monzo, without the network: building the login link, reading the link Safari lands on, and turning
// what the API returned into app state. The calls themselves live in services/monzo.ts.
import {accountKey, allBanks, anchor, ownAccounts} from "./banks";
import {billSlot} from "./bills";
import {bankCat, GENERAL} from "./categories";
import {addDays, isoD} from "./dates";
import {cycleStart, isReceived, occurrences} from "./income";
import {r2} from "./money";
import type {FilingPatch} from "./payments";
import type {AppState, Bank, Bill, Ctx, IsoDate, Pot, Tx} from "./types";

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
  // the person or company at the other end of a bank transfer, and their account when the bank says
  counterparty?: {name?: string; sort_code?: string; account_number?: string} | null;
}
/** `numbers`: the account's sort code and account number (`accountKey`), so moves to your other banks aren't spending. */
export interface Synced { accountId: string; mainPence: number; pots: RawPot[]; txs: RawTx[]; numbers?: string[] }

/** Where a sync starts reading payments: a day before the last one (to catch late ones), or the start of this month the first time. */
export function syncSince(bank: Bank | undefined, now: number): string {
  const d = new Date(now);
  const from = bank ? new Date(Date.parse(bank.asOf) - 864e5) : new Date(d.getFullYear(), d.getMonth(), 1);
  // Monzo refuses milliseconds ("bad_param.since"): 2026-10-01T00:00:00Z, not 2026-10-01T00:00:00.000Z
  return from.toISOString().replace(/\.\d{3}Z$/, "Z");
}

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

// words that don't say who it is: "Octopus Energy Ltd" is Octopus Energy, "NETFLIX.COM" is Netflix
const NOISE = new Set(["ltd", "limited", "plc", "uk", "co", "com", "www", "the", "dd"]);
/** A name as the words that say who it is: numbers and months out (`plain`), apostrophes joined, any other mark splits words. */
const nameWords = (s: string) => plain(s.replace(/['’]/g, "")).split(/[^a-z]+/).filter(w => w && !NOISE.has(w));
/** Every word of the bill's name is in the payment's, so a reference added on the end doesn't matter: "Netflix" finds
 *  "NETFLIX.COM", "Council tax" finds "LB HACKNEY COUNCIL TAX". Only that way round: "Amazon Prime" doesn't find "AMAZON". */
const named = (name: string, paid: string[]) => { const w = nameWords(name); return w.length > 0 && w.every(x => paid.includes(x)); };
// about what the bill is: within 10% (how setup found it), or from half to double for one that varies
const aboutRight = (b: Bill, amount: number) =>
  b.varies ? amount >= b.amount / 2 && amount <= b.amount * 2 : Math.abs(amount - b.amount) <= b.amount * 0.1 + 0.005;

/**
 * The bill a payment from the bank paid, and the due date it's for. Only when it's paid to them (the payee setup saw, or the bill's
 * name), about the amount, and near a due date the bank hasn't paid yet (`billSlot`): the amount alone is never enough.
 * More than one bill fits: null, and it's asked about, as now. A bill with no amount yet is never matched.
 */
export function billMatch(ctx: Ctx, it: Pick<Tx, "amount" | "date" | "note">): {b: Bill; d: IsoDate | null} | null {
  const paid = nameWords(it.note);
  const fits = ctx.state.bills.flatMap(b => {
    if (!(b.amount > 0) || !aboutRight(b, it.amount) || !(named(b.payee ?? "", paid) || named(b.name, paid))) return [];
    const slot = billSlot(ctx, b, it.date);
    return slot ? [{b, d: slot.d}] : [];
  });
  return fits.length === 1 ? fits[0] : null;
}
/** A payment filed against the bill it paid, as "Mark as paid" files one: off what's held back, and not counted as spending. */
const paidBill = (m: {b: Bill; d: IsoDate | null}): FilingPatch => ({cat: m.b.cat || "bills", billId: m.b.id, ...(m.d ? {forDate: m.d} : {})});

/**
 * New card payments and money in, as payments. Skips ones already saved, declines, moves between pots and moves
 * between your own connected accounts (the balance already shows both sides).
 * They're stamped just before the sync, so the balance (which the bank already lowered) doesn't drop twice,
 * and keep when they really happened (paidAt) so lists still put the newest first.
 */
export function importTxs(ctx: Ctx, raw: RawTx[], stamp: number, newId: () => string): Tx[] {
  const known = new Set(ctx.txs.map(t => t.monzoId).filter(Boolean));
  const own = ownAccounts(ctx.state);
  const savings = new Map(allBanks(ctx.state).flatMap(b => b.pots).filter(p => p.role === "save").map(p => [p.id, p.name]));
  const out: Tx[] = [];
  for (const t of raw) {
    if (!t?.id || known.has(t.id) || t.decline_reason || !t.amount) continue;
    // a move to or from a savings pot is kept, so this pay's savings count as moved (net); a move to a spending pot isn't anything
    const pot = String(t.description || "");
    if (savings.has(pot)) {
      known.add(t.id);
      out.push({id: newId(), type: t.amount < 0 ? "save" : "income", amount: r2(Math.abs(t.amount) / 100), cat: "savings", note: savings.get(pot) || "",
        date: isoD(new Date(t.created)), created: stamp - 1, paidAt: Date.parse(t.created), monzoId: t.id});
      continue;
    }
    if (pot.startsWith("pot_") || t.category === "savings") continue;
    if (own.has(accountKey(t.counterparty?.sort_code, t.counterparty?.account_number))) continue;
    known.add(t.id);
    const date = isoD(new Date(t.created)), note = txName(t), amount = r2(Math.abs(t.amount) / 100);
    const row: Tx = {id: newId(), type: t.amount < 0 ? "expense" : "income", amount, cat: "monzo-in", note, date, created: stamp - 1, paidAt: Date.parse(t.created), monzoId: t.id};
    const logo = txLogo(t);
    if (logo) row.logo = logo;
    if (t.amount < 0) {
      // a bill it paid is filed against it (each due date once: it sees the ones before it); otherwise the category Monzo's
      // points to (lib/categories.ts), or General and asked
      const bill = billMatch({...ctx, txs: [...ctx.txs, ...out]}, row);
      const cat = bankCat(ctx.state.categories, t.category, note);
      if (bill) Object.assign(row, paidBill(bill));
      else if (cat) row.cat = cat; else { row.cat = GENERAL; row.needsCat = true; }
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

/**
 * Payments from the bank saved before they could be matched to the bill they paid (synced before this, or before the bill was added),
 * filed against it now. Only ones still asked about, so never one you've said what it was. Oldest first, each taking its due date.
 */
export function unfiledBills(ctx: Ctx): {id: string; patch: FilingPatch}[] {
  const out: {id: string; patch: FilingPatch}[] = [];
  let txs = ctx.txs;
  const open = ctx.txs.filter(it => it.type === "expense" && it.monzoId && it.needsCat && !it.billId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
  for (const it of open) {
    const m = billMatch({...ctx, txs: txs.filter(x => x.id !== it.id)}, it);
    if (!m) continue;
    const patch = paidBill(m);
    out.push({id: it.id, patch});
    txs = txs.map(x => x.id === it.id ? {...x, ...patch} : x);
  }
  return out;
}

/**
 * Payments you logged for a bill ("Mark as paid", Add payment) that a payment from the bank now covers: the same due date, or for a
 * bill with no payment date, the same pay cycle. The bank's is the real one, so these go, and the bill is paid (and spent) once.
 */
export function standIns(ctx: Ctx): string[] {
  const slot = (it: Tx) => `${it.billId}|${it.forDate ? `due ${it.forDate}` : `pay ${cycleStart({...ctx, today: it.date})}`}`;
  const bank = new Set(ctx.txs.filter(it => it.billId && it.monzoId).map(slot));
  return ctx.txs.filter(it => it.billId && !it.monzoId && bank.has(slot(it))).map(it => it.id);
}

/**
 * The bank's numbers are the truth: re-anchor the balance to every bank's main account + spending pots.
 * Pots keep the role you gave them. New pots count until you set them aside: the total comes first, sorting it out comes after.
 */
export function applySync(state: AppState, got: Synced, now: number): AppState {
  const old = new Map((state.bank?.pots || []).map(p => [p.id, p]));
  const pots: Pot[] = got.pots.filter(p => !p.deleted).map(p => ({
    id: p.id, name: p.name.trim(), balance: r2((p.balance || 0) / 100), role: old.get(p.id)?.role ?? "spend",
    ...(p.goal_amount ? {goal: r2(p.goal_amount / 100)} : {}),
  }));
  const numbers = got.numbers?.length ? got.numbers : state.bank?.numbers;
  const bank: Bank = {source: "Monzo", accountId: got.accountId, main: r2(got.mainPence / 100), pots, asOf: new Date(now).toISOString(), ...(numbers ? {numbers} : {})};
  return anchor({...state, bank}, now);
}
