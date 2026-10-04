import {router} from "expo-router";
import {createContext, useContext, useEffect, useState, type ReactNode} from "react";
import Storage from "expo-sqlite/kv-store";
import {Animated, Easing, Pressable, StyleSheet, View} from "react-native";
import Svg, {Defs, FeGaussianBlur, Filter, Text as SvgText} from "react-native-svg";
import {hero, type Calc} from "@/lib/calc";
import {isoD, niceDate, pad} from "@/lib/dates";
import {money, r2} from "@/lib/money";
import {aside} from "@/lib/monzo";
import type {Ctx} from "@/lib/types";
import {font, radius, s, textSize} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {SyncButton} from "./Bank";
import {BigMoney, useReducedMotion} from "./BigMoney";
import {Icon} from "./Icon";
import {Button, Card, T} from "./ui";

/** Today's number and why, in one line. */
export function Hero({ctx, c}: {ctx: Ctx; c: Calc}) {
  const h = hero(ctx, c);
  const {c: theme} = useTheme();
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
  const on = {color: theme.accentInk};
  return (
    <Wallet ctx={ctx} c={c} front={(hidden, toggle) => (
      <View style={[styles.card, {backgroundColor: theme.accent}]}>
        <BalanceButton amount={r2(c.balance + aside(ctx.state.bank))} ink={theme.accentInk} hidden={hidden} onToggle={toggle} label="Total balance" />
        <View accessible accessibilityRole="summary" accessibilityLabel={`Safe to spend today, ${money(h.perDay)}. ${h.reason}`}>
          <T size="sm" weight="bold" style={[on, {opacity: 0.7}]}>Safe to spend today</T>
          <View style={{height: s[2]}} />
          <BigMoney value={h.perDay} color={theme.accentInk} />
          <View style={{height: s[5]}} />
          <T lines={1} fit style={[on, {opacity: 0.85}]}>{h.reason}</T>
        </View>
      </View>
    )} />
  );
}

const HIDE_KEY = "hideBalance";
function readHidden() { try { return Storage.getItemSync(HIDE_KEY) === "1"; } catch { return false; } }

// as on the web: the card just behind the front one peeks out 52px, and the swap runs .5s on the same curve.
// From the third card up they squeeze to a 20px strip each (still tappable), so a long stack doesn't push today's number down.
const PEEK = 52, SQUEEZE = 20;
/** How far above the front card a card `d` places behind it sits. */
const lift = (d: number) => d <= 0 ? 0 : PEEK + (d - 1) * SQUEEZE;
const SWAP_EASE = Easing.bezier(0.2, 0.75, 0.2, 1);
const BANK_BG = "#FF4F40", BANK_INK = "#FFFFFF";

const OTHER_BG = "#005EB8", OTHER_INK = "#FFFFFF";

/** Our card in front, the bank cards tucked behind (Apple Wallet style). Tap one behind to bring it forward;
 *  the rest keep their order above it. All share one hide-balance setting, so hiding on one hides on all. */
function Wallet({ctx, c, front}: {ctx: Ctx; c: Calc; front: (hidden: boolean, toggle: () => void) => ReactNode}) {
  const [hidden, setHidden] = useState(readHidden);
  const toggle = () => {
    const next = !hidden;
    setHidden(next);
    try { Storage.setItemSync(HIDE_KEY, next ? "1" : "0"); } catch {}
  };
  // cards top to bottom as they rest; the last one (ours) sits in the layout, the others float above it
  const cards: {label: string; node: ReactNode}[] = [
    {label: "Show your other card", node: <OtherCard />},
    {label: "Show your bank card", node: <BankCard ctx={ctx} c={c} hidden={hidden} onToggle={toggle} />},
    {label: "Show today's number", node: front(hidden, toggle)},
  ];
  const last = cards.length - 1;
  const [up, setUp] = useState(last);
  // the card in front takes the bottom slot; the others keep their order above it
  const slot = (i: number) => i === up ? last : i < up ? i : i - 1;
  const y = (k: number) => lift(last) - lift(last - k); // a slot's distance from the top of the stack
  const reduced = useReducedMotion();
  const [vs] = useState(() => cards.map(() => new Animated.Value(0)));
  useEffect(() => {
    vs.forEach((v, i) => {
      const to = y(slot(i)) - y(i);
      if (reduced) v.setValue(to);
      else Animated.timing(v, {toValue: to, duration: 500, easing: SWAP_EASE, useNativeDriver: true}).start();
    });
  }, [up, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={{paddingTop: lift(last)}}>
      {cards.map((card, i) => {
        const transform = i === last
          ? [{translateY: vs[i]}, {scale: vs[i].interpolate({inputRange: [-PEEK, 0], outputRange: [0.97, 1], extrapolate: "clamp"})}]
          : [{translateY: vs[i]}];
        return (
          <Animated.View key={card.label} style={[i < last && styles.bank, {top: i < last ? y(i) : undefined, zIndex: slot(i) + 1, transform}]}>
            <Behind behind={i !== up} label={card.label} onPress={() => setUp(i)}>{card.node}</Behind>
          </Animated.View>
        );
      })}
    </View>
  );
}

/** A second card, on top of the stack. Not linked to an account yet, so it shows no money. */
function OtherCard() {
  const ink = {color: OTHER_INK};
  return (
    <View style={[styles.card, styles.otherFace]}>
      <View style={{flexDirection: "row", alignItems: "center", gap: s[3]}}>
        <T weight="bold" style={[ink, {flex: 1}]}>Not connected yet</T>
        <View accessible accessibilityRole="image" accessibilityLabel="C">
          <T size="lg" weight="heavy" style={[ink, {lineHeight: textSize.lg}]}>C</T>
        </View>
      </View>
    </View>
  );
}

/** True while the card around it is tucked behind. */
const IsBehind = createContext(false);

/** While a card is tucked behind, a tap on it brings it forward and screen readers hear one button instead of its contents.
 *  Its buttons wait until it's in front (they read IsBehind), except Sync, which works straight from the peek. */
function Behind({behind, label, onPress, children}: {behind: boolean; label: string; onPress: () => void; children: ReactNode}) {
  return (
    <Pressable onPress={onPress} disabled={!behind} accessible={behind}
      accessibilityRole={behind ? "button" : undefined} accessibilityLabel={behind ? label : undefined}>
      <View accessibilityElementsHidden={behind} importantForAccessibility={behind ? "no-hide-descendants" : "auto"}>
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
        <View style={{flex: 1}}><BalanceButton amount={r2(c.balance + aside(bank))} ink={BANK_INK} hidden={hidden} onToggle={onToggle} /></View>
        <SyncButton bank={bank} ink={BANK_INK} />
        <View accessible accessibilityRole="image" accessibilityLabel="Monzo">
          <T size="lg" weight="heavy" style={[ink, {lineHeight: textSize.lg}]}>M</T>
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

/** The balance with an eye: tap to blur the amount (for when someone's looking over your shoulder). Remembered between launches.
 *  Without a label (the bank card) it's just the number, which keeps the stack compact. */
function BalanceButton({amount, ink, hidden, onToggle, label}: {amount: number; ink: string; hidden: boolean; onToggle: () => void; label?: string}) {
  const behind = useContext(IsBehind);
  return (
    <Pressable onPress={onToggle} disabled={behind} hitSlop={s[2]} accessibilityRole="button" accessibilityState={{selected: hidden}}
      accessibilityLabel={`${label ?? "Balance"} ${hidden ? "hidden" : money(amount)}. Tap to ${hidden ? "show" : "hide"}`}
      style={{alignSelf: "flex-start", gap: 2}}>
      {label && (
        <View style={{flexDirection: "row", alignItems: "center", gap: 6, opacity: 0.75}}>
          <T size="xs" weight="semibold" style={{color: ink}}>{label}</T>
          <Icon name={hidden ? "eye-off" : "eye"} color={ink} size={16} />
        </View>
      )}
      <SoftAmount text={money(amount)} ink={ink} blurred={hidden} />
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
  otherFace: {backgroundColor: OTHER_BG, boxShadow: "0 6px 16px rgba(0,0,0,0.18)"},
  card: {aspectRatio: 1.586, borderRadius: radius.bankCard, paddingTop: s[4], paddingHorizontal: s[5], paddingBottom: s[5], justifyContent: "space-between"},
});
