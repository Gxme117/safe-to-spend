import type {AppState, Category} from "./types";

export const uid = () => Math.random().toString(36).slice(2, 10);

// The same starting categories as the web app.
export const DEFAULT_CATEGORIES: Category[] = [
  {id: "rent", name: "Rent", budget: 0, fixed: true},
  {id: "groceries", name: "Groceries", budget: 0, fixed: false},
  {id: "eating", name: "Eating out", budget: 0, fixed: false},
  {id: "transport", name: "Transport", budget: 0, fixed: false},
  {id: "bills", name: "Bills", budget: 0, fixed: true},
  {id: "other", name: "Other", budget: 0, fixed: false},
];

export const newState = (balance: number, today: string, now: number): AppState => ({
  balance, balanceSetAt: now, balanceAsOf: today,
  incomes: [], bills: [], categories: DEFAULT_CATEGORIES.map(c => ({...c})),
  skipped: {}, snoozed: {},
});
