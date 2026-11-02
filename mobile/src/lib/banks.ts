// Every bank you've connected, together: Monzo (through its own API) and banks linked through Open Banking.
// Spending money is each bank's main account plus the pots that count; what's set aside never counts.
import {isoD} from "./dates";
import {r2} from "./money";
import type {AppState, Bank, PotRole} from "./types";

/** False in the tester build (eas.json): TrueLayer is a mock bank for now. Monzo stays, each person typing in their own developer client. */
export const linksOn = process.env.EXPO_PUBLIC_LINKS !== "off";

/** Every connected bank, Monzo first. Everything else reads banks from here. */
export const allBanks = (s: AppState): Bank[] => [...(s.bank ? [s.bank] : []), ...(s.links || [])];

/** A bank's spending money: its main account plus the pots (or other accounts) that count. */
export const spendOf = (b: Bank) => r2(b.main + b.pots.filter(p => p.role === "spend").reduce((a, p) => a + p.balance, 0));
/** Everything in a bank, as its own app shows it. */
export const totalOf = (b: Bank) => r2(b.main + b.pots.reduce((a, p) => a + p.balance, 0));
const spendAll = (s: AppState) => r2(allBanks(s).reduce((a, b) => a + spendOf(b), 0));

/** Money put aside in pots that aren't spending money, in every bank. Never counted in the daily number. */
export const aside = (s: AppState) => r2(allBanks(s).reduce((a, b) => a + totalOf(b) - spendOf(b), 0));

/** The banks' numbers are the truth: the balance is every bank's spending money, as of now. */
export const anchor = (s: AppState, now: number): AppState =>
  ({...s, balance: spendAll(s), balanceSetAt: now, balanceAsOf: isoD(new Date(now))});

/**
 * What each bank's card shows: everything in it. Payments logged since the last sync aren't in any bank's numbers yet,
 * so the first card carries them (with one bank, that's the balance plus what's set aside, as before).
 */
export function cardBalances(s: AppState, balance: number) {
  const logged = r2(balance - spendAll(s));
  return allBanks(s).map((bank, i) => ({bank, amount: r2(totalOf(bank) + (i === 0 ? logged : 0))}));
}

/** Moving a pot in or out of spending money shifts the balance by that pot, without losing payments logged since the sync. */
export function setPotRole(s: AppState, id: string, role: PotRole): AppState {
  const pot = allBanks(s).flatMap(b => b.pots).find(p => p.id === id);
  if (!pot || pot.role === role) return s;
  const set = (b: Bank): Bank => b.pots.some(p => p.id === id) ? {...b, pots: b.pots.map(p => p.id === id ? {...p, role} : p)} : b;
  return {
    ...s, balance: r2(s.balance + (role === "spend" ? pot.balance : -pot.balance)),
    ...(s.bank ? {bank: set(s.bank)} : {}), ...(s.links ? {links: s.links.map(set)} : {}),
  };
}

/** A UK account as one key: its sort code and account number, digits only. Anything else isn't one. */
export function accountKey(sortCode?: string | null, number?: string | null) {
  const k = `${sortCode || ""}${number || ""}`.replace(/\D/g, "");
  return k.length === 14 ? k : "";
}
/** Your own accounts, in every connected bank: money between them isn't spending or income. */
export const ownAccounts = (s: AppState) => new Set(allBanks(s).flatMap(b => b.numbers || []));
