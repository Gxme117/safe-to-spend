import {createContext, useContext, useMemo} from "react";
import {useColorScheme} from "react-native";
import {useMoney} from "@/store/useMoney";
import {inkOn} from "./color";
import {font, home, homeFont, palettes, type Fonts, type Palette} from "./tokens";

// A screen can keep one look whatever the setting: wrap it in <FixedTheme value="dark">.
const Fixed = createContext<"light" | "dark" | null>(null);
export const FixedTheme = Fixed.Provider;

// Today keeps the colours and the face it was drawn in (tokens `home`, `homeFont`): wrap it in <HomeLook value>.
const Look = createContext(false);
export const HomeLook = Look.Provider;

/** The palette for the user's choice: light, dark, or whatever the phone is set to, with their own accent if they've chosen one.
 *  `f`: the fonts to draw text in (Hanken Grotesk inside <HomeLook>, else the usual ones), and `hanken` when that's so. */
export function useTheme(): {c: Palette; dark: boolean; f: Fonts; hanken: boolean} {
  const pref = useMoney(st => st.theme), accent = useMoney(st => st.accent), system = useColorScheme(), fixed = useContext(Fixed), look = useContext(Look);
  const dark = fixed ? fixed === "dark" : pref === "dark" || (pref === "system" && system === "dark");
  const c = useMemo(() => {
    const base = {...(dark ? palettes.dark : palettes.light), ...(look ? home[dark ? "dark" : "light"].page : {})};
    return accent ? {...base, accent, accentInk: inkOn(accent)} : base;
  }, [dark, accent, look]);
  return {c, dark, f: look ? homeFont : font, hanken: look};
}
