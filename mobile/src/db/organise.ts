// Persistence for Frank's Smart Organisation runs. All changes are atomic: apply and undo are all-or-nothing.
import type {OrgRun} from "@/lib/organise";
import {db} from "./open";

interface RunRow {
  id: string; at: number; state: string;
  reviewed: number; auto: number; provisional: number; left: number; more: number;
}

interface ChangeRow {
  run_id: string; tx_id: string; from_cat: string; from_sub: string | null; from_needs: number;
  to_cat: string; to_sub: string | null; confidence: string; source: string; status: string;
  rule_payee: string | null; rule_prev: string | null;
}

/**
 * Write an org run and its high/medium changes to the DB, then file the payments.
 * Low-confidence changes are never written (they don't touch the tx table).
 * skippedTxIds: txIds of medium-confidence payments the user chose to skip; they are excluded from apply.
 * All writes are in one transaction — a crash leaves nothing half-applied.
 */
export async function applyRun(run: OrgRun, at: number, skippedTxIds?: Set<string>): Promise<void> {
  const d = await db();
  const toApply = run.changes.filter(c => c.confidence !== "low" && !skippedTxIds?.has(c.txId));
  const auto = toApply.filter(c => c.confidence === "high").length;
  const provisional = toApply.filter(c => c.confidence === "medium").length;
  const skippedCount = skippedTxIds?.size ?? 0;
  const left = run.changes.filter(c => c.confidence === "low").length + skippedCount;

  await d.withTransactionAsync(async () => {
    // 1. Write the run header
    await d.runAsync(
      "INSERT INTO org_run (id, at, state, reviewed, auto, provisional, left, more) VALUES (?, ?, 'applied', ?, ?, ?, ?, ?)",
      run.id, at, run.changes.length, auto, provisional, left, run.more,
    );

    // 2. Write each high/medium change and file the payment
    for (const c of toApply) {
      const status = c.confidence === "high" ? "auto" : "provisional";
      await d.runAsync(
        `INSERT INTO org_change
           (run_id, tx_id, from_cat, from_sub, from_needs, to_cat, to_sub, confidence, source, status, rule_payee, rule_prev)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        run.id, c.txId, c.fromCat, c.fromSub ?? null, c.fromNeeds ? 1 : 0,
        c.toCat, c.toSub ?? null, c.confidence, c.source, status,
        c.rulePayee ?? null, c.rulePrev ?? null,
      );
      // File the payment (same statement as fileBills / updateFiling)
      await d.runAsync(
        "UPDATE tx SET cat = ?, sub_cat = ?, bill_id = NULL, for_date = NULL, src_id = NULL, refund_of = NULL, needs_cat = 0 WHERE id = ?",
        c.toCat, c.toSub ?? null, c.txId,
      );
    }

    // 3. Save high-confidence merchant rules (medium rules saved separately when user confirms)
    for (const c of toApply.filter(ch => ch.confidence === "high" && ch.rulePayee)) {
      await d.runAsync(
        "INSERT OR REPLACE INTO merchant_rule (payee, cat, sub_cat, created) VALUES (?, ?, ?, ?)",
        c.rulePayee!, c.toCat, c.toSub ?? null, at,
      );
    }
  });
}

/**
 * Undo all auto/provisional changes from a run that haven't been modified since.
 * Returns the number of payments restored and how many were skipped (corrected by the user).
 */
export async function undoRun(runId: string): Promise<{restored: number; skipped: number}> {
  const d = await db();
  let restored = 0, skipped = 0;

  await d.withTransactionAsync(async () => {
    // Load the applied changes (auto and provisional only; confirmed and corrected were user choices)
    const rows = await d.getAllAsync<ChangeRow & {tx_cat: string | null; tx_sub: string | null}>(
      `SELECT oc.*, t.cat AS tx_cat, t.sub_cat AS tx_sub
       FROM org_change oc
       LEFT JOIN tx t ON t.id = oc.tx_id
       WHERE oc.run_id = ? AND oc.status IN ('auto', 'provisional')`,
      runId,
    );

    for (const row of rows) {
      // If the payment no longer has the category the run set, the user changed it — skip
      if (row.tx_cat !== row.to_cat || (row.to_sub ?? null) !== (row.tx_sub ?? null)) {
        await d.runAsync(
          "UPDATE org_change SET status = 'corrected' WHERE run_id = ? AND tx_id = ?",
          runId, row.tx_id,
        );
        skipped++;
        continue;
      }

      // Restore the payment's original filing (restores needsCat if it had it)
      await d.runAsync(
        "UPDATE tx SET cat = ?, sub_cat = ?, bill_id = NULL, for_date = NULL, src_id = NULL, refund_of = NULL, needs_cat = ? WHERE id = ?",
        row.from_cat, row.from_sub ?? null, row.from_needs, row.tx_id,
      );

      await d.runAsync(
        "UPDATE org_change SET status = 'undone' WHERE run_id = ? AND tx_id = ?",
        runId, row.tx_id,
      );
      restored++;
    }

    // Undo high-confidence merchant rules this run saved (only if the rule still matches what the run wrote)
    const ruleRows = await d.getAllAsync<{rule_payee: string; to_cat: string; to_sub: string | null; rule_prev: string | null}>(
      "SELECT rule_payee, to_cat, to_sub, rule_prev FROM org_change WHERE run_id = ? AND confidence = 'high' AND rule_payee IS NOT NULL AND status = 'undone'",
      runId,
    );
    for (const rr of ruleRows) {
      const current = await d.getFirstAsync<{cat: string; sub_cat: string | null}>(
        "SELECT cat, sub_cat FROM merchant_rule WHERE payee = ?", rr.rule_payee,
      );
      if (!current || current.cat !== rr.to_cat || (current.sub_cat ?? null) !== (rr.to_sub ?? null)) continue;
      if (rr.rule_prev) {
        const prev = JSON.parse(rr.rule_prev) as {cat: string; subCat?: string; created: number};
        await d.runAsync(
          "INSERT OR REPLACE INTO merchant_rule (payee, cat, sub_cat, created) VALUES (?, ?, ?, ?)",
          rr.rule_payee, prev.cat, prev.subCat ?? null, prev.created,
        );
      } else {
        await d.runAsync("DELETE FROM merchant_rule WHERE payee = ?", rr.rule_payee);
      }
    }

    await d.runAsync("UPDATE org_run SET state = 'undone' WHERE id = ?", runId);
  });

  return {restored, skipped};
}

/** Most recent applied run, or null if there is none. */
export async function recentRun(): Promise<{id: string; at: number; auto: number; provisional: number; left: number; more: number} | null> {
  const row = await (await db()).getFirstAsync<RunRow>(
    "SELECT * FROM org_run WHERE state = 'applied' ORDER BY at DESC LIMIT 1",
  );
  if (!row) return null;
  return {id: row.id, at: row.at, auto: row.auto, provisional: row.provisional, left: row.left, more: row.more};
}

/** Remove runs older than 90 days (and their changes). */
export async function pruneOldRuns(): Promise<void> {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const d = await db();
  await d.withTransactionAsync(async () => {
    const old = await d.getAllAsync<{id: string}>("SELECT id FROM org_run WHERE at < ?", cutoff);
    for (const r of old) await d.runAsync("DELETE FROM org_change WHERE run_id = ?", r.id);
    await d.runAsync("DELETE FROM org_run WHERE at < ?", cutoff);
  });
}
