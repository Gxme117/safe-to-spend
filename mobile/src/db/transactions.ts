import {openDatabaseAsync, type SQLiteDatabase} from "expo-sqlite";
import {fromPence, toPence} from "@/lib/money";
import type {IsoDate, Tx, TxType} from "@/lib/types";
import {migrate} from "./schema";

let opening: Promise<SQLiteDatabase> | null = null;
/** Opens money.db once and migrates it before anything reads it. */
const db = () => (opening ??= openDatabaseAsync("money.db").then(async d => { await migrate(d); return d; }));

interface Row {
  id: string; type: TxType; amount_p: number; cat: string; note: string; date: string; created: number;
  bill_id: string | null; for_date: string | null; src_id: string | null; monzo_id: string | null; needs_cat: number; paid_at: number | null; logo: string | null;
}

// Pence in the database, pounds in the app: the conversion happens here and nowhere else.
const fromRow = (r: Row): Tx => ({
  id: r.id, type: r.type, amount: fromPence(r.amount_p), cat: r.cat, note: r.note, date: r.date, created: r.created,
  ...(r.bill_id ? {billId: r.bill_id} : {}), ...(r.for_date ? {forDate: r.for_date} : {}), ...(r.src_id ? {srcId: r.src_id} : {}),
  ...(r.monzo_id ? {monzoId: r.monzo_id} : {}), ...(r.needs_cat ? {needsCat: true} : {}), ...(r.paid_at ? {paidAt: r.paid_at} : {}), ...(r.logo ? {logo: r.logo} : {}),
});

export async function listSince(from: IsoDate): Promise<Tx[]> {
  const rows = await (await db()).getAllAsync<Row>("SELECT * FROM tx WHERE date >= ? ORDER BY date, created", from);
  return rows.map(fromRow);
}

const INSERT = "INTO tx (id, type, amount_p, cat, note, date, created, bill_id, for_date, src_id, monzo_id, needs_cat, paid_at, logo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
const values = (t: Tx) => [
  t.id, t.type, toPence(t.amount), t.cat, t.note, t.date, t.created, t.billId ?? null, t.forDate ?? null, t.srcId ?? null,
  t.monzoId ?? null, t.needsCat ? 1 : 0, t.paidAt ?? null, t.logo ?? null,
];

export async function insertTx(t: Tx) {
  await (await db()).runAsync("INSERT " + INSERT, ...values(t));
}

/** Saves a sync's payments all together or not at all. Returns the ones that were new (a Monzo id already saved is skipped). */
export async function insertMany(txs: Tx[]): Promise<Tx[]> {
  const d = await db(), added: Tx[] = [];
  await d.withTransactionAsync(async () => {
    for (const t of txs) if ((await d.runAsync("INSERT OR IGNORE " + INSERT, ...values(t))).changes) added.push(t);
  });
  return added;
}

/** Fills in when Monzo payments really happened and their logo, for ones saved before those were kept. Never overwrites. */
export async function backfill(fills: {monzoId: string; paidAt?: number; logo?: string}[]) {
  if (!fills.length) return;
  const d = await db();
  await d.withTransactionAsync(async () => {
    for (const f of fills) {
      await d.runAsync("UPDATE tx SET paid_at = COALESCE(paid_at, ?), logo = COALESCE(logo, ?) WHERE monzo_id = ?", f.paidAt ?? null, f.logo ?? null, f.monzoId);
    }
  });
}

export async function deleteTx(id: string) {
  await (await db()).runAsync("DELETE FROM tx WHERE id = ?", id);
}

/** Deletes every payment: used when starting again. */
export async function deleteAllTx() {
  await (await db()).runAsync("DELETE FROM tx");
}
