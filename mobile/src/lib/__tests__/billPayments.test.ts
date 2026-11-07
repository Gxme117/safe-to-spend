// Payments from the bank recognised as the bills they paid: the bill is no longer held back, and the payment isn't spending as well.
import {runTool} from "@/lib/ai/tools";
import {billPaid} from "@/lib/bills";
import {calc, hero} from "@/lib/calc";
import {livingAction, livingItems} from "@/lib/living";
import {billMatch, importTxs, type RawTx, standIns, unfiledBills} from "@/lib/monzo";
import {fileUnder} from "@/lib/payments";
import type {Bill, Ctx, Tx} from "@/lib/types";
import {baseState, ctx, TODAY, tx} from "./fixtures";

// Mon 5 Oct 2026; pay landed Wed 30 Sep, next on Fri 30 Oct
const NOW = new Date(2026, 9, 5, 14, 0).getTime();
// as setup keeps a bill it found in the bank: who it's paid to, and no category
const energy: Bill = {id: "energy", name: "Octopus Energy", payee: "OCTOPUS ENERGY", amount: 60, freq: "monthly", day: 5, method: "dd", source: "bank", from: {kind: "main"}};
// as setup keeps one you picked and typed in: a name and an amount
const netflix: Bill = {id: "netflix", name: "Netflix", amount: 10.99, freq: "monthly", day: 3, from: {kind: "main"}};
const spotify: Bill = {id: "spotify", name: "Spotify", amount: 10.99, freq: "monthly", day: 3, from: {kind: "main"}};

const withBills = (bills: Bill[], over: Partial<Ctx> = {}): Ctx => ctx({state: baseState({bills, balanceSetAt: NOW}), ...over});
let n = 0;
const ids = () => `new${++n}`;
const raw = (over: Partial<RawTx>): RawTx => ({id: `m${++n}`, amount: -6000, created: "2026-10-05T12:00:00Z", category: "bills", scheme: "bacs", ...over});
/** The bill a payment to `note` would be recognised as paying, or null. */
const match = (b: Bill, note: string, amount = b.amount, date = TODAY) => billMatch(withBills([b]), {amount, date, note})?.b.id ?? null;

test("a payment to the bill's payee, about its amount, is filed against it for that due date", () => {
  const [got] = importTxs(withBills([energy]), [raw({id: "dd", description: "OCTOPUS ENERGY"})], NOW, ids);
  expect(got).toMatchObject({type: "expense", amount: 60, cat: "bills", billId: "energy", forDate: "2026-10-05", monzoId: "dd", note: "OCTOPUS ENERGY"});
  expect(got.needsCat).toBeUndefined();
  // a bill with a category keeps it, as "Mark as paid" does
  const [rent] = importTxs(withBills([{...energy, cat: "rent"}]), [raw({description: "OCTOPUS ENERGY"})], NOW, ids);
  expect(rent).toMatchObject({cat: "rent", billId: "energy"});
});

test("merchant names that differ a little still match; a name that only shares letters doesn't", () => {
  expect(match({...energy, payee: "Octopus Energy"}, "OCTOPUS ENERGY LTD DD 12345678")).toBe("energy");
  expect(match(netflix, "NETFLIX.COM", 10.99, "2026-10-03")).toBe("netflix");   // a typed-in bill, by its name
  expect(match({...energy, name: "Council tax", payee: undefined, amount: 120}, "LB HACKNEY COUNCIL TAX")).toBe("energy");
  expect(match({...energy, name: "Rent", payee: "SMITH J RENT SEP", amount: 650}, "SMITH J RENT OCT")).toBe("energy");   // the month in the reference changes
  expect(match({...energy, name: "Nando's", payee: undefined}, "NANDOS")).toBe("energy");   // apostrophes and all
  // every word of the bill's name has to be there, and as a word
  expect(match({...energy, name: "Amazon Prime", payee: "Amazon Prime", amount: 8.99}, "AMAZON")).toBeNull();
  expect(match({...energy, name: "Rent", payee: undefined, amount: 650}, "RENTOKIL")).toBeNull();
});

test("a bill that varies matches from half to double its amount; a fixed one within 10%", () => {
  const varies = {...energy, varies: true};
  expect(match(varies, "OCTOPUS ENERGY", 95)).toBe("energy");
  expect(match(varies, "OCTOPUS ENERGY", 31)).toBe("energy");
  expect(match(varies, "OCTOPUS ENERGY", 200)).toBeNull();
  expect(match(varies, "OCTOPUS ENERGY", 25)).toBeNull();
  expect(match(energy, "OCTOPUS ENERGY", 66)).toBe("energy");
  expect(match(energy, "OCTOPUS ENERGY", 75)).toBeNull();
  // no amount yet: nothing to go by, so never matched
  expect(match({...energy, amount: 0}, "OCTOPUS ENERGY", 60)).toBeNull();
});

test("the amount and date alone never match, nor the right payee far from a due date or far off the amount", () => {
  expect(match(energy, "PAYPAL *JOHN", 60)).toBeNull();
  expect(match(energy, "Tesco", 60)).toBeNull();
  expect(match(energy, "OCTOPUS ENERGY", 60, "2026-10-20")).toBeNull();
  expect(match(energy, "OCTOPUS ENERGY", 60, "2026-10-09")).toBeNull();   // more than 3 days late
  expect(match(energy, "OCTOPUS ENERGY", 60, "2026-09-28")).toBe("energy");   // a week early is fine
  expect(match(energy, "OCTOPUS ENERGY", 30)).toBeNull();
  const [left] = importTxs(withBills([energy]), [raw({description: "PAYPAL *JOHN"})], NOW, ids);
  expect(left).toMatchObject({cat: "other", needsCat: true});
  expect(left.billId).toBeUndefined();
});

test("two bills of the same amount each get their own payment; when two bills fit one payment, neither is filed", () => {
  const got = importTxs(withBills([netflix, spotify]), [
    raw({id: "s", amount: -1099, created: "2026-10-03T12:00:00Z", category: "entertainment", scheme: "mastercard", merchant: {name: "Spotify P1234ABCD"}}),
    raw({id: "n", amount: -1099, created: "2026-10-03T12:00:00Z", category: "entertainment", scheme: "mastercard", merchant: {name: "NETFLIX.COM"}}),
  ], NOW, ids);
  expect(got.map(t => [t.monzoId, t.billId, t.forDate])).toEqual([["s", "spotify", "2026-10-05"], ["n", "netflix", "2026-10-05"]]);

  // gas and electricity, both from Octopus, about the same: which one it paid isn't known, so it's asked, and both stay held back
  const gas = {...energy, id: "gas", amount: 45}, power = {...energy, id: "power", amount: 48};
  const c = withBills([gas, power]);
  const [one] = importTxs(c, [raw({amount: -4600, description: "OCTOPUS ENERGY"})], NOW, ids);
  expect(one).toMatchObject({cat: "other", needsCat: true});
  expect(one.billId).toBeUndefined();
  expect(calc({...c, txs: [one]}).billsDue.map(x => x.b.id).sort()).toEqual(["gas", "power"]);
});

test("a bill you marked paid by hand: the bank's payment takes that due date, and the one you logged goes", () => {
  const hand = tx({amount: 60, date: "2026-10-04", cat: "bills", billId: "energy", forDate: "2026-10-05"});
  const c = withBills([energy], {txs: [hand]});
  // until the bank's payment comes, the one you logged is what marks it paid
  expect(standIns(c)).toEqual([]);
  expect(calc(c).billsDue).toEqual([]);
  const [bank] = importTxs(c, [raw({id: "dd", description: "OCTOPUS ENERGY"})], NOW, ids);
  expect(bank).toMatchObject({billId: "energy", forDate: "2026-10-05"});
  const both = {...c, txs: [hand, bank]};
  expect(standIns(both)).toEqual([hand.id]);
  // once it's gone: paid once, and spent once
  const after = {...c, txs: [bank]};
  expect(billPaid(after, energy, "2026-10-05")).toBe(true);
  expect(after.txs.filter(t => t.billId === "energy").reduce((a, t) => a + t.amount, 0)).toBe(60);
  // a bill with no payment date: replaced within the same pay cycle, not the next
  const undated = {...energy, day: undefined};
  const typed = tx({amount: 60, date: "2026-10-01", cat: "bills", billId: "energy"});
  const [paid] = importTxs(withBills([undated], {txs: [typed]}), [raw({description: "OCTOPUS ENERGY"})], NOW, ids);
  expect(paid).toMatchObject({billId: "energy"});
  expect(paid.forDate).toBeUndefined();
  expect(standIns(withBills([undated], {txs: [typed, paid]}))).toEqual([typed.id]);
  expect(standIns(withBills([undated], {txs: [typed, {...paid, date: "2026-11-02"}]}))).toEqual([]);
});

test("a payment is never matched twice, and a due date the bank paid isn't paid again", () => {
  const c = withBills([energy]);
  const got = importTxs(c, [raw({id: "a", description: "OCTOPUS ENERGY"}), raw({id: "b", description: "OCTOPUS ENERGY"})], NOW, ids);
  expect(got.map(t => [t.monzoId, t.billId ?? null, !!t.needsCat])).toEqual([["a", "energy", false], ["b", null, true]]);
  // a later sync: that due date's already paid from the bank
  const [again] = importTxs({...c, txs: got}, [raw({id: "c", created: "2026-10-06T12:00:00Z", description: "OCTOPUS ENERGY"})], NOW, ids);
  expect(again.billId).toBeUndefined();
  // and the backfill leaves the filed one and the second one alone (its date is taken)
  expect(unfiledBills({...c, txs: got})).toEqual([]);
});

test("payments saved before they could be recognised are filed now, oldest first; ones you sorted are left alone", () => {
  const old = tx({amount: 60, date: "2026-10-05", note: "OCTOPUS ENERGY", monzoId: "old", needsCat: true});
  const dupe = tx({amount: 60, date: "2026-10-05", note: "OCTOPUS ENERGY", monzoId: "dupe", needsCat: true});   // saved after it: its date's taken
  const sorted = tx({amount: 60, date: "2026-10-04", note: "OCTOPUS ENERGY", monzoId: "sorted", cat: "other"});
  const typed = tx({amount: 60, date: "2026-10-03", note: "OCTOPUS ENERGY", needsCat: true});
  expect(unfiledBills(withBills([energy], {txs: [dupe, old, sorted, typed]})))
    .toEqual([{id: old.id, patch: {cat: "bills", billId: "energy", forDate: "2026-10-05"}}]);
});

test("a bank payment you file under a typed-in bill teaches it who it's paid to, so the next one is recognised", () => {
  // the fixture's Rent: £400 on the 15th, no payee
  const it = tx({amount: 400, date: "2026-10-15", note: "SMITH J", monzoId: "so1", needsCat: true});
  const out = fileUnder(ctx({txs: [it]}), it, {kind: "bill", id: "rent"});
  expect(out.patch).toEqual({cat: "rent", billId: "rent", forDate: "2026-10-15"});
  expect(out.bill?.payee).toBe("SMITH J");
  const next = withBills([out.bill!], {txs: [{...it, ...out.patch}], today: "2026-11-10"});
  expect(billMatch(next, {amount: 400, date: "2026-11-16", note: "SMITH J"})).toEqual({b: out.bill, d: "2026-11-16"});
  // one you typed in teaches nothing, and a payee it already has isn't changed
  const typed = tx({amount: 400, date: "2026-10-15", note: "Landlord"});
  expect(fileUnder(ctx({txs: [typed]}), typed, {kind: "bill", id: "rent"}).bill).toBeUndefined();
  const known = ctx({state: baseState({bills: [{...baseState().bills[0], payee: "SMITH J"}]}), txs: [it]});
  expect(fileUnder(known, it, {kind: "bill", id: "rent"}).bill).toBeUndefined();
  // marked paid by hand already: it takes that due date (and replaces it), not next month's
  const hand = tx({amount: 400, date: "2026-10-14", cat: "rent", billId: "rent", forDate: "2026-10-15"});
  expect(fileUnder(ctx({txs: [hand, it]}), it, {kind: "bill", id: "rent"}).patch.forDate).toBe("2026-10-15");
});

test("a recognised payment comes off what's held back, isn't today's spending, and today's number is as if you'd marked it paid", async () => {
  // synced just now: the bank's balance already has the £60 out
  const state = baseState({bills: [energy], balance: 940, balanceSetAt: NOW});
  const at = (txs: Tx[]) => { const c: Ctx = {state, txs, today: TODAY}, k = calc(c); return {c, k, h: hero(c, k)}; };
  const [dd] = importTxs({state, txs: [], today: TODAY}, [raw({id: "dd", description: "OCTOPUS ENERGY"})], NOW, ids);
  const now = at([dd]);
  expect(now.k.billsDue).toEqual([]);
  expect(now.k.billsLeft).toBe(0);
  expect(now.h).toMatchObject({kind: "number", perDay: 29, left: 29, spentToday: 0});   // (£940 − £200 everyday) ÷ 25 days

  // the same as "Mark as paid" (logged before the sync, so the bank's balance already counts it)
  const marked = at([tx({amount: 60, date: TODAY, cat: "bills", billId: "energy", forDate: TODAY, created: NOW - 5})]);
  expect(now.h).toEqual(marked.h);
  expect(now.k.need).toBe(marked.k.need);

  // as it came in before: still held back, and today's spending as well
  const before = at([{...dd, cat: "other", needsCat: true, billId: undefined, forDate: undefined}]);
  expect(before.k.billsLeft).toBe(60);
  expect(before.h).toMatchObject({kind: "number", perDay: 29, left: 0, spentToday: 60});

  // the Living tab shows it paid, with no button (the bank paid it), and Frank sees it paid
  const item = livingItems(now.c, now.k).find(x => x.ref === "energy")!;
  expect(item.paid).toBe(true);
  expect(livingAction(now.c, now.k, item)).toBeNull();
  const up = (await runTool("upcoming", {to: null}, {ctx: now.c, notes: [], who: "frank", newId: () => "x", regulars: {scan: null, answers: {}}, rules: []})).result as {bills: {name: string; paid: boolean}[]; held_back_now_for_bills: number};
  expect(up.bills.find(b => b.name === "Octopus Energy")?.paid).toBe(true);
  expect(up.held_back_now_for_bills).toBe(0);
});
