# Money tracker: notes for Claude Code

## What this is
A personal finance app whose first job is answering **"what can I spend today?"**.
Solo user (UK, Monzo), designed so a partner can be added later.

## How it runs
- Published as a Claude artifact: one self-contained HTML file built from `src/` by `npm run build`.
- Runtime APIs come from the artifact host, not the browser:
  - `window.claude` database: per-user data under `data/users/me` (`state` doc, plus `tx-YYYY-MM` docs per month).
  - `mcp` host connector `host:monzo` (only in the Claude desktop app): `monzo_get_balance`, `monzo_list_pots`, `monzo_list_transactions`.
- No network requests to other sites, no remote images. Fonts: Google Fonts only.

## The money model
- Groups: **Bills** (fixed, dated), **Savings** (pots with role `save`), **Everyday** (monthly amount the user chooses), **Free** (the rest).
- Daily number = (spending money - unpaid bills before payday - what's left of everyday amounts) / days to payday.
- Spending money = main account + pots with role `spend`. Savings/business pots are never spending money.
- Priority when short: bills, then everyday; savings is the back-up. Tell the user how much to move.
- Never count money that hasn't arrived. Ask instead of guessing (e.g. unsorted payments).
- Never scold. Spending big one day just lowers later days; no "overspending" language.

## Design rules
- Font: Manrope. Spacing on a 4pt grid (`--s1`..`--s7` = 4/8/12/16/24/32/48).
- Accent colour (`--btn-bg` / `--btn-ink`) means "money that's yours to use or coming in". Use it sparingly.
- Every number says why in one plain sentence. Notes under the big number stay on one line.
- Light and dark mode both matter. Respect `prefers-reduced-motion`.
- Don't recreate other companies' logos, card designs or brand colours.

## Workflow
Edit `src/`, run `npm run build`, check `dist/money-tracker.html`, commit.
Publishing to the live link is done from the Claude chat.

## Mobile app (`mobile/`)
An Expo (SDK 57) + React Native + TypeScript version of the core loop. It lives beside the web app; the web app stays the live one.
The money model and design rules above apply to both. For Expo itself, follow `mobile/AGENTS.md`: check the versioned docs, install with `npx expo install`.
- `src/lib/`: the money engine, pure TypeScript ported from `src/app.js`. Every function takes `{state, txs, today}`, never globals. Keep its results matching the web app's.
- `src/db/`: payments in SQLite (`tx` table, amounts in whole pence, migrations via `PRAGMA user_version`). Pence to pounds happens only in `db/transactions.ts`.
- `src/store/`: Zustand. The settings doc (same shape as the web `state` doc) persists through `expo-sqlite/kv-store`. Payments are written to SQLite before the store updates.
- `src/app/`: routes only (Expo Router). Tests never go in here, or they become routes.
- Not in v1: Monzo (the `host:monzo` connector only exists inside Claude), savings pots, declines, the Future view.
- Before calling a change done: `cd mobile && npm test && npm run typecheck && npm run lint`. Run it with `npx expo start` (Expo Go or the iOS simulator).
