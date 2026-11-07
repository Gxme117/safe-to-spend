import {subcatSpent} from "../calc";
import {resolveSubCat, subCatSlug} from "../categories";
import {Refused, matchMerchantRule, proposeAddSubcat, proposeRemoveSubcat, proposeRenameSubcat, proposeTeachMerchant, staleCat} from "../categoryChange";
import {subcatBreakdown} from "../living";
import type {Category, CategoryProposal, Ctx, MerchantRule, SubCat, Tx} from "../types";
import {baseState, ctx, tx} from "./fixtures";

const sub = (id: string, name: string): SubCat => ({id, name});
const cat = (id: string, name: string, subs?: SubCat[]): Category => ({id, name, budget: 0, fixed: false, ...(subs ? {subcategories: subs} : {})});

// ── subCatSlug ────────────────────────────────────────────────────────────────

describe("subCatSlug", () => {
  test("produces <parentId>/<slug>", () => {
    expect(subCatSlug("groceries", "Organic")).toBe("groceries/organic");
  });
  test("same name + parent always produces the same id", () => {
    expect(subCatSlug("eating", "Lunch")).toBe(subCatSlug("eating", "Lunch"));
  });
  test("collapses spaces and special chars", () => {
    expect(subCatSlug("shopping", "Coffee & Drinks")).toBe("shopping/coffee-drinks");
  });
  test("strips leading/trailing dashes", () => {
    expect(subCatSlug("other", "  --test--  ")).toBe("other/test");
  });
});

// ── resolveSubCat ─────────────────────────────────────────────────────────────

describe("resolveSubCat", () => {
  const cats = [cat("groceries", "Groceries", [sub("groceries/organic", "Organic")])];

  test("finds sub by id", () => {
    expect(resolveSubCat(cats, "groceries", "groceries/organic")).toEqual({id: "groceries/organic", name: "Organic"});
  });
  test("returns null for unknown parent", () => {
    expect(resolveSubCat(cats, "unknown", "groceries/organic")).toBeNull();
  });
  test("returns null for unknown sub under known parent", () => {
    expect(resolveSubCat(cats, "groceries", "groceries/other")).toBeNull();
  });
});

// ── subcatSpent ───────────────────────────────────────────────────────────────

describe("subcatSpent", () => {
  test("tx with subCat counted under its parent and subcat key", () => {
    const txs = [tx({amount: 10, date: "2026-10-01", cat: "groceries", subCat: "groceries/organic"})];
    const result = subcatSpent(txs);
    expect(result["groceries"]["groceries/organic"]).toBeCloseTo(10);
  });
  test("tx without subCat is omitted", () => {
    const txs = [tx({amount: 10, date: "2026-10-01", cat: "groceries"})];
    expect(subcatSpent(txs)).toEqual({});
  });
  test("bill-linked tx excluded even if subCat is set", () => {
    const txs = [tx({amount: 10, date: "2026-10-01", cat: "groceries", subCat: "groceries/organic", billId: "b1"})];
    expect(subcatSpent(txs)).toEqual({});
  });
  test("refund with subCat subtracts, never below 0", () => {
    const txs = [
      tx({amount: 10, date: "2026-10-01", cat: "groceries", subCat: "groceries/organic"}),
      {id: "r1", type: "income" as const, amount: 20, cat: "refund", refundOf: "groceries", subCat: "groceries/organic", note: "", date: "2026-10-02", created: 9999},
    ];
    const result = subcatSpent(txs);
    expect(result["groceries"]["groceries/organic"]).toBe(0);
  });
  test("empty input returns empty map", () => {
    expect(subcatSpent([])).toEqual({});
  });
  test("subcatSpent totals never exceed parent expense total for same input", () => {
    const txs = [
      tx({amount: 15, date: "2026-10-01", cat: "groceries", subCat: "groceries/organic"}),
      tx({amount: 5, date: "2026-10-01", cat: "groceries"}),
    ];
    const parentTotal = txs.filter(t => t.type === "expense" && t.cat === "groceries").reduce((a, t) => a + t.amount, 0);
    const subTotals = subcatSpent(txs);
    const subSum = Object.values(subTotals["groceries"] ?? {}).reduce((a, v) => a + v, 0);
    expect(subSum).toBeLessThanOrEqual(parentTotal + 0.01);
  });
});

// ── proposeAddSubcat ──────────────────────────────────────────────────────────

describe("proposeAddSubcat", () => {
  const cats = [cat("groceries", "Groceries")];

  test("unknown parentId → Refused", () => {
    expect(() => proposeAddSubcat(cats, "nope", "Organic")).toThrow(Refused);
  });
  test("duplicate name → Refused", () => {
    const catsWithSub = [cat("groceries", "Groceries", [sub("groceries/organic", "Organic")])];
    expect(() => proposeAddSubcat(catsWithSub, "groceries", "Organic")).toThrow(Refused);
  });
  test("valid → returns add_subcat proposal", () => {
    expect(proposeAddSubcat(cats, "groceries", "Organic")).toEqual({kind: "add_subcat", parentId: "groceries", name: "Organic"});
  });
  test("empty name → Refused", () => {
    expect(() => proposeAddSubcat(cats, "groceries", "")).toThrow(Refused);
  });
});

// ── proposeRenameSubcat ───────────────────────────────────────────────────────

describe("proposeRenameSubcat", () => {
  const cats = [cat("groceries", "Groceries", [sub("groceries/organic", "Organic"), sub("groceries/fresh", "Fresh")])];

  test("unknown subId → Refused", () => {
    expect(() => proposeRenameSubcat(cats, "groceries", "groceries/nope", "New")).toThrow(Refused);
  });
  test("same name → Refused", () => {
    expect(() => proposeRenameSubcat(cats, "groceries", "groceries/organic", "Organic")).toThrow(Refused);
  });
  test("duplicate name in same parent → Refused", () => {
    expect(() => proposeRenameSubcat(cats, "groceries", "groceries/organic", "Fresh")).toThrow(Refused);
  });
  test("valid → returns rename_subcat proposal", () => {
    expect(proposeRenameSubcat(cats, "groceries", "groceries/organic", "Bio")).toEqual({
      kind: "rename_subcat", parentId: "groceries", subId: "groceries/organic", oldName: "Organic", newName: "Bio",
    });
  });
});

// ── proposeRemoveSubcat ───────────────────────────────────────────────────────

describe("proposeRemoveSubcat", () => {
  const cats = [cat("groceries", "Groceries", [sub("groceries/organic", "Organic")])];

  test("unknown subId → Refused", () => {
    expect(() => proposeRemoveSubcat(cats, "groceries", "groceries/nope")).toThrow(Refused);
  });
  test("valid → returns remove_subcat proposal", () => {
    expect(proposeRemoveSubcat(cats, "groceries", "groceries/organic")).toEqual({
      kind: "remove_subcat", parentId: "groceries", subId: "groceries/organic", oldName: "Organic",
    });
  });
});

// ── proposeTeachMerchant with subCat ──────────────────────────────────────────

describe("proposeTeachMerchant with subCat", () => {
  const cats = [cat("groceries", "Groceries", [sub("groceries/organic", "Organic")])];
  const c: Ctx = {...ctx(), state: {...baseState(), categories: cats}};
  const rules: MerchantRule[] = [];

  test("subCat from wrong parent → Refused", () => {
    expect(() => proposeTeachMerchant(c, rules, "Tesco", "groceries", "eating/lunch")).toThrow(Refused);
  });
  test("valid subCat from correct parent → merchant_rule with subCat", () => {
    expect(proposeTeachMerchant(c, rules, "Tesco", "groceries", "groceries/organic")).toEqual({
      kind: "merchant_rule", payee: "tesco", cat: "groceries", subCat: "groceries/organic",
    });
  });
});

// ── staleCat for new proposal kinds ──────────────────────────────────────────

describe("staleCat for subcat proposals", () => {
  const cats = [cat("groceries", "Groceries", [sub("groceries/organic", "Organic")])];

  test("add_subcat: parent removed → error", () => {
    const p: CategoryProposal = {kind: "add_subcat", parentId: "nope", name: "Bio"};
    expect(staleCat([], [], p)).toBeTruthy();
  });
  test("add_subcat: parent present → null", () => {
    const p: CategoryProposal = {kind: "add_subcat", parentId: "groceries", name: "Bio"};
    expect(staleCat(cats, [], p)).toBeNull();
  });
  test("rename_subcat: sub gone → error", () => {
    const p: CategoryProposal = {kind: "rename_subcat", parentId: "groceries", subId: "groceries/nope", oldName: "X", newName: "Y"};
    expect(staleCat(cats, [], p)).toBeTruthy();
  });
  test("rename_subcat: sub name changed → error", () => {
    const p: CategoryProposal = {kind: "rename_subcat", parentId: "groceries", subId: "groceries/organic", oldName: "WrongName", newName: "Bio"};
    expect(staleCat(cats, [], p)).toBeTruthy();
  });
  test("rename_subcat: sub intact → null", () => {
    const p: CategoryProposal = {kind: "rename_subcat", parentId: "groceries", subId: "groceries/organic", oldName: "Organic", newName: "Bio"};
    expect(staleCat(cats, [], p)).toBeNull();
  });
  test("remove_subcat: sub already gone → error", () => {
    const p: CategoryProposal = {kind: "remove_subcat", parentId: "groceries", subId: "groceries/nope", oldName: "X"};
    expect(staleCat(cats, [], p)).toBeTruthy();
  });
  test("remove_subcat: sub intact → null", () => {
    const p: CategoryProposal = {kind: "remove_subcat", parentId: "groceries", subId: "groceries/organic", oldName: "Organic"};
    expect(staleCat(cats, [], p)).toBeNull();
  });
});

// ── matchMerchantRule new return type ─────────────────────────────────────────

describe("matchMerchantRule", () => {
  const ruleWithSub: MerchantRule = {payee: "tesco", cat: "groceries", subCat: "groceries/organic", created: 1};
  const ruleNoSub: MerchantRule = {payee: "boots", cat: "personal", created: 2};

  test("rule with subCat → {cat, subCat}", () => {
    expect(matchMerchantRule([ruleWithSub], "Tesco")).toEqual({cat: "groceries", subCat: "groceries/organic"});
  });
  test("rule without subCat → {cat} only", () => {
    expect(matchMerchantRule([ruleNoSub], "Boots")).toEqual({cat: "personal"});
  });
  test("no match → null", () => {
    expect(matchMerchantRule([ruleNoSub], "Waitrose")).toBeNull();
  });
});

// ── subcatBreakdown ───────────────────────────────────────────────────────────

describe("subcatBreakdown", () => {
  const FROM = "2026-10-01", TO = "2026-10-31";
  const eatingCat: Category = {
    id: "eating", name: "Eating out", budget: 240, fixed: false, group: "everyday",
    subcategories: [
      {id: "eating/restaurants", name: "Restaurants"},
      {id: "eating/coffee", name: "Coffee"},
    ],
  };
  const cats = [...baseState().categories.filter(c => c.id !== "eating"), eatingCat];

  test("returns [] when no transactions exist", () => {
    expect(subcatBreakdown([], "eating", FROM, TO, cats)).toEqual([]);
  });

  test("returns [] when no transaction has a subCat", () => {
    const txs = [tx({amount: 50, date: "2026-10-05", cat: "eating"})];
    expect(subcatBreakdown(txs, "eating", FROM, TO, cats)).toEqual([]);
  });

  test("single subCat returns one group", () => {
    const txs = [tx({amount: 100, date: "2026-10-05", cat: "eating", subCat: "eating/restaurants"})];
    const result = subcatBreakdown(txs, "eating", FROM, TO, cats);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({subcatId: "eating/restaurants", name: "Restaurants", spent: 100});
  });

  test("multiple subcategories: sorted biggest-first", () => {
    const txs = [
      tx({amount: 55, date: "2026-10-02", cat: "eating", subCat: "eating/coffee"}),
      tx({amount: 100, date: "2026-10-01", cat: "eating", subCat: "eating/restaurants"}),
    ];
    const result = subcatBreakdown(txs, "eating", FROM, TO, cats);
    expect(result[0].subcatId).toBe("eating/restaurants");
    expect(result[1].subcatId).toBe("eating/coffee");
  });

  test("unassigned transactions appear as Other group, last", () => {
    const txs = [
      tx({amount: 100, date: "2026-10-01", cat: "eating", subCat: "eating/restaurants"}),
      tx({amount: 40, date: "2026-10-02", cat: "eating"}),
    ];
    const result = subcatBreakdown(txs, "eating", FROM, TO, cats);
    expect(result.at(-1)).toMatchObject({subcatId: null, name: "Other", spent: 40});
  });

  test("parent total reconciles: sum of groups matches total expenses", () => {
    const txs = [
      tx({amount: 100, date: "2026-10-01", cat: "eating", subCat: "eating/restaurants"}),
      tx({amount: 55, date: "2026-10-02", cat: "eating", subCat: "eating/coffee"}),
      tx({amount: 40, date: "2026-10-03", cat: "eating"}),
    ];
    const totalExpenses = 195;
    const result = subcatBreakdown(txs, "eating", FROM, TO, cats);
    const sumOfGroups = result.reduce((a, g) => a + g.spent, 0);
    expect(sumOfGroups).toBeCloseTo(totalExpenses, 1);
  });

  test("refund on a subCat reduces its spent, floored at 0", () => {
    const refund: Tx = {id: "r1", type: "income", amount: 150, cat: "income", refundOf: "eating", subCat: "eating/restaurants", note: "", date: "2026-10-10", created: 9999};
    const txs = [
      tx({amount: 100, date: "2026-10-05", cat: "eating", subCat: "eating/restaurants"}),
      refund,
    ];
    const result = subcatBreakdown(txs, "eating", FROM, TO, cats);
    // restaurants group: £100 expense − £150 refund → clamped to 0 → not shown
    expect(result.find(g => g.subcatId === "eating/restaurants")).toBeUndefined();
  });

  test("refund without subCat reduces the unassigned total", () => {
    const refund: Tx = {id: "r2", type: "income", amount: 20, cat: "income", refundOf: "eating", note: "", date: "2026-10-10", created: 9999};
    const txs = [
      tx({amount: 50, date: "2026-10-05", cat: "eating"}),                               // unassigned
      tx({amount: 60, date: "2026-10-06", cat: "eating", subCat: "eating/restaurants"}), // named
      refund,
    ];
    const result = subcatBreakdown(txs, "eating", FROM, TO, cats);
    const other = result.find(g => g.subcatId === null);
    expect(other?.spent).toBeCloseTo(30, 1); // 50 − 20
  });

  test("transactions outside date range are excluded", () => {
    const txs = [
      tx({amount: 100, date: "2026-09-30", cat: "eating", subCat: "eating/restaurants"}), // before FROM
      tx({amount: 50, date: "2026-11-01", cat: "eating", subCat: "eating/restaurants"}),  // after TO
    ];
    expect(subcatBreakdown(txs, "eating", FROM, TO, cats)).toEqual([]);
  });

  test("from and to are inclusive", () => {
    const txs = [
      tx({amount: 10, date: FROM, cat: "eating", subCat: "eating/restaurants"}),
      tx({amount: 20, date: TO, cat: "eating", subCat: "eating/coffee"}),
    ];
    const result = subcatBreakdown(txs, "eating", FROM, TO, cats);
    expect(result).toHaveLength(2);
  });

  test("deleted/missing subcategory id: name falls back to 'Unknown', group still appears", () => {
    const txs = [
      tx({amount: 50, date: "2026-10-05", cat: "eating", subCat: "eating/nonexistent"}),
      tx({amount: 30, date: "2026-10-06", cat: "eating", subCat: "eating/restaurants"}),
    ];
    const result = subcatBreakdown(txs, "eating", FROM, TO, cats);
    const unknown = result.find(g => g.subcatId === "eating/nonexistent");
    expect(unknown?.name).toBe("Unknown");
    expect(unknown?.spent).toBe(50);
  });

  test("bill-linked transactions are excluded even if cat and subCat match", () => {
    const txs = [
      tx({amount: 100, date: "2026-10-05", cat: "eating", subCat: "eating/restaurants", billId: "b1"}),
      tx({amount: 50, date: "2026-10-06", cat: "eating", subCat: "eating/restaurants"}),
    ];
    const result = subcatBreakdown(txs, "eating", FROM, TO, cats);
    expect(result[0].spent).toBe(50); // bill-linked excluded, only the second tx counts
  });

  test("transactions for a different category are excluded", () => {
    const txs = [tx({amount: 100, date: "2026-10-05", cat: "groceries", subCat: "groceries/organic"})];
    expect(subcatBreakdown(txs, "eating", FROM, TO, cats)).toEqual([]);
  });
});
