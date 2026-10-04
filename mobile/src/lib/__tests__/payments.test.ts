import {fileUnder, spendCats} from "../payments";
import {baseState, ctx, tx} from "./fixtures";

test("filing under a category just changes the category", () => {
  const it = tx({amount: 12, date: "2026-10-05", cat: "other"});
  expect(fileUnder(ctx({txs: [it]}), it, {kind: "cat", id: "eating"})).toEqual({patch: {cat: "eating"}, msg: "Filed under Eating out"});
});

test("filing under a bill marks its next due date paid", () => {
  const it = tx({amount: 400, date: "2026-10-05", cat: "other", needsCat: true});
  expect(fileUnder(ctx({txs: [it]}), it, {kind: "bill", id: "rent"})).toEqual({
    patch: {cat: "rent", billId: "rent", forDate: "2026-10-15"},
    msg: "Rent marked paid for Thu 15 Oct. It's no longer held back",
  });
});

test("the payment's own old filing doesn't count as the bill being paid", () => {
  const it = tx({amount: 400, date: "2026-10-05", cat: "rent", billId: "rent", forDate: "2026-10-15"});
  expect(fileUnder(ctx({txs: [it]}), it, {kind: "bill", id: "rent"}).patch.forDate).toBe("2026-10-15");
});

test("a bill without a category files under Bills", () => {
  const it = tx({amount: 20, date: "2026-10-05"});
  expect(fileUnder(ctx({txs: [it]}), it, {kind: "bill", id: "phone"}).patch).toMatchObject({cat: "bills", billId: "phone"});
});

test("moving from a bill to a category leaves no bill behind", () => {
  const it = tx({amount: 400, date: "2026-10-05", cat: "rent", billId: "rent", forDate: "2026-10-15"});
  expect(fileUnder(ctx({txs: [it]}), it, {kind: "cat", id: "groceries"}).patch).toEqual({cat: "groceries"});
});

test("fixed categories are only offered when there are no bills", () => {
  expect(spendCats(baseState()).map(x => x.id)).toEqual(["groceries", "eating", "other"]);
  expect(spendCats(baseState({bills: []})).map(x => x.id)).toEqual(["rent", "groceries", "eating", "other"]);
});
