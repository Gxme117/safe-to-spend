import type {ColorValue} from "react-native";
import Svg, {Circle, Path, Rect} from "react-native-svg";

type Name = "day" | "month" | "settings" | "plus";

/** A few plain line icons, drawn here so there's no icon font to load. */
export function Icon({name, color, size = 24}: {name: Name; color: ColorValue; size?: number}) {
  const p = {stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none"};
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {name === "day" && <><Circle cx={12} cy={12} r={4} {...p} /><Path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" {...p} /></>}
      {name === "month" && <><Rect x={3} y={4.5} width={18} height={16.5} rx={3} {...p} /><Path d="M3 9.5h18M8 2.5v4M16 2.5v4" {...p} /></>}
      {name === "settings" && <><Path d="M4 7h9M17 7h3M4 17h3M11 17h9" {...p} /><Circle cx={15} cy={7} r={2} {...p} /><Circle cx={9} cy={17} r={2} {...p} /></>}
      {name === "plus" && <Path d="M12 5v14M5 12h14" {...p} />}
    </Svg>
  );
}
