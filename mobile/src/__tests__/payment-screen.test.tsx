import {fireEvent, render, screen} from "@testing-library/react-native";
import {router} from "expo-router";
import PaymentScreen from "@/app/payment/[id]";
import {updateFiling} from "@/db/transactions";
import {baseState, TODAY, tx} from "@/lib/__tests__/fixtures";
import type {Tx} from "@/lib/types";
import {useMoney} from "@/store/useMoney";

const mockId = {id: ""};
jest.mock("expo-router", () => ({router: {push: jest.fn(), back: jest.fn()}, useLocalSearchParams: () => mockId}));
jest.mock("expo-sqlite/kv-store", () => ({__esModule: true, default: {getItemSync: () => null, setItemSync: () => {}, removeItemSync: () => true}}));
jest.mock("@/db/transactions", () => ({listSince: jest.fn(async () => []), insertTx: jest.fn(async () => {}), deleteTx: jest.fn(async () => {}), updateFiling: jest.fn(async () => {})}));

const show = (it: Tx) => {
  mockId.id = it.id;
  useMoney.setState({state: baseState(), txs: [it], today: TODAY, loaded: true, toast: null});
  return render(<PaymentScreen />);
};

test("an unsorted Monzo payment asks, with nothing picked", async () => {
  await show(tx({amount: 18, date: TODAY, note: "Boots", cat: "other", needsCat: true}));
  expect(screen.getByText("Monzo didn't say what this was. Pick one.")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Other"})).not.toBeSelected();
});

test("the current category is picked", async () => {
  await show(tx({amount: 9, date: TODAY, note: "Lunch", cat: "eating"}));
  expect(screen.getByRole("button", {name: "Eating out"})).toBeSelected();
  // the fixed Rent category isn't offered: rent goes through its bill
  expect(screen.getAllByRole("button", {name: "Rent"})).toHaveLength(1);
  expect(screen.getByRole("button", {name: "Rent"})).not.toBeSelected();
});

test("tapping a category files it straight away", async () => {
  const it = tx({amount: 9, date: TODAY, note: "Lunch", cat: "eating"});
  await show(it);
  await fireEvent.press(screen.getByRole("button", {name: "Groceries"}));
  expect(router.back).toHaveBeenCalled();
  expect(updateFiling).toHaveBeenCalledWith(it.id, {cat: "groceries"});
  expect(useMoney.getState().txs[0].cat).toBe("groceries");
  expect(useMoney.getState().toast?.msg).toBe("Filed under Groceries");
});

test("money in that hasn't been sorted asks what it was", async () => {
  await show(tx({type: "income", amount: 40, date: TODAY, note: "Faster payment", cat: "monzo-in"}));
  expect(screen.getByText("Not all money in is income. What was this?")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Pharmacy"})).not.toBeSelected();
  expect(screen.getByRole("button", {name: "Moving my own money"})).not.toBeSelected();
});

test("a refund asks which category, then goes back to it", async () => {
  const it = tx({type: "income", amount: 40, date: TODAY, note: "Tesco", cat: "monzo-in"});
  await show(it);
  expect(screen.queryByText("What was refunded?")).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Refund"}));
  expect(updateFiling).not.toHaveBeenCalledWith(it.id, expect.anything());
  await fireEvent.press(screen.getByRole("button", {name: "Groceries"}));
  expect(updateFiling).toHaveBeenCalledWith(it.id, {cat: "refund", refundOf: "groceries"});
  expect(useMoney.getState().txs[0]).toMatchObject({cat: "refund", refundOf: "groceries"});
  expect(useMoney.getState().toast?.msg).toBe("Refund for Groceries. It's taken off what you spent there");
});

test("a refund opens showing what it was filed under", async () => {
  await show(tx({type: "income", amount: 40, date: TODAY, cat: "refund", refundOf: "eating"}));
  expect(screen.getByRole("button", {name: "Refund"})).toBeSelected();
  expect(screen.getByRole("button", {name: "Eating out"})).toBeSelected();
});

test("tapping your pay counts it as that payday arriving", async () => {
  const it = tx({type: "income", amount: 1800, date: "2026-09-30", note: "ACME LTD", cat: "monzo-in"});
  await show(it);
  await fireEvent.press(screen.getByRole("button", {name: "Pharmacy"}));
  expect(updateFiling).toHaveBeenCalledWith(it.id, {cat: "job", srcId: "job", forDate: "2026-09-30"});
});
