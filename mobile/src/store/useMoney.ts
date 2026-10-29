import Storage from "expo-sqlite/kv-store";
import {create} from "zustand";
import {createJSONStorage, persist} from "zustand/middleware";
import {backfill, deleteAllTx, deleteTx, insertMany, insertTx, listSince, updateFiling} from "@/db/transactions";
import type {Note, Who} from "@/lib/ai/tools";
import {addMonths, today} from "@/lib/dates";
import {newState, uid} from "@/lib/defaults";
import type {SetupFound} from "@/lib/found";
import {setPotRole} from "@/lib/banks";
import {applySync, importTxs, missingDetails, type RawTx, syncSince} from "@/lib/monzo";
import {r2} from "@/lib/money";
import type {FilingPatch} from "@/lib/payments";
import {toBank, toRawTx, withLink, withoutLink} from "@/lib/truelayer";
import type {AppState, Bill, Category, Income, IsoDate, PotRole, Tx} from "@/lib/types";
import {disconnect, fetchBank, loggedIn, MonzoFail, type MonzoError} from "@/services/monzo";
import {fetchLink, linkBank, unlink} from "@/services/truelayer";

export type ThemePref = "system" | "light" | "dark";
/** The Safe to Spend card: the accent colour, or glass (iOS 26). */
export type CardStyle = "colour" | "glass";
/** The Living tab: the ball pit, or the same bills and everyday amounts as a list. */
export type LivingView = "pit" | "list";
/** Who your accountant is on his tab: Tim, or Frank (another version from the Home S20 canvas, being tried out). */
export type Accountant = Who;
/** `undo`: the toast stays 5s with an Undo button that puts back what was just removed. */
export interface Toast { id: number; msg: string; good: boolean; undo?: () => void }
/** A sync either brings in some new payments, or says what went wrong ("not-saved": the phone couldn't store them). */
export type SyncError = MonzoError | "not-saved";
/** `bank`: which bank it was, when you have more than one. */
export type SyncFail = {error: SyncError; detail?: string; bank?: string};
export type SyncResult = {added: number} | SyncFail;

interface MoneyStore {
  state: AppState | null;     // the settings doc (persisted in kv-store)
  txs: Tx[];                  // payments (in SQLite), last 12 months
  loaded: boolean;            // txs have been read
  today: IsoDate;
  theme: ThemePref;
  accent: string | null;      // your own accent colour (#RRGGBB), or null for the default
  cardStyle: CardStyle;
  livingView: LivingView;
  accountant: Accountant;
  aiConsent: boolean;         // you've agreed to Tim and Frank looking at your numbers (what leaves the phone, in ConsentSheet)
  notes: Note[];              // what you've told them that will still matter next time; kept through Start over
  toast: Toast | null;
  syncing: boolean;           // a bank sync is running
  setupBank: number | null;   // the Monzo total (main + all pots), when connected during setup (not saved)
  setupFound: SetupFound | null;   // what Monzo's payments say about your pay and payday, when connected during setup (not saved)

  load(): Promise<void>;
  tick(): void;
  notify(msg: string, good?: boolean, undo?: () => void): void;
  setTheme(t: ThemePref): void;
  setAccent(hex: string | null): void;
  setCardStyle(v: CardStyle): void;
  setLivingView(v: LivingView): void;
  setAccountant(v: Accountant): void;
  setAiConsent(on: boolean): void;
  addNote(n: Note): void;
  /** Removes a note, and says where it was, so Undo can put it back. */
  removeNote(id: string): {note: Note; at: number} | null;
  restoreNote(n: Note, at: number): void;
  forgetAll(): void;

  setup(balance: number, income?: Income, bills?: Bill[], categories?: Category[]): void;
  setSetupBank(main: number | null, found?: SetupFound | null): void;
  setBalance(balance: number): void;
  setName(name: string): void;
  setSaving(monthly: number): void;
  reset(): Promise<void>;
  saveIncome(src: Income): void;
  removeIncome(id: string): void;
  saveBill(b: Bill): void;
  removeBill(id: string): void;
  restoreBill(b: Bill, at: number): void;
  saveCategories(cats: Category[]): void;

  addTx(t: Omit<Tx, "id" | "created">): Promise<boolean>;
  removeTx(id: string): Promise<void>;
  refileTx(id: string, f: FilingPatch): Promise<boolean>;
  confirmPay(src: Income, date: IsoDate, amount: number): Promise<boolean>;
  snooze(key: string): void;
  skip(key: string): void;

  syncBank(): Promise<SyncResult>;
  /** Link a bank through TrueLayer and read it once. null: you closed the login. */
  addLink(): Promise<{id: string} | SyncFail | null>;
  removeLink(id: string): Promise<void>;
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
  // what went wrong, in the Expo terminal; the message on screen stays plain
  const fail = (bank: string, e: unknown): SyncFail => {
    console.warn(`${bank} sync failed:`, e instanceof Error ? e.message : e);
    return {error: e instanceof MonzoFail ? e.kind : "other", detail: e instanceof Error ? e.message : String(e), bank};
  };
  // new payments saved first, so a failure there leaves the store as it was
  const saveNew = async (raw: RawTx[], now: number): Promise<Tx[] | null> => {
    const s = get().state;
    if (!s) return null;
    try { return await insertMany(importTxs({state: s, txs: get().txs, today: today()}, raw, now, uid)); } catch { return null; }
  };

  const syncMonzo = async (): Promise<SyncResult> => {
    try {
      const now = Date.now();
      const got = await fetchBank(syncSince(get().state?.bank, now));
      const added = await saveNew(got.txs, now);
      if (!added) return {error: "not-saved", bank: "Monzo"};
      // older payments get their real time, logo and who they were with back; if that fails they just stay as they were
      const fills = missingDetails(get().txs, got.txs);
      let txs = get().txs;
      try {
        await backfill(fills);
        const by = new Map(fills.map(f => [f.monzoId, f]));
        txs = txs.map(t => {
          const f = t.monzoId ? by.get(t.monzoId) : undefined;
          return f ? {...t, paidAt: t.paidAt ?? f.paidAt, logo: t.logo ?? f.logo, note: f.note ?? t.note} : t;
        });
      } catch {}
      const s = get().state;
      if (!s) return {error: "other"};
      set({state: applySync(s, got, now), txs: [...txs, ...added]});
      return {added: added.length};
    } catch (e) { return fail("Monzo", e); }
  };

  // a bank linked through TrueLayer: its accounts, their balances, and its main account's payments
  const syncLink = async (id: string): Promise<SyncResult> => {
    const prev = get().state?.links?.find(b => b.accountId === id);
    try {
      const now = Date.now();
      const got = await fetchLink(id, syncSince(prev, now));
      const bank = toBank(id, got.accounts, got.balances, prev, now);
      const added = await saveNew(got.txs.map(toRawTx), now);
      if (!added) return {error: "not-saved", bank: bank.source};
      const s = get().state;
      if (!s) return {error: "other"};
      set({state: withLink(s, bank, now), txs: [...get().txs, ...added]});
      return {added: added.length};
    } catch (e) { return fail(prev?.source || "Your bank", e); }
  };

  return {
    state: null, txs: [], loaded: false, today: today(), theme: "system", accent: null, cardStyle: "colour", livingView: "pit", accountant: "tim", aiConsent: false, notes: [], toast: null, syncing: false, setupBank: null, setupFound: null,

    async load() {
      const txs = await listSince(addMonths(today().slice(0, 7), -11) + "-01");
      set({txs, loaded: true, today: today()});
    },
    tick() { const t = today(); if (t !== get().today) set({today: t}); },
    notify(msg, good = false, undo) { set({toast: {id: Date.now(), msg, good, ...(undo ? {undo} : {})}}); },
    setTheme(theme) { set({theme}); },
    setAccent(accent) { set({accent}); },
    setCardStyle(cardStyle) { set({cardStyle}); },
    setLivingView(livingView) { set({livingView}); },
    setAccountant(accountant) { set({accountant}); },
    setAiConsent(aiConsent) { set({aiConsent}); },
    addNote(n) { set({notes: [...get().notes.filter(x => x.id !== n.id), n]}); },
    removeNote(id) {
      const notes = get().notes, at = notes.findIndex(x => x.id === id);
      if (at < 0) return null;
      set({notes: notes.filter(x => x.id !== id)});
      return {note: notes[at], at};
    },
    // undo: back where it was in the list
    restoreNote(n, at) { const notes = get().notes; if (!notes.some(x => x.id === n.id)) set({notes: [...notes.slice(0, at), n, ...notes.slice(at)]}); },
    forgetAll() { set({notes: []}); },

    // one write, so the app never renders a state without the pay that sets payday (or the bills and everyday amounts that hold money back)
    setup(balance, income, bills = [], categories) {
      const st = newState(r2(balance), today(), Date.now());
      set({setupBank: null, setupFound: null, state: {...st, incomes: income ? [income] : [], bills, categories: categories ?? st.categories}});
    },
    setSetupBank(main, found = null) { set({setupBank: main === null ? null : r2(main), setupFound: main === null ? null : found}); },
    // payments go first, so a failure leaves everything as it was
    async reset() { await deleteAllTx(); set({state: null, txs: []}); },
    setBalance(balance) { patch(() => ({balance: r2(balance), balanceSetAt: Date.now(), balanceAsOf: today()})); },
    setName(name) { patch(() => ({name: name.trim() || undefined})); },
    setSaving(monthly) { patch(() => ({saving: monthly > 0 ? r2(monthly) : undefined})); },

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
    // undo: back where it was in the list
    restoreBill(b, at) { patch(s => s.bills.some(x => x.id === b.id) ? {} : {bills: [...s.bills.slice(0, at), b, ...s.bills.slice(at)]}); },
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

    // One sync of every bank: balances, pots and new payments. Each bank's payments are saved first; if that fails, that bank
    // stays as it was. The first bank that went wrong is the one you're told about.
    async syncBank() {
      const before = get().state;
      if (get().syncing) return {error: "other", detail: "a sync is already running"};
      if (!before) return {error: "other", detail: "the app isn't set up yet"};
      set({syncing: true});
      try {
        // Monzo once it's in the app, or straight after its login (before its first sync)
        const monzo = !!before.bank || await loggedIn().catch(() => false);
        const results = [
          ...(monzo ? [await syncMonzo()] : []),
          ...await Promise.all((before.links || []).map(l => syncLink(l.accountId))),
        ];
        const failed = results.find(r => "error" in r);
        return failed ?? {added: results.reduce((a, r) => a + ("added" in r ? r.added : 0), 0)};
      } finally { set({syncing: false}); }
    },
    async addLink() {
      if (!get().state) return {error: "other", detail: "the app isn't set up yet"};
      let id: string | null;
      try { id = await linkBank(); }
      catch (e) { return fail("Bank login", e); }
      if (!id) return null;
      set({syncing: true});
      try {
        const r = await syncLink(id);
        if ("error" in r) { await unlink(id).catch(() => {}); return r; }
        return {id};
      } finally { set({syncing: false}); }
    },
    async removeLink(id) {
      await unlink(id);
      const s = get().state;
      if (s) set({state: withoutLink(s, id)});
    },
    setPotRole(id, role) { const s = get().state; if (s) set({state: setPotRole(s, id, role)}); },
    // the balance stays where it was: from here it's typed in again
    async disconnectBank() { await disconnect(); patch(() => ({bank: undefined})); },
  };
}, {
  name: "money-tracker",
  version: 1,
  storage: kv,
  partialize: s => ({state: s.state, theme: s.theme, accent: s.accent, cardStyle: s.cardStyle, livingView: s.livingView, accountant: s.accountant, aiConsent: s.aiConsent, notes: s.notes}),
}));
