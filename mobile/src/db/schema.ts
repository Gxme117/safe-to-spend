import type {SQLiteDatabase} from "expo-sqlite";

const VERSION = 1;

/** Brings the database up to VERSION, one step at a time (pattern from the expo-sqlite docs). */
export async function migrate(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{user_version: number}>("PRAGMA user_version");
  let v = row?.user_version ?? 0;
  if (v >= VERSION) return;
  if (v === 0) {
    // Amounts are whole pence, so sums never pick up floating-point dust.
    await db.execAsync(`
      PRAGMA journal_mode = 'wal';
      CREATE TABLE tx (
        id        TEXT PRIMARY KEY NOT NULL,
        type      TEXT NOT NULL CHECK (type IN ('expense', 'income', 'save')),
        amount_p  INTEGER NOT NULL CHECK (amount_p >= 0),
        cat       TEXT NOT NULL,
        note      TEXT NOT NULL DEFAULT '',
        date      TEXT NOT NULL,
        created   INTEGER NOT NULL,
        bill_id   TEXT,
        for_date  TEXT,
        src_id    TEXT
      );
      CREATE INDEX tx_date ON tx (date);
    `);
    v = 1;
  }
  // if (v === 1) { next migration; v = 2; }
  await db.execAsync(`PRAGMA user_version = ${VERSION}`);
}
