// API service for POST /classify: sends normalized payee names to Haiku for category classification.
// Always fails gracefully — any error returns an empty map so the org run proceeds with low confidence.
import {accessToken, PUBLIC_KEY, SUPABASE} from "./session";

const FN = process.env.EXPO_PUBLIC_ACCOUNTANT_FN_URL?.trim() || `${SUPABASE}/functions/v1/accountant`;
const CLASSIFY_MS = 30_000; // Haiku + 100 payees fits well within 30s
const BATCH_SIZE = 50;      // keep each call small and fast

export type ClassifyGuess = {cat: string; sub?: string; confidence: string};

/** POST /classify and parse {results: [{payee, cat, confidence}]}. Returns empty Map on any error. */
async function fetchBatch(
  payees: string[],
  categories: {id: string; name: string}[],
  token: string,
): Promise<Map<string, ClassifyGuess>> {
  const stop = new AbortController();
  const t = setTimeout(() => stop.abort(), CLASSIFY_MS);
  let r: Response;
  try {
    r = await fetch(`${FN}/classify`, {
      method: "POST", signal: stop.signal,
      headers: {Authorization: `Bearer ${token}`, apikey: PUBLIC_KEY, "Content-Type": "application/json"},
      body: JSON.stringify({payees, categories}),
    });
  } catch { return new Map(); } finally { clearTimeout(t); }

  if (!r.ok) {
    // 401: stale token — the caller retries the whole batch set with a fresh token
    if (r.status === 401) throw new Error("401");
    return new Map();
  }
  let body: {results?: unknown};
  try { body = await r.json(); } catch { return new Map(); }
  if (!Array.isArray(body.results)) return new Map();
  const out = new Map<string, ClassifyGuess>();
  for (const item of body.results) {
    if (!item || typeof item !== "object") continue;
    const {payee, cat, confidence} = item as {payee?: unknown; cat?: unknown; confidence?: unknown};
    if (typeof payee !== "string" || typeof cat !== "string" || typeof confidence !== "string") continue;
    out.set(payee, {cat, confidence});
  }
  return out;
}

/**
 * Classify a list of normalized payee strings against the user's spend categories.
 * Batches at BATCH_SIZE, runs batches in parallel, merges results.
 * Always returns a Map (empty on total failure) — never throws.
 */
export async function classifyPayees(
  payees: string[],
  categories: {id: string; name: string}[],
): Promise<Map<string, ClassifyGuess>> {
  if (!payees.length) return new Map();
  const batches: string[][] = [];
  for (let i = 0; i < payees.length; i += BATCH_SIZE) batches.push(payees.slice(i, i + BATCH_SIZE));

  let token: string;
  try { token = await accessToken(); } catch { return new Map(); }

  const run = async (retry = false): Promise<Map<string, ClassifyGuess>[]> => {
    const t = retry ? await accessToken(true).catch(() => null) : token;
    if (!t) return [];
    const results = await Promise.allSettled(batches.map(b => fetchBatch(b, categories, t)));
    const maps: Map<string, ClassifyGuess>[] = [];
    let needs401Retry = false;
    for (const r of results) {
      if (r.status === "fulfilled") { maps.push(r.value); }
      else if (r.reason instanceof Error && r.reason.message === "401") { needs401Retry = true; }
    }
    if (needs401Retry && !retry) {
      const retried = await run(true);
      return [...maps, ...retried];
    }
    return maps;
  };

  try {
    const maps = await run();
    const merged = new Map<string, ClassifyGuess>();
    for (const m of maps) for (const [k, v] of m) merged.set(k, v);
    return merged;
  } catch { return new Map(); }
}
