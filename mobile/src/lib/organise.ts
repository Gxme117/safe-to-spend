// Frank's Smart Organisation: bulk classification engine and report builder. Pure — no DB, no side effects.
import {matchMerchantRule, normalizePayee} from "./categoryChange";
import {nameHint, resolve, resolveSubCat} from "./categories";
import {spendCats} from "./payments";
import type {Ctx, IsoDate, MerchantRule, Tx} from "./types";

export type Confidence = "high" | "medium" | "low";
export type ClassifySource = "rule" | "hint" | "ai";

export interface OrgChange {
  txId: string;
  fromCat: string;
  fromSub?: string;
  fromNeeds: boolean;    // was needsCat before the run
  toCat: string;         // same as fromCat when low
  toSub?: string;
  confidence: Confidence;
  source: ClassifySource;
  rulePayee?: string;    // normalised payee to save a rule for (medium: saved on "These look right" in M4; high AI: saved with run in M2)
  rulePrev?: string;     // JSON of the merchant_rule row that was replaced, for undo (M2+)
}

export interface OrgRun {
  id: string;
  changes: OrgChange[];  // includes low-confidence for the report (not persisted to DB)
  more: number;          // eligible txs beyond the per-run cap
}

export interface OrgPreview {
  runId: string;
  high: number;
  medium: number;
  low: number;
  total: number;  // toProcess count (up to MAX_ELIGIBLE)
  more: number;
}

export interface OrgRow {
  txId: string;
  note: string;
  date: IsoDate;
  amount: number;
  to?: string;
  toSub?: string;
  why: string;
}

export interface OrgReport {
  runId: string;
  at: number;
  reviewed: number;
  auto: number;
  provisional: number;
  left: number;
  more: number;
  failed: number;
  byCat: {cat: string; name: string; count: number; total: number; subs: {sub: string; name: string; count: number; total: number}[]}[];
  check: OrgRow[];    // provisional, biggest first
  unclear: OrgRow[];  // low / unresolvable, up to 10
}

const MAX_ELIGIBLE = 500;

// Payment processors and aggregators: a merchant rule at their key would catch too many different things.
const AMBIGUOUS_EXACT = new Set([
  "paypal", "amazon", "klarna", "clearpay", "laybuy", "sumup", "zettle",
  "stripe", "revolut", "monzo", "wise", "worldpay", "sagepay",
]);
const AMBIGUOUS_PREFIX = ["sq ", "sq*", "google", "apple pay", "apple.com"];

/** True when a normalised payee key is too generic to save as a merchant rule. */
export function isAmbiguous(norm: string): boolean {
  if (!norm || norm.length < 4 || !/[a-z]/.test(norm)) return true;
  if (AMBIGUOUS_EXACT.has(norm)) return true;
  // "paypal cafe" → first word is "paypal" → still a PayPal transaction, rule would be too broad
  const firstWord = norm.split(" ")[0];
  if (AMBIGUOUS_EXACT.has(firstWord)) return true;
  return AMBIGUOUS_PREFIX.some(p => norm.startsWith(p));
}

/** Payments waiting to be categorised, oldest first. Bill-linked, refunds, income and already-sorted are excluded. */
export function eligible(txs: Tx[]): Tx[] {
  return txs
    .filter(t => t.type === "expense" && !!t.needsCat && !t.billId && !t.refundOf)
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

/**
 * Classify eligible payments using merchant rules, name hints, and optionally AI guesses.
 * Returns an OrgRun (the data to apply, not yet written) and an OrgPreview (counts for the confirmation UI).
 * Pass `guesses` for cached AI results (M2+); M1 leaves everything AI can't place as low-confidence.
 */
export function buildRun(
  id: string,
  txs: Tx[],
  ctx: Ctx,
  rules: MerchantRule[],
  guesses?: Map<string, {cat: string; sub?: string; confidence: Confidence}>,
): {run: OrgRun; preview: OrgPreview} {
  const all = eligible(txs);
  const toProcess = all.slice(0, MAX_ELIGIBLE);
  const more = Math.max(0, all.length - MAX_ELIGIBLE);
  const cats = spendCats(ctx.state);

  // Group by normalised payee key; ungroupable keys (all-numeric, empty) go straight to low
  const groups = new Map<string, Tx[]>();
  const lowTxs: Tx[] = [];

  for (const tx of toProcess) {
    const norm = normalizePayee(tx.note);
    if (!norm || !/[a-z]/.test(norm)) {
      lowTxs.push(tx);
    } else {
      const g = groups.get(norm) ?? [];
      g.push(tx);
      groups.set(norm, g);
    }
  }

  const changes: OrgChange[] = [];

  for (const tx of lowTxs) {
    changes.push({txId: tx.id, fromCat: tx.cat, fromSub: tx.subCat, fromNeeds: !!tx.needsCat, toCat: tx.cat, toSub: tx.subCat, confidence: "low", source: "rule"});
  }

  for (const [norm, group] of groups) {
    const representative = group[0];

    // 1. Existing merchant rule → high confidence (rule already written, no new one needed)
    const ruleMatch = matchMerchantRule(rules, representative.note);
    if (ruleMatch) {
      const cat = cats.find(c => c.id === ruleMatch.cat);
      if (cat) {
        const toSub = ruleMatch.subCat
          ? (resolveSubCat(ctx.state.categories, ruleMatch.cat, ruleMatch.subCat) ? ruleMatch.subCat : undefined)
          : undefined;
        for (const tx of group) {
          changes.push({txId: tx.id, fromCat: tx.cat, fromSub: tx.subCat, fromNeeds: !!tx.needsCat, toCat: ruleMatch.cat, toSub, confidence: "high", source: "rule"});
        }
        continue;
      }
    }

    // 2. Name hint (regex patterns in categories.ts) → medium confidence; store rulePayee for future rule
    // resolve() maps catalog ids (e.g. "eating") to the user's matching category, handling renames
    const hint = nameHint(representative.note);
    if (hint) {
      const cat = resolve(ctx.state.categories, hint);
      // only proceed if the resolved category is a spend category (not fixed)
      if (cat && cats.find(c => c.id === cat.id)) {
        const rulePayee = !isAmbiguous(norm) ? norm : undefined;
        for (const tx of group) {
          changes.push({txId: tx.id, fromCat: tx.cat, fromSub: tx.subCat, fromNeeds: !!tx.needsCat, toCat: cat.id, confidence: "medium", source: "hint", ...(rulePayee ? {rulePayee} : {})});
        }
        continue;
      }
    }

    // 3. Cached AI guess (M2+) — gated in code: cat must be in spendCats, subCat must exist
    const guess = guesses?.get(norm);
    if (guess) {
      const cat = cats.find(c => c.id === guess.cat);
      if (cat) {
        const toSub = guess.sub ? (resolveSubCat(ctx.state.categories, guess.cat, guess.sub) ? guess.sub : undefined) : undefined;
        const conf = guess.confidence === "high" && !isAmbiguous(norm) ? "high" : guess.confidence === "low" ? "low" : "medium";
        const rulePayee = conf === "high" && !isAmbiguous(norm) ? norm : conf === "medium" && !isAmbiguous(norm) ? norm : undefined;
        for (const tx of group) {
          changes.push({txId: tx.id, fromCat: tx.cat, fromSub: tx.subCat, fromNeeds: !!tx.needsCat, toCat: guess.cat, toSub, confidence: conf, source: "ai", ...(rulePayee ? {rulePayee} : {})});
        }
        continue;
      }
    }

    // 4. Unknown → low (AI call will be added in M2)
    for (const tx of group) {
      changes.push({txId: tx.id, fromCat: tx.cat, fromSub: tx.subCat, fromNeeds: !!tx.needsCat, toCat: tx.cat, toSub: tx.subCat, confidence: "low", source: "rule"});
    }
  }

  const high = changes.filter(c => c.confidence === "high").length;
  const medium = changes.filter(c => c.confidence === "medium").length;
  const low = changes.filter(c => c.confidence === "low").length;

  return {
    run: {id, changes, more},
    preview: {runId: id, high, medium, low, total: toProcess.length, more},
  };
}

/** Build the Organisation Report from the run's changes and the current txs (after the run is applied). Pure. */
export function orgReport(ctx: Ctx, run: OrgRun): OrgReport {
  const cats = spendCats(ctx.state);
  const applied = run.changes.filter(c => c.confidence !== "low");

  type CatEntry = {count: number; total: number; subs: Map<string, {count: number; total: number}>};
  const catMap = new Map<string, CatEntry>();
  const txMap = new Map(ctx.txs.map(t => [t.id, t]));

  for (const change of applied) {
    const tx = txMap.get(change.txId);
    if (!tx) continue;
    const entry: CatEntry = catMap.get(change.toCat) ?? {count: 0, total: 0, subs: new Map()};
    entry.count++;
    entry.total += tx.amount;
    if (change.toSub) {
      const sub = entry.subs.get(change.toSub) ?? {count: 0, total: 0};
      sub.count++;
      sub.total += tx.amount;
      entry.subs.set(change.toSub, sub);
    }
    catMap.set(change.toCat, entry);
  }

  const byCat = [...catMap.entries()]
    .sort(([, a], [, b]) => b.count - a.count)
    .map(([catId, entry]) => {
      const cat = cats.find(c => c.id === catId);
      return {
        cat: catId,
        name: cat?.name ?? catId,
        count: entry.count,
        total: entry.total,
        subs: [...entry.subs.entries()]
          .sort(([, a], [, b]) => b.count - a.count)
          .map(([subId, s]) => {
            const sub = resolveSubCat(ctx.state.categories, catId, subId);
            return {sub: subId, name: sub?.name ?? subId, count: s.count, total: s.total};
          }),
      };
    });

  const check: OrgRow[] = run.changes
    .filter(c => c.confidence === "medium")
    .map(c => {
      const tx = txMap.get(c.txId);
      const cat = cats.find(cc => cc.id === c.toCat);
      const sub = c.toSub ? resolveSubCat(ctx.state.categories, c.toCat, c.toSub) : undefined;
      return {txId: c.txId, note: tx?.note ?? "", date: (tx?.date ?? "") as IsoDate, amount: tx?.amount ?? 0, to: cat?.name, toSub: sub?.name, why: "Name matches"};
    })
    .sort((a, b) => b.amount - a.amount);

  const unclear: OrgRow[] = run.changes
    .filter(c => c.confidence === "low")
    .slice(0, 10)
    .map(c => {
      const tx = txMap.get(c.txId);
      return {txId: c.txId, note: tx?.note ?? "", date: (tx?.date ?? "") as IsoDate, amount: tx?.amount ?? 0, why: ""};
    });

  return {
    runId: run.id,
    at: Date.now(),
    reviewed: run.changes.length,
    auto: run.changes.filter(c => c.confidence === "high").length,
    provisional: run.changes.filter(c => c.confidence === "medium").length,
    left: run.changes.filter(c => c.confidence === "low").length,
    more: run.more,
    failed: 0,
    byCat,
    check,
    unclear,
  };
}
