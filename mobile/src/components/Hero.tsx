import {router} from "expo-router";
import {useEffect, useState} from "react";
import Storage from "expo-sqlite/kv-store";
import {Animated, Pressable, StyleSheet, View} from "react-native";
import Svg, {Defs, FeGaussianBlur, Filter, Text as SvgText} from "react-native-svg";
import {hero, type Calc} from "@/lib/calc";
import {money} from "@/lib/money";
import type {Ctx} from "@/lib/types";
import {font, radius, s, textSize} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
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
    <View style={[styles.card, {backgroundColor: theme.accent}]}>
      <BalanceButton amount={c.balance} ink={theme.accentInk} />
      <View accessible accessibilityRole="summary" accessibilityLabel={`Safe to spend today, ${money(h.perDay)}. ${h.reason}`}>
        <T size="sm" weight="bold" style={[on, {opacity: 0.7}]}>Safe to spend today</T>
        <View style={{height: s[2]}} />
        <BigMoney value={h.perDay} color={theme.accentInk} />
        <View style={{height: s[5]}} />
        <T lines={1} fit style={[on, {opacity: 0.85}]}>{h.reason}</T>
      </View>
    </View>
  );
}

const HIDE_KEY = "hideBalance";
function readHidden() { try { return Storage.getItemSync(HIDE_KEY) === "1"; } catch { return false; } }

/** "Total balance" with an eye: tap to blur the amount (for when someone's looking over your shoulder). Remembered between launches. */
function BalanceButton({amount, ink}: {amount: number; ink: string}) {
  const [hidden, setHidden] = useState(readHidden);
  const toggle = () => {
    const next = !hidden;
    setHidden(next);
    try { Storage.setItemSync(HIDE_KEY, next ? "1" : "0"); } catch {}
  };
  return (
    <Pressable onPress={toggle} hitSlop={s[2]} accessibilityRole="button" accessibilityState={{selected: hidden}}
      accessibilityLabel={`Total balance ${hidden ? "hidden" : money(amount)}. Tap to ${hidden ? "show" : "hide"}`}
      style={{alignSelf: "flex-start", gap: 2}}>
      <View style={{flexDirection: "row", alignItems: "center", gap: 6, opacity: 0.75}}>
        <T size="xs" weight="semibold" style={{color: ink}}>Total balance</T>
        <Icon name={hidden ? "eye-off" : "eye"} color={ink} size={16} />
      </View>
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
  card: {aspectRatio: 1.586, borderRadius: radius.bankCard, paddingTop: s[4], paddingHorizontal: s[5], paddingBottom: s[5], justifyContent: "space-between"},
});
