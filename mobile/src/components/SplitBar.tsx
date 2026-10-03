import {View} from "react-native";
import {split, type Calc} from "@/lib/calc";
import {money} from "@/lib/money";
import {s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {T} from "./ui";

/** Where your money is: one bar split by group, like iPhone Storage. */
export function SplitBar({c: calc}: {c: Calc}) {
  const {c} = useTheme();
  const sp = split(calc);
  const colour = {bills: c.splitBills, everyday: c.splitEveryday, free: c.accent};
  const sum = sp.parts.reduce((a, p) => a + p.amount, 0) || 1;
  return (
    <View style={{gap: s[2], marginTop: s[2], paddingTop: s[4], borderTopWidth: 1, borderTopColor: c.line}}>
      <View style={{flexDirection: "row", justifyContent: "space-between"}}>
        <T weight="bold" size={14}>Where your {money(sp.total)} is</T>
        {sp.short ? <T weight="heavy" size={14}>{money(sp.short)} short</T> : null}
      </View>
      <View accessible accessibilityRole="image" accessibilityLabel={sp.parts.map(p => `${p.label} ${money(p.amount)}`).join(", ")}
        style={{flexDirection: "row", gap: 2, height: 12, borderRadius: 6, overflow: "hidden", backgroundColor: c.line}}>
        {sp.parts.filter(p => p.amount > 0).map(p => <View key={p.key} style={{flex: p.amount / sum, minWidth: 4, backgroundColor: colour[p.key]}} />)}
      </View>
      <View style={{flexDirection: "row", flexWrap: "wrap", rowGap: s[1], columnGap: s[4]}} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {sp.parts.map(p => (
          <View key={p.key} style={{flexDirection: "row", alignItems: "center", gap: s[1]}}>
            <View style={{width: 8, height: 8, borderRadius: 4, backgroundColor: colour[p.key]}} />
            <T muted size={12}>{p.label}</T>
            <T weight="bold" size={12}>{money(p.amount)}</T>
          </View>
        ))}
      </View>
    </View>
  );
}
