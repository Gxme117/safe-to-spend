import type {Tx} from "./types";

export const r2 = (n: number) => Math.round(n * 100) / 100;

/** Adds thousands separators by hand: Hermes' toLocaleString isn't the same on every platform. */
const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** £1,250 or £12.50. Negative amounts get a real minus sign: −£40. */
export function money(n: number, sign = false) {
  const v = r2(n), a = Math.abs(v);
  const whole = Math.floor(a), pence = Math.round((a - whole) * 100);
  const s = "£" + group(whole) + (pence ? "." + String(pence).padStart(2, "0") : "");
  if (v < 0) return "−" + s;
  return (sign && v > 0 ? "+" : "") + s;
}

/** Splits an amount for the big number: "£1,234" and "56". */
export function splitPounds(n: number) {
  const a = r2(Math.abs(n)), whole = Math.floor(a);
  return {whole: group(whole), pence: String(Math.round((a - whole) * 100) % 100).padStart(2, "0")};
}

/** Reads what someone typed: "£1,250.50" → 1250.5. NaN when it isn't a number. */
export function parseAmount(v: string) {
  const n = parseFloat(String(v).replace(/[£,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

export const toPence = (pounds: number) => Math.round(pounds * 100);
export const fromPence = (pence: number) => pence / 100;

/** Newest payment first: by day, then by when the money moved (or was logged, for ones you add yourself). */
export const newestFirst = (a: Tx, b: Tx) => b.date.localeCompare(a.date) || (b.paidAt ?? b.created) - (a.paidAt ?? a.created);
