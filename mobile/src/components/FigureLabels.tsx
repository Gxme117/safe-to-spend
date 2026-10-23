import type {ReactNode} from "react";
import {View} from "react-native";
import {s} from "@/theme/tokens";
import {T} from "./ui";

// the labels sit this close under the big number, as drawn on Today
const LABEL_GAP = 3;

/** The lines under a big number, shared by Today and Living so they read alike: what it is (bold, uppercase), one line more (muted),
 *  and on the right the day or month. Always two lines high, each kept to one line, so nothing below moves when they change.
 *  `quiet`: the left lines are left out for a screen reader, when the number's own label already says them. */
export function FigureLabels({title, line, side, quiet}: {title: string; line: string | null; side: ReactNode; quiet?: boolean}) {
  return (
    <View style={{flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: s[3], marginTop: LABEL_GAP}}>
      <View style={{flex: 1}} accessibilityElementsHidden={quiet} importantForAccessibility={quiet ? "no-hide-descendants" : undefined}>
        <T size="figureLabel" weight="bold" lines={1} style={{textTransform: "uppercase", letterSpacing: 0.24, lineHeight: 28}}>{title}</T>
        <T size="figureLabel" muted lines={1} style={{fontVariant: ["tabular-nums"], lineHeight: 28}}>{line ?? " "}</T>
      </View>
      {typeof side === "string" ? <T size="figureLabel" weight="medium" style={{lineHeight: 28}}>{side}</T> : side}
    </View>
  );
}

/** The one plain line under the labels: why the number is what it is. As tall as Today's. */
export const REASON_LINE = 24;
