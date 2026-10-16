import {createContext, useContext, useMemo} from "react";
import {useColorScheme} from "react-native";
import {useMoney} from "@/store/useMoney";
import {inkOn} from "./color";
import {palettes, type Palette} from "./tokens";

// A screen can keep one look whatever the setting: wrap it in <FixedTheme value="dark">.
const Fixed = createContext<"light" | "dark" | null>(null);
export const FixedTheme = Fixed.Provider;

/** The palette for the user's choice: light, dark, or whatever the phone is set to, with their own accent if they've chosen one. */
export function useTheme(): {c: Palette; dark: boolean} {
  const pref = useMoney(st => st.theme), accent = useMoney(st => st.accent), system = useColorScheme(), fixed = useContext(Fixed);
  const dark = fixed ? fixed === "dark" : pref === "dark" || (pref === "system" && system === "dark");
  const c = useMemo(() => {
    const base = dark ? palettes.dark : palettes.light;
    return accent ? {...base, accent, accentInk: inkOn(accent)} : base;
  }, [dark, accent]);
  return {c, dark};
}
