import {useEffect, useRef, useState} from "react";
import {AccessibilityInfo, Text, View} from "react-native";
import {money, splitPounds} from "@/lib/money";
import {textSize, type TextSize} from "@/theme/tokens";
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

type Size = "giant" | "hero" | "display" | "xl";
const PENCE: Record<Size, TextSize> = {giant: "xl", hero: "xl", display: "xl", xl: "md"};

/** £16.00 with the pence smaller, like the web app. Screen readers hear the whole amount once.
 *  `wholePounds`: leave ".00" off a whole amount (Home's big number, "£13"); pence that are there still show. */
export function BigMoney({value, size: name = "display", animate = true, color, wholePounds}: {
  value: number; size?: Size; animate?: boolean; color?: string; wholePounds?: boolean;
}) {
  const {c, f} = useTheme();
  const ink = color ?? c.ink;
  // The pence sit two steps down the scale.
  const size = textSize[name], small = textSize[PENCE[name]];
  const {whole, pence} = splitPounds(useCountUp(value, animate));
  // the giant number shrinks to fit a narrow phone ("£1,234" on 375pt). Its line can't be tighter than the type, as drawn (iOS cuts the tops off),
  // and it's tracked a little tighter, as drawn
  const giant = name === "giant", line = size * 1.08, face = f.heavy, track = size * (giant ? 0.045 : 0.03);
  return (
    <View style={{flexDirection: "row", alignItems: "flex-start"}} accessible accessibilityLabel={money(value)}>
      {/* the giant number is already as big as type gets, so the phone's text size doesn't scale it (it only left a gap above it).
          iOS takes the tighter tracking off after the last digit too, which cut its edge off and pulled the pence in by a different amount
          at each size: giving it back on the right keeps the last digit whole and the pence the same natural gap away at every size */}
      <Text adjustsFontSizeToFit numberOfLines={1} allowFontScaling={!giant}
        style={{flexShrink: giant ? 1 : undefined, fontFamily: face, fontSize: size, lineHeight: line, letterSpacing: -track, paddingRight: track, color: ink, fontVariant: ["tabular-nums"]}}>
        {value < 0 ? "−" : ""}£{whole}
      </Text>
      {wholePounds && Math.round(Math.abs(value) * 100) % 100 === 0 ? null : (
        <Text allowFontScaling={!giant} style={{fontFamily: face, fontSize: small, lineHeight: small * 1.1, marginTop: size * 0.12, color: ink, fontVariant: ["tabular-nums"]}}>
          .{pence}
        </Text>
      )}
    </View>
  );
}
