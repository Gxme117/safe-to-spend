import {r2} from "./money";
import type {IncomeFreq} from "./types";

/** How someone knows their pay. Hour and year are before tax; week and month are what lands. */
export type PayBasis = "hour" | "week" | "month" | "year";

// UK Income Tax (England, Wales, NI) and employee Class 1 NI, 2026/27. These thresholds are frozen until April 2028.
const ALLOWANCE = 12570, BASIC_BAND = 37700, ADDITIONAL_FROM = 125140, TAPER_FROM = 100000;
const NI_FROM = 12570, NI_UPPER = 50270;

/** Yearly take-home from a yearly salary before tax: Income Tax and National Insurance only (no pension or student loan). */
export function takeHome(gross: number): number {
  if (!(gross > 0)) return 0;
  const allowance = Math.max(0, ALLOWANCE - Math.max(0, gross - TAPER_FROM) / 2);
  const taxable = Math.max(0, gross - allowance);
  const basic = Math.min(taxable, BASIC_BAND);
  const additional = Math.max(0, gross - ADDITIONAL_FROM);
  const higher = Math.max(0, taxable - basic - additional);
  const tax = basic * 0.2 + higher * 0.4 + additional * 0.45;
  const ni = Math.max(0, Math.min(gross, NI_UPPER) - NI_FROM) * 0.08 + Math.max(0, gross - NI_UPPER) * 0.02;
  return r2(gross - tax - ni);
}

/** Take-home for a year, from what was typed. Hourly is rate × hours × 52 weeks. */
export function yearlyTakeHome(basis: PayBasis, amount: number, hours = 0): number {
  if (basis === "hour") return takeHome(amount * hours * 52);
  if (basis === "year") return takeHome(amount);
  return r2(amount * (basis === "week" ? 52 : 12));
}

const PER_YEAR: Record<IncomeFreq, number> = {
  "monthly-lastworking": 12, "monthly-date": 12, "monthly-lastfri": 12,
  fourweekly: 13, fortnightly: 26, weekly: 52, oneoff: 1,
};

/** What lands each payday: a year's take-home split over that many paydays. */
export const perPayday = (yearly: number, freq: IncomeFreq) => r2(yearly / PER_YEAR[freq]);
