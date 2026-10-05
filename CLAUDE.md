# Money tracker: notes for Claude Code

## What this is
A personal finance app whose first job is answering **"what can I spend today?"**.
Solo user (UK, Monzo), designed so a partner can be added later.

## How to think about the work: the Pareto principle
Before building anything, ask: what 20% of the effort gets 80% of the result?
- Pick the version of a feature that delivers most of its value for the least work, ship that, and only go further if it's clearly worth it.
- When suggesting or planning work, lead with the highest-leverage option and say what's being left out and why.
- Don't polish edge cases or build for hypotheticals before the core loop ("what can I spend today?") is solid.

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
- Blur: React Native's `filter: blur()` is behind an off-by-default flag on iOS, so it does nothing here. For a CSS `blur(Npx)`, draw the text with `react-native-svg` through `<FeGaussianBlur stdDeviation={N}>` (see `SoftAmount` in `components/Hero.tsx`). Don't fake it with stacked copies.
- Taps on text controls (like the balance eye) don't dim; only the thing that changes animates. Keep show/hide fades short (about .1s): a crossfade reads slower than the web's growing blur.
- Monzo (balance, pots and payments): a personal Monzo developer client, no server. Client ID/secret and tokens live in the Keychain (`expo-secure-store`, `src/services/monzo.ts`), never in the repo or app state. Login: Safari, then paste the `https://localhost/monzo?code=…` address back (Expo Go can't catch a fixed redirect). A sync re-anchors `balance` to main account + `spend` pots. New pots start as `spend`: setup shows the total of everything first (it can be connected from the first setup question), and you set savings pots aside after. Connected from setup (on the first question, or on "Want us to do the boring part?" just before the bills), it reads about 3 months of payments once (Monzo shares 90 days after the first 5 minutes) and suggests from them (`src/lib/found.ts`, all pure): pay (`findPays`: payers who repeat, pay-sized payments only, the most first; else the biggest `income` in 35 days and any about its size; none, no guess), payday (the pay rule that best fits: every payday it expects has a pay within 3 days, and it explains all pays but one; the reason says "around" when it isn't exact), regular payments (`findBills`: the same payee at least twice on a rule that fits, still going; direct debits at any amount, card payments and transfers only when about the same each month or 4 weeks; food and drink and weekly card spending never) and everyday spending (`findSpending`: card payments by Monzo category a month, refunds off, found bills left out). Found isn't confirmed: nothing is saved until you've seen it. Pay is asked, not assumed ("Yes, that's right", "Choose another", "I'll enter it myself"); confirmed, it's what lands each payday and the income keeps `payer`, so a synced pay from them counts as payday. Nothing found: the page is as before. Another bank provider would plug in by returning the same `SetupFound` to `setSetupBank`. New payments are imported too, and the Day tab syncs quietly on open if the last sync is over 15 minutes old. Payments keep the shop logo Monzo sends (an https link, loaded from Monzo's servers; the web app's no-remote-images rule still stands). No logo: a letter badge. Pure logic is in `src/lib/monzo.ts`.
- Tap any payment to say what it was (`app/payment/[id].tsx`, logic in `src/lib/payments.ts`). Money in isn't always income: it's pay (marks that payday arrived), own money moved, a refund or being paid back (`refundOf`: comes off that category's spending, never below 0), or other income. All of it stays `type: "income"`, so the balance never changes when it's re-filed. Unmatched Monzo credits stay "Money in" (`monzo-in`) until you sort them.
- Setup (`app/setup.tsx`): eight pages, balance, pay, payday, fixed bills (tap the ones you pay, `Picks` chips; "+ Add more" names your own on its own page), then "Your bills": a `Row` per pick and the monthly total (`billMonthly`, so £720 a year counts £60). Tap a row for a native page sheet (`components/BillSheet.tsx`): amount (the number pad opens), frequency, payment date. Edits apply as you make them. Nothing is required: with an amount, the first Done without a date opens the date picker, with a quiet "I'll add this later"; with no amount (blank or 0) Done just closes. A bill saved without an amount holds nothing back and says "No amount yet" on the Month tab until it's filled in there. Subscriptions gets its own sheet (`SubscriptionsSheet`): tap the ones you have, each at its usual UK monthly price (`SUBSCRIPTIONS` in `lib/bills.ts`, checked October 2026, names only; update the prices now and then), or add your own. Their total is one monthly Subscriptions bill with no payment date, since they go out on different days. The breakdown isn't kept after setup. A bill with no payment date (`billDated`) is never guessed onto a day: it holds back a month's share each pay cycle until a payment for it lands, and stays off the calendar. Then everyday spending (`lib/everyday.ts`): what you spend on (`Picks` from `EVERYDAY`, "+ Add more", "Skip for now"); "What do you normally spend?", a `Row` each, tap for `SpendSheet`: how much (an estimate is fine) and how often, the amount being each time, so one list covers "£60 every week" and "£15, 2–3 times a week" (no dates); then "Set your limits": each budget starts at what you usually spend a month (rounded, never lowered for you), editable in place, with the total and a week's worth. The end saves bills and everyday together: a pick with a budget becomes an everyday category (`budget` monthly, `usual` keeps the estimate), one without is free; usual ones keep the app's ids (`groceries`, `personal`) so Monzo payments land in them. With a bank, the bills page opens on what it found ("We found some regular payments": each on its sheet, with Remove; "+ Add a bill" for the usual list), everyday opens on "Here's what we found" (a week's worth each, an estimate), limits are as before, and setup ends with "We've done the boring part.": the two monthly totals, tap one to go back to it. Found bills keep `source: "bank"`, `payee` and `method`; found estimates keep `usual.source: "bank"` (no `source`: typed). Savings in setup is parked for now (see `git stash list`). Setup is dark for now whatever the theme setting (`FixedTheme` in `theme/useTheme.ts`); the rest of the app follows the setting.
- Not in v1: declines, the Future view.
- Before calling a change done: `cd mobile && npm test && npm run typecheck && npm run lint`. Run it with `npx expo start` (Expo Go or the iOS simulator).
