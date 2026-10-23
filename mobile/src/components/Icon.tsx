import type {ColorValue} from "react-native";
import Svg, {Circle, Path, Rect} from "react-native-svg";

type Name = "day" | "month" | "settings" | "plus" | "back" | "forward" | "account" | "eye" | "eye-off" | "refresh" | "check" | "close" | "clock" | "home" | "sliders" | "pit" | "list";

/** A few plain line icons, drawn here so there's no icon font to load. */
export function Icon({name, color, size = 24}: {name: Name; color: ColorValue; size?: number}) {
  const p = {stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none"};
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {name === "day" && <><Circle cx={12} cy={12} r={4} {...p} /><Path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" {...p} /></>}
      {name === "month" && <><Rect x={3} y={4.5} width={18} height={16.5} rx={3} {...p} /><Path d="M3 9.5h18M8 2.5v4M16 2.5v4" {...p} /></>}
      {name === "settings" && <><Path d="M19.3 9.9L21.86 10.31L21.86 13.69L19.3 14.1L18.65 15.68L20.17 17.77L17.77 20.17L15.68 18.65L14.1 19.3L13.69 21.86L10.31 21.86L9.9 19.3L8.32 18.65L6.23 20.17L3.83 17.77L5.35 15.68L4.7 14.1L2.14 13.69L2.14 10.31L4.7 9.9L5.35 8.32L3.83 6.23L6.23 3.83L8.32 5.35L9.9 4.7L10.31 2.14L13.69 2.14L14.1 4.7L15.68 5.35L17.77 3.83L20.17 6.23L18.65 8.32z" {...p} /><Circle cx={12} cy={12} r={3} {...p} /></>}
      {name === "clock" && <><Circle cx={12} cy={12} r={9} {...p} /><Path d="M12 7v5l3 2" {...p} /></>}
      {/* the tab bar's, as drawn: a filled house (the stroke rounds its corners) and three sliders */}
      {name === "home" && <Path d="M12 3.6L20.7 9.6V21.8H14.9V15.6H9.1V21.8H3.3V9.6Z" {...p} strokeWidth={1.5} fill={color} />}
      {name === "sliders" && <>
        <Path d="M3.5 6.2H6.5M10.2 6.2H20.5M3.5 11.9H13.5M17.2 11.9H20.5M3.5 17.6H5.8M9.5 17.6H20.5" {...p} />
        <Circle cx={8.35} cy={6.2} r={1.85} {...p} /><Circle cx={15.35} cy={11.9} r={1.85} {...p} /><Circle cx={7.65} cy={17.6} r={1.85} {...p} />
      </>}
      {/* the Living tab's: three filled circles of different sizes, a mini ball pit */}
      {name === "pit" && <><Circle cx={9} cy={14} r={6.5} fill={color} /><Circle cx={18} cy={16.5} r={4} fill={color} /><Circle cx={16.5} cy={7} r={3} fill={color} /></>}
      {name === "list" && <Path d="M4 6h16M4 12h16M4 18h16" {...p} />}
      {name === "plus" && <Path d="M12 5v14M5 12h14" {...p} />}
      {name === "close" && <Path d="M6 6l12 12M18 6L6 18" {...p} />}
      {name === "check" && <Path d="M5 12.5l4.5 4.5L19 7.5" {...p} />}
      {name === "back" && <Path d="M15 5l-7 7 7 7" {...p} />}
      {name === "forward" && <Path d="M9 5l7 7-7 7" {...p} />}
      {name === "account" && <><Circle cx={12} cy={8} r={4} {...p} /><Path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" {...p} /></>}
      {name === "refresh" && <><Path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" {...p} /><Path d="M4 3.5V8h4.5" {...p} /><Path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" {...p} /><Path d="M20 20.5V16h-4.5" {...p} /></>}
      {name === "eye" && <><Path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" {...p} /><Circle cx={12} cy={12} r={3} {...p} /></>}
      {name === "eye-off" && <><Path d="M3 3l18 18" {...p} /><Path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" {...p} /><Path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" {...p} /></>}
    </Svg>
  );
}
