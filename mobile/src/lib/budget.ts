import {calc, catGroup, hero, spendIn} from "./calc";
import {addDays, dayDiff} from "./dates";
import {mainIncome, occurrences} from "./income";
import {money} from "./money";
import type {Category, Ctx, IsoDate} from "./types";

// An everyday budget is fixed: you choose it, and it's never changed for you. When what you spend keeps landing well away from it,
// the app suggests a new one and says why. It only asks; nothing changes until you tap.

/** How many finished pay cycles in a row it takes before asking: paid monthly (or four-weekly), one, since waiting three months
 *  would be too long; fortnightly, two; weekly, three, so one big week doesn't set it off. */
export const cyclesNeeded = (days: number) => days >= 25 ? 1 : days >= 12 ? 2 : 3;
// far enough away to be worth asking: more than 10% of the budget, and at least £10
const SHARE = 0.1, AT_LEAST = 10;

/** A suggested budget: to the nearest £5 under £100, the nearest £10 from there. */
export const roundBudget = (a: number) => a < 100 ? Math.round(a / 5) * 5 : Math.round(a / 10) * 10;

const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y), m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/** The pay cycles that have finished, newest first: each from a payday to the day before the next. */
export function pastCycles(ctx: Ctx): {from: IsoDate; to: IsoDate}[] {
  const src = mainIncome(ctx);
  if (!src) return [];
  const days = occurrences(src, addDays(ctx.today, -120), ctx.today);
  const out: {from: IsoDate; to: IsoDate}[] = [];
  for (let i = days.length - 1; i > 0; i--) out.push({from: days[i - 1], to: addDays(days[i], -1)});
  return out;
}

export interface BudgetHint {
  to: number;            // the suggested budget
  up: boolean;           // spending's been above it (else below it)
  reason: string;        // why, in one plain sentence
  effect: string | null; // what it'd do to your daily number, when it changes it
}

/** Whether to suggest a new budget for an everyday category, and what. It asks when spending has been more than 10% (and £10) away
 *  from the budget, the same way, in each of the last finished pay cycles (`cyclesNeeded`), and only for cycles the app has seen
 *  all of (the payments go back that far) and that ended after the last one was answered. The new figure is what's usual
 *  (the median, so one big shop doesn't set it), rounded. */
export function budgetHint(ctx: Ctx, catId: string): BudgetHint | null {
  const x = ctx.state.categories.find(k => k.id === catId);
  if (!x || catGroup(x) !== "everyday" || !(x.budget > 0)) return null;
  const cycles = pastCycles(ctx);
  if (!cycles.length) return null;
  const n = cyclesNeeded(dayDiff(cycles[0].from, cycles[0].to) + 1), use = cycles.slice(0, n);
  if (use.length < n) return null;
  const oldest = use[n - 1].from;
  // the payments have to go back to the start of the oldest of them, or it'd look like nothing was spent
  const first = ctx.txs.reduce<IsoDate | null>((a, it) => !a || it.date < a ? it.date : a, null);
  if (!first || first > oldest) return null;
  // answered: only cycles that ended after it count (paid monthly, the next one to finish can ask again)
  if (x.budgetKept && use[n - 1].to <= x.budgetKept) return null;
  const spent = use.map(cy => spendIn(ctx, cy.from, cy.to)[x.id] || 0);
  const gap = Math.max(AT_LEAST, x.budget * SHARE);
  const up = spent.every(a => a > x.budget + gap), down = spent.every(a => a < x.budget - gap);
  if (!up && !down) return null;
  const to = roundBudget(median(spent));
  if (to <= 0 || to === x.budget) return null;
  const reason = n === 1
    ? `You spent ${money(Math.round(spent[0]))} on ${x.name} last pay cycle, against a budget of ${money(x.budget)}.`
    : `You've spent around ${money(to)} on ${x.name} in each of your last ${n} pay cycles, against a budget of ${money(x.budget)}.`;
  return {to, up, reason, effect: dailyEffect(ctx, x, to)};
}

// What the new budget does to today's number, from the real engine with it in place: "Your daily number would be £15 instead of £18."
function dailyEffect(ctx: Ctx, x: Category, to: number): string | null {
  const now = hero(ctx, calc(ctx));
  const ctx2 = {...ctx, state: {...ctx.state, categories: ctx.state.categories.map(k => k.id === x.id ? {...k, budget: to} : k)}};
  const then = hero(ctx2, calc(ctx2));
  if (now.kind !== "number" || then.kind !== "number" || now.perDay === then.perDay) return null;
  return `Your daily number would be ${money(then.perDay)} instead of ${money(now.perDay)}.`;
}

/** The categories with the suggestion answered: changed to `to`, or kept as it is (`to` null). Either way it won't ask again until
 *  enough new pay cycles have finished. */
export function answerHint(cats: Category[], catId: string, to: number | null, today: IsoDate): Category[] {
  return cats.map(k => k.id === catId ? {...k, ...(to === null ? {} : {budget: to}), budgetKept: today} : k);
}
