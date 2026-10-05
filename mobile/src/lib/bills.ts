import {addDays, isoD, niceDate, ord, parseD, workingAfter, workingBefore} from "./dates";
import {parseAmount, r2} from "./money";
import type {Bill, BillFreq, BillMethod, Ctx, IsoDate} from "./types";

export const BILL_FREQ: Record<BillFreq, string> = {
  monthly: "Every month", weekly: "Every week", fortnightly: "Every 2 weeks", fourweekly: "Every 4 weeks", quarterly: "Every 3 months", yearly: "Every year",
};
export const PER_MONTH: Record<BillFreq, number> = {monthly: 1, weekly: 52 / 12, fortnightly: 26 / 12, fourweekly: 13 / 12, quarterly: 1 / 3, yearly: 1 / 12};
export const METHOD: Record<BillMethod, string> = {dd: "Direct debit", card: "Card", transfer: "I send it myself"};
export const METHOD_META: Record<BillMethod, string> = {dd: "direct debit", card: "card", transfer: "you send it"};
export const COMMON_BILLS = ["Rent", "Council tax", "Energy", "Water", "Phone", "Broadband", "Gym", "TV licence", "Insurance", "Car finance", "Loan"];

/** Every date this bill goes out between from and to (inclusive). Bills move LATER on weekends and bank holidays (pay moves earlier). */
export function billDates(b: Bill, from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [], F = parseD(from), T = parseD(to);
  if (!billDated(b)) return out;   // no payment date yet: never guessed
  if (b.freq === "monthly") {
    for (let i = -1; i < 40; i++) {
      const base = new Date(F.getFullYear(), F.getMonth() + i, 1), last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
      const d = b.day === "last" ? workingBefore(last) : workingAfter(new Date(base.getFullYear(), base.getMonth(), Math.min(Number(b.day) || 1, last.getDate())));
      if (d > T) break;
      if (d >= F) out.push(isoD(d));
    }
    return out;
  }
  const A = parseD(b.date!), step = ({weekly: 7, fortnightly: 14, fourweekly: 28} as Record<string, number>)[b.freq];
  if (step) {
    const n = Math.floor((+F - +A) / 864e5 / step) - 1;
    for (let i = n; i < n + 600; i++) {
      const d = new Date(A); d.setDate(d.getDate() + i * step);
      const w = workingAfter(d);
      if (w > T) break;
      if (w >= F) out.push(isoD(w));
    }
    return out;
  }
  const m = ({quarterly: 3, yearly: 12} as Record<string, number>)[b.freq] || 1;
  const i0 = Math.floor(((F.getFullYear() - A.getFullYear()) * 12 + F.getMonth() - A.getMonth()) / m) - 1;
  for (let i = i0; i < i0 + 200; i++) {
    const base = new Date(A.getFullYear(), A.getMonth() + i * m, 1), last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    const w = workingAfter(new Date(base.getFullYear(), base.getMonth(), Math.min(A.getDate(), last.getDate())));
    if (w > T) break;
    if (w >= F) out.push(isoD(w));
  }
  return out;
}

export const nextBill = (b: Bill, t: IsoDate) => billDates(b, t, addDays(t, 400))[0] || null;

/** Paid when a payment was filed against it, or a payment in its category went out from a week before to 3 days after. */
export function billPaid(ctx: Ctx, b: Bill, d: IsoDate) {
  return ctx.txs.some(it =>
    (it.billId === b.id && it.forDate === d) ||
    (!!b.cat && it.type === "expense" && it.cat === b.cat && it.date >= addDays(d, -7) && it.date <= addDays(d, 3)));
}

export const billMonthly = (b: Bill) => (b.amount || 0) * (PER_MONTH[b.freq] || 1);

/** Has a payment date: the day of the month for monthly bills, a date it goes out for the rest. Setup lets you add it later. */
export const billDated = (b: Pick<Bill, "freq" | "day" | "date">) => b.freq === "monthly" ? !!b.day : !!b.date;

export const billSource = (b: Bill) => b.from?.kind === "other" ? (b.from.name || "another bank") : "main account";

/** "Next Mon 5 Oct. From main account, direct debit" */
export function billMeta(b: Bill, next: string | null) {
  if (!(b.amount > 0)) return `No amount yet. From ${billSource(b)}`;
  return `${next ? `Next ${next}` : billDated(b) ? BILL_FREQ[b.freq] : "No payment date yet"}. From ${billSource(b)}${b.method ? `, ${METHOD_META[b.method]}` : ""}`;
}

/** Which due date a payment counts towards: the next unpaid one on or after it (past ones are no longer held back anyway). */
export function billFor(ctx: Ctx, b: Bill, date: IsoDate) {
  const ds = billDates(b, date, addDays(date, 45));
  return ds.find(d => !billPaid(ctx, b, d)) || ds[0] || null;
}

export interface BillForm { name: string; amount: number; varies: boolean; freq: BillFreq; day: number | "last" | null; date: IsoDate; method: BillMethod | null }

export function buildBill(f: BillForm, id: string, old?: Bill): {bill: Bill} | {error: string} {
  const name = f.name.trim();
  if (!name) return {error: "Give this bill a name, e.g. Rent"};
  if (!(f.amount > 0)) return {error: "Enter how much it is, e.g. 650"};
  if (f.freq === "monthly" && !f.day) return {error: "Pick the day it goes out"};
  if (f.freq !== "monthly" && !f.date) return {error: "Pick the next date it goes out"};
  const bill: Bill = {id, name: name.slice(0, 40), amount: r2(f.amount), varies: f.varies, freq: f.freq, from: old?.from || {kind: "main"}};
  if (f.freq === "monthly") bill.day = f.day!; else bill.date = f.date;
  if (f.method) bill.method = f.method;
  if (old?.cat) bill.cat = old.cat;
  return {bill};
}

/**
 * A bill as setup collects it: the amount as typed (blank or 0 if you don't know it yet), and a payment date that can wait ("I'll add this later").
 * Subscriptions are added up from `items` instead: `amount` is kept as their total.
 * One found in your bank's payments keeps who it's paid to, how, and whether it varies.
 */
export interface BillDraft {
  amount: string; freq: BillFreq; day: number | "last" | null; date: IsoDate | null; later?: boolean;
  items?: SubItem[];   // the subscriptions you have, each a month
  extra?: string[];    // ones you named yourself, after the usual ones
  payee?: string; method?: BillMethod; varies?: boolean;   // found in your bank
}
export interface SubItem { name: string; amount: string }

/**
 * Usual UK monthly prices for the plan most people have (Netflix Standard, iCloud+ 50GB, PlayStation Plus Essential), checked October 2026.
 * They're a starting point you can change. Names only: no logos or brand colours.
 */
export const SUBSCRIPTIONS: {name: string; price: number}[] = [
  {name: "Netflix", price: 13.99}, {name: "Spotify", price: 12.99}, {name: "Amazon Prime", price: 8.99}, {name: "Disney+", price: 9.99},
  {name: "YouTube Premium", price: 12.99}, {name: "iCloud+", price: 0.99}, {name: "PlayStation Plus", price: 7.99}, {name: "Xbox Game Pass", price: 6.99},
];

/** What your subscriptions come to a month. One you haven't priced yet counts as nothing, not a guess. */
export const itemsTotal = (items: SubItem[]) => r2(items.reduce((a, x) => a + Math.max(0, parseAmount(x.amount) || 0), 0));

/** The draft with these subscriptions: monthly, and its amount is their total (blank while it's nothing). */
export function withItems(d: BillDraft, items: SubItem[]): BillDraft {
  const total = itemsTotal(items);
  return {...d, items, freq: "monthly", amount: total > 0 ? String(total) : ""};
}
export const newDraft = (): BillDraft => ({amount: "", freq: "monthly", day: null, date: null});
export const draftReady = (d: BillDraft) => parseAmount(d.amount) > 0;

/** The bill a draft becomes. Nothing you haven't given is guessed: no amount is 0, and no payment date is left out. */
export function draftBill(name: string, d: BillDraft, id: string): Bill {
  const bill: Bill = {id, name: name.trim().slice(0, 40), amount: r2(parseAmount(d.amount) || 0), freq: d.freq, from: {kind: "main"}};
  if (d.freq === "monthly") { if (d.day) bill.day = d.day; } else if (d.date) bill.date = d.date;
  if (d.varies) bill.varies = true;
  if (d.method) bill.method = d.method;
  if (d.payee) Object.assign(bill, {source: "bank", payee: d.payee});
  return bill;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayMonth = (d: IsoDate, long = false) => { const x = parseD(d), m = MONTHS[x.getMonth()]; return `${x.getDate()} ${long ? m : m.slice(0, 3)}`; };

/** When it goes out, short, for a list row: "1st", "Last working day", "Monday", "Mon 12 Oct", "12 Dec". Null without a date. */
export function billWhen(b: Pick<Bill, "freq" | "day" | "date">): string | null {
  if (!billDated(b)) return null;
  if (b.freq === "monthly") return b.day === "last" ? "Last working day" : ord(Number(b.day));
  if (b.freq === "weekly") return WEEKDAYS[parseD(b.date!).getDay()];
  if (b.freq === "quarterly" || b.freq === "yearly") return dayMonth(b.date!);
  return niceDate(b.date!);
}

/** When it goes out, in full: "1st of every month", "Every Monday", "12 December every year", "Next on Mon 12 Oct". */
export function billWhenLong(b: Pick<Bill, "freq" | "day" | "date">, today: IsoDate): string | null {
  if (!billDated(b)) return null;
  if (b.freq === "monthly") return b.day === "last" ? "Last working day of the month" : `${ord(Number(b.day))} of every month`;
  if (b.freq === "weekly") return `Every ${WEEKDAYS[parseD(b.date!).getDay()]}`;
  if (b.freq === "yearly") return `${dayMonth(b.date!, true)} every year`;
  // the next one, as it falls (a weekend moves it later)
  const next = billDates({id: "", name: "", amount: 0, freq: b.freq, date: b.date}, today, addDays(today, 120))[0];
  return next ? `Next on ${niceDate(next)}` : null;
}

/** A date it goes out, picked within one period either side of today: any one of them pins down the rest. */
const PERIOD_DAYS: Partial<Record<BillFreq, number>> = {weekly: 7, fortnightly: 14, fourweekly: 28, quarterly: 92, yearly: 366};
export const datePickRange = (freq: BillFreq, today: IsoDate) => {
  const n = PERIOD_DAYS[freq] ?? 31;
  return {min: addDays(today, -(n - 1)), max: addDays(today, n - 1)};
};
