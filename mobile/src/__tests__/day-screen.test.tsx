import {act, fireEvent, render, screen, waitFor} from "@testing-library/react-native";
import {router} from "expo-router";
import DayScreen from "@/app/(tabs)/day";
import {baseState, TODAY, tx} from "@/lib/__tests__/fixtures";
import {addDays, longDate, niceDate} from "@/lib/dates";
import type {AppState, Tx} from "@/lib/types";
import {useMoney} from "@/store/useMoney";

jest.mock("expo-router", () => ({router: {push: jest.fn(), back: jest.fn()}}));

// a day you've moved to has landed once today's own cards have gone
const landed = () => waitFor(() => expect(screen.queryByText("Spent today")).toBeNull());
jest.mock("expo-sqlite/kv-store", () => ({__esModule: true, default: {getItemSync: () => null, setItemSync: () => {}, removeItemSync: () => true}}));
jest.mock("@/db/transactions", () => ({listSince: jest.fn(async () => []), insertTx: jest.fn(async () => {}), deleteTx: jest.fn(async () => {}), updateFiling: jest.fn(async () => {})}));
// the count-up isn't under test (the amount is checked through its label, which is always the real figure), so hold its frames
beforeEach(() => { jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 0); });
afterEach(() => jest.restoreAllMocks());

const groceries = tx({amount: 50, date: "2026-10-02", cat: "groceries"});
const show = (txs: Tx[], state: AppState = baseState()) => {
  useMoney.setState({state, txs, today: TODAY, loaded: true});
  return render(<DayScreen />);
};

test("shows today's number, and screen readers hear why", async () => {
  await show([groceries]);
  expect(screen.getByRole("header", {name: longDate(TODAY)})).toBeOnTheScreen();
  expect(screen.getByText("Safe to Spend")).toBeOnTheScreen();
  expect(screen.getByLabelText("£16")).toBeOnTheScreen();
  expect(screen.getByLabelText("Safe to Spend, £16. Lasts you until payday, Fri 30 Oct")).toBeOnTheScreen();
  // and says why, in one line under the cards (hidden from screen readers there: the card already says it)
  expect(screen.getByText("Lasts you until payday, Fri 30 Oct", {includeHiddenElements: true})).toBeOnTheScreen();
});

test("tapping today's number opens where it comes from", async () => {
  await show([groceries]);
  await fireEvent.press(screen.getByRole("button", {name: /^Safe to Spend, £16\./}));
  expect(router.push).toHaveBeenCalledWith("/today");
});

test("spending today changes the reason, not the tone, and the big number is what's left of today", async () => {
  await show([groceries, tx({amount: 10, date: TODAY, cat: "eating", note: "Lunch"})]);
  expect(screen.getByLabelText("Safe to Spend, £6. £10 spent of today's £16")).toBeOnTheScreen();
  expect(screen.getByText("Lunch")).toBeOnTheScreen();
});

test("this week's line shows what you could spend to Sunday, only on the week with today in it", async () => {
  await show([groceries]);
  expect(screen.getByText(/^£\d+ to spend from now to Sunday$/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: `Next week, ${niceDate(addDays(TODAY, 7))}`}));
  await landed();
  expect(screen.queryByText(/to spend from now to Sunday/)).toBeNull();
});

test("asks whether pay arrived before counting it", async () => {
  await show([groceries]);
  expect(screen.getByText("Did your Pharmacy pay arrive?")).toBeOnTheScreen();
  expect(screen.queryByLabelText("Amount that arrived")).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Yes, £1,800 arrived"}));
  await waitFor(() => expect(screen.queryByText("Did your Pharmacy pay arrive?")).toBeNull());
});

test("a pay that didn't land as expected: say how much", async () => {
  await show([groceries]);
  await fireEvent.press(screen.getByRole("button", {name: "A different amount"}));
  expect(screen.getByLabelText("Amount that arrived")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "It arrived"})).toBeOnTheScreen();
});

test("without enough, the number stops at £0 and says what it's for, with no card asking you to find money", async () => {
  await show([groceries], baseState({bills: [{id: "car", name: "Car", amount: 1200, freq: "monthly", day: 20}]}));
  expect(screen.getByLabelText(/^Safe to Spend, £0\. You need £400 more to cover your bills and everyday$/)).toBeOnTheScreen();
  expect(screen.queryByText(/short|move/i)).toBeNull();
});

test("the eye on the bank card hides its balance and shows it again", async () => {
  await show([groceries]);
  expect(screen.queryByText(/Total balance/)).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Show your bank card"}));
  await fireEvent.press(screen.getByRole("button", {name: /^Monzo balance £.+ Tap to hide$/}));
  expect(screen.getByRole("button", {name: "Monzo balance hidden. Tap to show"})).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Monzo balance hidden. Tap to show"}));
  expect(screen.getByRole("button", {name: /Tap to hide$/})).toBeOnTheScreen();
});

test("the eye works on the bank card behind too, without pulling it out in front", async () => {
  await show([groceries]);
  // the days either side are drawn too, but take no touches, so only today's eye answers
  for (const eye of screen.getAllByRole("button", {name: /^Monzo balance £.+ Tap to hide$/, includeHiddenElements: true})) await fireEvent.press(eye);
  expect(screen.getAllByRole("button", {name: "Monzo balance hidden. Tap to show", includeHiddenElements: true}).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", {name: "Show your bank card"})).toBeOnTheScreen();
  // it's remembered, so show it again for the tests after
  for (const eye of screen.getAllByRole("button", {name: "Monzo balance hidden. Tap to show", includeHiddenElements: true})) await fireEvent.press(eye);
});

test("the sync button connects a bank when there's none, then syncs; the bank card shows spending money and what's set aside", async () => {
  const first = await show([]);
  expect(screen.queryByText("Connect")).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Connect a bank"}));
  expect(router.push).toHaveBeenCalledWith("/connect-bank");
  const bank = {source: "Monzo", accountId: "acc", main: 500, asOf: new Date().toISOString(),
    pots: [{id: "p", name: "Holiday", balance: 300, role: "save" as const}]};
  await first.unmount();
  await show([], baseState({balance: 500, bank}));
  expect(screen.getByRole("button", {name: "Sync your banks"})).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Show your bank card"}));
  expect(screen.getByText("Spending money")).toBeOnTheScreen();
  expect(screen.getByText("Set aside")).toBeOnTheScreen();
  expect(screen.getByText("£300")).toBeOnTheScreen();
});

test("spent today lists the newest payment first", async () => {
  await show([tx({amount: 4, date: TODAY, note: "Coffee", created: 1}), tx({amount: 9, date: TODAY, note: "Lunch", created: 2})]);
  const names = screen.getAllByText(/^(Coffee|Lunch)$/).map(n => n.props.children);
  expect(names).toEqual(["Lunch", "Coffee"]);
});

test("a Monzo payment sorts by when it happened, not when it synced", async () => {
  // the 3am one came in on a later sync, so it was saved last
  await show([tx({amount: 9, date: TODAY, note: "Lunch", created: 2, paidAt: 5000}), tx({amount: 4, date: TODAY, note: "Kebab", created: 9, paidAt: 1000})]);
  expect(screen.getAllByText(/^(Kebab|Lunch)$/).map(n => n.props.children)).toEqual(["Lunch", "Kebab"]);
});

test("tapping a payment opens it to choose what it was for", async () => {
  const lunch = tx({amount: 9, date: TODAY, note: "Lunch", cat: "eating"});
  await show([lunch]);
  await fireEvent.press(screen.getByText("Lunch"));
  expect(router.push).toHaveBeenCalledWith(`/payment/${lunch.id}`);
});

test("money in can be tapped too, to say what it was", async () => {
  const back = tx({type: "income", amount: 15, date: TODAY, note: "Sam", cat: "monzo-in"});
  await show([back]);
  await fireEvent.press(screen.getByText("Sam"));
  expect(router.push).toHaveBeenCalledWith(`/payment/${back.id}`);
});

test("the arrows go back and forward a week, a past day shows what was spent, and tapping today comes home", async () => {
  const sunday = addDays(TODAY, -1); // TODAY is a Monday, so the day before is in last week
  await show([groceries, tx({amount: 12.5, date: sunday, cat: "eating", note: "Lunch"})]);
  await fireEvent.press(screen.getByRole("button", {name: /^Previous week/}));
  expect(screen.getByRole("header", {name: longDate(addDays(TODAY, -7))})).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("tab", {name: niceDate(sunday)}));
  // the date changes straight away; the cards slide in after it
  expect(await screen.findByLabelText(`Spent on ${niceDate(sunday)}, £12.50. 1 payment`)).toBeOnTheScreen();
  expect(screen.getByText("Lunch")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: /^Next week/}));
  expect(screen.getByRole("header", {name: longDate(addDays(sunday, 7))})).toBeOnTheScreen();
  // coming from a past day: wait for the day's forecast to slide in
  expect((await screen.findAllByLabelText(/^Safe to Spend, £\d+\. If you spend each day's amount until then$/)).length).toBeGreaterThan(0);
  expect(screen.getByText("Coming up")).toBeOnTheScreen();
  expect(screen.queryByRole("button", {name: "Today"})).toBeNull();
  await fireEvent.press(screen.getByRole("tab", {name: `${niceDate(TODAY)}, today`}));
  expect(await screen.findByText("Safe to Spend")).toBeOnTheScreen();
});

test("a + at the top of today's payments adds one; with a bank connected, it's for cash", async () => {
  const first = await show([]);
  expect(screen.getByRole("button", {name: "Add payment"})).toBeOnTheScreen();
  await first.unmount();
  const bank = {source: "Monzo", accountId: "acc", main: 500, asOf: new Date().toISOString(), pots: []};
  await show([], baseState({balance: 500, bank}));
  expect(screen.queryByRole("button", {name: "Add payment"})).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Add cash payment"}));
  expect(router.push).toHaveBeenCalledWith("/add-payment");
});

test("the week under the date: tap a day to go to it", async () => {
  await show([groceries]);
  const tomorrow = addDays(TODAY, 1);
  expect(screen.getByRole("tab", {name: `${niceDate(TODAY)}, today`, selected: true})).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("tab", {name: niceDate(tomorrow)}));
  expect(screen.getByRole("header", {name: longDate(tomorrow)})).toBeOnTheScreen();
  expect(screen.getByRole("tab", {name: niceDate(tomorrow), selected: true})).toBeOnTheScreen();
});

test("two moves in a row land on the second, and its cards match the date", async () => {
  await show([groceries]);
  const twoWeeks = addDays(TODAY, 14);
  // the second press comes while the first slide is still running
  await fireEvent.press(screen.getByRole("button", {name: `Next week, ${niceDate(addDays(TODAY, 7))}`}));
  await fireEvent.press(screen.getByRole("button", {name: `Next week, ${niceDate(twoWeeks)}`}));
  expect(screen.getByRole("header", {name: longDate(twoWeeks)})).toBeOnTheScreen();
  await landed();
  expect(screen.getAllByLabelText(/^Safe to Spend, £\d+\. If you spend each day's amount until then$/).length).toBeGreaterThan(0);
  // and back the way it came, to today
  await fireEvent.press(screen.getByRole("button", {name: `Previous week, ${niceDate(addDays(TODAY, 7))}`}));
  await fireEvent.press(screen.getByRole("button", {name: `Previous week, ${niceDate(TODAY)}`}));
  expect(await screen.findByText("Spent today")).toBeOnTheScreen();
  expect(screen.getByRole("header", {name: longDate(TODAY)})).toBeOnTheScreen();
});

test("a day with a bill going out has a dot in the week", async () => {
  await show([groceries], baseState({bills: [{id: "phone", name: "Phone", amount: 20, freq: "monthly", day: 8}]}));
  expect(screen.getByRole("tab", {name: `${niceDate("2026-10-08")}, bills due`})).toBeOnTheScreen();
  expect(screen.getByRole("tab", {name: niceDate("2026-10-07")})).toBeOnTheScreen();
});

test("a day still to come shows money you're expecting, and Money in on its card adds some", async () => {
  const nandos = {id: "nan", name: "Nando's", type: "other" as const, freq: "oneoff" as const, varies: false, amount: 40, date: addDays(TODAY, 1), since: TODAY};
  await show([groceries], baseState({incomes: [...baseState().incomes, nandos]}));
  // today's number doesn't count it yet
  expect(screen.getByLabelText("£16")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("tab", {name: `${niceDate(addDays(TODAY, 1))}, money coming in`}));
  // today lists it too (under Coming up): wait until the day after has slid in. Its Safe to Spend counts it: £424 over 24 days
  await landed();
  expect(screen.getAllByLabelText(/^Safe to Spend, £17\./).length).toBeGreaterThan(0);
  expect(screen.getByText("Nando's")).toBeOnTheScreen();
  expect(screen.getByText("+£40")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Nando's"));
  expect(router.push).toHaveBeenCalledWith("/expect?id=nan");
  await fireEvent.press(screen.getByRole("button", {name: "Money in"}));
  expect(router.push).toHaveBeenCalledWith(`/expect?date=${addDays(TODAY, 1)}`);
});

test("Money in sits on today's card", async () => {
  await show([groceries]);
  await fireEvent.press(screen.getByRole("button", {name: "Money in"}));
  expect(router.push).toHaveBeenCalledWith(`/expect?date=${TODAY}`);
});

test("money expected today shows on today, and its day has a dot in the week", async () => {
  const nandos = {id: "nan", name: "Nando's", type: "other" as const, freq: "oneoff" as const, varies: false, amount: 40, date: TODAY, time: "18:00", since: TODAY};
  await show([groceries], baseState({incomes: [...baseState().incomes, nandos]}));
  expect(screen.getByText("Coming up")).toBeOnTheScreen();
  expect(screen.getByText("Today. Expected around 6pm")).toBeOnTheScreen();
  expect(screen.getByRole("tab", {name: `${niceDate(TODAY)}, today, money coming in`})).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Nando's"));
  expect(router.push).toHaveBeenCalledWith("/expect?id=nan");
});

test("money expected on a later day shows under today's spending, soonest first", async () => {
  const at = (id: string, name: string, date: string) => ({id, name, type: "other" as const, freq: "oneoff" as const, varies: false, amount: 40, date, since: TODAY});
  await show([groceries], baseState({incomes: [...baseState().incomes, at("b", "Gran", addDays(TODAY, 4)), at("a", "Nando's", addDays(TODAY, 1))]}));
  expect(screen.getByText("Coming up")).toBeOnTheScreen();
  const rows = screen.getAllByText(/Expected$/).map(x => x.props.children);
  expect(rows).toEqual(["Tomorrow. Expected", `${niceDate(addDays(TODAY, 4))}. Expected`]);
  await fireEvent.press(screen.getByText("Gran"));
  expect(router.push).toHaveBeenCalledWith("/expect?id=b");
});

test("with nothing else expected, today's Coming up shows your next payday", async () => {
  await show([groceries]);
  expect(screen.getByText("Coming up")).toBeOnTheScreen();
  expect(screen.getByText(`${niceDate("2026-10-30")}. Payday`)).toBeOnTheScreen();
});

test("a bill going out today is on today, not only a dot in the week", async () => {
  await show([groceries], baseState({bills: [...baseState().bills, {id: "gym", name: "Gym", amount: 30, freq: "monthly", day: 5}]}));
  expect(screen.getByRole("tab", {name: `${niceDate(TODAY)}, today, bills due`})).toBeOnTheScreen();
  expect(screen.getByText("Coming up")).toBeOnTheScreen();
  expect(screen.getByText("Gym")).toBeOnTheScreen();
});

test("bills going out before payday are in today's Coming up, with their day", async () => {
  await show([groceries]);
  expect(screen.getByText("Rent")).toBeOnTheScreen();
  expect(screen.getByText(/^Thu 15 Oct\. From /)).toBeOnTheScreen();
});

test("an everyday amount gone past says how much extra, never over", async () => {
  await show([tx({amount: 230, date: "2026-10-02", cat: "groceries"})]);
  expect(screen.getAllByText("£30 extra").length).toBeGreaterThan(0);
  expect(screen.queryByText(/\bover\b/)).toBeNull();
});

test("hiding the balance hides it on every day, including the ones already drawn either side", async () => {
  await show([groceries]);
  await fireEvent.press(screen.getByRole("button", {name: "Show your bank card"}));
  await fireEvent.press(screen.getByRole("button", {name: /^Monzo balance £.+ Tap to hide$/}));
  await fireEvent.press(screen.getByRole("tab", {name: niceDate(addDays(TODAY, 1))}));
  // landing on a day shows its own card in front
  await landed();
  await fireEvent.press(screen.getByRole("button", {name: "Show your bank card"}));
  expect(screen.getByRole("button", {name: "Monzo balance hidden. Tap to show"})).toBeOnTheScreen();
  // and back on today, where the bank card was brought forward before you left
  await fireEvent.press(screen.getByRole("tab", {name: `${niceDate(TODAY)}, today`}));
  expect(await screen.findByLabelText(/^Safe to Spend, £16\./)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Show your bank card"}));
  await fireEvent.press(screen.getByRole("button", {name: "Monzo balance hidden. Tap to show"}));
  expect(screen.getByRole("button", {name: /Tap to hide$/})).toBeOnTheScreen();
});

test("a new day starts back on today, wherever you were", async () => {
  await show([groceries]);
  await fireEvent.press(screen.getByRole("tab", {name: niceDate(addDays(TODAY, 3))}));
  expect(screen.getByRole("header", {name: longDate(addDays(TODAY, 3))})).toBeOnTheScreen();
  const next = addDays(TODAY, 1);
  await act(async () => { useMoney.setState({today: next}); });
  expect(screen.getByRole("header", {name: longDate(next)})).toBeOnTheScreen();
  expect(screen.getByText("Spent today")).toBeOnTheScreen();
});

test("tapping your next payday opens your pay to change its amount or where it's from", async () => {
  await show([groceries]);
  await fireEvent.press(screen.getByText(`${niceDate("2026-10-30")}. Payday`));
  expect(router.push).toHaveBeenCalledWith(`/income/${baseState().incomes[0].id}`);
});

test("a thin bar under today's card shows bills, everyday, savings and free", async () => {
  await show([groceries]);
  expect(screen.getByLabelText(/^Bills £\S+, Everyday £\S+, Savings £0, Free £\S+$/)).toBeOnTheScreen();
});
