import {calc, forecast, freeSpentByDay, hero} from "../calc";
import {bankCat, CATALOG, catOrder, resolve, withCatalog} from "../categories";
import {addDays} from "../dates";
import {DEFAULT_CATEGORIES} from "../defaults";
import {catLook} from "../looks";
import {importTxs, type RawTx} from "../monzo";
import {spendCats} from "../payments";
import type {Category, Ctx, Tx} from "../types";
import {baseState, ctx, TODAY, tx} from "./fixtures";

const free = (id: string, name: string): Category => ({id, name, budget: 0, fixed: false});
const budget = (id: string, name: string, amount: number): Category => ({id, name, budget: amount, fixed: false, group: "everyday"});
const names = (cats: Category[]) => Object.fromEntries(cats.map(x => [x.id, x.name]));

describe("the list", () => {
  test("every id is there once, and the narrower ones point at one that's there", () => {
    const ids = CATALOG.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of CATALOG) if (e.parent) expect(ids).toContain(e.parent);
    // the ids setup and the web app already use, so nothing filed before moves
    expect(ids).toEqual(expect.arrayContaining(["groceries", "eating", "takeaways", "coffee", "transport", "fuel", "shopping", "entertainment", "personal", "health", "family", "other"]));
  });
  test("each has its own look", () => {
    for (const e of CATALOG.filter(x => x.id !== "other")) expect(catLook(e.id, e.name).icon).not.toBe("coin");
  });
});

describe("bringing your categories up to date", () => {
  test("the starting ones are renamed, and the missing ones are added at the end, free", () => {
    const got = withCatalog(DEFAULT_CATEGORIES);
    expect(got.slice(0, DEFAULT_CATEGORIES.length).map(x => x.id)).toEqual(DEFAULT_CATEGORIES.map(x => x.id));
    expect(names(got)).toMatchObject({other: "General", rent: "Rent", bills: "Bills"});
    expect(got.slice(DEFAULT_CATEGORIES.length).every(x => x.budget === 0 && !x.fixed && !x.group)).toBe(true);
    expect(got.map(x => x.id)).toEqual(expect.arrayContaining(CATALOG.map(e => e.id)));
  });

  test("Entertainment is Fun and Personal care is Self-care; Coffee & drinks keeps its name", () => {
    const got = withCatalog([free("entertainment", "Entertainment"), free("personal", "Personal care"), free("coffee", "Coffee & drinks")]);
    expect(names(got)).toMatchObject({entertainment: "Fun", personal: "Self-care", coffee: "Coffee & drinks"});
  });

  test("budgets, groups, estimates and answered hints stay exactly as they were", () => {
    const fun: Category = {id: "entertainment", name: "Entertainment", budget: 60, fixed: false, group: "everyday", usual: {amount: 15, freq: "weekly", source: "bank"}, budgetKept: "2026-09-30"};
    expect(withCatalog([fun])[0]).toEqual({...fun, name: "Fun"});
  });

  test("a name you chose stays yours", () => {
    const got = withCatalog([free("entertainment", "Nights out"), free("other", "Misc")]);
    expect(names(got)).toMatchObject({entertainment: "Nights out", other: "Misc"});
  });

  test("never two with the same name: one of your own with the new name keeps it from being renamed", () => {
    const got = withCatalog([free("other", "Other"), free("c1", "General")]);
    expect(names(got)).toMatchObject({other: "Other", c1: "General"});
    expect(got.filter(x => x.name === "General")).toHaveLength(1);
  });

  test("one of your own with a list name is used for it, not added again (Pets from setup's Add more)", () => {
    const got = withCatalog([budget("cx1", "Pets", 40)]);
    expect(got.filter(x => x.name === "Pets")).toEqual([budget("cx1", "Pets", 40)]);
    expect(got.some(x => x.id === "pets")).toBe(false);
    expect(resolve(got, "pets")?.id).toBe("cx1");
  });

  test("fixed ones are never renamed or filed into, and an id is never used twice", () => {
    const rent = {id: "other", name: "Other", budget: 300, fixed: true};
    const got = withCatalog([rent]);
    expect(got[0]).toEqual(rent);
    expect(got.filter(x => x.id === "other")).toHaveLength(1);
    expect(resolve(got, "other")).toBeNull();
    expect(new Set(got.map(x => x.id)).size).toBe(got.length);
  });

  test("running it again changes nothing", () => {
    const once = withCatalog(baseState().categories);
    expect(withCatalog(once)).toEqual(once);
  });
});

describe("where a payment from the bank goes", () => {
  const cats = withCatalog(baseState().categories);

  test("each Monzo category to its own", () => {
    const map: Record<string, string> = {
      groceries: "groceries", eating_out: "eating", transport: "transport", shopping: "shopping", entertainment: "entertainment",
      personal_care: "personal", family: "family", gifts: "gifts", charity: "charity", holidays: "holidays", cash: "cash",
    };
    for (const [monzo, id] of Object.entries(map)) expect(bankCat(cats, monzo, "Somewhere Ltd")).toBe(id);
  });

  test("Monzo's general, finances, expenses, bills and transfers aren't guessed", () => {
    for (const monzo of ["general", "finances", "expenses", "bills", "transfers", "income", "savings", "", undefined]) expect(bankCat(cats, monzo, "Somewhere")).toBeNull();
  });

  test("the name narrows it, only within what the bank said", () => {
    expect(bankCat(cats, "eating_out", "COSTA COFFEE")).toBe("coffee");
    expect(bankCat(cats, "eating_out", "Deliveroo")).toBe("takeaways");
    expect(bankCat(cats, "transport", "Shell Petrol")).toBe("fuel");
    expect(bankCat(cats, "shopping", "IKEA Wembley")).toBe("home");
    expect(bankCat(cats, "shopping", "Pets at Home")).toBe("pets");
    expect(bankCat(cats, "personal_care", "Boots Pharmacy")).toBe("health");
    // a name for somewhere else doesn't move it out of what the bank said
    expect(bankCat(cats, "shopping", "Costa Coffee")).toBe("shopping");
    expect(bankCat(cats, "eating_out", "Tesco Express")).toBe("eating");
  });

  test("never out of a budget you set: the broad one budgeted and the narrow one not, it stays on the broad one", () => {
    const eat = withCatalog([budget("eating", "Eating out", 150)]);
    expect(bankCat(eat, "eating_out", "Costa")).toBe("eating");
    const both = withCatalog([budget("eating", "Eating out", 150), budget("coffee", "Coffee & drinks", 30)]);
    expect(bankCat(both, "eating_out", "Costa")).toBe("coffee");
    const coffee = withCatalog([budget("coffee", "Coffee & drinks", 30)]);
    expect(bankCat(coffee, "eating_out", "Costa")).toBe("coffee");
  });

  test("Spotify and Netflix are Subscriptions, but stay in a Fun budget you set (Subscriptions has none)", () => {
    const free = withCatalog([]);
    expect(bankCat(free, "entertainment", "SPOTIFY")).toBe("subscriptions");
    expect(bankCat(free, "entertainment", "ODEON CINEMAS")).toBe("entertainment");
    const fun = withCatalog([budget("entertainment", "Fun", 60)]);
    expect(bankCat(fun, "entertainment", "NETFLIX.COM")).toBe("entertainment");
    const both = withCatalog([budget("entertainment", "Fun", 60), budget("subscriptions", "Subscriptions", 30)]);
    expect(bankCat(both, "entertainment", "NETFLIX.COM")).toBe("subscriptions");
  });

  test("a category you don't have isn't filed into (settings not brought up to date yet)", () => {
    expect(bankCat(baseState().categories, "transport", "TfL")).toBeNull();
  });
});

describe("importing with the list", () => {
  let n = 0;
  const raw = (over: Partial<RawTx>): RawTx => ({id: `r${++n}`, amount: -1000, created: `${TODAY}T09:00:00Z`, ...over});
  const NOW = new Date(2026, 9, 5, 10).getTime();
  const c = ctx({state: baseState({categories: withCatalog(baseState().categories)})});
  const got = importTxs(c, [
    raw({category: "shopping", merchant: {name: "ASOS"}}),
    raw({category: "entertainment", description: "NETFLIX.COM"}),
    raw({category: "eating_out", merchant: {name: "Costa"}}),
    raw({category: "cash", description: "ATM"}),
    raw({category: "general", counterparty: {name: "J Smith"}}),
    raw({category: "finances", description: "AMEX"}),
  ], NOW, () => `x${++n}`);

  test("what used to be asked about lands in its category, and what isn't clear is General and asked", () => {
    expect(got.map(t => [t.note, t.cat, !!t.needsCat])).toEqual([
      ["ASOS", "shopping", false], ["NETFLIX.COM", "subscriptions", false], ["Costa", "coffee", false], ["ATM", "cash", false],
      ["J Smith", "other", true], ["AMEX", "other", true],
    ]);
  });
});

describe("the picker", () => {
  test("fixed ones (with no bills), then budgeted, then the rest, General last", () => {
    const cats = [free("other", "General"), {id: "rent", name: "Rent", budget: 0, fixed: true}, free("shopping", "Shopping"), budget("groceries", "Groceries", 200)];
    expect(catOrder(cats).map(x => x.id)).toEqual(["rent", "groceries", "shopping", "other"]);
    const s = baseState({categories: withCatalog(baseState().categories)});
    const offered = spendCats(s);
    expect(offered[0].id).toBe("groceries");
    expect(offered[offered.length - 1].id).toBe("other");
    expect(offered.some(x => x.fixed)).toBe(false);
  });
});

// The daily number reads categories by id and group only. Bringing them up to date mustn't move a penny.
describe("Safe to Spend doesn't change", () => {
  const cats: Category[] = [
    {id: "rent", name: "Rent", budget: 0, fixed: true},
    budget("groceries", "Groceries", 200),
    budget("entertainment", "Entertainment", 60),
    {id: "personal", name: "Personal care", budget: 0, fixed: false, group: "free"},
    free("eating", "Eating out"),
    free("other", "Other"),
  ];
  const txs: Tx[] = [
    tx({amount: 42.1, date: "2026-10-02", cat: "groceries"}),
    tx({amount: 18, date: "2026-10-03", cat: "entertainment"}),
    tx({amount: 9.5, date: "2026-10-04", cat: "personal"}),
    tx({amount: 23, date: TODAY, cat: "eating"}),
    tx({amount: 7, date: TODAY, cat: "other", needsCat: true}),
    tx({amount: 400, date: "2026-10-01", cat: "rent", billId: "rent", forDate: "2026-10-15"}),
    tx({amount: 5, date: TODAY, type: "income", cat: "refund", refundOf: "entertainment"}),
  ];
  const numbers = (x: Ctx) => {
    const c = calc(x), h = hero(x, c);
    return {
      h, balance: c.balance, billsLeft: c.billsLeft, everydayLeft: c.everydayLeft, need: c.need, savingHeld: c.savingHeld,
      everyday: c.everyday.map(e => [e.x.id, e.spent, e.left]), spent: c.spent, free: freeSpentByDay(x),
      days: [1, 2, 7, 20].map(i => forecast(x, c, addDays(TODAY, i))),
    };
  };

  test("every figure is the same before and after, and every payment still finds its category", () => {
    const before = ctx({state: baseState({categories: cats}), txs});
    const after = ctx({state: baseState({categories: withCatalog(cats)}), txs});
    expect(numbers(after)).toEqual(numbers(before));
    expect(hero(before, calc(before)).kind).toBe("number");
    for (const t of txs.filter(t => t.type === "expense" && !t.billId)) {
      const was = cats.find(x => x.id === t.cat)!, now = after.state.categories.find(x => x.id === t.cat)!;
      expect({...now, name: was.name}).toEqual(was);
    }
  });

  test("a payment narrowed between two free categories leaves the number where it was", () => {
    const state = baseState({categories: withCatalog(cats)});
    const as = (cat: string) => ctx({state, txs: [...txs, tx({id: "costa", amount: 4.2, date: TODAY, cat})]});
    expect(bankCat(state.categories, "eating_out", "Costa")).toBe("coffee");
    expect(numbers(as("coffee")).h).toEqual(numbers(as("eating")).h);
  });

  test("with Eating out budgeted, Costa still comes off that budget, as before", () => {
    const state = baseState({categories: withCatalog(cats.map(x => x.id === "eating" ? budget("eating", "Eating out", 100) : x))});
    expect(bankCat(state.categories, "eating_out", "Costa")).toBe("eating");
  });
});
