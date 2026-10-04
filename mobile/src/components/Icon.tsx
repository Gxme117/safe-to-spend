import type {ColorValue} from "react-native";
import Svg, {Circle, Path, Rect} from "react-native-svg";

type Name = "day" | "month" | "settings" | "plus" | "back" | "account" | "eye" | "eye-off" | "refresh";

/** A few plain line icons, drawn here so there's no icon font to load. */
export function Icon({name, color, size = 24}: {name: Name; color: ColorValue; size?: number}) {
  const p = {stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none"};
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {name === "day" && <><Circle cx={12} cy={12} r={4} {...p} /><Path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" {...p} /></>}
      {name === "month" && <><Rect x={3} y={4.5} width={18} height={16.5} rx={3} {...p} /><Path d="M3 9.5h18M8 2.5v4M16 2.5v4" {...p} /></>}
      {name === "settings" && <><Path d="M4 7h9M17 7h3M4 17h3M11 17h9" {...p} /><Circle cx={15} cy={7} r={2} {...p} /><Circle cx={9} cy={17} r={2} {...p} /></>}
      {name === "plus" && <Path d="M12 5v14M5 12h14" {...p} />}
      {name === "back" && <Path d="M15 5l-7 7 7 7" {...p} />}
      {name === "account" && <><Circle cx={12} cy={8} r={4} {...p} /><Path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" {...p} /></>}
      {name === "refresh" && <><Path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" {...p} /><Path d="M4 3.5V8h4.5" {...p} /><Path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" {...p} /><Path d="M20 20.5V16h-4.5" {...p} /></>}
      {name === "eye" && <><Path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" {...p} /><Circle cx={12} cy={12} r={3} {...p} /></>}
      {name === "eye-off" && <><Path d="M3 3l18 18" {...p} /><Path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" {...p} /><Path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" {...p} /></>}
    </Svg>
  );
}
