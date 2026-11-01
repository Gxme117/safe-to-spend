// Tim and Frank can lead an answer with a picture, as in the "Explanatory B" frame: a label, one big figure, and a bar of what
// it's made of. They write it as two tags at the start of the answer:
//   <figure label="Spent in October so far">£1,284</figure>
//   <split>£650 rent | £634 everything else</split>
// The tags never show as words. The picture is drawn only when it's well formed, and the split only when its parts add up to
// the figure (a figure slightly off is what Frank won't stand for). Pure.
import {poundsIn} from "./check";

export interface Part { amount: number; name: string }
export interface Visual { label: string; amount: number; parts?: Part[] }

const FIGURE = /<figure\b([^>]*)>([\s\S]*?)<\/figure>/g;
const SPLIT = /<split>([\s\S]*?)<\/split>/g;
const LABEL = /label\s*=\s*"([^"]*)"/;
// a part: "£650 rent", "£634.40 everything else"
const PART = /^£\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s+(.+)$/;
const PARTS = {min: 2, max: 3};

const one = (text: string, re: RegExp) => [...text.matchAll(re)][0];
const whole = (n: number) => Number.isInteger(n);

function partOf(s: string): Part | null {
  const m = s.trim().match(PART);
  if (!m) return null;
  const name = m[3].trim();
  return name ? {amount: Number(m[1].replace(/,/g, "") + (m[2] ?? "")), name} : null;
}

// to the penny, or within £1 when any of them is in whole pounds (each rounded on its own can land a pound out)
function addsUp(amount: number, parts: Part[]) {
  const sum = parts.reduce((a, p) => a + p.amount, 0);
  const slack = [amount, ...parts.map(p => p.amount)].some(whole) ? 1 : 0.005;
  return Math.abs(sum - amount) <= slack;
}

/** The answer without its picture tags, and the picture, when there's a good one. */
export function visualOf(text: string): {text: string; visual?: Visual} {
  const fig = one(text, FIGURE), split = one(text, SPLIT);
  const shown = text.replace(FIGURE, "").replace(SPLIT, "").replace(/^[ \t]+/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!fig) return {text: shown};
  const label = fig[1].match(LABEL)?.[1].trim(), amounts = poundsIn(fig[2]);
  // a label of a few words and exactly one figure, with nothing else beside it
  if (!label || amounts.length !== 1 || fig[2].replace(/£\s?[\d,]+(\.\d{1,2})?/, "").trim()) return {text: shown};
  const amount = amounts[0];
  const parts = split?.[1].split("|").map(partOf);
  const good = parts && parts.length >= PARTS.min && parts.length <= PARTS.max && parts.every((p): p is Part => !!p) && addsUp(amount, parts as Part[]);
  return {text: shown, visual: {label, amount, ...good ? {parts: parts as Part[]} : {}}};
}

/** The picture's figures, written out, so they can be checked like the answer's own. */
export const figuresOf = (v: Visual) => ["£" + v.amount, ...(v.parts ?? []).map(p => "£" + p.amount)].join(" ");
