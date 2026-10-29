import {billsAhead, billsLine, calc, calendar, comingUp, dayDetail, dayFigure, forecast, freeSummary, gapLine, hero, moneyBar, moneyBarOn, payCycle, saveKey, savingPerPay, split, tomorrowLine} from "../calc";
import {addDays, niceTime} from "../dates";
import {pendingCheckins} from "../income";
import {r2} from "../money";
import {todayBreakdown, usedUp} from "../today";
import type {AppState, Ctx, Tx} from "../types";
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

  test("PRD T1/T3: today-first. Spending comes off today's amount, and the days after adjust", () => {
    // Tue 20 Oct, 10 days to payday. £500 to spend, groceries' £200 kept aside, no bills before payday: £300 free, £30 a day
    const day = (...txs: ReturnType<typeof tx>[]) => ctx({today: "2026-10-20", state: baseState({balance: 500}), txs});
    expect(run(day()).h).toMatchObject({perDay: 30, left: 30, free: 300});
    // £30 spent: today's £30 is used, and tomorrow is still £30 (£270 over the 9 days after)
    const used = day(tx({amount: 30, date: "2026-10-20"})), u = run(used);
    expect(u.h).toMatchObject({perDay: 30, left: 0, spentToday: 30, free: 270});
    expect(usedUp(used, u.r, u.h)?.lead).toBe("You've used today's £30.");
    expect(forecast(used, u.r, "2026-10-21")?.amount).toBe(30);
    // £50 spent: past today's amount, so the days after come down (£250 over 9 days)
    expect(run(day(tx({amount: 50, date: "2026-10-20"}))).h).toMatchObject({perDay: 30, left: 0, reason: "£50 spent today. From tomorrow, £27 a day"});
  });

  test("a bill paid early isn't held back any more", () => {
    const {r} = run(ctx({txs: [groceries, tx({amount: 400, date: "2026-10-05", cat: "rent", billId: "rent", forDate: "2026-10-15"})]}));
    expect(r.billsLeft).toBe(0);
    expect(r.balance).toBe(550);
  });

  test("short: stops at £0, never below, and says the whole gap, calmly", () => {
    const state = baseState({bills: [{id: "car", name: "Car", amount: 1200, freq: "monthly", day: 20}]});
    const {r, h} = run(ctx({state, txs: [groceries]}));
    expect(r.need).toBe(1350);
    expect(r.short).toBe(400);
    expect(h).toMatchObject({kind: "number", perDay: 0, left: 0, reason: "You need £400 more to cover your bills and everyday"});
    expect(h.kind === "number" && h.reason).not.toMatch(/short|move/i);
  });

  test("short with money in savings: move it from savings first, then say what's still needed", () => {
    const car = {id: "car", name: "Car", amount: 1200, freq: "monthly" as const, day: 20};
    const withSavings = (amount: number) => {
      const bank = {source: "Monzo", accountId: "acc", main: 0, asOf: "2026-10-05T08:00:00Z",
        pots: [{id: "hol", name: "Holiday", balance: amount, role: "save" as const}, {id: "bills", name: "Bills", balance: 999, role: "spend" as const}]};
      return run(ctx({state: baseState({bills: [car], bank}), txs: [groceries]}));
    };
    // savings covers all £400 (spend pots never count as savings)
    expect(withSavings(500).h).toMatchObject({perDay: 0, left: 0, reason: "Move £400 from savings to cover what's coming"});
    expect(withSavings(400).h).toMatchObject({reason: "Move £400 from savings to cover what's coming"});
    // savings covers some of it: the rest is how much more is needed
    expect(withSavings(150).h).toMatchObject({reason: "Move £150 from savings, then you need £250 more"});
    // an empty pot: just how much more
    expect(withSavings(0).h).toMatchObject({reason: "You need £400 more to cover your bills and everyday"});
    const some = withSavings(150).h;
    expect(some.kind === "number" && some.reason).not.toMatch(/short/i);
  });

  test("hourly pay with a take-home rate: what savings can't cover is said in hours of work, rounded up", () => {
    const car = {id: "car", name: "Car", amount: 1200, freq: "monthly" as const, day: 20};
    const hourly = (rate: number, saved = 0) => {
      const bank = {source: "Monzo", accountId: "acc", main: 0, asOf: "2026-10-05T08:00:00Z", pots: [{id: "hol", name: "Holiday", balance: saved, role: "save" as const}]};
      return ctx({state: baseState({bills: [car], bank, incomes: [{...baseState().incomes[0], rate}]}), txs: [groceries]});
    };
    // £400 more needed at £12 an hour: 33.3, so 34 hours
    expect(run(hourly(12)).h).toMatchObject({reason: "About 34 more hours of work covers your bills and everyday"});
    expect(run(hourly(400)).h).toMatchObject({reason: "About 1 more hour of work covers your bills and everyday"});
    expect(run(hourly(12, 150)).h).toMatchObject({reason: "Move £150 from savings, and about 21 more hours of work covers the rest"});
    // savings cover it all: no hours
    expect(run(hourly(12, 500)).h).toMatchObject({reason: "Move £400 from savings to cover what's coming"});
    // trying out a payment
    const c = hourly(12), r = calc(c);
    expect(gapLine(c, r, 24, true)).toBe("You'd need about 2 more hours of work to cover it");
    const s = hourly(12, 10), rs = calc(s);
    expect(gapLine(s, rs, 34, true)).toBe("You'd need £10 from savings and about 2 more hours of work");
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

  test("without enough, it's £0 until payday, never below, and pay covers it by itself", () => {
    const state = baseState({bills: [{id: "car", name: "Car", amount: 1200, freq: "monthly", day: 20}]});
    const c = ctx({state, txs: [spent]}), r = calc(c);
    expect(forecast(c, r, "2026-10-06")).toEqual({amount: 0, free: -400});
    expect(dayFigure(c, r, "2026-10-06").reason).toBe("You'd need £400 more to cover your bills and everyday");
    expect(forecast(c, r, "2026-10-30")).toEqual({amount: 0, free: 0});
  });

  test("the main card only says what you could spend: what's going out is left to the list below", () => {
    const c = ctx({txs: [spent]}), r = calc(c);
    expect(dayFigure(c, r, "2026-10-15").label).toBe("Safe to Spend");
  });
});

describe("savings set aside each pay, counted once they move (PRD #12)", () => {
  // PRD T1: balance £1,000; bills £400; everyday £200; savings £100; 10 days left (Tue 20 Oct to payday Fri 30 Oct)
  const t1 = (over: Partial<AppState> = {}, txs: Tx[] = []) => {
    const state = baseState({bills: [{id: "rent", name: "Rent", amount: 400, freq: "monthly", day: 25}], saving: 100, ...over});
    return run(ctx({state, txs, today: "2026-10-20"}));
  };
  const moved = (amount: number) => tx({type: "save", amount, date: "2026-10-20", cat: "savings"});

  test("T1: savings not moved yet are held back, so it's £30 a day", () => {
    const {r, h} = t1();
    expect(r.daysLeft).toBe(10);
    expect(r.savingHeld).toBe(100);
    expect(h).toMatchObject({free: 300, perDay: 30});
  });

  test("once it's moved it's left the balance, so it isn't held back again: still £30", () => {
    expect(t1({}, [moved(100)])).toMatchObject({r: {balance: 900, savingHeld: 0}, h: {free: 300, perDay: 30}});
    // part of it moved: only the rest is held back
    expect(t1({}, [moved(40)])).toMatchObject({r: {balance: 960, savingLeft: 60, savingHeld: 60}, h: {perDay: 30}});
  });

  test("counted net: money moved back out of savings is held back again", () => {
    const back = tx({type: "income", amount: 100, date: "2026-10-20", cat: "savings"});
    expect(t1({}, [moved(100), back])).toMatchObject({r: {balance: 1000, savingHeld: 100}, h: {perDay: 30}});
  });

  test("savings give way: only what bills and everyday leave over is held, and it never makes a gap", () => {
    const {r, h} = t1({balance: 650});
    expect(r.savingHeld).toBe(50);
    expect(h).toMatchObject({free: 0, perDay: 0});
    expect(h.kind === "number" && h.reason).not.toMatch(/need|move/i);
    // not even enough for bills and everyday: nothing held, and the line is about those
    expect(t1({balance: 500})).toMatchObject({r: {savingHeld: 0}, h: {free: -100, reason: "You need £100 more to cover your bills and everyday"}});
  });

  test("\"Not this time\" lets this pay off", () => {
    expect(t1({skipped: {[saveKey("2026-09-30")]: true}})).toMatchObject({r: {savingHeld: 0}, h: {perDay: 40}});
  });

  test("nothing chosen, nothing held", () => {
    expect(t1({saving: undefined}).r.savingHeld).toBe(0);
  });

  test("each pay's share: a month's worth when paid monthly, a year's over 52 when weekly", () => {
    expect(savingPerPay(ctx({state: baseState({saving: 100})}))).toBe(100);
    const weekly = baseState({saving: 100, incomes: [{id: "job", name: "Shop", type: "work", freq: "weekly", varies: false, amount: 400, date: "2026-10-02", main: true}]});
    expect(savingPerPay(ctx({state: weekly}))).toBe(23.08);
  });

  test("days to come: each payday holds back that pay's savings too, after its bills and everyday", () => {
    const c = ctx({state: baseState({saving: 100}), txs: [tx({amount: 30, date: "2026-10-01", cat: "groceries"})]}), r = calc(c);
    // now: £400 free less £100 savings, £12 a day for 25 days
    expect(hero(c, r)).toMatchObject({free: 300, perDay: 12});
    // payday: £1,800 in, £620 of bills and everyday, then £100 savings: £1,080 over 31 days
    expect(forecast(c, r, "2026-10-30")).toEqual({amount: 34, free: 1080});
  });

  test("the Month tab's free money says savings are held back too", () => {
    expect(freeSummary(t1().r).sub).toBe("After £400 of bills, £200 of everyday and £100 for savings. Spend it whenever suits you");
  });
});

test("the bar on a day to come: where the money would be by then, spending each day's amount", () => {
  const c = ctx({txs: [tx({amount: 30, date: "2026-10-01", cat: "groceries"})]}), r = calc(c);
  const bar = (d: string, cc = c) => moneyBarOn(cc, calc(cc), d)!.map(p => `${p.label} ${p.amount}`);
  // tomorrow: rent still to go, a day's worth of everyday spent at an even pace (170 × 24/25), and £16 spent
  expect(bar("2026-10-06")).toEqual(["Bills 400", "Everyday 163.2", "Savings 0", "Free 384"]);
  // after rent's gone out, 10 days of everyday left, and 15 days' amounts spent
  expect(bar("2026-10-20")).toEqual(["Bills 0", "Everyday 68", "Savings 0", "Free 160"]);
  // payday: the new cycle's bills (Phone 1 Nov, Rent 15 Nov) and everyday in full, and what's free after them
  expect(bar("2026-10-30")).toEqual(["Bills 420", "Everyday 200", "Savings 0", "Free 1180"]);
  // with savings: that pay's savings still to put away (this pay's has gone by then)
  const s = ctx({state: baseState({saving: 100}), txs: c.txs});
  expect(bar("2026-10-20", s)).toEqual(["Bills 0", "Everyday 68", "Savings 100", "Free 120"]);
  expect(bar("2026-10-30", s)).toEqual(["Bills 420", "Everyday 200", "Savings 100", "Free 1080"]);
  // today is today's bar
  expect(moneyBarOn(c, r, "2026-10-05")).toEqual(moneyBar(r));
});

test("the bar on a day gone: what was left of its pay cycle at the end of it", () => {
  const spent = [tx({amount: 30, date: "2026-10-01", cat: "groceries"}), tx({amount: 20, date: "2026-10-04"})];
  const c = ctx({txs: spent});
  const bar = (d: string, cc = c) => moneyBarOn(cc, calc(cc), d)!.map(p => `${p.label} ${p.amount}`);
  // the £20 on the 4th hadn't gone yet on the 2nd: £970 then, less rent and what was left of groceries
  expect(bar("2026-10-02")).toEqual(["Bills 400", "Everyday 170", "Savings 0", "Free 400"]);
  expect(bar("2026-10-04")).toEqual(["Bills 400", "Everyday 170", "Savings 0", "Free 380"]);
  // savings held until they were moved (on the 3rd), then gone from the bar and from the balance
  const s = ctx({state: baseState({saving: 100}), txs: [...spent, tx({type: "save", amount: 100, date: "2026-10-03", cat: "savings"})]});
  expect(bar("2026-10-02", s)).toEqual(["Bills 400", "Everyday 170", "Savings 100", "Free 300"]);
  expect(bar("2026-10-04", s)).toEqual(["Bills 400", "Everyday 170", "Savings 0", "Free 280"]);
  // payday itself has no cycle left to show
  expect(moneyBarOn(c, calc(c), "2026-09-30")).toBeNull();
});

test("the bar under today's card: what's left of the pay cycle, adding up to your spending money", () => {
  const c = ctx({txs: [tx({amount: 30, date: "2026-10-01", cat: "groceries"})]}), r = calc(c);
  expect(moneyBar(r).map(p => `${p.label} ${p.amount}`)).toEqual(["Bills 400", "Everyday 170", "Savings 0", "Free 400"]);
  // this pay's savings not put away yet are savings, not free; savings already in a pot aren't spending money, so aren't here
  const s = ctx({state: baseState({saving: 100}), txs: c.txs}), rs = calc(s);
  expect(moneyBar(rs).map(p => `${p.label} ${p.amount}`)).toEqual(["Bills 400", "Everyday 170", "Savings 100", "Free 300"]);
  expect(moneyBar(rs).reduce((a, p) => a + p.amount, 0)).toBe(rs.balance);
});

describe("bills bigger than one pay, held back over the pays before them (PRD #28)", () => {
  // PRD T12: weekly pay of £250 just arrived (Fri 2 Oct); £275 rent on Mon 26 Oct, 3½ weeks away, so 4 pays land before it
  const paid = (d: string) => tx({type: "income", amount: 250, date: d, cat: "income", srcId: "job", forDate: d});
  const weekly = (today: string, balance: number, over: Partial<AppState> = {}) => {
    const pays = ["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"].filter(d => d <= today).map(paid);
    const state = baseState({
      balance, balanceSetAt: 1e12, balanceAsOf: "2026-10-02", categories: [],
      incomes: [{id: "job", name: "Cafe", type: "work", freq: "weekly", varies: false, amount: 250, date: "2026-10-02", main: true}],
      bills: [{id: "rent", name: "Rent", amount: 275, freq: "monthly", day: 26}], ...over,
    });
    return ctx({state, txs: pays, today});
  };

  test("T12: £68.75 of rent is held back this week, so £181.25 over 7 days is £25 a day", () => {
    const c = weekly("2026-10-02", 250), {r, h} = run(c);
    expect(r.payday).toBe("2026-10-09");
    expect(r.billsDue).toEqual([]);
    expect(r.billsAhead.map(x => `${x.b.id} ${x.d} ${x.held}`)).toEqual(["rent 2026-10-26 68.75"]);
    expect(r.billsLeft).toBe(68.75);
    expect(h).toMatchObject({free: 181.25, perDay: 25});
    expect(billsLine(r)).toBe("Nothing is due before payday on Fri 9 Oct. £68.75 is saved up for Rent on Mon 26 Oct, a bit each pay so it's ready in time.");
    expect(todayBreakdown(c, r)!.now[1]).toMatchObject({label: "Bills before payday", note: "a bit saved up for Rent on Mon 26 Oct", amount: -68.75});
  });

  test("it's counted up as the pays go by, so what was held last week isn't held twice", () => {
    // spending each week's £181.25 leaves last week's share in the balance
    expect(run(weekly("2026-10-09", 318.75))).toMatchObject({r: {billsAheadTotal: 137.5}, h: {free: 181.25, perDay: 25}});
    expect(run(weekly("2026-10-16", 387.5))).toMatchObject({r: {billsAheadTotal: 206.25}, h: {free: 181.25, perDay: 25}});
    // the week it's due in holds it all, as any bill before payday, and nothing yet for next month's
    const last = run(weekly("2026-10-23", 456.25));
    expect(last.r).toMatchObject({billsLeft: 275, billsAheadTotal: 0});
    expect(last.h).toMatchObject({free: 181.25, perDay: 25});
  });

  test("days to come: each payday sets aside one more share, never the whole bill at once", () => {
    const c = weekly("2026-10-02", 250), r = calc(c);
    for (const p of ["2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"]) {
      const before = forecast(c, r, addDays(p, -1))!, after = forecast(c, r, p)!;
      expect(r2(after.free - (before.free - before.amount))).toBe(181.25);
    }
  });

  test("paid early: nothing held for it", () => {
    const early = tx({amount: 275, date: "2026-10-02", billId: "rent", forDate: "2026-10-26"});
    const c = weekly("2026-10-02", 250);
    expect(calc({...c, txs: [...c.txs, early]}).billsAhead).toEqual([]);
  });

  test("paid monthly with monthly bills, nothing changes: one pay covers each", () => {
    expect(calc(ctx()).billsAhead).toEqual([]);
  });

  test("a yearly bill is spread over the pays from when you started tracking, not dropped on one", () => {
    const car = {id: "car", name: "Car insurance", amount: 600, freq: "yearly" as const, date: "2027-03-01"};
    const c = ctx({state: baseState({bills: [...baseState().bills, car]})});
    // 6 pays from Wed 30 Sep to Fri 26 Feb, the one before it's due: £100 each
    const {r, h} = run(c);
    expect(r.billsAhead.map(x => `${x.b.id} ${x.held}`)).toEqual(["car 100"]);
    expect(h).toMatchObject({free: 300, perDay: 12});
    // by December, 3 pays in: £300 held
    const dec = {...c, today: "2026-12-10"}, rd = calc(dec);
    expect(billsAhead(dec, rd.cycleFrom, rd.payday!).map(x => x.held)).toEqual([300]);
    // added in December: shared over the 4 pays left from then, not caught up
    const added = {...dec, state: baseState({bills: [{...car, since: "2026-12-10"}]})};
    expect(billsAhead(added, rd.cycleFrom, rd.payday!).map(x => x.held)).toEqual([150]);
  });
});

describe("late pay: a missed payday is assumed a week away (PRD #4)", () => {
  // Pay on Wed 30 Sep was never confirmed (tracking started in September). The next one is Fri 30 Oct.
  const missed = (today = TODAY, over: Partial<AppState> = {}, txs: Tx[] = []) =>
    ctx({state: baseState({incomes: [{...baseState().incomes[0], since: "2026-09-01"}], ...over}), txs, today});
  const paidSep30 = tx({type: "income", amount: 1800, date: "2026-09-30", srcId: "job", forDate: "2026-09-30"});

  test("the last payday passed with no pay: payday is a week away, and the number is free ÷ 7", () => {
    // £1,000 less the £400 rent (15 Oct, held in full) and £200 everyday: £400 free, over 7 days
    const {r, h} = run(missed());
    expect(r).toMatchObject({late: true, payday: "2026-10-12", daysLeft: 7});
    expect(h).toMatchObject({kind: "number", free: 400, perDay: 57, reason: "Pay hasn't arrived, so this lasts a week"});
  });

  test("the next real payday within a week is used as it is, not assumed", () => {
    expect(run(missed("2026-10-26")).r).toMatchObject({late: false, payday: "2026-10-30", daysLeft: 4});
  });

  test("pay that lands, or is marked not coming, puts payday back to the real one", () => {
    expect(run(missed(TODAY, {}, [paidSep30])).r).toMatchObject({late: false, payday: "2026-10-30"});
    expect(run(missed(TODAY, {skipped: {"job_2026-09-30": true}})).r).toMatchObject({late: false, payday: "2026-10-30"});
  });

  test("snoozing doesn't end it: a week away today, and a week away again tomorrow", () => {
    expect(run(missed(TODAY, {snoozed: {"job_2026-09-30": TODAY}})).r).toMatchObject({late: true, payday: "2026-10-12", daysLeft: 7});
    expect(run(missed("2026-10-06", {snoozed: {"job_2026-09-30": TODAY}})).r).toMatchObject({late: true, payday: "2026-10-13", daysLeft: 7});
  });

  test("payday itself is payday today, not late", () => {
    expect(run(missed("2026-10-30")).h.kind).toBe("payday-today");
    expect(run(missed("2026-10-30")).r.late).toBe(false);
  });

  test("the forecast stops at the assumed payday, and Coming up has no pay on it", () => {
    const c = missed(), r = calc(c);
    expect(forecast(c, r, "2026-10-08")).not.toBeNull();
    expect(forecast(c, r, "2026-10-12")).toBeNull();
    expect(comingUp(c, r).some(x => x.kind === "pay")).toBe(false);
  });

  test("the Month calendar doesn't mark the assumed payday as pay", () => {
    const c = missed(), r = calc(c), {days} = calendar(c, r);
    expect(days.find(x => x.d === "2026-10-12")!.kinds).not.toContain("pay");
    expect(days.find(x => x.d === "2026-10-12")!.label).not.toContain("payday");
  });
});
