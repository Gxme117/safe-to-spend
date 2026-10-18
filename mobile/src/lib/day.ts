import {calendar, comingUp, dayFigure, everydayOn, forecast, hero, payCycle, tomorrowLine, type Calc, type ComingRow, type EverydayLeft, type Hero} from "./calc";
import {addDays, niceDate, parseD, shortDate} from "./dates";
import {money, newestFirst, r2} from "./money";
import type {Ctx, IsoDate, Tx} from "./types";

/** The big card: today's number (or why there isn't one yet), or another day's figure. */
export type DayFigure = Hero | ({kind: "day"} & ReturnType<typeof dayFigure>);

/** Everything one day shows, all of it for that date. The Day tab draws a day from this and nothing else. */
export interface DayView {
  d: IsoDate;
  when: "past" | "today" | "future";
  figure: DayFigure;
  payments: Tx[];            // what went out and came in that day, newest first (none for days still to come)
  due: ComingRow[];          // bills going out and money coming in that day (today and later)
  later: ComingRow[];        // today only: bills going out before payday, money you're expecting and your next pay, on later days, soonest first
  tomorrow: string | null;   // today only: what today does to tomorrow
  everyday: EverydayLeft[];  // what's left of each everyday amount at the end of that day
}

/**
 * What's still to come, by day: bills going out, money you're expecting, and pay. Days and the week both read this,
 * so a dot in the week always means that day lists it. Today leaves pay out: the payday check asks about it.
 */
export function dueByDay(ctx: Ctx, c: Calc): Record<IsoDate, ComingRow[]> {
  const out: Record<IsoDate, ComingRow[]> = {};
  for (const x of comingUp(ctx, c)) if (!(x.kind === "pay" && x.d === c.t)) (out[x.d] = out[x.d] || []).push(x);
  return out;
}

export function dayView(ctx: Ctx, c: Calc, d: IsoDate, due = dueByDay(ctx, c)): DayView {
  const when = d < c.t ? "past" : d === c.t ? "today" : "future";
  const h = when === "today" ? hero(ctx, c) : null;
  return {
    d, when,
    figure: h ?? {kind: "day", ...dayFigure(ctx, c, d)},
    payments: when === "future" ? [] : ctx.txs.filter(it => it.date === d).sort(newestFirst),
    due: due[d] || [],
    later: h ? comingUp(ctx, c).filter(x => x.d > d) : [],
    tomorrow: h ? tomorrowLine(c, h) : null,
    everyday: everydayOn(ctx, d),
  };
}

export interface DayMark { d: IsoDate; bills: boolean; incoming: boolean }

/** Monday to Sunday of the week `d` is in. A day is marked when its view lists a bill going out, or money coming in (pay included). */
export function weekMarks(ctx: Ctx, c: Calc, d: IsoDate, due = dueByDay(ctx, c)): DayMark[] {
  const monday = addDays(d, -((parseD(d).getDay() + 6) % 7));
  return Array.from({length: 7}, (_, i) => {
    const x = addDays(monday, i), rows = due[x] || [];
    return {d: x, bills: rows.some(r => r.kind === "bill"), incoming: rows.some(r => r.kind !== "bill")};
  });
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * What you could spend from now to Sunday: what's left of today's amount, plus each later day's Safe to Spend (the same figures
 * those days show). It stops the day before payday, so pay that hasn't arrived is never counted.
 * Null without a daily number, when there isn't enough for bills and everyday (the card says how deep that is), or when today is the last day it covers.
 */
export function weekLeft(ctx: Ctx, c: Calc): {amount: number; line: string} | null {
  const h = hero(ctx, c);
  if (h.kind !== "number" || h.free < 0 || !c.payday) return null;
  const sunday = addDays(c.t, (7 - parseD(c.t).getDay()) % 7), beforePay = addDays(c.payday, -1);
  const through = sunday < beforePay ? sunday : beforePay;
  if (through <= c.t) return null;
  let amount = h.left;
  for (let d = addDays(c.t, 1); d <= through; d = addDays(d, 1)) amount += Math.max(0, forecast(ctx, c, d)?.amount ?? 0);
  amount = r2(amount);
  return {amount, line: through === sunday
    ? `${money(amount)} to spend from now to Sunday`
    : `${money(amount)} to spend before payday on ${DAY_NAMES[parseD(c.payday).getDay()]}`};
}

/** One day on the runway: its figure (what you spent on a day gone, what's left of today, Safe to Spend on a day to come; null when there's no number to show). */
export interface RunwayDay extends DayMark { when: DayView["when"]; amount: number | null; payday: boolean }

/**
 * A few days behind today, then on to payday (at least a week ahead, never more than five): each with the figure its own day shows.
 * The days come from the same views as the Day tab, so a figure here is always what that day says.
 */
export function runway(ctx: Ctx, c: Calc, due = dueByDay(ctx, c), back = 3): RunwayDay[] {
  const week = addDays(c.t, 6), cap = addDays(c.t, 35);
  const end = c.payday && c.payday > week ? (c.payday < cap ? c.payday : cap) : week;
  const h = hero(ctx, c), out: RunwayDay[] = [];
  for (let d = addDays(c.t, -back); d <= end; d = addDays(d, 1)) {
    const when = d < c.t ? "past" : d === c.t ? "today" : "future", rows = due[d] || [];
    const amount = when === "past" ? dayFigure(ctx, c, d).amount
      : when === "today" ? (h.kind === "number" ? h.left : null)
      : forecast(ctx, c, d)?.amount ?? null;
    out.push({d, when, amount, payday: d === c.payday, bills: rows.some(r => r.kind === "bill"), incoming: rows.some(r => r.kind !== "bill")});
  }
  return out;
}

/** One day in the pay-cycle grid: gone, today or to come; a bill still to go out that day; payday. */
export interface CycleDay { d: IsoDate; n: number; when: DayView["when"]; bill: boolean; payday: boolean }

/**
 * The pay cycle as a grid, last payday to the next, with the line above it: "30 Sep – 30 Oct" and "17 days to payday".
 * `weeks` are rows of 7, Monday first, with blanks (null) before the first day and after the last, so every row lines up.
 * Bills are marked on the days still to come, so one that's gone out isn't marked.
 * `said` is the whole grid in one sentence, so a screen reader hears it once rather than stopping on every day.
 * Null without a payday to count down to (or on payday itself, which the payday check covers).
 */
export function cycleDays(ctx: Ctx, c: Calc): {range: string; toPayday: string; weeks: (CycleDay | null)[][]; days: CycleDay[]; said: string} | null {
  if (!c.payday || !c.daysLeft || c.daysLeft < 0) return null;
  const {lead, days: cal} = calendar(ctx, c), {total, dayNo} = payCycle(ctx, c);
  if (!cal.length) return null;
  const days = cal.map((x): CycleDay => ({
    d: x.d, n: x.n, when: x.d < c.t ? "past" : x.d === c.t ? "today" : "future",
    bill: x.kinds.includes("bill"), payday: x.kinds.includes("pay"),
  }));
  const cells: (CycleDay | null)[] = [...Array<null>(lead).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({length: cells.length / 7}, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const range = `${shortDate(cal[0].d)} – ${shortDate(c.payday)}`;
  const toPayday = c.daysLeft === 1 ? "Payday tomorrow" : `${c.daysLeft} days to payday`;
  const bills = days.filter(x => x.bill).map(x => niceDate(x.d));
  const billsSaid = !bills.length ? "" : ` Bills due ${bills.length > 1 ? `${bills.slice(0, -1).join(", ")} and ${bills[bills.length - 1]}` : bills[0]}.`;
  return {range, toPayday, weeks, days, said: `Pay cycle, ${range}, day ${dayNo} of ${total}.${billsSaid} Payday ${niceDate(c.payday)}.`};
}
