import {calc, forecast, hero} from "../calc";
import {addDays} from "../dates";
import {dayView, dueByDay, runway, weekLeft, weekMarks} from "../day";
import type {Ctx} from "../types";
import {baseState, ctx as makeCtx, TODAY, tx} from "./fixtures";

// TODAY is Mon 5 Oct. Pay: Fri 28 Aug (the 31st is a bank holiday), Wed 30 Sep, Fri 30 Oct.
const gym = {id: "gym", name: "Gym", amount: 30, freq: "monthly" as const, day: 5};
const nandos = {id: "nan", name: "Nando's", type: "other" as const, freq: "oneoff" as const, varies: false, amount: 40, date: "2026-10-08", since: TODAY};
const rich = (over: Partial<Ctx> = {}): Ctx => makeCtx({
  state: baseState({bills: [...baseState().bills, gym], incomes: [...baseState().incomes, nandos]}),
  txs: [
    tx({amount: 40, date: "2026-09-25", cat: "groceries"}),
    tx({amount: 30, date: "2026-10-01", cat: "groceries"}),
    tx({amount: 12, date: "2026-10-02", cat: "eating", note: "Lunch"}),
    tx({amount: 20, date: "2026-10-03", cat: "groceries"}),
    tx({type: "income", amount: 5, date: "2026-10-04", cat: "groceries", refundOf: "groceries", note: "Refund"}),
    tx({amount: 10, date: TODAY, cat: "groceries"}),
    tx({amount: 4, date: TODAY, cat: "eating", note: "Coffee"}),
  ],
  ...over,
});
const left = (c: Ctx, d: string) => dayView(c, calc(c), d).everyday.find(e => e.x.id === "groceries")!.left;

test("everything a day shows is from that day, and the week's dots match what each day lists", () => {
  const c = rich(), r = calc(c), due = dueByDay(c, r);
  for (let i = -40; i <= 40; i++) {
    const d = addDays(TODAY, i), v = dayView(c, r, d, due);
    expect(v.d).toBe(d);
    expect(v.when).toBe(i < 0 ? "past" : i ? "future" : "today");
    for (const it of v.payments) expect([d, it.date]).toEqual([d, d]);
    for (const x of v.due) expect([d, x.d]).toEqual([d, d]);
    if (v.when === "future") expect(v.payments).toEqual([]);
    if (v.when === "past") expect(v.due).toEqual([]);
    if (v.when !== "today") expect([v.later, v.tomorrow]).toEqual([[], null]);
    expect(v.figure.kind === "day").toBe(v.when !== "today");
    const mark = weekMarks(c, r, d, due).find(m => m.d === d)!;
    expect([d, mark.bills, mark.incoming]).toEqual([d, v.due.some(x => x.kind === "bill"), v.due.some(x => x.kind !== "bill")]);
  }
});

test("a past day lists what was spent that day, newest first", () => {
  const c = rich();
  const v = dayView(c, calc(c), "2026-10-02");
  expect(v.payments.map(it => it.note)).toEqual(["Lunch"]);
  expect(v.figure).toMatchObject({kind: "day", label: "Spent on Fri 2 Oct", amount: 12});
});

test("a bill going out today shows on today, not just as a dot in the week", () => {
  const c = rich(), r = calc(c);
  expect(dayView(c, r, TODAY).due.map(x => x.name)).toEqual(["Gym"]);
  expect(weekMarks(c, r, TODAY).find(m => m.d === TODAY)).toMatchObject({bills: true});
});

test("money you're expecting shows on its day, and under today's spending", () => {
  const c = rich(), r = calc(c);
  expect(dayView(c, r, "2026-10-08").due.map(x => `${x.name} ${x.amt}`)).toEqual(["Nando's +£40"]);
  expect(dayView(c, r, TODAY).later.map(x => x.name)).toEqual(["Nando's", "Rent", "Pharmacy"]);
});

test("your next payday shows under today's spending and gets a dot in the week", () => {
  const c = rich({today: "2026-10-26"}), r = calc(c);
  expect(dayView(c, r, "2026-10-26").later.map(x => `${x.name} ${x.d}`)).toEqual(["Pharmacy 2026-10-30"]);
  expect(weekMarks(c, r, "2026-10-26").find(m => m.d === "2026-10-30")).toMatchObject({incoming: true});
});

test("Everyday on a day is what was left at the end of it, in that day's pay cycle", () => {
  const c = rich();
  // the last cycle had only the £40
  expect(left(c, "2026-09-29")).toBe(160);
  // this one started on 30 Sep: £30 on the 1st, £20 on the 3rd
  expect(left(c, "2026-10-03")).toBe(150);
  // the refund goes back
  expect(left(c, "2026-10-04")).toBe(155);
  expect(left(c, TODAY)).toBe(145);
  // later this cycle: nothing more spent yet, so the same as today
  expect(left(c, "2026-10-20")).toBe(145);
  // from payday it starts full again
  expect(left(c, "2026-10-30")).toBe(200);
});

test("on payday the payday check asks about pay, so today doesn't list it; the days before still show it coming", () => {
  const c = rich({today: "2026-10-30"}), r = calc(c);
  expect(dayView(c, r, "2026-10-30").due.some(x => x.kind === "pay")).toBe(false);
  const before = rich(), rb = calc(before);
  expect(dayView(before, rb, "2026-10-30").due.map(x => x.name)).toContain("Pharmacy");
});

// what today has left plus what each later day would show, from tomorrow to `to`
const sumDays = (c: Ctx, to: string) => {
  const r = calc(c), h = hero(c, r);
  let sum = h.kind === "number" ? h.left : 0;
  for (let d = addDays(c.today, 1); d <= to; d = addDays(d, 1)) sum += Math.max(0, forecast(c, r, d)!.amount);
  return Math.round(sum * 100) / 100;
};

test("the week adds up what today has left and what each day to Sunday would show", () => {
  const c = rich(), w = weekLeft(c, calc(c))!;
  expect(w.amount).toBe(sumDays(c, "2026-10-11"));
  expect(w.amount).toBeGreaterThan(0);
  expect(w.line).toMatch(/to spend from now to Sunday$/);
});

test("with payday this week, the week stops the day before it: pay that hasn't arrived isn't counted", () => {
  const c = makeCtx({today: "2026-10-26"}), w = weekLeft(c, calc(c))!;   // pay lands Fri 30 Oct
  expect(w.amount).toBe(sumDays(c, "2026-10-29"));
  expect(w.line).toMatch(/before payday on Friday$/);
});

test("no week line on its last day, without a daily number, or when there isn't enough for bills and everyday", () => {
  const sunday = makeCtx({today: "2026-10-11"});
  expect(weekLeft(sunday, calc(sunday))).toBeNull();
  const noPay = makeCtx({state: baseState({incomes: []})});
  expect(weekLeft(noPay, calc(noPay))).toBeNull();
  const gap = makeCtx({state: baseState({balance: 100})});
  expect(weekLeft(gap, calc(gap))).toBeNull();
});

test("the runway: each day's figure is the one that day shows, from a few days back to payday", () => {
  const c = rich(), r = calc(c), days = runway(c, r);
  expect(days[0].d).toBe(addDays(TODAY, -3));
  expect(days[days.length - 1].d).toBe(r.payday);
  expect(days.filter(x => x.payday).map(x => x.d)).toEqual([r.payday]);
  for (const x of days) {
    const v = dayView(c, r, x.d), f = v.figure;
    expect(x.when).toBe(v.when);
    if (x.when === "today") expect(f.kind === "number" && x.amount).toBe(f.kind === "number" && f.left);
    else if (x.when === "past") expect(f.kind === "day" && x.amount).toBe(f.kind === "day" && f.amount);
    else expect(x.amount).toBe(forecast(c, r, x.d)?.amount ?? null);
  }
});

test("the runway looks a week ahead even when payday is sooner, and has no figures without a number", () => {
  const c = rich(), r = calc(c);
  const soon = runway(c, {...r, payday: addDays(TODAY, 2)});
  expect(soon[soon.length - 1].d).toBe(addDays(TODAY, 6));
  const none = makeCtx({state: baseState({incomes: []})});
  expect(runway(none, calc(none)).every(x => x.when === "past" || x.amount === null)).toBe(true);
});
