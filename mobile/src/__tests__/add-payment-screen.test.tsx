import {fireEvent, render, screen} from "@testing-library/react-native";
import {router, useLocalSearchParams} from "expo-router";
import {SafeAreaProvider} from "react-native-safe-area-context";
import AddPayment from "@/app/add-payment";
import {baseState, TODAY} from "@/lib/__tests__/fixtures";
import {addDays} from "@/lib/dates";
import {useMoney} from "@/store/useMoney";

const metrics = {frame: {x: 0, y: 0, width: 390, height: 844}, insets: {top: 0, left: 0, right: 0, bottom: 0}};

jest.mock("expo-router", () => ({router: {push: jest.fn(), back: jest.fn()}, Stack: {Screen: () => null}, useLocalSearchParams: jest.fn(() => ({}))}));
jest.mock("expo-sqlite/kv-store", () => ({__esModule: true, default: {getItemSync: () => null, setItemSync: () => {}, removeItemSync: () => true}}));
jest.mock("@/db/transactions", () => ({listSince: jest.fn(async () => []), insertTx: jest.fn(async () => {}), deleteTx: jest.fn(async () => {}), updateFiling: jest.fn(async () => {})}));

test("money in on a day still to come is saved as expected, not counted", async () => {
  const tomorrow = addDays(TODAY, 1);
  (useLocalSearchParams as jest.Mock).mockReturnValue({date: tomorrow, kind: "income"});
  useMoney.setState({state: baseState(), txs: [], today: TODAY, loaded: true});
  await render(<SafeAreaProvider initialMetrics={metrics}><AddPayment /></SafeAreaProvider>);
  expect(screen.getByText("Who's it from?")).toBeOnTheScreen();
  expect(screen.getByText("It counts once it lands. We'll ask tomorrow")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Amount"), "40");
  await fireEvent.changeText(screen.getByLabelText("Who it's from"), "Nando's");
  await fireEvent.press(screen.getByText("Add money coming in"));
  const st = useMoney.getState();
  expect(st.state!.incomes.find(x => x.name === "Nando's")).toMatchObject({freq: "oneoff", date: tomorrow, amount: 40, main: false});
  expect(st.txs).toEqual([]);
  expect(router.back).toHaveBeenCalled();
});

test("Money in opens on today; Tomorrow makes it money you're expecting", async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({date: TODAY, kind: "income"});
  useMoney.setState({state: baseState(), txs: [], today: TODAY, loaded: true});
  await render(<SafeAreaProvider initialMetrics={metrics}><AddPayment /></SafeAreaProvider>);
  expect(screen.getByText("Where did it come from?")).toBeOnTheScreen();
  await fireEvent.press(screen.getByText("Tomorrow"));
  expect(screen.getByText("Who's it from?")).toBeOnTheScreen();
  expect(screen.getByText("Add money coming in")).toBeOnTheScreen();
});
