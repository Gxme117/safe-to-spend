// Everyday spending as setup asks it: what you usually spend on each thing (an estimate is fine),
// then what you choose to allow yourself a month. The budget is what holds money back; the estimate is kept beside it.
import {PER_MONTH} from "./bills";
import {parseAmount, r2} from "./money";
import type {Category, Source, SpendFreq} from "./types";

// Most often first, so the list reads in order. The amount is each time, so one list covers "£60 every week" and "£15, 2–3 times a week".
export const SPEND_FREQ: Record<SpendFreq, string> = {
  daily: "Every day", "most-days": "4–6 times a week", "few-times": "2–3 times a week", weekly: "Every week",
  fortnightly: "Every 2 weeks", monthly: "Every month", quarterly: "Every 3 months", yearly: "Every year",
};
// Times a month: a week is 52/12 of a month, a day 365/12. "2–3 times" counts as 2.5, "4–6" as 5.
const PER_MONTH_SPEND: Record<SpendFreq, number> = {
  daily: 365 / 12, "most-days": 5 * PER_MONTH.weekly, "few-times": 2.5 * PER_MONTH.weekly, weekly: PER_MONTH.weekly,
  fortnightly: PER_MONTH.fortnightly, monthly: 1, quarterly: PER_MONTH.quarterly, yearly: PER_MONTH.yearly,
};

/**
 * To jog your memory, each starting at how often it usually happens. The ids are the app's own where there is one
 * (Groceries is `groceries`, Personal care is `personal`), so Monzo's payments land in them.
 */
export const EVERYDAY: {name: string; id: string; freq: SpendFreq}[] = [
  {name: "Groceries", id: "groceries", freq: "weekly"}, {name: "Transport", id: "transport", freq: "weekly"},
  {name: "Eating out", id: "eating", freq: "weekly"}, {name: "Takeaways", id: "takeaways", freq: "weekly"},
  {name: "Coffee & drinks", id: "coffee", freq: "few-times"}, {name: "Fuel", id: "fuel", freq: "fortnightly"},
  {name: "Shopping", id: "shopping", freq: "monthly"}, {name: "Entertainment", id: "entertainment", freq: "monthly"},
  {name: "Personal care", id: "personal", freq: "monthly"}, {name: "Health", id: "health", freq: "monthly"},
  {name: "Other", id: "other", freq: "monthly"},
];

/**
 * One thing as setup collects it: the amount each time as typed, how often, and the budget (null: the same as you usually spend).
 * `source`: "bank" when the estimate was found in your payments.
 */
export interface SpendDraft { amount: string; freq: SpendFreq; budget: string | null; source?: Source }

export const newSpend = (name: string): SpendDraft => ({amount: "", freq: EVERYDAY.find(x => x.name === name)?.freq ?? "monthly", budget: null});
export const spendReady = (d: SpendDraft) => parseAmount(d.amount) > 0;

/** What you usually spend a month: the amount each time, times how often. Nothing typed is nothing, not a guess. */
export const spendMonthly = (d: Pick<SpendDraft, "amount" | "freq">) => r2(Math.max(0, parseAmount(d.amount) || 0) * PER_MONTH_SPEND[d.freq]);

/** The budget as shown: what you usually spend, in whole pounds, until you type your own. Never lowered for you. */
export const budgetText = (d: SpendDraft) => d.budget ?? (spendReady(d) ? String(Math.round(spendMonthly(d))) : "");
export const budgetOf = (d: SpendDraft) => r2(Math.max(0, parseAmount(budgetText(d)) || 0));

/** A month in weeks: 12 months are 52 weeks. */
export const perWeek = (monthly: number) => r2(monthly * 12 / 52);

/**
 * Setup's everyday picks as categories, in place of the starting ones. A usual one keeps its id; your own get a new one.
 * With a budget it's everyday: that much is kept aside each month. Without one it's free: there to file payments against, holding nothing back.
 * The fixed ones first, then your picks in order, then the starting ones you didn't pick, as they were.
 */
export function everydayCats(base: Category[], picks: {name: string; draft: SpendDraft}[], newId: () => string): Category[] {
  const mine = picks.map(({name, draft}): Category => {
    const id = EVERYDAY.find(x => x.name === name)?.id ?? base.find(x => !x.fixed && x.name.toLowerCase() === name.toLowerCase())?.id ?? "c" + newId();
    const budget = budgetOf(draft), amount = r2(Math.max(0, parseAmount(draft.amount) || 0));
    const cat: Category = {id, name: name.trim().slice(0, 30), budget, fixed: false, group: budget > 0 ? "everyday" : "free"};
    if (amount > 0) cat.usual = {amount, freq: draft.freq, ...(draft.source ? {source: draft.source} : {})};
    return cat;
  });
  const ids = new Set(mine.map(x => x.id));
  return [...base.filter(x => x.fixed).map(x => ({...x})), ...mine, ...base.filter(x => !x.fixed && !ids.has(x.id)).map(x => ({...x}))];
}
