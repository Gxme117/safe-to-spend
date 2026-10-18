import {fireEvent, render, screen, waitFor} from "@testing-library/react-native";
import {router} from "expo-router";
import {StyleSheet} from "react-native";
import HomeScreen from "@/app/(tabs)/index";
import {baseState, TODAY, tx} from "@/lib/__tests__/fixtures";
import type {AppState, Tx} from "@/lib/types";
import {useMoney} from "@/store/useMoney";

jest.mock("expo-router", () => ({router: {push: jest.fn(), back: jest.fn()}}));
jest.mock("expo-sqlite/kv-store", () => ({__esModule: true, default: {getItemSync: () => null, setItemSync: () => {}, removeItemSync: () => true}}));
jest.mock("@/db/transactions", () => ({listSince: jest.fn(async () => []), insertTx: jest.fn(async () => {}), deleteTx: jest.fn(async () => {}), updateFiling: jest.fn(async () => {})}));
beforeEach(() => { jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 0); });
afterEach(() => jest.restoreAllMocks());

// TODAY is Mon 5 Oct; pay landed Wed 30 Sep and next lands Fri 30 Oct
const groceries = tx({amount: 50, date: "2026-10-02", cat: "groceries"});
const show = (txs: Tx[], state: AppState = baseState()) => {
  useMoney.setState({state, txs, today: TODAY, loaded: true});
  return render(<HomeScreen />);
};

test("today's number is the page: what's left, out of today's amount, the day, and why; a tap opens where it comes from", async () => {
  await show([groceries]);
  expect(screen.getByText("Safe to spend")).toBeOnTheScreen();
  expect(screen.getByText("out of £16")).toBeOnTheScreen();
  expect(screen.getByText("Mon")).toBeOnTheScreen();
  // why it's this number, in one plain line under it
  expect(screen.getByText("Lasts you until payday, Fri 30 Oct")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Safe to spend today, £16, out of £16. Lasts you until payday, Fri 30 Oct"}));
  expect(router.push).toHaveBeenCalledWith("/today");
});

test("spending today comes off the number, and the line says so", async () => {
  await show([groceries, tx({amount: 3.2, date: TODAY, cat: "eating"})]);
  expect(screen.getByRole("button", {name: "Safe to spend today, £12.80, out of £16. £3.20 spent of today's £16"})).toBeOnTheScreen();
});

test("without enough for bills and everyday it's £0, and under the pay cycle it says how much more covers them", async () => {
  await show([groceries], baseState({bills: [{id: "car", name: "Car", amount: 1200, freq: "monthly", day: 20}]}));
  expect(screen.getByText("Need £400 more for bills and everyday")).toBeOnTheScreen();
  expect(screen.queryByText(/out of|spare until payday/)).toBeNull();
  expect(screen.getByRole("button", {name: "Safe to spend today, £0. You need £400 more to cover your bills and everyday"})).toBeOnTheScreen();
});

test("the pay cycle is drawn a circle a day and read out in one sentence", async () => {
  await show([groceries]);
  expect(screen.getByText("30 Sep – 30 Oct")).toBeOnTheScreen();
  expect(screen.getByText("25 days to payday")).toBeOnTheScreen();
  expect(screen.getByLabelText("Pay cycle, 30 Sep – 30 Oct, day 6 of 30. Bills due Thu 15 Oct. Payday Fri 30 Oct.")).toBeOnTheScreen();
  expect(screen.getByText(/^£\d[\d,]* spare until payday$/)).toBeOnTheScreen();
});

test("tapping a day on the pay cycle moves the highlight there, and stays on the page", async () => {
  jest.mocked(router.push).mockClear();
  await show([groceries]);
  expect(screen.getByRole("button", {name: "Mon 5 Oct, today", selected: true})).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Thu 15 Oct, bill due"}));
  expect(screen.getByRole("button", {name: "Thu 15 Oct, bill due", selected: true})).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Mon 5 Oct, today", selected: false})).toBeOnTheScreen();
  expect(router.push).not.toHaveBeenCalled();
});

test("a day gone, tapped, says what was spent that day in the number's place; today brings the number back", async () => {
  await show([groceries, tx({amount: 4.5, date: "2026-10-02", cat: "eating"})]);
  // days gone show no date, until one is picked: then it says which day you're on
  expect(screen.queryByText("2")).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Fri 2 Oct"}));
  expect(screen.getByText("2")).toBeOnTheScreen();
  expect(screen.getByLabelText("Spent on Fri 2 Oct, £54.50. 2 payments")).toBeOnTheScreen();
  expect(screen.queryByText("Safe to spend")).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Thu 1 Oct"}));
  expect(screen.getByLabelText("Spent on Thu 1 Oct, £0. Nothing spent. A no-spend day")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Mon 5 Oct, today"}));
  expect(screen.getByText("Safe to spend")).toBeOnTheScreen();
});

test("the bank cards hang down from the top, balances to the penny, and the eye hides the balance there too", async () => {
  await show([groceries]);
  expect(screen.getByRole("button", {name: "C card balance £0.00. Tap to hide"})).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: /^Monzo balance £[\d,]+\.\d\d\. Tap to hide$/}));
  expect(screen.getByRole("button", {name: "Monzo balance hidden. Tap to show"})).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Monzo balance hidden. Tap to show"}));
});

test("tapping a hanging card brings every account out; the balance inside still only hides balances", async () => {
  await show([groceries]);
  const monzo = () => screen.getByRole("button", {name: /^Monzo balance/});
  // a tap anywhere on the card but its balance
  await fireEvent.press(monzo().parent!.parent!);
  expect(screen.getByText("3 accounts")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: /^Monzo balance £[\d,]+\.\d\d\. Tap to hide$/})).toBeOnTheScreen();
});

test("out, tapping a card swaps it with the top one, and tapping the top one swaps it with the one under it", async () => {
  await show([groceries]);
  const monzo = () => screen.getByRole("button", {name: /^Monzo balance/});
  // which card is in front: the zIndex of the card around its balance
  const zOf = (el: ReturnType<typeof monzo>) => {
    for (let n = el.parent; n; n = n.parent) { const z = StyleSheet.flatten(n.props.style)?.zIndex; if (z !== undefined) return z; }
  };
  await fireEvent.press(screen.getByRole("button", {name: "Show all your accounts"}));
  expect(zOf(monzo())).toBe(0);
  await fireEvent.press(monzo().parent!.parent!);
  // the top card's in front of the other two
  expect(zOf(monzo())).toBe(2);
  // still out: a swap doesn't tuck them away
  expect(screen.getByText("3 accounts")).toBeOnTheScreen();
  // tap the top one and it swaps with the one under it
  await fireEvent.press(monzo().parent!.parent!);
  expect(zOf(monzo())).toBe(1);
});

test("without an income there's no number or pay cycle yet, just the way to add one", async () => {
  await show([], baseState({incomes: []}));
  expect(screen.getByText("Start with your income")).toBeOnTheScreen();
  expect(screen.queryByText("Safe to spend")).toBeNull();
  expect(screen.queryByLabelText(/^Pay cycle/)).toBeNull();
});

test("the handle (or a tap on a card) brings every account out with the total, and tucks them back", async () => {
  await show([groceries]);
  expect(screen.queryByText("3 accounts")).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Show all your accounts"}));
  expect(screen.getByText("3 accounts")).toBeOnTheScreen();
  expect(screen.getByText(/^£[\d,]+\.\d\d in total$/)).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Add an account"})).toBeOnTheScreen();
  expect(screen.getByText(/^Updated .+ · Drag up to close$/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Tuck your accounts away"}));
  expect(screen.getByRole("button", {name: "Show all your accounts"})).toBeOnTheScreen();
});

test("pulling the page down brings the same accounts out, and the page is held still once it's sprung back to its top", async () => {
  await show([groceries]);
  const page = () => screen.root!; // the page is the scroll view
  await fireEvent(page(), "scrollEndDrag", {nativeEvent: {contentOffset: {y: -100}}});
  expect(screen.getByText("3 accounts")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Tuck your accounts away"})).toBeOnTheScreen();
  // still springing back: it can scroll till it's home
  expect(page().props.scrollEnabled).toBe(true);
  await fireEvent.scroll(page(), {nativeEvent: {contentOffset: {y: 0}}});
  expect(page().props.scrollEnabled).toBe(false);
});

test("under what's spare, \"What if I spend £…\" says what an amount would do to today and the days after; ? opens where the number comes from", async () => {
  jest.mocked(router.push).mockClear();
  await show([groceries]);
  expect(screen.getByText("What if I spend £")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("What if I spend"), "5");
  expect(screen.getByText("Today's £16 covers it. £11 left today")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("What if I spend"), "100");
  expect(screen.getByText(/^Then it's £\d+ a day from tomorrow, instead of £\d+$/)).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("What if I spend"), "");
  expect(screen.queryByText(/covers it|a day from tomorrow/)).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Where today's number comes from"}));
  expect(router.push).toHaveBeenCalledWith("/today");
});

test("Spent today lists today's payments with what they were for and when, a way to add one, and what's coming up in the next two days", async () => {
  jest.mocked(router.push).mockClear();
  const at = new Date(2026, 9, 5, 8, 40).getTime();
  await show([groceries, tx({amount: 3.2, date: TODAY, cat: "eating", note: "Pret", paidAt: at})],
    baseState({bills: [{id: "phone", name: "Phone bill", amount: 18, freq: "monthly", day: 6}, {id: "car", name: "Car", amount: 200, freq: "monthly", day: 20}]}));
  expect(screen.getByText("Spent today")).toBeOnTheScreen();
  expect(screen.getByText("Pret")).toBeOnTheScreen();
  expect(screen.getByText(/ · 8:40 am$/)).toBeOnTheScreen();
  expect(screen.getByText("−£3.20")).toBeOnTheScreen();
  // only the next two days: the phone bill tomorrow, not the car on the 20th
  expect(screen.getByText("Coming up · Next 2 days")).toBeOnTheScreen();
  expect(screen.getByLabelText("Phone bill, Tomorrow, £18.00")).toBeOnTheScreen();
  expect(screen.queryByText("Car")).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: /^Pret, /}));
  expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/payment\//));
  await fireEvent.press(screen.getByRole("button", {name: "Add payment"}));
  expect(router.push).toHaveBeenCalledWith("/add-payment");
  expect(screen.getByRole("button", {name: "Delete Pret, £3.20"})).toBeOnTheScreen();
});

test("a day to come, tapped, shows what you could spend that day and its date, not today's", async () => {
  await show([groceries]);
  await fireEvent.press(screen.getByRole("button", {name: "Thu 15 Oct, bill due"}));
  expect(screen.getByLabelText(/^Safe to spend on Thu 15 Oct, £\d[\d,.]*\. If you spend each day's amount until then$/)).toBeOnTheScreen();
  expect(screen.getByText("15 Oct")).toBeOnTheScreen();
  expect(screen.queryByText("Mon")).toBeNull();
});

test("a day gone, picked on the pay cycle, turns Spent today into that day's receipt", async () => {
  jest.mocked(router.push).mockClear();
  await show([groceries, tx({amount: 4.5, date: "2026-10-02", cat: "eating", note: "Coffee"}), tx({amount: 3.2, date: TODAY, note: "Pret"})]);
  expect(screen.getByText("Pret")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Fri 2 Oct"}));
  expect(screen.getByText("Spent on 2 Oct")).toBeOnTheScreen();
  expect(screen.getByText("Coffee")).toBeOnTheScreen();
  expect(screen.queryByText("Pret")).toBeNull();
  expect(screen.queryByText(/^Coming up/)).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Add payment"}));
  expect(router.push).toHaveBeenCalledWith("/add-payment?date=2026-10-02");
  await fireEvent.press(screen.getByRole("button", {name: "Thu 1 Oct"}));
  expect(screen.getByText("Nothing spent that day")).toBeOnTheScreen();
});

test("tucked up only two cards hang; the third waits above the screen and tops the fan when they're out", async () => {
  await show([groceries]);
  expect(screen.getByRole("button", {name: /^Monzo balance/})).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "C card balance £0.00. Tap to hide"})).toBeOnTheScreen();
  expect(screen.queryByRole("button", {name: /^W card balance/})).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Show all your accounts"}));
  expect(screen.getByRole("button", {name: "W card balance £0.00. Tap to hide"})).toBeOnTheScreen();
});

test("when pay is due, Today asks whether it arrived, above the number, before counting it", async () => {
  await show([groceries]);
  expect(screen.getByText("Did your Pharmacy pay arrive?")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Yes, £1,800 arrived"}));
  await waitFor(() => expect(screen.queryByText("Did your Pharmacy pay arrive?")).toBeNull());
});

test("at £0 because today's amount is spent, the line under the number says so calmly, and when it comes back", async () => {
  await show([groceries, tx({amount: 16, date: TODAY, cat: "eating"})]);
  expect(screen.getByText("You've used today's £16.")).toBeOnTheScreen();
  expect(screen.getByText(/^Tomorrow starts fresh at £\d+\.$/)).toBeOnTheScreen();
});

test("not at £0, it's the usual one-line reason", async () => {
  await show([groceries, tx({amount: 5, date: TODAY, cat: "eating"})]);
  expect(screen.queryByText(/You've used today's/)).toBeNull();
  expect(screen.getByText("£5 spent of today's £16")).toBeOnTheScreen();
});
