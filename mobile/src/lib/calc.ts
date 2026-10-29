import {aside} from "./banks";
import {billDated, billDates, billMonthly, billPaid, billSource} from "./bills";
import {addDays, dayDiff, niceDate, niceTime, parseD} from "./dates";
import {ciKey, cycleStart, isReceived, latePay, lowAmt, mainIncome, nextPayday, occurrences, usualAmt} from "./income";
import {money, r2} from "./money";
import {perPayday} from "./pay";
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
  late: boolean;                   // the last payday passed with no pay: payday is a week away until it lands (PRD #4)
  daysLeft: number | null;
  billsLeft: number;               // bills still to go out before payday
  billsDue: {b: Bill; d: IsoDate}[];
  billsUndated: number;            // bills with no payment date yet: a month's share each, part of billsLeft
  billsAhead: Ahead[];             // bills after payday, a share held back each pay before them (PRD #28)
  billsAheadTotal: number;         // what's held for them so far, part of billsLeft
  everyday: EverydayLeft[];
  everydayLeft: number;            // what's left of everyday amounts this pay cycle
  cycleFrom: IsoDate;
  need: number;                    // bills + everyday: what has to be paid before payday
  short: number;                   // how much more that needs than you have
  savingLeft: number;              // this pay cycle's savings not moved yet
  savingHeld: number;              // the part of that held back: only what bills and everyday leave over
}

/** "Not this time" for a pay cycle's savings, keyed by when the cycle started (in `skipped`). */
export const saveKey = (cycleFrom: IsoDate) => `save_${cycleFrom}`;

/** Each pay cycle's share of what you chose to put away a month: a year's worth over a year of paydays. */
export function savingPerPay(ctx: Ctx) {
  const src = mainIncome(ctx), m = ctx.state.saving || 0;
  return src && m > 0 ? perPayday(m * 12, src.freq) : 0;
}

/** Money moved into savings from `from` to `to`, less any moved back out. */
export function savedNet(txs: Tx[], from: IsoDate, to: IsoDate) {
  return r2(txs.reduce((a, it) => it.date < from || it.date > to ? a
    : it.type === "save" ? a + it.amount : it.type === "income" && it.cat === "savings" ? a - it.amount : a, 0));
}

/** A bill after payday and what's held back for it so far. */
export interface Ahead { b: Bill; d: IsoDate; held: number }

/**
 * Bills after payday, held back a share at a time over the pays before them (PRD #28), as at the pay cycle from `from` to `payday`.
 * Each bill's next due date from payday on is shared over the pay cycles from the first one after it last went out (or the one it
 * was added in, or you started tracking in, if later) to the one it's due in: amount ÷ those pays, each. It's counted up as the pays
 * go by (2 pays in, 2 shares), so what was held last pay and is still in the balance isn't held twice, and the pay it's due in holds
 * it all, as before. Paid already: nothing. Monthly pay and a monthly bill hold nothing ahead, as one pay covers it.
 */
export function billsAhead(ctx: Ctx, from: IsoDate, payday: IsoDate): Ahead[] {
  const src = mainIncome(ctx);
  if (!src || src.freq === "oneoff") return [];
  const pays = (a: IsoDate, z: IsoDate) => a > z ? 0 : occurrences(src, a, z).length;
  const cycleOf = (d: IsoDate) => cycleStart({...ctx, today: d});
  const tracked = cycleOf(ctx.state.balanceAsOf || ctx.today);
  const out: Ahead[] = [];
  for (const b of ctx.state.bills) {
    if (!(b.amount > 0) || !billDated(b)) continue;
    const d = billDates(b, payday, addDays(payday, 400))[0];
    if (!d || billPaid(ctx, b, d)) continue;
    const prev = billDates(b, addDays(d, -400), addDays(d, -1)).pop();
    let first = b.since && b.since > tracked ? cycleOf(b.since) : tracked;
    const afterPrev = prev && occurrences(src, addDays(prev, 1), d)[0];
    if (afterPrev && afterPrev > first) first = afterPrev;
    if (from < first) continue;
    const n = 1 + pays(addDays(first, 1), d), k = Math.min(n, 1 + pays(addDays(first, 1), from));
    out.push({b, d, held: r2(b.amount * k / n)});
  }
  return out;
}
const aheadTotal = (xs: Ahead[]) => r2(xs.reduce((a, x) => a + x.held, 0));

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

  // late pay (PRD #4): when the last payday passed with no pay and the next one isn't due within a week, assume pay is a week away
  const next = state.incomes.length ? nextPayday(ctx) : null;
  const week = addDays(t, 7);
  const late = (!next || next > week) && latePay(ctx);
  const payday = late ? week : next;
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
  const billsAheadList = payday && state.bills.length ? billsAhead(ctx, cycleFrom, payday) : [];
  const billsAheadTotal = aheadTotal(billsAheadList);
  billsLeft = r2(billsLeft + billsUndated + billsAheadTotal);

  // everyday: what's left of each monthly amount since the last payday is kept aside, not counted as free
  const everyday = everydayOn(ctx, t);
  const everydayLeft = r2(everyday.reduce((s, e) => s + Math.max(0, e.left), 0));
  const need = r2(billsLeft + everydayLeft);
  const short = r2(Math.max(0, need - balance));   // bills and everyday come first; savings is the back-up

  // savings: this cycle's share is held back until it's moved (then it's left the balance, so it isn't taken twice),
  // and only out of what bills and everyday leave over: when a pay can't afford it, savings give way
  const savingLeft = state.skipped[saveKey(cycleFrom)] ? 0 : r2(Math.max(0, savingPerPay(ctx) - savedNet(txs, cycleFrom, t)));
  const savingHeld = r2(Math.min(savingLeft, Math.max(0, balance - need)));
  return {t, cur, spent, balance, payday, late, daysLeft, billsLeft, billsDue, billsUndated, billsAhead: billsAheadList, billsAheadTotal, everyday, everydayLeft, cycleFrom, need, short, savingLeft, savingHeld};
}

/** What's left of each everyday amount at the end of day `d`, in the pay cycle `d` falls in. Payments after `d` aren't counted,
 *  so a past day shows what was left then, and a day after payday starts full. */
export function everydayOn(ctx: Ctx, d: IsoDate): EverydayLeft[] {
  const spent = spendIn(ctx, cycleStart({...ctx, today: d}), d);
  return ctx.state.categories.filter(x => catGroup(x) === "everyday")
    .map(x => ({x, spent: r2(spent[x.id] || 0), left: r2((x.budget || 0) - (spent[x.id] || 0))}));
}

/** What was spent in each category from `from` to `to` (both included), refunds off, never below 0. Bill payments aren't counted. */
export function spendIn(ctx: Ctx, from: IsoDate, to: IsoDate): Record<string, number> {
  const spent: Record<string, number> = {};
  for (const it of ctx.txs) if (!it.billId && it.date >= from && it.date <= to) addSpend(spent, it);
  clampSpend(spent);
  return spent;
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
  // right now: after bills, what's left of your everyday amounts, and savings not moved yet
  const free = r2(c.balance - c.billsLeft - c.everydayLeft - c.savingHeld);
  const spentToday = r2(freeSpentByDay(ctx)[c.t] || 0);
  // today's amount is what was free at the start of today, shared over the days to payday: what you spend today comes off it
  // once (in `left`), not off the share as well. Money that arrives today still raises it. Rounded down, never below £0.
  const perDay = Math.max(0, Math.floor((free + spentToday) / c.daysLeft));
  // never below £0: without enough for bills and everyday it stops at £0, and the line under it says how deep the gap is
  const left = r2(Math.max(0, perDay - spentToday));
  // no "pace" judgement: spending big one day simply lowers the amount for the days after, and that's fine
  const reason = free < 0
    // how to close the gap, calmly: from savings first, then how much more is needed. Never "short"
    ? gapLine(ctx, c, -free)
    : !spentToday
      ? c.late ? "Pay hasn't arrived, so this lasts a week" : `Lasts you until payday, ${niceDate(c.payday)}`
      : spentToday <= perDay
        ? `${money(spentToday)} spent of today's ${money(perDay)}`
        : c.daysLeft > 1 ? `${money(spentToday)} spent today. From tomorrow, ${money(Math.floor(free / (c.daysLeft - 1)))} a day` : `${money(spentToday)} spent today. Payday is tomorrow`;
  return {kind: "number", perDay, left, free, spentToday, reason};
}

/** A gap split into what savings can cover (`move`) and what's still needed after that (`more`). */
export function closeGap(ctx: Ctx, gap: number) {
  const move = r2(Math.min(gap, Math.max(0, aside(ctx.state))));
  return {move, more: r2(gap - move)};
}

/**
 * When there isn't enough for bills and everyday (`gap` is how much more they need): how to close it, in one calm line.
 * Money in savings (pots set aside, never spending money) covers it first; what savings can't cover is said as how much more you need,
 * or for hourly pay with a take-home rate, as hours of work (rounded up).
 * `would`: for a payment you're only trying out ("What if I spend").
 */
export function gapLine(ctx: Ctx, c: Calc, gap: number, would = false): string {
  const {move, more} = closeGap(ctx, gap);
  const what = `your bills${c.everydayLeft ? " and everyday" : ""}`;
  const rate = mainIncome(ctx)?.rate;
  if (more && rate && rate > 0) {
    const n = Math.ceil(r2(more / rate)), hours = `${n} more hour${n === 1 ? "" : "s"} of work`;
    if (!move) return would ? `You'd need about ${hours} to cover it` : `About ${hours} covers ${what}`;
    return would ? `You'd need ${money(move)} from savings and about ${hours}` : `Move ${money(move)} from savings, and about ${hours} covers the rest`;
  }
  if (!move) return `You${would ? "'d" : ""} need ${money(gap)} more to cover ${what}`;
  if (!more) return would ? `You'd need to move ${money(move)} from savings to cover it` : `Move ${money(move)} from savings to cover what's coming`;
  return would ? `You'd need ${money(move)} from savings and ${money(more)} more` : `Move ${money(move)} from savings, then you need ${money(more)} more`;
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
  const w = walk(ctx, c, d);
  return w && {amount: w.amount, free: w.free};
}

/** The forecast's walk to day `d`, and what it passed on the way: the savings held for the pay cycle `d` falls in (`saved`), and the pay
 *  cycle `d` falls in (`from` its start, `payday` its end). */
function walk(ctx: Ctx, c: Calc, d: IsoDate) {
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
  let payday: IsoDate = c.payday, day = c.t, from = c.cycleFrom, saved = c.savingHeld, ahead = c.billsAheadTotal;
  const perPaySave = savingPerPay(ctx);
  for (;;) {
    day = addDays(day, 1);
    free = r2(free + incoming(day));
    if (day === payday) {
      // late pay: we can't know what happens once the assumed week is up, so no figure past it
      if (c.late) return null;
      const next = nextPayday({...ctx, today: addDays(payday, 1)});
      if (!next) return null;
      // bills after the new payday: only this pay's share more, as what was held for them already came out of free
      // (and a bill due this pay was partly held already, so it only takes the rest)
      const now = aheadTotal(billsAhead(ctx, payday, next));
      free = r2(free - setAside(payday, next) - now + ahead);
      ahead = now;
      // then that cycle's savings, out of what's left over
      const put = Math.min(perPaySave, Math.max(0, free));
      free = r2(free - put);
      saved = r2(put);
      from = payday;
      payday = next;
    }
    const share = Math.max(0, Math.floor(free / dayDiff(day, payday)));
    if (day === d) return {amount: share, free, saved, from, payday, ahead};
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
    // late pay: the assumed payday isn't a real one, so it isn't marked as pay
    if (d === c.payday && !c.late) { kinds.push("pay"); note = "Pay"; label += ", payday"; }
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
  // late pay: the check card asks about the real one, so don't show an assumed payday here
  if (src && c.payday && !c.late) list.push({
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
  const free = r2(Math.max(0, c.balance - bills - everyday - c.savingHeld));
  return {total: c.balance, parts: [
    {key: "bills" as const, label: "Bills", amount: bills},
    {key: "everyday" as const, label: "Everyday", amount: everyday},
    {key: "free" as const, label: "Free", amount: free},
  ], short: c.short};
}

/** What's left of this pay cycle, in one line: bills still to go out, everyday still to spend, this pay's savings still to put away,
 *  and what's free. Together they're your spending money (savings already in a pot aren't: they're not spending money). */
export function moneyBar(c: Calc): BarPart[] {
  const [bills, everyday, free] = split(c).parts;
  return [bills, everyday, {key: "savings", label: "Savings", amount: c.savingHeld}, free];
}
export interface BarPart { key: "bills" | "everyday" | "savings" | "free"; label: string; amount: number }

/** The engine as it stood at the end of a day gone: payments after it come back off (or back onto) the balance and out of the list. */
export function ctxAt(ctx: Ctx, c: Calc, d: IsoDate): Ctx {
  const after = ctx.txs.reduce((a, it) => it.date > d ? a + (it.type === "income" ? it.amount : -it.amount) : a, 0);
  return {
    state: {...ctx.state, balance: r2(c.balance - after), balanceSetAt: Number.MAX_SAFE_INTEGER},
    txs: ctx.txs.filter(it => it.date <= d), today: d,
  };
}

/**
 * The same bar on another day picked. A day gone: what was left of its pay cycle at the end of it, the engine run as of then (`ctxAt`).
 * A day to come: what would be left at the start of it if you spend each day's amount until then (as `forecast`): bills still to
 * go out that pay cycle, everyday spent at an even pace through it, that pay's savings, and what's free. Null when there's nothing to show.
 */
export function moneyBarOn(ctx: Ctx, c: Calc, d: IsoDate): BarPart[] | null {
  if (d === c.t) return moneyBar(c);
  if (d < c.t) {
    const then = calc(ctxAt(ctx, c, d));
    return then.daysLeft ? moneyBar(then) : null;
  }
  const w = walk(ctx, c, d);
  if (!w) return null;
  const now = w.payday === c.payday;
  const bills = w.ahead + (now
    ? c.billsDue.reduce((a, x) => x.d >= d ? a + (x.b.amount || 0) : a, 0) + c.billsUndated
    : ctx.state.bills.reduce((a, b) => !(b.amount > 0) ? a
      : !billDated(b) ? a + billMonthly(b) : a + billDates(b, d, addDays(w.payday, -1)).length * b.amount, 0));
  const left = dayDiff(d, w.payday);
  const everyday = now
    ? c.everydayLeft * left / dayDiff(c.t, w.payday)
    : ctx.state.categories.reduce((a, x) => catGroup(x) === "everyday" ? a + (x.budget || 0) : a, 0) * left / dayDiff(w.from, w.payday);
  return [
    {key: "bills", label: "Bills", amount: r2(bills)},
    {key: "everyday", label: "Everyday", amount: r2(everyday)},
    {key: "savings", label: "Savings", amount: w.saved},
    {key: "free", label: "Free", amount: r2(Math.max(0, w.free))},
  ];
}

/** The "Free until payday" summary on the Month tab. */
export function freeSummary(c: Calc) {
  const free = r2(c.balance - c.billsLeft - c.everydayLeft - c.savingHeld);
  const after = [`${money(c.billsLeft)} of bills`, c.everydayLeft ? `${money(c.everydayLeft)} of everyday` : "", c.savingHeld ? `${money(c.savingHeld)} for savings` : ""].filter(Boolean);
  return free >= 0
    ? {free, lead: "Free until payday", sub: `After ${after.length > 1 ? `${after.slice(0, -1).join(", ")} and ${after[after.length - 1]}` : after[0]}. Spend it whenever suits you`}
    : {free, lead: "Still to cover before payday", sub: `You need ${money(-free)} more to cover your bills${c.everydayLeft ? " and everyday" : ""}. Money coming in covers it by itself.`};
}

/** One sentence under the bills list. */
export function billsLine(c: Calc) {
  if (!c.payday) return "";
  const before = r2(c.billsDue.reduce((s, x) => s + (x.b.amount || 0), 0)), undated = c.billsUndated;
  // bills after payday: saved up a bit each pay, so it's all there in time
  const what = aheadWhat(c), plus = what ? ` ${money(c.billsAheadTotal)} is saved up for ${what}, a bit each pay so it's ready in time.` : "";
  if (before && undated) return `${money(before)} is due before payday on ${niceDate(c.payday)}, plus ${money(undated)} for bills without a date. It's held back from your spending money.${plus}`;
  if (undated) return `${money(undated)} is held back for bills without a date. Add their dates to see when they go out.${plus}`;
  if (!before && what) return `Nothing is due before payday on ${niceDate(c.payday)}.${plus}`;
  return before
    ? `${money(before)} is due before payday on ${niceDate(c.payday)}, so it's held back from your spending money.${plus}`
    : `Nothing is due before payday on ${niceDate(c.payday)}.`;
}

/** Which bills after payday something's held for so far: "Rent on Mon 26 Oct", or "2 bills after payday". Empty when there's none. */
export function aheadWhat(c: Calc) {
  const xs = c.billsAhead.filter(x => x.held > 0);
  return !xs.length ? "" : xs.length === 1 ? `${xs[0].b.name} on ${niceDate(xs[0].d)}` : `${xs.length} bills after payday`;
}
