import {billDated, billDates, billMonthly, billPaid, nextBill} from "./bills";
import {addDays, dayDiff, niceDate} from "./dates";
import {money, parseAmount, r2} from "./money";
import {catGroup, type Calc} from "./calc";
import {billLook, catLook, type LookIcon} from "./looks";
import type {AppState, Bill, Category, Ctx, IsoDate, Tx} from "./types";

/** One bubble on the Living tab (design/LIVING_SPEC.md): a bill or an everyday amount, sized by what it costs a month. */
export interface LivingItem {
  id: string;
  ref: string;        // the bill's or the everyday category's own id
  name: string;
  amount: number;     // a month
  icon: LookIcon;
  paid: boolean;      // everything due for it this pay cycle has gone out
  estimate: boolean;  // an everyday amount: what you allow, not a fixed bill
  date?: IsoDate;     // another month (lib/livingMonth.ts): the day a bill went out (gone) or is due (to come)
}

/** Every bill (at its monthly cost, so £600 a year counts £50) and every everyday amount, biggest first.
 *  A bill with no amount yet has no size, so it isn't a bubble until it has one. */
export function livingItems(ctx: Ctx, c: Calc): LivingItem[] {
  const {state, txs} = ctx;
  const until = c.payday ? addDays(c.payday, -1) : addDays(ctx.today, 30);
  // a one-off is part of the pay cycle it goes out in, and gone after it
  const bills: LivingItem[] = state.bills.filter(b => b.amount > 0 && !(b.freq === "oneoff" && b.date && b.date < c.cycleFrom)).map(b => {
    const due = billDated(b) ? billDates(b, c.cycleFrom, until) : [];
    // no payment date: paid once a payment for it has landed this pay cycle
    const paid = billDated(b) ? due.length > 0 && due.every(d => billPaid(ctx, b, d)) : txs.some(it => it.billId === b.id && it.date >= c.cycleFrom);
    return {id: `bill:${b.id}`, ref: b.id, name: b.name, amount: billMonthly(b), icon: b.icon ?? billLook(b.name).icon, paid, estimate: false};
  });
  const everyday: LivingItem[] = state.categories.filter(x => catGroup(x) === "everyday" && x.budget > 0).map(x =>
    ({id: `cat:${x.id}`, ref: x.id, name: x.name, amount: x.budget, icon: catLook(x.id, x.name).icon, paid: false, estimate: true}));
  return [...bills, ...everyday].sort((a, b) => b.amount - a.amount);
}

/** What a screen reader says for a bubble or a list row: "Council tax, £120", "Groceries, £200", "Spotify, £12, paid".
 *  An everyday amount is a fixed budget, so it's said as it is, not "about". */
export const livingLabel = (x: LivingItem) => `${x.name}, ${money(Math.round(x.amount))}${x.paid ? ", paid" : ""}`;

/** The header: what it all costs a month, and what of it still has to go out before payday (the engine's `need`: unpaid bills due
 *  before payday, and what's left of everyday amounts). */
export function livingTotals(items: LivingItem[], c: Calc) {
  return {total: items.reduce((a, x) => a + x.amount, 0), left: Math.max(0, c.need)};
}

/** The sheet's line under the amount: when a bill is due ("Due Tue 20 Oct," then "in 3 days" in bold), or that it's gone out;
 *  for an everyday amount, what's been spent from it this pay cycle and what's left. */
export function livingDue(ctx: Ctx, c: Calc, item: LivingItem): {line: string; bold: string; paid?: true} {
  const t = ctx.today;
  if (item.estimate) {
    // what's been spent of it this pay cycle, the same under it or past it ("Spent £230 of £200": never "over", nor "extra",
    // which reads as money to spend)
    const spent = c.everyday.find(x => x.x.id === item.ref)?.spent ?? 0;
    return {line: "Spent", bold: `${money(spent)} of ${money(item.amount)}`};
  }
  const b = ctx.state.bills.find(x => x.id === item.ref);
  // paid: the sheet starts the line with "Paid", in green
  if (!b || !billDated(b)) return item.paid ? {line: "this pay cycle", bold: "", paid: true} : {line: "No payment date yet", bold: ""};
  if (item.paid) return {line: `· ${niceDate(cycleDates(ctx, c, b).at(-1)!)}`, bold: "", paid: true};
  const unpaid = nextDue(ctx, c, b);
  if (!unpaid) return {line: "No payment date yet", bold: ""};
  const days = dayDiff(t, unpaid);
  if (days < 0) return {line: `Was due ${niceDate(unpaid)}`, bold: ""};
  if (days === 0) return {line: "Due today", bold: ""};
  return {line: `Due ${niceDate(unpaid)},`, bold: days === 1 ? "tomorrow" : `in ${days} days`};
}

// a bill's due dates this pay cycle, and the first of them (or after) not paid yet
const cycleDates = (ctx: Ctx, c: Calc, b: Bill) => billDates(b, c.cycleFrom, c.payday ? addDays(c.payday, -1) : addDays(ctx.today, 30));
const nextDue = (ctx: Ctx, c: Calc, b: Bill) => cycleDates(ctx, c, b).find(d => !billPaid(ctx, b, d)) ?? nextBill(b, ctx.today);

/** The list's bills in the order they're due, so it reads as what's to come: the next unpaid date first (one gone past at the top),
 *  then ones with no payment date, then ones paid this pay cycle. A tie goes to the bigger. */
export function livingByDue(ctx: Ctx, c: Calc, items: LivingItem[]): LivingItem[] {
  const when = (x: LivingItem) => {
    const b = ctx.state.bills.find(y => y.id === x.ref);
    return b && billDated(b) ? nextDue(ctx, c, b) ?? null : null;
  };
  const keyed = items.map(x => ({x, at: x.paid ? null : when(x)}));
  const rank = (k: {x: LivingItem; at: IsoDate | null}) => k.x.paid ? 2 : k.at ? 0 : 1;
  return keyed.sort((a, b) => rank(a) - rank(b) || (a.at ?? "").localeCompare(b.at ?? "") || b.x.amount - a.x.amount).map(k => k.x);
}

/** What the sheet's main button does: a bill still to pay can be marked paid, and one you marked paid unmarked (one paid from your
 *  bank can't be: that payment really went out). An everyday amount logs spending instead. */
export function livingAction(ctx: Ctx, c: Calc, item: LivingItem): "pay" | "unpay" | "log" | null {
  if (item.estimate) return "log";
  if (!item.paid) return "pay";
  return livingMarked(ctx, c, item).length ? "unpay" : null;
}

/** Mark as paid logs the bill's payment: its amount, today, for its first due date still unpaid (none for a bill with no payment
 *  date). Like any payment, it comes off the balance and the bill is no longer held back. */
export function livingPayment(ctx: Ctx, c: Calc, item: LivingItem): Omit<Tx, "id" | "created"> | null {
  const b = ctx.state.bills.find(x => x.id === item.ref);
  if (!b || item.estimate) return null;
  const forDate = billDated(b) ? nextDue(ctx, c, b) : null;
  return {type: "expense", amount: b.amount, cat: b.cat || "bills", note: "", date: ctx.today, billId: b.id, ...(forDate ? {forDate} : {})};
}

/** The payments that paid it this pay cycle, oldest first: ones filed against it, and ones in its category around a due date
 *  (what `billPaid` counts). An everyday amount has none here: its line says what's been spent. */
export function livingPayments(ctx: Ctx, c: Calc, item: LivingItem): Tx[] {
  const b = ctx.state.bills.find(x => x.id === item.ref);
  if (!b || item.estimate) return [];
  const ds = cycleDates(ctx, c, b);
  return ctx.txs.filter(it => it.type === "expense" && (it.billId === b.id
    ? (it.forDate ?? it.date) >= c.cycleFrom
    : !!b.cat && it.cat === b.cat && ds.some(d => it.date >= addDays(d, -7) && it.date <= addDays(d, 3))))
    .sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
}

/** The payments for it this pay cycle that were logged here, not imported from the bank: Mark as unpaid removes them. */
export function livingMarked(ctx: Ctx, c: Calc, item: LivingItem): string[] {
  if (item.estimate) return [];
  return ctx.txs.filter(it => it.billId === item.ref && !it.monzoId && (it.forDate ?? it.date) >= c.cycleFrom).map(it => it.id);
}

/** The sheet's edit form: a bill's name, amount and when it goes out (a day of the month, or a date); an everyday amount's name
 *  and what it allows a month. */
export interface LivingDraft {
  name: string; amount: string;
  due: "day" | "date" | null;   // a monthly bill's day of the month, another bill's next date; nothing for an everyday amount
  day: string; last: boolean;    // last: it goes out on the last working day, kept while the day's left blank
  date: IsoDate | null;
}

export function livingDraft(state: AppState, item: LivingItem): LivingDraft {
  const b = state.bills.find(x => x.id === item.ref);
  if (item.estimate || !b) return {name: item.name, amount: String(item.amount), due: null, day: "", last: false, date: null};
  return {name: b.name, amount: String(b.amount), due: b.freq === "monthly" ? "day" : "date",
    day: typeof b.day === "number" ? String(b.day) : "", last: b.day === "last", date: b.date ?? null};
}

/** Saving the form: the bill or everyday amount with the new figures, everything else about it kept. A monthly bill left without a
 *  day keeps "last working day" if it had it; otherwise it has no payment date, and holds back a month's share as before. */
export function saveLiving(state: AppState, item: LivingItem, d: LivingDraft): {bill: Bill} | {categories: Category[]} | {error: string} {
  const name = d.name.trim().slice(0, 40), amount = parseAmount(d.amount);
  if (!name) return {error: "Give it a name"};
  if (!(amount > 0)) return {error: "Enter how much it is, e.g. 650"};
  if (item.estimate) return {categories: state.categories.map(x => x.id === item.ref ? {...x, name, budget: r2(amount)} : x)};
  const old = state.bills.find(x => x.id === item.ref);
  if (!old) return {error: "That bill's gone"};
  const b: Bill = {...old, name, amount: r2(amount)};
  if (old.freq === "monthly") {
    const day = Number(d.day);
    if (d.day.trim() && !(Number.isInteger(day) && day >= 1 && day <= 31)) return {error: "Pick a day from 1 to 31"};
    if (d.day.trim()) b.day = day; else if (d.last) b.day = "last"; else delete b.day;
  } else if (d.date) b.date = d.date; else delete b.date;
  return {bill: b};
}

/** The "+" form (design/LIVING_SPEC.md §8): a new bill's name, amount, when it's due (typed as you'd say it) and how often. `icon` is
 *  null while it's picked from the name; once you tap one it's yours. */
export type AddFreq = "weekly" | "monthly" | "yearly" | "oneoff";
export interface AddDraft { name: string; amount: string; due: string; freq: AddFreq; icon: LookIcon | null }
export const newAddDraft = (freq: AddFreq = "monthly"): AddDraft => ({name: "", amount: "", due: "", freq, icon: null});

/** The icon grid, as drawn: home, food, council, energy, travel, water, internet, fitness, phone, music, TV, and other. */
export const ADD_ICONS: {icon: LookIcon; name: string}[] = [
  {icon: "house", name: "Home"}, {icon: "cart", name: "Food"}, {icon: "landmark", name: "Council"}, {icon: "bulb", name: "Energy"},
  {icon: "train", name: "Travel"}, {icon: "drop", name: "Water"}, {icon: "globe", name: "Internet"}, {icon: "dumbbell", name: "Fitness"},
  {icon: "phone", name: "Phone"}, {icon: "music", name: "Music"}, {icon: "tv", name: "TV"}, {icon: "receipt", name: "Other"},
];
/** What the bubble will show: yours, or the one its name suggests. */
export const addIcon = (d: AddDraft): LookIcon => d.icon ?? billLook(d.name).icon;

export const DUE_HINT: Record<AddFreq, string> = {weekly: "e.g. Saturdays", monthly: "e.g. the 26th", yearly: "e.g. 3 March", oneoff: "e.g. Fri 23 Oct"};

const DAYS3 = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS3 = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const isoOf = (y: number, m: number, d: number): IsoDate => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/**
 * When it's due, from what you typed: "the 26th" or "last" for a monthly bill, a weekday for a weekly one ("Saturdays": the next one),
 * a day and month for a yearly or one-off one ("3 March", "Fri 23 Oct", "23/10": the next time it comes round). A one-off also takes
 * a day on its own ("the 23rd": the next 23rd; added from a month to come, `month` its first day, the 23rd of that month on).
 * Blank is no date ({}); null is a date it couldn't make out.
 */
export function parseDue(freq: AddFreq, text: string, today: IsoDate, month?: IsoDate): {day?: number | "last"; date?: IsoDate} | null {
  const t = text.trim().toLowerCase();
  if (!t) return {};
  const words = t.split(/[^a-z0-9]+/).filter(Boolean);
  const [ty, tm, td] = today.split("-").map(Number);
  if (freq === "monthly") {
    if (/\blast\b/.test(t)) return {day: "last"};
    const n = Number(t.match(/\d{1,2}/)?.[0]);
    return n >= 1 && n <= 31 ? {day: n} : null;
  }
  if (freq === "weekly") {
    const w = DAYS3.findIndex(d => words.some(x => x.startsWith(d)));
    if (w < 0) return null;
    const now = new Date(ty, tm - 1, td);
    return {date: addDays(today, (w - now.getDay() + 7) % 7)};
  }
  // a day and a month, as words ("3 march") or numbers ("3/3")
  const slash = t.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  const m = slash ? Number(slash[2]) - 1 : MONTHS3.findIndex(x => words.some(w => w.startsWith(x)));
  const d = Number((slash?.[1]) ?? t.match(/\d{1,2}/)?.[0]);
  if (!(d >= 1 && d <= 31)) return null;
  if (m < 0 || m > 11) {
    if (freq !== "oneoff") return null;
    // just a day: the next time the month has it, from the month on show if that's one to come
    const from = month && month > today ? month : today, [fy, fm] = from.split("-").map(Number);
    for (let i = 0; i < 12; i++) {
      const y = fy + Math.floor((fm - 1 + i) / 12), mm = (fm - 1 + i) % 12;
      const iso = d <= daysIn(y, mm) ? isoOf(y, mm, d) : null;
      if (iso && iso >= from) return {date: iso};
    }
    return null;
  }
  // the next one from today (29 February: the next leap year)
  for (let y = ty; y <= ty + 4; y++) if (d <= daysIn(y, m) && isoOf(y, m, d) >= today) return {date: isoOf(y, m, d)};
  return null;
}

/** The line under How often: what the bill will count as. */
export function addNote(d: AddDraft): string {
  const a = parseAmount(d.amount), ok = a > 0;
  if (d.freq === "weekly") return ok ? `About ${money(Math.round(a * 52 / 12))} a month` : "Counts every week";
  if (d.freq === "yearly") return ok ? `Spread out as ${money(r2(a / 12))} a month` : "Spread out across 12 months";
  if (d.freq === "oneoff") return "Counts once, when it's due";
  return "Counts once each month";
}

/**
 * The bill the form makes, or why it can't yet (null: Add bill stays grey). It needs a name and an amount above 0. When it's due can be
 * left blank (it holds back a month's share each pay cycle until it's paid, as setup's do), except on a one-off, which needs its date.
 */
export function addBill(d: AddDraft, id: string, today: IsoDate, month?: IsoDate): Bill | null {
  const name = d.name.trim().slice(0, 40), amount = parseAmount(d.amount), due = parseDue(d.freq, d.due, today, month);
  if (!name || !(amount > 0) || !due || (d.freq === "oneoff" && !due.date)) return null;
  const bill: Bill = {id, name, amount: r2(amount), freq: d.freq, from: {kind: "main"}, ...due};
  if (d.icon) bill.icon = d.icon;
  return bill;
}

// The cheapest is 44pt across (always tappable), the priciest 219pt; a lone bill 120pt. The "+" is 52pt.
export const R_MIN = 22, R_MAX = 109.5, R_ONE = 60, R_ADD = 26;

/** The order the pile is packed in: what's still to pay first, biggest first, then the paid ones, so they settle on top (they float). */
export const pileOrder = <T extends {paid: boolean}>(items: T[]): T[] => [...items.filter(x => !x.paid), ...items.filter(x => x.paid)];

/** Each amount's radius: area grows in step with the cost, from the cheapest at R_MIN to the priciest at R_MAX,
 *  so a bigger bill is always a bigger bubble. */
export function bubbleRadii(amounts: number[]): number[] {
  if (amounts.length === 1) return [R_ONE];
  const lo = Math.min(...amounts), hi = Math.max(...amounts);
  const k = hi > lo ? (R_MAX ** 2 - R_MIN ** 2) / (hi - lo) : 0;
  return amounts.map(a => Math.sqrt(R_MIN ** 2 + Math.max(0, k * (a - lo))));
}

export interface Circle { id: string; r: number }
/** A packed circle's centre, measured from the pit's top left (y grows downwards, the floor is at the pit's height). */
export interface Placed extends Circle { x: number; y: number }

/** A ball pit: the circles in the order given (biggest first), each dropped into the lowest spot where it rests on the floor, a wall,
 *  or two circles already there, touching but never overlapping; on a tie, the leftmost. If nothing fits, it goes on top in the middle. */
export function pack(circles: Circle[], W: number, H: number): Record<string, Placed> {
  const placed: Placed[] = [];
  const fits = (x: number, y: number, r: number) => x >= r - 0.01 && x <= W - r + 0.01 && y <= H - r + 0.01
    && placed.every(p => Math.hypot(p.x - x, p.y - y) >= p.r + r - 0.3);
  for (const {id, r} of circles) {
    const floor = H - r, spots: [number, number][] = [[r, floor], [W - r, floor]];
    // on the floor beside a circle, and against a wall touching one
    for (const p of placed) {
      const s = (p.r + r) ** 2 - (p.y - floor) ** 2;
      if (s >= 0) spots.push([p.x - Math.sqrt(s), floor], [p.x + Math.sqrt(s), floor]);
      for (const wx of [r, W - r]) {
        const t = (p.r + r) ** 2 - (wx - p.x) ** 2;
        if (t >= 0) spots.push([wx, p.y - Math.sqrt(t)], [wx, p.y + Math.sqrt(t)]);
      }
    }
    // resting on two circles
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      const d = Math.hypot(b.x - a.x, b.y - a.y), A = a.r + r, B = b.r + r;
      if (d === 0 || d > A + B || d < Math.abs(A - B)) continue;
      const l = (A * A - B * B + d * d) / (2 * d), h2 = A * A - l * l;
      if (h2 < 0) continue;
      const h = Math.sqrt(h2), ux = (b.x - a.x) / d, uy = (b.y - a.y) / d, px = a.x + l * ux, py = a.y + l * uy;
      spots.push([px - h * uy, py + h * ux], [px + h * uy, py - h * ux]);
    }
    let best: [number, number] | null = null;
    for (const [x, y] of spots) {
      if (!fits(x, y, r)) continue;
      if (!best || y > best[1] + 0.5 || (Math.abs(y - best[1]) <= 0.5 && x < best[0])) best = [x, y];
    }
    if (!best) best = [W / 2, Math.min(...placed.map(p => p.y - p.r)) - r];
    placed.push({id, r, x: best[0], y: best[1]});
  }
  return Object.fromEntries(placed.map(p => [p.id, p]));
}
