import Svg, {G, Path} from "react-native-svg";
import {useTheme} from "@/theme/useTheme";

/** The logo: an OK hand, in the theme's ink (white in dark mode, black in light). Fingers and the ring are round-capped strokes on one palm, turned and flipped so the fingers point left, the palm is on top and the ring hangs below on the right.
 *  `height` sets its size; the width follows. */
export function Logo({height = 24}: {height?: number}) {
  const {c} = useTheme();
  return (
    // turned 20° clockwise as a whole, so the drawing's own box doesn't cut off its corners
    <Svg width={(height * 558) / 403} height={height} viewBox="195 306 558 403" style={{transform: [{rotate: "20deg"}]}} accessibilityRole="image" accessibilityLabel="Leo">
      <G transform="translate(0 1015) scale(1 -1) rotate(-15 481.5 491.5) translate(963 0) scale(-1 1) translate(0 983) scale(1 -1) rotate(-45 510 490) translate(0 980) scale(1 -1)" fill={c.ink} stroke={c.ink} strokeWidth={80} strokeLinecap="round">
        <Path fill="none" d="M320 521 A112 112 0 1 1 302 639" />
        <Path d="M532 255 L500 480" />
        <Path d="M647 338 L570 510" />
        <Path d="M720 455 L620 574" />
        <Path stroke="none" d="M470 440 L540 470 L600 520 L690 470 L751 481 L578 686 C536 734 472 752 405 747 L492 596 Z" />
      </G>
    </Svg>
  );
}
