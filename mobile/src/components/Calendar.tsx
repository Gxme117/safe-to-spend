import {useState} from "react";
import {Pressable, View} from "react-native";
import {addMonths, longDate, pad, parseD} from "@/lib/dates";
import type {IsoDate} from "@/lib/types";
import {font, radius, s, textSize} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {Icon} from "./Icon";
import {T} from "./ui";

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * A month to pick a day from, drawn here rather than the iOS one so the bubbles can be our own:
 * today has a ring round it, and is a white bubble when it's the one picked; any other day picked is the accent (money coming in).
 * Monday first; days outside min and max can't be picked. `marks`: days with money already coming in, a green dot under the number.
 */
export function Calendar({value, onChange, today, min, max, marks}: {value: IsoDate; onChange: (d: IsoDate) => void; today: IsoDate; min?: IsoDate; max?: IsoDate; marks?: Set<IsoDate>}) {
  const {c} = useTheme();
  const [month, setMonth] = useState(value.slice(0, 7));
  const first = parseD(month + "-01");
  const lead = (first.getDay() + 6) % 7;   // blank days before the 1st, Monday first
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: (IsoDate | null)[] = [...Array(lead).fill(null), ...Array.from({length: days}, (_, i) => `${month}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);
  const canBack = !min || month > min.slice(0, 7), canOn = !max || month < max.slice(0, 7);
  const arrow = (icon: "back" | "forward", on: boolean, to: number, label: string) => (
    <Pressable onPress={() => on && setMonth(addMonths(month, to))} disabled={!on} hitSlop={s[2]} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{disabled: !on}} style={{width: 36, height: 36, alignItems: "center", justifyContent: "center", opacity: on ? 1 : 0.3}}>
      <Icon name={icon} color={c.ink} size={20} />
    </Pressable>
  );
  return (
    <View style={{gap: s[2]}}>
      <View style={{flexDirection: "row", alignItems: "center"}}>
        <View style={{flex: 1}} accessible accessibilityRole="header">
          <T weight="bold" size="lg">{`${MONTHS[first.getMonth()]} ${first.getFullYear()}`}</T>
        </View>
        {arrow("back", canBack, -1, "Previous month")}
        {arrow("forward", canOn, 1, "Next month")}
      </View>
      <View style={{flexDirection: "row"}}>
        {LETTERS.map((l, i) => <View key={i} style={{flex: 1, alignItems: "center"}}><T size="xs" weight="semibold" muted>{l}</T></View>)}
      </View>
      {Array.from({length: cells.length / 7}, (_, r) => (
        <View key={r} style={{flexDirection: "row"}}>
          {cells.slice(r * 7, r * 7 + 7).map((d, i) => {
            if (!d) return <View key={i} style={{flex: 1, height: 44}} />;
            const on = d === value, isToday = d === today, off = (!!min && d < min) || (!!max && d > max), mark = !!marks?.has(d);
            return (
              <View key={d} style={{flex: 1, alignItems: "center"}}>
                <Pressable onPress={() => onChange(d)} disabled={off} accessibilityRole="button"
                  accessibilityState={{selected: on, disabled: off}} accessibilityLabel={`${longDate(d)}${isToday ? ", today" : ""}${mark ? ", money coming in" : ""}`}
                  style={{width: 44, height: 44, borderRadius: radius.pill, alignItems: "center", justifyContent: "center",
                    backgroundColor: on ? (isToday ? "#FFFFFF" : c.accent) : "transparent",
                    borderWidth: isToday ? 1.5 : 0, borderColor: on ? c.line : c.ink, opacity: off ? 0.3 : 1}}>
                  <T style={{fontFamily: on || isToday ? font.bold : font.medium, fontSize: textSize.md, fontVariant: ["tabular-nums"],
                    color: on ? (isToday ? "#000000" : c.accentInk) : c.ink}}>
                    {String(+d.slice(8))}
                  </T>
                  {mark ? <View style={{position: "absolute", bottom: 6, width: 4, height: 4, borderRadius: 2,
                    backgroundColor: on ? (isToday ? "#000000" : c.accentInk) : c.incoming}} /> : null}
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
