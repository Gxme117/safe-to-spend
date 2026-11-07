import type {SQLiteDatabase} from "expo-sqlite";

const VERSION = 9;

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
  if (v === 6) {
    // Merchant-category rules: a payee name the user taught (normalised) → the category to file it under.
    // Checked before NAME_HINTS at import time, so corrections stick for future payments.
    await db.execAsync(`
      CREATE TABLE merchant_rule (
        payee   TEXT PRIMARY KEY NOT NULL,
        cat     TEXT NOT NULL,
        created INTEGER NOT NULL
      );
    `);
    v = 7;
  }
  if (v === 7) {
    // Which subcategory a payment or rule belongs to.
    await db.execAsync(
      "ALTER TABLE tx ADD COLUMN sub_cat TEXT; ALTER TABLE merchant_rule ADD COLUMN sub_cat TEXT",
    );
    v = 8;
  }
  if (v === 8) {
    // Organisation runs: Frank sorting your payment backlog. Each run is atomic; org_change records what changed and
    // how, so the whole batch can be undone. org_guess caches AI merchant classifications for 30 days.
    await db.execAsync(`
      CREATE TABLE org_run (
        id          TEXT PRIMARY KEY NOT NULL,
        at          INTEGER NOT NULL,
        state       TEXT NOT NULL CHECK (state IN ('applied', 'undone')),
        reviewed    INTEGER NOT NULL DEFAULT 0,
        auto        INTEGER NOT NULL DEFAULT 0,
        provisional INTEGER NOT NULL DEFAULT 0,
        left        INTEGER NOT NULL DEFAULT 0,
        more        INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE org_change (
        run_id     TEXT NOT NULL,
        tx_id      TEXT NOT NULL,
        from_cat   TEXT NOT NULL,
        from_sub   TEXT,
        from_needs INTEGER NOT NULL DEFAULT 0,
        to_cat     TEXT NOT NULL,
        to_sub     TEXT,
        confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
        source     TEXT NOT NULL CHECK (source IN ('rule', 'hint', 'ai')),
        status     TEXT NOT NULL CHECK (status IN ('auto', 'provisional', 'confirmed', 'corrected', 'left', 'undone')),
        rule_payee TEXT,
        rule_prev  TEXT,
        PRIMARY KEY (run_id, tx_id)
      );
      CREATE INDEX org_change_tx ON org_change (tx_id);
      CREATE TABLE org_guess (
        payee      TEXT PRIMARY KEY NOT NULL,
        cat        TEXT NOT NULL,
        sub        TEXT,
        confidence TEXT NOT NULL,
        at         INTEGER NOT NULL
      );
    `);
    v = 9;
  }
  await db.execAsync(`PRAGMA user_version = ${VERSION}`);
}
