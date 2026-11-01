// Regular payments that aren't in your bills yet, and bills that look different from what the bank's been paying: what Tim and
// Frank can ask you about after setup. Only ever questions: nothing here becomes a bill, or changes one, until you say so.
// The bank's last 90 days are looked through once a day (`scanOf`, with setup's own rules in lib/found.ts), because the app keeps
// payments only from its first sync; changes to bills you have come from the payments the app keeps (`billChanges`).
// Pure: the payments, your bills and what you've said before are passed in.
import {allBanks, accountKey} from "./banks";
import {billDated, billDates, billPaid, nearDue, nextBill} from "./bills";
import {addDays, dayDiff, isoD, niceDate} from "./dates";
import {findRegulars, keyOf, type Regular} from "./found";
import {aboutRight, paidTo, type RawTx} from "./monzo";
import type {Bill, Ctx, IsoDate, Tx} from "./types";

export type {Regular};

/** The bank's last 90 days, looked through on `at`: from the first payment in them (null: there were none). */
export interface Scan { at: IsoDate; from: IsoDate | null; found: Regular[] }

/** What you said about a regular payment: it isn't a bill (never asked again), or not now (asked again after 30 days). */
export type Verdict = "not_a_bill" | "not_now";
export type Answers = Record<string, {verdict: Verdict; at: IsoDate; name: string}>;
export const ASK_AGAIN = 30;

/** Looks through the bank's payments for regular ones. Moves to your own accounts at other banks aren't anything. */
export function scanOf(raw: RawTx[], today: IsoDate, own: Set<string>): Scan {
  const mine = raw.filter(t => !own.has(accountKey(t.counterparty?.sort_code, t.counterparty?.account_number)));
  const dates = mine.filter(t => t?.created).map(t => isoD(new Date(t.created))).sort();
  return {at: today, from: dates[0] ?? null, found: findRegulars(mine, today)};
}

/** A regular payment that isn't in your bills: maybe one you have under another name (`sameAs`), or part of setup's Subscriptions (`partOf`). */
export type Open = Regular & {sameAs?: Bill; partOf?: Bill};
/** `none`: why there's nothing to look at; `note`: what to bear in mind about what there is. */
export interface RegularsView { open: Open[]; none?: string; note?: string }

const asRule = (r: Pick<Regular, "freq" | "day" | "date">): Bill => ({id: "", name: "", amount: 0, freq: r.freq, day: r.day, date: r.date});
// a bill already has it: paid to the same payee, or every word of the bill's name is in the payee's
const tracked = (bills: Bill[], r: Regular) => bills.some(b => (!!b.payee && keyOf(b.payee) === r.ref) || paidTo(b, r.payee));
const answered = (a: Answers[string] | undefined, today: IsoDate) => !!a && (a.verdict === "not_a_bill" || dayDiff(a.at, today) < ASK_AGAIN);
// goes out within a few days of each other (a bill with no payment date could be any day)
const sameTime = (b: Bill, r: Regular, today: IsoDate) => {
  if (!billDated(b)) return true;
  const x = nextBill(b, today), y = nextBill(asRule(r), today);
  return !!x && !!y && Math.abs(dayDiff(x, y)) <= 3;
};
const SUBS = /subscription/i;

/** The regular payments to ask about: not in your bills, not answered (not now: for 30 days), the biggest first. */
export function regularsView(ctx: Ctx, scan: Scan | null, answers: Answers): RegularsView {
  if (!allBanks(ctx.state).length) return {open: [], none: "No bank is connected, so there are no payments to look through."};
  if (!scan) return {open: [], none: "The bank's payments haven't been looked through yet. That happens after the next sync."};
  const t = ctx.today, bills = ctx.state.bills;
  const open = scan.found.filter(r => !tracked(bills, r) && !answered(answers[r.ref], t)).map((r): Open => {
    // the same amount at the same time as a bill you typed in with no payee: probably that bill, not a second one
    const sameAs = bills.find(b => !b.payee && b.amount > 0 && aboutRight(b, r.amount) && sameTime(b, r, t));
    if (sameAs) return {...r, sameAs};
    const partOf = serviceOf(r.payee) ? bills.find(b => !b.payee && SUBS.test(b.name)) : undefined;
    return partOf ? {...r, partOf} : r;
  });
  const notes: string[] = [];
  const days = scan.from ? dayDiff(scan.from, scan.at) : 0, weeks = Math.max(1, Math.round(days / 7));
  if (!scan.from) notes.push("There were no payments in the bank's last 90 days to look through.");
  else if (days < 56) notes.push(`Only ${weeks} week${weeks === 1 ? "" : "s"} of payments to go on, so a monthly payment may only have gone out once: too few to show a pattern.`);
  if (dayDiff(scan.at, t) > 3) notes.push(`Looked through on ${niceDate(scan.at)}: newer payments aren't in it.`);
  return {open, ...notes.length ? {note: notes.join(" ")} : {}};
}

/** A bill that looks different from what the bank's been paying: a new price, or a due date with nothing paid. */
export type Change = {kind: "price"; b: Bill; paid: number; on: IsoDate} | {kind: "no_payment"; b: Bill; due: IsoDate};
const LOOK_BACK = 45;

/**
 * Bills the bank's payments don't agree with, from the payments the app keeps:
 * - price: the latest payment for it in the last 45 days (filed against it, or paid to it near a due date and unfiled) is a
 *   different amount (at least 50p and 3% off). Not for a bill that varies.
 * - no_payment: a due date 4 to 40 days ago with nothing paid. Only for a bill the bank pays by direct debit or card (one with a
 *   payee), and only dates after the app's first payment from the bank and after the bill was added.
 */
export function billChanges(ctx: Ctx): Change[] {
  const t = ctx.today, bank = ctx.txs.filter(it => it.monzoId && it.type === "expense" && it.date <= t);
  const first = bank.reduce<IsoDate | null>((x, it) => !x || it.date < x ? it.date : x, null);
  const out: Change[] = [];
  for (const b of ctx.state.bills) {
    if (!(b.amount > 0) || b.freq === "oneoff") continue;
    // an unfiled payment counts only near a due date and within half to double, so a shop with the same name isn't a new price
    const near = (it: Tx) => !billDated(b) || billDates(b, addDays(it.date, -3), addDays(it.date, 7)).some(d => nearDue(it.date, d));
    const unfiled = (it: Tx) => !it.billId && paidTo(b, it.note) && aboutRight({amount: b.amount, varies: true}, it.amount) && near(it);
    const latest = bank.filter(it => dayDiff(it.date, t) <= LOOK_BACK && (it.billId === b.id || unfiled(it)))
      .sort((x, y) => x.date.localeCompare(y.date) || x.created - y.created).pop();
    if (!b.varies && latest && Math.abs(latest.amount - b.amount) >= Math.max(0.5, b.amount * 0.03)) {
      out.push({kind: "price", b, paid: latest.amount, on: latest.date});
      continue;
    }
    if (!b.payee || b.method === "transfer" || !billDated(b) || !first) continue;
    const missed = billDates(b, addDays(t, -40), addDays(t, -4)).filter(d => d >= first && d >= (b.since ?? "")
      && !billPaid(ctx, b, d) && !bank.some(it => !it.billId && paidTo(b, it.note) && nearDue(it.date, d)));
    if (missed.length) out.push({kind: "no_payment", b, due: missed[missed.length - 1]});
  }
  return out;
}

type Kind = "streaming" | "music";
// services that do the same job, by name; their own list, since a bill's look puts a TV licence with the streaming services
const SERVICES: {kind: Kind; name: string; re: RegExp}[] = [
  {kind: "streaming", name: "Netflix", re: /netflix/i}, {kind: "streaming", name: "Disney+", re: /disney/i},
  {kind: "streaming", name: "Prime Video", re: /prime ?video/i}, {kind: "streaming", name: "NOW", re: /\bnow ?tv\b/i},
  {kind: "streaming", name: "Apple TV+", re: /apple ?tv/i}, {kind: "streaming", name: "Paramount+", re: /paramount/i},
  {kind: "streaming", name: "BritBox", re: /britbox/i}, {kind: "streaming", name: "discovery+", re: /discovery ?(\+|plus)/i},
  {kind: "music", name: "Spotify", re: /spotify/i}, {kind: "music", name: "Apple Music", re: /apple ?music/i},
  {kind: "music", name: "Tidal", re: /\btidal\b/i}, {kind: "music", name: "YouTube Music", re: /youtube ?music/i},
  {kind: "music", name: "Deezer", re: /deezer/i}, {kind: "music", name: "Amazon Music", re: /amazon ?music/i},
];
/** The streaming or music service a name is, if it's one. */
export const serviceOf = (name: string) => SERVICES.find(s => s.re.test(name)) ?? null;

/** Two or more different services of one kind among these names (bills and payments alike), each kind once. */
export function sameKind(names: string[]): {kind: Kind; names: string[]}[] {
  const by = new Map<Kind, Set<string>>();
  for (const n of names) { const s = serviceOf(n); if (s) by.set(s.kind, new Set([...(by.get(s.kind) ?? []), s.name])); }
  return [...by].filter(([, s]) => s.size > 1).map(([kind, s]) => ({kind, names: [...s]}));
}
