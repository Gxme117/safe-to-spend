import {Pressable, Text, View} from "react-native";
import Svg, {Circle, Defs, RadialGradient, Stop} from "react-native-svg";
import {niceDate} from "@/lib/dates";
import type {cycleDays, CycleDay} from "@/lib/day";
import type {IsoDate} from "@/lib/types";
import {home, s, textSize} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {T} from "./ui";

type Grid = NonNullable<ReturnType<typeof cycleDays>>;
const HEADS = ["M", "T", "W", "T", "F", "S", "S"];
// a day is a 44pt circle (the smallest comfortable tap size), its rows 10pt apart, as drawn
const DOT = 44, RING = 2, ROW_GAP = 10, MAX_SCALE = 1.5;
// payday's £ badge
const BADGE = 18;

/** The pay cycle, a circle a day from the last payday to the next (Home, the minimal design): days gone filled in, the picked day
 *  glowing orange (today, until you tap another), days to come outlined, a dot under a day with a bill still to go out, and payday ringed in ink with a green £.
 *  Screen readers hear the whole cycle in one sentence first, then each day is a button. */
export function CycleGrid({grid, picked, pick}: {grid: Grid; picked: IsoDate; pick: (d: IsoDate) => void}) {
  return (
    <View>
      <View accessible accessibilityLabel={grid.said} style={{flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: s[3]}}>
        <View style={{flexShrink: 1}}><T size="homeSmall" weight="medium" muted lines={1}>{grid.range}</T></View>
        <T size="homeSmall" weight="semibold" lines={1}>{grid.toPayday}</T>
      </View>
      <View style={{marginTop: s[4]}}>
        <View style={{flexDirection: "row"}} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {HEADS.map((h, i) => <T key={i} size="homeSmall" weight="medium" muted style={{flex: 1, textAlign: "center"}}>{h}</T>)}
        </View>
        <View style={{gap: ROW_GAP, marginTop: s[3]}}>
          {grid.weeks.map((w, i) => (
            <View key={i} style={{flexDirection: "row"}}>
              {w.map((x, j) => <View key={x?.d ?? `b${j}`} style={{flex: 1, alignItems: "center"}}>{x ? <Day x={x} picked={x.d === picked} onPress={() => pick(x.d)} /> : null}</View>)}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const said = (x: CycleDay) => [niceDate(x.d), x.when === "today" && "today", x.bill && "bill due", x.payday && "payday"].filter(Boolean).join(", ");

// a tap doesn't dim the circle: only the glow moves
function Day({x, picked, onPress}: {x: CycleDay; picked: boolean; onPress: () => void}) {
  const {c, dark, f} = useTheme();
  const g = home[dark ? "dark" : "light"];
  const today = x.when === "today", past = x.when === "past";
  // the glow is light in both modes, so the picked date is drawn in the light look's ink
  // the glow and today's white are light in both modes, so their date is drawn in the light look's ink
  const ink = picked || today ? home.light.page.ink : x.payday ? c.ink : g.dayInk;
  // today is a white circle while another day is picked, so it never looks like any other day
  const ring = picked || today ? "transparent" : x.payday ? g.past : !past ? g.ring : "transparent";
  const fill = picked ? "transparent" : today ? "#FFFFFF" : past ? g.past : "transparent";
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={said(x)} accessibilityState={{selected: picked}}
      style={{width: DOT, height: DOT, borderRadius: DOT / 2, alignItems: "center", justifyContent: "center",
        backgroundColor: fill, borderWidth: RING, borderColor: ring}}>
      {picked ? <TodayGlow /> : null}
      {/* days gone are plain filled circles, no date; picked, one glows like today and shows its date, so you can see which day you're on.
          The circles are a fixed size, so the date grows with the phone's text size only so far. Proportional figures, as drawn ("11" sits close) */}
      {past && !picked ? null : <Text maxFontSizeMultiplier={MAX_SCALE} style={{fontFamily: today || picked || x.payday ? f.heavy : f.bold, fontSize: textSize.sm, color: ink}}>{x.n}</Text>}
      {x.bill ? <View style={{position: "absolute", bottom: -7, width: 4, height: 4, borderRadius: 2, backgroundColor: g.past}} /> : null}
      {/* payday: a little green £ on its top right, money coming in; ringed in the page colour so it stands clear of the circle */}
      {x.payday ? (
        <View style={{position: "absolute", top: -4, right: -4, width: BADGE, height: BADGE, borderRadius: BADGE / 2, alignItems: "center", justifyContent: "center",
          backgroundColor: c.incoming, borderWidth: RING, borderColor: c.bg}}>
          <Text maxFontSizeMultiplier={1} style={{fontFamily: f.heavy, fontSize: 10, lineHeight: 12, color: "#FFFFFF"}}>£</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** The picked day's fill (today's, as drawn, and the same on a day gone): orange in the middle fading to cream
 *  (a CSS `radial-gradient(circle, …)`, which reaches its last colour at the box's corners). */
function TodayGlow() {
  return (
    <Svg width={DOT} height={DOT} style={{position: "absolute", top: -RING, left: -RING}}>
      <Defs>
        <RadialGradient id="todayGlow" gradientUnits="userSpaceOnUse" cx={DOT / 2} cy={DOT / 2} r={DOT / Math.SQRT2}>
          <Stop offset={0} stopColor="#FFA41C" />
          <Stop offset={1} stopColor="#FFEBBF" />
        </RadialGradient>
      </Defs>
      <Circle cx={DOT / 2} cy={DOT / 2} r={DOT / 2} fill="url(#todayGlow)" />
    </Svg>
  );
}
