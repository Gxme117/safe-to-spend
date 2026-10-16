import {fireEvent, render, screen} from "@testing-library/react-native";
import TodayScreen from "@/app/today";
import {baseState, TODAY, tx} from "@/lib/__tests__/fixtures";
import type {AppState, Tx} from "@/lib/types";
import {useMoney} from "@/store/useMoney";

jest.mock("expo-router", () => ({router: {push: jest.fn(), back: jest.fn()}}));
jest.mock("expo-sqlite/kv-store", () => ({__esModule: true, default: {getItemSync: () => null, setItemSync: () => {}, removeItemSync: () => true}}));
jest.mock("@/db/transactions", () => ({listSince: jest.fn(async () => []), insertTx: jest.fn(async () => {}), deleteTx: jest.fn(async () => {}), updateFiling: jest.fn(async () => {})}));

const groceries = tx({amount: 50, date: "2026-10-02", cat: "groceries"});
const show = (txs: Tx[], state: AppState = baseState()) => {
  useMoney.setState({state, txs, today: TODAY, loaded: true});
  return render(<TodayScreen />);
};

test("shows where today's number comes from, ending on today's amount", async () => {
  await show([groceries]);
  expect(screen.getByText("Spending money")).toBeOnTheScreen();
  expect(screen.getByText("Bills before payday")).toBeOnTheScreen();
  expect(screen.getByText("Free until payday")).toBeOnTheScreen();
  expect(screen.getByText("Today's amount")).toBeOnTheScreen();
  expect(screen.getByText("£16")).toBeOnTheScreen();
});

test("type a spend and it says what it does, in one sentence", async () => {
  await show([groceries]);
  expect(screen.getByText(/^Type an amount/)).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("What if I spend"), "10");
  expect(screen.getByText("Today's £16 covers it. £6 left today")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("What if I spend"), "100");
  expect(screen.getByText(/^Then it's £\d+ a day from tomorrow, instead of £\d+$/)).toBeOnTheScreen();
});

test("without a daily number, it says so instead", async () => {
  await show([], baseState({incomes: []}));
  expect(screen.getByText(/There's no daily number yet/)).toBeOnTheScreen();
});
