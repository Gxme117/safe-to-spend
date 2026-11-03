import type {SQLiteDatabase} from "expo-sqlite";

const VERSION = 6;

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
  if (v === 1) {
    // Payments imported from Monzo keep its id, so a sync never adds one twice.
    await db.execAsync(`
      ALTER TABLE tx ADD COLUMN monzo_id TEXT;
      ALTER TABLE tx ADD COLUMN needs_cat INTEGER NOT NULL DEFAULT 0;
      CREATE UNIQUE INDEX tx_monzo ON tx (monzo_id) WHERE monzo_id IS NOT NULL;
    `);
    v = 2;
  }
  if (v === 2) {
    // When a Monzo payment actually happened, so lists order by that rather than by the sync that brought it in.
    await db.execAsync("ALTER TABLE tx ADD COLUMN paid_at INTEGER");
    v = 3;
  }
  if (v === 3) {
    // The shop's logo link Monzo sends with a payment.
    await db.execAsync("ALTER TABLE tx ADD COLUMN logo TEXT");
    v = 4;
  }
  if (v === 4) {
    // Money in that's a refund or someone paying you back: the category it goes back to.
    await db.execAsync("ALTER TABLE tx ADD COLUMN refund_of TEXT");
    v = 5;
  }
  if (v === 5) {
    // Tim and Frank's chats, kept 30 days: `body` is the words, for search; `said` (what's on screen) and `transcript` (what
    // Claude saw, so a chat can be carried on) are JSON.
    await db.execAsync(`
      CREATE TABLE chat (
        id         TEXT PRIMARY KEY NOT NULL,
        who        TEXT NOT NULL,
        title      TEXT NOT NULL,
        created    INTEGER NOT NULL,
        updated    INTEGER NOT NULL,
        body       TEXT NOT NULL,
        said       TEXT NOT NULL,
        transcript TEXT NOT NULL
      );
      CREATE INDEX chat_updated ON chat (updated);
    `);
    v = 6;
  }
  // if (v === 6) { next migration; v = 7; }
  await db.execAsync(`PRAGMA user_version = ${VERSION}`);
}
