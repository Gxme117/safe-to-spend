import {router} from "expo-router";
import {createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from "react";
import {GlassView} from "expo-glass-effect";
import Storage from "expo-sqlite/kv-store";
import {Animated, Easing, PanResponder, Pressable, StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle} from "react-native";
import Svg, {Defs, FeGaussianBlur, Filter, Text as SvgText} from "react-native-svg";
import {create} from "zustand";
import {moneyBar, type BarPart, type Calc} from "@/lib/calc";
import type {DayView} from "@/lib/day";
import {isoD, niceDate, pad} from "@/lib/dates";
import {money, moneyExact, r2} from "@/lib/money";
import {allBanks, aside, banksOn, totalOf} from "@/lib/banks";
import {bringOut, bringToFront, startOrder} from "@/lib/stack";
import type {Ctx} from "@/lib/types";
import {useMoney} from "@/store/useMoney";
import {deepen, inkOn} from "@/theme/color";
import {GLASS} from "@/theme/glass";
import {faceMetrics, radius, s, textSize} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {BigMoney, COUNT_MS, useCountUp, useReducedMotion} from "./BigMoney";
import {Icon} from "./Icon";
import {Mug} from "./Mug";
import {Button, Card, T} from "./ui";

/** Today's number and why, in one line. On another day, the same card shows that day's figure instead (from the day's view).
 *  `live`: it's the day in view. Days waiting either side don't count up, so one sliding in already shows its real figure. */
export function Hero({ctx, c, v, live = true}: {ctx: Ctx; c: Calc; v: DayView; live?: boolean}) {
  const h = v.figure;
  if (h.kind === "day") return (
    <View style={{gap: s[3]}}>
      <Wallet ctx={ctx} c={c} live={live} front={<Front label={h.label} amount={h.amount} reason={h.reason} add={v.when === "future" ? v.d : undefined} live={live} />} />
      <Reason text={h.reason} />
    </View>
  );
  if (h.kind === "no-income") return (
    <Card>
      <T weight="heavy" size="lg">Start with your income</T>
      <T muted>You can only spend what comes in, so add where your money comes from first: your job, Student Finance, family, anything. Your payday and daily spending figure are worked out from it.</T>
      <Button label="Add your income" onPress={() => router.push("/income/new")} />
    </Card>
  );
  if (h.kind === "payday-today") return (
    <Card>
      <T weight="heavy" size="lg">Payday is today</T>
      <T muted>Confirm your pay below and the daily figure will count down to your next payday.</T>
    </Card>
  );
  if (h.kind === "no-payday") return (
    <Card>
      <T weight="heavy" size="lg">No payday coming up</T>
      <T muted>{"Add a regular income source so there's a payday to count down to."}</T>
      <Button label="Add income" onPress={() => router.push("/income/new")} />
    </Card>
  );
  return (
    <View style={{gap: s[3]}}>
      <Wallet ctx={ctx} c={c} live={live} front={<Front label="Safe to Spend" amount={h.left} reason={h.reason} add={v.d} live={live} onOpen={() => router.push("/today")} />} />
      <Reason text={h.reason} />
      <MoneyBar parts={moneyBar(c)} />
    </View>
  );
}

/** Why the card says what it does, in one line under the wallet. Screen readers already hear it on the card, so it's hidden from them here. */
function Reason({text}: {text: string}) {
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <T size="sm" muted lines={1} fit>{text}</T>
    </View>
  );
}

// a part's column is never narrower than this, so its name and figure fit (tiny parts are drawn a little bigger than their share)
const BAR_COL = 64;
// moving to another day, the segments slide to their new sizes in step with the numbers counting: the same time and the same
// easing out (only the layout moves, so it can't use the native driver)
const BAR_MS = COUNT_MS, BAR_EASE = Easing.out(Easing.cubic);
type BarTo = {grow: number; min: number; gap: number; show: number};

/** What's bills, everyday, savings and free: a rounded segment each, sized by its amount, with its name and figure under it,
 *  lined up with where it starts. A part at £0 shrinks away. One line whatever the amounts: each column shrinks its words to fit.
 *  When the amounts change (another day picked), the segments slide to their new sizes; with Reduce Motion they jump there.
 *  With the balance hidden, the figures are dots. A screen reader hears every amount, to the penny, in one go. */
export function MoneyBar({parts}: {parts: BarPart[]}) {
  const {c: theme, dark} = useTheme();
  const hidden = useHidden(st => st.hidden);
  const reduced = useReducedMotion();
  // free is black in light mode and white in dark, so it stands apart from the colours
  const colour = {bills: theme.splitBills, everyday: theme.splitEveryday, savings: theme.splitSavings, free: dark ? "#FFFFFF" : "#000000"};
  const sum = parts.reduce((a, p) => a + Math.max(0, p.amount), 0);
  const last = parts.map(p => p.amount > 0).lastIndexOf(true);
  // where each column is heading: its share of the width, its smallest width, the gap after it (none after the last), and whether it shows
  const to: BarTo[] = parts.map((p, i) => p.amount > 0
    ? {grow: p.amount / sum, min: BAR_COL, gap: i < last ? s[1] : 0, show: 1} : {grow: 0, min: 0, gap: 0, show: 0});
  const [vs] = useState(() => to.map(t => ({grow: new Animated.Value(t.grow), min: new Animated.Value(t.min), gap: new Animated.Value(t.gap), show: new Animated.Value(t.show)})));
  const heading = JSON.stringify(to);
  useEffect(() => {
    const next: BarTo[] = JSON.parse(heading);
    const keys = ["grow", "min", "gap", "show"] as const;
    if (reduced) { vs.forEach((v, i) => keys.forEach(k => v[k].setValue(next[i][k]))); return; }
    const run = Animated.parallel(vs.flatMap((v, i) => keys.map(k =>
      Animated.timing(v[k], {toValue: next[i][k], duration: BAR_MS, easing: BAR_EASE, useNativeDriver: false}))));
    run.start();
    return () => run.stop();
  }, [heading, reduced, vs]);
  if (!sum) return null;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={hidden ? "Bills, everyday, savings and free" : parts.map(p => `${p.label} ${money(p.amount)}`).join(", ")}
      style={{flexDirection: "row"}}>
      {parts.map((p, i) => (
        <Animated.View key={p.key} style={{flexGrow: vs[i].grow, flexBasis: 0, minWidth: vs[i].min, paddingRight: vs[i].gap, opacity: vs[i].show, overflow: "hidden"}}>
          {/* fully rounded ends, like a pill */}
          <View style={{height: 8, borderRadius: 4, backgroundColor: colour[p.key]}} />
          {/* the words keep a column's smallest width while it slides, so they're clipped, never squeezed */}
          {p.amount > 0 ? (
            <View style={{minWidth: BAR_COL - s[1]}}>
              <T size="homeSmall" muted lines={1} fit style={{marginTop: s[3], paddingRight: s[1]}}>{p.label}</T>
              <BarFigure value={p.amount} hidden={hidden} />
            </View>
          ) : null}
        </Animated.View>
      ))}
    </View>
  );
}

/** A part's figure, to the pound. Another day picked, it counts to the new amount as the main number does; it starts where it is,
 *  so the page doesn't open on four counters. */
function BarFigure({value, hidden}: {value: number; hidden: boolean}) {
  const shown = useCountUp(Math.round(value), !hidden, COUNT_MS, false);
  return (
    <T size="md" weight="medium" lines={1} fit style={{marginTop: s[1], paddingRight: s[1], fontVariant: ["tabular-nums"]}}>
      {hidden ? "••••" : money(Math.round(shown))}
    </T>
  );
}

/** Our card: what the number is on top, the number in the middle.
 *  `add`: the day "Money in" opens its calendar on (today, or a day still to come). `onOpen`: tapping the card while it's in front (today: where the number comes from). */
function Front({label, amount, reason, add, live, onOpen}: {label: string; amount: number; reason: string; add?: string; live: boolean; onOpen?: () => void}) {
  const behind = useContext(IsBehind);
  const {c: theme} = useTheme();
  // glass if you chose it (Settings, Appearance) and the phone has it; on glass the text follows the theme, since the page shows through
  const glass = useMoney(st => st.cardStyle) === "glass" && GLASS;
  const ink = glass ? theme.ink : theme.accentInk, on = {color: ink};
  const Face = glass ? GlassView : View;
  return (
    <View>
      <Pressable onPress={onOpen} disabled={!onOpen || behind} accessible={false}>
      <Face {...(glass ? {glassEffectStyle: "regular" as const} : {})} style={[styles.card, !glass && {backgroundColor: theme.accent}]}
        accessible accessibilityRole={onOpen ? "button" : "summary"} accessibilityLabel={`${label}, ${money(amount)}. ${reason}`}
        accessibilityHint={onOpen ? "Shows where it comes from, and what a spend would do" : undefined}>
        {/* on glass the label is full strength, so it reads white in dark mode */}
        <T size="xl" weight="head" lines={1} fit style={[on, !glass && {opacity: 0.7}]}>{label}</T>
        {/* the number sits in the middle of the card, below the label */}
        <View style={{flex: 1, justifyContent: "center"}}>
          <BigMoney value={amount} size="hero" color={ink} animate={live} />
        </View>
        {/* the reason sits under the wallet, not on the card; screen readers hear it here */}
      </Face>
      </Pressable>
      {add ? <AddMoney day={add} fill={glass ? "#FFFFFF" : deepen(theme.accent)} ink={glass ? "#000000" : "#FFFFFF"} /> : null}
    </View>
  );
}

/** Bottom right of our card: money on its way. On colour, the card's colour deepened so white reads on it; on glass, white with black writing.
 *  It opens a calendar for the day and time it's coming. */
function AddMoney({day, fill, ink}: {day: string; fill: string; ink: string}) {
  const behind = useContext(IsBehind);
  return (
    <Pressable onPress={() => router.push(`/expect?date=${day}`)} disabled={behind} hitSlop={s[2]}
      accessibilityRole="button" accessibilityLabel="Money in" accessibilityHint="Pick the day and time it's coming"
      style={{position: "absolute", bottom: s[5], right: s[5], flexDirection: "row", alignItems: "center", gap: s[1],
        backgroundColor: fill, borderRadius: radius.pill, paddingVertical: s[2], paddingLeft: s[3], paddingRight: s[4]}}>
      <Icon name="plus" color={ink} size={16} />
      <T size="sm" weight="heavy" style={{color: ink}}>Money in</T>
    </Pressable>
  );
}

const HIDE_KEY = "hideBalance";
function readHidden() { try { return Storage.getItemSync(HIDE_KEY) === "1"; } catch { return false; } }
/** Hide balance: one setting for every card on every day (the days either side are already drawn, so each can't keep its own). */
const useHidden = create<{hidden: boolean; toggle(): void}>(set => ({
  hidden: readHidden(),
  toggle: () => set(s => {
    const hidden = !s.hidden;
    try { Storage.setItemSync(HIDE_KEY, hidden ? "1" : "0"); } catch {}
    return {hidden};
  }),
}));

// the card just behind the front one peeks out 48px (its balance fits), and the swap runs .5s on the same curve as the web.
// From the third card up they squeeze to a 20px strip each (still tappable; any taller and the top of the card's text shows), so a long stack doesn't push today's number down.
const PEEK = 48, SQUEEZE = 20;
/** How far above the front card a card `d` places behind it sits. */
const lift = (d: number) => d <= 0 ? 0 : PEEK + (d - 1) * SQUEEZE;
const SWAP_EASE = Easing.bezier(0.2, 0.75, 0.2, 1);
const BANK_BG = "#FE4F40", BANK_INK = "#FFFFFF";
// a card's name sits this far in from its right edge, as drawn (the S20 design)
const MARK_INSET = 22;

// cards for other accounts, not linked yet: a colour and a short mark each. Ink is picked for the colour, unless it's set (white on this blue, as drawn).
const OTHERS: {bg: string; ink?: string; mark: string; label: string}[] = [
  {bg: "#117ACA", ink: "#FFFFFF", mark: "CHASE", label: "C"},
  // a fresh green of our own, not Wise's brand green (CLAUDE.md). Last, so on Today it waits above the screen till the cards are out, then tops the fan
  {bg: "#A8DF7E", mark: "WISE", label: "W"},
];
// cards for banks linked through Open Banking: warm colours of our own, never a bank's brand colours
const LINKED = ["#3B3833", "#E8DFCC"];

/** The order of the wallet's cards, front first, shared by every day (like hide balance), so the card you used last stays just behind the front one. */
const useStackOrder = create<{order: number[]; bring(i: number, n: number): void}>(set => ({
  order: [],
  bring: (i, n) => set(s => ({order: bringToFront(s.order.length === n ? s.order : startOrder(n), i)})),
}));

/** Our card in front, the bank cards tucked behind (Apple Wallet style). Tap one behind to bring it forward;
 *  the one that was in front goes just behind it, so the stack is in the order you last used them. All share one hide-balance setting, so hiding on one hides on all.
 *  `live`: it's the day in view. Leave a day and its own card goes back in front, so coming back shows that day first. */
function Wallet({ctx, c, front, live}: {ctx: Ctx; c: Calc; front: ReactNode; live: boolean}) {
  const hidden = useHidden(s => s.hidden), toggle = useHidden(s => s.toggle);
  // cards top to bottom as they first rest; the last one (ours) sits in the layout, the others float above it
  const cards: {label: string; node: ReactNode}[] = [
    ...OTHERS.map(o => ({label: `Show your ${o.label} card`, node: <OtherCard {...o} hidden={hidden} onToggle={toggle} />})),
    {label: "Show your bank card", node: <BankCard ctx={ctx} c={c} hidden={hidden} onToggle={toggle} />},
    {label: "Show today's number", node: front},
  ];
  const last = cards.length - 1;
  const stored = useStackOrder(s => s.order), bring = useStackOrder(s => s.bring);
  const order = stored.length === cards.length ? stored : startOrder(cards.length);
  const up = order[0];
  // opening the Day tab, or leaving a day, puts ours back in front; the rest keep the order you last used them in
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current !== live ? !live : live) bring(last, cards.length);
    wasLive.current = live;
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps
  // the front card takes the bottom slot; the one used before it sits just above, and so on up
  const slot = (i: number) => last - order.indexOf(i);
  const y = (k: number) => lift(last) - lift(last - k); // a slot's distance from the top of the stack
  const reduced = useReducedMotion();
  const [vs] = useState(() => cards.map(() => new Animated.Value(0)));
  useEffect(() => {
    vs.forEach((v, i) => {
      const to = y(slot(i)) - y(i);
      if (reduced) v.setValue(to);
      else Animated.timing(v, {toValue: to, duration: 500, easing: SWAP_EASE, useNativeDriver: true}).start();
    });
  }, [order.join(), reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={{paddingTop: lift(last)}}>
      {cards.map((card, i) => {
        const transform = i === last
          ? [{translateY: vs[i]}, {scale: vs[i].interpolate({inputRange: [-PEEK, 0], outputRange: [0.97, 1], extrapolate: "clamp"})}]
          : [{translateY: vs[i]}];
        return (
          <Animated.View key={card.label} style={[i < last && styles.bank, {top: i < last ? y(i) : undefined, zIndex: slot(i) + 1, transform}]}>
            <Behind behind={i !== up} label={card.label} onPress={() => bring(i, cards.length)} eye={i < last}>{card.node}</Behind>
          </Animated.View>
        );
      })}
    </View>
  );
}

// a card's clip box reaches this far past it, so its shadow isn't cut off;
// a card behind is cut off this far under the front's top, so the front's rounded corners show card behind them, not page
const SHADOW = s[4], TUCK = s[6];

/** The wallet with something else in front (Day 2: the days to payday): just the tops of the bank cards show, so the balance is a glance away.
 *  Same offsets and the same swap, but a tap on a card's top brings them all out in front, that one at the front and the front (the days) right at the back.
 *  Out, a tap on a card behind swaps it to the front as in the wallet; a tap on the days at the back tucks the cards away again.
 *  The front needn't be a card's height, so each card behind is cut off under the front, and the stack grows to fit a bank card that's out. */
export function CardHeads({ctx, c, label, style, children}: {ctx: Ctx; c: Calc; label: string; style?: StyleProp<ViewStyle>; children: ReactNode}) {
  const hidden = useHidden(s => s.hidden), toggle = useHidden(s => s.toggle);
  // top to bottom as they first rest, as in the wallet; the last one (`children`) sits in the layout, the others float above it
  const cards: {label: string; node: ReactNode}[] = [
    ...OTHERS.map(o => ({label: `Show your ${o.label} card`, node: <OtherCard {...o} hidden={hidden} onToggle={toggle} />})),
    {label: "Show your bank card", node: <BankCard ctx={ctx} c={c} hidden={hidden} onToggle={toggle} />},
    {label, node: children},
  ];
  const last = cards.length - 1, top = lift(last);
  const [order, setOrder] = useState(() => startOrder(cards.length));
  const up = order[0];
  const slot = (i: number) => last - order.indexOf(i);
  const y = (k: number) => top - lift(last - k); // a slot's distance from the top of the stack
  // each card's height once laid out: a bank card out in front makes the stack taller than the front it stands in for
  const [hs, setHs] = useState(() => cards.map(() => 0));
  const measure = (i: number, h: number) => setHs(was => was[i] === h ? was : was.map((x, j) => j === i ? h : x));
  const reduced = useReducedMotion();
  // where each card's top is, and how much taller than the usual front the stack is; all on the JS driver, since the clips are sizes
  const [ps] = useState(() => cards.map((_, i) => new Animated.Value(y(i))));
  const [grow] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const go = (v: Animated.Value, to: number) => reduced ? v.setValue(to)
      : Animated.timing(v, {toValue: to, duration: 500, easing: SWAP_EASE, useNativeDriver: false}).start();
    ps.forEach((v, i) => go(v, y(slot(i))));
    go(grow, Math.max(0, hs[up] - hs[last]));
  }, [order.join(), hs.join(), reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  const behindTop = y(last - 1);
  return (
    <View style={[{paddingTop: top}, style]}>
      {cards.map((card, i) => {
        const face = (
          <View onLayout={e => measure(i, e.nativeEvent.layout.height)}>
            <Behind behind={i !== up} label={card.label} onPress={() => setOrder(o => i === last ? bringToFront(o, i) : bringOut(o, i, last))} eye={i < last}>{card.node}</Behind>
          </View>
        );
        // the front: it's never taller than a bank card, so out in front one covers all of it but its top
        if (i === last) return (
          <Animated.View key={card.label} style={{zIndex: slot(i) + 1, transform: [{translateY: Animated.add(ps[i], -top)}]}}>{face}</Animated.View>
        );
        // a bank card: behind, it's cut off a little under the front's top; coming out, the cut slides down to its full height
        const clip = ps[i].interpolate({inputRange: [0, behindTop, top], outputRange: [SHADOW + top + TUCK, SHADOW + top + TUCK - behindTop, hs[i] + 2 * SHADOW], extrapolate: "clamp"});
        return (
          <Animated.View key={card.label} pointerEvents="box-none"
            style={{position: "absolute", top: -SHADOW, left: -SHADOW, right: -SHADOW, padding: SHADOW, height: clip, overflow: "hidden", zIndex: slot(i) + 1, transform: [{translateY: ps[i]}]}}>
            {face}
          </Animated.View>
        );
      })}
      <Animated.View style={{height: grow}} />
    </View>
  );
}

// Home's cards as drawn hanging from the very top of the screen: each one's sides, where its bottom edge is (before the tilt), and its tilt.
// Tucked up, one card hangs (HANG[0]); the rest wait just off the top of the screen (ABOVE) and come down into the fan when they're out.
// HANG[0] also sets a card's size out.
type Hang = {left: number; right: number; bottom: number; tilt: number};
const HANG: readonly Hang[] = [{left: 31.5, right: 36.5, bottom: 92, tilt: 0}, {left: 41, right: 27, bottom: 54, tilt: 7}];
const ABOVE: Hang = {left: 41, right: 27, bottom: -48, tilt: 7};
// For now no card hangs: tucked up, they all wait above the screen and only the handle shows. True brings your bank card back down.
const HANGS: boolean = false;
/** How far down Home's page the cards reach. */
export const PEEK_DEPTH = HANG[0].bottom;
// tucked up, the handle sits just under the hanging card
const GRAB_TOP = PEEK_DEPTH + s[4];

// Out ("Desk · cards expanded", measured at 440pt): the cards fan down the page top to bottom, your bank card last, nearest the number.
// Each one's centre from the middle of the screen, and its tilt; the first card's centre this far down the screen, the next ones STEP below.
const SPREAD = [{dx: -19, tilt: -12}, {dx: 16, tilt: 3}, {dx: -10, tilt: -2}] as const;
const SPREAD_TOP = 210, STEP = 144;
// "+ Add an account" this far under the last card, this tall; the handle this far under it
const ADD_GAP = s[3], ADD_H = 37, GRAB_GAP = 92;
// the cup of coffee out on the desk: how big its canvas is (the cup about 150pt across), and where the cup's middle sits with the cards
// out (clear of the header, half off the left edge)
const MUG = 240, MUG_AT = {x: 24, y: 165};
// out, a drag up past this share of the way, or flicked up, tucks them back
const CLOSE_AT = 0.2;
const OPEN_SPRING = {damping: 20, stiffness: 180, mass: 1, useNativeDriver: false} as const;
/** When the balances were last updated: the time today, or the day. */
function updatedAt(ctx: Ctx, c: Calc) {
  const synced = allBanks(ctx.state).map(b => Date.parse(b.asOf));
  const at = synced.length ? new Date(Math.max(...synced)) : ctx.state.balanceSetAt ? new Date(ctx.state.balanceSetAt) : null;
  return !at ? niceDate(ctx.state.balanceAsOf || c.t)
    : isoD(at) === c.t ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : niceDate(isoD(at));
}

/** Home's bank cards (the minimal design): out of sight above the top of the screen until the page is pulled down (or the handle tapped,
 *  `open`), each with its balance (to the penny, as a bank shows it) and name, a little askew. The eye works as on the wallet; the card
 *  that isn't connected has no eye, as drawn, though a tap on its £0.00 still hides every balance.
 *  Out, they fan down the page to show every account, the total above them,
 *  and the page below moves down to make room. Out, tap a card and it swaps places with the top one. Drag up (the cards follow the
 *  finger) or tap the handle to tuck them back.
 *  It takes up the page down to where the number starts (`top`), so nothing below sits over the cards. */
export function CardPeek({ctx, c, top, open, setOpen}: {ctx: Ctx; c: Calc; top: number; open: boolean; setOpen: (open: boolean) => void}) {
  const hidden = useHidden(s => s.hidden), toggle = useHidden(s => s.toggle);
  const {c: theme} = useTheme();
  const {width} = useWindowDimensions();
  const reduced = useReducedMotion();
  // each bank linked through Open Banking shows everything in it; the Monzo card has the rest, with payments logged since the sync.
  // Linked banks take the placeholders' spots, so there are always as many cards (their rows are kept from the first render)
  const linked = (ctx.state.links || []).map((b, i) => {
    const bg = LINKED[i % LINKED.length];
    return {bg, ink: inkOn(bg), mark: b.source, label: b.source, said: `${b.source} balance`, amount: totalOf(b), eye: true};
  });
  const cards = [
    {bg: BANK_BG, ink: BANK_INK, mark: "monzo", label: "Monzo", said: "Monzo balance",
      amount: r2(c.balance + aside(ctx.state) - linked.reduce((a, k) => a + k.amount, 0)), eye: true},
    ...linked,
    ...OTHERS.map(o => ({bg: o.bg, ink: o.ink ?? inkOn(o.bg), mark: o.mark, label: o.label, said: `${o.label} card balance`, amount: 0, eye: false})),
  ].slice(0, SPREAD.length);
  const n = cards.length;
  const total = r2(cards.reduce((sum, k) => sum + k.amount, 0));
  // Each card has a row, 0 the top one (in front) to n − 1 the bottom; at first your bank card (the first) is at the bottom, as drawn.
  // A row has a spot out (the fan down the page) and a spot hanging (the last two rows hang, the rest wait above the screen);
  // both are the card's centre and tilt.
  const out = (row: number) => {
    const at = SPREAD[row === 0 ? 0 : SPREAD.length - n + row];
    return {dx: at.dx, cy: SPREAD_TOP + row * STEP, tilt: at.tilt};
  };
  // tucked up, every card waits just above the top of the screen, out of sight until the page is pulled down
  const cardH = (h: Hang) => (width - h.left - h.right) / 1.586;
  const hung = {dx: (ABOVE.left - ABOVE.right) / 2, cy: ABOVE.bottom - cardH(ABOVE) / 2, tilt: ABOVE.tilt};
  // except the bottom one (your bank card at first), which hangs from the top of the screen, its balance showing (not for now: `HANGS`)
  const hangs = {dx: (HANG[0].left - HANG[0].right) / 2, cy: HANG[0].bottom - cardH(HANG[0]) / 2, tilt: HANG[0].tilt};
  const tuck = (row: number) => HANGS && row === n - 1 ? hangs : hung;
  // the cup of coffee travels as the top card out does
  const mugDx = out(0).dx - hung.dx, mugDy = out(0).cy - hung.cy;
  const addTop = out(n - 1).cy + cardH(HANG[0]) / 2 + ADD_GAP;

  // Out, tap a card and it swaps places with the top one (tap the top one and it swaps with the one under it). The card coming
  // forward is in front from the tap, so it slides over the other. The order stays when they're tucked back up.
  const [rows, setRows] = useState(() => cards.map((_, i) => n - 1 - i));
  const [rowVs] = useState(() => rows.map(r => new Animated.Value(r)));
  const swap = (i: number) => setRows(was => {
    const j = was.indexOf(was[i] === 0 ? 1 : 0);
    return was.map((r, k) => k === i ? was[j] : k === j ? was[i] : r);
  });
  useEffect(() => {
    rowVs.forEach((v, i) => reduced ? v.setValue(rows[i])
      : Animated.timing(v, {toValue: rows[i], duration: 500, easing: SWAP_EASE, useNativeDriver: false}).start());
  }, [rows.join(), reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  // a card's spot as it moves between rows
  const rowRange = rows.map((_, r) => r);
  const along = (v: Animated.Value, of: (row: number) => number) =>
    n === 1 ? new Animated.Value(of(0)) : v.interpolate({inputRange: rowRange, outputRange: rowRange.map(of)});
  // how far the page below moves down when they're out
  const grabTop = GRAB_TOP, shift = addTop + ADD_H + GRAB_GAP - grabTop;

  // 0 tucked up, 1 out. The header, "Add an account" and the handle's line stay drawn until they've faded on the way back
  const [o] = useState(() => new Animated.Value(0));
  const [lingering, setLingering] = useState(false);
  if (open && !lingering) setLingering(true);
  const shown = open || (lingering && !reduced);
  useEffect(() => {
    const to = open ? 1 : 0;
    if (reduced) o.setValue(to);
    else Animated.spring(o, {toValue: to, ...OPEN_SPRING}).start(({finished}) => { if (finished && !open) setLingering(false); });
  }, [open, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  // out, a drag up anywhere on them follows the finger, and lets go open or closed
  const drag = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => open && Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => o.setValue(Math.min(1, Math.max(0, 1 + g.dy / shift))),
    onPanResponderRelease: (_, g) => {
      if (g.dy < -shift * CLOSE_AT || g.vy < -0.5) setOpen(false);
      else Animated.spring(o, {toValue: 1, ...OPEN_SPRING}).start();
    },
    onPanResponderTerminate: () => Animated.spring(o, {toValue: 1, ...OPEN_SPRING}).start(),
  }), [open, shift, setOpen, o]);
  const fade = o.interpolate({inputRange: [0.4, 1], outputRange: [0, 1], extrapolate: "clamp"});

  return (
    <Animated.View style={{height: Animated.add(top, Animated.multiply(o, shift)), zIndex: 1}} {...drag.panHandlers}>
      {shown ? (
        <Animated.View style={[styles.accountsHead, {opacity: fade}]}>
          <T size="homeSmall" weight="medium" muted style={{textTransform: "uppercase", letterSpacing: 1.82}}>{n === 1 ? "1 account" : `${n} accounts`}</T>
          <T size="homeSmall" weight="semibold" style={{color: "#FFFFFF", fontVariant: ["tabular-nums"]}}>{hidden ? "Balances hidden" : `${moneyExact(total)} in total`}</T>
        </Animated.View>
      ) : null}
      {cards.map((k, i) => {
        // laid out where it waits above the screen; from there it moves to its row's spot out (between them by `o`)
        const h = ABOVE, base = hung;
        // waiting above the screen: not there for a screen reader either (the handle is)
        const away = !open;
        const spot = (of: (s: {dx: number; cy: number; tilt: number}) => number) => {
          const tucked = along(rowVs[i], r => of(tuck(r))), spread = along(rowVs[i], r => of(out(r)));
          return Animated.add(tucked, Animated.multiply(o, Animated.subtract(spread, tucked)));
        };
        return (
          <Animated.View key={k.label} accessibilityElementsHidden={away} importantForAccessibility={away ? "no-hide-descendants" : "auto"}
            style={[styles.hanging, {left: h.left, right: h.right, top: h.bottom - cardH(h), zIndex: n - 1 - rows[i], backgroundColor: k.bg, transform: [
            {translateX: Animated.subtract(spot(s => s.dx), base.dx)},
            {translateY: Animated.subtract(spot(s => s.cy), base.cy)},
            {rotate: spot(s => s.tilt).interpolate({inputRange: [-360, 360], outputRange: ["-360deg", "360deg"]})},
          ]}]}>
            {/* tucked up, the whole card brings them out; out, it swaps places. The balance inside still only hides balances.
                Not a screen reader stop: the handle is, and the order is only how they look */}
            <Pressable onPress={() => open ? swap(i) : setOpen(true)} accessible={false} style={styles.hangingTap}>
              <View style={styles.markRow}>
                {/* in its own box: the button keeps to the top of whatever holds it, and the top of a hanging card is off the screen */}
                <View><BalanceButton amount={k.amount} exact eye={k.eye} ink={k.ink} hidden={hidden} onToggle={toggle} label={k.said} /></View>
                <CardMark mark={k.mark} label={k.label} ink={k.ink} />
              </View>
            </Pressable>
          </Animated.View>
        );
      })}
      {/* a cup of coffee on the desk, at the top card's empty corner, over the edge of the screen. It comes down with the top card,
          all there from the start (tucked up, it's above the top of the screen), and goes back up with it */}
      {shown ? (
        <Animated.View pointerEvents="none" style={[styles.mug, {transform: [
          {translateX: o.interpolate({inputRange: [0, 1], outputRange: [-mugDx, 0]})},
          {translateY: o.interpolate({inputRange: [0, 1], outputRange: [-mugDy, 0]})},
        ]}]}>
          <Mug size={MUG} />
        </Animated.View>
      ) : null}
      {shown && banksOn ? (
        <Animated.View style={{position: "absolute", top: addTop, left: s[6], opacity: fade}}>
          <Pressable onPress={() => router.push("/link-bank")} accessibilityRole="button"
            style={[styles.addAccount, {borderColor: theme.line}]}>
            <Icon name="plus" color={theme.ink} size={16} />
            <T size="homeSmall" weight="medium">Add an account</T>
          </Pressable>
        </Animated.View>
      ) : null}
      {/* the handle under the cards: tap it (or pull the page) to see every account, tap again to tuck them back */}
      <Animated.View style={[styles.grab, {top: grabTop, transform: [{translateY: Animated.multiply(o, shift)}]}]}>
        <Pressable onPress={() => setOpen(!open)} hitSlop={{top: s[4], bottom: s[4], left: s[7], right: s[7]}} accessibilityRole="button"
          accessibilityLabel={open ? "Tuck your accounts away" : "Show all your accounts"} style={{alignItems: "center", gap: s[2]}}>
          <View style={[styles.grabber, {backgroundColor: theme.line}]} />
          {shown ? (
            <Animated.View style={{opacity: fade}}>
              <T size="xs" muted style={{fontVariant: ["tabular-nums"]}}>{`Updated ${updatedAt(ctx, c)} · Drag up to close`}</T>
            </Animated.View>
          ) : null}
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

/** Another account's card, on top of the stack. Not linked yet, so its balance is £0 for now. */
function OtherCard({bg, ink: set, mark, label, hidden, onToggle}: {bg: string; ink?: string; mark: string; label: string; hidden: boolean; onToggle: () => void}) {
  const fg = set ?? inkOn(bg), ink = {color: fg};
  return (
    <View style={[styles.card, styles.otherFace, {backgroundColor: bg}]}>
      <View style={styles.markRow}>
        <View style={{flex: 1}}><BalanceButton amount={0} ink={fg} hidden={hidden} onToggle={onToggle} label={`${label} card balance`} /></View>
        <CardMark mark={mark} label={label} ink={fg} />
      </View>
      <T size="xs" weight="semibold" style={[ink, {opacity: 0.75}]}>Not connected yet</T>
    </View>
  );
}

/** True while the card around it is tucked behind. */
const IsBehind = createContext(false);

/** While a card is tucked behind, a tap on it brings it forward and screen readers hear one button instead of its contents.
 *  Its buttons wait until it's in front (they read IsBehind), and nothing in it takes a touch till then (Day 2's days to payday don't scroll or pick a day).
 *  `eye`: a bank card, whose only button is the balance eye; that one works behind too, so hiding the balance doesn't pull the card out. */
function Behind({behind, label, onPress, eye, children}: {behind: boolean; label: string; onPress: () => void; eye?: boolean; children: ReactNode}) {
  return (
    <Pressable onPress={onPress} disabled={!behind} accessible={behind}
      accessibilityRole={behind ? "button" : undefined} accessibilityLabel={behind ? label : undefined}>
      <View pointerEvents={behind && !eye ? "none" : "auto"} accessibilityElementsHidden={behind} importantForAccessibility={behind ? "no-hide-descendants" : "auto"}>
        <IsBehind.Provider value={behind}>{children}</IsBehind.Provider>
      </View>
    </Pressable>
  );
}

/** The bank account behind the number: what's in it, what's set aside, and when it was last updated. */
function BankCard({ctx, c, hidden, onToggle}: {ctx: Ctx; c: Calc; hidden: boolean; onToggle: () => void}) {
  const bank = ctx.state.bank;
  const updated = updatedAt(ctx, c);
  const ink = {color: BANK_INK};
  const item = (k: string, v: string, num = false) => (
    <View style={{gap: 2}}>
      <T size="xs" weight="semibold" style={[ink, {opacity: 0.75}]}>{k}</T>
      <T weight="bold" style={[ink, num && {fontVariant: ["tabular-nums"]}]}>{v}</T>
    </View>
  );
  return (
    <View style={[styles.card, styles.bankFace]}>
      <View style={styles.markRow}>
        <View style={{flex: 1}}><BalanceButton amount={r2(c.balance + aside(ctx.state))} ink={BANK_INK} hidden={hidden} onToggle={onToggle} label="Monzo balance" /></View>
        <CardMark mark="monzo" label="Monzo" ink={BANK_INK} />
      </View>
      <View style={{flexDirection: "row", flexWrap: "wrap", columnGap: s[5], rowGap: s[2]}}>
        {bank ? item("Spending money", money(c.balance), true) : null}
        {bank ? item("Set aside", money(aside(ctx.state)), true) : null}
        {item("Updated", updated)}
      </View>
    </View>
  );
}

/** A bank card's name, as drawn (the S20 design): Inter ExtraBold, lowercase, on the balance's baseline (the card's `markRow`).
 *  On Today it's Hanken Grotesk, a size up, as drawn there. */
function CardMark({mark, label, ink}: {mark: string; label: string; ink: string}) {
  const {hanken} = useTheme();
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      <T size={hanken ? "homeCardName" : "cardName"} weight="display" style={{color: ink, lineHeight: 28, textTransform: "lowercase"}}>{mark}</T>
    </View>
  );
}

/** A card's balance with an eye: tap to blur the amount (for when someone's looking over your shoulder). Remembered between launches.
 *  `exact`: to the penny (£0.00), as Home's cards show it. `eye={false}`: no eye, though the tap still works. */
function BalanceButton({amount, ink, hidden, onToggle, label, exact, eye = true}: {
  amount: number; ink: string; hidden: boolean; onToggle: () => void; label: string; exact?: boolean; eye?: boolean;
}) {
  const text = exact ? moneyExact(amount) : money(amount);
  return (
    <Pressable onPress={onToggle} hitSlop={s[2]} accessibilityRole="button" accessibilityState={{selected: hidden}}
      accessibilityLabel={`${label} ${hidden ? "hidden" : text}. Tap to ${hidden ? "show" : "hide"}`}
      style={{alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: s[2]}}>
      <SoftAmount text={text} ink={ink} blurred={hidden} />
      {eye ? <Icon name={hidden ? "eye-off" : "eye"} color={ink} size={20} /> : null}
    </Pressable>
  );
}

// The web card blurs with filter: blur(7px). RN's own `filter: blur` is behind an off-by-default flag on iOS,
// so the blurred copy is drawn as SVG text through a Gaussian blur with the same standard deviation.
const BLUR = 7;
const PAD = BLUR * 3; // a Gaussian is all but gone by 3 standard deviations, so the canvas never clips the haze
// the balance as drawn (the S20 design): bold, 18 on a 22 line
const AMOUNT_PX = textSize.cardBalance, AMOUNT_LINE = 22;
// where RN puts the baseline in the line box: half the spare line height, then the face's ascent
const baseline = ({ascent, descent}: {ascent: number; descent: number}) => (AMOUNT_LINE - AMOUNT_PX * (ascent + descent)) / 2 + AMOUNT_PX * ascent;

/** The amount, sharp or blurred. Fades over .1s (a crossfade reads slower than the web's growing blur, so it runs shorter) unless Reduce Motion is on. */
function SoftAmount({text, ink, blurred}: {text: string; ink: string; blurred: boolean}) {
  const {f, hanken} = useTheme();
  const BASELINE = baseline(faceMetrics[hanken ? "hanken" : "manrope"]);
  const reduced = useReducedMotion();
  const [v] = useState(() => new Animated.Value(blurred ? 1 : 0));
  const [box, setBox] = useState({w: 0, h: 0});
  useEffect(() => {
    if (reduced) { v.setValue(blurred ? 1 : 0); return; }
    Animated.timing(v, {toValue: blurred ? 1 : 0, duration: 100, useNativeDriver: true}).start();
  }, [blurred, reduced, v]);
  const w = box.w + PAD * 2, h = box.h + PAD * 2;
  return (
    <View>
      <Animated.View style={{opacity: v.interpolate({inputRange: [0, 1], outputRange: [1, 0]})}}
        onLayout={e => setBox({w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height})}>
        <T size="cardBalance" weight="bold" style={{color: ink, fontVariant: ["tabular-nums"], lineHeight: AMOUNT_LINE}}>{text}</T>
      </Animated.View>
      {box.w > 0 && (
        <Animated.View style={[styles.haze, {width: w, height: h, opacity: v}]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Svg width={w} height={h}>
            <Defs>
              <Filter id="balBlur" filterUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
                <FeGaussianBlur stdDeviation={BLUR} />
              </Filter>
            </Defs>
            <SvgText x={PAD} y={PAD + BASELINE} fill={ink} fontFamily={f.bold} fontSize={AMOUNT_PX} filter="url(#balBlur)">{text}</SvgText>
          </Svg>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  haze: {position: "absolute", left: -PAD, top: -PAD},
  // a payment card's proportions (85.6 × 54 mm)
  bank: {position: "absolute", left: 0, right: 0, top: 0},
  bankFace: {backgroundColor: BANK_BG, boxShadow: "0 6px 16px rgba(0,0,0,0.18)"},
  otherFace: {boxShadow: "0 6px 16px rgba(0,0,0,0.18)"},
  card: {aspectRatio: 1.586, borderRadius: radius.bankCard, paddingTop: s[4], paddingLeft: s[5], paddingRight: MARK_INSET, paddingBottom: s[5], justifyContent: "space-between"},
  // a card's balance and name, sharing a baseline
  markRow: {flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: s[3]},
  // clear of the tilted cards' lowest corner
  grab: {position: "absolute", left: 0, right: 0, alignItems: "center"},
  grabber: {width: 36, height: 5, borderRadius: 2.5},
  // "3 accounts" and the total, above the cards out, and in front of them (the top card's corner reaches up behind the total)
  accountsHead: {position: "absolute", top: 64, left: s[6], right: s[6], zIndex: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "baseline"},
  mug: {position: "absolute", left: MUG_AT.x - MUG / 2, top: MUG_AT.y - MUG / 2, zIndex: 5},
  addAccount: {flexDirection: "row", alignItems: "center", gap: s[2], height: ADD_H, paddingHorizontal: s[4], borderRadius: radius.pill, borderWidth: 1.5, borderStyle: "dashed"},
  // the balance and name sit lower and further out on Today's cards than on the wallet's, as drawn
  hanging: {position: "absolute", aspectRatio: 1.586, borderRadius: radius.bankCard, boxShadow: "0 2px 4px rgba(0,0,0,0.10), 0 14px 28px rgba(0,0,0,0.18)"},
  // the whole card is the tap, its balance and name at the bottom
  hangingTap: {flex: 1, justifyContent: "flex-end", paddingLeft: 21, paddingRight: MARK_INSET, paddingBottom: 11},
});
