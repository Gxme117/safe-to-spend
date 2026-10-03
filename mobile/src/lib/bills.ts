import {addDays, isoD, parseD, workingAfter, workingBefore} from "./dates";
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
  if (b.freq === "monthly") {
    for (let i = -1; i < 40; i++) {
      const base = new Date(F.getFullYear(), F.getMonth() + i, 1), last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
      const d = b.day === "last" ? workingBefore(last) : workingAfter(new Date(base.getFullYear(), base.getMonth(), Math.min(Number(b.day) || 1, last.getDate())));
      if (d > T) break;
      if (d >= F) out.push(isoD(d));
    }
    return out;
  }
  if (!b.date) return out;
  const A = parseD(b.date), step = ({weekly: 7, fortnightly: 14, fourweekly: 28} as Record<string, number>)[b.freq];
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

export const billSource = (b: Bill) => b.from?.kind === "other" ? (b.from.name || "another bank") : "main account";

/** "Next Mon 5 Oct. From main account, direct debit" */
export function billMeta(b: Bill, next: string | null) {
  return `${next ? `Next ${next}` : BILL_FREQ[b.freq]}. From ${billSource(b)}${b.method ? `, ${METHOD_META[b.method]}` : ""}`;
}
