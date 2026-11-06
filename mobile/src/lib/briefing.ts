// Frank's briefings: when you open his tab, he's been keeping an eye on your money and tells you what's worth knowing, without
// being asked. The app works out the facts with its own engine (`briefingFacts`); Claude decides which are worth saying and how,
// and says which it mentioned (`<mentioned>f1 | f3</mentioned>`, or `<nothing/>` when nothing is). What he's been told and said
// is kept (`BriefLog`), so the same thing isn't said twice at the same stage: a bill due tomorrow is said once, and again when
// it's due today and still unpaid. Mentioning a bill never marks it paid: only a payment does (billPaid).
// Pure: the payments, your bills, what the bank's look found and what he's said before are passed in.
import {allBanks} from "./banks";
import {BILL_FREQ, billDated, billDates, billPaid, METHOD_META} from "./bills";
import {budgetHint} from "./budget";
import {calc, expected, spentByDay} from "./calc";
import {addDays, isoD, shortDay} from "./dates";
import {lowAmt} from "./income";
import {r2} from "./money";
import {unsorted} from "./payments";
import {billChanges, regularsView, type Answers, type Scan} from "./regulars";
import {clean, runTool} from "./ai/tools";
import type {Ctx, IsoDate, Tx} from "./types";

export type BriefKind = "daily" | "return" | "alert";
/** How much a fact matters: an alert can bring him out on its own, news is worth a catch-up, the rest only goes in a briefing. */
export type Level = "alert" | "news" | "action" | "info";
/** One thing the app knows, for him to say or leave out. `key` names it for good; `stage` changes when it's worth saying again
 *  (a bill due this week, then tomorrow, then today). `data` is what he's told, the engine's figures only. */
export interface Fact { key: string; stage: string; level: Level; what: string; data: Record<string, unknown> }

/** What he said about a fact: at which stage, on which day, and whether he said it (`told`) or looked and left it out. */
export interface Said { stage: string; at: IsoDate; told: boolean }
/** What's kept between briefings. `lastAt`, `lastSeen`: ms since epoch, the last briefing and when you last left the app. */
export interface BriefLog {
  lastDaily: IsoDate | null;
  lastAt: number | null;
  lastSeen: number | null;
  last: {kind: BriefKind; at: number; text: string} | null;
  said: Record<string, Said>;
}
export const NO_BRIEFS: BriefLog = {lastDaily: null, lastAt: null, lastSeen: null, last: null, said: {}};

/** new: never seen; changed: seen at another stage; already_said: he said it at this stage; passed_over: he looked and left it out. */
export type Status = "new" | "changed" | "already_said" | "passed_over";

// a date for him: the ISO date and its weekday, as the tools give them
const day = (d: IsoDate) => `${d} ${shortDay(d)}`;
const DAY = 864e5;
// payments from further back than this aren't news, however recently they were imported
const NEWS_DAYS = 14;
// what's said is kept this long, then forgotten
export const KEEP_DAYS = 30;
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Everything worth knowing right now, from the engine. "Since" is since the last briefing (a day and a half, the first time):
 * payments saved here after it, so a payment the bank only sent today counts as new even if it was made days ago.
 */
export function briefingFacts(ctx: Ctx, regulars: {scan: Scan | null; answers: Answers}, log: BriefLog, now: number): Fact[] {
  const t = ctx.today, s = ctx.state, c = calc(ctx), out: Fact[] = [];
  const since = log.lastAt ?? now - 1.5 * DAY, recent = addDays(t, -NEWS_DAYS);
  const fresh = (it: Tx) => it.created > since && it.date >= recent && it.date <= t;
  const bill = (id: string | undefined) => s.bills.find(b => b.id === id);

  // where you stand: the overview tool's own answer, so his figures are the ones the app shows
  const env = {ctx, notes: [], who: "frank" as const, newId: () => "", regulars: {scan: null, answers: {}}, rules: []};
  out.push({key: "today", stage: t, level: "info", what: "where_you_stand", data: runTool("overview", {}, env).result as Record<string, unknown>});
  if (c.payday && r2(c.balance - c.billsLeft - c.everydayLeft - c.savingHeld) < 0)
    out.push({key: "gap", stage: "open", level: "alert", what: "not_enough_for_bills_and_everyday", data: {note: "See where_you_stand: still_needed_for_bills_and_everyday and in_the_app say how much more is needed and how to close it. Say it calmly."}});
  if (c.late && c.payday)
    out.push({key: `pay_late:${c.cycleFrom}`, stage: "late", level: "alert", what: "pay_late",
      data: {assumed_payday: day(c.payday), note: "The last payday passed with no pay, so payday is assumed to be a week away. That's an assumption."}});

  // bills due from today to a week on, not paid yet
  for (const b of s.bills) {
    if (!(b.amount > 0) || !billDated(b)) continue;
    for (const d of billDates(b, t, addDays(t, 7))) {
      if (billPaid(ctx, b, d)) continue;
      const stage = d === t ? "today" : d === addDays(t, 1) ? "tomorrow" : "this_week", you = b.method === "transfer";
      out.push({key: `bill_due:${b.id}:${d}`, stage, level: stage === "this_week" ? "info" : you ? "alert" : "news", what: "bill_due", data: {
        name: clean(b.name), amount: b.amount, due: day(d), ...b.method ? {how: METHOD_META[b.method]} : {}, ...b.varies ? {varies: true} : {},
        ...you ? {you_pay_it: "They send this one themselves: the app only knows it's paid once they say so or the payment shows."} : {},
        ...c.payday && d < c.payday ? {held_back: "Already held back from today's amount."} : {},
        paid: false,
      }});
    }
  }
  // a due date gone with nothing paid: one the bank pays (billChanges, 4 to 40 days on), or one they send themselves
  for (const x of billChanges(ctx)) {
    if (x.kind === "no_payment") out.push({key: `bill_overdue:${x.b.id}:${x.due}`, stage: "overdue", level: "alert", what: "bill_not_paid", data: {
      name: clean(x.b.name), amount: x.b.amount, was_due: day(x.due),
      note: "Nothing from the bank near this date: it may have failed, been paid another way, or be late. Don't say which.",
    }});
    else out.push({key: `bill_price:${x.b.id}`, stage: String(x.paid), level: "news", what: "bill_new_price", data: {
      name: clean(x.b.name), bill_says: x.b.amount, latest_payment: x.paid, paid_on: day(x.on),
    }});
  }
  for (const b of s.bills) {
    if (b.method !== "transfer" || !(b.amount > 0) || !billDated(b)) continue;
    for (const d of billDates(b, addDays(t, -7), addDays(t, -1))) {
      if (!billPaid(ctx, b, d) && d >= (b.since ?? "")) out.push({key: `bill_overdue:${b.id}:${d}`, stage: "overdue", level: "alert", what: "bill_not_paid", data: {
        name: clean(b.name), amount: b.amount, was_due: day(d), note: "They send this one themselves, and it isn't marked paid in the app.",
      }});
    }
  }
  // bills the bank paid since the last briefing
  for (const it of ctx.txs) {
    const b = it.type === "expense" && fresh(it) ? bill(it.billId) : undefined;
    if (b) out.push({key: `bill_paid:${b.id}:${it.forDate ?? it.date}`, stage: "paid", level: "info", what: "bill_paid",
      data: {name: clean(b.name), amount: it.amount, paid_on: day(it.date)}});
  }

  // money in: pay that landed, money in nobody's sorted, money expected (not counted until it lands)
  for (const it of ctx.txs) {
    if (it.type !== "income" || !fresh(it)) continue;
    const src = s.incomes.find(x => x.id === it.srcId);
    if (src) out.push({key: `pay_in:${it.id}`, stage: "in", level: "news", what: "pay_arrived", data: {name: clean(src.name), amount: it.amount, landed: day(it.date)}});
    else if (unsorted(it)) out.push({key: `money_in:${it.id}`, stage: "in", level: "news", what: "money_in_not_sorted", data: {
      amount: it.amount, ...clean(it.note) ? {from: clean(it.note)} : {}, landed: day(it.date),
      note: "Not sorted yet: it could be a refund, their own money moved, or income. Ask; don't say which.",
    }});
  }
  for (const x of expected(ctx).filter(x => x.d <= addDays(t, 7)))
    out.push({key: `expected:${x.src.id}:${x.d}`, stage: "coming", level: "info", what: "money_expected",
      data: {name: clean(x.src.name), amount: lowAmt(x.src), on: day(x.d), note: "Not counted until it lands."}});

  // spending: a payment much bigger than usual, and yesterday against a usual day
  const cardish = ctx.txs.filter(it => it.type === "expense" && !it.billId && it.date >= addDays(t, -60));
  const big = Math.max(50, 3 * median(cardish.map(it => it.amount)));
  for (const it of cardish) {
    if (fresh(it) && it.amount >= big) out.push({key: `big:${it.id}`, stage: "seen", level: "news", what: "bigger_payment_than_usual", data: {
      amount: it.amount, ...clean(it.note) ? {who: clean(it.note)} : {}, on: day(it.date),
      category: clean(s.categories.find(x => x.id === it.cat)?.name ?? "General"),
    }});
  }
  const first = ctx.txs.reduce<IsoDate | null>((x, it) => !x || it.date < x ? it.date : x, null), y = addDays(t, -1);
  if (first && first <= addDays(y, -7)) {
    const by = spentByDay(ctx), days: number[] = [];
    for (let d = addDays(y, -28); d < y; d = addDays(d, 1)) if (d >= first) days.push(by[d] || 0);
    out.push({key: `yesterday:${y}`, stage: "seen", level: "info", what: "spent_yesterday", data: {
      on: day(y), spent: r2(by[y] || 0), average_day: r2(days.reduce((a, x) => a + x, 0) / days.length),
      note: `average_day is the last ${days.length} days' spending shared evenly over them, bills left out.`,
    }});
  }

  // things for them to do: payments to sort, a budget spending keeps landing away from, a regular payment that isn't a bill
  const toSort = ctx.txs.filter(it => unsorted(it) && it.date >= addDays(t, -30)).length;
  if (toSort) out.push({key: "unsorted", stage: String(toSort), level: "action", what: "payments_to_sort",
    data: {payments: toSort, note: "Payments the app couldn't place: tapping each one in the app says what it was."}});
  for (const {x} of c.everyday) {
    const hint = budgetHint(ctx, x.id);
    if (hint) out.push({key: `budget:${x.id}`, stage: String(hint.to), level: "action", what: "budget_suggestion",
      data: {name: clean(x.name), monthly_budget: x.budget, suggested: hint.to, why: hint.reason}});
  }
  if (allBanks(s).length) {
    const r = regularsView(ctx, regulars.scan, regulars.answers).open.find(x => x.sure === "likely" && !x.sameAs && !x.partOf);
    if (r) out.push({key: `regular:${r.ref}`, stage: "seen", level: "action", what: "regular_payment_not_in_bills", data: {
      ref: r.ref, paid_to: clean(r.payee), amount: r.amount, how_often: BILL_FREQ[r.freq].toLowerCase(), seen: `${r.n} times, ${day(r.first)} to ${day(r.last)}`,
      note: "A pattern in the bank's payments, not a fact: ask whether it's a bill. If they say yes, add_bill with from_regular.",
    }});
  }
  return out;
}

/** Where a fact stands against what he's said before. */
export function statusOf(f: Fact, log: BriefLog): Status {
  const was = log.said[f.key];
  return !was ? "new" : was.stage !== f.stage ? "changed" : was.told ? "already_said" : "passed_over";
}

/** Whether he has a briefing to give as his tab opens: the first visit of the day. */
export function briefingDue(log: BriefLog, today: IsoDate): BriefKind | null {
  return log.lastDaily !== today ? "daily" : null;
}

/** Each fact with a short id (f1, f2…), so he can say which he mentioned without repeating any key. */
export const idsOf = (facts: Fact[]) => facts.map((f, i) => ({id: `f${i + 1}`, f}));

/** What the app sends him to brief from: inside <app_brief>, as JSON, every figure the engine's. */
export function briefingAsk(kind: BriefKind, facts: Fact[], log: BriefLog): string {
  const body = {
    kind,
    ...log.last?.text ? {last_briefing: {kind: log.last.kind, on: day(isoD(new Date(log.last.at))), said: log.last.text}} : {},
    facts: idsOf(facts).map(({id, f}) => ({id, what: f.what, status: statusOf(f, log), ...f.data})),
  };
  return `<app_brief kind="${kind}">\n${JSON.stringify(body)}\n</app_brief>`;
}

const MENTIONED = /<mentioned>([\s\S]*?)<\/mentioned>/g, NOTHING = /<nothing\s*\/>/;
/** His briefing without its marks: the fact ids he says he mentioned, and whether he said there was nothing worth saying. */
export function mentionedOf(text: string): {text: string; mentioned: string[]; nothing: boolean} {
  const ids = [...text.matchAll(MENTIONED)].pop()?.[1] ?? "";
  const nothing = NOTHING.test(text);
  const shown = text.replace(MENTIONED, "").replace(/<\/?mentioned>/g, "").replace(new RegExp(NOTHING, "g"), "").replace(/\n{3,}/g, "\n\n").trim();
  return {text: shown, mentioned: [...new Set(ids.split("|").map(s => s.trim()).filter(s => /^f\d+$/.test(s)))], nothing};
}

/** What's kept once a briefing is shown: each fact he was given at its stage, said or passed over (said before at the same stage
 *  stays said), and anything not seen for 30 days forgotten. */
export function logBrief(log: BriefLog, kind: BriefKind, facts: Fact[], mentioned: string[], text: string, now: number, today: IsoDate): BriefLog {
  const said: Record<string, Said> = {};
  for (const [k, v] of Object.entries(log.said)) if (addDays(v.at, KEEP_DAYS) > today) said[k] = v;
  for (const {id, f} of idsOf(facts)) {
    const was = log.said[f.key];
    said[f.key] = {stage: f.stage, at: today, told: mentioned.includes(id) || (!!was?.told && was.stage === f.stage)};
  }
  return {...log, said, lastAt: now, ...kind === "daily" ? {lastDaily: today} : {}, last: {kind, at: now, text}};
}
