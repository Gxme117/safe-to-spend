import Storage from "expo-sqlite/kv-store";
import {create} from "zustand";
import {createJSONStorage, persist} from "zustand/middleware";
import {deleteTx, insertTx, listSince} from "@/db/transactions";
import {addMonths, today} from "@/lib/dates";
import {newState, uid} from "@/lib/defaults";
import {r2} from "@/lib/money";
import type {AppState, Bill, Category, Income, IsoDate, Tx} from "@/lib/types";

export type ThemePref = "system" | "light" | "dark";
export interface Toast { id: number; msg: string; good: boolean }

interface MoneyStore {
  state: AppState | null;     // the settings doc (persisted in kv-store)
  txs: Tx[];                  // payments (in SQLite), last 12 months
  loaded: boolean;            // txs have been read
  today: IsoDate;
  theme: ThemePref;
  toast: Toast | null;

  load(): Promise<void>;
  tick(): void;
  notify(msg: string, good?: boolean): void;
  setTheme(t: ThemePref): void;

  setup(balance: number): void;
  setBalance(balance: number): void;
  saveIncome(src: Income): void;
  removeIncome(id: string): void;
  saveBill(b: Bill): void;
  removeBill(id: string): void;
  saveCategories(cats: Category[]): void;

  addTx(t: Omit<Tx, "id" | "created">): Promise<boolean>;
  removeTx(id: string): Promise<void>;
  confirmPay(src: Income, date: IsoDate, amount: number): Promise<boolean>;
  snooze(key: string): void;
  skip(key: string): void;
}

// The sync kv-store API means the saved state is there on the first render: no flash of the setup screen.
const kv = createJSONStorage(() => ({
  getItem: (k: string) => Storage.getItemSync(k),
  setItem: (k: string, v: string) => Storage.setItemSync(k, v),
  removeItem: (k: string) => { Storage.removeItemSync(k); },
}));

const SAVE_FAILED = "That didn't save. Try again.";

export const useMoney = create<MoneyStore>()(persist((set, get) => {
  const patch = (fn: (s: AppState) => Partial<AppState>) => {
    const s = get().state;
    if (s) set({state: {...s, ...fn(s)}});
  };
  return {
    state: null, txs: [], loaded: false, today: today(), theme: "system", toast: null,

    async load() {
      const txs = await listSince(addMonths(today().slice(0, 7), -11) + "-01");
      set({txs, loaded: true, today: today()});
    },
    tick() { const t = today(); if (t !== get().today) set({today: t}); },
    notify(msg, good = false) { set({toast: {id: Date.now(), msg, good}}); },
    setTheme(theme) { set({theme}); },

    setup(balance) { set({state: newState(r2(balance), today(), Date.now())}); },
    setBalance(balance) { patch(() => ({balance: r2(balance), balanceSetAt: Date.now(), balanceAsOf: today()})); },

    saveIncome(src) {
      patch(s => {
        // only one main income: it sets the payday countdown
        let list = s.incomes.filter(x => x.id !== src.id);
        if (src.main) list = list.map(x => ({...x, main: false}));
        const idx = s.incomes.findIndex(x => x.id === src.id);
        if (idx >= 0) list.splice(idx, 0, src); else list.push(src);
        return {incomes: list};
      });
    },
    removeIncome(id) { patch(s => ({incomes: s.incomes.filter(x => x.id !== id)})); },
    saveBill(b) {
      patch(s => s.bills.some(x => x.id === b.id) ? {bills: s.bills.map(x => x.id === b.id ? b : x)} : {bills: [...s.bills, b]});
    },
    removeBill(id) { patch(s => ({bills: s.bills.filter(x => x.id !== id)})); },
    saveCategories(categories) { patch(() => ({categories})); },

    async addTx(t) {
      const tx: Tx = {...t, id: uid(), created: Date.now(), amount: r2(t.amount)};
      try { await insertTx(tx); } catch { get().notify(SAVE_FAILED); return false; }
      set({txs: [...get().txs, tx]});
      return true;
    },
    async removeTx(id) {
      try { await deleteTx(id); } catch { get().notify(SAVE_FAILED); return; }
      set({txs: get().txs.filter(x => x.id !== id)});
    },
    confirmPay(src, date, amount) {
      return get().addTx({type: "income", amount, cat: src.id, srcId: src.id, forDate: date, note: "", date});
    },
    snooze(key) { patch(s => ({snoozed: {...s.snoozed, [key]: today()}})); },
    skip(key) { patch(s => ({skipped: {...s.skipped, [key]: true}})); },
  };
}, {
  name: "money-tracker",
  version: 1,
  storage: kv,
  partialize: s => ({state: s.state, theme: s.theme}),
}));
