// Spacing on a 4pt grid, the same as the web app's --s1..--s7.
export const s = {1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48} as const;

// Colours from src/styles.css. `accent` (--good-fill) means "money that's yours to use or coming in": use it sparingly.
// The accent is light mint here for now; the web app still uses its green.
const light = {
  bg: "#FFFFFF", surface: "#F4F4F4", ink: "#000000", muted: "#5E5E5E", line: "#D4D4D4",
  good: "#0B7A54", accent: "#AAF0D1", accentInk: "#000000", goodSoft: "#E5FAF1",
  soft: "#E6E6E6", amber: "#8C8C8C",
  splitBills: "#E5484D", splitEveryday: "#86D97A",
};
export type Palette = typeof light;
const dark: Palette = {
  bg: "#17171A", surface: "#242428", ink: "#FFFFFF", muted: "#A1A1A8", line: "#3D3D42",
  good: "#AAF0D1", accent: "#AAF0D1", accentInk: "#000000", goodSoft: "#123A2C",
  soft: "#2C2C2E", amber: "#8E8E93",
  splitBills: "#FF6369", splitEveryday: "#86D97A",
};
export const palettes = {light, dark};

export const font = {
  regular: "Manrope_400Regular",
  medium: "Manrope_500Medium",
  semibold: "Manrope_600SemiBold",
  bold: "Manrope_700Bold",
  heavy: "Manrope_800ExtraBold",
} as const;

// bankCard: the hero is shaped like a payment card, as on the web.
export const radius = {card: 20, bankCard: 14, control: 12, pill: 999} as const;

// Six text sizes, nothing else. Pass a name, never a raw number.
export const textSize = {xs: 12, sm: 14, md: 16, lg: 20, xl: 28, display: 64} as const;
export type TextSize = keyof typeof textSize;
