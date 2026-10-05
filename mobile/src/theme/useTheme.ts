import {createContext, useContext} from "react";
import {useColorScheme} from "react-native";
import {useMoney} from "@/store/useMoney";
import {palettes, type Palette} from "./tokens";

// A screen can keep one look whatever the setting: wrap it in <FixedTheme value="dark">.
const Fixed = createContext<"light" | "dark" | null>(null);
export const FixedTheme = Fixed.Provider;

/** The palette for the user's choice: light, dark, or whatever the phone is set to. */
export function useTheme(): {c: Palette; dark: boolean} {
  const pref = useMoney(st => st.theme), system = useColorScheme(), fixed = useContext(Fixed);
  const dark = fixed ? fixed === "dark" : pref === "dark" || (pref === "system" && system === "dark");
  return {c: dark ? palettes.dark : palettes.light, dark};
}
