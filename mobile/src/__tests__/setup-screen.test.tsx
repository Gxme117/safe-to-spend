import {fireEvent, render, screen} from "@testing-library/react-native";
import {SafeAreaProvider} from "react-native-safe-area-context";
import SetupScreen from "@/app/setup";
import {TODAY} from "@/lib/__tests__/fixtures";
import {useMoney} from "@/store/useMoney";

jest.mock("expo-router", () => ({router: {push: jest.fn(), back: jest.fn()}}));
jest.mock("expo-sqlite/kv-store", () => ({__esModule: true, default: {getItemSync: () => null, setItemSync: () => {}, removeItemSync: () => true}}));
jest.mock("@/db/transactions", () => ({listSince: jest.fn(async () => []), insertTx: jest.fn(async () => {}), deleteTx: jest.fn(async () => {})}));

const show = async () => {
  useMoney.setState({state: null, txs: [], today: TODAY, loaded: true});
  const metrics = {frame: {x: 0, y: 0, width: 390, height: 844}, insets: {top: 47, left: 0, right: 0, bottom: 34}};
  return render(<SafeAreaProvider initialMetrics={metrics}><SetupScreen /></SafeAreaProvider>);
};
const next = (name = "Continue") => fireEvent.press(screen.getByRole("button", {name}));

test("one question per page, and Continue waits for an answer", async () => {
  await show();
  expect(screen.getByText("How much is in your account?")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Continue"})).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("Your balance"), "1250.50");
  expect(screen.getByRole("button", {name: "Continue"})).toBeEnabled();
});

test("balance, pay and payday make a real income", async () => {
  await show();
  await fireEvent.changeText(screen.getByLabelText("Your balance"), "1250.50");
  await next();
  expect(screen.getByText("How much are you paid?")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Your pay a month, after tax"), "1800");
  await next();
  expect(screen.getByText("When are you paid?")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Every 4 weeks"}));
  await next("Show my number");
  const st = useMoney.getState().state!;
  expect(st.balance).toBe(1250.5);
  expect(st.incomes).toHaveLength(1);
  // £1,800 a month is £21,600 a year: 13 four-weekly paydays of £1,661.54
  expect(st.incomes[0]).toMatchObject({name: "Pay", amount: 1661.54, freq: "fourweekly", date: TODAY, main: true});
});

test("hourly: rate and hours, with take-home estimated", async () => {
  await show();
  await fireEvent.changeText(screen.getByLabelText("Your balance"), "500");
  await next();
  await fireEvent.press(screen.getByRole("button", {name: "An hour"}));
  expect(screen.getByRole("button", {name: "Continue"})).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("Your pay an hour, before tax"), "12.50");
  await fireEvent.changeText(screen.getByLabelText("Hours you work a week"), "37.5");
  // £24,375 a year before tax: £2,361 tax and £944.40 NI leave £21,069.60
  expect(screen.getByText("About £1,756 a month")).toBeOnTheScreen();
  await next();
  await next("Show my number");
  expect(useMoney.getState().state!.incomes[0].amount).toBe(1755.8);
});

test("not paid regularly: starts with just the balance", async () => {
  await show();
  await fireEvent.changeText(screen.getByLabelText("Your balance"), "300");
  await next();
  await fireEvent.press(screen.getByRole("button", {name: "I'm not paid regularly"}));
  const st = useMoney.getState().state!;
  expect(st.balance).toBe(300);
  expect(st.incomes).toEqual([]);
});

test("back keeps the answer", async () => {
  await show();
  await fireEvent.changeText(screen.getByLabelText("Your balance"), "42");
  await next();
  await fireEvent.press(screen.getByRole("button", {name: "Back"}));
  expect(screen.getByLabelText("Your balance")).toHaveDisplayValue("42");
});
