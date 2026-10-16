import {billsLine, calc, calendar, comingUp, dayDetail, dayFigure, forecast, freeSummary, hero, moneyBar, payCycle, split, tomorrowLine} from "../calc";
import {niceTime} from "../dates";
import {pendingCheckins} from "../income";
import type {Ctx} from "../types";
import {baseState, ctx, TODAY, tx} from "./fixtures";

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
    expect(h).toMatchObject({kind: "number", free: 400, perDay: 16, left: 16, reason: "Lasts you until payday, Fri 30 Oct"});
  });

  test("spending today comes off today's amount once, not off the share as well", () => {
    const {h} = run(ctx({txs: [groceries, tx({amount: 10, date: "2026-10-05", cat: "eating"})]}));
    // this morning £400 was free: £16 a day. £10 spent leaves £6 of it (not £15.60 − £10, which counts the £10 twice)
    expect(h).toMatchObject({kind: "number", perDay: 16, left: 6, spentToday: 10, free: 390, reason: "£10 spent of today's £16"});
    // tomorrow, with nothing else spent: £390 over 24 days, rounded down
    const next = run(ctx({today: "2026-10-06", txs: [groceries, tx({amount: 10, date: "2026-10-05", cat: "eating"})]})).h;
    expect(next).toMatchObject({perDay: 16, left: 16});
  });

  test("rounded down to whole pounds, so it never promises more than there is", () => {
    const {h} = run(ctx({txs: [groceries, tx({amount: 10, date: "2026-10-04"})]}));
    // £390 over 25 days is £15.60
    expect(h).toMatchObject({perDay: 15, left: 15});
  });

  test("everyday spending doesn't count against today; it comes out of its own amount", () => {
    const {r, h} = run(ctx({txs: [groceries, tx({amount: 30, date: "2026-10-05", cat: "groceries"})]}));
    expect(r.everydayLeft).toBe(120);
    expect(h).toMatchObject({perDay: 16, left: 16, spentToday: 0});
  });

  test("a big day just lowers the days ahead, without judgement, and says what tomorrow's is", () => {
    const {h} = run(ctx({txs: [groceries, tx({amount: 100, date: "2026-10-05"})]}));
    // £300 left free over the 24 days after today: £12.50, rounded down
    expect(h).toMatchObject({perDay: 16, left: 0, reason: "£100 spent today. From tomorrow, £12 a day"});
  });

  test("a bill paid early isn't held back any more", () => {
    const {r} = run(ctx({txs: [groceries, tx({amount: 400, date: "2026-10-05", cat: "rent", billId: "rent", forDate: "2026-10-15"})]}));
    expect(r.billsLeft).toBe(0);
    expect(r.balance).toBe(550);
  });

  test("short: below £0 by the gap a day until payday, and says the whole gap, calmly", () => {
    const state = baseState({bills: [{id: "car", name: "Car", amount: 1200, freq: "monthly", day: 20}]});
    const {r, h} = run(ctx({state, txs: [groceries]}));
    expect(r.need).toBe(1350);
    expect(r.short).toBe(400);
    expect(r.daysLeft).toBe(25);   // -£400 over 25 days
    expect(h).toMatchObject({kind: "number", perDay: 0, left: -16, reason: "You need £400 more to cover your bills and everyday"});
    expect(h.kind === "number" && h.reason).not.toMatch(/short|move/i);
  });

  test("with no everyday left, the gap is just bills", () => {
    const state = baseState({categories: baseState().categories.filter(x => x.id !== "groceries"),
      bills: [{id: "car", name: "Car", amount: 1200, freq: "monthly", day: 20}]});
    const {r, h} = run(ctx({state, txs: [groceries]}));
    expect(r.everydayLeft).toBe(0);
    expect(h).toMatchObject({perDay: 0, reason: `You need ${"£" + (r.need - r.balance)} more to cover your bills`});
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
      if (h.kind === "number") expect(h.reason).not.toMatch(/\bover\b|too much|careful|warning/i);
    }
  });
});

describe("what today does to tomorrow", () => {
  test("nothing spent: what's free shared over the days after today", () => {
    const {r, h} = run(ctx({txs: [groceries]}));
    // £400 over the 24 days after today is £16.66, rounded down
    expect(tomorrowLine(r, h)).toBe("Spend nothing today and tomorrow's £16");
  });

  test("some spent, within today's amount: tomorrow still holds", () => {
    const {r, h} = run(ctx({txs: [groceries, tx({amount: 10, date: "2026-10-05", cat: "eating"})]}));
    expect(tomorrowLine(r, h)).toBe("Spend nothing more today and tomorrow's £16");
  });

  test("more than today's amount: the hero already says it, so no second line", () => {
    const {r, h} = run(ctx({txs: [groceries, tx({amount: 100, date: "2026-10-05", cat: "eating"})]}));
    expect(h.kind === "number" && h.reason).toMatch(/From tomorrow/);
    expect(tomorrowLine(r, h)).toBeNull();
  });

  test("nothing when payday is tomorrow, or there's nothing free", () => {
    const tomorrowPay = run(ctx({today: "2026-10-29", txs: [groceries]}));
    expect(tomorrowLine(tomorrowPay.r, tomorrowPay.h)).toBeNull();
    const big = ctx({state: baseState({bills: [{id: "x", name: "X", amount: 5000, freq: "monthly", day: 20}]})});
    const r = calc(big);
    expect(tomorrowLine(r, hero(big, r))).toBeNull();
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
    expect(comingUp(c, r).map(x => `${x.d} ${x.name} ${x.amt}`)).toEqual(["2026-10-15 Rent −£400", "2026-10-30 Pharmacy +£1,800"]);
  });

  test("split fills bills first, then everyday, then free", () => {
    expect(split(r).parts.map(p => p.amount)).toEqual([400, 150, 392]);
  });

  test("summary and bills sentences", () => {
    expect(freeSummary(r)).toMatchObject({free: 392, lead: "Free until payday"});
    expect(billsLine(r)).toBe("£400 is due before payday on Fri 30 Oct, so it's held back from your spending money.");
  });
});

describe("bills without a payment date yet", () => {
  // Council tax £160 a month and a £180 yearly TV licence, both waiting for a date: £160 + £15 is held back this cycle.
  const undated = [
    {id: "ct", name: "Council tax", amount: 160, freq: "monthly" as const},
    {id: "tv", name: "TV licence", amount: 180, freq: "yearly" as const},
  ];
  const withUndated = (over = {}) => ctx({state: baseState({bills: [...baseState().bills, ...undated]}), ...over});

  test("hold back a month's share each, without guessing a day", () => {
    const {r, h} = run(withUndated());
    expect(r.billsUndated).toBe(175);
    expect(r.billsLeft).toBe(575);
    expect(r.billsDue.map(x => x.b.id)).toEqual(["rent"]);
    // 1000 − 575 − 200 of groceries = 225 over 25 days
    expect(h).toMatchObject({kind: "number", free: 225, perDay: 9});
    expect(billsLine(r)).toBe("£400 is due before payday on Fri 30 Oct, plus £175 for bills without a date. It's held back from your spending money.");
  });

  test("a payment for one this pay cycle means it's paid", () => {
    const {r} = run(withUndated({txs: [tx({amount: 160, date: "2026-10-02", billId: "ct"})]}));
    expect(r.billsUndated).toBe(15);
  });

  test("a bill with no amount yet holds nothing back and isn't due on any day", () => {
    const {r} = run(ctx({state: baseState({bills: [...baseState().bills, {id: "subs", name: "Subscriptions", amount: 0, freq: "monthly", day: 10}, {...undated[0], amount: 0}]})}));
    expect(r.billsLeft).toBe(400);
    expect(r.billsUndated).toBe(0);
    expect(r.billsDue.map(x => x.b.id)).toEqual(["rent"]);
  });

  test("only undated bills: says what's held back", () => {
    const {r} = run(ctx({state: baseState({bills: [undated[0]]})}));
    expect(r.billsLeft).toBe(160);
    expect(billsLine(r)).toBe("£160 is held back for bills without a date. Add their dates to see when they go out.");
  });
});

describe("money in that isn't income", () => {
  test("a refund goes back to its category: Everyday left goes up, free stays the same", () => {
    const refund = tx({type: "income", amount: 20, date: "2026-10-04", cat: "refund", refundOf: "groceries"});
    const {r, h} = run(ctx({txs: [groceries, refund]}));
    expect(r.balance).toBe(970);
    expect(r.spent.groceries).toBe(30);
    expect(r.everyday[0]).toMatchObject({spent: 30, left: 170});
    expect(h).toMatchObject({free: 400, perDay: 16});
  });

  test("a refund bigger than what was spent this cycle doesn't make a category negative", () => {
    const refund = tx({type: "income", amount: 80, date: "2026-10-04", cat: "payback", refundOf: "groceries"});
    expect(run(ctx({txs: [groceries, refund]})).r.everyday[0]).toMatchObject({spent: 0, left: 200});
  });

  test("moving your own money in only adds to the balance", () => {
    const moved = tx({type: "income", amount: 100, date: "2026-10-04", cat: "transfer"});
    const {r, h} = run(ctx({txs: [groceries, moved]}));
    expect(r.balance).toBe(1050);
    expect(r.everydayLeft).toBe(150);
    expect(r.payday).toBe("2026-10-30");
    expect(h).toMatchObject({free: 500, perDay: 20});
  });
});

describe("money you're expecting", () => {
  const nandos = {id: "nan", name: "Nando's", type: "other" as const, freq: "oneoff" as const, varies: false, amount: 40, date: "2026-10-06", since: TODAY};
  const withIt = (over: Partial<Ctx> = {}) => ctx({state: baseState({incomes: [...baseState().incomes, nandos]}), txs: [groceries], ...over});

  test("shows on its day, but isn't counted until it lands", () => {
    const c = withIt(), r = calc(c);
    expect(comingUp(c, r).map(x => `${x.d} ${x.name} ${x.amt}`)).toEqual(["2026-10-06 Nando's +£40", "2026-10-15 Rent −£400", "2026-10-30 Pharmacy +£1,800"]);
    // the day it's due, Safe to Spend counts it: £384 left after today's £16, plus £40, over 24 days
    expect(dayFigure(c, r, "2026-10-06")).toMatchObject({label: "Safe to Spend", amount: 17});
    expect(hero(c, r)).toMatchObject({perDay: 16, free: 400});
  });

  test("the calendar marks its day; a bill on the same day keeps its note", () => {
    const c = withIt(), r = calc(c);
    const at = (d: string) => calendar(c, r).days.find(x => x.d === d)!;
    expect(at("2026-10-06")).toMatchObject({kinds: ["upcoming", "in"], note: "+£40", label: "Tue 6 Oct, Nando's £40 expected"});
    expect(dayDetail(c, r, at("2026-10-06"))).toBe("Tue 6 Oct: Nando's £40 expected. It counts once it lands.");
    const onRent = withIt({state: baseState({incomes: [...baseState().incomes, {...nandos, date: "2026-10-15"}]})}), r2 = calc(onRent);
    const rent = calendar(onRent, r2).days.find(x => x.d === "2026-10-15")!;
    expect(rent).toMatchObject({kinds: ["bill", "in"], note: "£400"});
    expect(dayDetail(onRent, r2, rent)).toMatch(/won't touch your daily amount\. Nando's £40 expected\. It counts once it lands\.$/);
  });

  test("goes once it's arrived or marked as not coming", () => {
    const arrived = withIt({txs: [groceries, tx({type: "income", amount: 40, date: "2026-10-06", cat: "nan", srcId: "nan", forDate: "2026-10-06"})], today: "2026-10-06"});
    expect(comingUp(arrived, calc(arrived)).some(x => x.kind === "in")).toBe(false);
    const gone = withIt({state: baseState({incomes: [...baseState().incomes, nandos], skipped: {"nan_2026-10-06": true}})});
    expect(comingUp(gone, calc(gone)).some(x => x.kind === "in")).toBe(false);
    expect(calendar(gone, calc(gone)).days.some(x => x.kinds.includes("in"))).toBe(false);
  });
});

describe("asking whether expected money arrived", () => {
  const nandos = {id: "nan", name: "Nando's", type: "other" as const, freq: "oneoff" as const, varies: false, amount: 40, date: TODAY, time: "14:00", since: TODAY};
  const c = ctx({state: baseState({incomes: [{...baseState().incomes[0], since: TODAY}, nandos]})});
  test("waits until the time it's due, then asks", () => {
    expect(pendingCheckins(c, "13:55").map(x => x.src.id)).toEqual([]);
    expect(pendingCheckins(c, "14:00").map(x => x.src.id)).toEqual(["nan"]);
  });
  test("doesn't ask once it's arrived", () => {
    const got = {...c, txs: [tx({type: "income", amount: 40, date: TODAY, cat: "nan", srcId: "nan", forDate: TODAY})]};
    expect(pendingCheckins(got, "15:00")).toEqual([]);
  });
  test("times read the UK way", () => {
    expect([niceTime("14:00"), niceTime("09:30"), niceTime("00:00"), niceTime("12:05")]).toEqual(["2pm", "9:30am", "12am", "12:05pm"]);
  });
});

describe("Safe to Spend on days to come", () => {
  const spent = tx({amount: 30, date: "2026-10-01", cat: "groceries"});

  test("spending each day's amount, it stays the same until payday", () => {
    const c = ctx({txs: [spent]}), r = calc(c);
    expect(hero(c, r)).toMatchObject({perDay: 16, free: 400});
    expect(forecast(c, r, "2026-10-06")).toEqual({amount: 16, free: 384});
    expect(forecast(c, r, "2026-10-29")).toEqual({amount: 16, free: 16});
  });

  test("from payday: pay comes in, that cycle's bills and everyday are set aside, and the rest lasts to the next payday", () => {
    const c = ctx({txs: [spent]}), r = calc(c);
    // £1,800 in; Phone £20, Rent £400 and Groceries £200 set aside; £1,180 over the 31 days to Mon 30 Nov
    expect(forecast(c, r, "2026-10-30")).toEqual({amount: 38, free: 1180});
    expect(dayFigure(c, r, "2026-10-30")).toEqual({label: "Safe to Spend", amount: 38, reason: "If you spend each day's amount until then"});
  });

  test("without enough, it's the gap a day until payday, and pay covers it by itself", () => {
    const state = baseState({bills: [{id: "car", name: "Car", amount: 1200, freq: "monthly", day: 20}]});
    const c = ctx({state, txs: [spent]}), r = calc(c);
    expect(forecast(c, r, "2026-10-06")).toEqual({amount: -17, free: -400});
    expect(dayFigure(c, r, "2026-10-06").reason).toBe("You'd need £400 more to cover your bills and everyday");
    expect(forecast(c, r, "2026-10-30")).toEqual({amount: 0, free: 0});
  });

  test("the main card only says what you could spend: what's going out is left to the list below", () => {
    const c = ctx({txs: [spent]}), r = calc(c);
    expect(dayFigure(c, r, "2026-10-15").label).toBe("Safe to Spend");
  });
});

test("the bar under today's card: bills, everyday, savings, then free", () => {
  const c = ctx({txs: [tx({amount: 30, date: "2026-10-01", cat: "groceries"})]}), r = calc(c);
  expect(moneyBar(r, 250).map(p => `${p.label} ${p.amount}`)).toEqual(["Bills 400", "Everyday 170", "Savings 250", "Free 400"]);
});
