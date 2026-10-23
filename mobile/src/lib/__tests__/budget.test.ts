import {answerHint, budgetHint, cyclesNeeded, pastCycles, roundBudget} from "../budget";
import type {Income} from "../types";
import {baseState, ctx, tx} from "./fixtures";

// Paid on the last working day: the pay cycle that's finished runs Fri 28 Aug (the 31st is a bank holiday) to Tue 29 Sep,
// and today (Mon 5 Oct) is in the next one
const groceries = (amount: number, date = "2026-09-10") => tx({amount, date, cat: "groceries"});
// a payment from before the cycles counted, so the app has seen all of them
const seen = tx({amount: 5, date: "2026-08-20", cat: "other"});

test("paid monthly, one finished pay cycle is enough; weekly, it takes three", () => {
  expect([cyclesNeeded(31), cyclesNeeded(28), cyclesNeeded(14), cyclesNeeded(7)]).toEqual([1, 1, 2, 3]);
  expect(pastCycles(ctx())[0].to).toBe("2026-09-29");
});

test("a suggested budget is rounded to £5 under £100 and £10 from there", () => {
  expect([roundBudget(43), roundBudget(97), roundBudget(244), roundBudget(256)]).toEqual([45, 95, 240, 260]);
});

test("spent well past the budget last pay cycle: it suggests what was spent, says why, and what it does to the daily number", () => {
  const h = budgetHint(ctx({txs: [seen, groceries(150), groceries(110, "2026-09-20")]}), "groceries");
  expect(h).toMatchObject({to: 260, up: true, reason: "You spent £260 on Groceries last pay cycle, against a budget of £200."});
  expect(h?.effect).toMatch(/^Your daily number would be £\d+ instead of £\d+\.$/);
});

test("spent well under it: it suggests lowering it too", () => {
  expect(budgetHint(ctx({txs: [seen, groceries(120)]}), "groceries")).toMatchObject({to: 120, up: false});
});

test("close to the budget (within 10%, or £10) it doesn't ask", () => {
  expect(budgetHint(ctx({txs: [seen, groceries(215)]}), "groceries")).toBeNull();
  expect(budgetHint(ctx({txs: [seen, groceries(185)]}), "groceries")).toBeNull();
});

test("only pay cycles it has seen all of count: with no payments from before, nothing spent isn't a reason to lower it", () => {
  expect(budgetHint(ctx({txs: [groceries(50, "2026-10-02")]}), "groceries")).toBeNull();
  // started part way through the cycle: it can't tell yet
  expect(budgetHint(ctx({txs: [groceries(260)]}), "groceries")).toBeNull();
  // a category that isn't everyday, or has no budget, is never asked about
  expect(budgetHint(ctx({txs: [seen, groceries(260)]}), "eating")).toBeNull();
});

test("paid weekly, it waits for three pay cycles in a row, using what's usual (one big week doesn't set the figure)", () => {
  const weekly: Income = {...baseState().incomes[0], freq: "weekly", date: "2026-09-04"};
  const state = baseState({incomes: [weekly]});
  // Fridays: the finished cycles are 11–17 Sep, 18–24 Sep and 25 Sep–1 Oct
  const two = [seen, groceries(260, "2026-09-12"), groceries(150, "2026-09-19"), groceries(250, "2026-09-26")];
  expect(budgetHint(ctx({state, txs: two}), "groceries")).toBeNull();
  const three = [seen, groceries(400, "2026-09-12"), groceries(240, "2026-09-19"), groceries(250, "2026-09-26")];
  expect(budgetHint(ctx({state, txs: three}), "groceries")).toMatchObject({
    to: 250, up: true, reason: "You've spent around £250 on Groceries in each of your last 3 pay cycles, against a budget of £200.",
  });
});

test("answered (changed or kept), it waits for the next pay cycle to finish before asking again", () => {
  const cats = baseState().categories;
  expect(answerHint(cats, "groceries", 260, "2026-10-01").find(k => k.id === "groceries")).toMatchObject({budget: 260, budgetKept: "2026-10-01"});
  const kept = answerHint(cats, "groceries", null, "2026-10-01");
  expect(kept.find(k => k.id === "groceries")).toMatchObject({budget: 200, budgetKept: "2026-10-01"});
  expect(budgetHint(ctx({state: baseState({categories: kept}), txs: [seen, groceries(260)]}), "groceries")).toBeNull();
  // once the next one's over, the same spending can ask again
  expect(budgetHint(ctx({state: baseState({categories: kept}), today: "2026-11-02", txs: [seen, groceries(260, "2026-10-10")]}), "groceries")).toMatchObject({to: 260});
});
