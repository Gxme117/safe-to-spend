import {useMemo} from "react";
import {PanResponder, Pressable, Text, View} from "react-native";
import Svg, {Circle, Defs, RadialGradient, Stop} from "react-native-svg";
import {niceDate} from "@/lib/dates";
import type {monthDays, CycleDay} from "@/lib/day";
import type {IsoDate} from "@/lib/types";
import {home, s, textSize} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {MonthStep} from "./MonthStep";
import {T} from "./ui";

type Grid = NonNullable<ReturnType<typeof monthDays>>;
/** Which way < and > can go, what they say to a screen reader, and stepping the month by `n`. */
export interface MonthSteps { back: boolean; fwd: boolean; backLabel: string; fwdLabel: string; go: (n: number) => void }
const HEADS = ["M", "T", "W", "T", "F", "S", "S"];
// a day is a 44pt circle (the smallest comfortable tap size), its rows 10pt apart, as drawn
const DOT = 44, RING = 2, ROW_GAP = 10, MAX_SCALE = 1.5;
// payday's £ badge
const BADGE = 18;
// a sideways drag past this (more sideways than up or down) is a swipe; a quick flick counts sooner
const SWIPE_START = 12, SWIPE = 48, FLICK = 0.4;

/** Where a sideways swipe that's let go steps the month: left (`dx` below 0) to the next one, right to the one before, too short 0. */
export const swipeStep = (dx: number, vx: number): -1 | 0 | 1 =>
  dx < -SWIPE || (dx < 0 && vx < -FLICK) ? 1 : dx > SWIPE || (dx > 0 && vx > FLICK) ? -1 : 0;

/** A calendar month, a circle a day (Home, the minimal design), < and > either side of its name to step to another: days gone filled in,
 *  the picked day glowing orange (today, until you tap another; then today is ringed in ink), days to come outlined, a dot under a day with a bill still to go out,
 *  and payday outlined like any other day with a green £ (glowing green when picked). Swipe left for the next month, right for the one before, as < and > do.
 *  Screen readers hear the whole month in one sentence first, then each day is a button. */
export function CycleGrid({grid, picked, pick, step}: {grid: Grid; picked: IsoDate; pick: (d: IsoDate) => void; step: MonthSteps}) {
  // only a sideways drag is taken from the days (a tap still picks one) and from the page (an up or down drag still scrolls it)
  const swipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > SWIPE_START && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_, g) => {
      const n = swipeStep(g.dx, g.vx);
      if (n === 1 ? step.fwd : n === -1 && step.back) step.go(n);
    },
  }), [step]);
  return (
    <View {...swipe.panHandlers}>
      {/* the month on show with < and > either side (the < sits on the page's edge), and this month, the days to payday */}
      <View style={{flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: s[3]}}>
        <View style={{flexDirection: "row", alignItems: "center", flexShrink: 1, marginLeft: -s[2]}}>
          {/* a little bigger than the small lines around it, and in ink: it's something to tap */}
          <MonthStep dir="back" on={step.back} label={step.backLabel} onPress={() => step.go(-1)} size={24} />
          <View accessible accessibilityLabel={grid.said} style={{flexShrink: 1}}><T size="md" weight="semibold" lines={1}>{grid.range}</T></View>
          <MonthStep dir="forward" on={step.fwd} label={step.fwdLabel} onPress={() => step.go(1)} size={24} />
        </View>
        {/* a screen reader has it in the month's sentence */}
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><T size="homeSmall" weight="semibold" lines={1}>{grid.toPayday}</T></View>
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
  // the glow is light in both modes, so its date is drawn in the light look's ink
  // a day gone is filled in: dark in light mode, light in dark mode, so its date is the opposite
  const ink = picked ? home.light.page.ink : today ? c.ink : past ? (dark ? home.light.page.ink : "#FFFFFF") : x.payday ? c.ink : g.dayInk;
  // today is ringed in ink while another day is picked, so it never looks like any other day
  // payday is outlined like any other day: its £ badge marks it
  const ring = picked ? "transparent" : today ? c.ink : !past ? g.ring : "transparent";
  const fill = picked || today ? "transparent" : past ? g.past : "transparent";
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={said(x)} accessibilityState={{selected: picked}}
      style={{width: DOT, height: DOT, borderRadius: DOT / 2, alignItems: "center", justifyContent: "center",
        backgroundColor: fill, borderWidth: RING, borderColor: ring}}>
      {/* picked, payday glows green (money coming in) where any other day glows orange */}
      {picked ? <TodayGlow pay={x.payday} /> : null}
      {/* every day shows its date, days gone too. The circles are a fixed size, so the date grows with the phone's text size only so far.
          Proportional figures, as drawn ("11" sits close) */}
      <Text maxFontSizeMultiplier={MAX_SCALE} style={{fontFamily: today || picked || x.payday ? f.heavy : f.bold, fontSize: textSize.sm, color: ink}}>{x.n}</Text>
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
 *  (a CSS `radial-gradient(circle, …)`, which reaches its last colour at the box's corners). Payday: the same glow in green. */
const GLOW = {day: ["#FFA41C", "#FFEBBF"], pay: ["#2BC95A", "#D3F5DC"]};
function TodayGlow({pay}: {pay?: boolean}) {
  const [mid, edge] = GLOW[pay ? "pay" : "day"], id = pay ? "payGlow" : "todayGlow";
  return (
    <Svg width={DOT} height={DOT} style={{position: "absolute", top: -RING, left: -RING}}>
      <Defs>
        <RadialGradient id={id} gradientUnits="userSpaceOnUse" cx={DOT / 2} cy={DOT / 2} r={DOT / Math.SQRT2}>
          <Stop offset={0} stopColor={mid} />
          <Stop offset={1} stopColor={edge} />
        </RadialGradient>
      </Defs>
      <Circle cx={DOT / 2} cy={DOT / 2} r={DOT / 2} fill={`url(#${id})`} />
    </Svg>
  );
}
