// Banks linked through TrueLayer (Open Banking), without the network: what its Data API sends, turned into the shapes
// the app already uses for Monzo, so importing payments, the balance and pot roles work the same. The calls live in services/truelayer.ts.
import {accountKey, anchor, spendOf} from "./banks";
import type {RawTx} from "./monzo";
import {r2} from "./money";
import type {AppState, Bank, Pot} from "./types";

/** An account as TrueLayer's Data API sends it (`/data/v1/accounts`). */
export interface TlAccount {
  account_id: string;
  account_type?: string;   // "TRANSACTION", "SAVINGS", "BUSINESS_TRANSACTION", "BUSINESS_SAVINGS"
  display_name?: string;
  account_number?: {number?: string | null; sort_code?: string | null} | null;
  provider?: {display_name?: string; provider_id?: string} | null;
}
/** An account's balance, in pounds. `current` is what the bank's app shows; `available` adds the overdraft, so it's never used. */
export interface TlBalance { current?: number | null; available?: number | null }
/** A payment, in pounds; debits come as negative amounts, and `transaction_type` says which way it went. */
export interface TlTx {
  transaction_id: string;
  timestamp: string;
  description?: string;
  amount: number;
  transaction_type?: "DEBIT" | "CREDIT" | string;
  transaction_category?: string;   // "PURCHASE", "DIRECT_DEBIT", "STANDING_ORDER", "TRANSFER"…
  merchant_name?: string | null;
}

/** The account that's the bank's main one: the first current account, else the first of any kind. */
export const mainOf = (accounts: TlAccount[]) => accounts.find(a => a.account_type === "TRANSACTION") ?? accounts[0];

/**
 * A payment as the app reads Monzo's, so `importTxs` takes it as it is. Prefixed ids never collide with Monzo's.
 * No category: what it was for is asked, not guessed.
 */
export function toRawTx(t: TlTx): RawTx {
  const pence = Math.round(Math.abs(t.amount) * 100);
  const out = t.transaction_type ? t.transaction_type === "DEBIT" : t.amount < 0;
  return {
    id: `tl:${t.transaction_id}`, amount: out ? -pence : pence, created: t.timestamp,
    description: (t.description || "").trim(),
    ...(t.merchant_name?.trim() ? {merchant: {name: t.merchant_name.trim()}} : {}),
    ...(t.transaction_category === "DIRECT_DEBIT" ? {scheme: "bacs"} : {}),
  };
}

/**
 * One linked bank as the app keeps it: the main account, and its other accounts as pots. A savings account starts set aside
 * (the bank says what it is, unlike a Monzo pot); a role you've chosen is kept.
 */
export function toBank(linkId: string, accounts: TlAccount[], balances: Record<string, TlBalance>, prev: Bank | undefined, now: number): Bank {
  const main = mainOf(accounts);
  const was = new Map((prev?.pots || []).map(p => [p.id, p.role]));
  const cur = (a: TlAccount) => r2(balances[a.account_id]?.current ?? 0);
  const pots: Pot[] = accounts.filter(a => a !== main).map(a => {
    const id = `tl:${a.account_id}`;
    return {id, name: (a.display_name || "Account").trim(), balance: cur(a), role: was.get(id) ?? (/SAVINGS/.test(a.account_type || "") ? "save" : "spend")};
  });
  const numbers = accounts.map(a => accountKey(a.account_number?.sort_code, a.account_number?.number)).filter(Boolean);
  return {
    source: main?.provider?.display_name?.trim() || prev?.source || "Your bank", accountId: linkId, via: "truelayer",
    main: main ? cur(main) : 0, pots, asOf: new Date(now).toISOString(), ...(numbers.length ? {numbers} : {}),
  };
}

/** Adds a linked bank, or replaces it with its newer numbers, and re-anchors the balance to every bank. */
export function withLink(s: AppState, bank: Bank, now: number): AppState {
  const links = s.links || [];
  const at = links.findIndex(b => b.accountId === bank.accountId);
  return anchor({...s, links: at < 0 ? [...links, bank] : links.map((b, i) => i === at ? bank : b)}, now);
}

/** Forgets a linked bank: its spending money comes off the balance, and payments logged since the sync still count. */
export function withoutLink(s: AppState, id: string): AppState {
  const gone = (s.links || []).find(b => b.accountId === id);
  if (!gone) return s;
  const links = (s.links || []).filter(b => b !== gone);
  return {...s, balance: r2(s.balance - spendOf(gone)), links: links.length ? links : undefined};
}
