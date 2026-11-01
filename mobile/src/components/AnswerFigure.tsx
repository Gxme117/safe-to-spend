// The picture Tim or Frank leads an answer with, as in the "Explanatory B" frame: what the figure is (muted), the figure big,
// and a bar of what it's made of, a rounded segment each sized by its amount, its figure in ink and its words muted under it
// (the first on the left, the last on the right). lib/ai/visual.ts reads it from his answer; every figure in it was checked.
import {Text, View} from "react-native";
import type {Visual} from "@/lib/ai/visual";
import {money} from "@/lib/money";
import {hanken, s} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

// a part's column is never narrower than this, so its words fit (as MoneyBar's)
const COL = 64;

export function AnswerFigure({visual}: {visual: Visual}) {
  const {c} = useTheme();
  const {label, amount, parts} = visual;
  // the first part in ink, the rest in quieter greys
  const tone = [c.ink, c.muted, c.line];
  const sum = parts?.reduce((a, p) => a + p.amount, 0) ?? 0;
  const said = `${label}, ${money(amount)}.` + (parts ? " " + parts.map(p => `${money(p.amount)} ${p.name}`).join(", ") + "." : "");
  return (
    <View testID="answer-figure" accessible accessibilityRole="image" accessibilityLabel={said} style={{alignSelf: "stretch"}}>
      <Text style={{fontFamily: hanken.medium, fontSize: 17, lineHeight: 22, color: c.muted}}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit
        style={{marginTop: s[2], fontFamily: hanken.bold, fontSize: 56, lineHeight: 64, letterSpacing: -2.24, color: c.ink, fontVariant: ["tabular-nums"]}}>
        {money(amount)}
      </Text>
      {parts && sum > 0 ? (
        <View style={{marginTop: s[5], flexDirection: "row", gap: s[1]}}>
          {parts.map((p, i) => {
            const last = i === parts.length - 1 && i > 0;
            return (
              <View key={i} style={{flexGrow: p.amount / sum, flexBasis: 0, minWidth: COL}}>
                <View style={{height: 8, borderRadius: 4, backgroundColor: tone[i] ?? c.line}} />
                <Text numberOfLines={1} adjustsFontSizeToFit
                  style={{marginTop: s[3], fontFamily: hanken.medium, fontSize: 15, lineHeight: 20, color: c.muted, textAlign: last ? "right" : "left"}}>
                  <Text style={{fontFamily: hanken.semibold, color: c.ink}}>{money(p.amount)}</Text> {p.name}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
