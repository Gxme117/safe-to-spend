import {render, screen} from "@testing-library/react-native";
import DayScreen from "@/app/(tabs)/index";
import {baseState, TODAY, tx} from "@/lib/__tests__/fixtures";
import type {AppState, Tx} from "@/lib/types";
import {useMoney} from "@/store/useMoney";

jest.mock("expo-router", () => ({router: {push: jest.fn(), back: jest.fn()}}));
jest.mock("expo-sqlite/kv-store", () => ({__esModule: true, default: {getItemSync: () => null, setItemSync: () => {}, removeItemSync: () => true}}));
jest.mock("@/db/transactions", () => ({listSince: jest.fn(async () => []), insertTx: jest.fn(async () => {}), deleteTx: jest.fn(async () => {})}));

const groceries = tx({amount: 50, date: "2026-10-02", cat: "groceries"});
const show = (txs: Tx[], state: AppState = baseState()) => {
  useMoney.setState({state, txs, today: TODAY, loaded: true});
  return render(<DayScreen />);
};

test("shows today's number and why, in one line", async () => {
  await show([groceries]);
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
