// What Tim and Frank can look up, run here on the phone where the money is. Each tool wraps the engine, so its figures are the
// ones the app shows, and says where they come from (the bank and when, what you typed in, an estimate or an assumption).
// Read only, apart from their notes: add_bill, change_bill and remove_bill only propose a card (lib/billChange.ts), and the app
// makes the change once you've said yes to it. They answer in small JSON; what leaves the phone is only what a question needed.
// Never in a result: account numbers, sort codes, bank or payment ids, tokens or logos (a bill's id is the app's own, as a
// note's is); payee names and notes lose any run of 6+ digits. A day of the month goes as words ("15th of every month"),
// never a bare number, since every number in a result counts as a £ figure he can state (lib/ai/check.ts).
// The names and arguments match supabase/functions/accountant/prompt.ts.
import {allBanks, aside} from "../banks";
import {cardLine, FREQS, proposeAdd, proposeChange, proposeRemove, Refused, type BillArgs, type Proposal} from "../billChange";
import {BILL_FREQ, billDated, billDates, billMonthly, billPaid, billWhenLong, METHOD_META, nextBill} from "../bills";
import {budgetHint} from "../budget";
import {calc, expected, forecast, gapLine, hero, type Hero} from "../calc";
import {addDays, dayDiff, isoD, longDate, niceDate, nowHM, pad, parseD, shortDay} from "../dates";
import {SPEND_FREQ} from "../everyday";
import {ciKey, FREQ, isReceived, lowAmt, mainIncome, occurrences, usualAmt} from "../income";
import {money, newestFirst, r2} from "../money";
import {unsorted} from "../payments";
import {billChanges, regularsView, sameKind, type Answers, type Scan} from "../regulars";
import type {AppState, Bill, BillFreq, Ctx, Income, IsoDate, Tx} from "../types";
import {whatIf} from "../today";
import {checkOffers, CONDITIONS, notPassed, pickOf, totalOf, type Condition, type OfferClaim, type Pages, type PurchaseClaim, type Research} from "./research";
import {sum} from "./sum";

export type Who = "tim" | "frank";

export type NoteKind = "goal" | "plan" | "preference" | "circumstance";
/** Something you told them that will still matter next time. `who` noted it; `at` is when. */
export interface Note { id: string; kind: NoteKind; text: string; amount?: number; by?: IsoDate; at: IsoDate; who: Who }
export const NOTE_KINDS: NoteKind[] = ["goal", "plan", "preference", "circumstance"];
export const MAX_NOTES = 50, NOTE_LEN = 120;

export const TOOL_NAMES = ["overview", "upcoming", "bills", "regulars", "everyday", "spending", "payments", "what_if", "forecast", "calculate", "remember", "forget",
  "add_bill", "change_bill", "remove_bill", "check_purchase"] as const;
export type ToolName = typeof TOOL_NAMES[number];
export const isTool = (name: string): name is ToolName => (TOOL_NAMES as readonly string[]).includes(name);

/** What they're doing, for the line where the answer will go. */
export const DOING: Record<ToolName, string> = {
  overview: "Checking your numbers…", upcoming: "Looking at what's due…", bills: "Looking at your bills…", regulars: "Going through your payments…",
  everyday: "Looking at your everyday budgets…", spending: "Adding up your spending…", payments: "Looking through your payments…", what_if: "Trying it out…",
  forecast: "Looking at the days ahead…", calculate: "Doing the sums…", remember: "Making a note…", forget: "Crossing out a note…",
  add_bill: "Writing it up…", change_bill: "Writing it up…", remove_bill: "Writing it up…", check_purchase: "Checking the shops' pages…",
};
// what an answer was checked against, for the line under it; notes aren't money. check_purchase counts as the what_if it ran, when it ran one
const CHECKED: Record<ToolName, string | null> = {
  overview: "your numbers", upcoming: "what's due", bills: "your bills", regulars: "your bank's payments", everyday: "your budgets",
  spending: "your spending", payments: "your payments", what_if: "a what if", forecast: "the days ahead", calculate: "a sum", remember: null, forget: null,
  add_bill: "your bills", change_bill: "your bills", remove_bill: "your bills", check_purchase: null,
};

/** The bank's payments looked through for regular ones (lib/regulars.ts), and what you've said about them. */
export interface RegularsEnv { scan: Scan | null; answers: Answers }
/** Everything a tool needs. `newId` names a new note. `pages` and `now`: the shops' pages he's opened, for check_purchase, and
 *  `checked`: how many times it's run for this question (converse gives them). */
export interface ToolEnv { ctx: Ctx; notes: Note[]; who: Who; newId: () => string; regulars: RegularsEnv; pages?: Pages; now?: Date; checked?: number }
/** A note to save or remove: the tool only says so, the store does it. A change to your bills: only ever a card for you to say yes to. */
export type ToolEffect = {add: Note} | {remove: Note} | {propose: Proposal};
/** A tool's answer for the accountant, whether it went wrong (`error`: his arguments didn't make sense), and a note to save or remove.
 *  `research`: what check_purchase kept, for the card on the answer; `ran`: it ran the engine on the one he went by. */
export interface ToolOut { result: unknown; error?: true; effect?: ToolEffect; research?: Research; ran?: true; waiting?: true }

class Bad extends Error {}
type Args = Record<string, unknown>;

const MAX_AHEAD = 62;
// a date for the accountant: the ISO date (to pass back to a tool) and its weekday, so he never has to work one out
const day = (d: IsoDate) => `${d} ${shortDay(d)}`;
const isIso = (v: unknown): v is IsoDate => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && isoD(parseD(v)) === v;
const stamp = (iso: string) => { const d = new Date(iso); return `${niceDate(isoD(d))} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** A payee name or note, safe to send: no runs of 6 or more digits (account numbers, sort codes, references), and short. */
export const clean = (s: string) => s.replace(/\d(?:[\s-]?\d){5,}/g, "•••").replace(/\s+/g, " ").trim().slice(0, 60);

function dateArg(a: Args, k: string, nullable: boolean): IsoDate | null {
  const v = a[k];
  if (v == null && nullable) return null;
  if (!isIso(v)) throw new Bad(`${k} must be a date like 2026-10-30.`);
  return v;
}
function numArg(a: Args, k: string, lo: number, hi: number, nullable = false): number | null {
  const v = a[k];
  if (v == null && nullable) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) throw new Bad(`${k} must be a number from ${lo} to ${hi}.`);
  return v;
}
function strArg(a: Args, k: string, nullable = false): string | null {
  const v = a[k];
  if (v == null && nullable) return null;
  if (typeof v !== "string" || !v.trim()) throw new Bad(`${k} must be some text.`);
  return v.trim();
}
/** The last day to look at: given, or `fallback`; never before tomorrow (or today) nor more than 62 days on. */
function until(ctx: Ctx, to: IsoDate | null, fallback: IsoDate, from = ctx.today): IsoDate {
  const end = to ?? fallback, last = addDays(ctx.today, MAX_AHEAD);
  if (end < from) throw new Bad(`to can't be before ${from}.`);
  return end > last ? last : end;
}

const NO_NUMBER: Record<Exclude<Hero["kind"], "number">, string> = {
  "no-income": "No pay is set up yet, so there's no daily amount. The person can add their pay in Settings.",
  "payday-today": "Today is payday. The daily amount starts again once today's pay is confirmed in the app.",
  "no-payday": "There's no payday coming up in the app, so there's no daily amount. A regular income in Settings gives one.",
};

/** Where the figures come from, in plain sentences. */
function sources(s: AppState): string[] {
  const banks = allBanks(s);
  return [
    banks.length
      ? `Spending money is from ${banks.map(b => `${b.source} (synced ${stamp(b.asOf)})`).join(" and ")}, plus anything logged since.`
      : `Spending money is the balance the person typed in on ${day(s.balanceAsOf)}, plus payments logged in the app since. No bank is connected.`,
    banks.length ? "Payments are imported from the bank, plus any added by hand." : "Payments are the ones added by hand.",
    "Pay, bills and everyday budgets are what the person set up in the app.",
  ];
}

/** How fresh the figures are, for the line under an answer: "Monzo, 09:12", or when you typed your balance in. */
export function freshness(s: AppState, now: Date): string {
  const banks = allBanks(s);
  if (!banks.length) return `your balance from ${niceDate(s.balanceAsOf)}`;
  const latest = banks.reduce((a, b) => b.asOf > a.asOf ? b : a);
  const d = new Date(latest.asOf), when = isoD(d) === isoD(now) ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : niceDate(isoD(d));
  return `${banks.length > 1 ? "your banks" : latest.source}, ${when}`;
}

/** The line under an answer: what it was checked against. Null when it didn't look anything up. `searched`: he searched the web
 *  too, so this only speaks for your own figures, and a price from there is never made to sound checked against your bank. */
export function receipt(used: ToolName[], s: AppState, now: Date, searched = false): string | null {
  const seen = [...new Set(used.map(t => CHECKED[t]).filter((x): x is string => !!x))];
  if (!seen.length) return null;
  if (seen[0] !== "a sum") seen[0] += ` (${freshness(s, now)})`;
  return `${searched ? "Your figures checked" : "Checked"} against ${seen.join(" · ")}`;
}

function payOf(src: Income) {
  return {
    name: clean(src.name), how_often: FREQ[src.freq].toLowerCase(),
    ...src.varies ? {varies: true, low: src.low ?? 0, typical: src.typical ?? src.low ?? 0, counted_as: lowAmt(src)} : {amount: src.amount ?? 0},
    ...src.rate ? {take_home_per_hour: src.rate} : {},
  };
}

function overview({ctx}: ToolEnv) {
  const c = calc(ctx), h = hero(ctx, c), src = mainIncome(ctx), s = ctx.state;
  const free = r2(c.balance - c.billsLeft - c.everydayLeft - c.savingHeld);
  return {
    today: day(ctx.today),
    figures_from: sources(s),
    today_amount: h.kind === "number"
      ? {amount: h.perDay, spent_today: h.spentToday, left_today: h.left, in_the_app: h.reason}
      : {none: NO_NUMBER[h.kind]},
    until_payday: {
      payday: c.payday ? day(c.payday) : null, days_to_payday: c.daysLeft,
      ...c.late ? {pay_is_late: "The last payday passed with no pay, so payday is assumed to be a week away. That's an assumption."} : {},
      spending_money: c.balance,
      held_for_bills: c.billsLeft, held_for_everyday: c.everydayLeft, held_for_savings: c.savingHeld,
      free_until_payday: Math.max(0, free),
      ...free < 0 ? {still_needed_for_bills_and_everyday: -free, in_the_app: gapLine(ctx, c, -free)} : {},
    },
    in_savings_pots: {amount: aside(s), note: "Not spending money."},
    pay: src ? payOf(src) : null,
    saving_a_month: s.saving ?? 0,
  };
}

function upcoming({ctx}: ToolEnv, a: Args) {
  const c = calc(ctx), t = ctx.today, s = ctx.state;
  const end = until(ctx, dateArg(a, "to", true), c.payday ?? addDays(t, 30));
  const live = s.bills.filter(b => b.amount > 0);
  const bills = live.filter(billDated).flatMap(b => billDates(b, t, end).map(d => ({
    d, row: {date: day(d), name: clean(b.name), amount: b.amount, paid: billPaid(ctx, b, d), ...b.method ? {how: METHOD_META[b.method]} : {}, ...b.varies ? {varies: true} : {}},
  }))).sort((x, y) => x.d < y.d ? -1 : 1).map(x => x.row);
  const src = mainIncome(ctx);
  const paydays = src && src.freq !== "oneoff" && !c.late
    ? occurrences(src, t, end).filter(d => !isReceived(ctx, src.id, d) && !s.skipped[ciKey(src.id, d)])
      .map(d => ({date: day(d), name: clean(src.name), amount: lowAmt(src), ...src.varies ? {usually: usualAmt(src)} : {}}))
    : [];
  return {
    from: day(t), to: day(end),
    bills,
    ...live.some(b => !billDated(b)) ? {bills_without_a_date: live.filter(b => !billDated(b)).map(b => ({name: clean(b.name), a_month: r2(billMonthly(b)), how_often: BILL_FREQ[b.freq].toLowerCase()})),
      bills_without_a_date_note: "Never put on a day: a month's share is held back each pay until a payment for it lands."} : {},
    ...s.bills.some(b => !(b.amount > 0)) ? {bills_with_no_amount_yet: s.bills.filter(b => !(b.amount > 0)).map(b => clean(b.name))} : {},
    ...c.billsAhead.some(x => x.held > 0) ? {saving_up_for: c.billsAhead.filter(x => x.held > 0).map(x => ({name: clean(x.b.name), due: day(x.d), amount: x.b.amount, held_so_far: x.held}))} : {},
    money_expected: expected(ctx).filter(x => x.d <= end).map(x => ({date: day(x.d), name: clean(x.src.name), amount: lowAmt(x.src), note: "Not counted until it lands."})),
    paydays,
    ...c.late && c.payday ? {pay_is_late: `The last payday passed with no pay; payday is assumed to be ${day(c.payday)}. That's an assumption.`} : {},
    held_back_now_for_bills: c.billsLeft,
  };
}

const NO_DATE = "No payment date: a month's share is held back each pay until a payment for it lands.";

function bills({ctx}: ToolEnv) {
  const c = calc(ctx), t = ctx.today, s = ctx.state;
  const end = c.payday ? addDays(c.payday, -1) : addDays(t, 30);
  const regular = s.bills.filter(b => b.freq !== "oneoff"), oneOffs = s.bills.filter(b => b.freq === "oneoff");
  // this pay cycle's due dates, paid or not; one with no date is paid once a payment for it lands in the cycle
  const cycle = (b: Bill) => billDated(b)
    ? billDates(b, c.cycleFrom, end).map(d => `${billPaid(ctx, b, d) ? "paid" : d < t ? "not paid" : "due"} ${day(d)}`)
    : [ctx.txs.some(it => it.billId === b.id && it.date >= c.cycleFrom) ? "paid" : "not paid yet"];
  const monthly = regular.filter(b => b.amount > 0).reduce((x, b) => x + billMonthly(b), 0);
  return {
    bills: regular.map(b => {
      const next = billDated(b) ? nextBill(b, t) : null;
      return {
        id: b.id, name: clean(b.name), ...b.amount > 0 ? {amount: b.amount} : {no_amount_yet: true}, ...b.varies ? {varies: true} : {},
        how_often: BILL_FREQ[b.freq].toLowerCase(), when: billWhenLong(b, t) ?? NO_DATE, ...b.method ? {how: METHOD_META[b.method]} : {},
        ...next ? {next_due: day(next)} : {}, this_pay_cycle: cycle(b),
        ...b.amount > 0 ? {a_month: r2(billMonthly(b)), a_year: r2(billMonthly(b) * 12)} : {},
        ...b.payee ? {paid_to: clean(b.payee)} : {},
      };
    }),
    ...oneOffs.length ? {one_offs: oneOffs.map(b => ({id: b.id, name: clean(b.name), ...b.amount > 0 ? {amount: b.amount} : {no_amount_yet: true}, ...b.date ? {on: day(b.date)} : {}}))} : {},
    totals: {a_month: r2(monthly), a_year: r2(monthly * 12), note: "Every bill but one-offs. Weekly, quarterly and yearly bills are spread evenly over the year; one with no amount yet counts as nothing."},
  };
}

function regulars({ctx, regulars: {scan, answers}}: ToolEnv) {
  const v = regularsView(ctx, scan, answers), t = ctx.today, top = v.open.slice(0, 10);
  const changes = billChanges(ctx).map(x => x.kind === "price"
    ? {bill_id: x.b.id, name: clean(x.b.name), change: "new price", bill_says: x.b.amount, latest_payment: x.paid, paid_on: day(x.on)}
    : {bill_id: x.b.id, name: clean(x.b.name), change: "not paid", was_due: day(x.due), note: "Nothing from the bank near this date: it may have stopped, been paid another way, or be late."});
  return {
    ...scan?.from ? {looked_through: {from: day(scan.from), to: day(scan.at)}} : {},
    ...v.none ? {none: v.none} : {}, ...v.note ? {history_note: v.note} : {},
    not_in_bills: top.map(r => ({
      ref: r.ref, paid_to: clean(r.payee), amount: r.amount, ...r.varies ? {varies: true, last_amounts: r.amounts} : {},
      how_often: BILL_FREQ[r.freq].toLowerCase(), when: billWhenLong(r, t), how: METHOD_META[r.method],
      seen: `${r.n} times, ${day(r.first)} to ${day(r.last)}`, sure: r.sure,
      ...r.sameAs ? {maybe_same_as: {bill_id: r.sameAs.id, name: clean(r.sameAs.name)}} : {},
      ...r.partOf ? {maybe_part_of: {bill_id: r.partOf.id, name: clean(r.partOf.name)}} : {},
    })),
    ...v.open.length > top.length ? {more_not_shown: `${v.open.length - top.length} more, smaller`} : {},
    changes,
    two_of_a_kind: sameKind([...ctx.state.bills.flatMap(b => [b.name, b.payee ?? ""]), ...(scan?.found ?? []).map(r => r.payee)]),
    note: "Patterns in the bank's payments: suggestions, not bills. Nothing is a bill until the person says so. sure \"maybe\" is a weaker pattern (only 2 payments).",
  };
}

function everyday({ctx}: ToolEnv) {
  const c = calc(ctx);
  return {
    pay_cycle: {from: day(c.cycleFrom), to: c.payday ? day(addDays(c.payday, -1)) : null},
    budgets: c.everyday.map(({x, spent, left}) => {
      const hint = budgetHint(ctx, x.id);
      return {
        name: clean(x.name), monthly_budget: x.budget, spent_this_pay_cycle: spent, left: Math.max(0, left), ...left < 0 ? {past_it_by: -left} : {},
        ...x.usual ? {usually_spends: `${money(x.usual.amount)} ${SPEND_FREQ[x.usual.freq].toLowerCase()}`} : {},
        ...hint ? {suggested_budget: hint.to, why: hint.reason} : {},
      };
    }),
    note: "Budgets are amounts the person chose for themselves: an estimate of what they'll spend, held back from what's free.",
  };
}

const catName = (s: AppState, it: Tx) => {
  const id = it.refundOf ?? it.cat;
  if (id === "monzo-in") return "Money in, not sorted yet";
  if (id === "savings") return "Savings";
  return clean(s.categories.find(x => x.id === id)?.name ?? s.incomes.find(x => x.id === id)?.name ?? s.bills.find(b => b.id === it.billId)?.name ?? id);
};

/** The first and last day of a look back at payments: not after today, at most a year and a bit. */
function range(ctx: Ctx, a: Args) {
  const from = dateArg(a, "from", false)!, asked = dateArg(a, "to", false)!;
  const to = asked > ctx.today ? ctx.today : asked;
  if (from > to) throw new Bad("from must be on or before to, and not after today.");
  if (dayDiff(from, to) > 400) throw new Bad("That's more than a year: ask for a shorter stretch.");
  const first = ctx.txs.reduce<IsoDate | null>((x, it) => !x || it.date < x ? it.date : x, null);
  return {from, to, ...first && from < first ? {note: `Payments in the app only go back to ${day(first)}.`} : !first ? {note: "There are no payments in the app yet."} : {}};
}

function spending({ctx}: ToolEnv, a: Args) {
  const r = range(ctx, a), by = a.by;
  if (by !== "category" && by !== "payee") throw new Bad("by must be category or payee.");
  const totals = new Map<string, {amount: number; payments: number}>();
  let saved = 0;
  for (const it of ctx.txs) {
    if (it.date < r.from || it.date > r.to) continue;
    if (it.type === "save") { saved += it.amount; continue; }
    const refund = it.type === "income" && !!it.refundOf;
    if (it.type !== "expense" && !refund) continue;
    const key = by === "category" ? catName(ctx.state, it) : clean(it.note) || "(no name)";
    const g = totals.get(key) ?? {amount: 0, payments: 0};
    g.amount += refund ? -it.amount : it.amount;
    if (!refund) g.payments++;
    totals.set(key, g);
  }
  const groups = [...totals].map(([name, g]) => ({name, amount: r2(Math.max(0, g.amount)), payments: g.payments}))
    .filter(g => g.amount > 0).sort((x, y) => y.amount - x.amount);
  const top = groups.slice(0, 15), rest = groups.slice(15);
  return {
    from: day(r.from), to: day(r.to), ...r.note ? {note: r.note} : {},
    total_spent: r2(groups.reduce((x, g) => x + g.amount, 0)),
    [by === "category" ? "by_category" : "by_payee"]: top,
    ...rest.length ? {everything_else: {amount: r2(rest.reduce((x, g) => x + g.amount, 0)), groups: rest.length}} : {},
    ...saved ? {moved_to_savings: r2(saved)} : {},
    refunds: "Taken off what they refunded.",
  };
}

function payments({ctx}: ToolEnv, a: Args) {
  const r = range(ctx, a), s = ctx.state;
  const cat = strArg(a, "category", true)?.toLowerCase(), search = strArg(a, "search", true)?.toLowerCase();
  const limit = Math.floor(numArg(a, "limit", 1, 40, true) ?? 20);
  const found = ctx.txs.filter(it => it.date >= r.from && it.date <= r.to
    && (!cat || it.cat.toLowerCase() === cat || catName(s, it).toLowerCase() === cat)
    && (!search || it.note.toLowerCase().includes(search) || !!s.bills.find(b => b.id === it.billId)?.name.toLowerCase().includes(search)))
    .sort(newestFirst);
  return {
    from: day(r.from), to: day(r.to), ...r.note ? {note: r.note} : {},
    found: found.length, shown: Math.min(found.length, limit),
    payments: found.slice(0, limit).map(it => {
      const bill = s.bills.find(b => b.id === it.billId);
      return {
        date: day(it.date), amount: it.amount,
        kind: it.type === "expense" ? "out" : it.type === "save" ? "to savings" : it.refundOf ? "refund" : it.srcId ? "pay" : "in",
        ...clean(it.note) ? {who: clean(it.note)} : {}, category: catName(s, it), ...bill ? {bill: clean(bill.name)} : {},
        ...unsorted(it) ? {not_sorted_yet: true} : {},
      };
    }),
  };
}

function whatIfTool({ctx}: ToolEnv, a: Args) {
  const amount = r2(numArg(a, "amount", 0.01, 1_000_000)!);
  const c = calc(ctx), h = hero(ctx, c), w = whatIf(ctx, amount);
  if (h.kind !== "number" || !w || !c.daysLeft) return {amount, none: h.kind !== "number" ? NO_NUMBER[h.kind] : "There's no daily amount to try it against."};
  const days = c.daysLeft, perDay = (free: number) => days > 1 ? Math.max(0, Math.floor(free / (days - 1))) : null;
  return {
    amount, payday: c.payday ? day(c.payday) : null, days_to_payday: days,
    now: {todays_amount: h.perDay, left_today: h.left, free_until_payday: Math.max(0, h.free), per_day_from_tomorrow: perDay(h.free)},
    after_it: {
      left_today: w.hero.left, free_until_payday: Math.max(0, w.hero.free), per_day_from_tomorrow: w.hero.free < 0 ? 0 : perDay(w.hero.free),
      ...w.hero.free < 0 ? {still_needed_for_bills_and_everyday: -w.hero.free} : {},
    },
    in_the_app: w.line,
  };
}

// what check_purchase was given, or why it makes no sense
function claimArg(a: Args): PurchaseClaim {
  const product = strArg(a, "product")!, offers = a.offers, identifies = a.identifies;
  if (!Array.isArray(identifies) || !identifies.every(i => typeof i === "string")) throw new Bad("identifies must be a list of the words that make it this product.");
  if (!Array.isArray(offers) || !offers.length) throw new Bad("offers must list what you found, at least one.");
  return {product, assumed: typeof a.assumed === "string" ? a.assumed : "", identifies, offers: offers.map((o: Args): OfferClaim => ({
    seller: strArg(o, "seller")!, url: strArg(o, "url")!, price: numArg(o, "price", 0, 10_000_000)!,
    condition: CONDITIONS.includes(o.condition as Condition) ? o.condition as Condition : "new", delivery: numArg(o, "delivery", 0, 100_000, true), pick: o.pick === true,
  }))};
}

// A price from the web reaches your money only through here: the pages he opened are read against what he says they show, and the
// engine runs on the one he went by, only if a page backs it. Nothing a page didn't back goes back in a number or a £, since every
// figure in a result counts as one he can state (lib/ai/check.ts); `why` and his words have no £ for the same reason.
function checkPurchase(env: ToolEnv, a: Args): ToolOut {
  const pages = env.pages ?? {open: new Map(), waiting: new Set()}, claim = claimArg(a), {research, rejected, waiting} = checkOffers(claim, pages, env.now ?? new Date());
  const pick = pickOf(research), not_confirmed = rejected.map(r => ({seller: r.seller, why: r.why, ...r.pick ? {you_went_by_it: true} : {}}));
  // asked for beside this call: those pages open on the next request, so nothing's decided yet
  if (waiting && !pick) return {result: {do_next: "Those pages are still opening: call check_purchase again now, with nothing beside it."}, waiting: true};
  const confirmed = research?.offers.map(o => ({seller: o.seller, price: o.price, condition: o.condition, ...o.delivery === "free" ? {delivery: "free"} : o.delivery !== undefined ? {delivery: o.delivery} : {},
    ...o.from ? {starting_price: true} : {}, ...o.unshown ? {not_shown_with_price: o.unshown} : {}, ...o.pick ? {went_by: true} : {}})) ?? [];
  // shops he opened for this question and left out: each could have had the price
  const left = notPassed(claim, pages), opened = left.length ? {opened_not_passed: left} : {};
  if (!pick) {
    const again = left.length && !env.checked;
    return {result: {confirmed, not_confirmed, ...opened,
      do_next: again ? "None of those shows it at that price. Call check_purchase once more, with an offer from each of the other shops' pages you opened that shows the product and a price; don't search or open anything new."
        : "No shop's own page you opened shows it at a price to go by. Don't call this again unless you've opened another shop's page. Otherwise give it as an estimate from a search result you cite, with no yes or no on it and nothing about what it would do to their money, and say you couldn't confirm a price."},
    ...research ? {research} : {}};
  }
  const amount = totalOf(pick), caveats = [
    pick.from ? "It's a starting price: write \"from\" with it, and say the version they'd want may cost more." : "",
    pick.unshown ? `The page doesn't show ${pick.unshown.join(", ")} with that price: don't say that spec costs that.` : "",
  ].filter(Boolean).join(" ");
  return {
    result: {confirmed, not_confirmed, ...opened,
      went_by: {seller: pick.seller, price: pick.price, with_delivery: amount, ...pick.from ? {starting_price: true} : {}, ...pick.unshown ? {not_shown_with_price: pick.unshown} : {}},
      what_if: whatIfTool(env, {amount}), overview: overview(env),
      do_next: `Answer now: the card shows ${research!.offers.length === 1 ? "the one shop" : "the shops"} and links their pages, so don't list them. ${caveats ? `${caveats} ` : ""}${not_confirmed.length ? "Leave out the prices not confirmed, or call them estimates. " : ""}Answer can, afford and should from these figures.`},
    research: research!, ran: true,
  };
}

function forecastTool({ctx}: ToolEnv, a: Args) {
  const c = calc(ctx), h = hero(ctx, c), t = ctx.today;
  if (h.kind !== "number") return {none: NO_NUMBER[h.kind]};
  const end = until(ctx, dateArg(a, "to", true), c.payday ? addDays(c.payday, 1) : addDays(t, 14), addDays(t, 1));
  const src = mainIncome(ctx);
  const paydays = new Set(src && src.freq !== "oneoff" ? occurrences(src, t, end) : []);
  const days: object[] = [];
  let stopped: string | null = null;
  for (let d = addDays(t, 1); d <= end; d = addDays(d, 1)) {
    const f = forecast(ctx, c, d);
    if (!f) { stopped = `No figure from ${day(d)}: ${c.late ? "pay is late, so what happens after the assumed payday isn't known" : "there's no next payday to count to"}.`; break; }
    days.push({date: day(d), safe_to_spend: f.amount, ...paydays.has(d) && !c.late ? {payday: true} : {}, ...f.free < 0 ? {still_needed: -f.free} : {}});
  }
  return {
    days, ...stopped ? {stopped} : {},
    note: "An estimate: it assumes each day's amount is spent until then, pay lands on its day at its low amount, and bills go out on their dates.",
  };
}

function remember({notes, who, newId, ctx}: ToolEnv, a: Args): ToolOut {
  const kind = a.kind as NoteKind;
  if (!NOTE_KINDS.includes(kind)) throw new Bad(`kind must be one of ${NOTE_KINDS.join(", ")}.`);
  const text = strArg(a, "text")!.replace(/\s+/g, " ").slice(0, NOTE_LEN);
  const amount = numArg(a, "amount", 0, 10_000_000, true), by = dateArg(a, "by", true);
  if (notes.length >= MAX_NOTES) throw new Bad(`There are already ${MAX_NOTES} notes. Forget one that's no longer true first.`);
  const note: Note = {id: newId(), kind, text, ...amount != null ? {amount: r2(amount)} : {}, ...by ? {by} : {}, at: ctx.today, who};
  return {result: {saved: {id: note.id, text: note.text}, note: "The person sees that you noted it, and can delete it in Settings."}, effect: {add: note}};
}

function forget({notes}: ToolEnv, a: Args): ToolOut {
  const id = strArg(a, "id")!, note = notes.find(n => n.id === id);
  if (!note) throw new Bad(`There's no note with id ${id}.`);
  return {result: {forgotten: note.text}, effect: {remove: note}};
}

function billArgs(a: Args): BillArgs {
  const howOften = a.how_often == null ? null : a.how_often as BillFreq;
  if (howOften && !FREQS.includes(howOften)) throw new Bad(`how_often must be one of ${FREQS.join(", ")}.`);
  if (a.varies != null && typeof a.varies !== "boolean") throw new Bad("varies must be true, false or null.");
  return {
    name: strArg(a, "name", true), amount: numArg(a, "amount", 0.01, 1_000_000, true), howOften,
    day: numArg(a, "day_of_month", 1, 31, true), date: dateArg(a, "next_date", true), varies: a.varies as boolean | null, fromRegular: strArg(a, "from_regular", true),
  };
}
// a card for the person, never a change: the app makes it once they say yes
const propose = (ctx: Ctx, p: Proposal): ToolOut => ({
  result: {card: cardLine(ctx, p), saved: false, note: "Shown to the person as a card. Nothing is saved until they tap it or say yes, so don't say it's done: ask them to check it."},
  effect: {propose: p},
});

/** Runs one tool. A tool asked for with arguments that don't make sense says what's wrong, so he can try again. */
export function runTool(name: string, input: unknown, env: ToolEnv): ToolOut {
  const a = (input && typeof input === "object" ? input : {}) as Args;
  try {
    switch (isTool(name) ? name : null) {
      case "overview": return {result: overview(env)};
      case "upcoming": return {result: upcoming(env, a)};
      case "bills": return {result: bills(env)};
      case "regulars": return {result: regulars(env)};
      case "everyday": return {result: everyday(env)};
      case "spending": return {result: spending(env, a)};
      case "payments": return {result: payments(env, a)};
      case "what_if": return {result: whatIfTool(env, a)};
      case "forecast": return {result: forecastTool(env, a)};
      case "calculate": {
        const expression = strArg(a, "expression")!, r = sum(expression);
        if ("error" in r) throw new Bad(r.error);
        return {result: {expression, result: r.value}};
      }
      case "remember": return remember(env, a);
      case "forget": return forget(env, a);
      case "add_bill": return propose(env.ctx, proposeAdd(env.ctx, env.regulars.scan, billArgs(a), env.newId()));
      case "change_bill": return propose(env.ctx, proposeChange(env.ctx, env.regulars.scan, strArg(a, "bill_id")!, billArgs(a)));
      case "remove_bill": return propose(env.ctx, proposeRemove(env.ctx, strArg(a, "bill_id")!));
      case "check_purchase": return checkPurchase(env, a);
      default: return {result: {error: `There's no tool called ${name}.`}, error: true};
    }
  } catch (e) {
    if (e instanceof Bad || e instanceof Refused) return {result: {error: e.message}, error: true};
    console.warn(`${name} failed:`, e instanceof Error ? e.message : e);
    return {result: {error: "That didn't work. Try another way."}, error: true};
  }
}

/**
 * What the app tells him at the start of each question, inside <app_context>: the date and time, and at the start of a
 * conversation (`notes` given) what you've told him before, and `extra`: what you did with his cards since your last message.
 */
export function appContext(now: Date, notes: Note[] | null, extra: string[] = []): string {
  const t = isoD(now);
  const lines = [`Now: ${t} (${longDate(t)} ${t.slice(0, 4)}), ${nowHM(now)}.`, ...extra];
  if (notes) {
    lines.push(notes.length ? "Your notes from earlier conversations, all things the person told you:" : "You have no notes from earlier conversations.");
    for (const n of notes) {
      const extra = [n.amount != null ? money(n.amount) : "", n.by ? `by ${day(n.by)}` : ""].filter(Boolean).join(" ");
      lines.push(`- [${n.id}] ${n.text}${extra ? ` (${extra})` : ""}. A ${n.kind}, noted ${day(n.at)}.`);
    }
  }
  return `<app_context>\n${lines.join("\n")}\n</app_context>`;
}
