import {Alert} from "react-native";
import {niceDate} from "@/lib/dates";
import {money} from "@/lib/money";
import type {Ctx, Tx} from "@/lib/types";
import {useMoney} from "@/store/useMoney";
import {Row} from "./ui";

/** What a payment was for: its bill, income source or category. */
export function txWhat(ctx: Ctx, it: Tx) {
  if (it.billId) return ctx.state.bills.find(b => b.id === it.billId)?.name || "Bill";
  if (it.type === "income") return ctx.state.incomes.find(s => s.id === it.cat)?.name || "Money in";
  return ctx.state.categories.find(x => x.id === it.cat)?.name || "Other";
}

/** One payment. Hold to delete. */
export function TxRow({ctx, it, showDate}: {ctx: Ctx; it: Tx; showDate?: boolean}) {
  const what = txWhat(ctx, it);
  const income = it.type === "income";
  const meta = [showDate ? niceDate(it.date) : "", it.note ? what : ""].filter(Boolean).join(". ");
  const remove = () => Alert.alert(`Delete this ${money(it.amount)} ${income ? "payment in" : "payment"}?`, undefined, [
    {text: "Cancel", style: "cancel"},
    {text: "Delete", style: "destructive", onPress: () => useMoney.getState().removeTx(it.id)},
  ]);
  return (
    <Row name={it.note || what} meta={meta || undefined} amount={income ? `+${money(it.amount)}` : `−${money(it.amount)}`} good={income}
      onLongPress={remove} accessibilityHint="Hold to delete" />
  );
}
