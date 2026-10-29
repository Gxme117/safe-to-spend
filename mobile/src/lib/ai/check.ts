// Every £ figure Tim or Frank states has to come from somewhere checkable: a tool's result (the engine's own figures), a sum
// they worked out with calculate, or something you said. A figure from none of those is what this catches.
import type Anthropic from "@anthropic-ai/sdk";
import {money} from "../money";

type Message = Anthropic.Beta.Messages.BetaMessageParam;

// £1,234.56, £30, £ 7.5: the amount after a pound sign
const POUNDS = /£\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?/g;
// any number in something you said: "150 quid", "£150", "the 26th"
const ANY = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
const num = (s: string) => Number(s.replace(/,/g, ""));

/** The £ amounts in a piece of text. */
export const poundsIn = (text: string): number[] => [...text.matchAll(POUNDS)].map(m => num(m[1] + (m[2] ?? "")));

// a tool's figures: its numbers, and any £ amount in its sentences (dates and ids are strings without a £, so they don't count)
function walk(v: unknown, out: number[]) {
  if (typeof v === "number") out.push(v);
  else if (typeof v === "string") out.push(...poundsIn(v));
  else if (Array.isArray(v)) v.forEach(x => walk(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach(x => walk(x, out));
}
function fromResult(content: unknown, out: number[]) {
  const texts = typeof content === "string" ? [content]
    : Array.isArray(content) ? content.flatMap(b => b && typeof b === "object" && "text" in b && typeof b.text === "string" ? [b.text] : []) : [];
  for (const t of texts) {
    try { walk(JSON.parse(t), out); } catch { out.push(...poundsIn(t)); }
  }
}

// what's said on the person's side: their own words, any number; the app's context, only its £ (your notes: the date's digits
// aren't figures); the app's check, nothing (it quotes the figures that didn't check out)
const fromText = (t: string) => t.startsWith("<app_check>") ? []
  : t.startsWith("<app_context>") ? poundsIn(t) : [...t.matchAll(ANY)].map(x => num(x[0]));

/**
 * Every figure a reply may use: each tool result in the conversation, and everything you said (and your notes).
 * His own earlier words don't count: a figure is only as good as where it came from.
 */
export function knownIn(messages: Message[]): number[] {
  const out: number[] = [];
  for (const m of messages) {
    if (m.role !== "user") continue;
    if (typeof m.content === "string") { out.push(...fromText(m.content)); continue; }
    for (const b of m.content) {
      if (b.type === "tool_result") fromResult(b.content, out);
      else if (b.type === "text") out.push(...fromText(b.text));
    }
  }
  return out;
}

// the same figure: to the penny, or, when he gives whole pounds, rounded. Which side of zero doesn't matter
// ("£20 past it" for a left of −20). £0 always passes.
const same = (said: number, k: number) => {
  const a = Math.abs(k);
  return Math.abs(said - a) < 0.005 || (Number.isInteger(said) && Math.round(a) === said);
};

/** The £ figures in a reply that don't match anything known, as they'd be written (£1,234.56). Empty when it all checks out. */
export function unchecked(reply: string, known: number[]): string[] {
  const bad = poundsIn(reply).filter(said => said !== 0 && !known.some(k => same(said, k)));
  return [...new Set(bad)].map(x => money(x));
}

/** What the app tells him when a figure didn't check out: he looks again and gives the whole answer again. */
export const checkNote = (figures: string[]) =>
  `<app_check>These figures in your last answer don't match any tool result or calculation: ${figures.join(", ")}. Check them with the tools, then give your whole answer again.</app_check>`;
