import {calc} from "@/lib/calc";
import {applySync, aside, authUrl, importTxs, missingDetails, parseRedirect, REDIRECT_URI, type RawTx, setPotRole, syncSince} from "@/lib/monzo";
import {baseState, ctx, TODAY, tx} from "./fixtures";

const NOW = new Date(2026, 9, 3, 14, 5).getTime();
const got = (pots = [
  {id: "p1", name: "Bills ", balance: 25000},
  {id: "p2", name: "Holiday", balance: 120050, goal_amount: 200000},
  {id: "p3", name: "Old", balance: 999, deleted: true},
]) => ({accountId: "acc_1", mainPence: 84012, pots, txs: []});

test("the login link carries the client, redirect and state", () => {
  const u = new URL(authUrl("oauth2client_x", "st1"));
  expect(u.origin).toBe("https://auth.monzo.com");
  expect(u.searchParams.get("client_id")).toBe("oauth2client_x");
  expect(u.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
  expect(u.searchParams.get("response_type")).toBe("code");
  expect(u.searchParams.get("state")).toBe("st1");
});

test("reads the code from the pasted Safari address, only for this login", () => {
  expect(parseRedirect(" https://localhost/monzo?code=abc%2F1&state=st1 ", "st1")).toBe("abc/1");
  expect(parseRedirect("https://localhost/monzo?state=st1&code=abc", "st1")).toBe("abc");
  expect(parseRedirect("https://localhost/monzo?code=abc&state=other", "st1")).toBeNull();
  expect(parseRedirect("not a link", "st1")).toBeNull();
});

test("a sync re-anchors the balance to the main account; new pots start set aside", () => {
  const s = applySync(baseState(), got(), NOW);
  expect(s.balance).toBe(840.12);
  expect(s.balanceSetAt).toBe(NOW);
  expect(s.balanceAsOf).toBe("2026-10-03");
  expect(s.bank?.main).toBe(840.12);
  expect(s.bank?.pots).toEqual([
    {id: "p1", name: "Bills", balance: 250, role: "save"},
    {id: "p2", name: "Holiday", balance: 1200.5, role: "save", goal: 2000},
  ]);
  expect(aside(s.bank)).toBe(1450.5);
});

test("pots keep the role you gave them, and spending pots count", () => {
  const first = setPotRole(applySync(baseState(), got(), NOW), "p1", "spend");
  const again = applySync(first, got([{id: "p1", name: "Bills", balance: 10000}, {id: "p2", name: "Holiday", balance: 0}]), NOW + 1);
  expect(again.bank?.pots.find(p => p.id === "p1")?.role).toBe("spend");
  expect(again.balance).toBe(940.12);
  expect(aside(again.bank)).toBe(0);
});

test("changing a pot's role shifts the balance by that pot, keeping payments logged since", () => {
  const s = {...applySync(baseState(), got(), NOW), balance: 800.12};   // £40 logged since the sync
  const spend = setPotRole(s, "p1", "spend");
  expect(spend.balance).toBe(1050.12);
  expect(spend.balanceSetAt).toBe(NOW);
  expect(setPotRole(spend, "p1", "save").balance).toBe(800.12);
  expect(setPotRole(spend, "p1", "spend")).toBe(spend);
  expect(setPotRole(s, "nope", "spend")).toBe(s);
});

let n = 0;
const ids = () => `new${++n}`;
const raw = (over: Partial<RawTx>): RawTx => ({id: `m${++n}`, amount: -1000, created: "2026-10-03T12:00:00Z", ...over});

test("card payments come in with the shop's name; known categories are used, others asked about", () => {
  const got = importTxs(ctx(), [
    raw({id: "a", amount: -1250, category: "groceries", merchant: {name: "Tesco"}}),
    raw({id: "b", amount: -499, category: "entertainment", description: "NETFLIX.COM"}),
    raw({id: "c", amount: -300, category: "transport", merchant: {name: "TfL"}}),   // you have no Transport category
  ], NOW, ids);
  expect(got.map(t => [t.monzoId, t.type, t.amount, t.cat, t.note, t.date, !!t.needsCat])).toEqual([
    ["a", "expense", 12.5, "groceries", "Tesco", "2026-10-03", false],
    ["b", "expense", 4.99, "other", "NETFLIX.COM", "2026-10-03", true],
    ["c", "expense", 3, "other", "TfL", "2026-10-03", true],
  ]);
  expect(got.every(t => t.created === NOW - 1)).toBe(true);
  expect(got[0].paidAt).toBe(Date.parse("2026-10-03T12:00:00Z")); // but they keep when they really happened, for sorting
});

test("skips payments already saved, declines, pot moves and zero amounts", () => {
  const saved = tx({amount: 5, date: TODAY, monzoId: "dup"});
  const got = importTxs(ctx({txs: [saved]}), [
    raw({id: "dup"}),
    raw({decline_reason: "INSUFFICIENT_FUNDS"}),
    raw({description: "pot_0000abc"}),
    raw({category: "savings"}),
    raw({amount: 0}),
    raw({id: "ok", category: "eating_out"}),
    raw({id: "ok"}),   // the same one twice in one reply
  ], NOW, ids);
  expect(got.map(t => [t.monzoId, t.cat])).toEqual([["ok", "eating"]]);
});

test("payments saved without a time or logo get Monzo's back; ones that have them are left alone", () => {
  const old = tx({amount: 5, date: TODAY, monzoId: "old"});
  const done = tx({amount: 5, date: TODAY, monzoId: "done", paidAt: 1, logo: "https://a/x.png"});
  const noLogo = tx({amount: 5, date: TODAY, monzoId: "noLogo", paidAt: 1});
  const typed = tx({amount: 5, date: TODAY});
  const got = missingDetails([old, done, noLogo, typed], [
    raw({id: "old", created: "2026-10-04T12:30:00Z", merchant: {name: "Aldi", logo: "https://a/aldi.png"}}),
    raw({id: "done", created: "2026-10-04T13:00:00Z", merchant: {name: "Uber", logo: "https://a/uber.png"}}),
    raw({id: "noLogo", merchant: {name: "Chase"}}),
  ]);
  expect(got).toEqual([{monzoId: "old", paidAt: Date.parse("2026-10-04T12:30:00Z"), logo: "https://a/aldi.png"}]);
});

test("payments keep the shop's logo, but only https links", () => {
  const got = importTxs(ctx(), [
    raw({id: "a", merchant: {name: "Tesco", logo: "https://logos/tesco.png"}}),
    raw({id: "b", merchant: {name: "Odd", logo: "http://logos/odd.png"}}),
    raw({id: "c", merchant: {name: "None"}}),
    raw({id: "d", merchant: "merch_123"}),
  ], NOW, ids);
  expect(got.map(t => t.logo)).toEqual(["https://logos/tesco.png", undefined, undefined, undefined]);
});

test("money in counts as that payday arriving when it matches your pay, otherwise it's just money in", () => {
  // Pharmacy pays on the last working day: Wed 30 Sep
  const got = importTxs(ctx(), [
    raw({id: "pay", amount: 180000, created: "2026-09-30T06:00:00Z", description: "PHARMACY LTD SALARY"}),
    raw({id: "mum", amount: 2000, description: "Mum"}),
  ], NOW, ids);
  expect(got[0]).toMatchObject({type: "income", cat: "job", srcId: "job", forDate: "2026-09-30", note: "", amount: 1800});
  expect(got[1]).toMatchObject({type: "income", cat: "monzo-in", note: "Mum", amount: 20});
  expect(got[1].srcId).toBeUndefined();
});

test("after a sync the balance is Monzo's, not lowered again by the payments it brought in", () => {
  const c = ctx();
  const synced = {...got(), txs: [raw({amount: -2500, category: "groceries"}), raw({amount: 1000, description: "Refund"})]};
  const txs = importTxs(c, synced.txs, NOW, ids);
  const state = applySync(c.state, synced, NOW);
  expect(calc({...c, state, txs}).balance).toBe(840.12);
  // a payment you add afterwards still counts
  expect(calc({...c, state, txs: [...txs, tx({amount: 10, date: TODAY, created: NOW + 5})]}).balance).toBe(830.12);
});

test("the first sync reads from the start of the month; later ones from a day before the last", () => {
  expect(new Date(syncSince(undefined, NOW)).getDate()).toBe(1);
  const bank = applySync(baseState(), got(), NOW).bank;
  expect(Date.parse(syncSince(bank, NOW + 3600e3))).toBe(NOW - 864e5);
  // whole seconds only: Monzo can't read milliseconds
  expect(syncSince(bank, NOW)).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  expect(syncSince(undefined, NOW + 123)).toMatch(/:\d\dZ$/);
});
