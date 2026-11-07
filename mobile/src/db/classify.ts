// Cache layer for AI merchant classifications (org_guess table, 30-day TTL).
import type {Confidence} from "@/lib/organise";
import {db} from "./open";

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface GuessRow { payee: string; cat: string; sub: string | null; confidence: string }

/**
 * Returns cached AI guesses for the given normalized payee strings where the cache entry is under 30 days old.
 * Unknown payees and stale entries are silently absent from the returned Map.
 */
export async function getCachedGuesses(
  payees: string[],
): Promise<Map<string, {cat: string; sub?: string; confidence: string}>> {
  if (!payees.length) return new Map();
  const d = await db();
  const cutoff = Date.now() - TTL_MS;
  const placeholders = payees.map(() => "?").join(",");
  const rows = await d.getAllAsync<GuessRow>(
    `SELECT payee, cat, sub, confidence FROM org_guess WHERE payee IN (${placeholders}) AND at > ?`,
    ...payees, cutoff,
  );
  return new Map(rows.map(r => [r.payee, {cat: r.cat, ...(r.sub ? {sub: r.sub} : {}), confidence: r.confidence}]));
}

/**
 * Upserts AI classification results into org_guess, overwriting any stale entry for the same payee.
 * Runs in a single transaction — a failure leaves the cache unchanged.
 */
export async function saveCachedGuesses(
  guesses: Map<string, {cat: string; sub?: string; confidence: Confidence}>,
): Promise<void> {
  if (!guesses.size) return;
  const d = await db();
  const at = Date.now();
  await d.withTransactionAsync(async () => {
    for (const [payee, {cat, sub, confidence}] of guesses) {
      await d.runAsync(
        "INSERT OR REPLACE INTO org_guess (payee, cat, sub, confidence, at) VALUES (?, ?, ?, ?, ?)",
        payee, cat, sub ?? null, confidence, at,
      );
    }
  });
}
