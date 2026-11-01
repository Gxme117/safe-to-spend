import {fileBills, insertMany, insertTx, updateFiling} from "@/db/transactions";
import type {Proposal} from "@/lib/billChange";
import type {Income} from "@/lib/types";
import {fetchBank, MonzoFail} from "@/services/monzo";
import {fetchLink, fetchLinkHistory, linkBank, unlink} from "@/services/truelayer";
import {today} from "@/lib/dates";
import {CATALOG} from "@/lib/categories";
import {baseState} from "@/lib/__tests__/fixtures";
import {migrateSaved, useMoney} from "../useMoney";

const mockMem = new Map<string, string>();
jest.mock("expo-sqlite/kv-store", () => ({
  __esModule: true,
  default: {
    getItemSync: (k: string) => mockMem.get(k) ?? null,
    setItemSync: (k: string, v: string) => { mockMem.set(k, v); },
    removeItemSync: (k: string) => mockMem.delete(k),
  },
}));
jest.mock("@/db/transactions", () => ({
  listSince: jest.fn(async () => []),
  insertTx: jest.fn(async () => {}),
  insertMany: jest.fn(async (txs: unknown[]) => txs),
  deleteTx: jest.fn(async () => {}),
  deleteAllTx: jest.fn(async () => {}),
  updateFiling: jest.fn(async () => {}),
  fileBills: jest.fn(async () => {}),
}));
jest.mock("@/services/monzo", () => ({
  ...jest.requireActual("@/services/monzo"),
  loggedIn: jest.fn(async () => false),
  fetchBank: jest.fn(),
  fetchHistory: jest.fn(async () => []),
}));
jest.mock("@/services/truelayer", () => ({linkBank: jest.fn(), fetchLink: jest.fn(), fetchLinkHistory: jest.fn(async () => []), unlink: jest.fn(async () => {})}));

const job = (o: Partial<Income>): Income => ({id: "a", name: "A", type: "work", freq: "monthly-lastworking", varies: false, amount: 1000, ...o});
const store = () => useMoney.getState();

beforeEach(() => {
  mockMem.clear();
  useMoney.setState({state: null, txs: [], toast: null, scan: null, answers: {}});
  store().setup(1000);
});

test("setup starts with the balance, the default categories and the rest of the list", () => {
  expect(store().state).toMatchObject({balance: 1000, incomes: [], bills: []});
  expect(store().state!.categories.map(c => c.id)).toEqual(["rent", "groceries", "eating", "transport", "bills", "other", ...CATALOG.map(e => e.id).filter(id => !["groceries", "eating", "transport", "other"].includes(id))]);
});

test("settings saved before the category list get it once, and payments' categories stay where they were", () => {
  const old = {...baseState(), categories: [
    {id: "rent", name: "Rent", budget: 0, fixed: true},
    {id: "groceries", name: "Groceries", budget: 200, fixed: false, group: "everyday" as const},
    {id: "entertainment", name: "Entertainment", budget: 50, fixed: false, group: "everyday" as const},
    {id: "other", name: "Other", budget: 0, fixed: false},
  ]};
  const got = migrateSaved({state: old, theme: "dark"}, 1);
  expect(got).toMatchObject({theme: "dark"});
  expect(got.state!.categories.slice(0, 4)).toEqual([old.categories[0], old.categories[1], {...old.categories[2], name: "Fun"}, {...old.categories[3], name: "General"}]);
  expect(got.state!.categories.map(c => c.id)).toEqual(expect.arrayContaining(CATALOG.map(e => e.id)));
  // already on version 2: left alone; nothing saved yet: nothing to do
  expect(migrateSaved({state: old}, 2).state).toBe(old);
  expect(migrateSaved({state: null}, 1).state).toBeNull();
});

test("only one income is main, and editing keeps its place in the list", () => {
  store().saveIncome(job({id: "a", main: true}));
  store().saveIncome(job({id: "b", main: false}));
  store().saveIncome(job({id: "b", main: true, name: "B2"}));
  expect(store().state!.incomes.map(i => [i.id, i.name, !!i.main])).toEqual([["a", "A", false], ["b", "B2", true]]);
});

test("a payment is saved to the database before it shows", async () => {
  expect(await store().addTx({type: "expense", amount: 12.499, cat: "other", note: "", date: "2026-10-05"})).toBe(true);
  expect(insertTx).toHaveBeenCalledWith(expect.objectContaining({amount: 12.5}));
  expect(store().txs).toHaveLength(1);
});

test("if saving fails, nothing changes and you're told", async () => {
  (insertTx as jest.Mock).mockRejectedValueOnce(new Error("disk full"));
  expect(await store().addTx({type: "expense", amount: 5, cat: "other", note: "", date: "2026-10-05"})).toBe(false);
  expect(store().txs).toHaveLength(0);
  expect(store().toast?.msg).toBe("That didn't save. Try again.");
});

test("re-filing a payment saves it first, and moving it off a bill clears the bill", async () => {
  await store().addTx({type: "expense", amount: 400, cat: "rent", note: "", date: "2026-10-05", billId: "rent", forDate: "2026-10-15", needsCat: true});
  const id = store().txs[0].id;
  expect(await store().refileTx(id, {cat: "groceries"})).toBe(true);
  expect(updateFiling).toHaveBeenCalledWith(id, {cat: "groceries"});
  const t = store().txs[0];
  expect(t.cat).toBe("groceries");
  expect(t).not.toHaveProperty("billId");
  expect(t).not.toHaveProperty("forDate");
  expect(t).not.toHaveProperty("needsCat");
});

test("re-filing money in off pay or a refund forgets the payday and the category", async () => {
  await store().addTx({type: "income", amount: 1800, cat: "job", srcId: "job", forDate: "2026-09-30", note: "", date: "2026-09-30"});
  await store().addTx({type: "income", amount: 20, cat: "refund", refundOf: "groceries", note: "", date: "2026-10-05"});
  const [pay, refund] = store().txs;
  await store().refileTx(pay.id, {cat: "transfer"});
  await store().refileTx(refund.id, {cat: "other-income"});
  expect(store().txs[0]).not.toHaveProperty("srcId");
  expect(store().txs[0]).not.toHaveProperty("forDate");
  expect(store().txs[1]).not.toHaveProperty("refundOf");
});

test("if re-filing fails, the payment stays as it was", async () => {
  await store().addTx({type: "expense", amount: 5, cat: "other", note: "", date: "2026-10-05"});
  (updateFiling as jest.Mock).mockRejectedValueOnce(new Error("disk full"));
  expect(await store().refileTx(store().txs[0].id, {cat: "eating"})).toBe(false);
  expect(store().txs[0].cat).toBe("other");
  expect(store().toast?.msg).toBe("That didn't save. Try again.");
});

test("settings persist; payments stay in SQLite", async () => {
  await store().addTx({type: "expense", amount: 5, cat: "other", note: "", date: "2026-10-05"});
  const saved = JSON.parse(mockMem.get("money-tracker")!);
  expect(saved.state.state.balance).toBe(1000);
  expect(saved.state.txs).toBeUndefined();
});

test("Tim and Frank's notes: added, removed and put back where they were, kept with consent through Start over", async () => {
  useMoney.setState({notes: [], aiConsent: false});
  const note = (id: string, text: string) => ({id, kind: "goal" as const, text, at: "2026-10-05", who: "frank" as const});
  store().addNote(note("n1", "TV"));
  store().addNote(note("n2", "Holiday"));
  store().addNote(note("n3", "Car"));
  const gone = store().removeNote("n2")!;
  expect(gone).toEqual({note: note("n2", "Holiday"), at: 1});
  expect(store().removeNote("n2")).toBeNull();
  store().restoreNote(gone.note, gone.at);
  expect(store().notes.map(n => n.text)).toEqual(["TV", "Holiday", "Car"]);
  store().setAiConsent(true);
  const saved = JSON.parse(mockMem.get("money-tracker")!);
  expect(saved.state.aiConsent).toBe(true);
  expect(saved.state.notes).toHaveLength(3);
  await store().reset();
  expect([store().aiConsent, store().notes.length]).toEqual([true, 3]);
  store().forgetAll();
  expect(store().notes).toEqual([]);
});

const mockBank = () => ({
  accounts: [{account_id: "cur", account_type: "TRANSACTION", display_name: "Current", provider: {display_name: "Mock Bank"}}],
  balances: {cur: {current: 250}},
  txs: [{transaction_id: "t1", timestamp: new Date().toISOString(), amount: -12, transaction_type: "DEBIT", merchant_name: "Tesco"}],
});

test("adding a bank reads it once: its money is the balance, its payments come in, Monzo isn't asked", async () => {
  (linkBank as jest.Mock).mockResolvedValueOnce("tl_1");
  (fetchLink as jest.Mock).mockResolvedValueOnce(mockBank());
  expect(await store().addLink()).toEqual({id: "tl_1"});
  expect(store().state!.links).toEqual([expect.objectContaining({source: "Mock Bank", accountId: "tl_1", main: 250})]);
  expect(store().state!.balance).toBe(250);
  expect(store().txs).toEqual([expect.objectContaining({amount: 12, note: "Tesco", monzoId: "tl:t1"})]);
  expect(fetchBank).not.toHaveBeenCalled();
  // the next sync doesn't bring the same payment in twice
  (fetchLink as jest.Mock).mockResolvedValueOnce(mockBank());
  expect(await store().syncBank()).toEqual({added: 0});
  expect(store().txs).toHaveLength(1);
});

test("closing the login adds nothing; a bank that fails to read is forgotten, and you're told which", async () => {
  (linkBank as jest.Mock).mockResolvedValueOnce(null);
  expect(await store().addLink()).toBeNull();
  (linkBank as jest.Mock).mockResolvedValueOnce("tl_2");
  (fetchLink as jest.Mock).mockRejectedValueOnce(new MonzoFail("offline"));
  expect(await store().addLink()).toMatchObject({error: "offline"});
  expect(unlink).toHaveBeenCalledWith("tl_2");
  expect(store().state!.links).toBeUndefined();
  expect(store().state!.balance).toBe(1000);
});

test("if a bank's payments don't save, that bank stays as it was", async () => {
  (linkBank as jest.Mock).mockResolvedValueOnce("tl_1");
  (fetchLink as jest.Mock).mockResolvedValueOnce(mockBank());
  await store().addLink();
  (fetchLink as jest.Mock).mockResolvedValueOnce({...mockBank(), balances: {cur: {current: 99}}});
  (insertMany as jest.Mock).mockRejectedValueOnce(new Error("disk full"));
  expect(await store().syncBank()).toEqual({error: "not-saved", bank: "Mock Bank"});
  expect(store().state!.links![0].main).toBe(250);
});

test("once a day after a sync, the bank's 90 days are looked through for regular payments, without holding the sync up", async () => {
  (linkBank as jest.Mock).mockResolvedValueOnce("tl_1");
  (fetchLink as jest.Mock).mockResolvedValueOnce(mockBank());
  await store().addLink();
  useMoney.setState({scan: null});
  const history = [-9.99, -9.99, -9.99].map((amount, i) => ({transaction_id: `h${i}`, timestamp: `2026-0${7 + i}-12T12:00:00Z`, amount, transaction_type: "DEBIT", merchant_name: "Spotify"}));
  let land: (v: unknown) => void = () => {};
  (fetchLinkHistory as jest.Mock).mockReturnValueOnce(new Promise(r => { land = r; }));
  (fetchLink as jest.Mock).mockResolvedValueOnce(mockBank());
  expect(await store().syncBank()).toEqual({added: 0});
  // the sync is done while the look through is still going
  expect(store().syncing).toBe(false);
  expect(store().scan).toBeNull();
  const {toRawTx} = jest.requireActual("@/lib/truelayer");
  land(history.map(toRawTx));
  await new Promise(r => setTimeout(r, 0));
  expect(store().scan).toMatchObject({at: today(), from: "2026-07-12"});
  expect(fetchLinkHistory).toHaveBeenCalledWith("tl_1");
  // the next sync today doesn't look again
  (fetchLinkHistory as jest.Mock).mockClear();
  (fetchLink as jest.Mock).mockResolvedValueOnce(mockBank());
  await store().syncBank();
  expect(fetchLinkHistory).not.toHaveBeenCalled();
});

test("if looking through the bank's payments fails, the last look stays", async () => {
  (linkBank as jest.Mock).mockResolvedValueOnce("tl_1");
  (fetchLink as jest.Mock).mockResolvedValueOnce(mockBank());
  await store().addLink();
  const old = {at: "2026-09-01", from: "2026-06-01", found: []};
  useMoney.setState({scan: old});
  (fetchLinkHistory as jest.Mock).mockRejectedValueOnce(new MonzoFail("offline"));
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  await store().scanRegulars();
  expect(store().scan).toBe(old);
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

describe("a change to your bills you said yes to", () => {
  // Netflix on the 3rd; its payment this pay cycle went under Fun, still asked about
  const flix = {id: "flix", name: "Netflix", amount: 10.99, freq: "monthly" as const, day: Number(today().slice(8)), payee: "NETFLIX.COM"};
  const paid = {id: "p1", type: "expense" as const, amount: 10.99, cat: "entertainment", note: "NETFLIX.COM", date: today(), created: 1, monzoId: "m1", needsCat: true as const};
  const add: Proposal = {kind: "add", bill: flix};
  beforeEach(() => { useMoney.setState({txs: [paid]}); (fileBills as jest.Mock).mockClear(); });

  test("its payment is filed first, then the bill saved and read back; Undo puts both back exactly", async () => {
    const r = await store().applyProposal(add);
    if ("error" in r) throw new Error(r.error);
    expect(fileBills).toHaveBeenCalledWith([{id: "p1", patch: expect.objectContaining({cat: "bills", billId: "flix"})}], []);
    expect(store().state!.bills.at(-1)).toEqual(flix);
    expect(store().txs[0]).toMatchObject({billId: "flix", cat: "bills"});
    expect(store().txs[0].needsCat).toBeUndefined();
    await r.undo();
    expect(store().state!.bills.find(b => b.id === "flix")).toBeUndefined();
    expect(fileBills).toHaveBeenLastCalledWith([{id: "p1", patch: {cat: "entertainment"}, needsCat: true}], []);
    expect(store().txs[0]).toEqual(paid);
  });

  test("if the payment can't be filed, nothing changes and it says so", async () => {
    (fileBills as jest.Mock).mockRejectedValueOnce(new Error("disk full"));
    expect(await store().applyProposal(add)).toEqual({error: "That didn't save. Try again."});
    expect(store().state!.bills.find(b => b.id === "flix")).toBeUndefined();
    expect(store().txs[0]).toEqual(paid);
  });

  test("a card for a bill that's changed since does nothing", async () => {
    store().saveBill({...flix, amount: 12.99});
    const change: Proposal = {kind: "change", before: flix, after: {...flix, amount: 11.99}};
    expect(await store().applyProposal(change)).toEqual({error: "That bill's changed since.", stale: true});
    expect(store().state!.bills.find(b => b.id === "flix")!.amount).toBe(12.99);
  });

  test("a bill from the bank you remove isn't suggested again for a while; Undo brings both back", async () => {
    store().saveBill(flix);
    const r = await store().applyProposal({kind: "remove", bill: flix});
    if ("error" in r) throw new Error(r.error);
    expect(store().state!.bills.find(b => b.id === "flix")).toBeUndefined();
    expect(store().answers["netflix.com"]).toEqual({verdict: "not_now", at: today(), name: "Netflix"});
    await r.undo();
    expect(store().state!.bills.find(b => b.id === "flix")).toEqual(flix);
    expect(store().answers["netflix.com"]).toBeUndefined();
  });
});

test("removing a bank takes its money off and forgets its login", async () => {
  (linkBank as jest.Mock).mockResolvedValueOnce("tl_1");
  (fetchLink as jest.Mock).mockResolvedValueOnce(mockBank());
  await store().addLink();
  await store().removeLink("tl_1");
  expect(unlink).toHaveBeenCalledWith("tl_1");
  expect(store().state!.links).toBeUndefined();
  expect(store().state!.balance).toBe(0);
});

test("your name is trimmed, and clearing it removes it", () => {
  store().setName("  Sam ");
  expect(store().state!.name).toBe("Sam");
  store().setName("   ");
  expect(store().state!.name).toBeUndefined();
});
