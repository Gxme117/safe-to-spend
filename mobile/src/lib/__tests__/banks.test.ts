import {accountKey, allBanks, anchor, aside, cardBalances, ownAccounts, setPotRole} from "@/lib/banks";
import {applySync} from "@/lib/monzo";
import type {Bank} from "@/lib/types";
import {baseState} from "./fixtures";

const NOW = new Date(2026, 9, 3, 14, 5).getTime();
const monzo: Bank = {source: "Monzo", accountId: "acc_1", main: 840.12, asOf: "2026-10-03T12:00:00Z", numbers: ["04000412345678"], pots: [
  {id: "p1", name: "Bills", balance: 250, role: "spend"},
  {id: "p2", name: "Holiday", balance: 1200.5, role: "save"},
]};
const barclays: Bank = {source: "Barclays", accountId: "l1", main: 310, asOf: "2026-10-03T12:00:00Z", via: "enablebanking", numbers: ["20000012345678", "20000087654321"], pots: [
  {id: "b-save", name: "Rainy day", balance: 2000, role: "save"},
  {id: "b-joint", name: "Joint", balance: 90.5, role: "spend"},
]};

test("every bank, Monzo first", () => {
  expect(allBanks(baseState())).toEqual([]);
  expect(allBanks(baseState({bank: monzo, links: [barclays]})).map(b => b.source)).toEqual(["Monzo", "Barclays"]);
  expect(allBanks(baseState({links: [barclays]})).map(b => b.source)).toEqual(["Barclays"]);
});

test("spending money is every bank's main account and spending pots; what's set aside is counted apart", () => {
  const s = anchor(baseState({bank: monzo, links: [barclays]}), NOW);
  expect(s.balance).toBe(1490.62);   // 840.12 + 250 + 310 + 90.50
  expect(s.balanceSetAt).toBe(NOW);
  expect(s.balanceAsOf).toBe("2026-10-03");
  expect(aside(s)).toBe(3200.5);     // Holiday + Rainy day
  expect(aside(baseState())).toBe(0);
});

test("a Monzo sync re-anchors to every bank, not just Monzo", () => {
  const s = applySync(baseState({links: [barclays]}), {accountId: "acc_1", mainPence: 10000, pots: [], txs: [], numbers: ["04000412345678"]}, NOW);
  expect(s.balance).toBe(500.5);     // Monzo 100 + Barclays 310 + 90.50
  expect(s.bank?.numbers).toEqual(["04000412345678"]);
  // a sync that doesn't say keeps the numbers it had
  expect(applySync(s, {accountId: "acc_1", mainPence: 10000, pots: [], txs: []}, NOW).bank?.numbers).toEqual(["04000412345678"]);
});

test("each card shows everything in its bank; payments logged since the sync come off the first", () => {
  const s = anchor(baseState({bank: monzo, links: [barclays]}), NOW);
  expect(cardBalances(s, s.balance).map(k => [k.bank.source, k.amount])).toEqual([["Monzo", 2290.62], ["Barclays", 2400.5]]);
  expect(cardBalances(s, s.balance - 40).map(k => k.amount)).toEqual([2250.62, 2400.5]);
  // one bank: its card is the balance plus what's set aside, as before
  const one = anchor(baseState({bank: monzo}), NOW);
  expect(cardBalances(one, 1050.12).map(k => k.amount)).toEqual([1050.12 + 1200.5]);
});

test("a linked bank's account can be set aside or counted, like a pot", () => {
  const s = anchor(baseState({bank: monzo, links: [barclays]}), NOW);
  const joint = setPotRole(s, "b-joint", "save");
  expect(joint.balance).toBe(1400.12);
  expect(joint.links?.[0].pots.find(p => p.id === "b-joint")?.role).toBe("save");
  expect(joint.bank).toEqual(s.bank);
  expect(setPotRole(joint, "p2", "spend").balance).toBe(2600.62);
});

test("your own accounts are known by sort code and account number", () => {
  expect(accountKey("04-00-04", "1234 5678")).toBe("04000412345678");
  expect(accountKey("040004", undefined)).toBe("");
  expect(accountKey(null, "12345678")).toBe("");
  expect([...ownAccounts(baseState({bank: monzo, links: [barclays]}))]).toEqual(["04000412345678", "20000012345678", "20000087654321"]);
});
