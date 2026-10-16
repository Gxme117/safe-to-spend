// Spacing on a 4pt grid, the same as the web app's --s1..--s7.
export const s = {1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48} as const;

// Colours from src/styles.css. `accent` (--good-fill) means "money that's yours to use or coming in": use it sparingly.
// The accent is light mint here for now; the web app still uses its green.
// Light mode is paper white (a touch warm), with the cards a shade darker to match.
const light = {
  bg: "#FAF8F3", surface: "#F1EEE7", ink: "#000000", muted: "#5E5E5E", line: "#D4D4D4",
  good: "#0B7A54", accent: "#C3EADA", accentInk: "#000000", goodSoft: "#E5FAF1",
  soft: "#E6E6E6", amber: "#8C8C8C",
  splitBills: "#E5484D", splitEveryday: "#86D97A", splitSavings: "#5B8DEF",
  incoming: "#00C24E",   // money coming in (dots and amounts): a bright green that still shows on paper white
  figure: "#F5D77E",     // the Day page's big number: custard yellow in both modes (faint on paper white, by choice)
};
export type Palette = typeof light;
// Dark mode is a near-black with a touch of cool blue (not pure black, so white text doesn't glow on it),
// with the cards lifted just enough to stand off it, in the same cool tint.
const dark: Palette = {
  bg: "#0C0D10", surface: "#191A1E", ink: "#FFFFFF", muted: "#A3A6AD", line: "#33353B",
  good: "#C3EADA", accent: "#C3EADA", accentInk: "#000000", goodSoft: "#123A2C",
  soft: "#26282D", amber: "#8F9298",
  splitBills: "#FF6369", splitEveryday: "#86D97A", splitSavings: "#7AA7FF",
  incoming: "#00E05A",
  figure: "#F5D77E",   // a soft, buttery custard yellow, matched by eye (Hemway don't publish a code for theirs)
};
export const palettes = {light, dark};

export const font = {
  regular: "Manrope_400Regular",
  medium: "Manrope_500Medium",
  semibold: "Manrope_600SemiBold",
  bold: "Manrope_700Bold",
  heavy: "Manrope_800ExtraBold",
  // headings only: page titles and screen headers
  headBold: "BricolageGrotesque_700Bold",
  head: "BricolageGrotesque_800ExtraBold",
  // being tried on Day 2's "Safe to Spend" only
  display: "Inter_800ExtraBold",
  // Day 2's page title (the day's name)
  displayBold: "Inter_700Bold",
} as const;

// bankCard: the hero is shaped like a payment card, as on the web.
export const radius = {card: 20, bankCard: 14, control: 12, pill: 999} as const;

// Six text sizes, nothing else. Pass a name, never a raw number.
export const textSize = {xs: 12, sm: 14, md: 16, lg: 20, xl: 28, display: 64, hero: 88} as const;
export type TextSize = keyof typeof textSize;
