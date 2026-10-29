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
// the 30 Sep pay was never confirmed: the check card asks about it, and the number treats it as late
const unconfirmedPay = () => baseState({incomes: [{...baseState().incomes[0], since: "2026-09-01"}]});

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

test("without enough, but with money in savings, it says to move it from savings", async () => {
  const bank = {source: "Monzo", accountId: "acc", main: 0, asOf: "2026-10-05T08:00:00Z", pots: [{id: "hol", name: "Holiday", balance: 150, role: "save" as const}]};
  await show([groceries], baseState({bills: [{id: "car", name: "Car", amount: 1200, freq: "monthly", day: 20}], bank}));
  expect(screen.getByRole("button", {name: "Safe to spend today, £0. Move £150 from savings, then you need £250 more"})).toBeOnTheScreen();
  expect(screen.getByText("£150 from savings, then £250 more")).toBeOnTheScreen();
});

test("the month is drawn a circle a day and read out in one sentence", async () => {
  await show([groceries]);
  expect(screen.getByText("October")).toBeOnTheScreen();
  // shown, but a screen reader has it in the month's sentence
  expect(screen.getByText("25 days to payday", {includeHiddenElements: true})).toBeOnTheScreen();
  expect(screen.getByLabelText("October. 25 days to payday. Bills due Thu 15 Oct. Payday Fri 30 Oct.")).toBeOnTheScreen();
  expect(screen.getByText(/^£\d[\d,]* spare until payday$/)).toBeOnTheScreen();
});

test("< and > step the month: another month lands on its 1st, this month back on today", async () => {
  await show([groceries]);
  await fireEvent.press(screen.getByRole("button", {name: "Show November"}));
  expect(screen.getByText("November")).toBeOnTheScreen();
  expect(screen.queryByText("25 days to payday", {includeHiddenElements: true})).toBeNull();
  expect(screen.getByRole("button", {name: "Sun 1 Nov", selected: true})).toBeOnTheScreen();
  expect(screen.getByLabelText(/^Safe to spend on Sun 1 Nov, £\d[\d,.]*\./)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Show October"}));
  await fireEvent.press(screen.getByRole("button", {name: "Show September"}));
  expect(screen.getByRole("button", {name: "Tue 1 Sep", selected: true})).toBeOnTheScreen();
  expect(screen.getByLabelText(/^Spent on Tue 1 Sep, £/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Show October"}));
  expect(screen.getByRole("button", {name: "Mon 5 Oct, today", selected: true})).toBeOnTheScreen();
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
  // days gone show their date too
  expect(screen.getByText("2")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Fri 2 Oct"}));
  expect(screen.getByLabelText("Spent on Fri 2 Oct, £54.50. 2 payments")).toBeOnTheScreen();
  expect(screen.queryByText("Safe to spend")).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Thu 1 Oct"}));
  expect(screen.getByLabelText("Spent on Thu 1 Oct, £0. Nothing spent. A no-spend day")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Mon 5 Oct, today"}));
  expect(screen.getByText("Safe to spend")).toBeOnTheScreen();
});

test("tucked up, the bank cards are out of sight above the screen; out, balances to the penny, and the eye hides them", async () => {
  await show([groceries]);
  expect(screen.queryByRole("button", {name: /balance/})).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Show all your accounts"}));
  expect(screen.getByRole("button", {name: "C card balance £0.00. Tap to hide"})).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: /^Monzo balance £[\d,]+\.\d\d\. Tap to hide$/}));
  expect(screen.getByRole("button", {name: "Monzo balance hidden. Tap to show"})).toBeOnTheScreen();
  // still out: the balance only hides balances
  expect(screen.getByText("3 accounts")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Monzo balance hidden. Tap to show"}));
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
  expect(screen.queryByLabelText(/^October/)).toBeNull();
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

test("when pay is due, Today asks whether it arrived, above the number, before counting it", async () => {
  await show([groceries], unconfirmedPay());
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

test("this pay's savings show above the number until they're moved; moving them keeps the number the same", async () => {
  await show([groceries], baseState({saving: 100}));
  expect(screen.getByText("£100 to put away this pay")).toBeOnTheScreen();
  // £400 free less £100 to put away: £12 a day
  expect(screen.getByText("out of £12")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "I've moved it"}));
  await waitFor(() => expect(screen.queryByText("£100 to put away this pay")).toBeNull());
  expect(useMoney.getState().txs.at(-1)).toMatchObject({type: "save", amount: 100, cat: "savings", date: TODAY});
  expect(screen.getByText("out of £12")).toBeOnTheScreen();
});

test("above the month, a bar says what's bills, everyday, savings and free", async () => {
  await show([groceries], baseState({saving: 100}));
  expect(screen.getByRole("image", {name: "Bills £400, Everyday £150, Savings £100, Free £300"})).toBeOnTheScreen();
  // a day to come shows where it would be by then
  await fireEvent.press(screen.getByRole("button", {name: "Fri 30 Oct, payday"}));
  expect(screen.getByRole("image", {name: "Bills £420, Everyday £200, Savings £100, Free £1,080"})).toBeOnTheScreen();
});

test("a day gone, picked, shows what was left of its pay cycle at the end of it", async () => {
  await show([groceries, tx({amount: 20, date: "2026-10-04"})], baseState({saving: 100}));
  expect(screen.getByRole("image", {name: "Bills £400, Everyday £150, Savings £100, Free £280"})).toBeOnTheScreen();
  // on the 2nd the £20 hadn't gone yet
  await fireEvent.press(screen.getByRole("button", {name: "Fri 2 Oct"}));
  expect(screen.getByRole("image", {name: "Bills £400, Everyday £150, Savings £100, Free £300"})).toBeOnTheScreen();
});

test("each part of the bar has its name and whole-pound figure under it; a part at £0 isn't drawn", async () => {
  await show([groceries, tx({amount: 3.2, date: TODAY, cat: "eating"})]);
  expect(screen.getByText("Everyday")).toBeOnTheScreen();
  expect(screen.getByText("£150")).toBeOnTheScreen();
  // £396.80 free, shown to the pound; the screen reader still hears the pence
  expect(screen.getByText("£397")).toBeOnTheScreen();
  expect(screen.getByRole("image", {name: "Bills £400, Everyday £150, Savings £0, Free £396.80"})).toBeOnTheScreen();
  expect(screen.queryByText("Savings")).toBeNull();
});

test("\"Not this time\" lets this pay's savings off", async () => {
  await show([groceries], baseState({saving: 100}));
  await fireEvent.press(screen.getByRole("button", {name: "Not this time"}));
  await waitFor(() => expect(screen.queryByText("£100 to put away this pay")).toBeNull());
  expect(screen.getByText("out of £16")).toBeOnTheScreen();
});
