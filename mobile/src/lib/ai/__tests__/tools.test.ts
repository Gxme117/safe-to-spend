import {calc, forecast, hero} from "../../calc";
import {addDays} from "../../dates";
import {baseState, ctx, TODAY, tx} from "../../__tests__/fixtures";
import type {Regular, Scan} from "../../regulars";
import {whatIf} from "../../today";
import type {Bank, Bill, Ctx} from "../../types";
import {knownIn} from "../check";
import type {Product, Shopped} from "../research";
import {appContext, clean, MAX_NOTES, receipt, runTool, TOOL_NAMES, type Note, type ToolEnv} from "../tools";

// Mon 5 Oct 2026: £1,000, paid £1,800 on the last working day (Fri 30 Oct), rent £400 on the 15th, phone £20 on the 1st,
// a £200 groceries budget
const env = (over: Partial<Ctx> = {}, notes: Note[] = [], regulars: ToolEnv["regulars"] = {scan: null, answers: {}}): ToolEnv =>
  ({ctx: ctx(over), notes, who: "frank", newId: () => "n_new", regulars, rules: []});
const run = (name: string, input: object = {}, e = env()) => runTool(name, input, e);
// what the accountant gets
const res = (name: string, input: object = {}, e = env()) => run(name, input, e).result as Record<string, any>;

const monzo: Bank = {source: "Monzo", accountId: "acc_00009XYZ", main: 1000, asOf: "2026-10-05T09:12:00", numbers: ["12345612345678"],
  pots: [{id: "pot_0000HOLS", name: "Holiday", balance: 300, role: "save"}]};

test("the same tools as the server offers", () => {
  expect([...TOOL_NAMES]).toEqual(["overview", "upcoming", "bills", "regulars", "everyday", "spending", "payments", "what_if", "forecast", "calculate", "remember", "forget",
    "add_bill", "change_bill", "remove_bill", "find_products", "show_products",
    "refile_payment", "teach_merchant", "add_category", "rename_category"]);
});

describe("find_products and show_products: a shop's price reaches your money only through show_products' pick", () => {
  const NOW_10 = new Date(2026, 9, 5, 10, 0);
  const item = (over: Partial<Product> = {}): Omit<Product, "id"> => ({name: "Apple iPhone 17 256GB £899 Black", brand: "Apple", model: "IPHONE 17", group: "apple|17|256gb",
    retailer: "Apple", host: "apple.com", url: "https://www.apple.com/uk/shop/buy-iphone/iphone-17", price: 899, confidence: "verified", priceSource: "https://www.apple.com/uk/shop/buy-iphone/iphone-17",
    image: "https://imgs.search.brave.com/i.jpg", condition: "new", delivery: 4.99, checked: "2026-10-05T09:00:00.000Z", ...over});
  const shopped: Shopped = {products: [item(), item({retailer: "Argos", host: "argos.co.uk", url: "https://www.argos.co.uk/product/1", price: 879, confidence: "search_listed", delivery: "free"}),
    item({retailer: "Currys", host: "currys.co.uk", url: "https://www.currys.co.uk/p.html", price: null, confidence: null, priceSource: null})]};
  const ARGS = {queries: ["iPhone 17 UK"], match: ["iPhone 17"], exclude: [], max_price: 0};
  const found = run("find_products", ARGS, {...env(), shopped, firstId: 4, now: NOW_10});
  const catalogue = new Map(found.products!.map(p => [p.id, p]));
  const onCard: ToolEnv = {...env(), catalogue, now: NOW_10};

  test("find_products numbers what /shop found from where the chat is, prices as numbers and nothing else, no £ in any words", () => {
    const r = found.result as Record<string, any>;
    expect(found.products!.map(p => p.id)).toEqual(["p4", "p5", "p6"]);
    expect(r.products[0]).toMatchObject({id: "p4", name: "Apple iPhone 17 256GB Black", shop: "Apple", price: 899, price_is: "on the shop's own page now", delivery: 4.99, condition: "new"});
    expect(r.products[1]).toMatchObject({id: "p5", same_thing_as: "p4", delivery: "free", price_is: "listed in search; the shop's page couldn't be checked"});
    expect(r.products[2]).toMatchObject({id: "p6", price: null, price_is: "no price found"});
    expect(JSON.stringify(r).replace(/"(?:url|photo|price_page)":"[^"]*"/g, "")).not.toContain("£");
    // the only numbers in it are prices and delivery
    expect(knownIn([{role: "user", content: [{type: "tool_result", tool_use_id: "t", content: JSON.stringify(r)}]}]).sort()).toEqual([4.99, 4.99, 879, 899].sort());
  });

  test("find_products says which is the cheapest that fits (a flag, no new figure), and that it's the one to pick", () => {
    const r = found.result as Record<string, any>;
    expect(r.products.filter((x: any) => x.cheapest).map((x: any) => x.id)).toEqual(["p5"]); // £879, free delivery, beats £899 + £4.99
    expect(r.do_next).toMatch(/The cheapest that fits is p5 at Argos/);
    const one = run("find_products", ARGS, {...env(), shopped: {products: [item()]}, firstId: 1, now: NOW_10}).result as Record<string, any>;
    expect(one.products[0].cheapest).toBeUndefined();
    expect(one.do_next).not.toMatch(/cheapest/);
  });

  test("best value: a pick dearer than the card's cheapest needs a reason, and the cheapest is tried against their money too", () => {
    const bare = run("show_products", {title: "iPhone 17", note: "", ids: ["p4", "p5"], pick: "p4", why: ""}, onCard);
    expect(bare).toMatchObject({error: true, result: {error: expect.stringMatching(/p5 at Argos is cheaper\. Say in why what makes p4 worth more/)}});
    const out = run("show_products", {title: "iPhone 17", note: "", ids: ["p4", "p5"], pick: "p4", why: "Apple's own warranty £1"}, onCard), r = out.result as Record<string, any>;
    expect(out.research?.why).toBe("Apple's own warranty");
    expect(r.cheapest).toEqual({id: "p5", name: "Apple iPhone 17 256GB Black", shop: "Argos", price: 879, with_delivery: 879, price_is: "listed in search; the shop's page couldn't be checked",
      what_if: res("what_if", {amount: 879})});
    expect(r.do_next).toMatch(/You went by p4 for best value over the cheapest, p5 at Argos: say what the extra buys and how much more/);
    // the cheapest picked: no second run, and he says it's the cheapest
    const cheapest = run("show_products", {title: "iPhone 17", note: "", ids: ["p4", "p5"], pick: "p5", why: ""}, onCard);
    expect((cheapest.result as Record<string, any>).cheapest).toBeUndefined();
    expect(cheapest.research?.why).toBeUndefined();
    expect((cheapest.result as Record<string, any>).do_next).toMatch(/It's the cheapest on the card that fits/);
    // nothing to compare: nothing said
    const alone = run("show_products", {title: "iPhone 17", note: "", ids: ["p4"], pick: "p4"}, onCard).result as Record<string, any>;
    expect(alone.do_next).not.toMatch(/cheap/);
  });

  test("best value: when the cheaper one fits their money and the pick doesn't, he's told to go by the cheaper one", () => {
    const big = new Map([["p1", {...catalogue.get("p4")!, id: "p1", price: 90_000}], ["p2", {...catalogue.get("p5")!, id: "p2", price: 1}]]);
    const r = run("show_products", {title: "x", note: "", ids: ["p1", "p2"], pick: "p1", why: "Better"}, {...onCard, catalogue: big}).result as Record<string, any>;
    expect(r.what_if.after_it.still_needed_for_bills_and_everyday).toBeGreaterThan(0);
    expect(r.do_next).toMatch(/The cheaper one, p2 at Argos, fits their money and this doesn't: go by the cheaper one/);
  });

  test("with pick, the rest of the card is tried against their money too, so he can say which they can afford", () => {
    const card = new Map([["p1", {...catalogue.get("p4")!, id: "p1"}], ["p2", {...catalogue.get("p5")!, id: "p2"}],
      ["p3", {...catalogue.get("p4")!, id: "p3", retailer: "Currys", price: 90_000, delivery: null, confidence: "estimated" as const}], ["p6", catalogue.get("p6")!]]);
    const r = run("show_products", {title: "x", note: "", ids: ["p1", "p2", "p3", "p6"], pick: "p1", why: "Apple's own"}, {...onCard, catalogue: card}).result as Record<string, any>;
    // not the pick, not the cheapest (it has its own), not one with no price
    expect(r.others.map((o: any) => o.id)).toEqual(["p3"]);
    expect(r.others[0]).toMatchObject({shop: "Currys", price: 90_000, with_delivery: 90_000, price_is: "an estimate, not a shop's current listing", fits: false,
      after_it: res("what_if", {amount: 90_000}).after_it});
    expect(r.do_next).toMatch(/others has the rest of the card tried against their money/);
    // one that fits
    const ok = run("show_products", {title: "x", note: "", ids: ["p1", "p2", "p3"], pick: "p2"}, {...onCard, catalogue: new Map([...card].map(([k, p]) => [k, k === "p3" ? {...p, price: 5} : p]))}).result as Record<string, any>;
    expect(ok.others.find((o: any) => o.id === "p3").fits).toBe(true);
  });

  test("find_products that couldn't look, or arguments that make no sense, say so", () => {
    expect(run("find_products", ARGS, {...env(), shopped: {error: "unavailable"}})).toMatchObject({error: true, result: {error: expect.stringMatching(/Couldn't look round the shops/)}});
    expect(run("find_products", ARGS, env()).error).toBe(true);
    expect(run("find_products", {...ARGS, queries: []}, {...env(), shopped}).error).toBe(true);
    expect(run("find_products", {...ARGS, queries: Array(7).fill("tv")}, {...env(), shopped}).error).toBe(true);
    expect(run("find_products", {...ARGS, max_price: -5}, {...env(), shopped}).error).toBe(true);
  });

  test("show_products with pick runs the engine on its price and delivery, the same as what_if and Today's What if, with how sure it is", () => {
    const out = run("show_products", {title: "iPhone 17", note: "", ids: ["p4", "p5"], pick: "p4", why: "Apple's own"}, onCard), r = out.result as Record<string, any>;
    expect(out.ran).toBe(true);
    expect(r.what_if).toEqual(res("what_if", {amount: 903.99}));
    expect(r.what_if.in_the_app).toBe(whatIf(ctx(), 903.99)!.line);
    expect(r.went_by).toEqual({id: "p4", name: "Apple iPhone 17 256GB Black", shop: "Apple", price: 899, with_delivery: 903.99, price_is: "on the shop's own page now"});
    expect(r.overview).toEqual(res("overview"));
    expect(out.research).toMatchObject({v: 2, title: "iPhone 17", pick: "p4"});
    expect(out.research?.products.map(p => p.id)).toEqual(["p4", "p5"]);
    expect(r.do_next).toMatch(/^Answer now/);
    expect(r.do_next).not.toMatch(/couldn't be checked|estimate|may have changed/);
  });

  test("a listed price, an estimate, a starting price and an old one are each said to him so he says it too", () => {
    const listed = run("show_products", {title: "iPhone 17", note: "", ids: ["p5"], pick: "p5"}, onCard).result as Record<string, any>;
    expect(listed.do_next).toMatch(/Argos lists it in search; their page couldn't be checked/);
    const odd = new Map([["p7", {...catalogue.get("p4")!, id: "p7", confidence: "estimated" as const, from: true as const, checked: "2026-10-01T09:00:00.000Z"}]]);
    const est = run("show_products", {title: "iPhone 17", note: "", ids: ["p7"], pick: "p7"}, {...onCard, catalogue: odd}).result as Record<string, any>;
    expect(est.do_next).toMatch(/only an estimate: say "around"/);
    expect(est.do_next).toMatch(/starting price: write "from"/);
    expect(est.do_next).toMatch(/That price was seen on 2026-10-01 Thu: say it may have changed/);
  });

  test("without pick: the card only, no engine, and the others are named, never priced", () => {
    const out = run("show_products", {title: "iPhone 17 £899", note: "", ids: ["p5", "p4", "p5"], pick: ""}, onCard);
    expect(out.ran).toBeUndefined();
    expect(out.research).toMatchObject({title: "iPhone 17"});
    expect(out.research?.products.map(p => p.id)).toEqual(["p5", "p4"]);
    expect(knownIn([{role: "user", content: [{type: "tool_result", tool_use_id: "t", content: JSON.stringify(out.result)}]}])).toEqual([]);
  });

  test("ids that don't exist, a pick not on the card or with no price, say so", () => {
    expect(run("show_products", {title: "x", note: "", ids: ["p9"], pick: ""}, onCard)).toMatchObject({error: true, result: {error: expect.stringMatching(/There's no product p9: use ids find_products gave \(p4, p5, p6\)/)}});
    expect(run("show_products", {title: "x", note: "", ids: ["p4"], pick: "p5"}, onCard).error).toBe(true);
    expect(run("show_products", {title: "x", note: "", ids: ["p6"], pick: "p6"}, onCard)).toMatchObject({error: true, result: {error: expect.stringMatching(/p6 has no price found/)}});
    expect(run("show_products", {title: "x", note: "", ids: [], pick: ""}, onCard).error).toBe(true);
  });

  test("the line under an answer says a what if only when the engine really ran", () => {
    const s = baseState();
    expect(receipt(["find_products", "show_products"], s, NOW_10, true)).toBeNull();
    expect(receipt(["find_products", "show_products", "what_if"], s, NOW_10, true)).toBe("Your figures checked against a what if (your balance from Thu 1 Oct)");
  });
});

test("overview: the engine's own figures for today and until payday, and where they come from", () => {
  const x = ctx(), c = calc(x), h = hero(x, c);
  if (h.kind !== "number") throw new Error("no number");
  const o = res("overview");
  expect(o.today).toBe("2026-10-05 Mon");
  expect(o.today_amount).toEqual({amount: h.perDay, spent_today: 0, left_today: h.left, in_the_app: h.reason});
  expect(o.until_payday).toMatchObject({payday: "2026-10-30 Fri", days_to_payday: 25, spending_money: 1000, held_for_bills: c.billsLeft,
    held_for_everyday: c.everydayLeft, held_for_savings: 0, free_until_payday: h.free});
  expect(o.until_payday.pay_is_late).toBeUndefined();
  expect(o.pay).toEqual({name: "Pharmacy", how_often: "monthly, last working day", amount: 1800});
  expect(o.figures_from[0]).toBe("Spending money is the balance the person typed in on 2026-10-01 Thu, plus payments logged in the app since. No bank is connected.");
});

test("overview with a bank: synced when, savings pots apart, and never an account number or id", () => {
  const o = res("overview", {}, env({state: baseState({bank: monzo})}));
  expect(o.figures_from[0]).toBe("Spending money is from Monzo (synced Mon 5 Oct 09:12), plus anything logged since.");
  expect(o.in_savings_pots).toEqual({amount: 300, note: "Not spending money."});
  const sent = JSON.stringify(o);
  for (const secret of ["acc_00009XYZ", "12345612345678", "pot_0000HOLS"]) expect(sent).not.toContain(secret);
});

test("overview when there's no daily number says why, never a made-up one", () => {
  expect(res("overview", {}, env({state: baseState({incomes: []})})).today_amount).toEqual({none: expect.stringContaining("No pay is set up yet")});
});

test("upcoming: bills by date, paid or not, and payday, up to payday unless asked further", () => {
  const u = res("upcoming", {to: null});
  expect(u.to).toBe("2026-10-30 Fri");
  expect(u.bills).toEqual([{date: "2026-10-15 Thu", name: "Rent", amount: 400, paid: false, how: "direct debit"}]);
  expect(u.paydays).toEqual([{date: "2026-10-30 Fri", name: "Pharmacy", amount: 1800}]);
  expect(u.held_back_now_for_bills).toBe(calc(ctx()).billsLeft);
  // further on: November's and December's too, never more than 62 days (Sun 6 Dec, before December's rent)
  const far = res("upcoming", {to: "2027-03-01"});
  expect(far.to).toBe(`${addDays(TODAY, 62)} Sun`);
  expect(far.bills.map((b: {name: string}) => b.name)).toEqual(["Rent", "Phone", "Rent", "Phone"]);
  expect(run("upcoming", {to: "2026-10-01"})).toEqual({result: {error: "to can't be before 2026-10-05."}, error: true});
  expect(run("upcoming", {to: "next week"})).toEqual({result: {error: "to must be a date like 2026-10-30."}, error: true});
});

test("what_if: the engine run with the payment added, the same as the What if on Today", () => {
  const w = whatIf(ctx(), 150)!, x = ctx(), h = hero(x, calc(x));
  if (h.kind !== "number") throw new Error("no number");
  const r = res("what_if", {amount: 150});
  expect(r.now).toMatchObject({todays_amount: h.perDay, left_today: h.left, free_until_payday: h.free});
  expect(r.after_it).toMatchObject({left_today: w.hero.left, free_until_payday: w.hero.free, per_day_from_tomorrow: Math.floor(w.hero.free / 24)});
  expect(r.in_the_app).toBe(w.line);
  expect(run("what_if", {amount: 0}).error).toBe(true);
  expect(run("what_if", {amount: "lots"}).error).toBe(true);
  // more than there is: how much more bills and everyday would need, never a negative day
  const big = res("what_if", {amount: 900});
  expect(big.after_it.per_day_from_tomorrow).toBe(0);
  expect(big.after_it.still_needed_for_bills_and_everyday).toBeGreaterThan(0);
});

test("forecast: Safe to Spend each day from tomorrow, the engine's, with payday marked", () => {
  const x = ctx(), c = calc(x), f = res("forecast", {to: null});
  expect(f.days[0]).toEqual({date: "2026-10-06 Tue", safe_to_spend: forecast(x, c, "2026-10-06")!.amount});
  expect(f.days.find((d: {payday?: boolean}) => d.payday).date).toBe("2026-10-30 Fri");
  expect(f.days[f.days.length - 1].date).toBe("2026-10-31 Sat");
  expect(f.note).toMatch(/^An estimate/);
});

test("everyday: each budget, spent this pay cycle and what's left", () => {
  const e = res("everyday", {}, env({txs: [tx({amount: 230, date: "2026-10-03", cat: "groceries"})]}));
  expect(e.budgets).toEqual([{name: "Groceries", monthly_budget: 200, spent_this_pay_cycle: 230, left: 0, past_it_by: 30}]);
});

// what the accountant gets, as the £ check reads it: every number in it is a figure he may state
const figures = (result: unknown) => knownIn([{role: "user", content: [{type: "tool_result", tool_use_id: "x", content: JSON.stringify(result)}]}]);

test("bills: each one once, what it comes to a month and a year, and the totals; one-offs apart", () => {
  const more: Bill[] = [
    {id: "gym", name: "Gym", amount: 10, freq: "weekly", date: "2026-10-09"},
    {id: "ins", name: "Insurance", amount: 120, freq: "yearly", date: "2026-12-01", payee: "AVIVA 12345678"},
    {id: "water", name: "Water", amount: 0, freq: "monthly", day: 8},
    {id: "gift", name: "Wedding gift", amount: 50, freq: "oneoff", date: "2026-10-20"},
  ];
  const b = res("bills", {}, env({state: baseState({bills: [...baseState().bills, ...more]})}));
  expect(b.bills.map((x: {name: string}) => x.name)).toEqual(["Rent", "Phone", "Gym", "Insurance", "Water"]);
  expect(b.bills[0]).toEqual({id: "rent", name: "Rent", amount: 400, how_often: "every month", when: "15th of every month", how: "direct debit",
    next_due: "2026-10-15 Thu", this_pay_cycle: ["due 2026-10-15 Thu"], a_month: 400, a_year: 4800});
  // the phone went out on Thu 1 Oct with nothing paid; next it's Mon 2 Nov (the 1st is a Sunday)
  expect(b.bills[1]).toMatchObject({this_pay_cycle: ["not paid 2026-10-01 Thu"], next_due: "2026-11-02 Mon"});
  expect(b.bills[2]).toMatchObject({how_often: "every week", a_month: 43.33, a_year: 520,
    this_pay_cycle: ["not paid 2026-10-02 Fri", "due 2026-10-09 Fri", "due 2026-10-16 Fri", "due 2026-10-23 Fri"]});
  expect(b.bills[3]).toMatchObject({when: "1 December every year", a_month: 10, a_year: 120, this_pay_cycle: [], paid_to: "AVIVA •••"});
  expect(b.bills[4]).toMatchObject({no_amount_yet: true});
  expect(b.bills[4].a_month).toBeUndefined();
  expect(b.one_offs).toEqual([{id: "gift", name: "Wedding gift", amount: 50, on: "2026-10-20 Tue"}]);
  expect(b.totals).toMatchObject({a_month: 473.33, a_year: 5680});
  // a day of the month is never a figure he could state as £15
  expect(figures(b)).not.toContain(15);
  expect(figures(b)).not.toContain(8);
});

describe("regulars: what the bank's payments show that isn't in the bills", () => {
  const flix: Bill = {id: "flix", name: "Netflix", amount: 10.99, freq: "monthly", day: 3, method: "card", payee: "NETFLIX.COM"};
  const reg = (o: Partial<Regular> & Pick<Regular, "name" | "amount">): Regular => ({payee: o.name, varies: false, freq: "monthly", day: 12, method: "card",
    n: 3, ref: o.name.toLowerCase(), first: "2026-07-13", last: "2026-09-14", amounts: [o.amount, o.amount, o.amount], sure: "likely", ...o});
  const found = [reg({name: "EE", amount: 20, day: 1, method: "dd"}), reg({name: "Spotify", amount: 11.99}), reg({name: "Disney Plus", amount: 9.99, n: 2, sure: "maybe"})];
  const scan: Scan = {at: TODAY, from: "2026-07-07", found};
  const banked = env({state: baseState({bank: monzo, bills: [...baseState().bills, flix]}),
    txs: [tx({amount: 12.99, date: "2026-10-03", note: "NETFLIX.COM", billId: "flix", forDate: "2026-10-05", monzoId: "m1"})]}, [], {scan, answers: {}});

  test("each with what it's based on, one like a bill you have asked about as that bill, changes and two of a kind", () => {
    const r = res("regulars", {}, banked);
    expect(r.looked_through).toEqual({from: "2026-07-07 Tue", to: "2026-10-05 Mon"});
    expect(r.not_in_bills).toHaveLength(3);
    expect(r.not_in_bills[0]).toMatchObject({paid_to: "EE", how: "direct debit", maybe_same_as: {bill_id: "phone", name: "Phone"}});
    expect(r.not_in_bills[1]).toEqual({ref: "spotify", paid_to: "Spotify", amount: 11.99, how_often: "every month", when: "12th of every month", how: "card",
      seen: "3 times, 2026-07-13 Mon to 2026-09-14 Mon", sure: "likely"});
    expect(r.not_in_bills[2]).toMatchObject({sure: "maybe", seen: expect.stringMatching(/^2 times/)});
    expect(r.changes).toEqual([{bill_id: "flix", name: "Netflix", change: "new price", bill_says: 10.99, latest_payment: 12.99, paid_on: "2026-10-03 Sat"}]);
    expect(r.two_of_a_kind).toEqual([{kind: "streaming", names: ["Netflix", "Disney+"]}]);
    expect(figures(r)).not.toContain(12);
    expect(JSON.stringify(r)).not.toMatch(/acc_00009XYZ|12345612345678|m1/);
  });

  test("ones you answered stay out; ten at most; no bank says so", () => {
    const answered = env({state: baseState({bank: monzo})}, [], {scan, answers: {spotify: {verdict: "not_a_bill", at: TODAY, name: "Spotify"}}});
    expect(res("regulars", {}, answered).not_in_bills.map((x: {paid_to: string}) => x.paid_to)).toEqual(["EE", "Disney Plus"]);
    const many = Array.from({length: 12}, (_, i) => reg({name: `Shop ${String.fromCharCode(65 + i)}`, amount: 30 - i}));
    const lots = res("regulars", {}, env({state: baseState({bank: monzo})}, [], {scan: {...scan, found: many}, answers: {}}));
    expect([lots.not_in_bills.length, lots.more_not_shown]).toEqual([10, "2 more, smaller"]);
    expect(res("regulars").none).toBe("No bank is connected, so there are no payments to look through.");
  });
});

const paid = [
  tx({amount: 50, date: "2026-10-02", cat: "groceries", note: "Tesco"}),
  tx({amount: 20, date: "2026-10-04", cat: "groceries", note: "Tesco", logo: "https://logo.example/tesco.png"}),
  tx({amount: 10, date: "2026-10-04", type: "income", cat: "groceries", refundOf: "groceries", note: "Tesco"}),
  tx({amount: 400, date: "2026-09-15", cat: "rent", billId: "rent", note: "Landlord ltd"}),
  tx({amount: 70, date: "2026-10-03", cat: "other", note: "TFR 12-34-56 12345678 JOHN"}),
];

test("spending: totals by category or payee, refunds off, a note when payments don't go back that far", () => {
  const byCat = res("spending", {from: "2026-10-01", to: "2026-10-31", by: "category"}, env({txs: paid}));
  expect(byCat.to).toBe("2026-10-05 Mon"); // never after today
  expect(byCat.by_category).toEqual([{name: "Other", amount: 70, payments: 1}, {name: "Groceries", amount: 60, payments: 2}]);
  expect(byCat.total_spent).toBe(130);
  const byPayee = res("spending", {from: "2026-09-01", to: "2026-10-05", by: "payee"}, env({txs: paid}));
  expect(byPayee.by_payee.map((g: {name: string}) => g.name)).toEqual(["Landlord ltd", "TFR ••• JOHN", "Tesco"]);
  expect(res("spending", {from: "2026-01-01", to: "2026-10-05", by: "category"}, env({txs: paid})).note).toBe("Payments in the app only go back to 2026-09-15 Tue.");
  expect(run("spending", {from: "2026-10-05", to: "2026-10-01", by: "category"}, env({txs: paid})).error).toBe(true);
});

test("payments: newest first, filtered, never a logo, and no long digit runs in a payee", () => {
  const p = res("payments", {from: "2026-09-01", to: "2026-10-05", category: null, search: null, limit: null}, env({txs: paid}));
  expect(p.found).toBe(5);
  expect(p.payments[0]).toMatchObject({date: "2026-10-04 Sun"});
  expect(p.payments.find((x: {bill?: string}) => x.bill)).toMatchObject({amount: 400, kind: "out", bill: "Rent", who: "Landlord ltd"});
  expect(p.payments.find((x: {kind: string}) => x.kind === "refund")).toMatchObject({amount: 10, category: "Groceries"});
  expect(JSON.stringify(p)).not.toMatch(/logo|12345678/);
  const groceries = res("payments", {from: "2026-09-01", to: "2026-10-05", category: "Groceries", search: null, limit: 1}, env({txs: paid}));
  expect([groceries.found, groceries.shown, groceries.payments.length]).toEqual([3, 1, 1]);
  expect(res("payments", {from: "2026-09-01", to: "2026-10-05", category: null, search: "landlord", limit: null}, env({txs: paid})).found).toBe(1);
  expect(run("payments", {from: "2026-09-01", to: "2026-10-05", category: null, search: null, limit: 500}).error).toBe(true);
});

test("payee names lose any run of 6 or more digits (account numbers, sort codes, references), and stay short", () => {
  expect(clean("TFR 12-34-56 12345678 JOHN")).toBe("TFR ••• JOHN");
  expect(clean("Ref 123456")).toBe("Ref •••");
  expect(clean("Pret A Manger 0123")).toBe("Pret A Manger 0123");
  expect(clean("x".repeat(80))).toHaveLength(60);
});

test("calculate: exact sums he can show, and why one didn't work", () => {
  expect(run("calculate", {expression: "(600 - 140) / 4"})).toEqual({result: {expression: "(600 - 140) / 4", result: 115}});
  expect(run("calculate", {expression: "600 / 0"})).toEqual({result: {error: "That divides by zero."}, error: true});
});

const tv: Note = {id: "n_tv", kind: "goal", text: "Saving for a TV for Christmas", amount: 600, by: "2026-12-20", at: "2026-10-01", who: "tim"};

test("remember: a note for the store to save, by whoever was asked, dated today", () => {
  const out = run("remember", {kind: "goal", text: "  Saving for a   TV ", amount: 600, by: "2026-12-20"});
  expect(out.effect).toEqual({add: {id: "n_new", kind: "goal", text: "Saving for a TV", amount: 600, by: "2026-12-20", at: TODAY, who: "frank"}});
  expect(out.result).toMatchObject({saved: {id: "n_new", text: "Saving for a TV"}});
  expect(run("remember", {kind: "goal", text: "x".repeat(300), amount: null, by: null}).effect).toMatchObject({add: {text: "x".repeat(120)}});
  expect(run("remember", {kind: "secret", text: "Hi", amount: null, by: null}).error).toBe(true);
  expect(run("remember", {kind: "plan", text: "", amount: null, by: null}).error).toBe(true);
  const full = Array.from({length: MAX_NOTES}, (_, i) => ({...tv, id: `n_${i}`}));
  expect(run("remember", {kind: "plan", text: "One more", amount: null, by: null}, env({}, full)).error).toBe(true);
});

test("forget: only a note that exists", () => {
  expect(run("forget", {id: "n_tv"}, env({}, [tv]))).toEqual({result: {forgotten: "Saving for a TV for Christmas"}, effect: {remove: tv}});
  expect(run("forget", {id: "n_nope"}, env({}, [tv])).error).toBe(true);
  expect(run("delete_everything", {})).toEqual({result: {error: "There's no tool called delete_everything."}, error: true});
});

test("what the app says at the start of a question: the date and time, and his notes at the start of a conversation", () => {
  const now = new Date(2026, 9, 5, 14, 5);
  expect(appContext(now, null)).toBe("<app_context>\nNow: 2026-10-05 (Mon 5 October 2026), 14:05.\n</app_context>");
  expect(appContext(now, [tv])).toBe("<app_context>\nNow: 2026-10-05 (Mon 5 October 2026), 14:05.\n"
    + "Your notes from earlier conversations, all things the person told you:\n"
    + "- [n_tv] Saving for a TV for Christmas (£600 by 2026-12-20 Sun). A goal, noted 2026-10-01 Thu.\n</app_context>");
  expect(appContext(now, [])).toContain("You have no notes from earlier conversations.");
});

test("the line under an answer: what it was checked against, and how fresh", () => {
  const now = new Date(2026, 9, 5, 10, 0);
  expect(receipt(["overview", "calculate", "overview", "remember"], baseState(), now)).toBe("Checked against your numbers (your balance from Thu 1 Oct) · a sum");
  expect(receipt(["what_if", "upcoming"], baseState({bank: monzo}), now)).toBe("Checked against a what if (Monzo, 09:12) · what's due");
  expect(receipt(["calculate"], baseState(), now)).toBe("Checked against a sum");
  // he searched the web too: this only speaks for your own figures
  expect(receipt(["what_if"], baseState({bank: monzo}), now, true)).toBe("Your figures checked against a what if (Monzo, 09:12)");
  expect(receipt([], baseState(), now, true)).toBeNull();
  expect(receipt(["remember"], baseState(), now)).toBeNull();
  expect(receipt([], baseState(), now)).toBeNull();
});

describe("add_bill, change_bill, remove_bill: a card, never a change", () => {
  const spotify: Regular = {name: "Spotify", payee: "Spotify", amount: 11.99, varies: false, freq: "monthly", day: 12, method: "card", n: 3,
    ref: "spotify", first: "2026-07-13", last: "2026-09-14", amounts: [11.99, 11.99, 11.99], sure: "likely"};
  const none = {name: null, amount: null, how_often: null, day_of_month: null, next_date: null, varies: null, from_regular: null};
  const withScan = env({}, [], {scan: {at: TODAY, from: "2026-07-07", found: [spotify]}, answers: {}});

  test("a regular payment brings who it's paid to and how; the effect is only ever a proposal", () => {
    const out = run("add_bill", {...none, from_regular: "spotify"}, withScan);
    expect(out.effect).toEqual({propose: {kind: "add", ref: "spotify", bill: expect.objectContaining({id: "n_new", payee: "Spotify", method: "card", source: "bank", since: TODAY})}});
    expect(out.result).toMatchObject({saved: false, card: expect.stringMatching(/^Add Spotify: £11.99 every month; 12th of every month; Card, to Spotify\./)});
    expect(run("change_bill", {...none, bill_id: "phone", amount: 25}).effect).toMatchObject({propose: {kind: "change", after: {amount: 25}}});
    expect(run("remove_bill", {bill_id: "rent"}).effect).toMatchObject({propose: {kind: "remove", bill: {id: "rent"}}});
  });

  test("what's missing or wrong comes back as something to ask or fix", () => {
    expect(run("add_bill", {...none, name: "Rent", amount: 400, how_often: "monthly", day_of_month: 15}).result).toEqual({error: expect.stringMatching(/already a bill for this.*id rent/)});
    expect(run("add_bill", {...none, from_regular: "netflix"}, withScan).error).toBe(true);
    expect(run("add_bill", {...none, name: "Gym", how_often: "monthly"}).result).toEqual({error: "Ask how much Gym is."});
    expect(run("add_bill", {...none, name: "Gym", amount: 30, how_often: "monthly", next_date: "soon"}).error).toBe(true);
    expect(run("add_bill", {...none, name: "Gym", amount: 30, how_often: "daily"}).error).toBe(true);
    expect(run("remove_bill", {bill_id: "nope"}).error).toBe(true);
  });
});
