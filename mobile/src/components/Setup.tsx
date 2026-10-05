import {useEffect, useState, type ReactNode} from "react";
import {Animated, Dimensions, Easing, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type TextInputProps} from "react-native";
import {SafeAreaView, useSafeAreaInsets} from "react-native-safe-area-context";
import {font, radius, s, textSize, type TextSize} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {useReducedMotion} from "./BigMoney";
import {Icon} from "./Icon";
import {Button, T} from "./ui";

/**
 * How much of the screen the keyboard really covers. Not its height: with a hardware keyboard (the simulator's, or one paired
 * with the phone) iOS still reports the whole number pad, parked below the screen, and only a small bar shows.
 */
export const keyboardCover = (k: {screenY: number; height: number}) => Math.max(0, Math.min(k.height, Dimensions.get("window").height - k.screenY));

// The number pad's height: a close guess until it has opened once, then the real one.
// The question is centred above this space from the first frame, so it never moves when the keyboard opens.
let keyboardHeight = 0;
Keyboard.addListener("keyboardDidShow", e => { keyboardHeight = keyboardCover(e.endCoordinates); });
const BUTTON_AREA = 124;   // the button, the quiet link under it, and their padding

/**
 * Lifts the button with the keyboard, in step with it, so Continue is always tappable without pressing Done.
 * iOS only: Android resizes the window for the keyboard itself.
 */
export function useKeyboardLift(bottomInset: number, reduced: boolean) {
  const [lift] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const move = (to: number, duration = 250) => {
      if (reduced) return lift.setValue(to);
      Animated.timing(lift, {toValue: to, duration, easing: Easing.bezier(0.17, 0.59, 0.4, 0.77), useNativeDriver: true}).start();
    };
    // up by what the keyboard covers above the home indicator; nothing when it covers less
    const to = (k: {screenY: number; height: number}) => -Math.max(0, keyboardCover(k) - bottomInset);
    const show = Keyboard.addListener("keyboardWillShow", e => move(to(e.endCoordinates), e.duration));
    const hide = Keyboard.addListener("keyboardWillHide", e => move(0, e.duration));
    if (Keyboard.isVisible()) { const m = Keyboard.metrics(); if (m) lift.setValue(to(m)); }
    return () => { show.remove(); hide.remove(); };
  }, [lift, bottomInset, reduced]);
  return lift;
}

/**
 * One setup page: progress, one bold question, one line on why, the answer, then the button.
 * The eye reads straight down; the button only lights up once the answer is there.
 * `scroll` is for answers that grow (a list of bills): they start at the top and scroll above the button.
 */
export function StepShell({step, total, title, why, onBack, children, cta, ctaKind = "primary", onNext, canNext, error, footer, keyboard = true, scroll = false}: {
  step: number; total: number; title: string; why?: string; onBack?: () => void; children: ReactNode;
  cta: string; ctaKind?: "primary" | "good"; onNext: () => void; canNext: boolean; error?: string; footer?: ReactNode; keyboard?: boolean; scroll?: boolean;
}) {
  const {c} = useTheme();
  const {height} = useWindowDimensions(), insets = useSafeAreaInsets();
  const [kb] = useState(() => keyboardHeight || Math.round(height * 0.345));
  const reserve = (keyboard ? kb - insets.bottom : 0) + BUTTON_AREA;
  const reduced = useReducedMotion();
  const lift = useKeyboardLift(insets.bottom, reduced);
  const [fade] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced) { fade.setValue(1); return; }
    fade.setValue(0);
    Animated.timing(fade, {toValue: 1, duration: 200, useNativeDriver: true}).start();
  }, [step, reduced, fade]);

  return (
    <SafeAreaView style={{flex: 1, backgroundColor: c.bg}}>
      <View style={{flexDirection: "row", alignItems: "center", gap: s[3], paddingHorizontal: s[3], height: 48}}>
        <View style={{width: 40}}>
          {onBack ? (
            <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8}
              style={({pressed}) => ({width: 40, height: 40, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1})}>
              <Icon name="back" color={c.ink} size={22} />
            </Pressable>
          ) : null}
        </View>
        <View style={{flex: 1, flexDirection: "row", gap: s[1]}} accessible accessibilityLabel={`Step ${step + 1} of ${total}`}>
          {Array.from({length: total}, (_, i) => (
            <View key={i} style={{flex: 1, height: 4, borderRadius: radius.pill, backgroundColor: i <= step ? c.ink : c.line}} />
          ))}
        </View>
        <View style={{width: 40}} />
      </View>

      <View style={{flex: 1}}>
        {/* Fade only: the question stays exactly where it is */}
        {scroll ? (
          <Animated.View style={{flex: 1, marginBottom: reserve, opacity: fade}}>
            <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
              contentContainerStyle={{paddingHorizontal: s[5], paddingTop: s[5], paddingBottom: s[5], gap: s[6]}}>
              <Question title={title} why={why} />
              {children}
            </ScrollView>
          </Animated.View>
        ) : (
          <Animated.View style={{flex: 1, justifyContent: "center", paddingHorizontal: s[5], paddingBottom: reserve, gap: s[6], opacity: fade}}>
            <Question title={title} why={why} />
            {children}
          </Animated.View>
        )}

        {/* Only the button rides up with the keyboard */}
        <Animated.View style={{position: "absolute", left: 0, right: 0, bottom: 0, transform: [{translateY: lift}],
          paddingHorizontal: s[5], paddingBottom: s[4], paddingTop: s[3], gap: s[3], backgroundColor: c.bg}}>
          {error ? <View accessibilityLiveRegion="assertive"><T weight="semibold" size="sm">{error}</T></View> : null}
          <Button label={cta} kind={ctaKind} onPress={onNext} disabled={!canNext} />
          {footer}
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

/** The bold question and its one line on why. A setup sheet's title looks the same. */
export function Question({title, why}: {title: string; why?: string}) {
  return (
    <View style={{gap: s[2]}}>
      <View accessible accessibilityRole="header"><T weight="heavy" size="xl" style={{letterSpacing: -0.6}}>{title}</T></View>
      {why ? <T muted>{why}</T> : null}
    </View>
  );
}

/**
 * A big borderless £ amount: it looks like the number it becomes, not a form field.
 * Money is in the accent family (`good` stays readable on white), so the app is recognisable from the first page.
 */
export function AmountInput({prefix = "£", caption, size = "xl", isMoney = true, ...props}: TextInputProps & {prefix?: string; caption?: ReactNode; size?: TextSize; isMoney?: boolean}) {
  const {c} = useTheme();
  const tint = isMoney ? c.good : c.ink;
  const [focused, setFocused] = useState(false);
  const filled = !!props.value;
  const px = textSize[size];
  const big = {fontFamily: font.heavy, fontSize: px, letterSpacing: -px / 40, fontVariant: ["tabular-nums" as const]};
  return (
    <View style={{gap: s[2]}}>
      <View style={{flexDirection: "row", alignItems: "center", gap: s[1], borderBottomWidth: 2, borderBottomColor: focused ? tint : c.line, paddingBottom: s[2]}}>
        {prefix ? <Text style={[big, {color: filled ? tint : c.muted}]}>{prefix}</Text> : null}
        <TextInput keyboardType="decimal-pad" placeholder="0" placeholderTextColor={c.line} selectionColor={tint} cursorColor={tint} autoFocus returnKeyType="done"
          {...props}
          onFocus={e => { setFocused(true); props.onFocus?.(e); }} onBlur={e => { setFocused(false); props.onBlur?.(e); }}
          style={[big, {flex: 1, color: tint, padding: 0}]} />
      </View>
      {caption ? <T muted size="sm">{caption}</T> : null}
    </View>
  );
}

/**
 * A name, an optional line under it, and an amount typed in place on the right: a subscription a month, an everyday budget.
 * The amount is money that's yours to use, so it's in the accent.
 */
export function AmountRow({name, meta, value, autoFocus, onChange, accessibilityLabel}: {
  name: string; meta?: string; value: string; autoFocus?: boolean; onChange: (v: string) => void; accessibilityLabel: string;
}) {
  const {c} = useTheme();
  const text = {fontFamily: font.bold, fontSize: textSize.md, fontVariant: ["tabular-nums" as const]};
  return (
    <View style={{flexDirection: "row", alignItems: "center", gap: s[3], minHeight: 52, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line}}>
      <View style={{flex: 1, gap: 2, paddingVertical: meta ? s[3] : 0}}>
        <T weight="semibold" lines={1}>{name}</T>
        {meta ? <T muted size="sm" lines={1}>{meta}</T> : null}
      </View>
      <View style={{flexDirection: "row", alignItems: "center"}}>
        <Text style={[text, {color: value ? c.good : c.muted}]}>£</Text>
        <TextInput value={value} onChangeText={onChange} autoFocus={autoFocus} keyboardType="decimal-pad" returnKeyType="done"
          placeholder="0.00" placeholderTextColor={c.line} selectionColor={c.good} cursorColor={c.good} accessibilityLabel={accessibilityLabel}
          style={[text, {color: c.good, minWidth: 56, textAlign: "right", paddingVertical: s[3], paddingHorizontal: 0}]} />
      </View>
    </View>
  );
}

/** A quiet text link under the main button, for the way out. */
export function TextLink({label, onPress}: {label: string; onPress: () => void}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8} style={({pressed}) => ({alignSelf: "center", padding: s[2], opacity: pressed ? 0.5 : 1})}>
      <T weight="semibold" size="sm" muted>{label}</T>
    </Pressable>
  );
}
