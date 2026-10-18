import Svg, {Circle, G, Rect} from "react-native-svg";

// The crema's bubbles, from the cup's middle: where each is, and how big
const BUBBLES = [[-28, -26, 3.5], [-14, -30, 4.5], [-36, -12, 2.5], [-20, -37, 2], [-38, 3, 2], [-6, -41, 1.8], [-31, -35, 1.5], [-40, -4, 1.4]] as const;

/** A cup of coffee seen from above, its shadow falling down and left, for the accounts' desk (Today, with the cards out).
 *  Our own drawing, plain shapes on a 200 × 200 canvas, the cup's middle at its middle. Only something to look at: screen readers skip it. */
export function Mug({size}: {size: number}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* the shadow: the cup's circle drawn out down and left */}
      <G rotation={45} origin="100, 100">
        <Rect x={38} y={38} width={124} height={176} rx={62} fill="rgba(0,0,0,0.10)" />
      </G>
      {/* the handle, down and right */}
      <G rotation={-45} origin="100, 100">
        <Rect x={89} y={142} width={22} height={44} rx={11} fill="#FFFFFF" />
      </G>
      <Circle cx={100} cy={100} r={62} fill="#FFFFFF" />
      {/* the inside of the cup, then the crema, then the coffee showing through it */}
      <Circle cx={100} cy={100} r={52} fill="#E8DFD3" />
      <Circle cx={100} cy={100} r={46} fill="#8A5634" />
      <Circle cx={107} cy={106} r={36} fill="#2B140B" />
      {BUBBLES.map(([x, y, r]) => (
        <G key={`${x},${y}`}>
          <Circle cx={100 + x} cy={100 + y} r={r} fill="#3A1F12" />
          <Circle cx={100 + x + r * 0.35} cy={100 + y - r * 0.35} r={r * 0.3} fill="rgba(255,255,255,0.55)" />
        </G>
      ))}
    </Svg>
  );
}
