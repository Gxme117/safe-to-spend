import {useState} from "react";
import {Alert, Image, StyleSheet, View} from "react-native";
import {niceDate} from "@/lib/dates";
import {money} from "@/lib/money";
import type {Ctx, Tx} from "@/lib/types";
import {useMoney} from "@/store/useMoney";
import {radius} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {Row, T} from "./ui";

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
    <Row name={it.note || what} leading={<MerchantLogo name={it.note || what} uri={it.logo} />} meta={meta || undefined} amount={income ? `+${money(it.amount)}` : `−${money(it.amount)}`} good={income}
      onLongPress={remove} accessibilityHint="Hold to delete" />
  );
}

const LOGO = 32;
/** The shop's logo from Monzo, or the first letter of the name when there's none (or it won't load). Decorative: the row reads the name. */
function MerchantLogo({name, uri}: {name: string; uri?: string}) {
  const {c} = useTheme();
  const [failed, setFailed] = useState(false);
  const hide = {accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const};
  if (uri && !failed) {
    return <Image source={{uri}} onError={() => setFailed(true)} style={[styles.logo, {backgroundColor: c.soft}]} {...hide} />;
  }
  return (
    <View style={[styles.logo, styles.letter, {backgroundColor: c.soft}]} {...hide}>
      <T size="sm" weight="bold" muted>{(name.trim()[0] || "?").toUpperCase()}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  logo: {width: LOGO, height: LOGO, borderRadius: radius.pill},
  letter: {alignItems: "center", justifyContent: "center"},
});
