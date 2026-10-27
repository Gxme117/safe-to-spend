import {aheadWhat, calc, forecast, gapLine, hero, type Calc, type Hero} from "./calc";
import {addDays} from "./dates";
import {money, r2} from "./money";
import type {Ctx, Tx} from "./types";

/** One line of the breakdown. `total`: a result line (drawn heavier). */
export interface BreakdownRow { label: string; note?: string; amount: number; total?: boolean }

/**
 * Where today's number comes from, as lines that add up: what's free until payday (`now`), then today's share of it (`today`).
 * The sheet draws these and works nothing out itself. Null without a daily number.
 */
export function todayBreakdown(ctx: Ctx, c: Calc): {now: BreakdownRow[]; today: BreakdownRow[]} | null {
  const h = hero(ctx, c);
  if (h.kind !== "number" || !c.daysLeft) return null;
  const n = c.billsDue.length, ahead = aheadWhat(c);
  const billsNote = [n ? `${n} bill${n > 1 ? "s" : ""}` : "", c.billsUndated ? "a month's share of the ones without a date" : "",
    ahead && `a bit saved up for ${ahead}`].filter(Boolean).join(", plus ");
  const now: BreakdownRow[] = [
    {label: "Spending money", amount: c.balance},
    ...c.billsLeft ? [{label: "Bills before payday", note: billsNote, amount: -c.billsLeft}] : [],
    ...c.everydayLeft ? [{label: "Everyday still to spend", amount: -c.everydayLeft}] : [],
    ...c.savingHeld ? [{label: "Savings to put away", note: "This pay, until it's moved", amount: -c.savingHeld}] : [],
    {label: h.free < 0 ? "Still to cover" : "Free until payday", amount: h.free, total: true},
  ];
  const days = `${c.daysLeft} day${c.daysLeft > 1 ? "s" : ""}`;
  if (h.free < 0) return {now, today: [{label: "Shared over the days to payday", note: days, amount: h.left, total: true}]};
  const start = r2(h.free + h.spentToday);
  const today: BreakdownRow[] = h.spentToday
    ? [
      {label: "Free at the start of today", amount: start},
      {label: "Today's amount", note: `${money(start)} over ${days}, rounded down`, amount: h.perDay, total: true},
      {label: "Spent today", amount: -h.spentToday},
      {label: "Left today", amount: h.left, total: true},
    ]
    : [{label: "Today's amount", note: `${money(start)} over ${days}, rounded down`, amount: h.perDay, total: true}];
  return {now, today};
}

/**
 * What spending `amount` today would do, in one sentence. Worked out by the real engine on a copy with that payment added,
 * so it's always what the Day tab would show if you bought it. Null without a daily number.
 */
export function whatIf(ctx: Ctx, amount: number): {line: string; hero: Extract<Hero, {kind: "number"}>} | null {
  const c = calc(ctx), h = hero(ctx, c);
  if (h.kind !== "number" || !c.daysLeft) return null;
  const buy: Tx = {id: "what-if", type: "expense", amount: r2(Math.max(0, amount)), cat: "", note: "", date: ctx.today, created: Number.MAX_SAFE_INTEGER};
  const ctx2 = {...ctx, txs: [...ctx.txs, buy]}, c2 = calc(ctx2), h2 = hero(ctx2, c2);
  if (h2.kind !== "number") return null;
  if (h2.free < 0) return {hero: h2, line: gapLine(ctx2, c2, -h2.free, true)};
  if (h2.spentToday <= h2.perDay) return {hero: h2, line: `Today's ${money(h2.perDay)} covers it. ${money(h2.left)} left today`};
  if (c.daysLeft < 2) return {hero: h2, line: `It fits. Payday is tomorrow`};
  const after = Math.floor(h2.free / (c.daysLeft - 1)), before = Math.floor(h.free / (c.daysLeft - 1));
  return {hero: h2, line: `Then it's ${money(after)} a day from tomorrow${after < before ? `, instead of ${money(before)}` : ""}`};
}

/**
 * Today's amount all used ("State · £0 today"): said calmly, and when it comes back. `lead` is drawn in ink, `rest` muted:
 * "You've used today's £18." "Tomorrow starts fresh at £17." Tomorrow's is the forecast, so it's what tomorrow on the pay cycle shows.
 * Null unless there's a number today, it's spent, and there's enough for bills and everyday (that line says how deep the gap is).
 */
export function usedUp(ctx: Ctx, c: Calc, h: Hero): {lead: string; rest: string} | null {
  if (h.kind !== "number" || h.free < 0 || !h.perDay || h.left > 0 || c.daysLeft == null) return null;
  const lead = `You've used today's ${money(h.perDay)}.`;
  if (c.daysLeft < 2) return {lead, rest: "Payday's tomorrow."};
  const next = forecast(ctx, c, addDays(c.t, 1));
  return next ? {lead, rest: `Tomorrow starts fresh at ${money(next.amount)}.`} : null;
}
