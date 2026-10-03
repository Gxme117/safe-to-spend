import {openDatabaseAsync, type SQLiteDatabase} from "expo-sqlite";
import {fromPence, toPence} from "@/lib/money";
import type {IsoDate, Tx, TxType} from "@/lib/types";
import {migrate} from "./schema";

let opening: Promise<SQLiteDatabase> | null = null;
/** Opens money.db once and migrates it before anything reads it. */
const db = () => (opening ??= openDatabaseAsync("money.db").then(async d => { await migrate(d); return d; }));

interface Row {
  id: string; type: TxType; amount_p: number; cat: string; note: string; date: string; created: number;
  bill_id: string | null; for_date: string | null; src_id: string | null;
}

// Pence in the database, pounds in the app: the conversion happens here and nowhere else.
const fromRow = (r: Row): Tx => ({
  id: r.id, type: r.type, amount: fromPence(r.amount_p), cat: r.cat, note: r.note, date: r.date, created: r.created,
  ...(r.bill_id ? {billId: r.bill_id} : {}), ...(r.for_date ? {forDate: r.for_date} : {}), ...(r.src_id ? {srcId: r.src_id} : {}),
});

export async function listSince(from: IsoDate): Promise<Tx[]> {
  const rows = await (await db()).getAllAsync<Row>("SELECT * FROM tx WHERE date >= ? ORDER BY date, created", from);
  return rows.map(fromRow);
}

export async function insertTx(t: Tx) {
  await (await db()).runAsync(
    "INSERT INTO tx (id, type, amount_p, cat, note, date, created, bill_id, for_date, src_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    t.id, t.type, toPence(t.amount), t.cat, t.note, t.date, t.created, t.billId ?? null, t.forDate ?? null, t.srcId ?? null,
  );
}

export async function deleteTx(id: string) {
  await (await db()).runAsync("DELETE FROM tx WHERE id = ?", id);
}
