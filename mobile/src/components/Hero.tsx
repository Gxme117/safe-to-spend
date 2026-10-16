import {router} from "expo-router";
import {createContext, useContext, useEffect, useRef, useState, type ReactNode} from "react";
import {GlassView} from "expo-glass-effect";
import Storage from "expo-sqlite/kv-store";
import {Animated, Easing, Pressable, StyleSheet, View, type StyleProp, type ViewStyle} from "react-native";
import Svg, {Defs, FeGaussianBlur, Filter, Text as SvgText} from "react-native-svg";
import {create} from "zustand";
import {moneyBar, type Calc} from "@/lib/calc";
import type {DayView} from "@/lib/day";
import {isoD, niceDate, pad} from "@/lib/dates";
import {money, r2} from "@/lib/money";
import {aside} from "@/lib/monzo";
import {bringOut, bringToFront, startOrder} from "@/lib/stack";
import type {Ctx} from "@/lib/types";
import {useMoney} from "@/store/useMoney";
import {deepen, inkOn} from "@/theme/color";
import {GLASS} from "@/theme/glass";
import {font, radius, s, textSize} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {BigMoney, useReducedMotion} from "./BigMoney";
import {Icon} from "./Icon";
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
      <MoneyBar c={c} savings={aside(ctx.state.bank)} />
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

/** A thin bar under today's card: what's bills, everyday, savings and free. With the balance hidden, the key keeps its names but not the amounts. */
function MoneyBar({c, savings}: {c: Calc; savings: number}) {
  const {c: theme} = useTheme();
  const hidden = useHidden(st => st.hidden);
  const parts = moneyBar(c, savings);
  const colour = {bills: theme.splitBills, everyday: theme.splitEveryday, savings: theme.splitSavings, free: theme.accent};
  const sum = parts.reduce((a, p) => a + p.amount, 0);
  if (!sum) return null;
  return (
    <View style={{gap: s[2]}}>
      <View accessible accessibilityRole="image" accessibilityLabel={hidden ? "Bills, everyday, savings and free" : parts.map(p => `${p.label} ${money(p.amount)}`).join(", ")}
        style={{flexDirection: "row", gap: 2, height: 6, borderRadius: 3, overflow: "hidden"}}>
        {parts.filter(p => p.amount > 0).map(p => <View key={p.key} style={{flex: p.amount / sum, minWidth: 3, backgroundColor: colour[p.key]}} />)}
      </View>
      <View style={{flexDirection: "row", flexWrap: "wrap", rowGap: s[1], columnGap: s[3]}} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {parts.map(p => (
          <View key={p.key} style={{flexDirection: "row", alignItems: "center", gap: s[1]}}>
            <View style={{width: 6, height: 6, borderRadius: 3, backgroundColor: colour[p.key]}} />
            <T muted size="xs">{p.label}</T>
            {hidden ? null : <T weight="bold" size="xs" style={{fontVariant: ["tabular-nums"]}}>{money(p.amount)}</T>}
          </View>
        ))}
      </View>
    </View>
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
const BANK_BG = "#FF4F40", BANK_INK = "#FFFFFF";

// cards for other accounts, not linked yet: a colour and a short mark each. Ink is picked for the colour.
const OTHERS = [
  // {bg: "#9FE870", mark: "WISE", label: "W"},   // off for now
  {bg: "#005EB8", mark: "CHASE", label: "C"},
];

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

/** Another account's card, on top of the stack. Not linked yet, so its balance is £0 for now. */
function OtherCard({bg, mark, label, hidden, onToggle}: {bg: string; mark: string; label: string; hidden: boolean; onToggle: () => void}) {
  const fg = inkOn(bg), ink = {color: fg};
  return (
    <View style={[styles.card, styles.otherFace, {backgroundColor: bg}]}>
      <View style={{flexDirection: "row", alignItems: "center", gap: s[3]}}>
        <View style={{flex: 1}}><BalanceButton amount={0} ink={fg} hidden={hidden} onToggle={onToggle} label={`${label} card balance`} /></View>
        <View accessible accessibilityRole="image" accessibilityLabel={label}>
          <T size="lg" weight="heavy" style={[ink, {lineHeight: textSize.lg}]}>{mark}</T>
        </View>
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
  const at = bank ? new Date(bank.asOf) : ctx.state.balanceSetAt ? new Date(ctx.state.balanceSetAt) : null;
  const updated = !at ? niceDate(ctx.state.balanceAsOf || c.t)
    : isoD(at) === c.t ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : niceDate(isoD(at));
  const ink = {color: BANK_INK};
  const item = (k: string, v: string, num = false) => (
    <View style={{gap: 2}}>
      <T size="xs" weight="semibold" style={[ink, {opacity: 0.75}]}>{k}</T>
      <T weight="bold" style={[ink, num && {fontVariant: ["tabular-nums"]}]}>{v}</T>
    </View>
  );
  return (
    <View style={[styles.card, styles.bankFace]}>
      <View style={{flexDirection: "row", alignItems: "center", gap: s[3]}}>
        <View style={{flex: 1}}><BalanceButton amount={r2(c.balance + aside(bank))} ink={BANK_INK} hidden={hidden} onToggle={onToggle} label="Monzo balance" /></View>
        <View accessible accessibilityRole="image" accessibilityLabel="Monzo">
          <T size="lg" weight="heavy" style={[ink, {lineHeight: textSize.lg}]}>monzo</T>
        </View>
      </View>
      <View style={{flexDirection: "row", flexWrap: "wrap", columnGap: s[5], rowGap: s[2]}}>
        {bank ? item("Spending money", money(c.balance), true) : null}
        {bank ? item("Set aside", money(aside(bank)), true) : null}
        {item("Updated", updated)}
      </View>
    </View>
  );
}

/** A card's balance with an eye: tap to blur the amount (for when someone's looking over your shoulder). Remembered between launches. */
function BalanceButton({amount, ink, hidden, onToggle, label}: {amount: number; ink: string; hidden: boolean; onToggle: () => void; label: string}) {
  return (
    <Pressable onPress={onToggle} hitSlop={s[2]} accessibilityRole="button" accessibilityState={{selected: hidden}}
      accessibilityLabel={`${label} ${hidden ? "hidden" : money(amount)}. Tap to ${hidden ? "show" : "hide"}`}
      style={{alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: s[2]}}>
      <SoftAmount text={money(amount)} ink={ink} blurred={hidden} />
      <View style={{opacity: 0.75}}><Icon name={hidden ? "eye-off" : "eye"} color={ink} size={18} /></View>
    </Pressable>
  );
}

// The web card blurs with filter: blur(7px). RN's own `filter: blur` is behind an off-by-default flag on iOS,
// so the blurred copy is drawn as SVG text through a Gaussian blur with the same standard deviation.
const BLUR = 7;
const PAD = BLUR * 3; // a Gaussian is all but gone by 3 standard deviations, so the canvas never clips the haze
const AMOUNT_PX = textSize.lg;
// where RN puts the baseline in a T line box: half the spare line height, then Manrope's ascent (2132/2000 em, descent 600)
const BASELINE = (Math.round(AMOUNT_PX * 1.4) - AMOUNT_PX * (2132 + 600) / 2000) / 2 + AMOUNT_PX * 2132 / 2000;

/** The amount, sharp or blurred. Fades over .1s (a crossfade reads slower than the web's growing blur, so it runs shorter) unless Reduce Motion is on. */
function SoftAmount({text, ink, blurred}: {text: string; ink: string; blurred: boolean}) {
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
        <T size="lg" weight="heavy" style={{color: ink, fontVariant: ["tabular-nums"]}}>{text}</T>
      </Animated.View>
      {box.w > 0 && (
        <Animated.View style={[styles.haze, {width: w, height: h, opacity: v}]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Svg width={w} height={h}>
            <Defs>
              <Filter id="balBlur" filterUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
                <FeGaussianBlur stdDeviation={BLUR} />
              </Filter>
            </Defs>
            <SvgText x={PAD} y={PAD + BASELINE} fill={ink} fontFamily={font.heavy} fontSize={AMOUNT_PX} filter="url(#balBlur)">{text}</SvgText>
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
  card: {aspectRatio: 1.586, borderRadius: radius.bankCard, paddingTop: s[4], paddingHorizontal: s[5], paddingBottom: s[5], justifyContent: "space-between"},
});
