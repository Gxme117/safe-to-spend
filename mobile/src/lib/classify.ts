// Pure classify helpers for M2 Smart Organisation: which payees need AI, and how to sanitize AI confidence.
// No DB, no network. Pure — imported by the store and unit-tested directly.
import {matchMerchantRule, normalizePayee} from "./categoryChange";
import {nameHint, resolve} from "./categories";
import {eligible, isAmbiguous, type Confidence} from "./organise";
import {spendCats} from "./payments";
import type {AppState, MerchantRule, Tx} from "./types";

/**
 * Normalized payee strings that fall through rule → hint in buildRun (step 4: low).
 * These are the ones to send to AI — no one that already has a rule or hint, and no ambiguous merchants
 * (payment processors, Apple Pay, etc.) that AI can't reliably classify.
 * Deduplicates across txs: each normalized key appears once.
 */
export function unresolvedPayees(txs: Tx[], rules: MerchantRule[], state: AppState): string[] {
  const els = eligible(txs);
  const cats = spendCats(state);
  const out = new Set<string>();

  for (const tx of els) {
    const norm = normalizePayee(tx.note);
    if (!norm || !/[a-z]/.test(norm)) continue; // ungroupable → low anyway

    // 1. Has a merchant rule? → high confidence in buildRun, skip
    const ruleMatch = matchMerchantRule(rules, tx.note);
    if (ruleMatch && cats.find(c => c.id === ruleMatch.cat)) continue;

    // 2. Has a name hint? → medium confidence in buildRun, skip
    const hint = nameHint(tx.note);
    if (hint) {
      const resolved = resolve(state.categories, hint);
      if (resolved && cats.find(c => c.id === resolved.id)) continue;
    }

    // 3. Ambiguous payee (PayPal, Square, etc.)? → AI can't help, skip
    if (isAmbiguous(norm)) continue;

    out.add(norm);
  }

  return [...out];
}

/**
 * Deterministic confidence cap applied to an AI-returned confidence value, before caching.
 * - Ambiguous payees are never high (payment processors, generic aggregators).
 * - buildRun applies the same isAmbiguous check again, so this is defence-in-depth.
 */
export function sanitizeConfidence(norm: string, raw: Confidence): Confidence {
  if (raw === "low") return "low";
  if (isAmbiguous(norm)) return "medium";
  return raw;
}

/**
 * Maps over raw API/cache results to produce the guesses map buildRun expects.
 * Applies sanitizeConfidence; discards entries whose confidence string isn't valid.
 */
export function sanitizeGuesses(
  raw: Map<string, {cat: string; sub?: string; confidence: string}>,
): Map<string, {cat: string; sub?: string; confidence: Confidence}> {
  const out = new Map<string, {cat: string; sub?: string; confidence: Confidence}>();
  for (const [norm, v] of raw) {
    if (!["high", "medium", "low"].includes(v.confidence)) continue;
    const conf = sanitizeConfidence(norm, v.confidence as Confidence);
    out.set(norm, {cat: v.cat, ...(v.sub ? {sub: v.sub} : {}), confidence: conf});
  }
  return out;
}
