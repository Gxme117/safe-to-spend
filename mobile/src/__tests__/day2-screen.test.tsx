import {fireEvent, render, screen} from "@testing-library/react-native";
import {router} from "expo-router";
import DayV2Screen from "@/app/(tabs)/day2";
import {baseState, TODAY, tx} from "@/lib/__tests__/fixtures";
import {addDays, dayName, niceDate} from "@/lib/dates";
import type {AppState, Tx} from "@/lib/types";
import {useMoney} from "@/store/useMoney";

jest.mock("expo-router", () => ({router: {push: jest.fn(), back: jest.fn()}}));
jest.mock("expo-sqlite/kv-store", () => ({__esModule: true, default: {getItemSync: () => null, setItemSync: () => {}, removeItemSync: () => true}}));
jest.mock("@/db/transactions", () => ({listSince: jest.fn(async () => []), insertTx: jest.fn(async () => {}), deleteTx: jest.fn(async () => {}), updateFiling: jest.fn(async () => {})}));
beforeEach(() => { jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 0); });
afterEach(() => jest.restoreAllMocks());

const groceries = tx({amount: 50, date: "2026-10-02", cat: "groceries"});
const show = (txs: Tx[], state: AppState = baseState()) => {
  useMoney.setState({state, txs, today: TODAY, loaded: true});
  return render(<DayV2Screen />);
};

test("today's number is on the page, says why, and opens where it comes from", async () => {
  await show([groceries]);
  expect(screen.getByText(dayName(TODAY))).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Safe to Spend Today, £16. Lasts you until payday, Fri 30 Oct"}));
  expect(router.push).toHaveBeenCalledWith("/today");
});

test("the runway shows each day's figure; tapping a day ahead shows that day, and Today comes back", async () => {
  await show([groceries]);
  const tomorrow = addDays(TODAY, 1);
  await fireEvent.press(screen.getByRole("tab", {name: new RegExp(`^${niceDate(tomorrow)}, £\\d+ safe to spend`)}));
  expect(screen.getByText(dayName(tomorrow))).toBeOnTheScreen();
  expect(screen.queryByText("Spent today")).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Today"}));
  expect(screen.getByText("Spent today")).toBeOnTheScreen();
});

test("a day gone shows what was spent", async () => {
  await show([groceries]);
  await fireEvent.press(screen.getByRole("tab", {name: `${niceDate("2026-10-02")}, spent £50`}));
  expect(screen.getByLabelText(/^Spent on Fri 2 Oct, £50\./)).toBeOnTheScreen();
});

test("a tap on a card's top brings the cards out with the runway at the back; a tap swaps them, and the runway tucks them away", async () => {
  await show([groceries]);
  const todayTab = {name: new RegExp(`^${niceDate(TODAY)}, today`)};
  await fireEvent.press(screen.getByRole("button", {name: "Show your bank card"}));
  expect(screen.getByText("Updated")).toBeOnTheScreen();
  // the other card is out too, behind it: a tap brings it to the front, and the runway stays at the back
  await fireEvent.press(screen.getByRole("button", {name: "Show your C card"}));
  expect(screen.getByText("Not connected yet")).toBeOnTheScreen();
  expect(screen.queryByText("Updated")).toBeNull();
  expect(screen.queryByRole("tab", todayTab)).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Show the days to payday"}));
  expect(screen.getByRole("tab", todayTab)).toBeOnTheScreen();
  expect(screen.queryByText("Not connected yet")).toBeNull();
});

test("the top of the bank card peeks out above the runway; a tap brings it out, the runway goes behind it, and a tap brings that back", async () => {
  await show([groceries]);
  const todayTab = {name: new RegExp(`^${niceDate(TODAY)}, today`)};
  // just the head: the rest of the card is tucked under the runway
  expect(screen.queryByText("Updated")).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Show your bank card"}));
  expect(screen.getByText("Updated")).toBeOnTheScreen();
  expect(screen.queryByRole("tab", todayTab)).toBeNull();
  // out in front, its eye hides the balance
  await fireEvent.press(screen.getByRole("button", {name: /^Monzo balance £.+ Tap to hide$/}));
  await fireEvent.press(screen.getByRole("button", {name: "Monzo balance hidden. Tap to show"}));
  expect(screen.getByRole("button", {name: /^Monzo balance £.+ Tap to hide$/})).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Show the days to payday"}));
  expect(screen.getByRole("tab", todayTab)).toBeOnTheScreen();
  expect(screen.queryByText("Updated")).toBeNull();
});

test("what if I spend: the engine's answer, in one line", async () => {
  await show([groceries]);
  await fireEvent.changeText(screen.getByLabelText("What if I spend"), "10");
  expect(screen.getByText(/£6/)).toBeOnTheScreen();
});

test("without enough, the number goes below £0 calmly", async () => {
  await show([groceries], baseState({bills: [{id: "car", name: "Car", amount: 1200, freq: "monthly", day: 20}]}));
  expect(screen.getByRole("button", {name: /^Safe to Spend Today, −£16\. You need £400 more/})).toBeOnTheScreen();
  expect(screen.queryByText(/short|move|\bover/i)).toBeNull();
});
