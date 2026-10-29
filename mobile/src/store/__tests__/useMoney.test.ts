import {insertMany, insertTx, updateFiling} from "@/db/transactions";
import type {Income} from "@/lib/types";
import {fetchBank, MonzoFail} from "@/services/monzo";
import {fetchLink, linkBank, unlink} from "@/services/truelayer";
import {useMoney} from "../useMoney";

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
}));
jest.mock("@/services/monzo", () => ({
  ...jest.requireActual("@/services/monzo"),
  loggedIn: jest.fn(async () => false),
  fetchBank: jest.fn(),
}));
jest.mock("@/services/truelayer", () => ({linkBank: jest.fn(), fetchLink: jest.fn(), unlink: jest.fn(async () => {})}));

const job = (o: Partial<Income>): Income => ({id: "a", name: "A", type: "work", freq: "monthly-lastworking", varies: false, amount: 1000, ...o});
const store = () => useMoney.getState();

beforeEach(() => {
  mockMem.clear();
  useMoney.setState({state: null, txs: [], toast: null});
  store().setup(1000);
});

test("setup starts with the balance and the default categories", () => {
  expect(store().state).toMatchObject({balance: 1000, incomes: [], bills: []});
  expect(store().state!.categories.map(c => c.id)).toEqual(["rent", "groceries", "eating", "transport", "bills", "other"]);
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
