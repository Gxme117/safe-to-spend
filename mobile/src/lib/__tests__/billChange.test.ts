import {applied, cardLine, doneLine, filingsFor, leftLine, outcomeLine, proposalView, proposeAdd, proposeChange, proposeRemove, Refused, stale, type Proposal} from "@/lib/billChange";
import {calc, hero} from "@/lib/calc";
import type {Regular, Scan} from "@/lib/regulars";
import type {Bill, Ctx} from "@/lib/types";
import {baseState, ctx, TODAY, tx} from "./fixtures";

// Mon 5 Oct 2026, paid on the last working day (this pay cycle from Wed 30 Sep), rent £400 on the 15th, phone £20 on the 1st
const spotify: Regular = {name: "Spotify", payee: "Spotify", amount: 11.99, varies: false, freq: "monthly", day: 12, method: "card", n: 3,
  ref: "spotify", first: "2026-07-13", last: "2026-09-14", amounts: [11.99, 11.99, 11.99], sure: "likely"};
const scan: Scan = {at: TODAY, from: "2026-07-07", found: [spotify]};
const perDay = (x: Ctx) => { const h = hero(x, calc(x)); if (h.kind !== "number") throw new Error("no number"); return h.perDay; };
const refused = (f: () => unknown) => { try { f(); } catch (e) { if (e instanceof Refused) return e.message; throw e; } throw new Error("not refused"); };

test("a bill from a regular payment: who it's paid to and how from the bank, held back from today on", () => {
  expect(proposeAdd(ctx(), scan, {fromRegular: "spotify"}, "b1")).toEqual({kind: "add", ref: "spotify", bill: {
    id: "b1", name: "Spotify", amount: 11.99, freq: "monthly", day: 12, from: {kind: "main"}, since: TODAY, method: "card", payee: "Spotify", source: "bank"}});
  // what they say wins over what the bank showed
  expect(proposeAdd(ctx(), scan, {fromRegular: "spotify", amount: 12.99, day: 14}, "b1")).toMatchObject({bill: {amount: 12.99, day: 14}});
  expect(refused(() => proposeAdd(ctx(), scan, {fromRegular: "netflix"}, "b1"))).toMatch(/no regular payment with ref netflix/);
});

test("a bill they tell him about: name, amount, how often and when; what's missing is asked for", () => {
  expect(proposeAdd(ctx(), null, {name: "Gym", amount: 30, howOften: "monthly", day: 3}, "b1")).toEqual({kind: "add",
    bill: {id: "b1", name: "Gym", amount: 30, freq: "monthly", day: 3, from: {kind: "main"}, since: TODAY}});
  expect(proposeAdd(ctx(), null, {name: "Car insurance", amount: 600, howOften: "yearly", date: "2027-03-01"}, "b1")).toMatchObject({bill: {freq: "yearly", date: "2027-03-01"}});
  // no date known: it goes in without one (a month's share held each pay)
  expect(proposeAdd(ctx(), null, {name: "Water", amount: 35, howOften: "monthly"}, "b1")).toMatchObject({bill: {name: "Water"}});
  expect(refused(() => proposeAdd(ctx(), null, {name: "Gym", howOften: "monthly"}, "b1"))).toBe("Ask how much Gym is.");
  expect(refused(() => proposeAdd(ctx(), null, {name: "Gym", amount: 30}, "b1"))).toBe("Ask how often Gym goes out.");
  expect(refused(() => proposeAdd(ctx(), null, {name: "Gift", amount: 30, howOften: "oneoff"}, "b1"))).toMatch(/one-off needs the date/);
  expect(refused(() => proposeAdd(ctx(), null, {name: "Gym", amount: 30, howOften: "weekly", day: 3}, "b1"))).toMatch(/Only a monthly bill/);
  expect(refused(() => proposeAdd(ctx(), null, {name: "Gym", amount: 30, howOften: "monthly", day: 40}, "b1"))).toMatch(/1 to 31/);
});

test("never a second bill for the same thing: by name, or paid to the same payee", () => {
  expect(refused(() => proposeAdd(ctx(), null, {name: "rent", amount: 400, howOften: "monthly", day: 15}, "b1"))).toMatch(/already a bill for this: Rent \(£400 every month\), id rent/);
  const withSpotify = ctx({state: baseState({bills: [...baseState().bills, {id: "s", name: "Music", amount: 11.99, freq: "monthly", payee: "Spotify"}]})});
  expect(refused(() => proposeAdd(withSpotify, scan, {fromRegular: "spotify"}, "b1"))).toMatch(/id s/);
});

test("a change: only what's given changes, nothing at all is refused", () => {
  expect(proposeChange(ctx(), null, "phone", {amount: 25})).toEqual({kind: "change", before: baseState().bills[1], after: {...baseState().bills[1], amount: 25}});
  expect(proposeChange(ctx(), null, "phone", {howOften: "weekly", date: "2026-10-09"})).toMatchObject({after: {freq: "weekly", date: "2026-10-09"}});
  expect((proposeChange(ctx(), null, "phone", {howOften: "weekly", date: "2026-10-09"}) as {after: Bill}).after.day).toBeUndefined();
  expect(proposeChange(ctx(), scan, "phone", {fromRegular: "spotify"})).toMatchObject({ref: "spotify", after: {payee: "Spotify", method: "card", source: "bank"}});
  expect(refused(() => proposeChange(ctx(), null, "phone", {amount: 20}))).toMatch(/nothing would change/);
  expect(refused(() => proposeChange(ctx(), null, "nope", {amount: 20}))).toMatch(/no bill with id nope/);
  expect(refused(() => proposeRemove(ctx(), "nope"))).toMatch(/no bill with id nope/);
});

describe("payments it takes, so they aren't spending and a bill still to pay at once", () => {
  const netflix: Bill = {id: "flix", name: "Netflix", amount: 10.99, freq: "monthly", day: 3, payee: "NETFLIX.COM"};
  const now = tx({amount: 10.99, date: "2026-10-03", cat: "entertainment", note: "NETFLIX.COM", monzoId: "m1"});
  const txs = [
    now,
    tx({amount: 10.99, date: "2026-09-03", cat: "entertainment", note: "NETFLIX.COM", monzoId: "m0"}),          // last pay cycle
    tx({amount: 10.99, date: "2026-10-02", cat: "entertainment", note: "NETFLIX.COM", billId: "rent", monzoId: "m2"}), // another bill's
    tx({amount: 10.99, date: "2026-10-02", cat: "entertainment", note: "NETFLIX.COM"}),                          // logged by hand
  ];

  test("only this pay cycle's from the bank, not filed to another bill, each with the due date it paid", () => {
    const f = filingsFor(ctx({txs}), netflix);
    expect(f).toEqual([{id: now.id, patch: {cat: "bills", billId: "flix", forDate: "2026-10-05"}, was: {cat: "entertainment"}, wasAsked: false}]);
  });

  test("the card says so, and today's amount after is the engine's with the change made", () => {
    const x = ctx({txs}), p: Proposal = {kind: "add", bill: netflix};
    const v = proposalView(x, p);
    expect(v).toMatchObject({title: "Add Netflix", rows: ["£10.99 every month", "3rd of every month"], files: ["Its £10.99 payment on Sat 3 Oct counts as this bill."], action: "Add it"});
    expect(v.today).toEqual({now: perDay(x), then: perDay(applied(x, p, filingsFor(x, netflix)))});
    expect(cardLine(x, p)).toMatch(/^Add Netflix: £10.99 every month; 3rd of every month\. Its £10.99 payment on Sat 3 Oct counts as this bill\. Today's amount/);
  });
});

test("a bill due before payday lowers today's amount on the card by what the engine says", () => {
  const x = ctx(), p = proposeAdd(x, null, {name: "Gym", amount: 120, howOften: "monthly", day: 20}, "b1");
  const v = proposalView(x, p);
  expect(v.today!.then).toBe(perDay({...x, state: baseState({bills: [...baseState().bills, (p as {bill: Bill}).bill]})}));
  expect(v.today!.then).toBeLessThan(v.today!.now);
});

test("a card tapped late is checked again: changed, gone, or a bill like it added since", () => {
  const p = proposeChange(ctx(), null, "phone", {amount: 25});
  expect(stale(ctx(), p)).toBeNull();
  expect(stale(ctx({state: baseState({bills: [baseState().bills[0], {...baseState().bills[1], amount: 22}]})}), p)).toBe("That bill's changed since.");
  expect(stale(ctx({state: baseState({bills: [baseState().bills[0]]})}), proposeRemove(ctx(), "phone"))).toBe("That bill's gone.");
  const add = proposeAdd(ctx(), null, {name: "Gym", amount: 30, howOften: "monthly", day: 3}, "b1");
  expect(stale(ctx({state: baseState({bills: [...baseState().bills, {id: "g", name: "Gym", amount: 30, freq: "monthly"}]})}), add)).toBe("There's a bill like it now.");
});

test("what he says once it's done, or left; and what he's told on your next message", () => {
  const add = proposeAdd(ctx(), scan, {fromRegular: "spotify"}, "b1");
  expect(doneLine(add, "frank")).toBe("Done. Spotify's in your bills at £11.99 a month.");
  expect(doneLine(add, "tim")).toBe("Done. I've added Spotify to your bills at £11.99 a month.");
  expect(doneLine(proposeChange(ctx(), null, "phone", {amount: 25}), "frank")).toBe("Done. Phone's now £25 a month.");
  expect(doneLine(proposeRemove(ctx(), "rent"), "frank")).toBe("Done. Rent's gone from your bills.");
  expect(leftLine("frank")).toBe("Fine. Left it as it was.");
  expect(outcomeLine(ctx(), add, "done")).toMatch(/^They tapped yes on your card: Add Spotify \(£11\.99 every month; 12th of every month; Card, to Spotify\)\. It's saved\.$/);
  expect(outcomeLine(ctx(), add, "declined")).toMatch(/Nothing changed\.$/);
});
