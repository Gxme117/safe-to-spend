// What Monzo already knows, for setup to fill in: your pay and when it lands, your regular payments, and what you
// usually spend. Pure: it reads the payments setup fetched.
// Everything here is a suggestion you confirm, so anything unclear is left out rather than guessed.
import {billDates} from "./bills";
import {addDays, dayDiff, isoD, ord, parseD, workingBefore} from "./dates";
import {EVERYDAY} from "./everyday";
import {occurrences} from "./income";
import {lastPay, payee, plain, type RawTx, type SeenPay} from "./monzo";
import {r2} from "./money";
import type {Bill, BillFreq, BillMethod, Income, IncomeFreq, IsoDate} from "./types";

const when = (t: RawTx): IsoDate => isoD(new Date(t.created));
// real money that moved: not declined, not a move between your own pots
const moved = (t: RawTx) => !!t?.id && !!t.created && !t.decline_reason && !!t.amount
  && !String(t.description || "").startsWith("pot_") && t.category !== "savings" && t.scheme !== "uk_retail_pot";
// "ACME SALARY 0925" and "ACME SALARY 1025" are the same payer
const payeeKey = (t: RawTx) => plain(payee(t)) || payee(t).toLowerCase();
const byPayee = (raw: RawTx[]) => {
  const groups = new Map<string, RawTx[]>();
  for (const t of raw) { const k = payeeKey(t); groups.set(k, [...(groups.get(k) || []), t]); }
  return [...groups.values()].map(list => list.sort((a, b) => a.created.localeCompare(b.created)));
};
// paid by card (a shop, or cash from a machine), as opposed to a direct debit or a bank transfer
const byCard = (t: RawTx) => t.scheme === "mastercard" || !!t.merchant;
/** Your pay as Monzo saw it, with every date it landed. */
export type FoundPay = SeenPay & {dates: IsoDate[]};

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * Everyone who pays you like pay, best first: money in that Monzo files as income and repeats lately, counting only
 * pay-sized payments (expenses paid back by the same employer aren't paydays). The one who's paid you most comes first.
 * Nobody repeats by name: the biggest income in the last 35 days, with any others about its size (a reference that names
 * itself differently every month). Nothing filed as income: nothing.
 */
export function findPays(raw: RawTx[], today: IsoDate): FoundPay[] {
  const income = raw.filter(t => moved(t) && t.amount > 0 && t.category === "income");
  const seen: {pays: RawTx[]; sum: number}[] = [];
  for (const list of byPayee(income)) {
    const mid = median(list.map(t => t.amount)), pays = list.filter(t => t.amount >= mid / 2);
    const sum = pays.reduce((a, t) => a + t.amount, 0);
    if (pays.length >= 2 && dayDiff(when(pays[pays.length - 1]), today) <= 40) seen.push({pays, sum});
  }
  if (!seen.length) {
    const one = lastPay(income.filter(t => dayDiff(when(t), today) <= 35));
    if (!one) return [];
    const like = income.filter(t => Math.abs(t.amount / 100 - one.amount) <= one.amount * 0.15);
    return [{...one, dates: [...new Set([...like.map(when), one.date])].sort()}];
  }
  return seen.sort((a, b) => b.sum - a.sum).map(({pays}) => {
    const t = pays[pays.length - 1];
    return {amount: r2(t.amount / 100), from: payee(t), date: when(t), dates: [...new Set(pays.map(when))]};
  });
}

/** Your pay: the payer who's paid you most, more than once, lately. */
export const findPay = (raw: RawTx[], today: IsoDate): FoundPay | null => findPays(raw, today)[0] ?? null;

/**
 * How often you're paid, as setup's payday question asks it, and the next payday. `n`: how many pays it's based on;
 * `near`: some landed a day or so off the rule, so the reason says "around".
 */
export interface PayRule { freq: IncomeFreq; day?: number; date: IsoDate; n: number; near?: boolean }

// How far a payment can land from its rule and still count: a bank holiday we don't know, or a transfer that came a day late.
const SLACK = 3;

/**
 * The rule that best fits the dates seen, out of `tries`, each one's dates worked out by `expect`.
 * A rule fits when every date it expects has a payment within a few days (so "every week" can't explain monthly pay)
 * and it explains every payment but at most one (a bonus, a one-off). The best fit explains the most, then lands closest.
 * Fewer than 2 dates, or nothing fits: null.
 */
function fit<R>(dates: IsoDate[], tries: R[], expect: (t: R, from: IsoDate, to: IsoDate) => IsoDate[]): {t: R; n: number; off: number} | null {
  const ds = [...new Set(dates)].sort();
  if (ds.length < 2) return null;
  const first = ds[0], last = ds[ds.length - 1];
  const gap = (a: IsoDate, list: IsoDate[]) => Math.min(...list.map(b => Math.abs(dayDiff(a, b))));
  let best: {t: R; n: number; off: number} | null = null;
  for (const t of tries) {
    const want = expect(t, addDays(first, -SLACK), addDays(last, SLACK));
    if (!want.length || want.some(w => gap(w, ds) > SLACK)) continue;   // a date with nothing near it
    const hits = ds.filter(d => gap(d, want) <= SLACK);
    if (hits.length < Math.max(2, ds.length - 1)) continue;
    const off = hits.reduce((a, d) => a + gap(d, want), 0);
    if (!best || hits.length > best.n || (hits.length === best.n && off < best.off)) best = {t, n: hits.length, off};
  }
  return best;
}

// The days of the month seen, the most usual first (one late payment doesn't move it), then `order` breaks ties.
const daysSeen = (dates: IsoDate[], order: 1 | -1) => {
  const seen = [...new Set(dates)].map(d => parseD(d).getDate()), count = (n: number) => seen.filter(x => x === n).length;
  return [...new Set(seen)].sort((a, b) => count(b) - count(a) || order * (a - b));
};

/**
 * The pay rule that best fits the pays seen, tried through the same `occurrences` the app forecasts with
 * (so pay moving earlier off weekends is already handled). Fewer than 2 pays, or nothing fits: no guess.
 */
export function payRule(dates: IsoDate[], today: IsoDate): PayRule | null {
  const ds = [...new Set(dates)].sort(), last = ds[ds.length - 1];
  type Try = Pick<Income, "freq" | "day" | "date">;
  // pay moves earlier, never later: a tie goes to the later day
  const tries: Try[] = [
    {freq: "monthly-lastworking"}, {freq: "monthly-lastfri"}, ...daysSeen(ds, -1).map(day => ({freq: "monthly-date" as const, day})),
    {freq: "fourweekly", date: last}, {freq: "fortnightly", date: last}, {freq: "weekly", date: last},
  ];
  const src = (t: Try) => ({id: "", name: "", type: "work", varies: false, ...t}) as Income;
  const best = fit(ds, tries, (t, from, to) => occurrences(src(t), from, to));
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

/**
 * A payment that goes out regularly, as Monzo saw it: a suggestion for setup's bills, never a bill until you keep it.
 * `name` is who it's paid to, as the bank names them (never guessed into "Electricity"); `amount` the latest one
 * (bills change, the latest is the price now); `varies` when they differed; `n` how many were seen.
 * Monthly ones have `day`; the rest a `date` it next goes out.
 */
export interface FoundBill { name: string; payee: string; amount: number; varies: boolean; freq: BillFreq; day?: number; date?: IsoDate; method: BillMethod; n: number }

// food and drink is everyday spending, however regular
const FOOD = new Set(["groceries", "eating_out"]);
const STEP: Partial<Record<BillFreq, number>> = {weekly: 7, fortnightly: 14, fourweekly: 28};
const PERIOD: Partial<Record<BillFreq, number>> = {monthly: 31, ...STEP};

// "THAMES WATER" → "Thames Water", "TV LICENCE" → "TV Licence": short words stay as they are, unless they're small words
const SMALL = new Set(["of", "to", "at", "by", "in", "on", "and"]);
const nice = (s: string) => s !== s.toUpperCase() || !/[A-Z]/.test(s) ? s
  : s.split(" ").map(w => SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w.length <= 2 ? w : w[0] + w.slice(1).toLowerCase()).join(" ");

/**
 * Payments that go out regularly: to the same payee at least twice, on a rule that fits every one (bills move later
 * off weekends, as the app forecasts them), and still going (the last one within a period and a week).
 * Direct debits (and anything Monzo files as a bill) count at any amount. A card payment or a transfer counts only when
 * it's about the same amount every month or 4 weeks: a subscription, or rent by standing order. A shop you go to every
 * week, or food and drink at any pace, isn't a bill: it's everyday spending. Biggest first.
 */
export function findBills(raw: RawTx[], today: IsoDate): FoundBill[] {
  const out: FoundBill[] = [], names = new Set<string>();
  for (const list of byPayee(raw.filter(t => moved(t) && t.amount < 0 && t.category !== "income"))) {
    if (list.length < 2) continue;
    const dd = list.some(t => t.scheme === "bacs" || t.category === "bills");
    const amounts = list.map(t => -t.amount / 100), mid = median(amounts);
    if (!dd && (list.some(t => FOOD.has(t.category || "")) || amounts.some(a => Math.abs(a - mid) > mid * 0.1))) continue;
    const ds = [...new Set(list.map(when))].sort(), last = ds[ds.length - 1];
    type Try = Pick<Bill, "freq" | "day" | "date">;
    // bills move later, never earlier: a tie goes to the earlier day
    const tries: Try[] = [
      ...daysSeen(ds, 1).map(day => ({freq: "monthly" as const, day})), {freq: "fourweekly", date: last},
      ...(dd ? [{freq: "fortnightly" as const, date: last}, {freq: "weekly" as const, date: last}] : []),
    ];
    const best = fit(ds, tries, (t, from, to) => billDates({id: "", name: "", amount: 0, ...t}, from, to));
    if (!best || dayDiff(last, today) > PERIOD[best.t.freq]! + 7) continue;
    const latest = list[list.length - 1], name = nice(payee(latest)).slice(0, 40);
    if (names.has(name.toLowerCase())) continue;
    names.add(name.toLowerCase());
    const bill: FoundBill = {
      name, payee: payee(latest), amount: r2(-latest.amount / 100), varies: Math.max(...amounts) - Math.min(...amounts) > mid * 0.05,
      freq: best.t.freq, method: list.some(t => t.scheme === "bacs") ? "dd" : byCard(latest) ? "card" : "transfer", n: best.n,
    };
    // the next date it goes out, as a bill's date box wants it (any one of them pins down the rest)
    if (typeof best.t.day === "number") bill.day = best.t.day;
    else { let d = last; while (d < today) d = addDays(d, STEP[best.t.freq]!); bill.date = d; }
    out.push(bill);
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/** What you usually spend on one everyday thing, a month, from your card payments: a suggestion for setup's everyday. */
export interface FoundSpend { name: string; monthly: number; n: number }

// Monzo's categories as setup's everyday ones. Bills, transfers, savings, finances, expenses and holidays aren't everyday spending.
const SPEND_CAT: Record<string, string> = {
  groceries: "Groceries", eating_out: "Eating out", transport: "Transport", shopping: "Shopping",
  entertainment: "Entertainment", personal_care: "Personal care", general: "Other", cash: "Other",
};

/**
 * What you usually spend a month on each everyday thing: card payments by Monzo's category, refunds taken off,
 * over the days the payments cover (at least 4 weeks, so a new account isn't scaled up from a few days).
 * Payments to a regular payment already found are left out, so a subscription isn't counted twice.
 * Anything under £5 a month, or fewer than 2 payments, is left out. In setup's order.
 */
export function findSpending(raw: RawTx[], today: IsoDate, bills: FoundBill[] = []): FoundSpend[] {
  const real = raw.filter(moved);
  if (!real.length) return [];
  const skip = new Set(bills.map(b => plain(b.payee) || b.payee.toLowerCase()));
  const first = real.map(when).sort()[0], days = Math.max(28, dayDiff(first, today) + 1);
  const sum = new Map<string, {total: number; n: number}>();
  for (const t of real) {
    const name = SPEND_CAT[t.category || ""];
    if (!name || !byCard(t) || skip.has(payeeKey(t))) continue;
    const s = sum.get(name) ?? {total: 0, n: 0};
    sum.set(name, {total: s.total - t.amount / 100, n: s.n + (t.amount < 0 ? 1 : 0)});
  }
  return EVERYDAY.flatMap(({name}) => {
    const s = sum.get(name);
    const monthly = s ? r2(s.total * (365 / 12) / days) : 0;
    return s && s.n >= 2 && monthly >= 5 ? [{name, monthly, n: s.n}] : [];
  });
}

/** Someone who pays you like pay, with how often (when that's clear). */
export type FoundIncome = SeenPay & {rule: PayRule | null};

/** Everything setup can fill in from the payments it read when you connected. Nothing here is saved until you've seen it. */
export interface SetupFound { pays: FoundIncome[]; bills: FoundBill[]; spending: FoundSpend[] }

export function findAll(raw: RawTx[], today: IsoDate): SetupFound {
  const bills = findBills(raw, today);
  return {
    pays: findPays(raw, today).map(p => ({amount: p.amount, from: p.from, date: p.date, rule: payRule(p.dates, today)})),
    bills, spending: findSpending(raw, today, bills),
  };
}
