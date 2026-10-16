import {calc, hero, tomorrowLine} from "../calc";
import {r2} from "../money";
import {todayBreakdown, whatIf} from "../today";
import type {Ctx} from "../types";
import {baseState, ctx as makeCtx, TODAY, tx} from "./fixtures";

// TODAY is Mon 5 Oct; payday Fri 30 Oct
const base = (over: Partial<Ctx> = {}) => makeCtx({txs: [tx({amount: 50, date: "2026-10-02", cat: "groceries"})], ...over});
const num = (c: Ctx) => { const h = hero(c, calc(c)); if (h.kind !== "number") throw new Error(h.kind); return h; };
const sum = (rows: {amount: number}[]) => r2(rows.reduce((a, x) => a + x.amount, 0));

test("spending nothing changes nothing: what-if runs the same engine as the Day tab", () => {
  const c = base();
  expect(whatIf(c, 0)!.hero).toEqual(num(c));
});

test("a spend today's amount covers says so, and what's left today", () => {
  const c = base(), h = num(c), w = whatIf(c, 5)!;
  expect(w.line).toBe(`Today's £${h.perDay} covers it. £${h.left - 5} left today`);
});

test("a bigger spend says what each day after it becomes, the same as if you'd really bought it", () => {
  const c = base(), w = whatIf(c, 100)!;
  const bought = {...c, txs: [...c.txs, tx({amount: 100, date: TODAY, cat: ""})]}, r = calc(bought), h = num(bought);
  expect(w.hero).toMatchObject({perDay: h.perDay, left: h.left, free: h.free});
  expect(h.reason).toContain("From tomorrow");
  const per = h.reason.match(/From tomorrow, (£[\d,]+) a day/)![1];
  expect(w.line).toMatch(new RegExp(`^Then it's ${per} a day from tomorrow, instead of £\\d+$`));
  expect(tomorrowLine(r, h)).toBeNull();
});

test("more than what's free says how much more bills and everyday would need, calmly", () => {
  const c = base(), h = num(c), w = whatIf(c, h.free + 30)!;
  expect(w.line).toBe("You'd need £30 more to cover your bills and everyday");
  expect(w.line).not.toMatch(/\b(short|over)\b/i);
});

test("the breakdown adds up: what's free until payday, then today's share of it", () => {
  const c = base({txs: [tx({amount: 50, date: "2026-10-02", cat: "groceries"}), tx({amount: 10, date: TODAY, cat: "eating"})]});
  const r = calc(c), h = num(c), b = todayBreakdown(c, r)!;
  const [head, ...rest] = b.now, free = rest.pop()!;
  expect(head).toMatchObject({label: "Spending money", amount: r.balance});
  expect(free).toMatchObject({label: "Free until payday", amount: h.free, total: true});
  expect(sum([head, ...rest])).toBe(h.free);
  expect(b.today.map(x => [x.label, x.amount])).toEqual([
    ["Free at the start of today", r2(h.free + 10)],
    ["Today's amount", h.perDay],
    ["Spent today", -10],
    ["Left today", h.left],
  ]);
  expect(b.today[1].note).toBe(`£${r2(h.free + 10)} over 25 days, rounded down`);
});

test("without enough, the breakdown shows what's still to cover and the gap a day", () => {
  const c = makeCtx({state: baseState({balance: 100})}), h = num(c), b = todayBreakdown(c, calc(c))!;
  expect(b.now[b.now.length - 1]).toMatchObject({label: "Still to cover", amount: h.free});
  expect(b.today).toEqual([{label: "Shared over the days to payday", note: "25 days", amount: h.left, total: true}]);
});

test("no daily number, no breakdown and no what-if", () => {
  const c = makeCtx({state: baseState({incomes: []})});
  expect(todayBreakdown(c, calc(c))).toBeNull();
  expect(whatIf(c, 10)).toBeNull();
});
