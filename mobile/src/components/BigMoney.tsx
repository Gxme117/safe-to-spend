import {useEffect, useRef, useState} from "react";
import {AccessibilityInfo, Text, View} from "react-native";
import {money, splitPounds} from "@/lib/money";
import {font} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";

/** Respects the phone's Reduce Motion setting. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

/** Counts from the last shown value to the new one. Jumps straight there with Reduce Motion on. */
function useCountUp(target: number, ms = 700) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (reduced || from.current === target) { from.current = target; setShown(target); return; }
    const start = Date.now(), a = from.current;
    let raf = 0;
    const step = () => {
      const p = Math.min(1, (Date.now() - start) / ms), eased = 1 - Math.pow(1 - p, 3);
      setShown(a + (target - a) * eased);
      if (p < 1) raf = requestAnimationFrame(step); else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = target; };
  }, [target, reduced, ms]);
  return shown;
}

/** £16.00 with the pence smaller, like the web app. Screen readers hear the whole amount once. */
export function BigMoney({value, size = 64, animate = true}: {value: number; size?: number; animate?: boolean}) {
  const {c} = useTheme();
  const counted = useCountUp(value);
  const v = animate ? counted : value;
  const {whole, pence} = splitPounds(v);
  return (
    <View style={{flexDirection: "row", alignItems: "flex-start"}} accessible accessibilityLabel={money(value)}>
      <Text adjustsFontSizeToFit numberOfLines={1}
        style={{fontFamily: font.heavy, fontSize: size, lineHeight: size * 1.08, letterSpacing: -size * 0.03, color: c.ink, fontVariant: ["tabular-nums"]}}>
        {value < 0 ? "−" : ""}£{whole}
      </Text>
      <Text style={{fontFamily: font.heavy, fontSize: size * 0.45, lineHeight: size * 0.45 * 1.1, marginTop: size * 0.12, color: c.ink, fontVariant: ["tabular-nums"]}}>
        .{pence}
      </Text>
    </View>
  );
}
