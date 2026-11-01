import type {RawTx} from "@/lib/monzo";
import {billChanges, regularsView, sameKind, scanOf, type Regular, type Scan} from "@/lib/regulars";
import type {Bank, Bill} from "@/lib/types";
import {baseState, ctx, TODAY, tx} from "./fixtures";

// TODAY is Mon 5 Oct 2026. Midday UTC is the same day in any UK time.
let n = 0;
const t = (date: string, pounds: number, over: Partial<RawTx> = {}): RawTx =>
  ({id: `r${++n}`, amount: Math.round(pounds * 100), created: `${date}T12:00:00Z`, ...over});
const dd = (name: string) => ({scheme: "bacs", category: "bills", counterparty: {name}, description: name.toUpperCase()});
const shop = (name: string, category = "entertainment") => ({scheme: "mastercard", category, merchant: {name}});

const monzo: Bank = {source: "Monzo", accountId: "acc_1", main: 1000, asOf: "2026-10-05T09:00:00", pots: [], numbers: ["11111122222222"]};
const banked = (bills: Bill[] = baseState().bills) => ctx({state: baseState({bank: monzo, bills})});
const reg = (o: Partial<Regular> & Pick<Regular, "name" | "amount">): Regular => ({
  payee: o.name, varies: false, freq: "monthly", day: 12, method: "card", n: 3, ref: o.name.toLowerCase(),
  first: "2026-07-13", last: "2026-09-14", amounts: [o.amount, o.amount, o.amount], sure: "likely", ...o,
});
const scan = (found: Regular[], o: Partial<Scan> = {}): Scan => ({at: TODAY, from: "2026-07-07", found, ...o});

test("the bank's 90 days: direct debits monthly, weekly and varying, a subscription; never a takeaway habit or a move to your own account", () => {
  const raw = [
    ...["2026-07-02", "2026-08-03", "2026-09-02", "2026-10-02"].map(d => t(d, -24.99, dd("PUREGYM"))),
    t("2026-07-15", -60, dd("OCTOPUS ENERGY")), t("2026-08-17", -72, dd("OCTOPUS ENERGY")), t("2026-09-15", -81, dd("OCTOPUS ENERGY")),
    ...["2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02"].map(d => t(d, -25, dd("LOAN CO"))),
    t("2026-08-12", -11.99, shop("Spotify")), t("2026-09-14", -11.99, shop("Spotify")),
    ...["2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02"].map(d => t(d, -18, shop("Dominos", "eating_out"))),
    // the same £200 to your account at another bank, every month
    ...["2026-07-01", "2026-08-03", "2026-09-01", "2026-10-01"].map(d => t(d, -200, {counterparty: {name: "ME", sort_code: "111111", account_number: "22222222"}})),
  ];
  const s = scanOf(raw, TODAY, new Set(["11111122222222"]));
  expect(s).toMatchObject({at: TODAY, from: "2026-07-02"});
  expect(s.found.map(r => [r.name, r.freq, r.method, r.sure])).toEqual([
    ["Octopus Energy", "monthly", "dd", "likely"], ["Loan CO", "weekly", "dd", "likely"],
    ["Puregym", "monthly", "dd", "likely"], ["Spotify", "monthly", "card", "maybe"],
  ]);
  expect(s.found[0]).toMatchObject({ref: "octopus energy", amount: 81, varies: true, amounts: [60, 72, 81], first: "2026-07-15", last: "2026-09-15", n: 3});
  // without your own account known, the move would look like rent by standing order
  expect(scanOf(raw, TODAY, new Set()).found.map(r => r.name)).toContain("ME");
  expect(scanOf([], TODAY, new Set())).toEqual({at: TODAY, from: null, found: []});
});

test("what's already a bill isn't suggested again: by who it's paid to, or by the bill's name", () => {
  const gym: Bill = {id: "gym", name: "Gym", amount: 24.99, freq: "monthly", day: 2, payee: "PUREGYM"};
  const flix: Bill = {id: "flix", name: "Netflix", amount: 10.99, freq: "monthly", day: 3};
  const v = regularsView(banked([...baseState().bills, gym, flix]), scan([
    reg({name: "PUREGYM", amount: 24.99, ref: "puregym"}), reg({name: "NETFLIX.COM", amount: 10.99, ref: "netflix.com"}), reg({name: "Spotify", amount: 11.99}),
  ]), {});
  expect(v.open.map(r => r.name)).toEqual(["Spotify"]);
});

test("a regular payment like a bill you typed in with no payee is asked about as that bill, not a second one", () => {
  // phone: £20 on the 1st (next Mon 2 Nov); EE £20 on the 1st as well
  const v = regularsView(banked(), scan([reg({name: "EE", amount: 20, day: 1}), reg({name: "Three", amount: 20, day: 20})]), {});
  expect(v.open[0].sameAs?.id).toBe("phone");
  expect(v.open[1].sameAs).toBeUndefined();   // 3 weeks apart: not the same
});

test("a streaming or music payment while setup's Subscriptions bill holds them all is asked about as part of it", () => {
  const subs: Bill = {id: "subs", name: "Subscriptions", amount: 30, freq: "monthly"};
  const v = regularsView(banked([...baseState().bills, subs]), scan([reg({name: "Spotify", amount: 11.99}), reg({name: "PUREGYM", amount: 24.99})]), {});
  expect(v.open.find(r => r.name === "Spotify")?.partOf?.id).toBe("subs");
  expect(v.open.find(r => r.name === "PUREGYM")?.partOf).toBeUndefined();
});

test("not a bill is never asked again; not now, after 30 days", () => {
  const found = [reg({name: "Spotify", amount: 11.99}), reg({name: "PUREGYM", amount: 24.99, ref: "puregym"})];
  const names = (answers: Parameters<typeof regularsView>[2]) => regularsView(banked(), scan(found), answers).open.map(r => r.name);
  expect(names({spotify: {verdict: "not_a_bill", at: "2026-01-01", name: "Spotify"}})).toEqual(["PUREGYM"]);
  expect(names({puregym: {verdict: "not_now", at: "2026-09-20", name: "PureGym"}})).toEqual(["Spotify"]);
  expect(names({puregym: {verdict: "not_now", at: "2026-09-01", name: "PureGym"}})).toEqual(["Spotify", "PUREGYM"]);
});

test("no bank, no look yet, too little history or an old look: says so", () => {
  expect(regularsView(ctx(), scan([]), {})).toEqual({open: [], none: "No bank is connected, so there are no payments to look through."});
  expect(regularsView(banked(), null, {}).none).toMatch(/haven't been looked through yet/);
  expect(regularsView(banked(), scan([], {from: "2026-09-01"}), {}).note).toBe("Only 5 weeks of payments to go on, so a monthly payment may only have gone out once: too few to show a pattern.");
  expect(regularsView(banked(), scan([], {at: "2026-09-30"}), {}).note).toBe("Looked through on Wed 30 Sep: newer payments aren't in it.");
  expect(regularsView(banked(), scan([], {from: null}), {}).note).toMatch(/no payments/);
  expect(regularsView(banked(), scan([]), {}).note).toBeUndefined();
});

describe("bills the bank's payments don't agree with", () => {
  // Netflix on the 3rd: Sat 3 Oct goes out Mon 5 Oct
  const flix: Bill = {id: "flix", name: "Netflix", amount: 13.99, freq: "monthly", day: 3, payee: "NETFLIX.COM", method: "card"};
  const gym: Bill = {id: "gym", name: "Gym", amount: 24.99, freq: "monthly", day: 20, payee: "PUREGYM", method: "dd"};
  const start = tx({amount: 5, date: "2026-09-01", note: "Tesco", monzoId: "m0"});
  const changes = (bills: Bill[], txs = [start]) => billChanges(ctx({state: baseState({bills}), txs}));

  test("a new price: filed against it within the 10%, or paid to it near the date and outside it", () => {
    expect(changes([flix], [start, tx({amount: 14.99, date: "2026-10-03", note: "NETFLIX.COM", billId: "flix", forDate: "2026-10-05", monzoId: "m1"})]))
      .toEqual([{kind: "price", b: flix, paid: 14.99, on: "2026-10-03"}]);
    expect(changes([{...flix, amount: 10.99}], [start, tx({amount: 15.99, date: "2026-10-05", note: "NETFLIX.COM", monzoId: "m1"})]))
      .toEqual([{kind: "price", b: {...flix, amount: 10.99}, paid: 15.99, on: "2026-10-05"}]);
  });

  test("never a new price for one that varies, pennies off, a shop far from the date, or one you logged by hand", () => {
    // the app's payments from the bank start after September's Netflix, so a missed one isn't in question
    const later = tx({amount: 5, date: "2026-09-10", note: "Tesco", monzoId: "m0"});
    expect(changes([{...flix, varies: true}], [later, tx({amount: 19.99, date: "2026-10-03", note: "NETFLIX.COM", billId: "flix", monzoId: "m1"})])).toEqual([]);
    expect(changes([flix], [later, tx({amount: 14.2, date: "2026-10-03", note: "NETFLIX.COM", billId: "flix", monzoId: "m1"})])).toEqual([]);
    expect(changes([flix], [later, tx({amount: 20, date: "2026-09-20", note: "NETFLIX.COM", monzoId: "m1"})])).toEqual([]);
    expect(changes([flix], [later, tx({amount: 20, date: "2026-10-03", billId: "flix"})])).toEqual([]);
  });

  test("a due date with nothing paid: only for a bill the bank pays, after the app's first payment from the bank and after it was added", () => {
    // Sun 20 Sep goes out Mon 21 Sep
    expect(changes([gym])).toEqual([{kind: "no_payment", b: gym, due: "2026-09-21"}]);
    expect(changes([gym], [start, tx({amount: 24.99, date: "2026-09-21", note: "PUREGYM", monzoId: "m1"})])).toEqual([]);
    expect(changes([gym], [start, tx({amount: 24.99, date: "2026-09-21", note: "", billId: "gym", forDate: "2026-09-21"})])).toEqual([]);
    expect(changes([{...gym, payee: undefined}])).toEqual([]);
    expect(changes([{...gym, method: "transfer"}])).toEqual([]);
    expect(changes([gym], [tx({amount: 5, date: "2026-09-25", note: "Tesco", monzoId: "m0"})])).toEqual([]);
    expect(changes([{...gym, since: "2026-09-25"}])).toEqual([]);
    expect(changes([gym], [])).toEqual([]);
  });
});

test("two of a kind: different streaming or music services, each named once; a TV licence isn't streaming", () => {
  expect(sameKind(["Netflix", "NETFLIX.COM", "Disney Plus", "Rent"])).toEqual([{kind: "streaming", names: ["Netflix", "Disney+"]}]);
  expect(sameKind(["TV Licence", "Netflix"])).toEqual([]);
  expect(sameKind(["Spotify", "Netflix", "Apple Music"])).toEqual([{kind: "music", names: ["Spotify", "Apple Music"]}]);
});
