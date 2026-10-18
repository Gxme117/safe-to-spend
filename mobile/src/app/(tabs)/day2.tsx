import {router} from "expo-router";
import {useState, type ReactNode} from "react";
import {Pressable, ScrollView, Text, useWindowDimensions, View} from "react-native";
import {useAutoSync} from "@/components/Bank";
import {BigMoney} from "@/components/BigMoney";
import {CheckinCard} from "@/components/Cards";
import {ComingRowView} from "@/components/ComingRow";
import {CardHeads} from "@/components/Hero";
import {HeroEmpty} from "@/components/HeroEmpty";
import {Icon} from "@/components/Icon";
import {Logo} from "@/components/Logo";
import {TxRow} from "@/components/TxRow";
import {Button, Input, T} from "@/components/ui";
import type {Calc, EverydayLeft} from "@/lib/calc";
import {addDays, dayDiff, dayName, niceDate, parseD} from "@/lib/dates";
import {dayView, dueByDay, runway, weekLeft, type DayView, type RunwayDay} from "@/lib/day";
import {money, parseAmount} from "@/lib/money";
import {whatIf} from "@/lib/today";
import type {Ctx} from "@/lib/types";
import {useCalc} from "@/store/useCalc";
import {font, palettes, radius, s, textSize} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

/**
 * The Day tab, version 2: one number on the page, in a card so the eye goes to it first, the days to payday as a runway you can tap through
 * (with just the tops of the bank cards peeking out above it, so the balance is still a glance away; tap one to bring it out, as on the wallet),
 * "What if I spend…" right under today's number, then one plain list of that day. Every figure is the engine's (lib/day.ts); this only draws.
 */
export default function DayV2Screen() {
  const r = useCalc();
  useAutoSync();
  if (!r) return null;
  // a new day starts back on today
  return <DayV2 key={r.c.t} ctx={r.ctx} c={r.c} />;
}

// the title row's height: the title's line, which the logo matches
const TITLE = Math.round(textSize.lg * 1.2);

function DayV2({ctx, c}: {ctx: Ctx; c: Calc}) {
  const {c: theme} = useTheme();
  const [day, setDay] = useState(c.t);
  const due = dueByDay(ctx, c), v = dayView(ctx, c, day, due), days = runway(ctx, c, due);
  const today = v.when === "today", week = today ? weekLeft(ctx, c) : null;
  return (
    <ScrollView contentContainerStyle={{paddingTop: s[2], paddingBottom: s[7], gap: s[5]}} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <View style={{paddingHorizontal: s[4], gap: s[1]}}>
        <View style={{flexDirection: "row", alignItems: "center", gap: s[2]}}>
          {/* the Day tab's page title, a size smaller, level with the logo. A day's name always fits, so it never shrinks
              (iOS shrank it when Today came and went) */}
          <Text numberOfLines={1} accessibilityRole="header"
            style={{flex: 1, fontFamily: font.displayBold, textTransform: "uppercase", fontSize: textSize.md, lineHeight: TITLE, color: theme.ink}}>{dayName(day)}</Text>
          {/* Today is taller than the title, so it hangs over the row instead of making it taller: nothing below moves when it comes and goes */}
          {day !== c.t ? <View style={{height: TITLE, justifyContent: "center"}}><Button small kind="ghost" label="Today" onPress={() => setDay(c.t)} /></View> : null}
          <Logo />
        </View>
      </View>
      {/* the days to payday, above the number so you pick a day before reading it */}
      <Runway ctx={ctx} c={c} days={days} on={day} onPick={setDay} />
      {/* extra room under the number, so it reads as the page's headline */}
      <View style={{paddingHorizontal: s[4], marginTop: -s[5], marginBottom: s[5]}}>
        <Lead ctx={ctx} c={c} v={v} />
      </View>
      {today ? <View style={{paddingHorizontal: s[4], gap: s[4]}}><CheckinCard ctx={ctx} /><WhatIf ctx={ctx} /></View> : null}
      {week ? <Section title="This week"><T muted lines={1} fit>{week.line}</T></Section> : null}
      <Coming v={v} />
      <Spent ctx={ctx} v={v} />
      <Everyday everyday={v.everyday} />
    </ScrollView>
  );
}

/** The big number for the day you're on, in a card so it's the first thing you see: "Safe to Spend" (or "Spent") drawn huge and a smaller line naming the day.
 *  The reason under it says why, and on today a bar shows what's left of today's amount, labelled so it reads as "of today's £24". */
function Lead({ctx, c, v}: {ctx: Ctx; c: Calc; v: DayView}) {
  const {c: theme, dark} = useTheme();
  const h = v.figure;
  if (h.kind === "no-income" || h.kind === "payday-today" || h.kind === "no-payday") return <HeroEmpty kind={h.kind} />;
  const label = h.kind === "number" ? "Safe to Spend Today" : h.label;
  // the label names the day, so the number reads as that day's and nothing else's
  // "Safe to Spend" (or "Spent") is drawn huge; the day goes on a smaller line under it, so a long date never shrinks the big words
  const past = h.kind !== "number" && v.when === "past";
  const big = past ? "Spent" : "Safe to Spend";
  const when = past || v.when === "future" && v.d !== addDays(c.t, 1) ? `On ${niceDate(v.d)}` : v.when === "today" ? "Today" : "Tomorrow";
  const amount = h.kind === "number" ? h.left : h.amount;
  const days = c.payday ? dayDiff(v.d, c.payday) : null;
  const toPayday = days !== null && days > 0 && v.when !== "past" ? (days === 1 ? "Payday tomorrow" : `${days} days to payday`) : null;
  // what's left of today's amount: only today has one, and only while there's enough for bills and everyday
  const share = h.kind === "number" && h.perDay > 0 && h.free >= 0 ? Math.max(0, Math.min(1, h.left / h.perDay)) : null;
  // the number in a card so the eye lands on it first: white on the light page, the dark cards' grey on the dark one (where the number is custard)
  const muted = {color: theme.muted};
  const body = (
    <View style={{backgroundColor: dark ? theme.surface : "#FFFFFF", borderRadius: radius.card, padding: s[5]}}>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.4}
        style={{fontFamily: font.display, fontSize: textSize.hero, lineHeight: Math.round(textSize.hero * 1.05), letterSpacing: -textSize.hero * 0.02, color: theme.ink}}>{big}</Text>
      <Text numberOfLines={1} style={{fontFamily: font.head, fontSize: textSize.lg, lineHeight: Math.round(textSize.lg * 1.2), color: theme.ink}}>{when}</Text>
      <View style={{marginTop: s[3]}}><BigMoney value={amount} size="hero" color={dark ? theme.figure : theme.ink} /></View>
      <T lines={1} fit style={muted}>{h.reason}</T>
      {share !== null && h.kind === "number" ? (
        <View style={{marginTop: s[4], gap: s[2]}}>
          <View style={{height: 6, borderRadius: 3, backgroundColor: theme.soft, overflow: "hidden"}}>
            <View style={{width: `${share * 100}%`, height: 6, borderRadius: 3, backgroundColor: theme.ink}} />
          </View>
          <View style={{flexDirection: "row", gap: s[2]}}>
            <T size="xs" style={[muted, {flex: 1, fontVariant: ["tabular-nums"]}]} lines={1}>Left of {money(h.perDay)} for today</T>
            {toPayday ? <T size="xs" style={muted} lines={1}>{toPayday}</T> : null}
          </View>
        </View>
      ) : toPayday ? <T size="xs" style={[muted, {marginTop: s[2]}]}>{toPayday}, {niceDate(c.payday!)}</T> : null}
    </View>
  );
  if (h.kind !== "number") return <View accessible accessibilityLabel={`${label}, ${money(amount)}. ${h.reason}`} style={{paddingTop: s[4]}}>{body}</View>;
  return (
    <Pressable onPress={() => router.push("/today")} accessibilityRole="button" accessibilityLabel={`${label}, ${money(amount)}. ${h.reason}`}
      accessibilityHint="Shows where it comes from" style={{paddingTop: s[4]}}>
      {body}
    </Pressable>
  );
}

const CHIP = 56, CHIP_GAP = s[1], TRAY = s[2];
const SHORT = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** The days either side of today, on to payday: each with its own figure, so you see where you're heading without opening each one.
 *  A dark tray of plain days; the one you're on is filled in the ink (black on the light page, white on the dark), today keeps a custard ring.
 *  Days gone show what you spent (muted); today and the days ahead show Safe to Spend. Dots: a bill going out (ink), money coming in (green).
 *  The tops of the bank cards peek out above it, as if the tray were the front card of the wallet: tap one and they all come out in front, the tray at the back (tap it to tuck them away). */
function Runway({ctx, c: calc, days, on, onPick}: {ctx: Ctx; c: Calc; days: RunwayDay[]; on: string; onPick: (d: string) => void}) {
  const {c} = useTheme();
  const {width} = useWindowDimensions();
  // opens with today a little in from the left, so the days just gone still peek in
  const view = width - 2 * s[4];
  const at = Math.max(0, days.findIndex(x => x.when === "today") - 1);
  const startX = Math.min(at * (CHIP + CHIP_GAP), Math.max(0, days.length * (CHIP + CHIP_GAP) - CHIP_GAP + 2 * TRAY - view));
  return (
    <CardHeads ctx={ctx} c={calc} label="Show the days to payday" style={{marginHorizontal: s[4]}}>
      <View style={{backgroundColor: c.surface, borderRadius: radius.card, overflow: "hidden"}}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentOffset={{x: startX, y: 0}}
          contentContainerStyle={{padding: TRAY, gap: CHIP_GAP}} accessibilityRole="tablist">
          {days.map(x => {
            const sel = x.d === on, ink = sel ? c.bg : c.ink;
            const name = x.when === "today" ? "TODAY" : x.payday ? "PAYDAY" : SHORT[parseD(x.d).getDay()];
            const figure = x.amount === null ? "–" : money(Math.floor(x.amount));
            const said = x.amount === null ? "" : x.when === "past" ? `, spent ${money(x.amount)}` : `, ${money(x.amount)} safe to spend`;
            return (
              <Pressable key={x.d} onPress={() => onPick(x.d)} accessibilityRole="tab" accessibilityState={{selected: sel}}
                accessibilityLabel={`${niceDate(x.d)}${x.when === "today" ? ", today" : ""}${x.payday ? ", payday" : ""}${said}${x.bills ? ", bills due" : ""}${x.incoming ? ", money coming in" : ""}`}
                style={{width: CHIP, paddingVertical: s[2], paddingHorizontal: s[1], borderRadius: radius.control + 4, alignItems: "center",
                  backgroundColor: sel ? c.ink : "transparent", borderWidth: 1.5, borderColor: x.when === "today" && !sel ? c.figure : "transparent"}}>
                <T size="lg" weight="bold" style={{color: ink, fontVariant: ["tabular-nums"], opacity: x.when === "past" && !sel ? 0.55 : 1}}>{String(+x.d.slice(8))}</T>
                <T size="xs" weight="semibold" lines={1} fit style={{color: sel ? c.bg : c.muted, letterSpacing: 0.5}}>{name}</T>
                <T size="xs" weight="heavy" lines={1} fit style={{marginTop: s[1], color: ink, fontVariant: ["tabular-nums"], opacity: x.when === "past" && !sel ? 0.55 : 1}}>{figure}</T>
                {/* bills and money coming in: dots in the top-right corner, so the tile stays small */}
                <View style={{position: "absolute", top: 6, right: 6, flexDirection: "row", gap: 2}}>
                  {x.bills ? <View style={{width: 4, height: 4, borderRadius: 2, backgroundColor: ink}} /> : null}
                  {x.incoming ? <View style={{width: 4, height: 4, borderRadius: 2, backgroundColor: c.incoming}} /> : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </CardHeads>
  );
}

/** "What if I spend…", right under today's number: the real engine with that payment added, in one sentence. */
function WhatIf({ctx}: {ctx: Ctx}) {
  const [amt, setAmt] = useState("");
  const a = parseAmount(amt), w = a > 0 ? whatIf(ctx, a) : null;
  if (!whatIf(ctx, 1)) return null;
  // a white card in both modes, so it's drawn in the light palette's ink
  const p = palettes.light;
  return (
    <View style={{gap: s[2], backgroundColor: "#FFFFFF", borderRadius: radius.card, padding: s[4]}}>
      <Input prefix="£" value={amt} onChangeText={setAmt} keyboardType="decimal-pad" suffix="?" placeholder="What if I spend" placeholderTextColor={p.muted}
        box={{backgroundColor: "#FFFFFF", borderColor: p.line}} style={{color: p.ink}} keyboardAppearance="light" accessibilityLabel="What if I spend" />
      {w ? <View accessibilityLiveRegion="polite"><T size="sm" style={{color: p.ink}}>{w.line}</T></View> : null}
    </View>
  );
}

/** A plain titled block on the page: no card, a hairline under each row. */
function Section({title, right, children}: {title: string; right?: ReactNode; children: ReactNode}) {
  return (
    <View style={{paddingHorizontal: s[4], gap: s[2]}}>
      <View style={{flexDirection: "row", alignItems: "center", gap: s[2], minHeight: 36}}>
        <T weight="bold" size="lg" style={{flex: 1, fontFamily: font.headBold}}>{title}</T>
        {right}
      </View>
      {children}
    </View>
  );
}

// enough to see what's next; the rest are on the Month tab
const COMING_ROWS = 4;

/** What's going out and coming in: that day's, and on today the next few to payday as well. */
function Coming({v}: {v: DayView}) {
  const rows = [...v.due.map(x => ({x, when: v.when === "today" ? "Today" : ""})), ...v.later.map(x => ({x, when: x.d === addDays(v.d, 1) ? "Tomorrow" : niceDate(x.d)}))];
  if (!rows.length) return v.when === "future" ? <Section title="Coming up"><T muted>Nothing due.</T></Section> : null;
  const more = rows.length - COMING_ROWS;
  return (
    <Section title="Coming up" right={more > 0 ? <Button small kind="ghost" label={`${more} more`} onPress={() => router.push("/month")} /> : undefined}>
      <View>{rows.slice(0, COMING_ROWS).map(({x, when}) => <ComingRowView key={x.key} x={x} meta={when ? `${when}. ${x.meta}` : x.meta} />)}</View>
    </Section>
  );
}

/** That day's payments, with a + to add one (cash, when a bank's connected). Days to come have none. */
function Spent({ctx, v}: {ctx: Ctx; v: DayView}) {
  const {c} = useTheme();
  if (v.when === "future") return null;
  const isToday = v.when === "today";
  const bank = !!ctx.state.bank;
  const add = (
    <Pressable onPress={() => router.push(isToday ? "/add-payment" : `/add-payment?date=${v.d}`)} accessibilityRole="button" accessibilityLabel={bank ? "Add cash payment" : "Add payment"} hitSlop={4}
      style={{width: 36, height: 36, borderRadius: radius.pill, backgroundColor: c.surface, alignItems: "center", justifyContent: "center"}}>
      <Icon name="plus" color={c.ink} size={20} />
    </Pressable>
  );
  return (
    <Section title={isToday ? "Spent today" : "Spent this day"} right={add}>
      {v.payments.length
        ? <View>{v.payments.map(it => <TxRow key={it.id} ctx={ctx} it={it} />)}</View>
        : <T muted>{isToday ? "Nothing spent today." : "Nothing spent this day."}</T>}
      {v.tomorrow ? <T size="sm" muted lines={1} fit>{v.tomorrow}</T> : null}
    </Section>
  );
}

/** What's left of each everyday amount at the end of the day, as a thin bar: full is all of it still there. */
function Everyday({everyday}: {everyday: EverydayLeft[]}) {
  const {c} = useTheme();
  return (
    <Section title="Everyday" right={<Button small kind="ghost" label="Plan" onPress={() => router.push("/everyday")} />}>
      {!everyday.length
        ? <T muted>{"Set what you spend on every month, like groceries or coffee, and your daily number shows what's truly free."}</T>
        : <View style={{gap: s[4]}}>
            {everyday.map(e => {
              const said = e.left < 0 ? `${money(-e.left)} extra` : `${money(e.left)} left`;
              const share = e.x.budget > 0 ? Math.max(0, Math.min(1, e.left / e.x.budget)) : 0;
              return (
                <View key={e.x.id} accessible accessibilityLabel={`${e.x.name}, ${e.left < 0 ? `${money(-e.left)} more than planned` : `${money(e.left)} left`} of ${money(e.x.budget)}`} style={{gap: s[2]}}>
                  <View style={{flexDirection: "row", gap: s[2]}}>
                    <T weight="semibold" style={{flex: 1}} lines={1}>{e.x.name}</T>
                    <T weight="bold" style={{fontVariant: ["tabular-nums"]}}>{said}</T>
                    <T muted style={{fontVariant: ["tabular-nums"], fontSize: textSize.sm}}>of {money(e.x.budget)}</T>
                  </View>
                  <View style={{height: 4, borderRadius: 2, backgroundColor: c.soft, overflow: "hidden"}}>
                    <View style={{width: `${share * 100}%`, height: 4, borderRadius: 2, backgroundColor: c.ink}} />
                  </View>
                </View>
              );
            })}
          </View>}
    </Section>
  );
}
