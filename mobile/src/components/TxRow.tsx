import {router} from "expo-router";
import {useState} from "react";
import {Alert, Image, StyleSheet, View} from "react-native";
import {niceDate} from "@/lib/dates";
import {nice} from "@/lib/found";
import {money} from "@/lib/money";
import {txLook, type Look} from "@/lib/looks";
import {moneyInWhat} from "@/lib/payments";
import type {Ctx, Tx} from "@/lib/types";
import {useMoney} from "@/store/useMoney";
import {badgeTint, radius} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {LookIcon} from "./LookIcon";
import {Row, T} from "./ui";

/** What a payment was for: its bill, category, pay, or what kind of money in it was. */
export function txWhat(ctx: Ctx, it: Tx) {
  if (it.billId) return ctx.state.bills.find(b => b.id === it.billId)?.name || "Bill";
  if (it.type === "save") return "Moved to savings";
  if (it.type === "income") return moneyInWhat(ctx, it);
  return ctx.state.categories.find(x => x.id === it.cat)?.name || "General";
}

/** Ask before deleting a payment. */
export function askRemove(it: Tx) {
  Alert.alert(`Delete this ${money(it.amount)} ${it.type === "income" ? "payment in" : "payment"}?`, undefined, [
    {text: "Cancel", style: "cancel"},
    {text: "Delete", style: "destructive", onPress: () => useMoney.getState().removeTx(it.id)},
  ]);
}

/** One payment. Tap to say what it was; hold to delete. */
export function TxRow({ctx, it, showDate}: {ctx: Ctx; it: Tx; showDate?: boolean}) {
  const what = txWhat(ctx, it);
  const income = it.type === "income";
  const meta = [showDate ? niceDate(it.date) : "", it.note ? what : ""].filter(Boolean).join(". ");
  const remove = () => askRemove(it);
  return (
    <Row name={nice(it.note) || what} leading={<MerchantLogo name={nice(it.note) || what} uri={it.logo} look={txLook(ctx, it)} />} meta={meta || undefined} amount={income ? `+${money(it.amount)}` : `−${money(it.amount)}`} good={income}
      // a move to savings has nothing to say about what it was for: only holding it (to delete) does anything
      onPress={it.type === "save" ? undefined : () => router.push(`/payment/${it.id}`)} onLongPress={remove}
      accessibilityHint={it.type === "save" ? "Hold to delete" : `Tap to ${income ? "say what this was" : "change what it was for"}. Hold to delete`} />
  );
}

const LOGO = 32;
/** The shop's logo from Monzo. When there's none (or it won't load): an icon for what it probably was on its colour (`look`,
 *  lib/looks.ts), or else the first letter of the name. Decorative: the row reads the name.
 *  Today draws it bigger, on its own colour, the letter in ink (`size`, `bg`, `strong`). */
export function MerchantLogo({name, uri, look, size = LOGO, bg, strong}: {name: string; uri?: string; look?: Look; size?: number; bg?: string; strong?: boolean}) {
  const {c, dark} = useTheme();
  const [failed, setFailed] = useState(false);
  const hide = {accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const};
  const box = [styles.logo, {width: size, height: size, backgroundColor: bg ?? c.soft}];
  if (uri && !failed) {
    return <Image source={{uri}} onError={() => setFailed(true)} style={box} {...hide} />;
  }
  if (look) {
    const t = badgeTint[look.tint][dark ? "dark" : "light"];
    return (
      <View style={[box, styles.letter, {backgroundColor: t.bg}]} {...hide}>
        <LookIcon name={look.icon} color={t.ink} size={Math.round(size * 0.5)} />
      </View>
    );
  }
  return (
    <View style={[box, styles.letter]} {...hide}>
      <T size="sm" weight="bold" muted={!strong}>{(name.trim()[0] || "?").toUpperCase()}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  logo: {borderRadius: radius.pill},
  letter: {alignItems: "center", justifyContent: "center"},
});
