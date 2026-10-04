import {insertTx, updateFiling} from "@/db/transactions";
import type {Income} from "@/lib/types";
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
  deleteTx: jest.fn(async () => {}),
  updateFiling: jest.fn(async () => {}),
}));

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

test("your name is trimmed, and clearing it removes it", () => {
  store().setName("  Sam ");
  expect(store().state!.name).toBe("Sam");
  store().setName("   ");
  expect(store().state!.name).toBeUndefined();
});
