// A change to your bills that Tim or Frank proposes in the chat: add one, change one, or remove one. It's only ever a card you
// look at first: nothing is saved until you tap it (or say yes with it open), and the app makes the change, never the AI.
// The card shows exactly what changes and what it does to today's amount, from the app's own engine.
// A bill added or changed takes the payments from the bank this pay cycle that paid it (`filingsFor`), so one that already went out
// isn't spending and a bill still to pay at once. Pure: your money and the bank's last look are passed in.
import {BILL_FREQ, billWhenLong, METHOD} from "./bills";
import {calc, hero} from "./calc";
import {isoD, niceDate, parseD} from "./dates";
import {keyOf} from "./found";
import {cycleStart} from "./income";
import {billMatch, paidTo} from "./monzo";
import {money, r2} from "./money";
import type {FilingPatch} from "./payments";
import type {Scan} from "./regulars";
import type {Bill, BillFreq, Ctx, IsoDate, Tx} from "./types";

export type Proposal =
  | {kind: "add"; bill: Bill; ref?: string}
  | {kind: "change"; before: Bill; after: Bill; ref?: string}
  | {kind: "remove"; bill: Bill};

/** What he can ask for, as the tools pass it: null is "not given" (for a change: "leave it as it is"). */
export interface BillArgs {
  name?: string | null; amount?: number | null; howOften?: BillFreq | null; day?: number | null; date?: IsoDate | null;
  varies?: boolean | null; fromRegular?: string | null;
}
export const FREQS: BillFreq[] = ["weekly", "fortnightly", "fourweekly", "monthly", "quarterly", "yearly", "oneoff"];

/** Why a proposal can't be made, in words for him to act on (ask the person, or use another tool). */
export class Refused extends Error {}

const isIso = (v: unknown): v is IsoDate => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && isoD(parseD(v)) === v;
const describe = (b: Bill) => `${b.name} (${b.amount > 0 ? `${money(b.amount)} ` : ""}${BILL_FREQ[b.freq].toLowerCase()})`;
// a bill you already have for the same thing: the same name, or paid to the same payee
const sameBill = (bills: Bill[], b: Pick<Bill, "id" | "name" | "payee">) => bills.find(x => x.id !== b.id
  && (x.name.trim().toLowerCase() === b.name.trim().toLowerCase() || (!!b.payee && (paidTo(x, b.payee) || (!!x.payee && keyOf(x.payee) === keyOf(b.payee))))));

function regular(scan: Scan | null, ref: string | null | undefined) {
  if (!ref) return null;
  const r = scan?.found.find(x => x.ref === ref);
  if (!r) throw new Refused(`There's no regular payment with ref ${ref}. Use a ref from regulars.`);
  return r;
}

// when it goes out: the day of the month for a monthly bill, a date for the rest; none is allowed (a month's share is held each pay)
function due(b: Bill, a: BillArgs, keep: boolean) {
  if (a.day != null && (!Number.isInteger(a.day) || a.day < 1 || a.day > 31)) throw new Refused("day_of_month must be a whole number from 1 to 31.");
  if (a.date != null && !isIso(a.date)) throw new Refused("next_date must be a date like 2026-11-12.");
  if (b.freq === "monthly") {
    if (a.date != null && a.day == null) throw new Refused("A monthly bill takes day_of_month, not next_date.");
    const day = a.day ?? (keep ? b.day : undefined);
    delete b.date;
    if (day) b.day = day; else delete b.day;
  } else {
    if (a.day != null) throw new Refused("Only a monthly bill takes day_of_month: give next_date for the rest.");
    const date = a.date ?? (keep ? b.date : undefined);
    delete b.day;
    if (date) b.date = date; else delete b.date;
    if (b.freq === "oneoff" && !b.date) throw new Refused("A one-off needs the date it goes out: ask when.");
  }
}

function amountOf(a: BillArgs) {
  if (a.amount == null) return null;
  if (!Number.isFinite(a.amount) || a.amount <= 0 || a.amount > 1_000_000) throw new Refused("amount must be more than 0, in pounds.");
  return r2(a.amount);
}

/** A new bill: what he was told, else what the bank showed (from_regular brings who it's paid to and how). Held back from today on. */
export function proposeAdd(ctx: Ctx, scan: Scan | null, a: BillArgs, id: string): Proposal {
  const r = regular(scan, a.fromRegular);
  const name = (a.name?.trim() || r?.name || "").slice(0, 40);
  if (!name) throw new Refused("Ask what the bill is called.");
  const amount = amountOf(a) ?? r?.amount;
  if (!amount) throw new Refused(`Ask how much ${name} is.`);
  const freq = a.howOften ?? r?.freq;
  if (!freq || !FREQS.includes(freq)) throw new Refused(`Ask how often ${name} goes out.`);
  const bill: Bill = {id, name, amount, freq, from: {kind: "main"}, since: ctx.today};
  // the bank's rule only fits when it's the same how-often
  const seen = r && r.freq === freq ? {day: r.day ?? null, date: r.date ?? null} : {};
  due(bill, {...seen, ...dropNulls({day: a.day, date: a.date})}, false);
  if (a.varies ?? r?.varies) bill.varies = true;
  if (r) Object.assign(bill, {method: r.method, payee: r.payee, source: "bank" as const});
  const twin = sameBill(ctx.state.bills, bill);
  if (twin) throw new Refused(`There's already a bill for this: ${describe(twin)}, id ${twin.id}. Use change_bill to change it, unless they say it's a different one (then give it another name).`);
  return {kind: "add", bill, ...r ? {ref: r.ref} : {}};
}
const dropNulls = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null)) as Partial<T>;

/** A bill changed: only what he gives changes. from_regular ties it to who the bank pays (so its payments are recognised). */
export function proposeChange(ctx: Ctx, scan: Scan | null, id: string, a: BillArgs): Proposal {
  const before = ctx.state.bills.find(b => b.id === id);
  if (!before) throw new Refused(`There's no bill with id ${id}. Look it up with bills.`);
  const r = regular(scan, a.fromRegular);
  const after: Bill = {...before};
  if (a.name?.trim()) after.name = a.name.trim().slice(0, 40);
  const amount = amountOf(a);
  if (amount) after.amount = amount;
  if (a.howOften) { if (!FREQS.includes(a.howOften)) throw new Refused("how_often isn't one the app knows."); after.freq = a.howOften; }
  due(after, a, after.freq === before.freq);
  if (a.varies != null) { if (a.varies) after.varies = true; else delete after.varies; }
  if (r) Object.assign(after, {payee: r.payee, method: r.method, source: "bank" as const});
  if (JSON.stringify(after) === JSON.stringify(before)) throw new Refused("That's what it already is: nothing would change.");
  const twin = sameBill(ctx.state.bills, after);
  if (twin && after.name !== before.name && twin.name.toLowerCase() === after.name.toLowerCase()) throw new Refused(`There's already a bill called ${twin.name}.`);
  return {kind: "change", before, after, ...r ? {ref: r.ref} : {}};
}

export function proposeRemove(ctx: Ctx, id: string): Proposal {
  const bill = ctx.state.bills.find(b => b.id === id);
  if (!bill) throw new Refused(`There's no bill with id ${id}. Look it up with bills.`);
  return {kind: "remove", bill};
}

/** The bill a proposal leaves you with (null: removed), and its id. */
export const billOf = (p: Proposal): Bill | null => p.kind === "add" ? p.bill : p.kind === "change" ? p.after : null;
export const idOf = (p: Proposal) => p.kind === "change" ? p.before.id : p.bill.id;

/** A payment filed against the bill, and how it was before, so Undo can put it back exactly. */
export interface Filing { id: string; patch: FilingPatch; was: FilingPatch; wasAsked: boolean }

/**
 * This pay cycle's payments from the bank that paid this bill (to its payee or by its name, about its amount, near a due date not
 * yet paid: the same test a new payment from the bank gets), and not filed against another bill. Oldest first, each its due date.
 */
export function filingsFor(ctx: Ctx, b: Bill): Filing[] {
  const from = cycleStart(ctx), out: Filing[] = [];
  let txs = ctx.txs;
  const open = ctx.txs.filter(it => it.type === "expense" && it.monzoId && !it.billId && it.date >= from && it.date <= ctx.today)
    .sort((x, y) => x.date.localeCompare(y.date) || x.created - y.created);
  for (const it of open) {
    const m = billMatch({state: {...ctx.state, bills: [b]}, txs: txs.filter(x => x.id !== it.id), today: ctx.today}, it);
    if (!m) continue;
    const patch: FilingPatch = {cat: b.cat || "bills", billId: b.id, ...m.d ? {forDate: m.d} : {}};
    out.push({id: it.id, patch, was: wasOf(it), wasAsked: !!it.needsCat});
    txs = txs.map(x => x.id === it.id ? {...x, ...patch} : x);
  }
  return out;
}
const wasOf = (it: Tx): FilingPatch => ({cat: it.cat, ...it.billId ? {billId: it.billId} : {}, ...it.forDate ? {forDate: it.forDate} : {}, ...it.srcId ? {srcId: it.srcId} : {}, ...it.refundOf ? {refundOf: it.refundOf} : {}});

/** A payment as filed: the patch on, and no longer asked about. */
export function filed(t: Tx, patch: FilingPatch): Tx {
  const n: Tx = {...t, cat: patch.cat};
  for (const k of ["billId", "forDate", "srcId", "refundOf"] as const) { if (patch[k]) n[k] = patch[k]; else delete n[k]; }
  delete n.needsCat;
  return n;
}

/** Your money as it would be with the change made. */
export function applied(ctx: Ctx, p: Proposal, filings: Filing[]): Ctx {
  const id = idOf(p), b = billOf(p), by = new Map(filings.map(f => [f.id, f.patch]));
  const bills = p.kind === "add" ? [...ctx.state.bills, p.bill] : ctx.state.bills.flatMap(x => x.id !== id ? [x] : b ? [b] : []);
  return {...ctx, state: {...ctx.state, bills}, txs: ctx.txs.map(t => by.has(t.id) ? filed(t, by.get(t.id)!) : t)};
}

const perDay = (ctx: Ctx) => { const h = hero(ctx, calc(ctx)); return h.kind === "number" ? h.perDay : null; };
const when = (b: Bill, today: IsoDate) => billWhenLong(b, today) ?? "No payment date yet";
const howMuch = (b: Bill) => `${money(b.amount)}${b.varies ? " (it varies)" : ""} ${BILL_FREQ[b.freq].toLowerCase()}`;

/** What the card shows: what it's for, what changes, payments it takes, and today's amount before and after (null: there's no daily amount). */
export interface ProposalView { title: string; rows: string[]; files: string[]; today: {now: number; then: number} | null; action: string }

export function proposalView(ctx: Ctx, p: Proposal): ProposalView {
  const t = ctx.today, b = billOf(p), files = b ? filingsFor(ctx, b) : [];
  const now = perDay(ctx), then = perDay(applied(ctx, p, files));
  const paid = files.map(f => { const it = ctx.txs.find(x => x.id === f.id)!; return `Its ${money(it.amount)} payment on ${niceDate(it.date)} counts as this bill.`; });
  let rows: string[];
  if (p.kind === "add") rows = [howMuch(p.bill), when(p.bill, t), ...p.bill.method ? [`${METHOD[p.bill.method]}${p.bill.payee ? `, to ${p.bill.payee}` : ""}`] : []];
  else if (p.kind === "remove") rows = [howMuch(p.bill), "Its payments stay as they are."];
  else {
    const x = p.before, y = p.after;
    rows = [
      ...x.name !== y.name ? [`Name: ${x.name} → ${y.name}`] : [],
      ...x.amount !== y.amount || x.freq !== y.freq || !!x.varies !== !!y.varies ? [`${howMuch(x)} → ${howMuch(y)}`] : [],
      ...when(x, t) !== when(y, t) ? [`${when(x, t)} → ${when(y, t)}`] : [],
      ...x.payee !== y.payee && y.payee ? [`Paid to ${y.payee}`] : [],
    ];
  }
  return {
    title: p.kind === "add" ? `Add ${p.bill.name}` : p.kind === "change" ? `Change ${p.before.name}` : `Remove ${p.bill.name}`,
    rows, files: paid, today: now != null && then != null ? {now, then} : null,
    action: p.kind === "add" ? "Add it" : p.kind === "change" ? "Change it" : "Remove it",
  };
}

/** The card in one sentence, for him (its £ figures are ones he can then say). */
export function cardLine(ctx: Ctx, p: Proposal) {
  const v = proposalView(ctx, p);
  const today = v.today ? v.today.now === v.today.then ? ` Today's amount stays ${money(v.today.now)}.` : ` Today's amount would go from ${money(v.today.now)} to ${money(v.today.then)}.` : "";
  return `${v.title}: ${v.rows.join("; ")}.${v.files.length ? ` ${v.files.join(" ")}` : ""}${today}`;
}

/** Why a card can't be applied now (the bill changed or went since, or another one like it was added), or null. */
export function stale(ctx: Ctx, p: Proposal): string | null {
  const now = ctx.state.bills.find(b => b.id === idOf(p));
  if (p.kind === "add") return now ? "That's been added already." : sameBill(ctx.state.bills, p.bill) ? "There's a bill like it now." : null;
  const was = p.kind === "change" ? p.before : p.bill;
  return !now ? "That bill's gone." : JSON.stringify(now) !== JSON.stringify(was) ? "That bill's changed since." : null;
}

const PER: Record<BillFreq, string> = {weekly: "a week", fortnightly: "every 2 weeks", fourweekly: "every 4 weeks", monthly: "a month", quarterly: "every 3 months", yearly: "a year", oneoff: "once"};

/** What he says once it's done, the app having saved it and read it back: the bill as it now is. */
export function doneLine(p: Proposal, who: "tim" | "frank") {
  if (p.kind === "remove") return who === "frank" ? `Done. ${p.bill.name}'s gone from your bills.` : `Done. I've taken ${p.bill.name} out of your bills.`;
  const b = p.kind === "add" ? p.bill : p.after;
  const at = `${money(b.amount)} ${PER[b.freq]}`;
  if (p.kind === "add") return who === "frank" ? `Done. ${b.name}'s in your bills at ${at}.` : `Done. I've added ${b.name} to your bills at ${at}.`;
  return who === "frank" ? `Done. ${b.name}'s now ${at}.` : `Done. I've updated ${b.name}: it's now ${at}.`;
}
/** When you say no: nothing changed. */
export const leftLine = (who: "tim" | "frank") => who === "frank" ? "Fine. Left it as it was." : "No problem. I've left it as it was.";

/** What you decided, for him on your next message (inside <app_context>). */
export function outcomeLine(ctx: Ctx, p: Proposal, how: "done" | "declined" | "unanswered" | "undone") {
  const v = proposalView(ctx, p), what = `${v.title} (${v.rows.join("; ")})`;
  return how === "done" ? `They tapped yes on your card: ${what}. It's saved.`
    : how === "declined" ? `They said no to your card: ${what}. Nothing changed.`
    : how === "undone" ? `They said yes to your card, then undid it: ${what}. Nothing changed.`
    : `They didn't answer your card: ${what}. Nothing changed.`;
}
