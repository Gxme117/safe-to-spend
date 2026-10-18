import {useState} from "react";
import {Animated, Easing, Pressable} from "react-native";
import Svg, {Circle, Defs, RadialGradient, Stop} from "react-native-svg";
import type {LookIcon as Name} from "@/lib/looks";
import {living} from "@/theme/tokens";
import {useTheme} from "@/theme/useTheme";
import {useReducedMotion} from "./BigMoney";
import {Icon} from "./Icon";
import {LookIcon} from "./LookIcon";

// Every icon's lines are this thick on screen, whatever its size
const LINE = 2.25;
// shapes that look too thin or too heavy beside the others at the same size
const OPTICAL: Partial<Record<Name, number>> = {drop: 1.1, dumbbell: 1.08, globe: 0.94, landmark: 0.94};
// three icon sizes, by the bubble's diameter
const iconSize = (d: number) => d < 70 ? 18 : d <= 140 ? 24 : 32;
// pressed, a bubble shrinks a little, and springs back when let go (.18s, overshooting a touch)
const PRESSED = 0.92, SPRING = Easing.bezier(0.3, 1.6, 0.5, 1);
// a paid bubble's outline
const PAID_LINE = 1.5;

/** A line icon drawn so its lines are LINE thick on screen at any size, with the optical nudges. */
export function BubbleIcon({name, color, size}: {name: Name; color: string; size: number}) {
  const px = Math.round(size * (OPTICAL[name] ?? 1));
  return <LookIcon name={name} color={color} size={px} line={LINE * 24 / px} />;
}

/** One bubble on the Living tab: a circle sized by what it costs, with a line icon in the middle (what it costs is in its sheet).
 *  Highlighted, it's the Today calendar's yellow glow (green when paid); paid, a flat pale fill with a grey outline. What it is and whether it's paid is in `label`.
 *  A tap doesn't dim it: it shrinks while held and springs back. */
export function Bubble({d, icon, look, paid, label, open, onPress}: {
  d: number; icon: Name; look: "plain" | "lit" | "paid"; paid: boolean; label: string; open: boolean; onPress: () => void;
}) {
  const {dark} = useTheme();
  const reduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));
  const press = (to: number) => { if (!reduced) Animated.timing(scale, {toValue: to, duration: 180, easing: SPRING, useNativeDriver: true}).start(); };
  const k = living[dark ? "dark" : "light"];
  const fill = look === "paid" ? k.paid : look === "plain" ? k.bubble : "transparent";
  const ink = look === "lit" ? living.hlInk : look === "paid" ? k.paidInk : k.bubbleInk;
  return (
    <Pressable onPress={onPress} onPressIn={() => press(PRESSED)} onPressOut={() => press(1)}
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{selected: open}}>
      {/* a paid one keeps a grey outline, drawn inside its edge so it stays the same size */}
      <Animated.View style={{width: d, height: d, borderRadius: d / 2, backgroundColor: fill, alignItems: "center", justifyContent: "center", overflow: "hidden",
        borderWidth: look === "paid" ? PAID_LINE : 0, borderColor: k.paidLine, transform: [{scale}]}}>
        {look === "lit" ? <Glow d={d} paid={paid} /> : null}
        <BubbleIcon name={icon} color={ink} size={iconSize(d)} />
      </Animated.View>
    </Pressable>
  );
}

/** The highlight: orange in the middle fading to pale yellow at the edge (a CSS `radial-gradient(circle closest-side, …)`);
 *  on a paid one, green fading to pale green. */
export function Glow({d, paid}: {d: number; paid?: boolean}) {
  const id = paid ? "livingGlowPaid" : "livingGlow";
  return (
    <Svg width={d} height={d} style={{position: "absolute"}}>
      <Defs>
        <RadialGradient id={id} gradientUnits="userSpaceOnUse" cx={d / 2} cy={d / 2} r={d / 2}>
          <Stop offset={0} stopColor={paid ? living.paidCore : living.hlCore} />
          <Stop offset={1} stopColor={paid ? living.paidEdge : living.hlEdge} />
        </RadialGradient>
      </Defs>
      <Circle cx={d / 2} cy={d / 2} r={d / 2} fill={`url(#${id})`} />
    </Svg>
  );
}

/** The dashed "+" bubble: add a bill. */
export function AddBubble({d, onPress}: {d: number; onPress: () => void}) {
  const {dark} = useTheme();
  const ink = living[dark ? "dark" : "light"].add;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Add a bill"
      style={{width: d, height: d, borderRadius: d / 2, borderWidth: 2, borderStyle: "dashed", borderColor: ink, alignItems: "center", justifyContent: "center"}}>
      <Icon name="plus" color={ink} size={20} />
    </Pressable>
  );
}
