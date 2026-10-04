import {billFor} from "./bills";
import {niceDate} from "./dates";
import type {AppState, Ctx, IsoDate, Tx} from "./types";

/** What a payment can be filed under: once there are bills, fixed costs go through the bill (that's what marks it paid), not a category. */
export const spendCats = (s: AppState) => s.bills.length ? s.categories.filter(x => !x.fixed) : s.categories;

export type Filing = {kind: "bill" | "cat"; id: string};
export interface FilingPatch { cat: string; billId?: string; forDate?: IsoDate }

/** Re-files a payment under a bill or a category. Same results as the web app's "What was this?". */
export function fileUnder(ctx: Ctx, it: Tx, pick: Filing): {patch: FilingPatch; msg: string} {
  if (pick.kind === "bill") {
    const b = ctx.state.bills.find(x => x.id === pick.id)!;
    // its old filing mustn't count as this bill already being paid
    const d = billFor({...ctx, txs: ctx.txs.filter(x => x.id !== it.id)}, b, it.date);
    return {
      patch: {cat: b.cat || "bills", billId: b.id, ...(d ? {forDate: d} : {})},
      msg: d ? `${b.name} marked paid for ${niceDate(d)}. It's no longer held back` : `Filed under ${b.name}`,
    };
  }
  const name = ctx.state.categories.find(x => x.id === pick.id)?.name || "Other";
  return {patch: {cat: pick.id}, msg: `Filed under ${name}`};
}
