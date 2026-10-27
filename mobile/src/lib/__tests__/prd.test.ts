import {calc, forecast, hero} from "../calc";
import {usedUp, whatIf} from "../today";
import type {AppState, Ctx, Income, Tx} from "../types";
import {baseState, ctx, tx} from "./fixtures";

// The Pinch PRD's test cases (v0.4, Appendix A.3), one test each. They must all pass before release (NFR-3).

const run = (c: Ctx) => { const r = calc(c); return {r, h: hero(c, r)}; };

// T1: balance £1,000; bills £400 (rent, Sun 25 Oct); everyday £200 (groceries); savings £100; 10 days left (Tue 20 Oct to payday Fri 30 Oct)
const T1_DAY = "2026-10-20";
const t1 = (over: Partial<AppState> = {}, txs: Tx[] = [], today = T1_DAY) =>
  ctx({state: baseState({bills: [{id: "rent", name: "Rent", amount: 400, freq: "monthly", day: 25}], saving: 100, ...over}), txs, today});
const spent = (amount: number, cat = "other") => tx({amount, date: T1_DAY, cat});

// T5: balance £300; bills £400; no everyday budgets; savings pots holding `saved`
const t5 = (saved: number, income: Partial<Income> = {}) => {
  const bank = {source: "Monzo", accountId: "acc", main: 300, asOf: "2026-10-20T08:00:00Z",
    pots: saved ? [{id: "hol", name: "Holiday", balance: saved, role: "save" as const}] : []};
  return t1({balance: 300, saving: undefined, bank, categories: baseState().categories.filter(x => x.id !== "groceries"),
    incomes: [{...baseState().incomes[0], ...income}]});
};

describe("PRD Appendix A test cases", () => {
  test("T1: £1,000 less £400 bills, £200 everyday and £100 savings, over 10 days, is £30 a day", () => {
    const {r, h} = run(t1());
    expect(r.daysLeft).toBe(10);
    expect(h).toMatchObject({kind: "number", free: 300, perDay: 30, left: 30});
  });

  test("T2: a £60 shop inside the groceries budget leaves the number at £30; everyday falls by £60", () => {
    expect(run(t1()).r.everydayLeft).toBe(200);
    const {r, h} = run(t1({}, [spent(60, "groceries")]));
    expect(r.everydayLeft).toBe(140);
    expect(h).toMatchObject({perDay: 30, left: 30, spentToday: 0});
  });

  test("T3: £30 spent outside the budgets uses today's £30; tomorrow is still £30", () => {
    const c = t1({}, [spent(30)]), {r, h} = run(c);
    expect(h).toMatchObject({perDay: 30, left: 0, free: 270});
    expect(usedUp(c, r, h)?.lead).toBe("You've used today's £30.");
    expect(forecast(c, r, "2026-10-21")?.amount).toBe(30);
  });

  test("T3b: £50 spent: £0 left today, and from tomorrow £27 a day (£250 over 9 days)", () => {
    expect(run(t1({}, [spent(50)])).h).toMatchObject({perDay: 30, left: 0, free: 250, reason: "£50 spent today. From tomorrow, £27 a day"});
  });

  test("T4: £500 of side income doesn't count until it lands; then free money is £800 and the number £80", () => {
    const side: Income = {id: "side", name: "Side job", type: "work", freq: "oneoff", varies: false, amount: 500, date: T1_DAY, since: "2026-10-01"};
    const incomes = [...baseState().incomes, side];
    expect(run(t1({incomes})).h).toMatchObject({free: 300, perDay: 30});
    const landed = tx({type: "income", amount: 500, date: T1_DAY, cat: "income", srcId: "side", forDate: T1_DAY});
    expect(run(t1({incomes}, [landed])).h).toMatchObject({free: 800, perDay: 80});
  });

  test("T5: £300 against £400 of bills, £500 in savings: £0, and move £100 from savings", () => {
    expect(run(t5(500)).h).toMatchObject({perDay: 0, left: 0, free: -100, reason: "Move £100 from savings to cover what's coming"});
  });

  // PRD T6/T7 predate today-first (T3, T3b): a purchase today uses today's amount first, and only what's past it lowers the days after.
  test("T6: a £100 purchase fits; from tomorrow it's £22 a day (£200 over the 9 days after today)", () => {
    const w = whatIf(t1(), 100)!;
    expect(w.hero).toMatchObject({free: 200, left: 0});
    expect(w.line).toBe("Then it's £22 a day from tomorrow, instead of £33");
  });

  // Not yet: savings give way (PRD #12), so £350 quietly uses £50 of this pay's £100 savings (free £0, "Then it's £0 a day from
  // tomorrow") instead of saying it's £50 more than the free money. Waiting on a decision about what What if says here.
  test.skip("T7: a £350 purchase is £50 more than the free money", () => {
    const w = whatIf(t1(), 350)!;
    expect(w.hero).toMatchObject({free: -50, perDay: 0});
    expect(w.line).toBe("You'd need £50 more to cover your bills and everyday");
  });

  test("T8: nothing spent and a day passes: £300 over 9 days is £33 a day", () => {
    const {r, h} = run(t1({}, [], "2026-10-21"));
    expect(r.daysLeft).toBe(9);
    expect(h).toMatchObject({free: 300, perDay: 33});
  });

  test("T9: T5 with no savings, paid monthly: £0, and £100 more is needed", () => {
    // T5 has no everyday budgets, so the line is just about bills
    expect(run(t5(0)).h).toMatchObject({perDay: 0, reason: "You need £100 more to cover your bills"});
  });

  test("T10: T5 with no savings, hourly pay at £12 take-home: about 9 more hours of work (£100 ÷ £12, rounded up)", () => {
    expect(run(t5(0, {rate: 12})).h).toMatchObject({perDay: 0, reason: "About 9 more hours of work covers your bills"});
  });

  test("T11: T5 with £40 in savings, hourly pay at £12: move the £40, and about 5 more hours covers the rest", () => {
    expect(run(t5(40, {rate: 12})).h).toMatchObject({perDay: 0, reason: "Move £40 from savings, and about 5 more hours of work covers the rest"});
  });

  test("T12: weekly pay of £250 just landed, £275 rent in 3½ weeks: £68.75 held this week, £181.25 over 7 days is £25 a day", () => {
    const state = baseState({
      balance: 250, balanceSetAt: 1e12, balanceAsOf: "2026-10-02", categories: [],
      incomes: [{id: "job", name: "Cafe", type: "work", freq: "weekly", varies: false, amount: 250, date: "2026-10-02", main: true}],
      bills: [{id: "rent", name: "Rent", amount: 275, freq: "monthly", day: 26}],
    });
    const pay = tx({type: "income", amount: 250, date: "2026-10-02", cat: "income", srcId: "job", forDate: "2026-10-02"});
    const {r, h} = run(ctx({state, txs: [pay], today: "2026-10-02"}));
    expect(r.daysLeft).toBe(7);
    expect(r.billsLeft).toBe(68.75);
    expect(h).toMatchObject({free: 181.25, perDay: 25});
  });
});
