/** "#abc", "ABC123" or "#aabbcc" to "#AABBCC"; null if it isn't a hex colour. */
export function parseHex(text: string): string | null {
  const h = text.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h)) return "#" + h.split("").map(x => x + x).join("").toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(h)) return "#" + h.toUpperCase();
  return null;
}

/** WCAG relative luminance of "#RRGGBB". */
function luminance(hex: string) {
  const lin = (i: number) => { const v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
}

/** The same colour, darker: at least 30% towards black, and further until white text on it reads (4.5:1). */
export function deepen(hex: string): string {
  const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  for (let k = 0.3; ; k += 0.05) {
    const out = "#" + ch.map(v => Math.round(v * (1 - Math.min(k, 1))).toString(16).padStart(2, "0")).join("").toUpperCase();
    if (k >= 1 || 1.05 / (luminance(out) + 0.05) >= 4.5) return out;
  }
}

/** Black or white, whichever reads better on this colour (WCAG relative luminance). */
export function inkOn(hex: string): "#000000" | "#FFFFFF" {
  const L = luminance(hex);
  // contrast with black is (L + .05) / .05, with white 1.05 / (L + .05): black wins above L ≈ .179
  return L > 0.179 ? "#000000" : "#FFFFFF";
}
