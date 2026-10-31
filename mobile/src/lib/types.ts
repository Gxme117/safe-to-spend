// The same shapes as the web app's `state` doc and `tx-YYYY-MM` items (src/app.js),
// so data can move between the two later without reshaping.
import type {LookIcon} from "./looks";

export type IsoDate = string; // "2026-10-03"

export type IncomeFreq =
  | "monthly-lastworking"
  | "monthly-date"
  | "monthly-lastfri"
  | "fourweekly"
  | "fortnightly"
  | "weekly"
  | "oneoff";

export type IncomeType = "work" | "business" | "student" | "benefits" | "family" | "other";

export interface Income {
  id: string;
  name: string;
  type: IncomeType;
  freq: IncomeFreq;
  varies: boolean;
  amount?: number;   // when it's the same every time
  low?: number;      // when it varies: the forecast uses this
  typical?: number;  // when it varies: what usually lands
  date?: IsoDate;    // weekly / fortnightly / fourweekly / oneoff: a known date
  time?: string;     // oneoff: roughly when it lands, "14:00". It isn't asked about before then
  day?: number;      // monthly-date: day of the month
  main?: boolean;    // sets the payday countdown
  since?: IsoDate;   // no check-ins before this
  payer?: string;    // who pays it, as Monzo names them: a synced payment from them is this payday arriving
  rate?: number;     // hourly pay: take-home per hour, only used to say how many hours of work would close a gap
}

/** Where something came from: found in your bank's payments (and kept by you at setup), or typed in. Missing means typed. */
export type Source = "bank" | "you";

/** oneoff: it goes out once, on its date */
export type BillFreq = "monthly" | "weekly" | "fortnightly" | "fourweekly" | "quarterly" | "yearly" | "oneoff";
export type BillMethod = "dd" | "card" | "transfer";

export interface Bill {
  id: string;
  name: string;
  amount: number;
  varies?: boolean;
  freq: BillFreq;
  day?: number | "last";  // monthly
  date?: IsoDate;         // everything else: a known date
  method?: BillMethod;
  from?: {kind: "main" | "other"; name?: string};
  cat?: string;
  source?: Source;
  payee?: string;   // who it's paid to, as the bank names them: found there at setup, or from a bank payment you filed under it. Payments to them are recognised as paying it (billMatch)
  icon?: LookIcon;  // chosen by you; otherwise it's guessed from the name (billLook)
  since?: IsoDate;  // when it was added after setup: it's held back for from that pay cycle on, not caught up all at once
}

export type Group = "bills" | "everyday" | "free";

/** How often everyday spending happens. The amount is each time: £15, 2–3 times a week. */
export type SpendFreq = "daily" | "most-days" | "few-times" | "weekly" | "fortnightly" | "monthly" | "quarterly" | "yearly";

export interface Category {
  id: string;
  name: string;
  budget: number;   // monthly amount: for everyday, what you chose to allow yourself
  fixed: boolean;
  group?: Group;
  usual?: {amount: number; freq: SpendFreq; source?: Source};   // what you normally spend, at setup (budget can differ): typed, or found in your bank
  budgetKept?: IsoDate;   // the day a suggested new budget was answered (changed or kept): only pay cycles that end after it count towards the next one
}

export type TxType = "expense" | "income" | "save";

export interface Tx {
  id: string;
  type: TxType;
  amount: number;   // pounds, always positive
  cat: string;
  note: string;
  date: IsoDate;
  created: number;  // ms since epoch, when it was saved here (the balance counts payments saved after it was set)
  paidAt?: number;  // ms since epoch, when the money moved, if that's different (Monzo payments): lists sort by this
  billId?: string;
  forDate?: IsoDate;
  srcId?: string;
  monzoId?: string;   // imported from Monzo: never imported twice
  logo?: string;      // the shop's logo link, as Monzo sent it
  needsCat?: boolean; // Monzo's category didn't match one of yours: ask, don't guess
  refundOf?: string;  // money in that's a refund or paying you back: the category it goes back to
}

export interface AppState {
  name?: string;          // what the app calls you; optional
  balance: number;
  balanceSetAt: number;   // payments created after this change the balance
  balanceAsOf: IsoDate;
  incomes: Income[];
  bills: Bill[];
  categories: Category[];
  skipped: Record<string, true>;   // `${incomeId}_${date}`: not coming
  snoozed: Record<string, IsoDate>; // `${incomeId}_${date}`: asked again tomorrow
  bank?: Bank;                      // Monzo, once connected
  links?: Bank[];                   // other banks, linked through Open Banking. Read every bank through `allBanks` (lib/banks.ts)
  saving?: number;                  // what you chose to put away a month: each pay cycle's share is held back until it's moved to savings
}

/** "spend" pots count as spending money; "save" pots (savings, business) never do. */
export type PotRole = "spend" | "save";
export interface Pot {
  id: string;
  name: string;
  balance: number;   // pounds, as of the last sync
  role: PotRole;
  goal?: number;
}

/** What the bank said at the last sync. The same shape as the web app's `state.bank`. */
export interface Bank {
  source: string;     // "Monzo", or a linked bank's name
  accountId: string;  // Monzo's account id; a linked bank's own id here (its session is in the Keychain under it)
  main: number;       // the main account, pounds
  pots: Pot[];        // Monzo's pots; a linked bank's other accounts
  asOf: string;       // ISO timestamp of the sync
  numbers?: string[]; // each account's sort code and account number, digits only: payments between them are your own money moving
  via?: "truelayer";      // linked through Open Banking (TrueLayer)
  validUntil?: string;    // a linked bank: when you'll need to approve again
}

/** Everything the engine needs. Passing it in (instead of reading globals) keeps every function testable. */
export interface Ctx {
  state: AppState;
  txs: Tx[];
  today: IsoDate;
}
