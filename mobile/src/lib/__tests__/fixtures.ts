import type {AppState, Ctx, Tx} from "../types";

// Mon 5 Oct 2026. Pay lands on the last working day: Wed 30 Sep, then Fri 30 Oct (the 31st is a Saturday).
export const TODAY = "2026-10-05";

export function baseState(over: Partial<AppState> = {}): AppState {
  return {
    balance: 1000, balanceSetAt: 1000, balanceAsOf: "2026-10-01",
    incomes: [{id: "job", name: "Pharmacy", type: "work", freq: "monthly-lastworking", varies: false, amount: 1800, main: true, since: "2026-09-01"}],
    bills: [
      {id: "rent", name: "Rent", amount: 400, freq: "monthly", day: 15, method: "dd", cat: "rent"},
      {id: "phone", name: "Phone", amount: 20, freq: "monthly", day: 1, method: "card"},
    ],
    categories: [
      {id: "rent", name: "Rent", budget: 0, fixed: true},
      {id: "groceries", name: "Groceries", budget: 200, fixed: false, group: "everyday"},
      {id: "eating", name: "Eating out", budget: 0, fixed: false},
      {id: "other", name: "Other", budget: 0, fixed: false},
    ],
    skipped: {}, snoozed: {},
    ...over,
  };
}

let n = 0;
export const tx = (t: Partial<Tx> & Pick<Tx, "amount" | "date">): Tx =>
  ({id: `t${++n}`, type: "expense", cat: "other", note: "", created: 2000 + n, ...t});

export const ctx = (over: Partial<Ctx> = {}): Ctx => ({state: baseState(), txs: [], today: TODAY, ...over});
