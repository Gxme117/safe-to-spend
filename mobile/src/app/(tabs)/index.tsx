import {router} from "expo-router";
import {useRef, useState} from "react";
import {Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance, type TextInputInstance} from "react-native";
import {useAutoSync} from "@/components/Bank";
import {CheckinCard, SaveCard} from "@/components/Cards";
import {BigMoney} from "@/components/BigMoney";
import {CycleGrid, type MonthSteps} from "@/components/CycleGrid";
import {FigureLabels, REASON_LINE} from "@/components/FigureLabels";
import {CardPeek, MoneyBar} from "@/components/Hero";
import {HeroEmpty} from "@/components/HeroEmpty";
import {SpentToday} from "@/components/SpentToday";
import {T} from "@/components/ui";
import {closeGap, dayFigure, hero, moneyBarOn, type Calc, type Hero} from "@/lib/calc";
import {addMonths, monthName, niceDate, shortDate, shortDay} from "@/lib/dates";
import {monthDays} from "@/lib/day";
import {MONTHS_EACH_WAY} from "@/lib/livingMonth";
import {money, parseAmount} from "@/lib/money";
import {usedUp, whatIf} from "@/lib/today";
import type {Ctx, IsoDate} from "@/lib/types";
import {useCalc} from "@/store/useCalc";
import {home, radius, s, textSize} from "@/theme/tokens";
import {HomeLook, useTheme} from "@/theme/useTheme";

/**
 * Today, the minimal design ("less but better"): today's number is the page.
 * The bank cards hang down from the top, then the number, the pay cycle a circle a day, what's spare until payday, "What if I spend" and Spent today (with what's coming up in the next two days).
 * It keeps the colours it was drawn in (<HomeLook>). Every figure is the engine's (lib/calc.ts, lib/day.ts); this only draws.
 */
export default function HomeScreen() {
  const r = useCalc();
  useAutoSync();
  if (!r) return null;
  // a new day starts afresh
  return <HomeLook value><Home key={r.c.t} ctx={r.ctx} c={r.c} /></HomeLook>;
}

// Where things sit, as drawn: the number's line starts this far down the screen, under the cards; the lines under it this far below it;
// the pay cycle this far below those; what's spare this far below the grid.
// The £ sits a little left of the lines under it, as drawn (its side bearing would indent it).
const NUMBER_TOP = 166, NUMBER_NUDGE = -6, CYCLE_GAP = 30, SPARE_GAP = 60;
// a pull down past this (iOS lets the page go past its top) brings every account out
const PULL = 64;
// "What if I spend" this far under what's spare
// and Spent today this far under the bar (both as drawn)
const WHAT_IF_GAP = 84, LIST_GAP = s[4];

const styles = StyleSheet.create({
  bar: {height: 46, borderRadius: radius.card, borderCurve: "continuous", flexDirection: "row", alignItems: "center", paddingLeft: s[5], paddingRight: 6},
  amount: {flex: 1, paddingVertical: 0},
  ask: {width: 34, height: 34, borderRadius: 17, borderCurve: "continuous", alignItems: "center", justifyContent: "center"},
});

function Home({ctx, c}: {ctx: Ctx; c: Calc}) {
  const {c: k} = useTheme();
  // the day highlighted on the month: today until you tap another (a new day starts back on today, as Home is keyed by it)
  const [picked, pick] = useState<IsoDate>(c.t);
  // the month on show; < and > step it, 12 months each way, landing on today in this month and on the 1st in any other
  const thisMonth = c.t.slice(0, 7), [ym, setYm] = useState(thisMonth);
  const h = hero(ctx, c);
  const grid = h.kind === "number" ? monthDays(ctx, c, ym) : null;
  const bar = h.kind !== "number" ? null
    : moneyBarOn(ctx, c, picked);
  const named = (n: number) => `Show ${monthName(addMonths(ym, n), c.t.slice(0, 4), true)}`;
  const step: MonthSteps = {
    back: ym > addMonths(thisMonth, -MONTHS_EACH_WAY), fwd: ym < addMonths(thisMonth, MONTHS_EACH_WAY), backLabel: named(-1), fwdLabel: named(1),
    go: n => { const to = addMonths(ym, n); setYm(to); pick(to === thisMonth ? c.t : `${to}-01`); },
  };
  // every account, the cards fanned out down the page: pull the page down (or tap the cards) to see them; while they're out the page
  // doesn't scroll, so a drag up tucks them back.
  // However they're opened (a pull, a tap on a card or the handle) they end on the same page: it's only held still once it's back at its
  // top, so a pull's spring back, or a page scrolled down, always finishes first
  const [open, setOpen] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const y = useRef(0);
  // where "What if I spend" is under the number, to bring it into view when the keyboard comes up
  const barY = useRef(0);
  const scroll = useRef<ScrollViewInstance>(null);
  const show = (to: boolean) => {
    if (to && Math.abs(y.current) > 0.5) { setAtTop(false); scroll.current?.scrollTo({y: 0}); }
    setOpen(to);
  };
  return (
    <ScrollView ref={scroll} style={{backgroundColor: k.bg}} contentContainerStyle={{paddingBottom: s[7]}} scrollEnabled={!(open && atTop)}
      scrollEventThrottle={16} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets
      onScroll={e => { y.current = e.nativeEvent.contentOffset.y; if (!atTop && Math.abs(y.current) <= 0.5) setAtTop(true); }}
      onScrollEndDrag={e => { y.current = e.nativeEvent.contentOffset.y; if (y.current < -PULL) show(true); }}>
      <CardPeek ctx={ctx} c={c} top={NUMBER_TOP} open={open} setOpen={show} />
      <View style={{paddingHorizontal: s[6]}}>
        {/* did your pay (or money you're expecting) arrive? Only when one's due or missed, above the number it changes */}
        <CheckinCard ctx={ctx} style={{marginBottom: s[6]}} />
        {/* this pay's savings, while they're still held back from the number */}
        <SaveCard ctx={ctx} c={c} style={{marginBottom: s[6]}} />
        {h.kind !== "number" ? <HeroEmpty kind={h.kind} /> : <Figure ctx={ctx} c={c} h={h} picked={picked} />}
        {/* what's left of the pay cycle: bills, everyday, savings and free; on a day gone, what was left at its end; on a day to come,
            what would be left at its start */}
        {bar ? <View style={{marginTop: CYCLE_GAP}}><MoneyBar parts={bar} /></View> : null}
        {grid ? <View style={{marginTop: CYCLE_GAP}}><CycleGrid grid={grid} picked={picked} pick={pick} step={step} /></View> : null}
        {/* what's free from now to payday, after bills and everyday; without enough, how much more covers them. Kept short to fit
            one line, and it wraps rather than shrinks if it doesn't */}
        {h.kind === "number" && h.free !== 0 ? (
          <T size="homeSmall" weight="medium" muted style={{marginTop: SPARE_GAP, textAlign: "center", textTransform: "uppercase", letterSpacing: 1.82, fontVariant: ["tabular-nums"]}}>
            {h.free > 0 ? `${money(Math.floor(h.free))} spare until payday` : spareGap(ctx, -h.free, c.everydayLeft > 0)}
          </T>
        ) : null}
        {h.kind === "number" ? (
          <View style={{marginTop: WHAT_IF_GAP}} onLayout={e => { barY.current = e.nativeEvent.layout.y; }}>
            <WhatIf ctx={ctx} onFocus={() => {
              // once the keyboard is up, bring the bar up the screen, clear of it (the page under the cards starts at the number)
              const sub = Keyboard.addListener("keyboardDidShow", () => { scroll.current?.scrollTo({y: NUMBER_TOP + barY.current - s[7] * 3}); sub.remove(); });
            }} />
          </View>
        ) : null}
        <View style={{marginTop: h.kind === "number" ? LIST_GAP : s[7]}}><SpentToday ctx={ctx} c={c} day={picked} /></View>
      </View>
    </ScrollView>
  );
}

/** Where what's spare goes, without enough for bills and everyday: what to move from savings, and what's still needed, in a few words */
function spareGap(ctx: Ctx, gap: number, everyday: boolean) {
  const {move, more} = closeGap(ctx, gap);
  if (!move) return `Need ${money(gap)} more for bills ${everyday ? "and everyday" : "before payday"}`;
  return more ? `${money(move)} from savings, then ${money(more)} more` : `${money(move)} to move from savings`;
}

/** Under what's spare ("Today · scrolled down"): a bar to try a spend before you make it, and a ? for where today's number comes from.
 *  Typed, one line under it says what it would do to today and the days after, worked out by the real engine with that payment added
 *  (`whatIf`), so it's what Today would then show. The same as on the Today's number page. */
function WhatIf({ctx, onFocus}: {ctx: Ctx; onFocus: () => void}) {
  const {c: k, dark, f} = useTheme();
  const g = home[dark ? "dark" : "light"];
  const [amt, setAmt] = useState("");
  const input = useRef<TextInputInstance>(null);
  const a = parseAmount(amt), w = a > 0 ? whatIf(ctx, a) : null;
  const text = {fontFamily: f.regular, fontSize: textSize.md + 1, fontVariant: ["tabular-nums" as const]};
  return (
    <View>
      {/* the whole bar puts you in the amount; "What if I spend £" stays in front of it */}
      <Pressable onPress={() => input.current?.focus()} accessible={false} style={[styles.bar, {backgroundColor: g.card}]}>
        <Text style={[text, {color: k.muted}]}>What if I spend £</Text>
        <TextInput ref={input} value={amt} onChangeText={setAmt} onFocus={onFocus} keyboardType="decimal-pad" placeholder="…"
          placeholderTextColor={k.muted} accessibilityLabel="What if I spend" style={[text, styles.amount, {color: k.ink}]} />
        <Pressable onPress={() => router.push("/today")} hitSlop={s[1]} accessibilityRole="button" accessibilityLabel="Where today's number comes from"
          style={[styles.ask, {backgroundColor: home.light.page.ink}]}>
          <Text style={{fontFamily: f.bold, fontSize: textSize.md, color: "#FFFFFF"}}>?</Text>
        </Pressable>
      </Pressable>
      {/* one sentence, read out as it changes */}
      <View accessibilityLiveRegion="polite">
        {w ? <T size="sm" muted style={{marginTop: s[2], paddingHorizontal: s[5]}}>{w.line}</T> : null}
      </View>
    </View>
  );
}

/** The big number for the day picked on the pay cycle.
 *  Today (or a day to come): what's left of today's amount, "out of" the amount itself, and the day. Tap for where it comes from.
 *  As drawn, there's no line under it: why it's this number is in what a screen reader hears, and on the Today's number page.
 *  A day gone: what you spent that day, to the penny, and why ("2 payments").
 *  A day to come: what you could spend that day if you spend each day's amount until then (`forecast`), and its date.
 *  It's one number whichever day it shows, so moving between days counts from the last figure to the new one, up or down. */
function Figure({ctx, c, h, picked}: {ctx: Ctx; c: Calc; h: Extract<Hero, {kind: "number"}>; picked: IsoDate}) {
  const gone = picked < c.t ? dayFigure(ctx, c, picked) : null;
  const ahead = picked > c.t ? dayFigure(ctx, c, picked) : null;
  // without enough for bills and everyday there's no amount to be "out of"
  const of = h.free >= 0 ? `out of ${money(h.perDay)}` : null;
  const other = gone ?? ahead;
  const used = usedUp(ctx, c, h);
  return (
    <Pressable onPress={other ? undefined : () => router.push("/today")} accessibilityRole={other ? undefined : "button"}
      accessible accessibilityHint={other ? undefined : "Shows where it comes from"}
      accessibilityLabel={gone ? `Spent on ${niceDate(picked)}, ${money(gone.amount)}. ${gone.reason}`
        : ahead ? `Safe to spend on ${niceDate(picked)}, ${money(ahead.amount)}. ${ahead.reason}`
        : `Safe to spend today, ${money(h.left)}${of ? `, ${of}` : ""}. ${h.reason}`}>
      <View style={{marginLeft: NUMBER_NUDGE}}><BigMoney value={other ? other.amount : h.left} size="giant" wholePounds={!gone} /></View>
      {gone ? <FigureLabels title="Spent" line={gone.reason} side={shortDate(picked)} />
        // a day to come: what you could spend then, and its date; the line under says it's "Coming up", and a screen reader
        // hears the whole reason
        : ahead ? <FigureLabels title="Safe to spend" line="Coming up" side={shortDate(picked)} />
        : <FigureLabels title="Safe to spend" line={of} side={shortDay(c.t)} />}
      {/* why it's this number, in one plain line (a day gone already says why above); always there, so the pay cycle never moves.
          Today's amount all used, it says so and when it comes back, in two lines as drawn ("State · £0 today"), and keeps that room
          on every day while it's so */}
      <View style={{marginTop: s[1], minHeight: used ? REASON_LINE * 2 : undefined}}>
        {used && !other
          ? <T lines={2} style={{lineHeight: REASON_LINE}}><T weight="semibold" style={{lineHeight: REASON_LINE}}>{used.lead}</T> <T muted style={{lineHeight: REASON_LINE}}>{used.rest}</T></T>
          : <T muted lines={1} style={{lineHeight: REASON_LINE}}>{gone ? " " : ahead ? ahead.reason : h.reason}</T>}
      </View>
    </Pressable>
  );
}
