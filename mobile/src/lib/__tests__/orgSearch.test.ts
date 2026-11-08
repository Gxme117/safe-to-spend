import {bubblesAt, holdMs, MAX_BUBBLES, MAX_STOPS, searchStops, type Stop} from "../orgSearch";
import type {AppState, Ctx, Tx} from "../types";

const STATE: AppState = {
  balance: 0, balanceSetAt: 0, balanceAsOf: "2026-11-01", incomes: [], bills: [], saving: 0, snoozed: {}, skipped: {},
  categories: [{id: "other", name: "General", budget: 0, fixed: false}],
};
const ctx = (txs: Tx[]): Ctx => ({state: STATE, txs, today: "2026-11-07"});
const tx = (id: string, note: string, o: Partial<Tx> = {}): Tx =>
  ({id, type: "expense", amount: 5, cat: "other", note, date: "2026-11-01", created: 0, needsCat: true, ...o});
const stop = (n: number): Stop => ({key: `s${n}`, name: `Shop ${n}`, txId: `t${n}`, look: {icon: "card", tint: "grey"}});

describe("searchStops", () => {
  it("gives each shop once, with a logo if any of its payments had one, logos first", () => {
    const stops = searchStops(ctx([
      tx("a", "Tesco"), tx("b", "Costa", {logo: "https://x/costa.png"}), tx("c", "TESCO LTD", {logo: "https://x/tesco.png"}),
    ]));
    expect(stops).toHaveLength(2);
    expect(stops.map(s => s.name).sort()).toEqual(["Costa", "TESCO LTD"]);
    expect(stops.every(s => s.logo)).toBe(true);
  });
  it("leaves out what isn't waiting to be sorted, and caps the list", () => {
    const txs = Array.from({length: 20}, (_, i) => tx(`t${i}`, `Place ${i}`));
    expect(searchStops(ctx(txs))).toHaveLength(MAX_STOPS);
    expect(searchStops(ctx([tx("x", "Done", {needsCat: false})]))).toEqual([]);
  });
  it("keeps a shop with no logo, with an icon to draw instead", () => {
    const s = searchStops(ctx([tx("a", "Corner Shop")]))[0];
    expect(s.logo).toBeUndefined();
    expect(s.look.icon).toBeTruthy();
  });
});

describe("holdMs", () => {
  it("is long enough to feel like a look, and not endless", () => {
    expect(holdMs(0)).toBe(3500);
    expect(holdMs(4)).toBe(4300);
    expect(holdMs(MAX_STOPS)).toBe(6500);
  });
});

describe("bubblesAt", () => {
  const stops = [1, 2, 3, 4, 5, 6].map(stop);
  it("starts empty and grows one at a time up to four", () => {
    expect(bubblesAt(stops, 0)).toEqual([]);
    expect(bubblesAt(stops, 1).map(p => p.inn)).toEqual([true]);
    expect(bubblesAt(stops, 4).filter(p => p.inn)).toHaveLength(MAX_BUBBLES);
  });
  it("never has more than four in; the oldest goes as the fifth arrives in its slot", () => {
    const five = bubblesAt(stops, 5);
    expect(five.filter(p => p.inn)).toHaveLength(MAX_BUBBLES);
    const gone = five.find(p => !p.inn)!, fresh = five.find(p => p.i === 4)!;
    expect(gone.i).toBe(0);
    expect(gone.slot).toBe(fresh.slot);
  });
  it("carries on through the shops again when the real work takes longer", () => {
    expect(bubblesAt(stops, 7).find(p => p.i === 6)!.stop).toBe(stops[0]);
    expect(bubblesAt([], 3)).toEqual([]);
  });
});
