import Storage from "expo-sqlite/kv-store";
import {create} from "zustand";
import {createJSONStorage, persist} from "zustand/middleware";
import {backfill, deleteAllTx, deleteTx, insertMany, insertTx, listSince, updateFiling} from "@/db/transactions";
import {addMonths, today} from "@/lib/dates";
import {newState, uid} from "@/lib/defaults";
import {applySync, importTxs, missingDetails, setPotRole, syncSince} from "@/lib/monzo";
import {r2} from "@/lib/money";
import type {FilingPatch} from "@/lib/payments";
import type {AppState, Bill, Category, Income, IsoDate, PotRole, Tx} from "@/lib/types";
import {disconnect, fetchBank, MonzoFail, type MonzoError} from "@/services/monzo";

export type ThemePref = "system" | "light" | "dark";
export interface Toast { id: number; msg: string; good: boolean }
/** A sync either brings in some new payments, or says what went wrong ("not-saved": the phone couldn't store them). */
export type SyncError = MonzoError | "not-saved";
export type SyncResult = {added: number} | {error: SyncError; detail?: string};

interface MoneyStore {
  state: AppState | null;     // the settings doc (persisted in kv-store)
  txs: Tx[];                  // payments (in SQLite), last 12 months
  loaded: boolean;            // txs have been read
  today: IsoDate;
  theme: ThemePref;
  toast: Toast | null;
  syncing: boolean;           // a bank sync is running

  load(): Promise<void>;
  tick(): void;
  notify(msg: string, good?: boolean): void;
  setTheme(t: ThemePref): void;

  setup(balance: number, income?: Income): void;
  setBalance(balance: number): void;
  setName(name: string): void;
  reset(): Promise<void>;
  saveIncome(src: Income): void;
  removeIncome(id: string): void;
  saveBill(b: Bill): void;
  removeBill(id: string): void;
  saveCategories(cats: Category[]): void;

  addTx(t: Omit<Tx, "id" | "created">): Promise<boolean>;
  removeTx(id: string): Promise<void>;
  refileTx(id: string, f: FilingPatch): Promise<boolean>;
  confirmPay(src: Income, date: IsoDate, amount: number): Promise<boolean>;
  snooze(key: string): void;
  skip(key: string): void;

  syncBank(): Promise<SyncResult>;
  setPotRole(id: string, role: PotRole): void;
  disconnectBank(): Promise<void>;
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
    state: null, txs: [], loaded: false, today: today(), theme: "system", toast: null, syncing: false,

    async load() {
      const txs = await listSince(addMonths(today().slice(0, 7), -11) + "-01");
      set({txs, loaded: true, today: today()});
    },
    tick() { const t = today(); if (t !== get().today) set({today: t}); },
    notify(msg, good = false) { set({toast: {id: Date.now(), msg, good}}); },
    setTheme(theme) { set({theme}); },

    // one write, so the app never renders a state without the pay that sets payday
    setup(balance, income) { set({state: {...newState(r2(balance), today(), Date.now()), incomes: income ? [income] : []}}); },
    // payments go first, so a failure leaves everything as it was
    async reset() { await deleteAllTx(); set({state: null, txs: []}); },
    setBalance(balance) { patch(() => ({balance: r2(balance), balanceSetAt: Date.now(), balanceAsOf: today()})); },
    setName(name) { patch(() => ({name: name.trim() || undefined})); },

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
    async refileTx(id, f) {
      try { await updateFiling(id, f); } catch { get().notify(SAVE_FAILED); return false; }
      set({txs: get().txs.map(t => {
        if (t.id !== id) return t;
        // a payment moved off a bill or a payday no longer marks it paid or arrived
        const n: Tx = {...t, ...f};
        if (!f.billId) delete n.billId;
        if (!f.forDate) delete n.forDate;
        if (!f.srcId) delete n.srcId;
        if (!f.refundOf) delete n.refundOf;
        delete n.needsCat;
        return n;
      })});
      return true;
    },
    confirmPay(src, date, amount) {
      return get().addTx({type: "income", amount, cat: src.id, srcId: src.id, forDate: date, note: "", date});
    },
    snooze(key) { patch(s => ({snoozed: {...s.snoozed, [key]: today()}})); },
    skip(key) { patch(s => ({skipped: {...s.skipped, [key]: true}})); },

    // One sync: balance, pots and new payments. Payments are saved first; if that fails, nothing changes.
    async syncBank() {
      const before = get().state;
      if (get().syncing) return {error: "other", detail: "a sync is already running"};
      if (!before) return {error: "other", detail: "the app isn't set up yet"};
      set({syncing: true});
      try {
        const now = Date.now();
        const got = await fetchBank(syncSince(before.bank, now));
        const s = get().state;
        if (!s) return {error: "other"};
        let added: Tx[];
        try { added = await insertMany(importTxs({state: s, txs: get().txs, today: today()}, got.txs, now, uid)); }
        catch { return {error: "not-saved"}; }
        // older payments get their real time and logo back; if that fails they just stay as they were
        const fills = missingDetails(get().txs, got.txs);
        let txs = get().txs;
        try {
          await backfill(fills);
          const by = new Map(fills.map(f => [f.monzoId, f]));
          txs = txs.map(t => {
            const f = t.monzoId ? by.get(t.monzoId) : undefined;
            return f ? {...t, paidAt: t.paidAt ?? f.paidAt, logo: t.logo ?? f.logo} : t;
          });
        } catch {}
        set({state: applySync(s, got, now), txs: [...txs, ...added]});
        return {added: added.length};
      } catch (e) {
        // the real reason, in the Expo terminal: the message on screen stays plain
        console.warn("Monzo sync failed:", e instanceof Error ? e.message : e);
        return {error: e instanceof MonzoFail ? e.kind : "other", detail: e instanceof Error ? e.message : String(e)};
      } finally { set({syncing: false}); }
    },
    setPotRole(id, role) { const s = get().state; if (s) set({state: setPotRole(s, id, role)}); },
    // the balance stays where it was: from here it's typed in again
    async disconnectBank() { await disconnect(); patch(() => ({bank: undefined})); },
  };
}, {
  name: "money-tracker",
  version: 1,
  storage: kv,
  partialize: s => ({state: s.state, theme: s.theme}),
}));
