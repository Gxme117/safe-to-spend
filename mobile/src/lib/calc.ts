import {billDates, billPaid, billSource} from "./bills";
import {addDays, dayDiff, niceDate, parseD} from "./dates";
import {cycleStart, lowAmt, mainIncome, nextPayday, occurrences, usualAmt} from "./income";
import {money, r2} from "./money";
import type {Bill, Category, Ctx, Group, IsoDate} from "./types";

// Every category belongs to one group: bills (fixed), everyday (a monthly amount you choose), or free.
// Nothing becomes Everyday until you choose it, so your number doesn't change by surprise.
export const catGroup = (x: Category): Group => x.group || (x.fixed ? "bills" : "free");

export interface EverydayLeft { x: Category; spent: number; left: number }

export interface Calc {
  t: IsoDate;
  cur: string;
  spent: Record<string, number>;   // this calendar month, by category
  balance: number;                 // spending money right now
  payday: IsoDate | null;
  daysLeft: number | null;
  billsLeft: number;               // bills still to go out before payday
  billsDue: {b: Bill; d: IsoDate}[];
  everyday: EverydayLeft[];
  everydayLeft: number;            // what's left of everyday amounts this pay cycle
  cycleFrom: IsoDate;
  need: number;                    // bills + everyday: what has to be paid before payday
  short: number;                   // how much more that needs than you have
}

export function calc(ctx: Ctx): Calc {
  const {state, txs} = ctx, t = ctx.today, cur = t.slice(0, 7);
  const cats = state.categories;
  const spent: Record<string, number> = {};
  for (const it of txs) if (it.date.slice(0, 7) === cur && it.type === "expense") spent[it.cat] = (spent[it.cat] || 0) + it.amount;

  // the balance you typed in, plus everything logged since
  let balance = state.balance;
  for (const it of txs) {
    if ((it.created || 0) <= (state.balanceSetAt || 0)) continue;
    balance += it.type === "income" ? it.amount : -it.amount;
  }
  balance = r2(balance);

  const payday = state.incomes.length ? nextPayday(ctx) : null;
  const daysLeft = payday ? dayDiff(t, payday) : null;
  let billsLeft = 0;
  const billsDue: {b: Bill; d: IsoDate}[] = [];
  if (state.bills.length) {
    // only bills that land before the next payday and haven't gone out yet
    const until = payday ? addDays(payday, -1) : addDays(t, 30);
    for (const b of state.bills) for (const d of billDates(b, t, until)) if (!billPaid(ctx, b, d)) { billsLeft += b.amount || 0; billsDue.push({b, d}); }
    billsDue.sort((x, y) => x.d < y.d ? -1 : 1);
  } else {
    for (const c of cats) if (c.fixed) billsLeft += Math.max(0, (c.budget || 0) - (spent[c.id] || 0));
  }
  billsLeft = r2(billsLeft);

  // everyday: what's left of each monthly amount since the last payday is kept aside, not counted as free
  const cycleFrom = cycleStart(ctx), spentCycle: Record<string, number> = {};
  for (const it of txs) if (it.type === "expense" && !it.billId && it.date >= cycleFrom && it.date <= t) spentCycle[it.cat] = (spentCycle[it.cat] || 0) + it.amount;
  const everyday = cats.filter(x => catGroup(x) === "everyday").map(x => ({x, spent: r2(spentCycle[x.id] || 0), left: r2((x.budget || 0) - (spentCycle[x.id] || 0))}));
  const everydayLeft = r2(everyday.reduce((s, e) => s + Math.max(0, e.left), 0));
  const need = r2(billsLeft + everydayLeft);
  const short = r2(Math.max(0, need - balance));   // bills and everyday come first; savings is the back-up
  return {t, cur, spent, balance, payday, daysLeft, billsLeft, billsDue, everyday, everydayLeft, cycleFrom, need, short};
}

/** What the hero shows. `kind` says which state it's in; only "number" has a daily figure. */
export type Hero =
  | {kind: "no-income"}
  | {kind: "payday-today"}
  | {kind: "no-payday"}
  | {kind: "number"; perDay: number; free: number; allowance: number; spentToday: number; reason: string};

/** Free spending per day: leaves out bills, fixed categories and everyday amounts, which are already set aside. */
export function freeSpentByDay(ctx: Ctx) {
  const cats = ctx.state.categories, out: Record<IsoDate, number> = {};
  for (const it of ctx.txs) {
    if (it.type !== "expense" || it.billId) continue;
    const cx = cats.find(x => x.id === it.cat);
    if (cx && (cx.fixed || catGroup(cx) === "everyday")) continue;
    out[it.date] = (out[it.date] || 0) + it.amount;
  }
  return out;
}

/** Everything spent each day apart from bills (for the calendar). */
export function spentByDay(ctx: Ctx) {
  const cats = ctx.state.categories, out: Record<IsoDate, number> = {};
  for (const it of ctx.txs) {
    if (it.type !== "expense" || it.billId) continue;
    if (cats.find(x => x.id === it.cat && x.fixed)) continue;
    out[it.date] = (out[it.date] || 0) + it.amount;
  }
  return out;
}

export function hero(ctx: Ctx, c: Calc): Hero {
  if (!ctx.state.incomes.length) return {kind: "no-income"};
  if (c.daysLeft === 0) return {kind: "payday-today"};
  if (c.daysLeft == null || c.daysLeft < 0 || !c.payday) return {kind: "no-payday"};
  const free = r2(c.balance - c.billsLeft - c.everydayLeft);   // after bills and what's left of your everyday amounts
  const perDay = free / c.daysLeft;
  const allowance = Math.max(0, perDay);
  const spentToday = r2(freeSpentByDay(ctx)[c.t] || 0);
  // no "pace" judgement: spending big one day simply lowers the amount for the days after, and that's fine
  const reason = perDay < 0
    ? `${money(c.short)} short for bills and everyday`
    : !spentToday
      ? `Lasts you until payday, ${niceDate(c.payday)}`
      : spentToday <= allowance
        ? `${money(r2(allowance - spentToday))} left today after ${money(spentToday)} spent`
        : `${money(spentToday)} spent today. The days ahead adjust`;
  return {kind: "number", perDay, free, allowance, spentToday, reason};
}

/** The pay cycle: from the last payday to the next one. */
export function payCycle(ctx: Ctx, c: Calc) {
  const t = c.t, src = mainIncome(ctx);
  let start = t;
  if (src) { const past = occurrences(src, addDays(t, -45), t); if (past.length) start = past[past.length - 1]; }
  if (start === t && c.payday && src) {
    const prev = occurrences(src, addDays(t, -45), addDays(t, -1));
    if (prev.length && c.payday > t && dayDiff(prev[prev.length - 1], c.payday) <= 45) start = prev[prev.length - 1];
  }
  const total = c.payday ? Math.min(dayDiff(start, c.payday), 62) : 0;
  return {start, total, dayNo: dayDiff(start, t) + 1};
}

export type DayKind = "pay" | "none" | "zero" | "spent" | "bill" | "upcoming";
export interface CalDay { d: IsoDate; n: number; kinds: DayKind[]; today: boolean; note: string; label: string; bills: Bill[] }

/** Payday-to-payday calendar. Weeks start on Monday; `lead` is the number of blank cells before the first day. */
export function calendar(ctx: Ctx, c: Calc) {
  const {start} = payCycle(ctx, c), days: CalDay[] = [];
  if (!c.payday) return {lead: 0, days};
  const spentAll = spentByDay(ctx), tracked = ctx.state.balanceAsOf || c.t;
  const dueOn: Record<IsoDate, Bill[]> = {};
  for (const x of c.billsDue) (dueOn[x.d] = dueOn[x.d] || []).push(x.b);
  for (let d = start; d <= c.payday; d = addDays(d, 1)) {
    const kinds: DayKind[] = [], spent = spentAll[d] || 0, bills = dueOn[d] || [];
    let note = "", label = niceDate(d);
    if (d === c.payday) { kinds.push("pay"); note = "Pay"; label += ", payday"; }
    else if (d < c.t) {
      if (d < tracked) kinds.push("none");
      else if (!spent) { kinds.push("zero"); note = "★"; label += ", no-spend day"; }
      else { kinds.push("spent"); note = "£" + Math.round(spent); label += `, spent ${money(spent)}`; }
    } else {
      const due = bills.reduce((s, b) => s + (b.amount || 0), 0);
      if (due) { kinds.push("bill"); note = "£" + Math.round(due); label += `, ${bills.map(b => b.name).join(" and ")} due`; }
      else kinds.push("upcoming");
      if (d === c.t) { label += ", today"; if (!due && spent) note = "£" + Math.round(spent); }
    }
    days.push({d, n: +d.slice(8), kinds, today: d === c.t, note, label, bills});
  }
  return {lead: (parseD(start).getDay() + 6) % 7, days};
}

/** What a tapped future day means, in one sentence. */
export function dayDetail(ctx: Ctx, c: Calc, day: CalDay) {
  const src = mainIncome(ctx);
  if (day.d === c.payday) return `${niceDate(day.d)}: payday.${src ? ` ${src.name} pays at least ${money(lowAmt(src))}.` : ""}`;
  if (day.bills.length) return `${niceDate(day.d)}: ${day.bills.map(b => `${b.name} ${money(b.amount || 0)}`).join(", ")} due. It's already set aside, so it won't touch your daily amount.`;
  if (day.d < c.t && day.kinds.includes("spent")) return `${niceDate(day.d)}: spent ${money(spentByDay(ctx)[day.d] || 0)}.`;
  if (day.kinds.includes("zero")) return `${niceDate(day.d)}: nothing spent. A no-spend day.`;
  return `${niceDate(day.d)}: no bills due.`;
}

/** Bills and pay still to come this cycle, in date order. */
export function comingUp(ctx: Ctx, c: Calc) {
  const src = mainIncome(ctx);
  const list = c.billsDue.map(x => ({key: `${x.b.id}_${x.d}`, d: x.d, name: x.b.name, meta: `From ${billSource(x.b)}`, amt: `−${money(x.b.amount || 0)}`, good: false}));
  if (src && c.payday) list.push({
    key: `pay_${c.payday}`, d: c.payday, name: `${src.name} pay`,
    meta: src.varies ? `Usually ${money(usualAmt(src))}, at least ${money(lowAmt(src))}` : "Payday",
    amt: `+${money(lowAmt(src))}`, good: true,
  });
  return list.sort((a, b) => a.d < b.d ? -1 : 1);
}

/** Where your money is, like iPhone Storage: bills first, then everyday, then free. */
export function split(c: Calc) {
  const have = Math.max(c.balance, 0);
  const bills = r2(Math.min(c.billsLeft, have));
  const everyday = r2(Math.min(c.everydayLeft, Math.max(have - bills, 0)));
  const free = r2(Math.max(0, c.balance - bills - everyday));
  return {total: c.balance, parts: [
    {key: "bills" as const, label: "Bills", amount: bills},
    {key: "everyday" as const, label: "Everyday", amount: everyday},
    {key: "free" as const, label: "Free", amount: free},
  ], short: c.short};
}

/** The "Free until payday" summary on the Month tab. */
export function freeSummary(c: Calc) {
  const free = r2(c.balance - c.billsLeft - c.everydayLeft);
  return free >= 0
    ? {free, lead: "Free until payday", sub: `After ${money(c.billsLeft)} of bills${c.everydayLeft ? ` and ${money(c.everydayLeft)} of everyday` : ""}. Spend it whenever suits you`}
    : {free, lead: "Short before payday", sub: `You have ${money(c.balance)} but need ${money(c.need)} for bills and everyday.`};
}

/** One sentence under the bills list. */
export function billsLine(c: Calc) {
  if (!c.payday) return "";
  const before = r2(c.billsDue.reduce((s, x) => s + (x.b.amount || 0), 0));
  return before
    ? `${money(before)} is due before payday on ${niceDate(c.payday)}, so it's held back from your spending money.`
    : `Nothing is due before payday on ${niceDate(c.payday)}.`;
}
