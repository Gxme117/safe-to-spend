import {useState} from "react";
import {Pressable, StyleSheet, View} from "react-native";
import {calendar, dayDetail, payCycle, type Calc, type CalDay} from "@/lib/calc";
import type {Ctx} from "@/lib/types";
import {font, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {Card, CardHead, T} from "./ui";

const DOW = ["M", "T", "W", "T", "F", "S", "S"];
const W = `${100 / 7}%` as const;

/** Payday to payday, weeks starting on Monday. Tap a day for what it means. */
export function PaydayCalendar({ctx, c: calc}: {ctx: Ctx; c: Calc}) {
  const {c} = useTheme();
  const [sel, setSel] = useState<CalDay | null>(null);
  const {lead, days} = calendar(ctx, calc);
  const {dayNo, total} = payCycle(ctx, calc);
  if (!days.length) return null;

  const cellStyle = (d: CalDay) => {
    const k = d.kinds;
    if (k.includes("zero")) return {backgroundColor: c.accent};
    if (k.includes("pay")) return {backgroundColor: c.goodSoft, borderColor: c.good};
    return {};
  };
  const inkFor = (d: CalDay) => d.kinds.includes("zero") ? c.accentInk : d.kinds.includes("none") ? c.muted : c.ink;

  return (
    <Card>
      <CardHead title="Payday to payday" right={<T muted size={14}>Day {dayNo} of {total}</T>} />
      <View style={styles.grid} accessibilityRole="list" accessibilityLabel="Payday to payday calendar">
        {DOW.map((d, i) => <View key={`h${i}`} style={styles.cellBox}><T muted size={12} weight="semibold" style={{textAlign: "center"}}>{d}</T></View>)}
        {Array.from({length: lead}, (_, i) => <View key={`b${i}`} style={styles.cellBox} />)}
        {days.map(d => (
          <View key={d.d} style={styles.cellBox}>
            <Pressable onPress={() => setSel(sel?.d === d.d ? null : d)} accessibilityRole="button" accessibilityLabel={d.label}
              accessibilityState={{selected: sel?.d === d.d}}
              style={[styles.cell, {borderColor: d.today ? c.ink : "transparent", borderWidth: d.today ? 2 : 1}, cellStyle(d), sel?.d === d.d && {borderColor: c.ink, borderWidth: 2}]}>
              <T weight="bold" size={14} style={{color: inkFor(d)}}>{d.n}</T>
              <T size={10} weight="semibold" style={{color: d.kinds.includes("pay") ? c.good : inkFor(d), fontFamily: font.semibold}} lines={1}>{d.note}</T>
            </Pressable>
          </View>
        ))}
      </View>
      <View style={styles.key} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Key colour={c.accent} label="No-spend day" />
        <Key colour={c.ink} label="Bill due" dot />
        <Key colour={c.goodSoft} border={c.good} label="Payday" />
      </View>
      {sel ? <View accessibilityLiveRegion="polite"><T size={14}>{dayDetail(ctx, calc, sel)}</T></View> : null}
    </Card>
  );
}

function Key({colour, border, label, dot}: {colour: string; border?: string; label: string; dot?: boolean}) {
  return (
    <View style={{flexDirection: "row", alignItems: "center", gap: s[1]}}>
      <View style={{width: dot ? 6 : 12, height: dot ? 6 : 12, borderRadius: dot ? 3 : 4, backgroundColor: colour, borderWidth: border ? 1 : 0, borderColor: border}} />
      <T muted size={12}>{label}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {flexDirection: "row", flexWrap: "wrap"},
  cellBox: {width: W, padding: 2},
  cell: {minHeight: 48, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingVertical: s[1]},
  key: {flexDirection: "row", flexWrap: "wrap", gap: s[4]},
});
