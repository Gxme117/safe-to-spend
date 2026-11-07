import {fileUnder, moneyInWhat, spendCats, unsorted} from "../payments";
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

describe("money in", () => {
  const moneyIn = (o = {}) => tx({type: "income", amount: 1800, date: "2026-09-29", cat: "monzo-in", note: "ACME LTD", ...o});

  test("filed as pay, it counts as the nearest payday that hasn't landed", () => {
    const it = moneyIn();
    expect(fileUnder(ctx({txs: [it]}), it, {kind: "pay", id: "job"})).toEqual({
      patch: {cat: "job", srcId: "job", forDate: "2026-09-30"},
      msg: "Counted as Pharmacy pay for Wed 30 Sep",
    });
  });

  test("its own old filing doesn't count as that payday already landing", () => {
    const it = moneyIn({cat: "job", srcId: "job", forDate: "2026-09-30"});
    expect(fileUnder(ctx({txs: [it]}), it, {kind: "pay", id: "job"}).patch.forDate).toBe("2026-09-30");
  });

  test("pay with no payday nearby is filed without marking one", () => {
    const it = moneyIn({date: "2026-10-15"});
    expect(fileUnder(ctx({txs: [it]}), it, {kind: "pay", id: "job"})).toEqual({patch: {cat: "job"}, msg: "Filed as Pharmacy pay"});
  });

  test("moving your own money isn't income", () => {
    const it = moneyIn();
    expect(fileUnder(ctx({txs: [it]}), it, {kind: "in", id: "transfer"})).toEqual({patch: {cat: "transfer"}, msg: "Marked as your own money moving. It isn't income"});
  });

  test("a refund remembers which category it goes back to", () => {
    const it = moneyIn({amount: 20});
    expect(fileUnder(ctx({txs: [it]}), it, {kind: "in", id: "refund", refundOf: "groceries"})).toEqual({
      patch: {cat: "refund", refundOf: "groceries"},
      msg: "Refund for Groceries. It's taken off what you spent there",
    });
  });

  test("unsorted money in is asked about; what it was reads plainly", () => {
    const c = ctx();
    expect(unsorted(moneyIn())).toBe(true);
    expect(unsorted(moneyIn({cat: "transfer"}))).toBe(false);
    expect(moneyInWhat(c, moneyIn())).toBe("Money in");
    expect(moneyInWhat(c, moneyIn({cat: "job"}))).toBe("Pharmacy");
    expect(moneyInWhat(c, moneyIn({cat: "transfer"}))).toBe("Own money moved");
    expect(moneyInWhat(c, moneyIn({cat: "payback", refundOf: "eating"}))).toBe("Paid back, Eating out");
  });
});

describe("subcategory filing", () => {
  const catWithSubs = {
    id: "groceries", name: "Groceries", budget: 200, fixed: false, group: "everyday" as const,
    subcategories: [{id: "groceries/organic", name: "Organic"}],
  };
  const state = {...baseState(), categories: baseState().categories.map(c => c.id === "groceries" ? catWithSubs : c)};

  test("filing with a subCat produces the right patch", () => {
    const it = tx({amount: 12, date: "2026-10-05", cat: "other"});
    expect(fileUnder(ctx({state, txs: [it]}), it, {kind: "cat", id: "groceries", subCat: "groceries/organic"}))
      .toEqual({patch: {cat: "groceries", subCat: "groceries/organic"}, msg: "Filed under Groceries"});
  });

  test("filing without subCat on a cat with subcats omits subCat from patch", () => {
    const it = tx({amount: 12, date: "2026-10-05", cat: "other"});
    expect(fileUnder(ctx({state, txs: [it]}), it, {kind: "cat", id: "groceries"}))
      .toEqual({patch: {cat: "groceries"}, msg: "Filed under Groceries"});
  });

  test("switching to a different parent always omits subCat from patch", () => {
    const it = tx({amount: 12, date: "2026-10-05", cat: "groceries", subCat: "groceries/organic"});
    expect(fileUnder(ctx({state, txs: [it]}), it, {kind: "cat", id: "eating"}))
      .toEqual({patch: {cat: "eating"}, msg: "Filed under Eating out"});
  });

  test("re-filing under same cat with same subCat preserves it", () => {
    const it = tx({amount: 12, date: "2026-10-05", cat: "groceries", subCat: "groceries/organic"});
    expect(fileUnder(ctx({state, txs: [it]}), it, {kind: "cat", id: "groceries", subCat: "groceries/organic"}))
      .toMatchObject({patch: {cat: "groceries", subCat: "groceries/organic"}});
  });

  test("existing payments.test behaviour unchanged: cat without subCat produces simple patch", () => {
    const it = tx({amount: 12, date: "2026-10-05", cat: "other"});
    expect(fileUnder(ctx({txs: [it]}), it, {kind: "cat", id: "eating"}))
      .toEqual({patch: {cat: "eating"}, msg: "Filed under Eating out"});
  });
});
