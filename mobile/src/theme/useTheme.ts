import {useColorScheme} from "react-native";
import {useMoney} from "@/store/useMoney";
import {palettes, type Palette} from "./tokens";

/** The palette for the user's choice: light, dark, or whatever the phone is set to. */
export function useTheme(): {c: Palette; dark: boolean} {
  const pref = useMoney(st => st.theme), system = useColorScheme();
  const dark = pref === "dark" || (pref === "system" && system === "dark");
  return {c: dark ? palettes.dark : palettes.light, dark};
}
