import {calc} from "../calc";
import {DEFAULT_CATEGORIES} from "../defaults";
import {budgetOf, budgetText, everydayCats, newSpend, perWeek, SPEND_FREQ, spendMonthly, type SpendDraft} from "../everyday";
import {baseState, ctx} from "./fixtures";

const draft = (o: Partial<SpendDraft> = {}): SpendDraft => ({amount: "", freq: "weekly", budget: null, ...o});
let n = 0;
const newId = () => `x${++n}`;

describe("what you usually spend, a month", () => {
  test("£60 every week is £260 a month", () => expect(spendMonthly(draft({amount: "60"}))).toBe(260));
  test("£15, 2–3 times a week counts as 2.5 times: £162.50", () => expect(spendMonthly(draft({amount: "15", freq: "few-times"}))).toBe(162.5));
  test("£3 every day is a year of days over 12 months", () => expect(spendMonthly(draft({amount: "3", freq: "daily"}))).toBe(91.25));
  test("£8, 4–6 times a week counts as 5", () => expect(spendMonthly(draft({amount: "8", freq: "most-days"}))).toBe(173.33));
  test("£120 every 3 months is £40", () => expect(spendMonthly(draft({amount: "120", freq: "quarterly"}))).toBe(40));
  test("nothing typed (or not a number) is nothing, not a guess", () => {
    expect(spendMonthly(draft())).toBe(0);
    expect(spendMonthly(draft({amount: "abc"}))).toBe(0);
    expect(spendMonthly(draft({amount: "-5"}))).toBe(0);
  });
  test("most often first", () => expect(Object.values(SPEND_FREQ)).toEqual(
    ["Every day", "4–6 times a week", "2–3 times a week", "Every week", "Every 2 weeks", "Every month", "Every 3 months", "Every year"]));
});

describe("a new pick starts at how often it usually happens", () => {
  test("groceries weekly, coffee a few times a week, fuel every 2 weeks, anything else monthly", () => {
    expect(["Groceries", "Coffee & drinks", "Fuel", "Health", "Pets"].map(x => newSpend(x).freq)).toEqual(["weekly", "few-times", "fortnightly", "monthly", "monthly"]);
    expect(newSpend("Groceries")).toEqual({amount: "", freq: "weekly", budget: null});
  });
});

describe("the budget", () => {
  test("starts at what you usually spend, in whole pounds, and follows it until you type your own", () => {
    expect(budgetText(draft({amount: "15", freq: "few-times"}))).toBe("163");
    expect(budgetOf(draft({amount: "60"}))).toBe(260);
    expect(budgetText(draft({amount: "60", budget: "250"}))).toBe("250");
  });
  test("no estimate: blank, and nothing", () => {
    expect(budgetText(draft())).toBe("");
    expect(budgetOf(draft())).toBe(0);
  });
  test("cleared is nothing, not back to the estimate", () => {
    expect(budgetText(draft({amount: "60", budget: ""}))).toBe("");
    expect(budgetOf(draft({amount: "60", budget: ""}))).toBe(0);
  });
  test("a week of a month", () => expect(perWeek(450)).toBe(103.85));
});

describe("setup's picks as categories", () => {
  const cats = everydayCats(DEFAULT_CATEGORIES, [
    {name: "Eating out", draft: draft({amount: "15", freq: "few-times", budget: "120"})},
    {name: "Groceries", draft: draft({amount: "60"})},
    {name: "Personal care", draft: draft({amount: "20", freq: "monthly"})},
    {name: "Pets", draft: draft({amount: "40", freq: "monthly"})},
    {name: "Health", draft: draft()},
  ], newId);

  test("a usual one keeps the app's id, your own gets a new one, and an estimate is kept beside the budget", () => {
    expect(cats.find(x => x.name === "Groceries")).toEqual({id: "groceries", name: "Groceries", budget: 260, fixed: false, group: "everyday", usual: {amount: 60, freq: "weekly"}});
    expect(cats.find(x => x.name === "Eating out")).toEqual({id: "eating", name: "Eating out", budget: 120, fixed: false, group: "everyday", usual: {amount: 15, freq: "few-times"}});
    expect(cats.find(x => x.name === "Personal care")?.id).toBe("personal");   // what Monzo's personal_care files into
    expect(cats.find(x => x.name === "Pets")?.id).toMatch(/^cx\d+$/);
  });
  test("no budget is free: there to file payments against, holding nothing back", () => {
    expect(cats.find(x => x.name === "Health")).toEqual({id: "health", name: "Health", budget: 0, fixed: false, group: "free"});
  });
  test("the fixed ones, then your picks in order, then the starting ones you didn't pick, as they were", () => {
    expect(cats.map(x => x.id).slice(0, 2)).toEqual(["rent", "bills"]);
    expect(cats.map(x => x.name).slice(2, 7)).toEqual(["Eating out", "Groceries", "Personal care", "Pets", "Health"]);
    expect(cats.slice(7)).toEqual(DEFAULT_CATEGORIES.filter(x => ["transport", "other"].includes(x.id)));
    expect(new Set(cats.map(x => x.id)).size).toBe(cats.length);
  });
  test("the daily number keeps the budgets aside", () => {
    const c = calc(ctx({state: baseState({bills: [], categories: cats})}));
    expect(c.everyday.map(e => e.x.name)).toEqual(["Eating out", "Groceries", "Personal care", "Pets"]);
    expect(c.everydayLeft).toBe(440);   // 120 + 260 + 20 + 40; Health has no budget
  });
});
