import {billDated, billDates, billMonthly, billPaid, billSource} from "./bills";
import {addDays, dayDiff, niceDate, niceTime, parseD} from "./dates";
import {ciKey, cycleStart, isReceived, lowAmt, mainIncome, nextPayday, occurrences, usualAmt} from "./income";
import {money, r2} from "./money";
import type {Bill, Category, Ctx, Group, Income, IsoDate, Tx} from "./types";

// Every category belongs to one group: bills (fixed), everyday (a monthly amount you choose), or free.
// Nothing becomes Everyday until you choose it, so your number doesn't change by surprise.
export const catGroup = (x: Category): Group => x.group || (x.fixed ? "bills" : "free");

// A refund (or being paid back) comes off what was spent in its category: the money goes back where it came from.
// Never below 0: a refund for something bought before this month can't make a category look negative.
function addSpend(by: Record<string, number>, it: Tx) {
  if (it.type === "expense") by[it.cat] = (by[it.cat] || 0) + it.amount;
  else if (it.type === "income" && it.refundOf) by[it.refundOf] = (by[it.refundOf] || 0) - it.amount;
}
const clampSpend = (by: Record<string, number>) => { for (const k in by) by[k] = r2(Math.max(0, by[k])); };

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
  billsUndated: number;            // bills with no payment date yet: a month's share each, part of billsLeft
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
  for (const it of txs) if (it.date.slice(0, 7) === cur) addSpend(spent, it);
  clampSpend(spent);

  // the balance you typed in, plus everything logged since
  let balance = state.balance;
  for (const it of txs) {
    if ((it.created || 0) <= (state.balanceSetAt || 0)) continue;
    balance += it.type === "income" ? it.amount : -it.amount;
  }
  balance = r2(balance);

  const payday = state.incomes.length ? nextPayday(ctx) : null;
  const daysLeft = payday ? dayDiff(t, payday) : null;
  const cycleFrom = cycleStart(ctx);
  let billsLeft = 0, billsUndated = 0;
  const billsDue: {b: Bill; d: IsoDate}[] = [];
  if (state.bills.length) {
    // only bills that land before the next payday and haven't gone out yet
    const until = payday ? addDays(payday, -1) : addDays(t, 30);
    for (const b of state.bills) {
      if (!(b.amount > 0)) continue;   // no amount yet: nothing to hold back, and nothing to show as due
      // no payment date yet: a month's share is held back each pay cycle, until a payment for it lands
      if (!billDated(b)) { if (!txs.some(it => it.billId === b.id && it.date >= cycleFrom)) billsUndated += billMonthly(b); continue; }
      for (const d of billDates(b, t, until)) if (!billPaid(ctx, b, d)) { billsLeft += b.amount || 0; billsDue.push({b, d}); }
    }
    billsDue.sort((x, y) => x.d < y.d ? -1 : 1);
  } else {
    for (const c of cats) if (c.fixed) billsLeft += Math.max(0, (c.budget || 0) - (spent[c.id] || 0));
  }
  billsUndated = r2(billsUndated);
  billsLeft = r2(billsLeft + billsUndated);

  // everyday: what's left of each monthly amount since the last payday is kept aside, not counted as free
  const everyday = everydayOn(ctx, t);
  const everydayLeft = r2(everyday.reduce((s, e) => s + Math.max(0, e.left), 0));
  const need = r2(billsLeft + everydayLeft);
  const short = r2(Math.max(0, need - balance));   // bills and everyday come first; savings is the back-up
  return {t, cur, spent, balance, payday, daysLeft, billsLeft, billsDue, billsUndated, everyday, everydayLeft, cycleFrom, need, short};
}

/** What's left of each everyday amount at the end of day `d`, in the pay cycle `d` falls in. Payments after `d` aren't counted,
 *  so a past day shows what was left then, and a day after payday starts full. */
export function everydayOn(ctx: Ctx, d: IsoDate): EverydayLeft[] {
  const from = cycleStart({...ctx, today: d}), spent: Record<string, number> = {};
  for (const it of ctx.txs) if (!it.billId && it.date >= from && it.date <= d) addSpend(spent, it);
  clampSpend(spent);
  return ctx.state.categories.filter(x => catGroup(x) === "everyday")
    .map(x => ({x, spent: r2(spent[x.id] || 0), left: r2((x.budget || 0) - (spent[x.id] || 0))}));
}

/**
 * What the hero shows. `kind` says which state it's in; only "number" has a daily figure.
 * `perDay`: today's amount, whole pounds, never below £0. `left`: what's left of it after today's free spending, never below £0 (£0 when there isn't enough for bills and everyday).
 */
export type Hero =
  | {kind: "no-income"}
  | {kind: "payday-today"}
  | {kind: "no-payday"}
  | {kind: "number"; perDay: number; left: number; free: number; spentToday: number; reason: string};

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
  const free = r2(c.balance - c.billsLeft - c.everydayLeft);   // right now: after bills and what's left of your everyday amounts
  const spentToday = r2(freeSpentByDay(ctx)[c.t] || 0);
  // today's amount is what was free at the start of today, shared over the days to payday: what you spend today comes off it
  // once (in `left`), not off the share as well. Money that arrives today still raises it. Rounded down, never below £0.
  const perDay = Math.max(0, Math.floor((free + spentToday) / c.daysLeft));
  // never below £0: without enough for bills and everyday it stops at £0, and the line under it says how deep the gap is
  const left = r2(Math.max(0, perDay - spentToday));
  // no "pace" judgement: spending big one day simply lowers the amount for the days after, and that's fine
  const reason = free < 0
    // how deep the gap is, said plainly: no "short", and never asks you to move money in
    ? `You need ${money(-free)} more to cover your bills${c.everydayLeft ? " and everyday" : ""}`
    : !spentToday
      ? `Lasts you until payday, ${niceDate(c.payday)}`
      : spentToday <= perDay
        ? `${money(spentToday)} spent of today's ${money(perDay)}`
        : c.daysLeft > 1 ? `${money(spentToday)} spent today. From tomorrow, ${money(Math.floor(free / (c.daysLeft - 1)))} a day` : `${money(spentToday)} spent today. Payday is tomorrow`;
  return {kind: "number", perDay, left, free, spentToday, reason};
}

/**
 * What today does to tomorrow, if nothing more goes out today: what's free now, shared over the days after today.
 * Null when there's no daily number, payday is tomorrow, or the hero already says "From tomorrow".
 */
export function tomorrowLine(c: Calc, h: Hero): string | null {
  if (h.kind !== "number" || h.free < 0 || c.daysLeft == null || c.daysLeft < 2 || h.spentToday > h.perDay) return null;
  const next = money(Math.floor(h.free / (c.daysLeft - 1)));
  return h.spentToday ? `Spend nothing more today and tomorrow's ${next}` : `Spend nothing today and tomorrow's ${next}`;
}

/**
 * Safe to Spend on a day still to come, if you spend each day's amount until then (nothing, while there isn't enough).
 * Money you're expecting, and your pay, count from the day they're due; on payday that cycle's bills and everyday amounts
 * are set aside first, as today's number does. Never below £0, as today. Null without a number today or a payday to count to.
 */
export function forecast(ctx: Ctx, c: Calc, d: IsoDate): {amount: number; free: number} | null {
  const h = hero(ctx, c);
  if (h.kind !== "number" || !c.payday || d <= c.t) return null;
  const incomes = ctx.state.incomes, everyday = ctx.state.categories.filter(x => catGroup(x) === "everyday");
  const incoming = (x: IsoDate) => r2(incomes.reduce((a, s) => a + (occurrences(s, x, x).length && !(s.since && x < s.since)
    && !isReceived(ctx, s.id, x) && !ctx.state.skipped[ciKey(s.id, x)] ? lowAmt(s) : 0), 0));
  // what a pay cycle sets aside on its payday: its bills, a month's share of the undated ones, and the everyday amounts in full
  const setAside = (from: IsoDate, to: IsoDate) => r2(ctx.state.bills.reduce((a, b) => !(b.amount > 0) ? a
    : !billDated(b) ? a + billMonthly(b) : a + billDates(b, from, addDays(to, -1)).length * b.amount, 0)
    + everyday.reduce((a, x) => a + (x.budget || 0), 0));
  // the end of today: today's amount spent (or more, if you already have), nothing while there isn't enough
  let free = h.free < 0 ? h.free : Math.min(h.free + h.spentToday - h.perDay, h.free);
  let payday: IsoDate = c.payday, day = c.t;
  for (;;) {
    day = addDays(day, 1);
    free = r2(free + incoming(day));
    if (day === payday) {
      const next = nextPayday({...ctx, today: addDays(payday, 1)});
      if (!next) return null;
      free = r2(free - setAside(payday, next));
      payday = next;
    }
    const share = Math.max(0, Math.floor(free / dayDiff(day, payday)));
    if (day === d) return {amount: share, free};
    if (share > 0) free = r2(free - share);
  }
}

/** Another day's figure, for the same card as today's number: what you spent on a past day, what you could spend on a future one. */
export function dayFigure(ctx: Ctx, c: Calc, d: IsoDate): {label: string; amount: number; reason: string} {
  const when = niceDate(d);
  if (d < c.t) {
    const out = ctx.txs.filter(it => it.date === d && it.type === "expense");
    const amount = r2(out.reduce((a, it) => a + it.amount, 0));
    const reason = out.length ? `${out.length} payment${out.length > 1 ? "s" : ""}`
      : ctx.state.balanceAsOf && d < ctx.state.balanceAsOf ? "Before you started tracking" : "Nothing spent. A no-spend day";
    return {label: `Spent on ${when}`, amount, reason};
  }
  // what's going out or coming in that day is in the card below; this card only says what you could spend
  const f = forecast(ctx, c, d);
  if (!f) return {label: "Safe to Spend", amount: 0, reason: !ctx.state.incomes.length ? "Add your income to see this day" : "Confirm your pay to see this day"};
  return {label: "Safe to Spend", amount: f.amount,
    reason: f.free < 0 ? `You'd need ${money(-f.free)} more to cover your bills and everyday` : "If you spend each day's amount until then"};
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

export type DayKind = "pay" | "none" | "zero" | "spent" | "bill" | "upcoming" | "in";
/** `incoming`: money you've said is coming that day, still to land. */
export interface CalDay { d: IsoDate; n: number; kinds: DayKind[]; today: boolean; note: string; label: string; bills: Bill[]; incoming: Income[] }

/** Payday-to-payday calendar. Weeks start on Monday; `lead` is the number of blank cells before the first day. */
export function calendar(ctx: Ctx, c: Calc) {
  const {start} = payCycle(ctx, c), days: CalDay[] = [];
  if (!c.payday) return {lead: 0, days};
  const spentAll = spentByDay(ctx), tracked = ctx.state.balanceAsOf || c.t;
  const dueOn: Record<IsoDate, Bill[]> = {};
  for (const x of c.billsDue) (dueOn[x.d] = dueOn[x.d] || []).push(x.b);
  const inOn: Record<IsoDate, Income[]> = {};
  for (const x of expected(ctx)) (inOn[x.d] = inOn[x.d] || []).push(x.src);
  for (let d = start; d <= c.payday; d = addDays(d, 1)) {
    const kinds: DayKind[] = [], spent = spentAll[d] || 0, bills = dueOn[d] || [], incoming = inOn[d] || [];
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
    // money on its way: a dot of its own; its amount is the note only when nothing else is
    if (incoming.length) {
      const amt = incoming.reduce((s, x) => s + lowAmt(x), 0);
      kinds.push("in");
      if (!note) note = "+£" + Math.round(amt);
      label += `, ${incoming.map(x => `${x.name} ${money(lowAmt(x))}`).join(" and ")} expected`;
    }
    days.push({d, n: +d.slice(8), kinds, today: d === c.t, note, label, bills, incoming});
  }
  return {lead: (parseD(start).getDay() + 6) % 7, days};
}

/** What a tapped future day means, in one sentence. */
export function dayDetail(ctx: Ctx, c: Calc, day: CalDay) {
  const coming = day.incoming.length ? ` ${day.incoming.map(x => `${x.name} ${money(lowAmt(x))}`).join(" and ")} expected. It counts once it lands.` : "";
  return dayMain(ctx, c, day, !!coming) + coming;
}
function dayMain(ctx: Ctx, c: Calc, day: CalDay, coming: boolean) {
  const src = mainIncome(ctx);
  if (day.d === c.payday) return `${niceDate(day.d)}: payday.${src ? ` ${src.name} pays at least ${money(lowAmt(src))}.` : ""}`;
  if (day.bills.length) return `${niceDate(day.d)}: ${day.bills.map(b => `${b.name} ${money(b.amount || 0)}`).join(", ")} due. It's already set aside, so it won't touch your daily amount.`;
  if (day.d < c.t && day.kinds.includes("spent")) return `${niceDate(day.d)}: spent ${money(spentByDay(ctx)[day.d] || 0)}.`;
  if (day.kinds.includes("zero")) return `${niceDate(day.d)}: nothing spent. A no-spend day.`;
  return coming ? `${niceDate(day.d)}:` : `${niceDate(day.d)}: no bills due.`;
}

/** Money you've said is coming just once, from today on, that hasn't landed or been marked as not coming. It isn't counted until it lands. */
export function expected(ctx: Ctx) {
  const t = ctx.today;
  return ctx.state.incomes.filter(s => s.freq === "oneoff" && s.date && s.date >= t
    && !isReceived(ctx, s.id, s.date) && !ctx.state.skipped[ciKey(s.id, s.date)]).map(src => ({src, d: src.date!}));
}
export const expectedOn = (ctx: Ctx, d: IsoDate) => expected(ctx).filter(x => x.d === d);

/** Days up to `to` with money on its way: money you've said is coming (but `skip`, the one being edited) and your paydays still to land. */
export function moneyInDays(ctx: Ctx, to: IsoDate, skip?: string): Set<IsoDate> {
  const out = new Set(expected(ctx).filter(x => x.src.id !== skip).map(x => x.d));
  const src = mainIncome(ctx);
  if (src && src.freq !== "oneoff") for (const d of occurrences(src, ctx.today, to)) if (!isReceived(ctx, src.id, d)) out.add(d);
  return out;
}

/** `kind`: a bill going out, money you're expecting, or pay. */
export interface ComingRow { key: string; kind: "bill" | "in" | "pay"; d: IsoDate; name: string; meta: string; amt: string; good: boolean; incomeId?: string }

/** Money expected, as a row: tap it to change or remove it. */
export const expectedRow = (x: {src: Income; d: IsoDate}): ComingRow => ({
  key: ciKey(x.src.id, x.d), kind: "in", d: x.d, name: x.src.name, amt: `+${money(lowAmt(x.src))}`, good: true, incomeId: x.src.id,
  meta: `Expected${x.src.time ? ` around ${niceTime(x.src.time)}` : ""}`,
});

/** Bills and pay still to come this cycle, in date order. */

export function comingUp(ctx: Ctx, c: Calc) {
  const src = mainIncome(ctx);
  const list: ComingRow[] =
    c.billsDue.map(x => ({key: `${x.b.id}_${x.d}`, kind: "bill" as const, d: x.d, name: x.b.name, meta: `From ${billSource(x.b)}`, amt: `−${money(x.b.amount || 0)}`, good: false}));
  for (const x of expected(ctx)) list.push(expectedRow(x));
  if (src && c.payday) list.push({
    key: `pay_${c.payday}`, kind: "pay", d: c.payday, name: src.name, incomeId: src.id,
    meta: src.varies ? `Usually ${money(usualAmt(src))}` : "Payday",
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

/** All your money in one line: bills, everyday, savings (pots set aside, never spending money), then free. */
export function moneyBar(c: Calc, savings: number) {
  const [bills, everyday, free] = split(c).parts;
  return [bills, everyday, {key: "savings" as const, label: "Savings", amount: r2(Math.max(0, savings))}, free];
}

/** The "Free until payday" summary on the Month tab. */
export function freeSummary(c: Calc) {
  const free = r2(c.balance - c.billsLeft - c.everydayLeft);
  return free >= 0
    ? {free, lead: "Free until payday", sub: `After ${money(c.billsLeft)} of bills${c.everydayLeft ? ` and ${money(c.everydayLeft)} of everyday` : ""}. Spend it whenever suits you`}
    : {free, lead: "Still to cover before payday", sub: `You need ${money(-free)} more to cover your bills${c.everydayLeft ? " and everyday" : ""}. Money coming in covers it by itself.`};
}

/** One sentence under the bills list. */
export function billsLine(c: Calc) {
  if (!c.payday) return "";
  const before = r2(c.billsDue.reduce((s, x) => s + (x.b.amount || 0), 0)), undated = c.billsUndated;
  if (before && undated) return `${money(before)} is due before payday on ${niceDate(c.payday)}, plus ${money(undated)} for bills without a date. It's held back from your spending money.`;
  if (undated) return `${money(undated)} is held back for bills without a date. Add their dates to see when they go out.`;
  return before
    ? `${money(before)} is due before payday on ${niceDate(c.payday)}, so it's held back from your spending money.`
    : `Nothing is due before payday on ${niceDate(c.payday)}.`;
}
