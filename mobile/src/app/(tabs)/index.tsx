import {router} from "expo-router";
import {useRef, useState} from "react";
import {Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from "react-native";
import {useAutoSync} from "@/components/Bank";
import {CheckinCard} from "@/components/Cards";
import {BigMoney} from "@/components/BigMoney";
import {CycleGrid} from "@/components/CycleGrid";
import {CardPeek} from "@/components/Hero";
import {HeroEmpty} from "@/components/HeroEmpty";
import {SpentToday} from "@/components/SpentToday";
import {T} from "@/components/ui";
import {dayFigure, hero, type Calc, type Hero} from "@/lib/calc";
import {niceDate, shortDate, shortDay} from "@/lib/dates";
import {cycleDays} from "@/lib/day";
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
const NUMBER_TOP = 235, NUMBER_NUDGE = -6, LABEL_GAP = 3, CYCLE_GAP = 30, SPARE_GAP = 60;
// a pull down past this (iOS lets the page go past its top) brings every account out
const PULL = 64;
// "What if I spend" this far under what's spare
// and Spent today this far under the bar (both as drawn). The reason line under the number is this tall.
const REASON_LINE = 24;
const WHAT_IF_GAP = 84, LIST_GAP = s[4];

const styles = StyleSheet.create({
  bar: {height: 46, borderRadius: radius.card, flexDirection: "row", alignItems: "center", paddingLeft: s[5], paddingRight: 6},
  amount: {flex: 1, paddingVertical: 0},
  ask: {width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center"},
});

function Home({ctx, c}: {ctx: Ctx; c: Calc}) {
  const {c: k} = useTheme();
  // the day highlighted on the pay cycle: today until you tap another (a new day starts back on today, as Home is keyed by it)
  const [picked, pick] = useState<IsoDate>(c.t);
  const h = hero(ctx, c);
  const grid = h.kind === "number" ? cycleDays(ctx, c) : null;
  // every account, the cards fanned out down the page: pull the page down (or tap the cards) to see them; while they're out the page
  // doesn't scroll, so a drag up tucks them back.
  // However they're opened (a pull, a tap on a card or the handle) they end on the same page: it's only held still once it's back at its
  // top, so a pull's spring back, or a page scrolled down, always finishes first
  const [open, setOpen] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const y = useRef(0);
  // where "What if I spend" is under the number, to bring it into view when the keyboard comes up
  const barY = useRef(0);
  const scroll = useRef<ScrollView>(null);
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
        {h.kind !== "number" ? <HeroEmpty kind={h.kind} /> : <Figure ctx={ctx} c={c} h={h} picked={picked} />}
        {grid ? <View style={{marginTop: CYCLE_GAP}}><CycleGrid grid={grid} picked={picked} pick={pick} /></View> : null}
        {/* what's free from now to payday, after bills and everyday; without enough, how much more covers them. Kept short to fit
            one line, and it wraps rather than shrinks if it doesn't */}
        {h.kind === "number" && h.free !== 0 ? (
          <T size="homeSmall" weight="medium" muted style={{marginTop: SPARE_GAP, textAlign: "center", textTransform: "uppercase", letterSpacing: 1.82, fontVariant: ["tabular-nums"]}}>
            {h.free > 0 ? `${money(Math.floor(h.free))} spare until payday`
              : `Need ${money(-h.free)} more for bills ${c.everydayLeft ? "and everyday" : "before payday"}`}
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

/** Under what's spare ("Today · scrolled down"): a bar to try a spend before you make it, and a ? for where today's number comes from.
 *  Typed, one line under it says what it would do to today and the days after, worked out by the real engine with that payment added
 *  (`whatIf`), so it's what Today would then show. The same as on the Today's number page. */
function WhatIf({ctx, onFocus}: {ctx: Ctx; onFocus: () => void}) {
  const {c: k, dark, f} = useTheme();
  const g = home[dark ? "dark" : "light"];
  const [amt, setAmt] = useState("");
  const input = useRef<TextInput>(null);
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

/** The lines under the big number: what it is, one line more, and the day on the right. Always two lines high, each kept to one line,
 *  so moving between days (or a day without an "out of") never moves the pay cycle below. */
function Labels({title, line, side}: {title: string; line: string | null; side: string}) {
  return (
    <View style={{flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: s[3], marginTop: LABEL_GAP}}>
      <View style={{flex: 1}}>
        <T size="figureLabel" weight="bold" lines={1} style={{textTransform: "uppercase", letterSpacing: 0.24, lineHeight: 28}}>{title}</T>
        <T size="figureLabel" muted lines={1} style={{fontVariant: ["tabular-nums"], lineHeight: 28}}>{line ?? " "}</T>
      </View>
      <T size="figureLabel" weight="medium" style={{lineHeight: 28}}>{side}</T>
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
      {gone ? <Labels title="Spent" line={gone.reason} side={shortDate(picked)} />
        // a day to come: what you could spend then. Its reason is too long for the line at this size, so the line says it's a
        // forecast and a screen reader hears the whole reason
        : ahead ? <Labels title="Safe to spend" line="Forecast" side={shortDate(picked)} />
        : <Labels title="Safe to spend" line={of} side={shortDay(c.t)} />}
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
