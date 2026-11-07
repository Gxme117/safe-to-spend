import {sanitizeConfidence, sanitizeGuesses, unresolvedPayees} from "../classify";
import type {AppState, MerchantRule, Tx} from "../types";

// --- fixtures -----------------------------------------------------------------

const BASE_STATE: AppState = {
  balance: 1000, balanceSetAt: 0, balanceAsOf: "2026-11-01",
  incomes: [], bills: [], saving: 0, snoozed: {}, skipped: {},
  categories: [
    {id: "groceries", name: "Groceries", budget: 200, fixed: false},
    {id: "eating", name: "Eating out", budget: 100, fixed: false},
    {id: "coffee", name: "Coffee & drinks", budget: 50, fixed: false},
    {id: "entertainment", name: "Fun", budget: 50, fixed: false},
    {id: "other", name: "General", budget: 0, fixed: false},
  ],
};

let seq = 0;
function makeTx(overrides: Partial<Tx> & {id: string; note: string}): Tx {
  seq++;
  return {
    type: "expense", amount: 10, cat: "other", date: "2026-11-01",
    created: Date.now() + seq, needsCat: true, ...overrides,
  };
}

const NO_RULES: MerchantRule[] = [];

// --- unresolvedPayees() -------------------------------------------------------

describe("unresolvedPayees", () => {
  it("returns normalized payee for a plain unresolved expense", () => {
    const txs = [makeTx({id: "a", note: "Nandos"})];
    const result = unresolvedPayees(txs, NO_RULES, BASE_STATE);
    expect(result).toContain("nandos");
  });

  it("deduplicates same merchant across multiple txs", () => {
    const txs = [
      makeTx({id: "a", note: "Nandos"}),
      makeTx({id: "b", note: "NANDOS"}),
      makeTx({id: "c", note: "Nandos Ltd"}),
    ];
    // "nandos" should appear at most once
    const result = unresolvedPayees(txs, NO_RULES, BASE_STATE);
    const count = result.filter(p => p === "nandos").length;
    expect(count).toBe(1);
  });

  it("excludes payments with no letters (ungroupable)", () => {
    const txs = [makeTx({id: "a", note: "123456"})];
    const result = unresolvedPayees(txs, NO_RULES, BASE_STATE);
    expect(result).toHaveLength(0);
  });

  it("excludes empty note", () => {
    const txs = [makeTx({id: "a", note: ""})];
    const result = unresolvedPayees(txs, NO_RULES, BASE_STATE);
    expect(result).toHaveLength(0);
  });

  it("excludes payments already matched by a merchant rule", () => {
    const rules: MerchantRule[] = [{
      payee: "tesco", cat: "groceries", created: 0,
    }];
    const txs = [makeTx({id: "a", note: "Tesco Express"})];
    const result = unresolvedPayees(txs, rules, BASE_STATE);
    expect(result).toHaveLength(0);
  });

  it("excludes payments matched by a name hint", () => {
    // "Tesco" matches the groceries hint → resolves to 'groceries' which IS in BASE_STATE
    const txs = [makeTx({id: "a", note: "Tesco"})];
    const result = unresolvedPayees(txs, NO_RULES, BASE_STATE);
    expect(result).toHaveLength(0);
  });

  it("excludes ambiguous payees (PayPal)", () => {
    const txs = [makeTx({id: "a", note: "PayPal payment"})];
    const result = unresolvedPayees(txs, NO_RULES, BASE_STATE);
    expect(result).toHaveLength(0);
  });

  it("excludes ambiguous payees (Amazon)", () => {
    const txs = [makeTx({id: "a", note: "Amazon.co.uk"})];
    const result = unresolvedPayees(txs, NO_RULES, BASE_STATE);
    expect(result).toHaveLength(0);
  });

  it("excludes ambiguous payees (Square)", () => {
    const txs = [makeTx({id: "a", note: "SQ*CAFE"})];
    const result = unresolvedPayees(txs, NO_RULES, BASE_STATE);
    expect(result).toHaveLength(0);
  });

  it("excludes income transactions", () => {
    const txs = [makeTx({id: "a", note: "Employer Ltd", type: "income"})];
    const result = unresolvedPayees(txs, NO_RULES, BASE_STATE);
    expect(result).toHaveLength(0);
  });

  it("excludes bill-linked payments", () => {
    const txs = [makeTx({id: "a", note: "Netflix", billId: "b1"})];
    const result = unresolvedPayees(txs, NO_RULES, BASE_STATE);
    expect(result).toHaveLength(0);
  });

  it("excludes already-sorted payments (needsCat falsy)", () => {
    const txs = [makeTx({id: "a", note: "Waitrose", needsCat: undefined})];
    const result = unresolvedPayees(txs, NO_RULES, BASE_STATE);
    expect(result).toHaveLength(0);
  });

  it("includes a payee when rule exists for a different merchant", () => {
    // "Hobbycraft" has no hint and no rule — should reach unresolved
    const rules: MerchantRule[] = [{
      payee: "tesco", cat: "groceries", created: 0,
    }];
    const txs = [makeTx({id: "a", note: "Hobbycraft"})];
    const result = unresolvedPayees(txs, rules, BASE_STATE);
    expect(result).toContain("hobbycraft");
  });

  it("returns multiple distinct merchants with no hints or rules", () => {
    const txs = [
      makeTx({id: "a", note: "Hobbycraft"}),
      makeTx({id: "b", note: "Zara"}),
      makeTx({id: "c", note: "Waterstones"}),
    ];
    const result = unresolvedPayees(txs, NO_RULES, BASE_STATE);
    expect(result).toContain("hobbycraft");
    expect(result).toContain("zara");
    expect(result).toContain("waterstones");
    expect(result).toHaveLength(3);
  });
});

// --- sanitizeConfidence() -----------------------------------------------------

describe("sanitizeConfidence", () => {
  it("passes high confidence through for a regular merchant", () => {
    expect(sanitizeConfidence("waitrose", "high")).toBe("high");
  });

  it("passes medium confidence through for a regular merchant", () => {
    expect(sanitizeConfidence("waitrose", "medium")).toBe("medium");
  });

  it("passes low confidence through for any merchant", () => {
    expect(sanitizeConfidence("waitrose", "low")).toBe("low");
    expect(sanitizeConfidence("paypal", "low")).toBe("low");
  });

  it("caps ambiguous payee high → medium", () => {
    // "paypal" is in AMBIGUOUS_EXACT
    expect(sanitizeConfidence("paypal", "high")).toBe("medium");
  });

  it("caps ambiguous payee medium stays medium", () => {
    expect(sanitizeConfidence("paypal", "medium")).toBe("medium");
  });

  it("caps ambiguous prefix (google) high → medium", () => {
    expect(sanitizeConfidence("google play", "high")).toBe("medium");
  });

  it("caps sq prefix high → medium", () => {
    expect(sanitizeConfidence("sq*coffee", "high")).toBe("medium");
  });

  it("never upgrades low to anything higher", () => {
    expect(sanitizeConfidence("waitrose", "low")).toBe("low");
    expect(sanitizeConfidence("paypal", "low")).toBe("low");
  });
});

// --- sanitizeGuesses() --------------------------------------------------------

describe("sanitizeGuesses", () => {
  it("maps valid high confidence through", () => {
    const raw = new Map([["waitrose", {cat: "groceries", confidence: "high"}]]);
    const out = sanitizeGuesses(raw);
    expect(out.get("waitrose")).toEqual({cat: "groceries", confidence: "high"});
  });

  it("discards entries with invalid confidence string", () => {
    const raw = new Map([["shop", {cat: "groceries", confidence: "very_sure"}]]);
    const out = sanitizeGuesses(raw);
    expect(out.has("shop")).toBe(false);
  });

  it("caps ambiguous merchant from high to medium", () => {
    const raw = new Map([["paypal", {cat: "other", confidence: "high"}]]);
    const out = sanitizeGuesses(raw);
    expect(out.get("paypal")?.confidence).toBe("medium");
  });

  it("preserves sub if present", () => {
    const raw = new Map([["costa coffee", {cat: "coffee", sub: "chain", confidence: "high"}]]);
    const out = sanitizeGuesses(raw);
    expect(out.get("costa coffee")).toEqual({cat: "coffee", sub: "chain", confidence: "high"});
  });

  it("omits sub when undefined", () => {
    const raw = new Map([["nandos", {cat: "eating", confidence: "high"}]]);
    const out = sanitizeGuesses(raw);
    const entry = out.get("nandos");
    expect(entry).toBeDefined();
    expect("sub" in entry!).toBe(false);
  });

  it("handles an empty input map", () => {
    const out = sanitizeGuesses(new Map());
    expect(out.size).toBe(0);
  });

  it("handles multiple entries, discarding invalid ones", () => {
    const raw = new Map([
      ["waitrose", {cat: "groceries", confidence: "high"}],
      ["junk", {cat: "other", confidence: "extremely_sure"}],
      ["nandos", {cat: "eating", confidence: "medium"}],
    ]);
    const out = sanitizeGuesses(raw);
    expect(out.size).toBe(2);
    expect(out.has("waitrose")).toBe(true);
    expect(out.has("nandos")).toBe(true);
    expect(out.has("junk")).toBe(false);
  });

  it("passes low through", () => {
    const raw = new Map([["mystery shop", {cat: "other", confidence: "low"}]]);
    const out = sanitizeGuesses(raw);
    expect(out.get("mystery shop")?.confidence).toBe("low");
  });
});
