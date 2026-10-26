import {Pressable} from "react-native";
import {useTheme} from "@/theme/useTheme";
import {Icon} from "./Icon";

// A full 44pt tap target (Apple's minimum) that only takes up 32 × 28 in the row, so the row stays as it was drawn. It's the button's
// own size rather than hitSlop: on the new architecture a touch outside the row holding it never reaches a hitSlop.
const TAP = 44, W = 32, H = 28;

/** < or > beside a month (Living, Today): steps the month on show back or on; at the end of the range it's greyed and does nothing.
 *  `size`: the arrow's size (20 in Living's labels, bigger on Today). */
export function MonthStep({dir, on, label, onPress, size = 20}: {dir: "back" | "forward"; on: boolean; label: string; onPress: () => void; size?: number}) {
  const {c: k} = useTheme();
  return (
    <Pressable testID={`month-${dir}`} onPress={onPress} disabled={!on} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{disabled: !on}}
      style={{width: TAP, height: TAP, marginHorizontal: (W - TAP) / 2, marginVertical: (H - TAP) / 2, alignItems: "center", justifyContent: "center"}}>
      <Icon name={dir} color={on ? k.muted : k.line} size={size} />
    </Pressable>
  );
}
