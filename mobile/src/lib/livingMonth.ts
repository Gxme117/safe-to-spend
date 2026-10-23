import {billDated, billDates, billMonthly} from "./bills";
import {catGroup, spendIn} from "./calc";
import {addDays, lastOfMonth, monthName, niceDate} from "./dates";
import type {LivingItem} from "./living";
import {billLook, catLook} from "./looks";
import {money, r2} from "./money";
import type {Bill, Ctx, IsoDate, Tx} from "./types";

// The Living tab, a calendar month at a time ("Oct", with < and >). This month is as it is today (lib/living.ts); a month gone
// is what was spent on bills and everyday; a month to come is what's expected: each bill at its monthly cost (a yearly one spread,
// so months can be compared) and each everyday budget. Other months are only to look at.

/** How far < and > go: the app keeps 12 months of payments. */
export const MONTHS_EACH_WAY = 12;

export type LivingWhen = "past" | "now" | "future";
export const livingWhen = (today: IsoDate, ym: string): LivingWhen => {
  const now = today.slice(0, 7);
  return ym < now ? "past" : ym > now ? "future" : "now";
};

// what paid a bill in a month: payments filed against it (by the date they were for), and ones in its category around a due date
// that month (what `billPaid` counts), oldest first
function billPaymentsIn(ctx: Ctx, b: Bill, from: IsoDate, to: IsoDate): Tx[] {
  const ds = billDated(b) ? billDates(b, from, to) : [];
  return ctx.txs.filter(it => {
    if (it.type !== "expense") return false;
    if (it.billId === b.id) { const d = it.forDate ?? it.date; return d >= from && d <= to; }
    return !it.billId && !!b.cat && it.cat === b.cat && ds.some(d => it.date >= addDays(d, -7) && it.date <= addDays(d, 3));
  }).sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
}

/** A month's bubbles, biggest first. Gone: each bill at what went out for it (none, no bubble), on the day it went; each everyday
 *  category at what was spent in it. To come: each bill at its monthly cost, on its first due date that month (a one-off only in
 *  its month); each everyday budget. Nothing's marked paid: in a month gone it all went out, and that's what the header says. */
export function livingMonth(ctx: Ctx, ym: string): LivingItem[] {
  const {state} = ctx, from = `${ym}-01`, to = lastOfMonth(ym);
  const everyday = state.categories.filter(x => catGroup(x) === "everyday");
  const bill = (b: Bill, amount: number, date?: IsoDate): LivingItem =>
    ({id: `bill:${b.id}`, ref: b.id, name: b.name, amount, icon: b.icon ?? billLook(b.name).icon, paid: false, estimate: false, ...(date ? {date} : {})});
  const cat = (x: {id: string; name: string}, amount: number): LivingItem =>
    ({id: `cat:${x.id}`, ref: x.id, name: x.name, amount, icon: catLook(x.id, x.name).icon, paid: false, estimate: true});
  let items: LivingItem[];
  if (livingWhen(ctx.today, ym) === "past") {
    const spent = spendIn(ctx, from, to);
    items = [
      ...state.bills.map(b => { const ps = billPaymentsIn(ctx, b, from, to); return bill(b, r2(ps.reduce((a, it) => a + it.amount, 0)), ps.at(-1)?.date); }),
      ...everyday.map(x => cat(x, spent[x.id] || 0)),
    ];
  } else {
    items = [
      ...state.bills.filter(b => b.amount > 0 && (b.freq !== "oneoff" || (!!b.date && b.date >= from && b.date <= to)))
        .map(b => bill(b, billMonthly(b), billDated(b) ? billDates(b, from, to)[0] : undefined)),
      ...everyday.filter(x => x.budget > 0).map(x => cat(x, x.budget)),
    ];
  }
  return items.filter(x => x.amount > 0).sort((a, b) => b.amount - a.amount);
}

/** Another month's bills in date order (the list): the soonest first, ones with no date after. A tie goes to the bigger. */
export const monthByDate = (items: LivingItem[]) =>
  [...items].sort((a, b) => (a.date ? 0 : 1) - (b.date ? 0 : 1) || (a.date ?? "").localeCompare(b.date ?? "") || b.amount - a.amount);

/** The sheet's line in another month. Gone: when a bill was paid; what was spent of an everyday budget. To come: when a bill's
 *  due (a yearly one, what it is and when, since its bubble is a month's share); an everyday amount's budget for that month. */
export function livingMonthDue(ctx: Ctx, ym: string, item: LivingItem): {line: string; bold: string; paid?: true} {
  const past = livingWhen(ctx.today, ym) === "past", name = monthName(ym, ctx.today.slice(0, 4), true);
  if (item.estimate) {
    const budget = ctx.state.categories.find(x => x.id === item.ref)?.budget ?? 0;
    if (!past) return {line: `Your budget for ${name}`, bold: ""};
    return {line: "Spent", bold: budget > 0 ? `${money(item.amount)} of ${money(budget)}` : money(item.amount)};
  }
  if (past) return {line: item.date ? `· ${niceDate(item.date)}` : "", bold: "", paid: true};
  const b = ctx.state.bills.find(x => x.id === item.ref);
  if (b && Math.abs(billMonthly(b) - b.amount) > 0.005) {
    return {line: item.date ? `${money(b.amount)} due ${niceDate(item.date)}` : `A month's share of ${money(b.amount)}`, bold: ""};
  }
  return {line: item.date ? `Due ${niceDate(item.date)}` : "No payment date yet", bold: ""};
}

/** What went out for it in a month gone, oldest first: a bill's payments, or what was spent in an everyday category. */
export function livingMonthPayments(ctx: Ctx, ym: string, item: LivingItem): Tx[] {
  if (livingWhen(ctx.today, ym) !== "past") return [];
  const from = `${ym}-01`, to = lastOfMonth(ym);
  if (!item.estimate) { const b = ctx.state.bills.find(x => x.id === item.ref); return b ? billPaymentsIn(ctx, b, from, to) : []; }
  return ctx.txs.filter(it => it.type === "expense" && !it.billId && it.cat === item.ref && it.date >= from && it.date <= to)
    .sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
}
