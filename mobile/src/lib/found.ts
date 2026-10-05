// What Monzo already knows, for setup to fill in: your pay and when it lands. Pure: it reads the payments setup fetched.
// Everything here is a suggestion you confirm, so anything unclear is left out rather than guessed.
import {addDays, dayDiff, isoD, ord, parseD, workingBefore} from "./dates";
import {occurrences} from "./income";
import {lastPay, payee, plain, type RawTx, type SeenPay} from "./monzo";
import {r2} from "./money";
import type {Income, IncomeFreq, IsoDate} from "./types";

const when = (t: RawTx): IsoDate => isoD(new Date(t.created));
// real money that moved: not declined, not a move between your own pots
const moved = (t: RawTx) => !!t?.id && !!t.created && !t.decline_reason && !!t.amount
  && !String(t.description || "").startsWith("pot_") && t.category !== "savings" && t.scheme !== "uk_retail_pot";
const byPayee = (raw: RawTx[]) => {
  const groups = new Map<string, RawTx[]>();
  // "ACME SALARY 0925" and "ACME SALARY 1025" are the same payer
  for (const t of raw) { const k = plain(payee(t)) || payee(t).toLowerCase(); groups.set(k, [...(groups.get(k) || []), t]); }
  return [...groups.values()].map(list => list.sort((a, b) => a.created.localeCompare(b.created)));
};
/** Your pay as Monzo saw it, with every date it landed. */
export type FoundPay = SeenPay & {dates: IsoDate[]};

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * Pay is money in that Monzo files as income and repeats: the payer who's paid you most, more than once, lately,
 * counting only pay-sized payments (expenses paid back by the same employer aren't paydays).
 * Nobody repeats by name: the biggest income in the last 35 days, with any others about its size (a reference that names
 * itself differently every month). Nothing filed as income: no guess.
 */
export function findPay(raw: RawTx[], today: IsoDate): FoundPay | null {
  const income = raw.filter(t => moved(t) && t.amount > 0 && t.category === "income");
  let best: RawTx[] | null = null, top = 0;
  for (const list of byPayee(income)) {
    const mid = median(list.map(t => t.amount)), pays = list.filter(t => t.amount >= mid / 2);
    const sum = pays.reduce((a, t) => a + t.amount, 0);
    if (pays.length >= 2 && dayDiff(when(pays[pays.length - 1]), today) <= 40 && sum > top) { best = pays; top = sum; }
  }
  if (!best) {
    const one = lastPay(income.filter(t => dayDiff(when(t), today) <= 35));
    if (!one) return null;
    const like = income.filter(t => Math.abs(t.amount / 100 - one.amount) <= one.amount * 0.15);
    return {...one, dates: [...new Set([...like.map(when), one.date])].sort()};
  }
  const t = best[best.length - 1];
  return {amount: r2(t.amount / 100), from: payee(t), date: when(t), dates: [...new Set(best.map(when))]};
}

/**
 * How often you're paid, as setup's payday question asks it, and the next payday. `n`: how many pays it's based on;
 * `near`: some landed a day or so off the rule, so the reason says "around".
 */
export interface PayRule { freq: IncomeFreq; day?: number; date: IsoDate; n: number; near?: boolean }

// How far a pay can land from its rule and still count: a bank holiday we don't know, or a transfer that came a day late.
const SLACK = 3;

/**
 * The pay rule that best fits the pays seen, tried through the same `occurrences` the app forecasts with
 * (so pay moving earlier off weekends is already handled). A rule fits when every payday it expects has a pay within
 * a few days (so "every week" can't explain monthly pay) and it explains every pay but at most one (a bonus).
 * The best fit explains the most pays, then lands closest. Fewer than 2 pays, or nothing fits: no guess.
 */
export function payRule(dates: IsoDate[], today: IsoDate): PayRule | null {
  const ds = [...new Set(dates)].sort();
  if (ds.length < 2) return null;
  const first = ds[0], last = ds[ds.length - 1];
  // days of the month seen, the most usual first (one late pay doesn't move it), then the later (pay moves earlier, never later)
  const seen = ds.map(d => parseD(d).getDate()), count = (n: number) => seen.filter(x => x === n).length;
  const days = [...new Set(seen)].sort((a, b) => count(b) - count(a) || b - a);
  const tries: Pick<Income, "freq" | "day" | "date">[] = [
    {freq: "monthly-lastworking"}, {freq: "monthly-lastfri"}, ...days.map(day => ({freq: "monthly-date" as const, day})),
    {freq: "fourweekly", date: last}, {freq: "fortnightly", date: last}, {freq: "weekly", date: last},
  ];
  const src = (t: Pick<Income, "freq" | "day" | "date">) => ({id: "", name: "", type: "work", varies: false, ...t}) as Income;
  const gap = (a: IsoDate, list: IsoDate[]) => Math.min(...list.map(b => Math.abs(dayDiff(a, b))));
  let best: {t: Pick<Income, "freq" | "day" | "date">; n: number; off: number} | null = null;
  for (const t of tries) {
    const want = occurrences(src(t), addDays(first, -SLACK), addDays(last, SLACK));
    if (!want.length || want.some(w => gap(w, ds) > SLACK)) continue;   // a payday with no pay near it
    const hits = ds.filter(d => gap(d, want) <= SLACK);
    if (hits.length < Math.max(2, ds.length - 1)) continue;
    const off = hits.reduce((a, d) => a + gap(d, want), 0);
    if (!best || hits.length > best.n || (hits.length === best.n && off < best.off)) best = {t, n: hits.length, off};
  }
  if (!best) return null;
  return {freq: best.t.freq, ...(best.t.day ? {day: best.t.day} : {}), date: nextDate(src(best.t), today), n: best.n, ...(best.off ? {near: true} : {})};
}

// The next payday, as setup's date box wants it. For "monthly on a date" that's the date itself (its day sets the rule), not the working day before.
function nextDate(src: Income, today: IsoDate): IsoDate {
  if (src.freq === "monthly-date") {
    const T = parseD(today);
    for (let i = 0; i < 3; i++) {
      const last = new Date(T.getFullYear(), T.getMonth() + i + 1, 0).getDate();
      const d = new Date(T.getFullYear(), T.getMonth() + i, Math.min(src.day || 1, last));
      if (isoD(workingBefore(d)) >= today) return isoD(d);
    }
  }
  return occurrences(src, today, addDays(today, 70))[0] ?? today;
}

/** "Your last 3 pays came on the last working day." One line, saying why payday is already picked. */
export function payRuleText(r: PayRule) {
  const on = r.near ? "around" : "on", apart = r.near ? "about " : "";
  const how: Record<IncomeFreq, string> = {
    "monthly-lastworking": `${on} the last working day`, "monthly-lastfri": `${on} the last Friday`, "monthly-date": `${on} the ${ord(r.day || 1)}`,
    fourweekly: `${apart}4 weeks apart`, fortnightly: `${apart}2 weeks apart`, weekly: `${apart}a week apart`, oneoff: "",
  };
  return `Your last ${r.n} pays came ${how[r.freq]}.`;
}

/** Everything setup can fill in from the payments it read when you connected. */
export interface SetupFound { pay: SeenPay | null; rule: PayRule | null }

export function findAll(raw: RawTx[], today: IsoDate): SetupFound {
  const pay = findPay(raw, today);
  return {pay: pay && {amount: pay.amount, from: pay.from, date: pay.date}, rule: pay ? payRule(pay.dates, today) : null};
}
