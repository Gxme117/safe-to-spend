import {findAll, findPay, payRule, payRuleText} from "@/lib/found";
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

test("what setup fills in: pay and payday, from one list of payments with bills and shopping in it", () => {
  const acme = {category: "income", counterparty: {name: "ACME LTD"}, description: "SALARY"};
  const raw = [
    t("2026-07-07", -90, shop("Tesco", "groceries")),
    t("2026-07-31", 2100, acme), t("2026-08-28", 2100, acme), t("2026-09-30", 2100, acme),
    t("2026-09-01", -55, dd("Thames Water")), t("2026-10-01", -55, dd("Thames Water")),
    t("2026-09-20", -10.99, shop("Netflix")),
  ];
  const f = findAll(raw, TODAY);
  expect(f.pay).toEqual({amount: 2100, from: "ACME LTD", date: "2026-09-30"});
  expect(f.rule?.freq).toBe("monthly-lastworking");
});
