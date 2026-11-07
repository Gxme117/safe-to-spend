// Pure classify logic for POST /classify: validates the request, builds the Haiku call, parses the response.
// No env vars; testable with `deno test`.
import type Anthropic from "npm:@anthropic-ai/sdk@1.3.0";

export const CLASSIFY_MODEL = "claude-haiku-5-5";
export const MAX_PAYEES = 100;   // per call; keeps token cost bounded
export const MAX_CATS = 25;      // the user's spend categories, never more
const MAX_PAYEE_LEN = 200;

export interface CatEntry { id: string; name: string }
export interface ClassifyAsk { payees: string[]; categories: CatEntry[] }
export interface ClassifyResult { payee: string; cat: string; confidence: string }

/** Reads and validates the phone's classify request. */
export function readClassify(raw: string): ClassifyAsk | {error: string} {
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return {error: "bad_request"}; }
  const {payees, categories} = (body ?? {}) as {payees?: unknown; categories?: unknown};
  if (!Array.isArray(payees) || !payees.length || payees.length > MAX_PAYEES) return {error: "bad_request"};
  if (!Array.isArray(categories) || !categories.length || categories.length > MAX_CATS) return {error: "bad_request"};
  for (const p of payees) {
    if (typeof p !== "string" || !p.trim() || p.length > MAX_PAYEE_LEN) return {error: "bad_request"};
  }
  for (const c of categories) {
    if (!c || typeof c !== "object") return {error: "bad_request"};
    const {id, name} = c as {id?: unknown; name?: unknown};
    if (typeof id !== "string" || !id.trim() || typeof name !== "string" || !name.trim()) return {error: "bad_request"};
  }
  return {payees: payees as string[], categories: categories as CatEntry[]};
}

/** Builds the Haiku messages.create request. No betas, no tools, no thinking — straight text. */
export function classifyParams(ask: ClassifyAsk): Anthropic.Messages.MessageCreateParamsNonStreaming {
  const catLines = ask.categories.map(c => `${c.id}: ${c.name}`).join("\n");
  const system = `Classify UK merchant/payee names for a personal finance app.

The user sends a JSON array of normalised payee names.
Return a JSON array — no commentary, no markdown code fences:
[{"payee":"<name>","cat":"<id>","confidence":"high"|"medium"|"low"}]

confidence:
  high   — clearly one category (e.g. "tesco express" → groceries)
  medium — likely but could vary (e.g. "boots" could be personal or health)
  low    — genuinely ambiguous

You may omit a payee if you cannot classify it at all.
Only use category ids from this list:
${catLines}`;

  return {
    model: CLASSIFY_MODEL,
    // actual JSON output is ~30 tokens/entry (long keys); 4096 fits 100 payees safely
    max_tokens: 4096,
    system,
    messages: [{role: "user", content: JSON.stringify(ask.payees)}],
  };
}

/**
 * Parses Haiku's JSON array response into ClassifyResult[].
 * Unknown category ids, payees not in the input, and invalid confidence values are silently dropped.
 * Strips markdown code fences if present. Never throws — a malformed response returns [].
 */
export function classifyOf(
  content: readonly {type: string; text?: string}[],
  ask: ClassifyAsk,
): ClassifyResult[] {
  const text = content.flatMap(b => b.type === "text" && b.text ? [b.text] : []).join("");
  const payeeSet = new Set(ask.payees);
  const catSet = new Set(ask.categories.map(c => c.id));
  let parsed: unknown;
  try {
    // strip markdown code fences if Haiku wraps it despite being told not to
    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    // extract the first [...] array in the response
    const match = clean.match(/(\[[\s\S]*\])/);
    parsed = JSON.parse(match ? match[1] : clean);
  } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: ClassifyResult[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const {payee, cat, confidence} = item as {payee?: unknown; cat?: unknown; confidence?: unknown};
    if (typeof payee !== "string" || !payeeSet.has(payee)) continue;
    if (typeof cat !== "string" || !catSet.has(cat)) continue;
    const conf = typeof confidence === "string" && ["high", "medium", "low"].includes(confidence) ? confidence : "low";
    out.push({payee, cat, confidence: conf});
  }
  return out;
}
