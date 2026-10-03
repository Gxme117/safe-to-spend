// Spacing on a 4pt grid, the same as the web app's --s1..--s7.
export const s = {1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48} as const;

// Colours from src/styles.css. `accent` (--good-fill) means "money that's yours to use or coming in": use it sparingly.
const light = {
  bg: "#FFFFFF", surface: "#F4F4F4", ink: "#000000", muted: "#5E5E5E", line: "#D4D4D4",
  good: "#2C9200", accent: "#4CE01A", accentInk: "#000000", goodSoft: "#E6FADD",
  soft: "#E6E6E6", amber: "#8C8C8C",
  splitBills: "#E5484D", splitEveryday: "#86D97A",
};
export type Palette = typeof light;
const dark: Palette = {
  bg: "#17171A", surface: "#242428", ink: "#FFFFFF", muted: "#A1A1A8", line: "#3D3D42",
  good: "#6DF03C", accent: "#6DF03C", accentInk: "#000000", goodSoft: "#16330C",
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

export const radius = {card: 20, control: 12, pill: 999} as const;
