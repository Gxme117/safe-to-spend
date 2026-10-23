import {router} from "expo-router";
import {useLayoutEffect, useReducer, useRef, useState} from "react";
import {Animated, Easing, PanResponder, Pressable, ScrollView, useWindowDimensions, View} from "react-native";
import {SyncButton, useAutoSync} from "@/components/Bank";
import {useReducedMotion} from "@/components/BigMoney";
import {CheckinCard} from "@/components/Cards";
import {ComingRowView} from "@/components/ComingRow";
import {Hero} from "@/components/Hero";
import {Icon} from "@/components/Icon";
import {TxRow} from "@/components/TxRow";
import {Button, Card, CardHead, PageTitle, T} from "@/components/ui";
import {addDays, longDate, niceDate} from "@/lib/dates";
import type {Calc, EverydayLeft} from "@/lib/calc";
import {dayView, dueByDay, weekLeft, weekMarks, type DayMark, type DayView} from "@/lib/day";
import {money} from "@/lib/money";
import {goal, heading, pager, panes, startPager} from "@/lib/pager";
import {isSideways, swipeStep} from "@/lib/swipe";
import type {Ctx} from "@/lib/types";
import {useCalc} from "@/store/useCalc";
import {font, radius, s, textSize} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

export default function DayScreen() {
  const r = useCalc();
  useAutoSync();
  if (!r) return null;
  // a new day starts back on today
  return <DayPager key={r.c.t} ctx={r.ctx} c={r.c} />;
}

/**
 * The days side by side like pages: swipe left for the next day, right for the day before; up and down still scroll.
 * Dragging shows the next one coming in, letting go settles on it. With Reduce Motion on, it just changes.
 * Which day you're on comes from the pager (lib/pager.ts), what each day shows from its view (lib/day.ts).
 */
function DayPager({ctx, c}: {ctx: Ctx; c: Calc}) {
  const [p, send] = useReducer(pager, c.t, startPager);
  const {width} = useWindowDimensions();
  // a day is as wide as the page inside its margins, with a margin's gap to the next
  const pane = width - 2 * s[4], stride = pane + s[4];
  const reduced = useReducedMotion();
  const [x] = useState(() => new Animated.Value(0));
  // each move slides the cards to the page it's going to. Only a slide that gets there lands: one cut short by another move doesn't.
  // Landing doesn't change the page the cards are on, so it doesn't start another slide
  const target = -goal(p) * stride, move = p.move;
  useLayoutEffect(() => {
    if (reduced) { x.setValue(target); send({type: "landed", move}); return; }
    Animated.timing(x, {toValue: target, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true})
      .start(({finished}) => { if (finished) send({type: "landed", move}); });
  }, [target, move, reduced, x]);
  // made once and read through a ref: rebuilt mid-swipe, it would measure the drag from the wrong place
  const latest = useRef({p, stride, reduced});
  useLayoutEffect(() => { latest.current = {p, stride, reduced}; });
  // eslint-disable-next-line react-hooks/refs -- the refs are read in the gesture handlers, never while drawing
  const [swipe] = useState(() => {
    // where the finger was when it took the cards: one that lands mid-slide waits for it to settle (it's quick), then drags from there
    let from: number | null = null;
    const home = () => {
      const {p, stride} = latest.current;
      if (!p.to) Animated.spring(x, {toValue: -p.page * stride, bounciness: 0, useNativeDriver: true}).start();
    };
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) => isSideways(g.dx, g.dy),
      onPanResponderGrant: () => { from = null; },
      onPanResponderMove: (_, g) => {
        const {p, stride, reduced} = latest.current;
        if (reduced || p.to) return;
        if (from === null) from = g.dx;
        x.setValue(-p.page * stride + g.dx - from);
      },
      onPanResponderRelease: (_, g) => {
        const step = swipeStep(g.dx, g.vx);
        if (step) send({type: "step", by: step}); else home();
      },
      onPanResponderTerminate: home,
      onPanResponderTerminationRequest: () => false,
    });
  });
  // the date and week show where you're going straight away; the cards follow
  const shown = heading(p), due = dueByDay(ctx, c), marks = weekMarks(ctx, c, shown, due), week = weekLeft(ctx, c);
  return (
    <View style={{flex: 1}} {...swipe.panHandlers}>
      <ScrollView contentContainerStyle={{padding: s[4], paddingTop: s[2], gap: s[4], paddingBottom: s[7]}}>
        <View style={{gap: s[3]}}>
          <View style={{flexDirection: "row", alignItems: "center", gap: s[2]}}>
            <View style={{flex: 1}}><PageTitle>{longDate(shown)}</PageTitle></View>
            <SyncButton />
            <RoundIcon icon="back" label={`Previous week, ${niceDate(addDays(shown, -7))}`} onPress={() => send({type: "step", by: -7})} />
            <RoundIcon icon="forward" label={`Next week, ${niceDate(addDays(shown, 7))}`} onPress={() => send({type: "step", by: 7})} />
          </View>
          <WeekStrip day={shown} today={c.t} marks={marks} onPick={d => send({type: "go", to: d})} />
          {week && marks.some(m => m.d === c.t) ? <T size="sm" muted lines={1} fit>{week.line}</T> : null}
        </View>
        <Animated.View style={{transform: [{translateX: x}]}}>
          {/* each day sits on its own page and stays there, keyed by date, so the one you swipe to is the same card, not a new one.
              The day in view sets the height; the others float beside it */}
          {panes(p).map(({d, page}) => {
            const live = d === p.day;
            return (
              <View key={d} pointerEvents={live ? "auto" : "none"} accessibilityElementsHidden={!live} importantForAccessibility={live ? "auto" : "no-hide-descendants"}
                style={live ? {left: page * stride} : {position: "absolute", top: 0, left: page * stride, width: pane}}>
                <DayPane ctx={ctx} c={c} v={dayView(ctx, c, d, due)} live={live} />
              </View>
            );
          })}
        </Animated.View>
      </ScrollView>
    </View>
  );
}

/** One day's cards: its number, the payday check and what's coming (today only), its payments and Everyday. */
function DayPane({ctx, c, v, live}: {ctx: Ctx; c: Calc; v: DayView; live: boolean}) {
  const today = v.when === "today";
  return (
    <View style={{gap: s[4]}}>
      <Hero ctx={ctx} c={c} v={v} live={live} />
      {today ? <CheckinCard ctx={ctx} /> : null}
      {today ? <ComingUp v={v} /> : null}
      <DayPayments ctx={ctx} v={v} />
      <EverydayChips everyday={v.everyday} />
    </View>
  );
}

// enough to see what's next without the card taking over the page; the rest are a tap away on the Month tab
const COMING_ROWS = 4;

/** Today: what's going out and coming in, today first, then the next few days to payday, so nothing needs working out. */
function ComingUp({v}: {v: DayView}) {
  const rows = [...v.due.map(x => ({x, when: "Today"})), ...v.later.map(x => ({x, when: x.d === addDays(v.d, 1) ? "Tomorrow" : niceDate(x.d)}))];
  if (!rows.length) return null;
  const more = rows.length - COMING_ROWS;
  return (
    <Card>
      <CardHead title="Coming up" right={more > 0 ? <Button small kind="ghost" label={`${more} more`} onPress={() => router.push("/month")} /> : undefined} />
      <View>{rows.slice(0, COMING_ROWS).map(({x, when}) => <ComingRowView key={x.key} x={x} meta={`${when}. ${x.meta}`} />)}</View>
    </Card>
  );
}

function RoundIcon({icon, label, onPress}: {icon: "back" | "forward" | "plus"; label: string; onPress: () => void}) {
  const {c} = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={4}
      style={{width: 36, height: 36, borderRadius: radius.pill, backgroundColor: c.surface, alignItems: "center", justifyContent: "center"}}>
      <Icon name={icon} color={c.ink} size={20} />
    </Pressable>
  );
}

const LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/** Monday to Sunday of the week you're looking at. Tap a day to go to it; today has a ring round it.
 *  Dots under a day: a bill going out (ink), money coming in (green). */
function WeekStrip({day, today, marks, onPick}: {day: string; today: string; marks: DayMark[]; onPick: (d: string) => void}) {
  const {c} = useTheme();
  return (
    <View style={{flexDirection: "row", justifyContent: "space-between"}} accessibilityRole="tablist">
      {marks.map(({d, bills, incoming}, i) => {
        const on = d === day, isToday = d === today;
        return (
          <Pressable key={d} onPress={() => onPick(d)} accessibilityRole="tab" accessibilityState={{selected: on}}
            accessibilityLabel={`${niceDate(d)}${isToday ? ", today" : ""}${bills ? ", bills due" : ""}${incoming ? ", money coming in" : ""}`} hitSlop={4}
            style={{alignItems: "center", gap: 2, width: 44}}>
            <T size="xs" weight="semibold" muted={!on}>{LETTERS[i]}</T>
            <View style={{width: 32, height: 32, borderRadius: radius.pill, alignItems: "center", justifyContent: "center",
              backgroundColor: on ? c.ink : "transparent", borderWidth: isToday && !on ? 1.5 : 0, borderColor: c.ink}}>
              <T weight="bold" style={{color: on ? c.bg : c.ink, fontFamily: font.bold, fontSize: textSize.md, fontVariant: ["tabular-nums"]}}>{String(+d.slice(8))}</T>
            </View>
            <View style={{flexDirection: "row", gap: 2, height: 4}}>
              {bills ? <View style={{width: 4, height: 4, borderRadius: 2, backgroundColor: c.ink}} /> : null}
              {incoming ? <View style={{width: 4, height: 4, borderRadius: 2, backgroundColor: c.incoming}} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** That day's payments; on a future day, what's due instead. */
function DayPayments({ctx, v}: {ctx: Ctx; v: DayView}) {
  if (v.when === "future") return (
    <Card>
      <CardHead title="Coming up" />
      {v.due.length
        ? <View>{v.due.map(x => <ComingRowView key={x.key} x={x} />)}</View>
        : <T muted>Nothing due.</T>}
    </Card>
  );
  const isToday = v.when === "today";
  const add = () => router.push(isToday ? "/add-payment" : `/add-payment?date=${v.d}`);
  // with a bank connected, payments come in by themselves: only cash needs typing in
  const bank = !!ctx.state.bank;
  return (
    <Card>
      <CardHead title={isToday ? "Spent today" : "Spent this day"} right={<RoundIcon icon="plus" label={bank ? "Add cash payment" : "Add payment"} onPress={add} />} />
      {v.payments.length
        ? <View>{v.payments.map(it => <TxRow key={it.id} ctx={ctx} it={it} />)}</View>
        : <T muted>{isToday ? "Nothing spent today." : "Nothing spent this day."}</T>}
      {v.tomorrow ? <T size="sm" muted lines={1} fit>{v.tomorrow}</T> : null}
    </Card>
  );
}

/** What's left of each everyday amount at the end of the day you're on. */
function EverydayChips({everyday}: {everyday: EverydayLeft[]}) {
  const {c} = useTheme();
  return (
    <Card>
      <CardHead title="Everyday" right={<Button small kind="ghost" label="Plan" onPress={() => router.push("/everyday")} />} />
      {!everyday.length
        ? <T muted>{"Set what you spend on every month, like groceries or coffee, and your daily number shows what's truly free."}</T>
        : <View style={{flexDirection: "row", flexWrap: "wrap", gap: s[2]}}>
            {everyday.map(e => (
              <View key={e.x.id} accessible accessibilityLabel={`${e.x.name}, ${money(e.spent)} of ${money(e.x.budget)} spent`} style={{flexDirection: "row", gap: s[2], borderWidth: 1, borderColor: c.line, borderRadius: radius.pill, paddingVertical: s[2], paddingHorizontal: s[3]}}>
                <T size="sm">{e.x.name}</T>
                <T size="sm" weight="bold">{`${money(e.spent)} of ${money(e.x.budget)}`}</T>
              </View>
            ))}
          </View>}
    </Card>
  );
}
