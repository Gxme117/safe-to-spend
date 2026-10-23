import {livingMonth, livingMonthDue, livingMonthPayments, livingWhen, monthByDate} from "../livingMonth";
import {baseState, ctx, tx} from "./fixtures";

const names = (xs: {name: string; amount: number}[]) => xs.map(x => [x.name, x.amount]);

test("a month is gone, this one, or to come", () => {
  expect([livingWhen("2026-10-05", "2026-09"), livingWhen("2026-10-05", "2026-10"), livingWhen("2026-10-05", "2027-01")]).toEqual(["past", "now", "future"]);
});

test("a month gone: what went out for each bill and what was spent in each everyday category; nothing out, no bubble", () => {
  const txs = [
    tx({amount: 400, date: "2026-09-15", billId: "rent", forDate: "2026-09-15"}),
    // from the bank, in the bill's category around its due date
    tx({amount: 20, date: "2026-09-01", cat: "phone"}),
    tx({amount: 90, date: "2026-09-12", cat: "groceries"}), tx({amount: 40, date: "2026-09-20", cat: "groceries"}),
    // a refund comes off it; August's don't count
    tx({amount: 10, date: "2026-09-21", type: "income", refundOf: "groceries"}), tx({amount: 70, date: "2026-08-30", cat: "groceries"}),
  ];
  const state = baseState({bills: [...baseState().bills.map(b => b.id === "phone" ? {...b, cat: "phone"} : b), {id: "gym", name: "Gym", amount: 30, freq: "monthly", day: 3}]});
  const c0 = ctx({state, txs});
  const items = livingMonth(c0, "2026-09");
  expect(names(items)).toEqual([["Rent", 400], ["Groceries", 120], ["Phone", 20]]);
  expect(items.every(x => !x.paid)).toBe(true);
  expect(livingMonthDue(c0, "2026-09", items[0])).toEqual({line: "· Tue 15 Sep", bold: "", paid: true});
  expect(livingMonthDue(c0, "2026-09", items[1])).toEqual({line: "Spent", bold: "£120 of £200"});
  expect(livingMonthPayments(c0, "2026-09", items[1]).map(x => x.amount)).toEqual([90, 40]);
});

test("a month to come: each bill at its monthly cost (a yearly one spread), a one-off only in its month, and each everyday budget", () => {
  const state = baseState({bills: [
    ...baseState().bills,
    {id: "tv", name: "TV licence", amount: 180, freq: "yearly", date: "2027-04-01"},
    {id: "boiler", name: "Boiler service", amount: 90, freq: "oneoff", date: "2026-12-04"},
  ]});
  const c0 = ctx({state});
  expect(names(livingMonth(c0, "2026-11"))).toEqual([["Rent", 400], ["Groceries", 200], ["Phone", 20], ["TV licence", 15]]);
  const dec = livingMonth(c0, "2026-12");
  expect(names(dec)).toEqual([["Rent", 400], ["Groceries", 200], ["Boiler service", 90], ["Phone", 20], ["TV licence", 15]]);
  // a yearly bill's bubble is a month's share, so its line says what it is
  const tv = dec.find(x => x.name === "TV licence")!;
  expect(livingMonthDue(c0, "2026-12", tv)).toEqual({line: "A month's share of £180", bold: ""});
  expect(livingMonthDue(c0, "2027-04", livingMonth(c0, "2027-04").find(x => x.name === "TV licence")!)).toEqual({line: "£180 due Thu 1 Apr", bold: ""});
  expect(livingMonthDue(c0, "2026-12", dec.find(x => x.name === "Groceries")!)).toEqual({line: "Your budget for December", bold: ""});
  // the list's bills in date order, undated last
  expect(monthByDate(dec.filter(x => !x.estimate)).map(x => x.name)).toEqual(["Phone", "Boiler service", "Rent", "TV licence"]);
});
