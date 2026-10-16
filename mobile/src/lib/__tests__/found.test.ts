import {findAll, findBills, findPay, findPayees, findPays, findSpending, payRule, payRuleText} from "@/lib/found";
import type {RawTx} from "@/lib/monzo";
import {TODAY} from "./fixtures";

// TODAY is Mon 5 Oct 2026. Midday UTC is the same day in any UK time.
let n = 0;
const t = (date: string, pounds: number, over: Partial<RawTx> = {}): RawTx =>
  ({id: `f${++n}`, amount: Math.round(pounds * 100), created: `${date}T12:00:00Z`, ...over});
const dd = (name: string) => ({scheme: "bacs", category: "bills", counterparty: {name}, description: name.toUpperCase()});
const shop = (name: string, category = "entertainment") => ({scheme: "mastercard", category, merchant: {name}});

test("pay is the payer who repeats, not the biggest money in", () => {
  const acme = {category: "income", counterparty: {name: "ACME LTD"}};
  const raw = [
    t("2026-07-31", 2100, {...acme, description: "ACME LTD SALARY 0726"}), t("2026-08-28", 2100, {...acme, description: "ACME LTD SALARY 0826"}),
    t("2026-09-30", 2140, {...acme, description: "ACME LTD SALARY 0926"}),
    t("2026-09-10", 3000, {category: "income", description: "HMRC REFUND"}),
    t("2026-09-12", 500, {category: "transfers", description: "Mum"}),
  ];
  expect(findPay(raw, TODAY)).toEqual({amount: 2140, from: "ACME LTD", date: "2026-09-30", dates: ["2026-07-31", "2026-08-28", "2026-09-30"]});
});

test("with nobody repeating, pay is the biggest income in the last 35 days; nothing filed as income, no guess", () => {
  const raw = [t("2026-07-31", 5000, {category: "income", description: "OLD JOB"}), t("2026-09-30", 1900, {category: "income", description: "NEW JOB"})];
  expect(findPay(raw, TODAY)).toEqual({amount: 1900, from: "NEW JOB", date: "2026-09-30", dates: ["2026-09-30"]});
  expect(findPay([t("2026-09-30", 1900, {category: "transfers", description: "Sam"})], TODAY)).toBeNull();
});

test("payday is the rule that matches every pay seen", () => {
  // last working day: Fri 31 Jul, Fri 28 Aug (the 31st is a bank holiday), Wed 30 Sep
  expect(payRule(["2026-07-31", "2026-08-28", "2026-09-30"], TODAY)).toEqual({freq: "monthly-lastworking", date: "2026-10-30", n: 3});
  // the 25th, moved earlier off Sat 25 Jul; the date box gets the 25th itself, which sets the day
  expect(payRule(["2026-07-24", "2026-08-25", "2026-09-25"], TODAY)).toEqual({freq: "monthly-date", day: 25, date: "2026-10-25", n: 3});
  expect(payRule(["2026-07-17", "2026-08-14", "2026-09-11"], TODAY)).toEqual({freq: "fourweekly", date: "2026-10-09", n: 3});
  expect(payRule(["2026-09-18", "2026-10-02"], TODAY)).toEqual({freq: "fortnightly", date: "2026-10-16", n: 2});
});

test("a pay that came a day late still picks payday, saying around", () => {
  // the 10th, but August's came on Tue 11th
  const r = payRule(["2026-07-10", "2026-08-11", "2026-09-10"], TODAY);
  expect(r).toEqual({freq: "monthly-date", day: 10, date: "2026-10-10", n: 3, near: true});
  expect(payRuleText(r!)).toBe("Your last 3 pays came around the 10th.");
});

test("an extra payment, like a bonus, doesn't hide how often you're paid", () => {
  expect(payRule(["2026-07-31", "2026-08-14", "2026-08-28", "2026-09-30"], TODAY)).toEqual({freq: "monthly-lastworking", date: "2026-10-30", n: 3});
});

test("weekly pay is weekly, not monthly", () => {
  const fridays = ["2026-08-28", "2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02"];
  expect(payRule(fridays, TODAY)).toMatchObject({freq: "weekly", date: "2026-10-09", n: 6});
});

test("expenses paid back by your employer aren't paydays", () => {
  const acme = {category: "income", counterparty: {name: "ACME LTD"}};
  const raw = [t("2026-07-31", 2100, acme), t("2026-08-12", 45.5, acme), t("2026-08-28", 2100, acme), t("2026-09-30", 2100, acme)];
  expect(findPay(raw, TODAY)?.dates).toEqual(["2026-07-31", "2026-08-28", "2026-09-30"]);
});

test("pay is the same payer whatever month its reference names", () => {
  const raw = ["JUL", "AUG", "SEPT"].map((m, i) => t(["2026-07-31", "2026-08-28", "2026-09-30"][i], 2100, {category: "income", description: `ACME SALARY ${m}`}));
  expect(findPay(raw, TODAY)).toMatchObject({from: "ACME SALARY SEPT", dates: ["2026-07-31", "2026-08-28", "2026-09-30"]});
});

test("a reference that changes completely: pay is the money in about the same size as your last", () => {
  const raw = [
    t("2026-07-31", 2080, {category: "income", description: "BGC REF QWX"}), t("2026-08-28", 2120, {category: "income", description: "BGC REF PLM"}),
    t("2026-09-30", 2100, {category: "income", description: "BGC REF ZRT"}), t("2026-09-10", 300, {category: "income", description: "Etsy"}),
  ];
  const pay = findPay(raw, TODAY)!;
  expect(pay).toMatchObject({amount: 2100, dates: ["2026-07-31", "2026-08-28", "2026-09-30"]});
  expect(payRule(pay.dates, TODAY)?.freq).toBe("monthly-lastworking");
});

test("one pay, or pays no rule explains, and payday isn't guessed", () => {
  expect(payRule(["2026-09-30"], TODAY)).toBeNull();
  expect(payRule(["2026-07-03", "2026-08-19", "2026-09-30"], TODAY)).toBeNull();
  expect(payRule(["2026-07-31", "2026-09-30"], TODAY)).toBeNull();   // August's is missing
});

test("why payday is already picked, in one line", () => {
  expect(payRuleText({freq: "monthly-lastworking", date: "2026-10-30", n: 3})).toBe("Your last 3 pays came on the last working day.");
  expect(payRuleText({freq: "monthly-date", day: 25, date: "2026-10-25", n: 2})).toBe("Your last 2 pays came on the 25th.");
  expect(payRuleText({freq: "fourweekly", date: "2026-10-09", n: 3})).toBe("Your last 3 pays came 4 weeks apart.");
});

test("what setup fills in: pay and payday, regular payments and spending, from one list of payments", () => {
  const acme = {category: "income", counterparty: {name: "ACME LTD"}, description: "SALARY"};
  const raw = [
    t("2026-07-07", -90, shop("Tesco", "groceries")), t("2026-08-07", -80, shop("Tesco", "groceries")),
    t("2026-07-31", 2100, acme), t("2026-08-28", 2100, acme), t("2026-09-30", 2100, acme),
    t("2026-09-01", -55, dd("Thames Water")), t("2026-10-01", -55, dd("Thames Water")),
    t("2026-09-20", -10.99, shop("Netflix")),
  ];
  const f = findAll(raw, TODAY);
  expect(f.pays).toEqual([{amount: 2100, from: "ACME LTD", date: "2026-09-30", rule: {freq: "monthly-lastworking", date: "2026-10-30", n: 3}}]);
  expect(f.bills.map(b => b.name)).toEqual(["Thames Water"]);   // one Netflix payment isn't regular yet
  expect(f.spending.map(x => x.name)).toEqual(["Groceries"]);
});

test("everyone you've paid, to pick your own bills from: each as the bill it would be, paid more than once first, then the newest", () => {
  const raw = [
    t("2026-08-03", -9.99, shop("Netflix")), t("2026-09-03", -9.99, shop("Netflix")), t("2026-10-03", -10.99, shop("Netflix")),
    t("2026-09-20", -60, {category: "transfers", counterparty: {name: "Sam Lee"}}),
    t("2026-10-01", -12, shop("Odeon")),
    t("2026-09-30", 2100, {category: "income", counterparty: {name: "ACME LTD"}}),   // money in isn't a payment
    t("2026-09-15", -100, {category: "savings", description: "pot_0000Ab"}),          // nor is moving money to your own pot
  ];
  const got = findPayees(raw, TODAY);
  expect(got.map(x => x.name)).toEqual(["Netflix", "Odeon", "Sam Lee"]);
  // the latest price, on the rule its payments fit
  expect(got[0]).toMatchObject({payee: "Netflix", amount: 10.99, varies: true, freq: "monthly", day: 3, method: "card", n: 3, last: "2026-10-03"});
  // paid once: monthly on that day, for you to check
  expect(got[2]).toMatchObject({amount: 60, freq: "monthly", day: 20, method: "transfer", n: 1, last: "2026-09-20"});
  expect(findAll(raw, TODAY).payees).toEqual(got);
});

test("everyone who pays you like pay, the most first: setup can offer another", () => {
  const acme = {category: "income", counterparty: {name: "ACME LTD"}}, bar = {category: "income", counterparty: {name: "THE BAR CO"}};
  const raw = [
    t("2026-07-31", 2100, acme), t("2026-08-28", 2100, acme), t("2026-09-30", 2100, acme),
    t("2026-08-14", 300, bar), t("2026-09-11", 320, bar), t("2026-10-02", 310, bar),
  ];
  expect(findPays(raw, TODAY).map(p => [p.from, p.amount])).toEqual([["ACME LTD", 2100], ["THE BAR CO", 310]]);
  expect(findPay(raw, TODAY)?.from).toBe("ACME LTD");
  expect(findPays([], TODAY)).toEqual([]);
});

test("regular payments: direct debits at any amount, a subscription, and rent by standing order, biggest first", () => {
  const rent = {scheme: "payport_faster_payments", category: "transfers", counterparty: {name: "J Smith"}, description: "RENT"};
  const raw = [
    // the 1st; Sat 1 Aug moves to Mon 3rd, as bills do
    t("2026-07-01", -55, dd("Thames Water")), t("2026-08-03", -55, dd("Thames Water")), t("2026-09-01", -55, dd("Thames Water")), t("2026-10-01", -55, dd("Thames Water")),
    // the 15th, going up: the latest is the price now
    t("2026-07-15", -40, dd("OCTOPUS ENERGY")), t("2026-08-17", -43, dd("OCTOPUS ENERGY")), t("2026-09-15", -46, dd("OCTOPUS ENERGY")),
    t("2026-07-20", -10.99, shop("Netflix")), t("2026-08-20", -10.99, shop("Netflix")), t("2026-09-20", -10.99, shop("Netflix")),
    t("2026-07-28", -750, rent), t("2026-08-28", -750, rent), t("2026-09-28", -750, rent),
  ];
  expect(findBills(raw, TODAY)).toEqual([
    {name: "J Smith", payee: "J Smith", amount: 750, varies: false, freq: "monthly", day: 28, method: "transfer", n: 3},
    {name: "Thames Water", payee: "Thames Water", amount: 55, varies: false, freq: "monthly", day: 1, method: "dd", n: 4},
    {name: "Octopus Energy", payee: "OCTOPUS ENERGY", amount: 46, varies: true, freq: "monthly", day: 15, method: "dd", n: 3},
    {name: "Netflix", payee: "Netflix", amount: 10.99, varies: false, freq: "monthly", day: 20, method: "card", n: 3},
  ]);
});

test("a fortnightly direct debit goes out next on its own date", () => {
  const raw = ["2026-08-07", "2026-08-21", "2026-09-04", "2026-09-18", "2026-10-02"].map(d => t(d, -12.5, dd("PureGym")));
  expect(findBills(raw, TODAY)).toEqual([{name: "PureGym", payee: "PureGym", amount: 12.5, varies: false, freq: "fortnightly", date: "2026-10-16", method: "dd", n: 5}]);
});

test("not regular payments: a weekly shop, a one-off, a subscription you cancelled, and money to friends that varies", () => {
  const saturdays = ["2026-08-29", "2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26", "2026-10-03"];
  const raw = [
    ...saturdays.map(d => t(d, -60, shop("Tesco", "groceries"))),                          // the same amount every week: still everyday
    t("2026-09-02", -400, shop("Currys", "shopping")),
    t("2026-06-15", -11.99, shop("Spotify")), t("2026-07-15", -11.99, shop("Spotify")),    // nothing since July
    t("2026-08-05", -20, {category: "transfers", counterparty: {name: "Sam"}}), t("2026-09-05", -85, {category: "transfers", counterparty: {name: "Sam"}}),
  ];
  expect(findBills(raw, TODAY)).toEqual([]);
});

test("everyday spending: card payments by category a month, refunds off, a found subscription left out, small ones dropped", () => {
  // the payments cover 73 days (25 Jul to 5 Oct), so a month is 5/12 of the total
  const raw = [
    ...Array.from({length: 10}, (_, i) => t(addDaysTo("2026-07-25", i * 7), -60, shop("Tesco", "groceries"))),
    t("2026-09-10", 12, shop("Tesco", "groceries")),                                   // a refund
    t("2026-08-01", -6, shop("Pret", "eating_out")), t("2026-09-01", -6, shop("Pret", "eating_out")),   // a month apart, the same: still not a bill
    t("2026-08-20", -10.99, shop("Netflix")), t("2026-09-20", -10.99, shop("Netflix")),   // a regular payment, not spending
    t("2026-09-05", -30, shop("Cineworld")),                                            // one payment: not usual yet
    t("2026-08-02", -2, shop("Boots", "personal_care")), t("2026-08-09", -2, shop("Boots", "personal_care")), t("2026-08-16", -2, shop("Boots", "personal_care")),
    t("2026-09-01", -55, dd("Thames Water")), t("2026-10-01", -55, dd("Thames Water")),
    t("2026-09-12", -200, {category: "transfers", counterparty: {name: "Sam"}}),
  ];
  expect(findSpending(raw, TODAY, findBills(raw, TODAY))).toEqual([{name: "Groceries", monthly: 245, n: 10}, {name: "Eating out", monthly: 5, n: 2}]);
  expect(findSpending([], TODAY)).toEqual([]);
});

const addDaysTo = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
