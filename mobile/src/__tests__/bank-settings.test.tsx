import {render, screen} from "@testing-library/react-native";
import {BankSettings} from "@/components/Profile";
import * as banks from "@/lib/banks";
import {useMoney} from "@/store/useMoney";

jest.mock("expo-router", () => ({router: {push: jest.fn()}}));
jest.mock("expo-sqlite/kv-store", () => ({__esModule: true, default: {getItemSync: () => null, setItemSync: () => {}, removeItemSync: () => true}}));
jest.mock("@/db/transactions", () => ({listSince: jest.fn(async () => []), insertTx: jest.fn(async () => {}), deleteTx: jest.fn(async () => {})}));

beforeEach(() => useMoney.setState({state: null}));

test("with linked banks on, Monzo and Add an account are both offered", async () => {
  await render(<BankSettings />);
  expect(screen.getByRole("button", {name: "Connect Monzo"})).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Add an account"})).toBeOnTheScreen();
});

test("the tester build keeps Monzo and hides the mock bank", async () => {
  const off = jest.replaceProperty(banks, "linksOn", false);
  try {
    await render(<BankSettings />);
    expect(screen.getByRole("button", {name: "Connect Monzo"})).toBeOnTheScreen();
    expect(screen.queryByRole("button", {name: "Add an account"})).toBeNull();
  } finally { off.restore(); }
});
