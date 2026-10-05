import {billFor, billMeta, billWhen, billWhenLong, buildBill, datePickRange, draftBill, draftReady, itemsTotal, newDraft, SUBSCRIPTIONS, withItems, type BillForm} from "../bills";
import {buildIncome, type IncomeForm} from "../income";
import {baseState, ctx, TODAY, tx} from "./fixtures";

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

describe("a bill as setup collects it", () => {
  const draft = (o = {}) => ({...newDraft(), amount: "750", ...o});
  test("starts monthly and empty, and is ready once it has an amount", () => {
    expect(newDraft()).toEqual({amount: "", freq: "monthly", day: null, date: null});
    expect(draftReady(newDraft())).toBe(false);
    expect(draftReady(draft({amount: "£1,250.50"}))).toBe(true);
    expect(draftReady(draft({amount: "0"}))).toBe(false);
  });
  test("becomes a bill, with the payment date only when there is one", () => {
    expect(draftBill(" Rent / mortgage ", draft({day: 1}), "b1")).toEqual({id: "b1", name: "Rent / mortgage", amount: 750, freq: "monthly", day: 1, from: {kind: "main"}});
    expect(draftBill("Rent", draft({later: true}), "b1")).toEqual({id: "b1", name: "Rent", amount: 750, freq: "monthly", from: {kind: "main"}});
    // a day left over from monthly isn't a yearly bill's date
    expect(draftBill("TV licence", draft({amount: "174.50", freq: "yearly", day: 3, date: "2026-12-12"}), "b2"))
      .toEqual({id: "b2", name: "TV licence", amount: 174.5, freq: "yearly", date: "2026-12-12", from: {kind: "main"}});
  });
  test("an undated bill says so on the Month tab, and one without an amount asks for that first", () => {
    expect(billMeta(draftBill("Rent", draft(), "b"), null)).toBe("No payment date yet. From main account");
    expect(billMeta(draftBill("Subscriptions", draft({amount: "", day: 3}), "b"), "Mon 5 Oct")).toBe("No amount yet. From main account");
  });
});

describe("subscriptions, added up", () => {
  test("the total is what's priced; one you haven't priced counts as nothing", () => {
    expect(itemsTotal([{name: "Netflix", amount: "13.99"}, {name: "Spotify", amount: "£12.99"}, {name: "Audible", amount: ""}])).toBe(26.98);
  });
  test("the draft becomes monthly, with their total as its amount (blank while it's nothing)", () => {
    const d = withItems({...newDraft(), freq: "yearly"}, [{name: "Netflix", amount: "13.99"}]);
    expect(d).toMatchObject({freq: "monthly", amount: "13.99", items: [{name: "Netflix", amount: "13.99"}]});
    expect(withItems(newDraft(), [{name: "Audible", amount: ""}]).amount).toBe("");
    expect(draftBill("Subscriptions", d, "b")).toEqual({id: "b", name: "Subscriptions", amount: 13.99, freq: "monthly", from: {kind: "main"}});
  });
  test("every usual one has a price", () => {
    expect(SUBSCRIPTIONS.every(x => x.price > 0)).toBe(true);
  });
});

describe("when a bill goes out, in words", () => {
  const b = (o: object) => draftBill("X", {...newDraft(), amount: "10", ...o}, "b");
  test("short, for a list row", () => {
    expect(billWhen(b({day: 1}))).toBe("1st");
    expect(billWhen(b({day: "last"}))).toBe("Last working day");
    expect(billWhen(b({freq: "weekly", date: "2026-10-12"}))).toBe("Monday");
    expect(billWhen(b({freq: "fortnightly", date: "2026-10-12"}))).toBe("Mon 12 Oct");
    expect(billWhen(b({freq: "yearly", date: "2026-12-12"}))).toBe("12 Dec");
    expect(billWhen(b({}))).toBeNull();
  });
  test("in full, for the sheet", () => {
    expect(billWhenLong(b({day: 1}), TODAY)).toBe("1st of every month");
    expect(billWhenLong(b({day: "last"}), TODAY)).toBe("Last working day of the month");
    expect(billWhenLong(b({freq: "weekly", date: "2026-10-12"}), TODAY)).toBe("Every Monday");
    expect(billWhenLong(b({freq: "yearly", date: "2026-12-12"}), TODAY)).toBe("12 December every year");
    // picked from the past period: the next one is what matters
    expect(billWhenLong(b({freq: "fortnightly", date: "2026-09-28"}), TODAY)).toBe("Next on Mon 12 Oct");
    expect(billWhenLong(b({freq: "quarterly", date: "2026-08-15"}), TODAY)).toBe("Next on Mon 16 Nov");   // 15 Nov is a Sunday
    expect(billWhenLong(b({freq: "yearly"}), TODAY)).toBeNull();
  });
  test("the date is picked within one period either side of today", () => {
    expect(datePickRange("weekly", TODAY)).toEqual({min: "2026-09-29", max: "2026-10-11"});
    expect(datePickRange("yearly", TODAY)).toEqual({min: "2025-10-05", max: "2027-10-05"});
  });
});
