// Spacing on a 4pt grid, the same as the web app's --s1..--s7.
export const s = {1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48} as const;

// Colours from src/styles.css. `accent` (--good-fill) means "money that's yours to use or coming in": use it sparingly.
// The accent is the pay cycle's highlight for now (a golden yellow, matched to the Atoms habit app's on Mobbin, at your ask); the web app still uses its green.
// Light mode is paper white (a touch warm), with the cards a shade darker to match.
const light = {
  bg: "#FAF8F3", surface: "#F1EEE7", ink: "#000000", muted: "#5E5E5E", line: "#D4D4D4",
  good: "#0B7A54", accent: "#FABD54", accentInk: "#000000", goodSoft: "#FFF1D6",
  soft: "#E6E6E6", amber: "#8C8C8C",
  splitBills: "#FF2D55", splitEveryday: "#5AB4DC", splitSavings: "#FFA41C",   // iOS's system pink; a calmer sky blue; savings in the calendar's picked-day orange
  incoming: "#00C24E",   // money coming in (dots and amounts): a bright green that still shows on paper white
  figure: "#F5D77E",     // the Day page's big number: custard yellow in both modes (faint on paper white, by choice)
};
export type Palette = typeof light;
// Dark mode is a near-black with a touch of cool blue (not pure black, so white text doesn't glow on it),
// with the cards lifted just enough to stand off it, in the same cool tint.
const dark: Palette = {
  // a dark grey page and slightly dimmed white text, not near-black and pure white (that glows and reads harsh); each raised layer a step lighter
  bg: "#16171A", surface: "#202125", ink: "#ECEDEF", muted: "#A3A6AD", line: "#3A3C42",
  good: "#FABD54", accent: "#FABD54", accentInk: "#000000", goodSoft: "#3A2A10",
  soft: "#2B2D32", amber: "#8F9298",
  splitBills: "#FF375F", splitEveryday: "#7CCBEB", splitSavings: "#FFA41C",
  incoming: "#00E05A",
  figure: "#F5D77E",   // a soft, buttery custard yellow, matched by eye (Hemway don't publish a code for theirs)
};
export const palettes = {light, dark};

// Home (the minimal design) keeps the colours it was drawn in (its muted grey darkened to 4.5:1 on the page, for small text; cards white): in light mode a cool grey page, near-black ink and warm greys
// (`page` stands in for those palette colours there, through <HomeLook>); in dark mode the dark palette as it is.
// The pay-cycle grid's days: `past` fill, `ring` round days to come, `dayInk` their dates.
// Under it ("Today · scrolled down"): `card` behind "What if I spend" and Spent today, `rule` between its rows, `badge` behind a letter.
export const home = {
  light: {page: {bg: "#EAE8E4", surface: "#FFFFFF", ink: "#111111", muted: "#6B6760", line: "#C6C1BB"} as Partial<Palette>, past: "#2B2A27", ring: "#CFCBC3", dayInk: "#6F6C66",
    card: "#FFFFFF", rule: "#ECEAE6", badge: "#F0EEEA"},
  dark: {page: {} as Partial<Palette>, past: dark.ink, ring: dark.line, dayInk: dark.muted, card: dark.surface, rule: dark.line, badge: dark.soft},
};

// The Tim tab's page in light mode: his picture's own flat background (as the "Accountant-Tim" frame), so he blends into it.
export const timPage = "#F5F5F5";

// The Living tab's bubbles (design/LIVING_SPEC.md): a bubble and its icon, a paid one with its grey outline, and the dashed "+" outline.
// The paid fill is almost the page's colour, so the outline keeps a paid bubble's edge (the spec dropped it; on the phone it was wanted back).
// The highlight is the same yellow in both modes, with a warm near-black icon on it. In dark mode the bubbles turn light.
// `paidWord`: the word "Paid" in a paid one's sheet, in green so it's seen at a glance.
export const living = {
  light: {bubble: "#111111", bubbleInk: "#FFFFFF", paid: "#E7E4DF", paidInk: "#8A857E", paidLine: "#B8B3AB", add: "#2B2A27", paidWord: "#1F7A4C", danger: "#B42318"},
  dark: {bubble: dark.ink, bubbleInk: dark.bg, paid: dark.soft, paidInk: dark.muted, paidLine: "#4A4D55", add: dark.muted, paidWord: "#5FD99A", danger: "#F97066"},
  hlCore: "#FFAD30", hlEdge: "#FFD58C", hlInk: "#2B2A27",
  // a paid one, picked, glows green instead: it's done
  paidCore: "#3CCB7F", paidEdge: "#C8F0D8",
};

// A payment's badge with no shop logo: a soft colour behind its icon (lib/looks.ts), and the icon in a deeper shade of it.
// Pale with a deep icon in light mode; deep and quiet with a light icon in dark.
export const badgeTint = {
  green: {light: {bg: "#DCEFD5", ink: "#3E7A3A"}, dark: {bg: "#243A2B", ink: "#A8D8A0"}},
  blue: {light: {bg: "#D8E6F5", ink: "#34618F"}, dark: {bg: "#22334A", ink: "#A9C8EA"}},
  peach: {light: {bg: "#F8E0D2", ink: "#A55A35"}, dark: {bg: "#45302A", ink: "#F0B999"}},
  latte: {light: {bg: "#EBDDCD", ink: "#7A5A3C"}, dark: {bg: "#3D3329", ink: "#D9BFA2"}},
  amber: {light: {bg: "#F3E3B5", ink: "#8A6A12"}, dark: {bg: "#433A22", ink: "#E8CD7E"}},
  pink: {light: {bg: "#F2D9E6", ink: "#9A4570"}, dark: {bg: "#432C39", ink: "#E9AECB"}},
  lavender: {light: {bg: "#E3DAF2", ink: "#5E4A91"}, dark: {bg: "#342D47", ink: "#C6B6EA"}},
  mint: {light: {bg: "#D6EEE9", ink: "#2F7A6E"}, dark: {bg: "#21403B", ink: "#9FD8CE"}},
  rose: {light: {bg: "#F6D9D9", ink: "#A04447"}, dark: {bg: "#462B2D", ink: "#EDAAAD"}},
  sand: {light: {bg: "#EFE6D6", ink: "#7A6644"}, dark: {bg: "#3B352B", ink: "#D8C7A6"}},
  grey: {light: {bg: "#E6E4E0", ink: "#5E5C58"}, dark: {bg: "#2E3035", ink: "#B7B9BE"}},
} as const;

export const font = {
  regular: "Manrope_400Regular",
  medium: "Manrope_500Medium",
  semibold: "Manrope_600SemiBold",
  bold: "Manrope_700Bold",
  heavy: "Manrope_800ExtraBold",
  // headings only: page titles and screen headers
  headBold: "BricolageGrotesque_700Bold",
  head: "BricolageGrotesque_800ExtraBold",
  // being tried on Day 2's "Safe to Spend", and the bank cards' names
  display: "Inter_800ExtraBold",
  // Day 2's page title (the day's name)
  displayBold: "Inter_700Bold",
} as const;
export type Fonts = Record<keyof typeof font, string>;

// Hanken Grotesk: Today (the minimal design) and the tab bar, as drawn. Inside <HomeLook> every weight above is drawn in it instead.
export const hanken = {regular: "HankenGrotesk_400Regular", medium: "HankenGrotesk_500Medium", semibold: "HankenGrotesk_600SemiBold", bold: "HankenGrotesk_700Bold", heavy: "HankenGrotesk_800ExtraBold"} as const;
export const homeFont: Fonts = {...hanken, headBold: hanken.bold, head: hanken.heavy, display: hanken.heavy, displayBold: hanken.bold};
// where a face's baseline sits: its ascent and descent, as a share of the font size (Manrope 2132 and 600 of 2000; Hanken Grotesk 1000 and 303 of 1000)
export const faceMetrics = {manrope: {ascent: 1.066, descent: 0.3}, hanken: {ascent: 1, descent: 0.303}} as const;

// bankCard: the hero is shaped like a payment card, as on the web.
export const radius = {card: 20, bankCard: 14, control: 12, pill: 999} as const;

// Six text sizes, nothing else. Pass a name, never a raw number.
// giant: only the Home tab's big number (the minimal design), where the number is the page.
// cardBalance, cardName: only the bank cards' balance and name (the S20 design). figureLabel: only the lines under Home's big number.
// homeSmall: only Today's small lines, as drawn (the pay cycle's dates, headings and days, what's spare until payday). homeCardName: only Today's bank cards' names.
// livingTitle, livingBody: only the Living tab's empty state's heading and line.
export const textSize = {xs: 12, sm: 14, md: 16, lg: 20, xl: 28, display: 64, hero: 88, giant: 128, cardBalance: 18, cardName: 22, figureLabel: 24, homeSmall: 13, homeCardName: 24,
  livingTitle: 24, livingBody: 15} as const;
export type TextSize = keyof typeof textSize;
