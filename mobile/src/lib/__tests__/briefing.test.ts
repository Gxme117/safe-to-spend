import {briefingAsk, briefingDue, briefingFacts, KEEP_DAYS, logBrief, mentionedOf, NO_BRIEFS, statusOf, type BriefLog, type Fact} from "@/lib/briefing";
import {addDays} from "@/lib/dates";
import type {Regular, Scan} from "@/lib/regulars";
import type {Bank, Bill, Ctx} from "@/lib/types";
import {baseState, ctx, TODAY, tx} from "./fixtures";

// TODAY is Mon 5 Oct 2026; rent (£400, direct debit) goes on the 15th, the phone (£20, card) on the 1st; pay is on Fri 30 Oct.
const NOW = new Date(2026, 9, 5, 9, 0).getTime();
const facts = (c: Ctx, log: BriefLog = NO_BRIEFS, now = NOW, scan: Scan | null = null) => briefingFacts(c, {scan, answers: {}}, log, now);
const keys = (fs: Fact[]) => fs.map(f => f.key);
const on = (today: string, over: Partial<Ctx> = {}) => ctx({today, ...over});
const find = (fs: Fact[], key: string) => fs.find(f => f.key === key);

test("where you stand always comes first, from the overview tool: the figures the app shows", () => {
  const fs = facts(ctx());
  expect(fs[0]).toMatchObject({key: "today", stage: TODAY, level: "info", what: "where_you_stand"});
  expect(fs[0].data).toMatchObject({today_amount: {amount: expect.any(Number)}, until_payday: {payday: "2026-10-30 Fri"}});
  // nothing else going on: no bills this week, no payments, nothing to sort
  expect(keys(fs)).toEqual(["today"]);
});

test("no pay set up: where you stand says so, it isn't guessed", () => {
  const fs = facts(ctx({state: baseState({incomes: []})}));
  expect(fs[0].data).toMatchObject({today_amount: {none: expect.stringContaining("No pay is set up")}});
});

test("a bill due this week, tomorrow, then today: each a new stage; paid, it's gone", () => {
  expect(find(facts(on("2026-10-10")), "bill_due:rent:2026-10-15")).toMatchObject({stage: "this_week", level: "info",
    data: {name: "Rent", amount: 400, due: "2026-10-15 Thu", how: "direct debit", paid: false, held_back: "Already held back from today's amount."}});
  expect(find(facts(on("2026-10-14")), "bill_due:rent:2026-10-15")).toMatchObject({stage: "tomorrow", level: "news"});
  expect(find(facts(on("2026-10-15")), "bill_due:rent:2026-10-15")).toMatchObject({stage: "today"});
  const paid = on("2026-10-15", {txs: [tx({amount: 400, date: "2026-10-15", billId: "rent", forDate: "2026-10-15"})]});
  expect(find(facts(paid), "bill_due:rent:2026-10-15")).toBeUndefined();
});

test("a bill they send themselves: due tomorrow is an alert; a due date gone with nothing marked paid is one too", () => {
  const council: Bill = {id: "ct", name: "Council tax", amount: 120, freq: "monthly", day: 6, method: "transfer"};
  const fs = facts(ctx({state: baseState({bills: [council]})}));
  expect(find(fs, "bill_due:ct:2026-10-06")).toMatchObject({stage: "tomorrow", level: "alert", data: {you_pay_it: expect.any(String)}});
  const late = facts(on("2026-10-08", {state: baseState({bills: [council]})}));
  expect(find(late, "bill_overdue:ct:2026-10-06")).toMatchObject({stage: "overdue", level: "alert", data: {name: "Council tax", amount: 120, was_due: "2026-10-06 Tue"}});
});

test("not enough for bills and everyday: an alert, with where you stand saying how much more", () => {
  const fs = facts(ctx({state: baseState({balance: 300})}));
  expect(find(fs, "gap")).toMatchObject({level: "alert"});
  expect(fs[0].data).toMatchObject({until_payday: {still_needed_for_bills_and_everyday: expect.any(Number)}});
});

test("since the last briefing: pay that landed, money in nobody's sorted, a bill the bank paid, a payment much bigger than usual", () => {
  const log: BriefLog = {...NO_BRIEFS, lastAt: 5000};
  const txs = [
    tx({id: "pay", type: "income", amount: 1800, date: "2026-10-03", cat: "job", srcId: "job", forDate: "2026-09-30", created: 6000}),
    tx({id: "in", type: "income", amount: 25, date: "2026-10-04", cat: "monzo-in", note: "J SMITH", created: 6000}),
    tx({id: "ph", amount: 20, date: "2026-10-01", billId: "phone", forDate: "2026-10-01", created: 6000}),
    ...[8, 12, 9, 10].map((a, i) => tx({amount: a, date: "2026-09-2" + i, created: 4000})),
    tx({id: "tv", amount: 450, date: "2026-10-04", note: "Currys", created: 6000}),
    // made a month ago, only just sent by the bank: not news
    tx({id: "old", amount: 300, date: "2026-09-01", created: 6000}),
    // saved before the last briefing: already known
    tx({id: "seen", amount: 200, date: "2026-10-02", created: 4000}),
  ];
  const fs = facts(ctx({txs}), log);
  expect(find(fs, "pay_in:pay")).toMatchObject({level: "news", data: {name: "Pharmacy", amount: 1800, landed: "2026-10-03 Sat"}});
  expect(find(fs, "money_in:in")).toMatchObject({level: "news", data: {amount: 25, from: "J SMITH"}});
  expect(find(fs, "bill_paid:phone:2026-10-01")).toMatchObject({data: {name: "Phone", amount: 20}});
  expect(find(fs, "big:tv")).toMatchObject({level: "news", data: {amount: 450, who: "Currys"}});
  expect(keys(fs)).not.toContain("big:old");
  expect(keys(fs)).not.toContain("big:seen");
  // the money in is one to sort, too
  expect(find(fs, "unsorted")).toMatchObject({stage: "1", level: "action"});
});

test("yesterday against an average day, once there's a week of payments to go on", () => {
  expect(keys(facts(ctx({txs: [tx({amount: 5, date: "2026-10-04"})]})))).not.toContain("yesterday:2026-10-04");
  // £20 over the 14 days from the first payment to the day before yesterday
  const txs = [tx({amount: 10, date: "2026-09-20"}), tx({amount: 10, date: "2026-09-21"}), tx({amount: 68, date: "2026-10-04"})];
  expect(find(facts(ctx({txs})), "yesterday:2026-10-04")).toMatchObject({level: "info", data: {on: "2026-10-04 Sun", spent: 68, average_day: 1.43}});
});

test("money expected this week: there, and not counted until it lands", () => {
  const state = baseState({incomes: [...baseState().incomes, {id: "gift", name: "Gran", type: "family", freq: "oneoff", varies: false, amount: 50, date: "2026-10-08"}]});
  expect(find(facts(ctx({state})), "expected:gift:2026-10-08")).toMatchObject({level: "info", data: {amount: 50, note: "Not counted until it lands."}});
});

test("a regular payment the bank keeps making that isn't a bill: one to ask about, only with a bank", () => {
  const spotify: Regular = {name: "Spotify", payee: "Spotify", amount: 11.99, varies: false, freq: "monthly", day: 12, method: "card", n: 3,
    ref: "spotify", first: "2026-07-12", last: "2026-09-12", amounts: [11.99, 11.99, 11.99], sure: "likely"};
  const scan: Scan = {at: TODAY, from: "2026-07-07", found: [spotify]};
  const monzo: Bank = {source: "Monzo", accountId: "acc", main: 1000, asOf: "2026-10-05T09:00:00", pots: []};
  expect(find(facts(ctx({state: baseState({bank: monzo})}), NO_BRIEFS, NOW, scan), "regular:spotify"))
    .toMatchObject({level: "action", data: {paid_to: "Spotify", amount: 11.99, how_often: "every month", seen: expect.stringContaining("3 times")}});
  expect(keys(facts(ctx(), NO_BRIEFS, NOW, scan))).not.toContain("regular:spotify");
});

test("against what he's said: new, changed at a new stage, already said, or looked at and left out", () => {
  const f: Fact = {key: "bill_due:rent:2026-10-15", stage: "today", level: "news", what: "bill_due", data: {}};
  const said = (stage: string, told: boolean): BriefLog => ({...NO_BRIEFS, said: {[f.key]: {stage, at: "2026-10-14", told}}});
  expect(statusOf(f, NO_BRIEFS)).toBe("new");
  expect(statusOf(f, said("tomorrow", true))).toBe("changed");
  expect(statusOf(f, said("today", true))).toBe("already_said");
  expect(statusOf(f, said("today", false))).toBe("passed_over");
});

test("a daily briefing once a day, however many times the tab opens", () => {
  expect(briefingDue(NO_BRIEFS, TODAY)).toBe("daily");
  const after = logBrief(NO_BRIEFS, "daily", facts(ctx()), ["f1"], "Morning.", NOW, TODAY);
  expect(briefingDue(after, TODAY)).toBeNull();
  // days later, a new day's briefing
  expect(briefingDue(after, addDays(TODAY, 4))).toBe("daily");
});

test("what's kept: what he mentioned is said, the rest looked at; said before at the same stage stays said; old ones forgotten", () => {
  const fs: Fact[] = [
    {key: "a", stage: "1", level: "info", what: "x", data: {}},
    {key: "b", stage: "1", level: "info", what: "x", data: {}},
    {key: "c", stage: "2", level: "info", what: "x", data: {}},
  ];
  const before: BriefLog = {...NO_BRIEFS, said: {
    b: {stage: "1", at: "2026-10-04", told: true}, c: {stage: "1", at: "2026-10-04", told: true},
    gone: {stage: "x", at: addDays(TODAY, -KEEP_DAYS), told: true}, kept: {stage: "x", at: addDays(TODAY, -KEEP_DAYS + 1), told: true},
  }};
  const log = logBrief(before, "daily", fs, ["f1"], "Morning.", NOW, TODAY);
  expect(log.said).toEqual({
    a: {stage: "1", at: TODAY, told: true}, b: {stage: "1", at: TODAY, told: true}, c: {stage: "2", at: TODAY, told: false},
    kept: {stage: "x", at: addDays(TODAY, -KEEP_DAYS + 1), told: true},
  });
  expect(log).toMatchObject({lastDaily: TODAY, lastAt: NOW, last: {kind: "daily", at: NOW, text: "Morning."}});
});

test("what he's sent: the facts as JSON inside <app_brief>, each with an id and its status, and what he said last time", () => {
  const fs = facts(on("2026-10-14"));
  const log: BriefLog = {...NO_BRIEFS, last: {kind: "daily", at: NOW - 864e5, text: "Rent's tomorrow."},
    said: {"bill_due:rent:2026-10-15": {stage: "this_week", at: "2026-10-13", told: true}}};
  const ask = briefingAsk("daily", fs, log);
  expect(ask.startsWith('<app_brief kind="daily">\n')).toBe(true);
  const body = JSON.parse(ask.replace(/^<app_brief[^>]*>\n/, "").replace(/\n<\/app_brief>$/, ""));
  expect(body.last_briefing).toEqual({kind: "daily", on: "2026-10-04 Sun", said: "Rent's tomorrow."});
  expect(body.facts[0]).toMatchObject({id: "f1", what: "where_you_stand", status: "new"});
  expect(body.facts.find((x: {what: string}) => x.what === "bill_due")).toMatchObject({id: "f2", status: "changed", name: "Rent", amount: 400});
  // nothing said yet: no last briefing
  expect(JSON.parse(briefingAsk("daily", fs, NO_BRIEFS).split("\n")[1]).last_briefing).toBeUndefined();
});

test("his marks: which facts he mentioned (ids only), and when there's nothing worth saying", () => {
  expect(mentionedOf("Morning. Rent's tomorrow.\n<mentioned>f1 | f2 | f2 | rent</mentioned>")).toEqual({text: "Morning. Rent's tomorrow.", mentioned: ["f1", "f2"], nothing: false});
  expect(mentionedOf("<nothing/>")).toEqual({text: "", mentioned: [], nothing: true});
  expect(mentionedOf("Just this.")).toEqual({text: "Just this.", mentioned: [], nothing: false});
});
