// The same shapes as the web app's `state` doc and `tx-YYYY-MM` items (src/app.js),
// so data can move between the two later without reshaping.

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
  day?: number;      // monthly-date: day of the month
  main?: boolean;    // sets the payday countdown
  since?: IsoDate;   // no check-ins before this
}

export type BillFreq = "monthly" | "weekly" | "fortnightly" | "fourweekly" | "quarterly" | "yearly";
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
}

export type Group = "bills" | "everyday" | "free";

export interface Category {
  id: string;
  name: string;
  budget: number;   // monthly amount
  fixed: boolean;
  group?: Group;
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
  bank?: Bank;                      // set once a bank is connected
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
  source: string;     // "Monzo"
  accountId: string;
  main: number;       // the main account, pounds
  pots: Pot[];
  asOf: string;       // ISO timestamp of the sync
}

/** Everything the engine needs. Passing it in (instead of reading globals) keeps every function testable. */
export interface Ctx {
  state: AppState;
  txs: Tx[];
  today: IsoDate;
}
