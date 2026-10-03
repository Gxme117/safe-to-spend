import {billsLine, calc, calendar, comingUp, freeSummary, hero, payCycle, split} from "../calc";
import type {Ctx} from "../types";
import {baseState, ctx, tx} from "./fixtures";

const run = (c: Ctx) => { const r = calc(c); return {r, h: hero(c, r)}; };

// £1,000 typed in. £50 of groceries since, so £950 to spend.
// Rent £400 on Thu 15 Oct is before payday on Fri 30 Oct. Phone (Mon 2 Nov) is after it.
// Groceries: £200 a month, £50 used, £150 kept aside. Free: 950 − 400 − 150 = £400 over 25 days = £16 a day.
const groceries = tx({amount: 50, date: "2026-10-02", cat: "groceries"});

describe("the daily number", () => {
  test("holds back bills before payday and what's left of everyday", () => {
    const {r, h} = run(ctx({txs: [groceries]}));
    expect(r.balance).toBe(950);
    expect(r.payday).toBe("2026-10-30");
    expect(r.daysLeft).toBe(25);
    expect(r.billsDue.map(x => `${x.b.id} ${x.d}`)).toEqual(["rent 2026-10-15"]);
    expect(r.billsLeft).toBe(400);
    expect(r.everydayLeft).toBe(150);
    expect(r.short).toBe(0);
    expect(h).toMatchObject({kind: "number", free: 400, perDay: 16, reason: "Lasts you until payday, Fri 30 Oct"});
  });

  test("spending today shows what's left of today", () => {
    const {h} = run(ctx({txs: [groceries, tx({amount: 10, date: "2026-10-05", cat: "eating"})]}));
    // free 390 / 25 = 15.60; 15.60 − 10 = 5.60
    expect(h).toMatchObject({kind: "number", perDay: 15.6, spentToday: 10, reason: "£5.60 left today after £10 spent"});
  });

  test("everyday spending doesn't count against today; it comes out of its own amount", () => {
    const {r, h} = run(ctx({txs: [groceries, tx({amount: 30, date: "2026-10-05", cat: "groceries"})]}));
    expect(r.everydayLeft).toBe(120);
    expect(h).toMatchObject({perDay: 16, spentToday: 0});
  });

  test("a big day just lowers the days ahead, without judgement", () => {
    const {h} = run(ctx({txs: [groceries, tx({amount: 100, date: "2026-10-05"})]}));
    expect(h.kind === "number" && h.reason).toBe("£100 spent today. The days ahead adjust");
  });

  test("a bill paid early isn't held back any more", () => {
    const {r} = run(ctx({txs: [groceries, tx({amount: 400, date: "2026-10-05", cat: "rent", billId: "rent", forDate: "2026-10-15"})]}));
    expect(r.billsLeft).toBe(0);
    expect(r.balance).toBe(550);
  });

  test("short: says by how much, with no scolding", () => {
    const state = baseState({bills: [{id: "car", name: "Car", amount: 1200, freq: "monthly", day: 20}]});
    const {r, h} = run(ctx({state, txs: [groceries]}));
    expect(r.need).toBe(1350);
    expect(r.short).toBe(400);
    expect(h).toMatchObject({kind: "number", reason: "£400 short for bills and everyday"});
    if (h.kind === "number") expect(h.perDay).toBeLessThan(0);
  });

  test("payments logged before the balance was typed in aren't counted twice", () => {
    const {r} = run(ctx({txs: [tx({amount: 50, date: "2026-09-29", created: 500})]}));
    expect(r.balance).toBe(1000);
  });

  test("payday today and no income are their own states", () => {
    expect(run(ctx({today: "2026-10-30"})).h).toEqual({kind: "payday-today"});
    expect(run(ctx({state: baseState({incomes: []})})).h).toEqual({kind: "no-income"});
  });

  test("the reason line never scolds", () => {
    const cases = [
      ctx({txs: [groceries]}),
      ctx({txs: [groceries, tx({amount: 10, date: "2026-10-05"})]}),
      ctx({txs: [groceries, tx({amount: 500, date: "2026-10-05"})]}),
      ctx({state: baseState({bills: [{id: "x", name: "X", amount: 5000, freq: "monthly", day: 20}]})}),
    ];
    for (const c of cases) {
      const h = hero(c, calc(c));
      if (h.kind === "number") expect(h.reason).not.toMatch(/over|too much|careful|warning/i);
    }
  });
});

describe("month view", () => {
  const c = ctx({txs: [groceries, tx({amount: 8, date: "2026-10-03"})], state: baseState({balanceAsOf: "2026-10-01"})});
  const r = calc(c);

  test("pay cycle runs from the last payday to the next", () => {
    expect(payCycle(c, r)).toEqual({start: "2026-09-30", total: 30, dayNo: 6});
  });

  test("calendar marks no-spend days, spending, bills and payday", () => {
    const {lead, days} = calendar(c, r);
    expect(lead).toBe(2);   // Wed 30 Sep sits under W
    const at = (d: string) => days.find(x => x.d === d)!;
    expect(at("2026-09-30").kinds).toEqual(["none"]);       // before tracking started
    expect(at("2026-10-01").kinds).toEqual(["zero"]);
    expect(at("2026-10-02").note).toBe("£50");              // everyday spending still shows on the calendar
    expect(at("2026-10-03").note).toBe("£8");
    expect(at("2026-10-05").today).toBe(true);
    expect(at("2026-10-15")).toMatchObject({kinds: ["bill"], note: "£400"});
    expect(at("2026-10-30")).toMatchObject({kinds: ["pay"], note: "Pay"});
    expect(days).toHaveLength(31);
  });

  test("coming up lists bills then pay, in date order", () => {
    expect(comingUp(c, r).map(x => `${x.d} ${x.name} ${x.amt}`)).toEqual(["2026-10-15 Rent −£400", "2026-10-30 Pharmacy pay +£1,800"]);
  });

  test("split fills bills first, then everyday, then free", () => {
    expect(split(r).parts.map(p => p.amount)).toEqual([400, 150, 392]);
  });

  test("summary and bills sentences", () => {
    expect(freeSummary(r)).toMatchObject({free: 392, lead: "Free until payday"});
    expect(billsLine(r)).toBe("£400 is due before payday on Fri 30 Oct, so it's held back from your spending money.");
  });
});
