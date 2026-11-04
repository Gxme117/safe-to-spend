import {calc, hero} from "../calc";
import {cardTapFor, cardTapOf, newCardPayment} from "../cardTap";
import type {Ctx, Tx} from "../types";
import {ctx as makeCtx, TODAY, tx} from "./fixtures";

// TODAY is Mon 5 Oct 2026; the pay cycle started Wed 30 Sep, payday Fri 30 Oct. Groceries is an everyday budget of £200.
const NOW = new Date(2026, 9, 5, 12, 0).getTime();
const bank = (t: Partial<Tx> & Pick<Tx, "amount" | "date">) => tx({monzoId: `m-${Math.random()}`, paidAt: NOW - 60e3, ...t});
const num = (c: Ctx) => { const h = hero(c, calc(c)); if (h.kind !== "number") throw new Error(h.kind); return h; };

test("a grocery payment shows what's left of the groceries budget this pay, as the engine has it", () => {
  const t = bank({amount: 14.2, date: TODAY, cat: "groceries", note: "Tesco"});
  const c = makeCtx({txs: [tx({amount: 147.5, date: "2026-10-02", cat: "groceries"}), t]});
  const p = cardTapOf(c, new Set(), NOW)!;
  const e = calc(c).everyday.find(x => x.x.id === "groceries")!;
  expect(e.left).toBe(38.3);
  expect(p).toMatchObject({
    pot: true, icon: "cart.fill", where: "Tesco", paid: "£14.20", when: "just now",
    compact: "£38", minimal: "£38", headline: "Left for groceries until payday",
    title: "Left for groceries", big: "£38", spent: "£161.70 spent", of: "£200 this pay",
    from: "Wed 30", until: "Lasts until payday",
  });
  expect(p.fill).toBeCloseTo(38.3 / 200);
});

test("any other payment shows what's safe to spend today, the same as Today", () => {
  const t = bank({amount: 11.99, date: TODAY, cat: "other", note: "Amazon"});
  const c = makeCtx({txs: [t]}), h = num(c);
  const p = cardTapOf(c, new Set(), NOW)!;
  expect(p).toMatchObject({
    pot: false, where: "Amazon", paid: "£11.99",
    compact: `£${Math.floor(h.left)}`, big: `£${Math.floor(h.left)}`, headline: "Safe to spend today",
    title: "Safe to spend today", spent: "£11.99 spent", of: `£${h.perDay} today`, from: "Today", until: "Resets at midnight",
  });
  expect(p.fill).toBeCloseTo(h.left / h.perDay);
});

test("a budget gone past its amount says £0 left, never a minus or 'over'", () => {
  const t = bank({amount: 30, date: TODAY, cat: "groceries", note: "Tesco"});
  const c = makeCtx({txs: [tx({amount: 190, date: "2026-10-02", cat: "groceries"}), t]});
  const p = cardTapOf(c, new Set(), NOW)!;
  expect(p).toMatchObject({compact: "£0", big: "£0", fill: 0});
  expect(JSON.stringify(p)).not.toMatch(/−|over/i);
});

test("only a new bank payment out today, not paying a bill, makes the island", () => {
  const old = bank({amount: 5, date: TODAY, cat: "other"});
  const seen = new Set([old.id]);
  const cases: Tx[] = [
    tx({amount: 5, date: TODAY, cat: "other"}),                          // typed in, not from the bank
    bank({amount: 5, date: TODAY, cat: "other", type: "income"}),         // money in
    bank({amount: 5, date: "2026-10-04", cat: "other"}),                  // an earlier day
    bank({amount: 20, date: TODAY, cat: "other", billId: "phone"}),      // paid a bill
  ];
  for (const t of cases) expect(newCardPayment(makeCtx({txs: [old, t]}), seen)).toBeNull();
  expect(newCardPayment(makeCtx({txs: [old]}), new Set())).toBe(old);
});

test("two new payments: the newest is the one shown", () => {
  const a = bank({amount: 3, date: TODAY, cat: "other", note: "Pret", paidAt: NOW - 120e3});
  const b = bank({amount: 4, date: TODAY, cat: "other", note: "Boots", paidAt: NOW - 30e3});
  expect(cardTapOf(makeCtx({txs: [b, a]}), new Set(), NOW)!.where).toBe("Boots");
});

test("a payment over 10 minutes old says when it was, not 'just now'", () => {
  const t = bank({amount: 3, date: TODAY, cat: "other", note: "Pret", paidAt: new Date(2026, 9, 5, 9, 12).getTime()});
  expect(cardTapFor(makeCtx({txs: [t]}), t, NOW)!.when).toBe("at 09:12");
});
