import {billFor} from "./bills";
import {addDays, dayDiff, niceDate} from "./dates";
import {isReceived, occurrences} from "./income";
import type {AppState, Ctx, IsoDate, Tx} from "./types";

/** What a payment can be filed under: once there are bills, fixed costs go through the bill (that's what marks it paid), not a category. */
export const spendCats = (s: AppState) => s.bills.length ? s.categories.filter(x => !x.fixed) : s.categories;

/** Money in that isn't your pay. Only "other-income" is real income; the rest is your own money or money coming back. */
export type InKind = "transfer" | "refund" | "payback" | "other-income";
export const IN_KINDS: {id: InKind; label: string; short: string}[] = [
  {id: "transfer", label: "Moving my own money", short: "Own money moved"},
  {id: "refund", label: "Refund", short: "Refund"},
  {id: "payback", label: "Paid back", short: "Paid back"},
  {id: "other-income", label: "Gift or other income", short: "Other income"},
];
/** Refunds and paybacks go back to a category, so they need one picked. */
export const needsRefundCat = (k: string) => k === "refund" || k === "payback";

/** Asked about, not guessed: money out Monzo couldn't place, and money in that hasn't been sorted. */
export const unsorted = (it: Tx) => !!it.needsCat || (it.type === "income" && it.cat === "monzo-in");

export type Filing =
  | {kind: "bill" | "cat" | "pay"; id: string}
  | {kind: "in"; id: InKind; refundOf?: string};
export interface FilingPatch { cat: string; billId?: string; forDate?: IsoDate; srcId?: string; refundOf?: string }

const catName = (ctx: Ctx, id?: string) => ctx.state.categories.find(x => x.id === id)?.name || "Other";

/** Re-files a payment. Its old filing never counts against the new one (a bill or payday it already marked). */
export function fileUnder(ctx: Ctx, it: Tx, pick: Filing): {patch: FilingPatch; msg: string} {
  const others = {...ctx, txs: ctx.txs.filter(x => x.id !== it.id)};
  if (pick.kind === "bill") {
    const b = ctx.state.bills.find(x => x.id === pick.id)!;
    const d = billFor(others, b, it.date);
    return {
      patch: {cat: b.cat || "bills", billId: b.id, ...(d ? {forDate: d} : {})},
      msg: d ? `${b.name} marked paid for ${niceDate(d)}. It's no longer held back` : `Filed under ${b.name}`,
    };
  }
  if (pick.kind === "pay") {
    const src = ctx.state.incomes.find(x => x.id === pick.id)!;
    // the payday it's closest to that hasn't already landed: pay can come a few days early or late
    const d = occurrences(src, addDays(it.date, -7), addDays(it.date, 7))
      .filter(x => !isReceived(others, src.id, x))
      .sort((a, b) => Math.abs(dayDiff(it.date, a)) - Math.abs(dayDiff(it.date, b)))[0];
    return d
      ? {patch: {cat: src.id, srcId: src.id, forDate: d}, msg: `Counted as ${src.name} pay for ${niceDate(d)}`}
      : {patch: {cat: src.id}, msg: `Filed as ${src.name} pay`};
  }
  if (pick.kind === "in") {
    if (needsRefundCat(pick.id)) {
      const name = catName(ctx, pick.refundOf);
      return {
        patch: {cat: pick.id, refundOf: pick.refundOf},
        msg: `${pick.id === "refund" ? "Refund" : "Paid back"} for ${name}. It's taken off what you spent there`,
      };
    }
    return {patch: {cat: pick.id}, msg: pick.id === "transfer" ? "Marked as your own money moving. It isn't income" : "Filed as other income"};
  }
  return {patch: {cat: pick.id}, msg: `Filed under ${catName(ctx, pick.id)}`};
}

/** What money in was, in a few words. */
export function moneyInWhat(ctx: Ctx, it: Tx) {
  if (it.cat === "savings") return "Moved from savings";
  const src = ctx.state.incomes.find(s => s.id === it.cat);
  if (src) return src.name;
  const k = IN_KINDS.find(x => x.id === it.cat);
  if (!k) return "Money in";
  return needsRefundCat(k.id) && it.refundOf ? `${k.short}, ${catName(ctx, it.refundOf)}` : k.short;
}
