import {billDates, billPaid, nextBill} from "../bills";
import {cycleStart, nextPayday, occurrences, pendingCheckins} from "../income";
import type {Bill, Income} from "../types";
import {baseState, ctx, tx} from "./fixtures";

const income = (o: Partial<Income>): Income => ({id: "i", name: "Pay", type: "work", freq: "monthly-date", varies: false, amount: 100, ...o});
const bill = (o: Partial<Bill>): Bill => ({id: "b", name: "Bill", amount: 10, freq: "monthly", ...o});

describe("pay moves earlier on weekends and bank holidays", () => {
  test("last working day skips a Saturday", () => {
    expect(occurrences(income({freq: "monthly-lastworking"}), "2026-10-01", "2026-12-31")).toEqual(["2026-10-30", "2026-11-30", "2026-12-31"]);
  });
  test("last Friday", () => {
    expect(occurrences(income({freq: "monthly-lastfri"}), "2026-10-01", "2026-10-31")).toEqual(["2026-10-30"]);
  });
  test("a date on Christmas Day lands on Christmas Eve", () => {
    expect(occurrences(income({day: 25}), "2026-12-01", "2026-12-31")).toEqual(["2026-12-24"]);
  });
  test("a 4-weekly date on the Boxing Day holiday skips back past the weekend and Christmas", () => {
    expect(occurrences(income({freq: "fourweekly", date: "2026-11-30"}), "2026-12-01", "2026-12-31")).toEqual(["2026-12-24"]);
  });
  test("a one-off only counts inside the range", () => {
    expect(occurrences(income({freq: "oneoff", date: "2026-10-10"}), "2026-10-01", "2026-10-31")).toEqual(["2026-10-10"]);
    expect(occurrences(income({freq: "oneoff", date: "2026-11-10"}), "2026-10-01", "2026-10-31")).toEqual([]);
  });
  test("the 31st becomes the last day in short months", () => {
    expect(occurrences(income({day: 31}), "2027-02-01", "2027-02-28")).toEqual(["2027-02-26"]);   // 28th is a Sunday
  });
});

describe("bills move later on weekends and bank holidays", () => {
  test("monthly on the 25th of December waits until the 29th", () => {
    expect(billDates(bill({day: 25}), "2026-12-01", "2026-12-31")).toEqual(["2026-12-29"]);
  });
  test("monthly on the 1st skips to Monday", () => {
    expect(billDates(bill({day: 1}), "2026-11-01", "2026-11-30")).toEqual(["2026-11-02"]);
  });
  test("'last' means the last working day", () => {
    expect(billDates(bill({day: "last"}), "2026-10-01", "2026-10-31")).toEqual(["2026-10-30"]);
  });
  test("quarterly keeps the day, capped at the month's end", () => {
    expect(billDates(bill({freq: "quarterly", date: "2026-01-31"}), "2026-01-01", "2026-12-31")).toEqual(["2026-02-02", "2026-04-30", "2026-07-31", "2026-11-02"]);
  });
  test("yearly", () => {
    expect(billDates(bill({freq: "yearly", date: "2026-02-28"}), "2027-01-01", "2027-12-31")).toEqual(["2027-03-01"]);
  });
  test("weekly needs a start date", () => {
    expect(billDates(bill({freq: "weekly"}), "2026-10-01", "2026-10-31")).toEqual([]);
    expect(billDates(bill({freq: "weekly", date: "2026-10-02"}), "2026-10-01", "2026-10-20")).toEqual(["2026-10-02", "2026-10-09", "2026-10-16"]);
  });
  test("nextBill", () => {
    expect(nextBill(bill({day: 15}), "2026-10-15")).toBe("2026-10-15");
    expect(nextBill(bill({day: 15}), "2026-10-16")).toBe("2026-11-16");   // 15 Nov is a Sunday
  });
});

describe("paid bills", () => {
  const rent = baseState().bills[0];
  test("a payment filed against the bill", () => {
    expect(billPaid(ctx({txs: [tx({amount: 400, date: "2026-10-14", billId: "rent", forDate: "2026-10-15"})]}), rent, "2026-10-15")).toBe(true);
  });
  test("a payment in the bill's category from a week before to 3 days after", () => {
    expect(billPaid(ctx({txs: [tx({amount: 400, date: "2026-10-08", cat: "rent"})]}), rent, "2026-10-15")).toBe(true);
    expect(billPaid(ctx({txs: [tx({amount: 400, date: "2026-10-18", cat: "rent"})]}), rent, "2026-10-15")).toBe(true);
    expect(billPaid(ctx({txs: [tx({amount: 400, date: "2026-10-07", cat: "rent"})]}), rent, "2026-10-15")).toBe(false);
    expect(billPaid(ctx({txs: [tx({amount: 400, date: "2026-10-19", cat: "rent"})]}), rent, "2026-10-15")).toBe(false);
  });
});

describe("payday", () => {
  test("next payday is the next one that hasn't landed", () => {
    expect(nextPayday(ctx())).toBe("2026-10-30");
  });
  test("pay already received moves payday on", () => {
    const c = ctx({today: "2026-10-30", txs: [tx({type: "income", amount: 1800, date: "2026-10-30", srcId: "job", forDate: "2026-10-30"})]});
    expect(nextPayday(c)).toBe("2026-11-30");
  });
  test("pay marked not coming is skipped", () => {
    expect(nextPayday(ctx({state: baseState({skipped: {"job_2026-10-30": true}})}))).toBe("2026-11-30");
  });
  test("the cycle starts on the last payday", () => {
    expect(cycleStart(ctx())).toBe("2026-09-30");
  });
  test("no regular income, no payday", () => {
    expect(nextPayday(ctx({state: baseState({incomes: []})}))).toBeNull();
  });
});

describe("pay check-ins", () => {
  test("asks about a payday that hasn't been confirmed", () => {
    const p = pendingCheckins(ctx());
    expect(p.map(x => x.key)).toEqual(["job_2026-09-30"]);   // 28 Aug is before `since`
  });
  test("stops asking once it arrived, was skipped, or was snoozed today", () => {
    expect(pendingCheckins(ctx({txs: [tx({type: "income", amount: 1800, date: "2026-09-30", srcId: "job", forDate: "2026-09-30"})]}))).toEqual([]);
    expect(pendingCheckins(ctx({state: baseState({skipped: {"job_2026-09-30": true}})}))).toEqual([]);
    expect(pendingCheckins(ctx({state: baseState({snoozed: {"job_2026-09-30": "2026-10-05"}})}))).toEqual([]);
  });
  test("a snooze only lasts for the day", () => {
    expect(pendingCheckins(ctx({state: baseState({snoozed: {"job_2026-09-30": "2026-10-04"}})}))).toHaveLength(1);
  });
});
