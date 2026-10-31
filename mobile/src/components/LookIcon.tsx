import type {ColorValue} from "react-native";
import Svg, {Circle, Path, Rect} from "react-native-svg";
import type {LookIcon as Name} from "@/lib/looks";

/** What a payment probably was, as a plain line icon (lib/looks.ts picks it). Drawn here, like Icon, so there's no icon font to load. */
export function LookIcon({name, color, size = 18, line = 1.8}: {name: Name; color: ColorValue; size?: number; line?: number}) {
  const p = {stroke: color, strokeWidth: line, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none"};
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {name === "cart" && <><Path d="M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2" {...p} /><Circle cx={9} cy={19} r={1.4} {...p} /><Circle cx={17} cy={19} r={1.4} {...p} /></>}
      {name === "train" && <><Rect x={5} y={3} width={14} height={13} rx={3} {...p} /><Path d="M5 10h14M8 16l-2 4M16 16l2 4" {...p} /></>}
      {name === "eating" && <Path d="M6 3v6a3 3 0 0 0 6 0V3M9 3v18M17 21V3c-2 1.5-3 4-3 7v3h3" {...p} />}
      {name === "takeaway" && <Path d="M4 8h16l-2 12H6L4 8zM8 8l2-5h4l2 5" {...p} />}
      {name === "coffee" && <Path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9zM16 10h2a2.5 2.5 0 0 1 0 5h-2M8 3v3M12 3v3" {...p} />}
      {name === "fuel" && <Path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10M14 8l3 3v6a1.5 1.5 0 0 0 3 0V9l-3-3" {...p} />}
      {name === "bag" && <Path d="M5 8h14l-1 13H6L5 8zM9 8V6a3 3 0 0 1 6 0v2" {...p} />}
      {name === "film" && <><Rect x={3} y={6} width={18} height={14} rx={2} {...p} /><Path d="M3 10h18M7 6l2 4M12 6l2 4M17 6l2 4" {...p} /></>}
      {name === "bottle" && <Path d="M9 3h6M10 3v3l-2 3v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V9l-2-3V3M8 13h8" {...p} />}
      {name === "pill" && <Path d="M4.6 13.4l8.8-8.8a4.2 4.2 0 0 1 6 6l-8.8 8.8a4.2 4.2 0 0 1-6-6zM9 9l6 6" {...p} />}
      {name === "family" && <><Circle cx={9} cy={8} r={3} {...p} /><Path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" {...p} /><Circle cx={17} cy={9} r={2.2} {...p} /><Path d="M16 14.2c2.8-.4 5 1.8 5 4.8" {...p} /></>}
      {name === "coin" && <><Circle cx={12} cy={12} r={9} {...p} /><Path d="M14.5 9a2.6 2.6 0 0 0-4.7 1.5V16M8.5 13h4M8.5 16h7" {...p} /></>}
      {name === "house" && <Path d="M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-5h4v5" {...p} />}
      {name === "phone" && <><Rect x={7} y={2.5} width={10} height={19} rx={2.5} {...p} /><Path d="M11 18.5h2" {...p} /></>}
      {name === "globe" && <><Circle cx={12} cy={12} r={9} {...p} /><Path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" {...p} /></>}
      {name === "bulb" && <Path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z" {...p} />}
      {name === "drop" && <Path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" {...p} />}
      {name === "landmark" && <Path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18" {...p} />}
      {name === "shield" && <Path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" {...p} />}
      {name === "dumbbell" && <Path d="M6.5 6.5v11M17.5 6.5v11M3.5 9.5v5M20.5 9.5v5M6.5 12h11" {...p} />}
      {name === "music" && <><Path d="M9 18V5l11-2v13" {...p} /><Circle cx={6} cy={18} r={3} {...p} /><Circle cx={17} cy={16} r={3} {...p} /></>}
      {name === "tv" && <><Rect x={3} y={6} width={18} height={13} rx={2} {...p} /><Path d="M8 2.5l4 3.5 4-3.5" {...p} /></>}
      {name === "repeat" && <Path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" {...p} />}
      {name === "card" && <><Rect x={2.5} y={5} width={19} height={14} rx={2.5} {...p} /><Path d="M2.5 10h19M6 15h4" {...p} /></>}
      {name === "receipt" && <Path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21V3zM9 8h6M9 12h6M9 16h3" {...p} />}
      {name === "banknote" && <><Rect x={2.5} y={6} width={19} height={12} rx={2} {...p} /><Circle cx={12} cy={12} r={2.5} {...p} /><Path d="M6 9.5h.01M18 14.5h.01" {...p} /></>}
      {name === "sofa" && <Path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H3v-5zM5 18v2M19 18v2" {...p} />}
      {name === "paw" && <><Circle cx={7} cy={10} r={1.8} {...p} /><Circle cx={10.5} cy={6} r={1.8} {...p} /><Circle cx={15} cy={6.5} r={1.8} {...p} /><Circle cx={18} cy={11} r={1.8} {...p} /><Path d="M12 12c-2.6 0-5 3-5 5.2 0 1.6 1.4 2.3 2.8 1.9.8-.2 1.5-.4 2.2-.4s1.4.2 2.2.4c1.4.4 2.8-.3 2.8-1.9 0-2.2-2.4-5.2-5-5.2z" {...p} /></>}
      {name === "gift" && <><Rect x={3.5} y={8} width={17} height={4} rx={1} {...p} /><Path d="M5 12v8h14v-8M12 8v12M12 8c-1-3-5-4.5-5.5-2S10 8 12 8zM12 8c1-3 5-4.5 5.5-2S14 8 12 8z" {...p} /></>}
      {name === "heart" && <Path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.5 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" {...p} />}
      {name === "plane" && <Path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" {...p} />}
      {name === "coins" &&<><Circle cx={9} cy={9} r={5.5} {...p} /><Path d="M16.6 10.4a5.5 5.5 0 1 1-6.2 6.2" {...p} /></>}
    </Svg>
  );
}
