import {addDays, isoD, lastOfMonth, parseD, workingBefore} from "./dates";
import type {Ctx, Income, IncomeFreq, IsoDate} from "./types";

export const FREQ: Record<IncomeFreq, string> = {
  "monthly-lastworking": "Monthly, last working day", "monthly-date": "Monthly on a date", "monthly-lastfri": "Monthly, last Friday",
  fourweekly: "Every 4 weeks", fortnightly: "Every 2 weeks", weekly: "Every week", oneoff: "Just once",
};

/** Every date this income lands between from and to (inclusive), moved earlier off weekends and bank holidays. */
export function occurrences(src: Income, from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [], F = parseD(from), T = parseD(to);
  if (src.freq === "oneoff") { if (src.date && src.date >= from && src.date <= to) out.push(src.date); return out; }
  const step = ({weekly: 7, fortnightly: 14, fourweekly: 28} as Record<string, number>)[src.freq];
  if (step) {
    if (!src.date) return out;
    const a = parseD(src.date);
    const n = Math.floor((+F - +a) / 864e5 / step) - 1;
    for (let i = n; i < n + 400; i++) {
      const d = new Date(a); d.setDate(d.getDate() + i * step);
      const adj = workingBefore(d);
      if (adj > T) break;
      if (adj >= F) out.push(isoD(adj));
    }
    return out;
  }
  for (let i = -1; i < 40; i++) {
    const base = new Date(F.getFullYear(), F.getMonth() + i, 1);
    const last = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    let d: Date;
    if (src.freq === "monthly-lastworking") d = last;
    else if (src.freq === "monthly-lastfri") { d = new Date(last); while (d.getDay() !== 5) d.setDate(d.getDate() - 1); }
    else d = new Date(base.getFullYear(), base.getMonth(), Math.min(src.day || 1, last.getDate()));
    const adj = workingBefore(d);
    if (adj > T) break;
    if (adj >= F) out.push(isoD(adj));
  }
  return out;
}

/** The forecast only counts the lowest amount, so a good month is a bonus rather than a shortfall. */
export const lowAmt = (s: Income) => s.varies ? (s.low || 0) : (s.amount || 0);
export const usualAmt = (s: Income) => s.varies ? (s.typical || s.low || 0) : (s.amount || 0);
export const ciKey = (id: string, d: IsoDate) => `${id}_${d}`;

export const isReceived = (ctx: Ctx, srcId: string, d: IsoDate) => ctx.txs.some(it => it.srcId === srcId && it.forDate === d);

/** The main income, or the first regular one: it sets the pay cycle. */
export const mainIncome = (ctx: Ctx) => ctx.state.incomes.find(s => s.main) || ctx.state.incomes.find(s => s.freq !== "oneoff") || null;

/** Paydays in the last 40 days that haven't been confirmed, skipped, or snoozed today. Money only counts once it arrives. */
export function pendingCheckins(ctx: Ctx) {
  const t = ctx.today, res: {src: Income; date: IsoDate; key: string}[] = [];
  const {skipped, snoozed} = ctx.state;
  for (const s of ctx.state.incomes) for (const d of occurrences(s, addDays(t, -40), t)) {
    if (s.since && d < s.since) continue;
    const k = ciKey(s.id, d);
    if (skipped[k] || snoozed[k] === t || isReceived(ctx, s.id, d)) continue;
    res.push({src: s, date: d, key: k});
  }
  return res.sort((a, b) => a.date.localeCompare(b.date));
}

/** The next payday that hasn't landed yet, from the main income (or every regular one when none is main). */
export function nextPayday(ctx: Ctx): IsoDate | null {
  const list = ctx.state.incomes.filter(s => s.freq !== "oneoff");
  if (!list.length) return null;
  const mains = list.filter(s => s.main);
  const use = mains.length ? mains : list, t = ctx.today;
  let best: IsoDate | null = null;
  for (const s of use) for (const d of occurrences(s, t, addDays(t, 70))) {
    if (isReceived(ctx, s.id, d) || ctx.state.skipped[ciKey(s.id, d)]) continue;
    if (!best || d < best) best = d;
    break;
  }
  return best;
}

/** The last payday on or before today: where this pay cycle started. */
export function cycleStart(ctx: Ctx): IsoDate {
  const src = mainIncome(ctx), t = ctx.today;
  if (!src) return t;
  const past = occurrences(src, addDays(t, -45), t);
  return past.length ? past[past.length - 1] : t;
}

export function incomeForMonth(ctx: Ctx, k: string) {
  const from = k + "-01", to = lastOfMonth(k);
  return ctx.state.incomes.reduce((sum, s) => sum + occurrences(s, from, to).length * lowAmt(s), 0);
}
