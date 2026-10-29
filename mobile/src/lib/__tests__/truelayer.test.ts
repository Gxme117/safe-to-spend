import {aside} from "@/lib/banks";
import {importTxs} from "@/lib/monzo";
import {toBank, toRawTx, withLink, withoutLink, type TlAccount} from "@/lib/truelayer";
import type {Bank} from "@/lib/types";
import {baseState} from "./fixtures";

const NOW = new Date(2026, 9, 27, 9, 30).getTime();
const mock = {display_name: "Mock Bank", provider_id: "mock"};
const accounts: TlAccount[] = [
  {account_id: "sav", account_type: "SAVINGS", display_name: "Saver", provider: mock, account_number: {sort_code: "01-21-31", number: "11111111"}},
  {account_id: "cur", account_type: "TRANSACTION", display_name: "Current", provider: mock, account_number: {sort_code: "01-21-31", number: "22222222"}},
  {account_id: "joint", account_type: "TRANSACTION", display_name: "Joint", provider: mock},
];
const balances = {sav: {current: 2000, available: 2000}, cur: {current: 310.255, available: 810}, joint: {current: 90.5}};
const monzo: Bank = {source: "Monzo", accountId: "acc_1", main: 840.12, asOf: "2026-10-27T08:00:00Z", pots: [
  {id: "p1", name: "Holiday", balance: 100, role: "save"},
]};

test("a payment reads as Monzo's do: signed pence, its own id, the shop's name, direct debits marked", () => {
  expect(toRawTx({transaction_id: "t1", timestamp: "2026-10-26T00:00:00Z", description: " TESCO ", amount: -12.34, transaction_type: "DEBIT",
    transaction_category: "PURCHASE", merchant_name: "Tesco"}))
    .toEqual({id: "tl:t1", amount: -1234, created: "2026-10-26T00:00:00Z", description: "TESCO", merchant: {name: "Tesco"}});
  // some banks send debits as positive amounts: which way it went comes from the type
  expect(toRawTx({transaction_id: "t2", timestamp: "2026-10-26T00:00:00Z", amount: 50, transaction_type: "DEBIT", transaction_category: "DIRECT_DEBIT"}))
    .toMatchObject({amount: -5000, scheme: "bacs"});
  expect(toRawTx({transaction_id: "t3", timestamp: "2026-10-26T00:00:00Z", amount: 1800, transaction_type: "CREDIT"}).amount).toBe(180000);
});

test("the first current account is the main one, at what the bank's app shows; the others are pots, savings set aside", () => {
  const b = toBank("tl_1", accounts, balances, undefined, NOW);
  expect(b).toMatchObject({source: "Mock Bank", accountId: "tl_1", via: "truelayer", main: 310.26, asOf: new Date(NOW).toISOString(),
    numbers: ["01213111111111", "01213122222222"]});
  expect(b.pots).toEqual([
    {id: "tl:sav", name: "Saver", balance: 2000, role: "save"},
    {id: "tl:joint", name: "Joint", balance: 90.5, role: "spend"},
  ]);
});

test("roles you chose are kept on the next sync", () => {
  const first = toBank("tl_1", accounts, balances, undefined, NOW);
  const chosen = {...first, pots: first.pots.map(p => ({...p, role: p.id === "tl:sav" ? "spend" as const : "save" as const}))};
  expect(toBank("tl_1", accounts, balances, chosen, NOW).pots.map(p => p.role)).toEqual(["spend", "save"]);
});

test("a linked bank's spending money counts with Monzo's; removing it takes it back off", () => {
  const link = toBank("tl_1", accounts, balances, undefined, NOW);
  const s = withLink(baseState({bank: monzo}), link, NOW);
  expect(s.balance).toBe(1240.88);   // Monzo 840.12 + current 310.26 + joint 90.50
  expect(aside(s)).toBe(2100);       // Holiday + Saver
  // a newer sync replaces it, rather than adding it twice
  expect(withLink(s, {...link, main: 10.26}, NOW).links).toHaveLength(1);
  expect(withLink(s, {...link, main: 10.26}, NOW).balance).toBe(940.88);
  // payments logged since the sync still count: only the bank's own money comes off
  const gone = withoutLink({...s, balance: 1200.88}, "tl_1");
  expect(gone.balance).toBe(800.12);
  expect(gone.links).toBeUndefined();
});

test("its payments import like Monzo's: once, and what they were for is asked", () => {
  const raw = [toRawTx({transaction_id: "t1", timestamp: "2026-10-26T10:00:00Z", amount: -12.34, transaction_type: "DEBIT", merchant_name: "Tesco"})];
  const ctx = {state: withLink(baseState(), toBank("tl_1", accounts, balances, undefined, NOW), NOW), txs: [], today: "2026-10-27"};
  let n = 0;
  const got = importTxs(ctx, raw, NOW, () => `id${n++}`);
  expect(got).toEqual([expect.objectContaining({type: "expense", amount: 12.34, note: "Tesco", cat: "other", needsCat: true, monzoId: "tl:t1", date: "2026-10-26"})]);
  expect(importTxs({...ctx, txs: got}, raw, NOW, () => "x")).toEqual([]);
});
