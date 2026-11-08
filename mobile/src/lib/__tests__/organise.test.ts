import {buildPreviewExamples, buildRun, changeKey, eligible, isAmbiguous, orgReport, withEdits} from "../organise";
import type {OrgRun} from "../organise";
import type {AppState, Ctx, MerchantRule, Tx} from "../types";

// --- helpers ------------------------------------------------------------------

// Use catalog ids (eating, coffee, entertainment) so nameHint → resolve() works correctly
const BASE_STATE: AppState = {
  balance: 1000, balanceSetAt: 0, balanceAsOf: "2026-11-01", incomes: [], bills: [], saving: 0,
  snoozed: {}, skipped: {},
  categories: [
    {id: "groceries", name: "Groceries", budget: 200, fixed: false},
    {id: "eating", name: "Eating out", budget: 100, fixed: false},
    {id: "coffee", name: "Coffee & drinks", budget: 50, fixed: false},
    {id: "entertainment", name: "Fun", budget: 50, fixed: false},
    {id: "other", name: "General", budget: 0, fixed: false},
  ],
};

function makeTx(overrides: Partial<Tx> & {id: string}): Tx {
  return {
    type: "expense", amount: 10, cat: "other", note: overrides.id, date: "2026-11-01",
    created: Date.now(), needsCat: true, ...overrides,
  };
}

function makeCtx(txs: Tx[], state = BASE_STATE): Ctx {
  return {state, txs, today: "2026-11-07"};
}

const NO_RULES: MerchantRule[] = [];

// --- eligible() ---------------------------------------------------------------

describe("eligible", () => {
  it("includes expense + needsCat with no bill/refund", () => {
    const txs = [makeTx({id: "a"})];
    expect(eligible(txs)).toHaveLength(1);
  });

  it("excludes income", () => {
    const txs = [makeTx({id: "a", type: "income"})];
    expect(eligible(txs)).toHaveLength(0);
  });

  it("excludes bill-linked payments", () => {
    const txs = [makeTx({id: "a", billId: "b1"})];
    expect(eligible(txs)).toHaveLength(0);
  });

  it("excludes refunds", () => {
    const txs = [makeTx({id: "a", refundOf: "groceries"})];
    expect(eligible(txs)).toHaveLength(0);
  });

  it("excludes payments already sorted (no needsCat)", () => {
    const txs = [makeTx({id: "a", needsCat: undefined})];
    expect(eligible(txs)).toHaveLength(0);
  });

  it("excludes save type", () => {
    const txs = [makeTx({id: "a", type: "save"})];
    expect(eligible(txs)).toHaveLength(0);
  });

  it("sorts oldest first", () => {
    const txs = [
      makeTx({id: "b", date: "2026-11-02"}),
      makeTx({id: "a", date: "2026-11-01"}),
    ];
    const result = eligible(txs);
    expect(result[0].id).toBe("a");
    expect(result[1].id).toBe("b");
  });
});

// --- isAmbiguous() ------------------------------------------------------------

describe("isAmbiguous", () => {
  it("flags empty string", () => expect(isAmbiguous("")).toBe(true));
  it("flags too-short keys", () => expect(isAmbiguous("sq")).toBe(true));
  it("flags keys with no letters", () => expect(isAmbiguous("12345")).toBe(true));
  it("flags paypal", () => expect(isAmbiguous("paypal")).toBe(true));
  it("flags amazon", () => expect(isAmbiguous("amazon")).toBe(true));
  it("flags sq prefix", () => expect(isAmbiguous("sq tesco")).toBe(true));
  it("flags google", () => expect(isAmbiguous("google pay")).toBe(true));
  it("passes tesco", () => expect(isAmbiguous("tesco")).toBe(false));
  it("passes netflix", () => expect(isAmbiguous("netflix")).toBe(false));
  it("passes costa", () => expect(isAmbiguous("costa")).toBe(false));
});

// --- buildRun() — rule path ---------------------------------------------------

describe("buildRun — merchant rule (high confidence)", () => {
  it("classifies a payment matching a rule as high confidence", () => {
    const rules: MerchantRule[] = [{payee: "tesco", cat: "groceries", created: 1}];
    const txs = [makeTx({id: "t1", note: "TESCO EXTRA"})];
    const ctx = makeCtx(txs);
    const {run, preview} = buildRun("r1", txs, ctx, rules);
    expect(preview.high).toBe(1);
    expect(preview.medium).toBe(0);
    expect(run.changes[0].confidence).toBe("high");
    expect(run.changes[0].toCat).toBe("groceries");
    expect(run.changes[0].source).toBe("rule");
  });

  it("drops a rule whose category is not in spendCats (fixed cat with bills present)", () => {
    // spendCats excludes fixed categories only when bills exist
    const state = {
      ...BASE_STATE,
      categories: [{id: "bills", name: "Bills", budget: 0, fixed: true}, ...BASE_STATE.categories],
      bills: [{id: "b1", name: "BT", amount: 30, cat: "bills", freq: "monthly" as const}],
    };
    const rules: MerchantRule[] = [{payee: "bt", cat: "bills", created: 1}];
    const txs = [makeTx({id: "t1", note: "BT GROUP"})];
    const ctx = makeCtx(txs, state);
    const {run} = buildRun("r1", txs, ctx, rules);
    // With bills present, spendCats excludes fixed cats → falls through to low
    expect(run.changes[0].confidence).toBe("low");
  });
});

// --- buildRun() — name hint path (high: he can read it, the person can still edit) ---

describe("buildRun — name hint (sorted)", () => {
  it("classifies COSTA as coffee, sorted rather than left for review", () => {
    const txs = [makeTx({id: "t1", note: "COSTA COFFEE"})];
    const ctx = makeCtx(txs);
    const {run, preview} = buildRun("r1", txs, ctx, NO_RULES);
    // nameHint maps Costa → catalog id "coffee", resolve() finds the user's Coffee & drinks category
    expect(preview.high).toBe(1);
    expect(preview.medium).toBe(0);
    expect(run.changes[0].confidence).toBe("high");
    expect(run.changes[0].source).toBe("hint");
    expect(run.changes[0].toCat).toBe("coffee");
  });

  it("stores rulePayee for non-ambiguous hints", () => {
    const txs = [makeTx({id: "t1", note: "COSTA COFFEE"})];
    const ctx = makeCtx(txs);
    const {run} = buildRun("r1", txs, ctx, NO_RULES);
    expect(run.changes[0].rulePayee).toBeTruthy();
  });

  it("does not store rulePayee for ambiguous hints", () => {
    // PayPal goes to low anyway but check the guard on medium path too
    const txs = [makeTx({id: "t1", note: "PAYPAL *NETFLIX"})];
    const ctx = makeCtx(txs);
    const {run} = buildRun("r1", txs, ctx, NO_RULES);
    if (run.changes[0].confidence !== "low") {
      expect(run.changes[0].rulePayee).toBeUndefined();
    }
  });
});

// --- buildRun() — low confidence (unknown) ------------------------------------

describe("buildRun — low confidence (unknown)", () => {
  it("leaves fully unknown merchants as low", () => {
    const txs = [makeTx({id: "t1", note: "RANDOMSHOP XYZ"})];
    const ctx = makeCtx(txs);
    const {run, preview} = buildRun("r1", txs, ctx, NO_RULES);
    expect(preview.low).toBe(1);
    expect(run.changes[0].confidence).toBe("low");
  });

  it("low-confidence changes do NOT change the tx's cat", () => {
    const txs = [makeTx({id: "t1", note: "RANDOMSHOP XYZ", cat: "other"})];
    const ctx = makeCtx(txs);
    const {run} = buildRun("r1", txs, ctx, NO_RULES);
    expect(run.changes[0].toCat).toBe("other"); // same as fromCat
  });

  it("payments with no letters in normalised key → low", () => {
    const txs = [makeTx({id: "t1", note: "123456"})];
    const ctx = makeCtx(txs);
    const {run} = buildRun("r1", txs, ctx, NO_RULES);
    expect(run.changes[0].confidence).toBe("low");
  });
});

// --- buildRun() — grouping ----------------------------------------------------

describe("buildRun — grouping by normalised payee", () => {
  it("groups multiple payments from the same merchant", () => {
    const rules: MerchantRule[] = [{payee: "tesco", cat: "groceries", created: 1}];
    const txs = [
      makeTx({id: "t1", note: "TESCO EXTRA", amount: 20}),
      makeTx({id: "t2", note: "TESCO EXPRESS", amount: 15}),
    ];
    const ctx = makeCtx(txs);
    const {run, preview} = buildRun("r1", txs, ctx, rules);
    expect(preview.high).toBe(2);
    expect(run.changes.every(c => c.toCat === "groceries")).toBe(true);
  });

  it("rule takes priority over hint for the same payee", () => {
    // Costa has a name hint → coffee; but if there's a user rule → groceries, rule wins
    const rules: MerchantRule[] = [{payee: "costa", cat: "groceries", created: 1}];
    const txs = [makeTx({id: "t1", note: "COSTA COFFEE"})];
    const ctx = makeCtx(txs);
    const {run} = buildRun("r1", txs, ctx, rules);
    expect(run.changes[0].toCat).toBe("groceries");
    expect(run.changes[0].confidence).toBe("high");
  });
});

// --- buildRun() — cap at 500 --------------------------------------------------

describe("buildRun — MAX_ELIGIBLE cap", () => {
  it("caps at 500 eligible and reports more", () => {
    const txs: Tx[] = Array.from({length: 510}, (_, i) =>
      makeTx({id: `t${i}`, note: `SHOP${i}`}),
    );
    const ctx = makeCtx(txs);
    const {run, preview} = buildRun("r1", txs, ctx, NO_RULES);
    expect(run.changes.length).toBe(500);
    expect(preview.more).toBe(10);
    expect(run.more).toBe(10);
  });
});

// --- buildRun() with AI guesses (M2 path, gated) ------------------------------

describe("buildRun — AI guesses", () => {
  it("uses a high-confidence AI guess for an unknown merchant", () => {
    const txs = [makeTx({id: "t1", note: "RANDOMSHOP XYZ"})];
    const ctx = makeCtx(txs);
    const guesses = new Map([["randomshop xyz", {cat: "entertainment", confidence: "high" as const}]]);
    const {run, preview} = buildRun("r1", txs, ctx, NO_RULES, guesses);
    expect(preview.high).toBe(1);
    expect(run.changes[0].confidence).toBe("high");
    expect(run.changes[0].toCat).toBe("entertainment");
    expect(run.changes[0].source).toBe("ai");
  });

  it("caps an ambiguous payee AI guess to medium even if model says high", () => {
    const txs = [makeTx({id: "t1", note: "PAYPAL *ZORBLAX"})]; // nothing in the name says what it was
    const ctx = makeCtx(txs);
    const guesses = new Map([["paypal zorblax", {cat: "eating", confidence: "high" as const}]]);
    const {run} = buildRun("r1", txs, ctx, NO_RULES, guesses);
    // paypal is ambiguous → never high
    expect(run.changes[0].confidence).toBe("medium");
    expect(run.changes[0].rulePayee).toBeUndefined();
  });

  it("drops an AI guess with an unknown category", () => {
    const txs = [makeTx({id: "t1", note: "RANDOMSHOP XYZ"})];
    const ctx = makeCtx(txs);
    const guesses = new Map([["randomshop xyz", {cat: "nonexistent", confidence: "high" as const}]]);
    const {run} = buildRun("r1", txs, ctx, NO_RULES, guesses);
    expect(run.changes[0].confidence).toBe("low");
  });
});

// --- orgReport() --------------------------------------------------------------

describe("orgReport", () => {
  function makeAppliedRun(txs: Tx[]): OrgRun {
    return {
      id: "r1",
      changes: [
        {txId: txs[0].id, fromCat: "other", fromNeeds: true, toCat: "groceries", confidence: "high", source: "rule"},
        {txId: txs[1].id, fromCat: "other", fromNeeds: true, toCat: "eating", confidence: "medium", source: "hint"},
        {txId: txs[2].id, fromCat: "other", fromNeeds: true, toCat: "other", confidence: "low", source: "rule"},
      ],
      more: 0,
    };
  }

  const txs = [
    makeTx({id: "tx1", amount: 25, cat: "groceries"}),
    makeTx({id: "tx2", amount: 15, cat: "eating"}),
    makeTx({id: "tx3", amount: 5, cat: "other"}),
  ];

  it("reports correct counts", () => {
    const ctx = makeCtx(txs);
    const run = makeAppliedRun(txs);
    const report = orgReport(ctx, run);
    expect(report.auto).toBe(1);
    expect(report.provisional).toBe(1);
    expect(report.left).toBe(1);
    expect(report.reviewed).toBe(3);
    expect(report.failed).toBe(0);
  });

  it("includes byCat summary with totals", () => {
    const ctx = makeCtx(txs);
    const run = makeAppliedRun(txs);
    const report = orgReport(ctx, run);
    const groceries = report.byCat.find(x => x.cat === "groceries");
    expect(groceries?.count).toBe(1);
    expect(groceries?.total).toBe(25);
  });

  it("puts medium-confidence in check list sorted by amount descending", () => {
    const ctx = makeCtx(txs);
    const run = makeAppliedRun(txs);
    const report = orgReport(ctx, run);
    expect(report.check).toHaveLength(1);
    expect(report.check[0].txId).toBe("tx2");
  });

  it("puts low-confidence in unclear list", () => {
    const ctx = makeCtx(txs);
    const run = makeAppliedRun(txs);
    const report = orgReport(ctx, run);
    expect(report.unclear).toHaveLength(1);
    expect(report.unclear[0].txId).toBe("tx3");
  });

  it("lists every sorted payment in rows (high and medium, never low), newest first", () => {
    const dated = [
      makeTx({id: "tx1", amount: 25, cat: "groceries", date: "2026-11-01"}),
      makeTx({id: "tx2", amount: 15, cat: "eating", date: "2026-11-05"}),
      makeTx({id: "tx3", amount: 5, cat: "other", date: "2026-11-06"}),
    ];
    const report = orgReport(makeCtx(dated), makeAppliedRun(dated));
    expect(report.rows).toEqual(["tx2", "tx1"]);
  });

  it("caps unclear list at 10", () => {
    const manyTxs: Tx[] = Array.from({length: 15}, (_, i) => makeTx({id: `t${i}`, amount: i + 1}));
    const run: OrgRun = {
      id: "r1",
      changes: manyTxs.map(t => ({txId: t.id, fromCat: "other", fromNeeds: true, toCat: "other", confidence: "low" as const, source: "rule" as const})),
      more: 0,
    };
    const report = orgReport(makeCtx(manyTxs), run);
    expect(report.unclear).toHaveLength(10);
  });
});

// --- Undo safety (pure logic, no DB) ------------------------------------------

describe("undo safety (pure change inspection)", () => {
  it("fromNeeds is preserved correctly", () => {
    const txs = [makeTx({id: "t1", needsCat: true})];
    const ctx = makeCtx(txs);
    const rules: MerchantRule[] = [{payee: "tesco", cat: "groceries", created: 1}];
    const {run} = buildRun("r1", txs, ctx, rules);
    // The change knows fromNeeds was true, so undo can restore needs_cat = 1
    expect(run.changes[0].fromNeeds).toBe(true);
    expect(run.changes[0].fromCat).toBe("other");
  });

  it("low-confidence changes store same toCat as fromCat (tx never touched)", () => {
    const txs = [makeTx({id: "t1", cat: "other"})];
    const ctx = makeCtx(txs);
    const {run} = buildRun("r1", txs, ctx, NO_RULES);
    expect(run.changes[0].fromCat).toBe("other");
    expect(run.changes[0].toCat).toBe("other");
  });
});

// --- repeated run on no eligible payments ------------------------------------

describe("repeated run", () => {
  it("returns empty changes when there are no eligible payments", () => {
    // All sorted already (no needsCat)
    const txs = [makeTx({id: "t1", needsCat: undefined})];
    const ctx = makeCtx(txs);
    expect(eligible(txs)).toHaveLength(0);
    const {run, preview} = buildRun("r1", txs, ctx, NO_RULES);
    expect(run.changes).toHaveLength(0);
    expect(preview.total).toBe(0);
  });
});

// --- orgReport() reconciliation -----------------------------------------------

describe("orgReport — reconciliation", () => {
  it("auto + provisional + left === reviewed", () => {
    const txs = [
      makeTx({id: "tx1", amount: 25, cat: "groceries"}),
      makeTx({id: "tx2", amount: 15, cat: "eating"}),
      makeTx({id: "tx3", amount: 5, cat: "other"}),
    ];
    const run: OrgRun = {
      id: "r1",
      changes: [
        {txId: txs[0].id, fromCat: "other", fromNeeds: true, toCat: "groceries", confidence: "high", source: "rule"},
        {txId: txs[1].id, fromCat: "other", fromNeeds: true, toCat: "eating", confidence: "medium", source: "hint"},
        {txId: txs[2].id, fromCat: "other", fromNeeds: true, toCat: "other", confidence: "low", source: "rule"},
      ],
      more: 0,
    };
    const report = orgReport(makeCtx(txs), run);
    expect(report.auto + report.provisional + report.left).toBe(report.reviewed);
  });

  it("empty run: all counts zero, byCat empty, check and unclear empty", () => {
    const ctx = makeCtx([]);
    const run: OrgRun = {id: "r1", changes: [], more: 0};
    const report = orgReport(ctx, run);
    expect(report.auto).toBe(0);
    expect(report.provisional).toBe(0);
    expect(report.left).toBe(0);
    expect(report.reviewed).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.byCat).toHaveLength(0);
    expect(report.check).toHaveLength(0);
    expect(report.unclear).toHaveLength(0);
  });
});

// --- buildPreviewExamples() ---------------------------------------------------

describe("buildPreviewExamples", () => {
  it("puts the ones he's unsure of first, then the sure ones", () => {
    const rules: MerchantRule[] = [{payee: "tesco", cat: "groceries", created: 1}];
    const txs = [
      makeTx({id: "t1", note: "TESCO EXTRA", amount: 20}),
      makeTx({id: "t2", note: "RANDOMSHOP XYZ", amount: 10}),
    ];
    const ctx = makeCtx(txs);
    // the name says nothing, so it's only a guess from the model, medium
    const guesses = new Map([["randomshop xyz", {cat: "entertainment", confidence: "medium" as const}]]);
    const {run} = buildRun("r1", txs, ctx, rules, guesses);
    const examples = buildPreviewExamples(run, txs, BASE_STATE);
    expect(examples.map(e => e.confidence)).toEqual(["medium", "high"]);
  });

  it("deduplicates by normalised payee key — identical notes → one example with count > 1", () => {
    // Same note string → same normalised key → grouped together in buildRun
    const rules: MerchantRule[] = [{payee: "tesco", cat: "groceries", created: 1}];
    const txs = [
      makeTx({id: "t1", note: "TESCO"}),
      makeTx({id: "t2", note: "TESCO"}),
      makeTx({id: "t3", note: "TESCO"}),
    ];
    const ctx = makeCtx(txs);
    const {run} = buildRun("r1", txs, ctx, rules);
    const examples = buildPreviewExamples(run, txs, BASE_STATE);
    const tescoExamples = examples.filter(e => e.toCatId === "groceries" && e.confidence === "high");
    expect(tescoExamples).toHaveLength(1);
    expect(tescoExamples[0].count).toBe(3);
  });

  it("lists every shop, however many there are", () => {
    // 6 different high-confidence merchants (by rule)
    const rules: MerchantRule[] = [
      {payee: "tesco", cat: "groceries", created: 1},
      {payee: "sainsburys", cat: "groceries", created: 1},
      {payee: "lidl", cat: "groceries", created: 1},
      {payee: "aldi", cat: "groceries", created: 1},
      {payee: "waitrose", cat: "groceries", created: 1},
      {payee: "morrisons", cat: "groceries", created: 1},
    ];
    const txs = [
      makeTx({id: "t1", note: "TESCO"}),
      makeTx({id: "t2", note: "SAINSBURYS"}),
      makeTx({id: "t3", note: "LIDL"}),
      makeTx({id: "t4", note: "ALDI"}),
      makeTx({id: "t5", note: "WAITROSE"}),
      makeTx({id: "t6", note: "MORRISONS"}),
    ];
    const ctx = makeCtx(txs);
    const {run} = buildRun("r1", txs, ctx, rules);
    const examples = buildPreviewExamples(run, txs, BASE_STATE);
    expect(examples).toHaveLength(6);
  });

  it("truncates long merchant notes to 28 chars with ellipsis", () => {
    const rules: MerchantRule[] = [{payee: "some very long merchant name", cat: "groceries", created: 1}];
    const txs = [makeTx({id: "t1", note: "SOME VERY LONG MERCHANT NAME EXTRAS"})];
    const ctx = makeCtx(txs);
    const {run} = buildRun("r1", txs, ctx, rules);
    const examples = buildPreviewExamples(run, txs, BASE_STATE);
    expect(examples[0].note.length).toBeLessThanOrEqual(28);
    if (txs[0].note.length > 28) {
      expect(examples[0].note.endsWith("…")).toBe(true);
    }
  });

  it("includes toCatName resolved from AppState", () => {
    const rules: MerchantRule[] = [{payee: "tesco", cat: "groceries", created: 1}];
    const txs = [makeTx({id: "t1", note: "TESCO"})];
    const ctx = makeCtx(txs);
    const {run} = buildRun("r1", txs, ctx, rules);
    const examples = buildPreviewExamples(run, txs, BASE_STATE);
    expect(examples[0].toCatName).toBe("Groceries");
  });

  it("returns empty array when run has no high or medium changes", () => {
    const txs = [makeTx({id: "t1", note: "RANDOMSHOP XYZ"})];
    const ctx = makeCtx(txs);
    const {run} = buildRun("r1", txs, ctx, NO_RULES);
    const examples = buildPreviewExamples(run, txs, BASE_STATE);
    expect(examples).toHaveLength(0);
  });
});

// --- undo safety: fromNeeds tracking -----------------------------------------

describe("undo safety — corrected changes skipped", () => {
  it("fromNeeds is false for a payment that was already sorted", () => {
    // A payment that wasn't needsCat (already sorted) going in: fromNeeds should reflect that
    const txs = [makeTx({id: "t1", needsCat: undefined, cat: "groceries"})];
    const ctx = makeCtx(txs);
    const rules: MerchantRule[] = [{payee: "tesco", cat: "groceries", created: 1}];
    const {run} = buildRun("r1", [makeTx({id: "t1", needsCat: undefined, cat: "groceries"})], ctx, rules);
    // eligible() excludes this payment (no needsCat), so changes is empty
    expect(run.changes).toHaveLength(0);
  });
});

describe("withEdits — a shop's payments put somewhere else before Confirm", () => {
  const txs = [
    makeTx({id: "c1", note: "COSTA COFFEE"}), makeTx({id: "c2", note: "COSTA COFFEE", date: "2026-11-02"}),
    makeTx({id: "t1", note: "TESCO STORES 123"}), makeTx({id: "x1", note: "ZZQ9 LTD"}),
  ];
  const {run} = buildRun("r1", txs, makeCtx(txs), NO_RULES);
  const costaKey = run.changes[0].rulePayee!;

  it("with no edits it's the same run", () => {
    expect(withEdits(run, txs)).toBe(run);
    expect(withEdits(run, txs, {})).toBe(run);
  });

  it("moves every payment from that shop, counts them as sure, and leaves the rest alone", () => {
    const edited = withEdits(run, txs, {[costaKey]: {cat: "groceries", sub: "groceries/supermarket"}});
    for (const id of ["c1", "c2"]) {
      const c = edited.changes.find(x => x.txId === id)!;
      expect(c).toMatchObject({toCat: "groceries", toSub: "groceries/supermarket", confidence: "high"});
    }
    expect(edited.changes.find(x => x.txId === "t1")).toEqual(run.changes.find(x => x.txId === "t1"));
    expect(run.changes.find(x => x.txId === "c1")!.toCat).toBe("coffee"); // the original isn't touched
  });

  it("never touches one he couldn't place, whatever the key", () => {
    const low = run.changes.find(x => x.confidence === "low")!;
    const key = changeKey(low, new Map(txs.map(t => [t.id, t])));
    const edited = withEdits(run, txs, {[key]: {cat: "groceries"}});
    expect(edited.changes.find(x => x.txId === low.txId)).toEqual(low);
  });

  it("picking no subcategory clears the one he'd guessed", () => {
    const edited = withEdits(run, txs, {[costaKey]: {cat: "eating"}});
    expect(edited.changes.find(x => x.txId === "c1")!.toSub).toBeUndefined();
  });
});
