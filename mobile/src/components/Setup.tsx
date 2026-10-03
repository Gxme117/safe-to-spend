import {useEffect, useState, type ReactNode} from "react";
import {Animated, Easing, Keyboard, Platform, Pressable, Text, TextInput, useWindowDimensions, View, type TextInputProps} from "react-native";
import {SafeAreaView, useSafeAreaInsets} from "react-native-safe-area-context";
import {font, radius, s, textSize, type TextSize} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {useReducedMotion} from "./BigMoney";
import {Icon} from "./Icon";
import {Button, T} from "./ui";

// The number pad's height: a close guess until it has opened once, then the real one.
// The question is centred above this space from the first frame, so it never moves when the keyboard opens.
let keyboardHeight = 0;
Keyboard.addListener("keyboardDidShow", e => { keyboardHeight = e.endCoordinates.height; });
const BUTTON_AREA = 124;   // the button, the quiet link under it, and their padding

/**
 * Lifts the button with the keyboard, in step with it, so Continue is always tappable without pressing Done.
 * iOS only: Android resizes the window for the keyboard itself.
 */
function useKeyboardLift(bottomInset: number, reduced: boolean) {
  const [lift] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const move = (to: number, duration = 250) => {
      if (reduced) return lift.setValue(to);
      Animated.timing(lift, {toValue: to, duration, easing: Easing.bezier(0.17, 0.59, 0.4, 0.77), useNativeDriver: true}).start();
    };
    const show = Keyboard.addListener("keyboardWillShow", e => move(-(e.endCoordinates.height - bottomInset), e.duration));
    const hide = Keyboard.addListener("keyboardWillHide", e => move(0, e.duration));
    if (Keyboard.isVisible()) { const m = Keyboard.metrics(); if (m) lift.setValue(-(m.height - bottomInset)); }
    return () => { show.remove(); hide.remove(); };
  }, [lift, bottomInset, reduced]);
  return lift;
}

/**
 * One setup page: progress, one bold question, one line on why, the answer, then the button.
 * The eye reads straight down; the button only lights up once the answer is there.
 */
export function StepShell({step, total, title, why, onBack, children, cta, ctaKind = "primary", onNext, canNext, error, footer, keyboard = true}: {
  step: number; total: number; title: string; why: string; onBack?: () => void; children: ReactNode;
  cta: string; ctaKind?: "primary" | "good"; onNext: () => void; canNext: boolean; error?: string; footer?: ReactNode; keyboard?: boolean;
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
        <Animated.View style={{flex: 1, justifyContent: "center", paddingHorizontal: s[5], paddingBottom: reserve, gap: s[6], opacity: fade}}>
          <View style={{gap: s[2]}}>
            <View accessible accessibilityRole="header"><T weight="heavy" size="xl" style={{letterSpacing: -0.6}}>{title}</T></View>
            <T muted>{why}</T>
          </View>
          {children}
        </Animated.View>

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

/**
 * A big borderless £ amount: it looks like the number it becomes, not a form field.
 * Money is in the accent family (`good` stays readable on white), so the app is recognisable from the first page.
 */
export function AmountInput({prefix = "£", caption, size = "xl", isMoney = true, ...props}: TextInputProps & {prefix?: string; caption?: string; size?: TextSize; isMoney?: boolean}) {
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

/** A quiet text link under the main button, for the way out. */
export function TextLink({label, onPress}: {label: string; onPress: () => void}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8} style={({pressed}) => ({alignSelf: "center", padding: s[2], opacity: pressed ? 0.5 : 1})}>
      <T weight="semibold" size="sm" muted>{label}</T>
    </Pressable>
  );
}
