import {fireEvent, render, screen} from "@testing-library/react-native";
import {router} from "expo-router";
import DayScreen from "@/app/(tabs)/index";
import {baseState, TODAY, tx} from "@/lib/__tests__/fixtures";
import {longDate} from "@/lib/dates";
import type {AppState, Tx} from "@/lib/types";
import {useMoney} from "@/store/useMoney";

jest.mock("expo-router", () => ({router: {push: jest.fn(), back: jest.fn()}}));
jest.mock("expo-sqlite/kv-store", () => ({__esModule: true, default: {getItemSync: () => null, setItemSync: () => {}, removeItemSync: () => true}}));
jest.mock("@/db/transactions", () => ({listSince: jest.fn(async () => []), insertTx: jest.fn(async () => {}), deleteTx: jest.fn(async () => {}), updateFiling: jest.fn(async () => {})}));

const groceries = tx({amount: 50, date: "2026-10-02", cat: "groceries"});
const show = (txs: Tx[], state: AppState = baseState()) => {
  useMoney.setState({state, txs, today: TODAY, loaded: true});
  return render(<DayScreen />);
};

test("shows today's number and why, in one line", async () => {
  await show([groceries]);
  expect(screen.getByRole("header", {name: longDate(TODAY)})).toBeOnTheScreen();
  expect(screen.getByText("Safe to spend today")).toBeOnTheScreen();
  expect(screen.getByLabelText("£16")).toBeOnTheScreen();
  expect(screen.getByText("Lasts you until payday, Fri 30 Oct")).toBeOnTheScreen();
});

test("spending today changes the reason, not the tone", async () => {
  await show([groceries, tx({amount: 10, date: TODAY, cat: "eating", note: "Lunch"})]);
  expect(screen.getByText("£5.60 left today after £10 spent")).toBeOnTheScreen();
  expect(screen.getByText("Lunch")).toBeOnTheScreen();
});

test("asks whether pay arrived before counting it", async () => {
  await show([groceries]);
  expect(screen.getByText("Did your Pharmacy pay arrive?")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "It arrived"})).toBeOnTheScreen();
});

test("short: says how much is needed and what to do", async () => {
  await show([groceries], baseState({bills: [{id: "car", name: "Car", amount: 1200, freq: "monthly", day: 20}]}));
  expect(screen.getByText("You need £400 more")).toBeOnTheScreen();
  expect(screen.getByText("£400 short for bills and everyday")).toBeOnTheScreen();
});

test("the eye hides the total balance and shows it again", async () => {
  await show([groceries]);
  await fireEvent.press(screen.getByRole("button", {name: /^Total balance £.+ Tap to hide$/}));
  expect(screen.getByRole("button", {name: "Total balance hidden. Tap to show"})).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Total balance hidden. Tap to show"}));
  expect(screen.getByRole("button", {name: /Tap to hide$/})).toBeOnTheScreen();
});

test("the bank card offers to connect Monzo, then shows spending money and what's set aside", async () => {
  const first = await show([]);
  // tucked behind, the card is one button; its own controls wait until it's in front
  expect(screen.queryByRole("button", {name: "Connect Monzo"})).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Show your bank card"}));
  expect(await screen.findByRole("button", {name: "Connect Monzo"})).toBeOnTheScreen();
  const bank = {source: "Monzo", accountId: "acc", main: 500, asOf: new Date().toISOString(),
    pots: [{id: "p", name: "Holiday", balance: 300, role: "save" as const}]};
  await first.unmount();
  await show([], baseState({balance: 500, bank}));
  await fireEvent.press(screen.getByRole("button", {name: "Show your bank card"}));
  expect(await screen.findByRole("button", {name: "Sync with Monzo"})).toBeOnTheScreen();
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
