import {fireEvent, render, screen} from "@testing-library/react-native";
import {router, useLocalSearchParams} from "expo-router";
import {SafeAreaProvider} from "react-native-safe-area-context";
import ExpectMoney from "@/app/expect";
import {baseState, TODAY} from "@/lib/__tests__/fixtures";
import {addDays, longDate} from "@/lib/dates";
import {useMoney} from "@/store/useMoney";

const metrics = {frame: {x: 0, y: 0, width: 390, height: 844}, insets: {top: 0, left: 0, right: 0, bottom: 0}};

jest.mock("expo-router", () => ({router: {push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true)}, Stack: {Screen: () => null}, useLocalSearchParams: jest.fn(() => ({}))}));
jest.mock("expo-sqlite/kv-store", () => ({__esModule: true, default: {getItemSync: () => null, setItemSync: () => {}, removeItemSync: () => true}}));
jest.mock("@/db/transactions", () => ({listSince: jest.fn(async () => []), insertTx: jest.fn(async () => {}), deleteTx: jest.fn(async () => {}), updateFiling: jest.fn(async () => {})}));

const open = async (params: Record<string, string>) => {
  (useLocalSearchParams as jest.Mock).mockReturnValue(params);
  return render(<SafeAreaProvider initialMetrics={metrics}><ExpectMoney /></SafeAreaProvider>);
};

test("saves the day, time, amount and who it's from as money expected, not counted", async () => {
  useMoney.setState({state: baseState(), txs: [], today: TODAY, loaded: true});
  await open({date: addDays(TODAY, 1)});
  // the day is known, so it opens on the details
  expect(screen.getByText("Tomorrow")).toBeOnTheScreen();
  expect(screen.getByText("After 9am tomorrow, we'll ask if it's arrived")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Amount"), "40");
  await fireEvent.changeText(screen.getByLabelText("Who it's from"), "Nando's");
  await fireEvent.press(screen.getByText("Add money coming in"));
  const st = useMoney.getState();
  expect(st.state!.incomes.find(x => x.name === "Nando's")).toMatchObject({freq: "oneoff", date: addDays(TODAY, 1), time: "09:00", amount: 40, main: false});
  expect(st.txs).toEqual([]);
  expect(router.back).toHaveBeenCalled();
});

test("opens on the calendar from today; already arrived goes to money in", async () => {
  useMoney.setState({state: baseState(), txs: [], today: TODAY, loaded: true});
  await open({date: TODAY});
  expect(screen.queryByText("Add money coming in")).toBeNull();
  await fireEvent.press(screen.getByText("Already arrived?"));
  expect(router.replace).toHaveBeenCalledWith("/add-payment?kind=income");
  // today is already picked: Next carries on with it
  await fireEvent.press(screen.getByText("Next"));
  expect(screen.getByText("Today")).toBeOnTheScreen();
});

test("asks for an amount, and the day goes back to the calendar", async () => {
  useMoney.setState({state: baseState(), txs: [], today: TODAY, loaded: true});
  await open({date: addDays(TODAY, 1)});
  await fireEvent.press(screen.getByText("Add money coming in"));
  expect(screen.getByText("Enter how much is coming, e.g. 40")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: /Change the day$/}));
  expect(screen.getByText("Already arrived?")).toBeOnTheScreen();
});

test("opens money you're expecting to edit, keeping its time", async () => {
  const nandos = {id: "nan", name: "Nando's", type: "other" as const, freq: "oneoff" as const, varies: false, amount: 40, date: addDays(TODAY, 1), time: "14:00", since: TODAY};
  useMoney.setState({state: baseState({incomes: [...baseState().incomes, nandos]}), txs: [], today: TODAY, loaded: true});
  await open({id: "nan"});
  expect(screen.getByDisplayValue("Nando's")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Amount"), "45");
  await fireEvent.press(screen.getByText("Save"));
  expect(useMoney.getState().state!.incomes.find(x => x.id === "nan")).toMatchObject({amount: 45, time: "14:00"});
});

test("tapping a day picks it without moving on; Next does", async () => {
  useMoney.setState({state: baseState(), txs: [], today: TODAY, loaded: true});
  await open({});
  const fri = addDays(TODAY, 4); // TODAY is Mon 5 Oct
  await fireEvent.press(screen.getByRole("button", {name: "Fri 9 October"}));
  expect(screen.getByRole("button", {name: "Fri 9 October"})).toBeSelected();
  expect(screen.queryByText("How much?")).toBeNull();
  // days before today can't be picked
  expect(screen.getByRole("button", {name: "Sun 4 October"})).toBeDisabled();
  await fireEvent.press(screen.getByText("Next"));
  expect(screen.getByRole("button", {name: /^Fri 9 Oct\. Change the day$/})).toBeOnTheScreen();
  expect(fri).toBe("2026-10-09");
});

test("days with money already on its way are marked on the calendar", async () => {
  const nandos = {id: "nan", name: "Nando's", type: "other" as const, freq: "oneoff" as const, varies: false, amount: 40, date: "2026-10-09", since: TODAY};
  useMoney.setState({state: baseState({incomes: [...baseState().incomes, nandos]}), txs: [], today: TODAY, loaded: true});
  await open({});
  expect(screen.getByRole("button", {name: "Fri 9 October, money coming in"})).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Thu 8 October"})).toBeOnTheScreen();
});

test("with nothing behind it, closing goes to the Day tab", async () => {
  useMoney.setState({state: baseState(), txs: [], today: TODAY, loaded: true});
  (router.canGoBack as jest.Mock).mockReturnValueOnce(false);
  await open({date: addDays(TODAY, 1)});
  await fireEvent.press(screen.getAllByRole("button", {name: "Close"}).at(-1)!);
  expect(router.replace).toHaveBeenCalledWith("/");
});

test("the calendar marks your next payday as money coming in", async () => {
  useMoney.setState({state: baseState(), txs: [], today: TODAY, loaded: true});
  await open({date: TODAY});
  expect(screen.getByRole("button", {name: `${longDate("2026-10-30")}, money coming in`})).toBeOnTheScreen();
});
