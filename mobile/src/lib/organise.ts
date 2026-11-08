// Frank's Smart Organisation: bulk classification engine and report builder. Pure — no DB, no side effects.
import {matchMerchantRule, normalizePayee} from "./categoryChange";
import {nameHint, resolve, resolveSubCat} from "./categories";
import {spendCats} from "./payments";
import type {AppState, Ctx, IsoDate, MerchantRule, Tx} from "./types";

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

/** A change's shop, the way the preview card keys it: its saved-rule payee, else the payment's own name, normalised. */
export const changeKey = (c: OrgChange, txs: Map<string, Tx>): string => {
  const t = txs.get(c.txId);
  return c.rulePayee ?? (t ? normalizePayee(t.note) : "");
};

/**
 * The run with a shop's payments put where the person said (Edit on the preview card, before Confirm). Theirs is the category
 * now, so those changes count as sure (and a rule for the shop, if it gets one, teaches their choice). Low ones, which are left
 * alone, and every shop not edited are untouched.
 */
export function withEdits(run: OrgRun, txs: Tx[], edits?: Record<string, {cat: string; sub?: string}>): OrgRun {
  if (!edits || !Object.keys(edits).length) return run;
  const byId = new Map(txs.map(t => [t.id, t]));
  return {...run, changes: run.changes.map(c => {
    const e = c.confidence === "low" ? undefined : edits[changeKey(c, byId)];
    return e ? {...c, toCat: e.cat, toSub: e.sub, confidence: "high" as const} : c;
  })};
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

/** One merchant group surfaced in the preview card — high or medium confidence only. */
export interface OrgExample {
  key: string;         // normalised payee key (used for skip tracking)
  note: string;        // representative tx note, truncated to 28 chars
  toCatId: string;
  toCatName: string;
  toSubId?: string;
  toSubName?: string;
  confidence: Confidence;
  count: number;       // number of payments from this merchant in the run
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
  rows: string[];     // every payment sorted by this run (high + medium), newest first; the card reads each one's live filing
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

    // 2. Name hint (patterns in categories.ts: "COSTA" is coffee, "SHELL" is fuel) → sorted, the same as a rule. Frank sorts what
    // he can read and the person sees it before it's saved (and can edit any of it), so "needs review" is kept for what he
    // really can't tell. A shop that's a rule-worthy name teaches him it; a processor like PayPal or Amazon doesn't.
    // resolve() maps catalog ids (e.g. "eating") to the user's matching category, handling renames
    const hint = nameHint(representative.note);
    if (hint) {
      const cat = resolve(ctx.state.categories, hint);
      // only proceed if the resolved category is a spend category (not fixed)
      if (cat && cats.find(c => c.id === cat.id)) {
        const rulePayee = !isAmbiguous(norm) ? norm : undefined;
        for (const tx of group) {
          changes.push({txId: tx.id, fromCat: tx.cat, fromSub: tx.subCat, fromNeeds: !!tx.needsCat, toCat: cat.id, confidence: "high", source: "hint", ...(rulePayee ? {rulePayee} : {})});
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

/**
 * Every shop the run would sort, for the preview card: one entry per normalised payee key, with how many payments it covers.
 * The ones he's unsure of come first (they're what the person may want to look at), then the sure ones. Nothing is left out:
 * the card pages through them.
 * txs must be the same slice used to build the run.
 */
export function buildPreviewExamples(run: OrgRun, txs: Tx[], state: AppState): OrgExample[] {
  const cats = spendCats(state);
  const txMap = new Map(txs.map(t => [t.id, t]));

  // Group changes by normalised payee key; keep first representative tx per key.
  const highGroups = new Map<string, {change: OrgChange; count: number; rep: Tx}>();
  const mediumGroups = new Map<string, {change: OrgChange; count: number; rep: Tx}>();

  for (const change of run.changes) {
    if (change.confidence !== "high" && change.confidence !== "medium") continue;
    const tx = txMap.get(change.txId);
    if (!tx) continue;
    const key = normalizePayee(tx.note) || change.txId;
    const target = change.confidence === "high" ? highGroups : mediumGroups;
    const existing = target.get(key);
    if (existing) {
      existing.count++;
    } else {
      target.set(key, {change, count: 1, rep: tx});
    }
  }

  const toExample = (key: string, {change, count, rep}: {change: OrgChange; count: number; rep: Tx}): OrgExample => {
    const cat = cats.find(c => c.id === change.toCat);
    const sub = change.toSub ? resolveSubCat(state.categories, change.toCat, change.toSub) : undefined;
    const note = rep.note.length > 28 ? rep.note.slice(0, 27) + "…" : rep.note;
    return {
      key,
      note,
      toCatId: change.toCat,
      toCatName: cat?.name ?? change.toCat,
      ...(sub ? {toSubId: sub.id, toSubName: sub.name} : {}),
      confidence: change.confidence,
      count,
    };
  };

  const highExamples = [...highGroups.entries()].map(([k, v]) => toExample(k, v));
  const mediumExamples = [...mediumGroups.entries()].map(([k, v]) => toExample(k, v));

  return [...mediumExamples, ...highExamples];
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
    rows: applied
      .map(c => txMap.get(c.txId))
      .filter((t): t is Tx => !!t)
      .sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : b.created - a.created)
      .map(t => t.id),
  };
}
