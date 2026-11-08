import {normalizePayee} from "./categoryChange";
import {txLook, type Look} from "./looks";
import {eligible} from "./organise";
import type {Ctx} from "./types";

/** One shop he looks at on the Smart Organisation screen: its name and Monzo's logo for it, when there is one (else `look`,
 *  the icon the payment rows use). */
export interface Stop { key: string; name: string; logo?: string; look: Look; txId: string }

export const MAX_STOPS = 8;
export const STEP_MS = 700;   // a new shop every so often
export const MAX_BUBBLES = 4; // never more than this on screen at once

/** The shops behind the unsorted payments, newest first, ones with a logo first (they look best), a payee once. */
export function searchStops(ctx: Ctx): Stop[] {
  const seen = new Map<string, Stop>();
  for (const t of [...eligible(ctx.txs)].reverse()) {
    const key = normalizePayee(t.note) || t.id, have = seen.get(key);
    if (!have) seen.set(key, {key, name: t.note || "Payment", logo: t.logo, look: txLook(ctx, t), txId: t.id});
    else if (!have.logo && t.logo) have.logo = t.logo;
  }
  const all = [...seen.values()];
  return [...all.filter(s => s.logo), ...all.filter(s => !s.logo)].slice(0, MAX_STOPS);
}

/** How long the screen stays up at least, so it feels like a proper look: a beat per shop, never snappy, never dragging. */
export function holdMs(stops: number): number {
  return Math.min(6500, Math.max(3500, stops * STEP_MS + 1500));
}

export interface Placed { i: number; slot: number; stop: Stop; inn: boolean }

/** What's on screen once `shown` shops have been looked at: the last four are in, the one before is going as its slot's
 *  next arrives. Looking carries on through the shops again if the real work takes longer than the list. */
export function bubblesAt(stops: Stop[], shown: number): Placed[] {
  if (!stops.length || shown <= 0) return [];
  const cur = shown - 1, out: Placed[] = [];
  for (let i = Math.max(0, cur - MAX_BUBBLES); i <= cur; i++) {
    out.push({i, slot: i % MAX_BUBBLES, stop: stops[i % stops.length], inn: cur - i < MAX_BUBBLES});
  }
  return out;
}
