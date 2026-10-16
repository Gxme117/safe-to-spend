import {useEffect, useRef, useState} from "react";
import {AccessibilityInfo, Text, View} from "react-native";
import {money, splitPounds} from "@/lib/money";
import {font, textSize, type TextSize} from "@/theme/tokens";
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

/** Counts up from £0 when the number first appears, then from the last shown value to the new one, as on the web (.9s, easing out).
 *  Jumps straight there with Reduce Motion on, or when `on` is false. */
function useCountUp(target: number, on: boolean, ms = 900) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(on ? 0 : target);
  const from = useRef(on ? 0 : target);
  useEffect(() => {
    if (!on || reduced || from.current === target) { from.current = target; setShown(target); return; }
    const start = Date.now(), a = from.current;
    let raf = 0;
    const step = () => {
      const p = Math.min(1, (Date.now() - start) / ms), eased = 1 - Math.pow(1 - p, 3);
      // `from` follows the shown figure, so a new number mid-count carries on from there
      from.current = a + (target - a) * eased;
      setShown(from.current);
      if (p < 1) raf = requestAnimationFrame(step); else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, on, reduced, ms]);
  return shown;
}

const PENCE: Record<"hero" | "display" | "xl", TextSize> = {hero: "xl", display: "xl", xl: "md"};

/** £16.00 with the pence smaller, like the web app. Screen readers hear the whole amount once. */
export function BigMoney({value, size: name = "display", animate = true, color}: {value: number; size?: "hero" | "display" | "xl"; animate?: boolean; color?: string}) {
  const {c} = useTheme();
  const ink = color ?? c.ink;
  // The pence sit two steps down the scale.
  const size = textSize[name], small = textSize[PENCE[name]];
  const {whole, pence} = splitPounds(useCountUp(value, animate));
  return (
    <View style={{flexDirection: "row", alignItems: "flex-start"}} accessible accessibilityLabel={money(value)}>
      <Text adjustsFontSizeToFit numberOfLines={1}
        style={{fontFamily: font.heavy, fontSize: size, lineHeight: size * 1.08, letterSpacing: -size * 0.03, color: ink, fontVariant: ["tabular-nums"]}}>
        {value < 0 ? "−" : ""}£{whole}
      </Text>
      <Text style={{fontFamily: font.heavy, fontSize: small, lineHeight: small * 1.1, marginTop: size * 0.12, color: ink, fontVariant: ["tabular-nums"]}}>
        .{pence}
      </Text>
    </View>
  );
}
