import type {IsoDate} from "./types";

export const pad = (n: number) => String(n).padStart(2, "0");
export const isoD = (d: Date): IsoDate => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = (): IsoDate => isoD(new Date());
export const parseD = (s: IsoDate) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (s: IsoDate, n: number): IsoDate => { const d = parseD(s); d.setDate(d.getDate() + n); return isoD(d); };
export const addMonths = (k: string, n: number) => { const d = parseD(k + "-01"); d.setMonth(d.getMonth() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const utc = (s: IsoDate) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
export const dayDiff = (a: IsoDate, b: IsoDate) => Math.round((utc(b) - utc(a)) / 864e5);
export const lastOfMonth = (k: string): IsoDate => isoD(new Date(+k.slice(0, 4), +k.slice(5, 7), 0));

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Built by hand rather than with toLocaleDateString: Hermes' Intl output differs by platform.
/** "Sat 3 Oct" */
export const niceDate = (s: IsoDate) => { const d = parseD(s); return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };
/** "Sat 3 October" */
export const longDate = (s: IsoDate) => { const d = parseD(s); return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
export const ord = (n: number) => n + ((n % 100 >= 11 && n % 100 <= 13) ? "th" : ({1: "st", 2: "nd", 3: "rd"} as Record<number, string>)[n % 10] || "th");

// England and Wales
export const BANK_HOLIDAYS = new Set([
  "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25", "2026-08-31", "2026-12-25", "2026-12-28",
  "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31", "2027-08-30", "2027-12-27", "2027-12-28",
]);
const offDay = (x: Date) => x.getDay() === 0 || x.getDay() === 6 || BANK_HOLIDAYS.has(isoD(x));

/** Pay moves EARLIER on weekends and bank holidays. */
export function workingBefore(d: Date) {
  const x = new Date(d);
  while (offDay(x)) x.setDate(x.getDate() - 1);
  return x;
}
/** Bills move LATER on weekends and bank holidays. */
export function workingAfter(d: Date) {
  const x = new Date(d);
  while (offDay(x)) x.setDate(x.getDate() + 1);
  return x;
}
