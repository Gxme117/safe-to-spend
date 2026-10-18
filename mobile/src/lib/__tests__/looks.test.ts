import {billLook, comingLook, txLook} from "../looks";
import {baseState, ctx, tx} from "./fixtures";

test("a payment's look comes from its category", () => {
  expect(txLook(ctx(), tx({amount: 30, date: "2026-10-05", cat: "groceries"}))).toEqual({icon: "cart", tint: "green"});
  expect(txLook(ctx(), tx({amount: 3, date: "2026-10-05", cat: "transport"})).icon).toBe("train");
});

test("with no category (or Other), it's guessed from the name, and nothing fitting gets the plain look", () => {
  expect(txLook(ctx(), tx({amount: 3.2, date: "2026-10-05", cat: "other", note: "Pret A Manger"})).icon).toBe("coffee");
  expect(txLook(ctx(), tx({amount: 1.8, date: "2026-10-05", cat: "", note: "TfL Travel"})).icon).toBe("train");
  expect(txLook(ctx(), tx({amount: 12, date: "2026-10-05", cat: "other", note: "Tesco Express"})).icon).toBe("cart");
  // "bar" is a whole word: a barber is personal care, not a night out
  expect(txLook(ctx(), tx({amount: 15, date: "2026-10-05", cat: "other", note: "Joe's Barber"})).icon).toBe("bottle");
  expect(txLook(ctx(), tx({amount: 5, date: "2026-10-05", cat: "other", note: "Mystery Ltd"}))).toEqual({icon: "coin", tint: "grey"});
});

test("a category you named yourself is guessed from its name", () => {
  const c = ctx({state: baseState({categories: [...baseState().categories, {id: "mine", name: "Coffee runs", budget: 20}]} as never)});
  expect(txLook(c, tx({amount: 3, date: "2026-10-05", cat: "mine"})).icon).toBe("coffee");
});

test("bills by name, pay and money in their own", () => {
  expect(billLook("Rent").icon).toBe("house");
  expect(billLook("Phone bill").icon).toBe("phone");
  expect(billLook("Octopus Energy").icon).toBe("bulb");
  expect(billLook("Something else").icon).toBe("receipt");
  expect(txLook(ctx(), tx({amount: 1800, date: "2026-10-05", type: "income", srcId: "job"})).icon).toBe("banknote");
  expect(comingLook({key: "k", kind: "in", d: "2026-10-06", name: "Refund", meta: "", amt: "+£5", good: true}).icon).toBe("coins");
});
