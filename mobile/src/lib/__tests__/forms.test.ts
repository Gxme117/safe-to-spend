import {billFor, buildBill, type BillForm} from "../bills";
import {buildIncome, type IncomeForm} from "../income";
import {baseState, ctx, tx} from "./fixtures";

const inc = (o: Partial<IncomeForm> = {}): IncomeForm =>
  ({name: "Pharmacy", type: "work", freq: "monthly-lastworking", date: "", varies: false, amount: 1800, low: NaN, typical: NaN, main: true, ...o});

describe("building an income from the form", () => {
  test("a regular job", () => {
    expect(buildIncome(inc(), undefined, "i1", "2026-10-05")).toEqual({src: {
      id: "i1", name: "Pharmacy", type: "work", freq: "monthly-lastworking", varies: false, since: "2026-10-05", amount: 1800, main: true,
    }});
  });
  test("monthly on a date keeps the day of the month", () => {
    const r = buildIncome(inc({freq: "monthly-date", date: "2026-10-28"}), undefined, "i1", "2026-10-05");
    expect("src" in r && r.src.day).toBe(28);
  });
  test("an amount that changes forecasts with the lowest; usual is never below it", () => {
    const r = buildIncome(inc({varies: true, low: 900, typical: 800}), undefined, "i1", "2026-10-05");
    expect("src" in r && [r.src.low, r.src.typical, r.src.amount]).toEqual([900, 900, undefined]);
  });
  test("a one-off can't be main, and an earlier date moves `since` back so it's still asked about", () => {
    const r = buildIncome(inc({freq: "oneoff", date: "2026-10-01"}), undefined, "i1", "2026-10-05");
    expect("src" in r && [r.src.main, r.src.since, r.src.date]).toEqual([false, "2026-10-01", "2026-10-01"]);
  });
  test("editing keeps the original `since`", () => {
    const old = baseState().incomes[0];
    const r = buildIncome(inc(), old, old.id, "2026-12-01");
    expect("src" in r && r.src.since).toBe("2026-09-01");
  });
  test("plain messages when something's missing", () => {
    expect(buildIncome(inc({name: " "}), undefined, "i", "2026-10-05")).toEqual({error: "Give this income a name, e.g. Pharmacy"});
    expect(buildIncome(inc({freq: "weekly"}), undefined, "i", "2026-10-05")).toEqual({error: "Add the next date this money arrives"});
    expect(buildIncome(inc({amount: NaN}), undefined, "i", "2026-10-05")).toEqual({error: "Enter how much arrives each time, after tax"});
    expect(buildIncome(inc({varies: true}), undefined, "i", "2026-10-05")).toEqual({error: "Enter the lowest amount you'd expect"});
  });
});

const billF = (o: Partial<BillForm> = {}): BillForm => ({name: "Gym", amount: 30, varies: false, freq: "monthly", day: 3, date: "", method: "dd", ...o});

describe("building a bill from the form", () => {
  test("monthly keeps the day; others keep the date", () => {
    expect(buildBill(billF(), "b1")).toEqual({bill: {id: "b1", name: "Gym", amount: 30, varies: false, freq: "monthly", day: 3, method: "dd", from: {kind: "main"}}});
    const r = buildBill(billF({freq: "yearly", day: null, date: "2027-01-15"}), "b1");
    expect("bill" in r && [r.bill.date, r.bill.day]).toEqual(["2027-01-15", undefined]);
  });
  test("editing keeps the category link", () => {
    const r = buildBill(billF(), "rent", baseState().bills[0]);
    expect("bill" in r && r.bill.cat).toBe("rent");
  });
  test("plain messages when something's missing", () => {
    expect(buildBill(billF({name: ""}), "b")).toEqual({error: "Give this bill a name, e.g. Rent"});
    expect(buildBill(billF({amount: 0}), "b")).toEqual({error: "Enter how much it is, e.g. 650"});
    expect(buildBill(billF({day: null}), "b")).toEqual({error: "Pick the day it goes out"});
    expect(buildBill(billF({freq: "weekly", date: ""}), "b")).toEqual({error: "Pick the next date it goes out"});
  });
});

describe("which due date a bill payment counts towards", () => {
  const rent = baseState().bills[0];
  test("the next one due on or after the payment", () => {
    expect(billFor(ctx(), rent, "2026-10-05")).toBe("2026-10-15");
  });
  test("skips one that's already paid", () => {
    const c = ctx({txs: [tx({amount: 400, date: "2026-10-04", billId: "rent", forDate: "2026-10-15"})]});
    expect(billFor(c, rent, "2026-10-05")).toBe("2026-11-16");
  });
});
