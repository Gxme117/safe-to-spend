import {act, fireEvent, render, screen} from "@testing-library/react-native";
import {router} from "expo-router";
import LivingScreen from "@/app/(tabs)/living";
import {baseState, TODAY, tx} from "@/lib/__tests__/fixtures";
import type {AppState, Tx} from "@/lib/types";
import {useMoney} from "@/store/useMoney";

jest.mock("expo-sqlite/kv-store", () => ({__esModule: true, default: {getItemSync: () => null, setItemSync: () => {}, removeItemSync: () => true}}));
jest.mock("expo-router", () => ({router: {push: jest.fn()}}));
jest.mock("@/db/transactions",() => ({listSince: jest.fn(async () => []), insertTx: jest.fn(async () => {}), deleteTx: jest.fn(async () => {}), updateFiling: jest.fn(async () => {})}));

// the total counts up frame by frame; tests read the figure it lands on
beforeEach(() => { jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 0); });
afterEach(() => jest.restoreAllMocks());

const show = async (state: AppState = baseState(), txs: Tx[] = []) => {
  useMoney.setState({state, txs, today: TODAY, loaded: true});
  await render(<LivingScreen />);
  // the pile is laid out once the pit knows its size
  await fireEvent(screen.getByTestId("pit"), "layout", {nativeEvent: {layout: {width: 358, height: 560}}});
};
// tap a bubble, then its short sheet for the rest
const openTall = async (name: string) => {
  await fireEvent.press(screen.getByRole("button", {name}));
  await fireEvent.press(screen.getByRole("button", {name: /Show more$/}));
};

test("a tap opens the sheet short, one line of name and amount; a tap on it shows the rest", async () => {
  await show();
  await fireEvent.press(screen.getByRole("button", {name: "Rent, £400"}));
  expect(screen.getByText("Rent")).toBeOnTheScreen();
  // on the bubble, and at the end of the sheet's line
  expect(screen.getAllByText("£400")).toHaveLength(2);
  expect(screen.queryByText("Due Thu 15 Oct, in 10 days")).toBeNull();
  expect(screen.queryByRole("button", {name: "Edit"})).toBeNull();
  // another bubble swaps it, still short
  await fireEvent.press(screen.getByRole("button", {name: "Groceries, about £200"}));
  expect(screen.queryByRole("button", {name: "Log spending"})).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Groceries, about £200. Show more"}));
  // tall: the amount big ("About" an everyday one), what's left of it, and the buttons
  expect(screen.getByText("About")).toBeOnTheScreen();
  expect(screen.getByText("Nothing spent yet, £200 left")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Log spending"})).toBeOnTheScreen();
  // closed and opened again, it's short again
  await fireEvent.press(screen.getByTestId("pit-space"));
  await fireEvent.press(screen.getByRole("button", {name: "Groceries, about £200"}));
  expect(screen.queryByRole("button", {name: "Log spending"})).toBeNull();
});

test("what it all costs a month, what's still to go out before payday, and a bubble for each bill and everyday amount", async () => {
  await show(baseState(), [tx({amount: 20, date: "2026-10-01", billId: "phone", forDate: "2026-10-01"})]);
  // the header reads as one: what it costs a month, and what's still to go out before payday
  expect(screen.getByLabelText(/^Cost of living, £620 a month\. £\d[\d,]* to pay before payday$/)).toBeOnTheScreen();
  expect(screen.getByText("Cost of living")).toBeOnTheScreen();
  expect(screen.getByText("a month")).toBeOnTheScreen();
  // nothing's open before a tap
  expect(screen.getByRole("button", {name: "Rent, £400", selected: false})).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Groceries, about £200"})).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Phone, £20, paid"})).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Add a bill"})).toBeOnTheScreen();
  // big bubbles show what they cost under the icon (~ for an everyday estimate); the smallest only say it in their label
  expect(screen.getByText("£400")).toBeOnTheScreen();
  expect(screen.getByText("~£200")).toBeOnTheScreen();
  expect(screen.queryByText("£20")).toBeNull();
});

test("tap a bubble for its details; tap it again, empty space or the handle to close them", async () => {
  await show();
  const sheet = (name: string) => screen.queryByRole("button", {name: `${name}. Show more`});
  // closed, the sheet is out of the way of a screen reader
  expect(sheet("Rent, £400")).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Rent, £400"}));
  expect(screen.getByRole("button", {name: "Rent, £400", selected: true})).toBeOnTheScreen();
  expect(sheet("Rent, £400")).toBeOnTheScreen();
  // the same bubble again closes it
  await fireEvent.press(screen.getByRole("button", {name: "Rent, £400"}));
  expect(sheet("Rent, £400")).toBeNull();
  // another bubble swaps the sheet to it
  await fireEvent.press(screen.getByRole("button", {name: "Groceries, about £200"}));
  await fireEvent.press(screen.getByRole("button", {name: "Phone, £20"}));
  expect(sheet("Phone, £20")).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId("pit-space"));
  expect(sheet("Phone, £20")).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Phone, £20"}));
  await fireEvent.press(screen.getByRole("button", {name: "Close details"}));
  expect(sheet("Phone, £20")).toBeNull();
});

test("tall, it says when it's due", async () => {
  await show();
  await openTall("Rent, £400");
  expect(screen.getByText("Due Thu 15 Oct, in 10 days")).toBeOnTheScreen();
});

test("a paid bill's sheet says it's paid, the word in bold green", async () => {
  await show(baseState(), [tx({amount: 20, date: "2026-10-01", billId: "phone", forDate: "2026-10-01"})]);
  await openTall("Phone, £20, paid");
  expect(screen.getByText("Paid · Thu 1 Oct")).toBeOnTheScreen();
  expect(screen.getByText("Paid")).toHaveStyle({color: "#1F7A4C"});
});

test("with no bills, a bigger + and what the page is for", async () => {
  await show(baseState({bills: [], categories: []}));
  expect(screen.getByLabelText(/^Cost of living, £0 a month/)).toBeOnTheScreen();
  expect(screen.getByText("Add your first bill")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Add a bill"})).toBeOnTheScreen();
});

test("Mark as paid logs the bill's payment and the sheet says it's paid; Mark as unpaid takes it off again", async () => {
  await show();
  await openTall("Rent, £400");
  await fireEvent.press(screen.getByRole("button", {name: "Mark as paid"}));
  const logged = useMoney.getState().txs.find(t => t.billId === "rent")!;
  expect(logged).toMatchObject({type: "expense", amount: 400, date: TODAY, forDate: "2026-10-15"});
  expect(screen.getByRole("button", {name: "Rent, £400, paid", selected: true})).toBeOnTheScreen();
  expect(screen.getByText("Paid · Thu 15 Oct")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Mark as unpaid"}));
  expect(useMoney.getState().txs.some(t => t.billId === "rent")).toBe(false);
  expect(screen.getByText("Due Thu 15 Oct, in 10 days")).toBeOnTheScreen();
});

test("an everyday amount's sheet logs spending in it", async () => {
  await show();
  await openTall("Groceries, about £200");
  await fireEvent.press(screen.getByRole("button", {name: "Log spending"}));
  expect(router.push).toHaveBeenCalledWith({pathname: "/add-payment", params: {cat: "groceries"}});
});

test("Edit turns the sheet into a form; Save changes the bill, Cancel leaves it", async () => {
  await show();
  await openTall("Rent, £400");
  await fireEvent.press(screen.getByRole("button", {name: "Edit"}));
  expect(screen.getByText("Edit Rent")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Amount"), "0");
  await fireEvent.press(screen.getByRole("button", {name: "Save"}));
  expect(screen.getByText("Enter how much it is, e.g. 650")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Amount"), "450");
  await fireEvent.changeText(screen.getByLabelText("Day of the month it goes out"), "20");
  await fireEvent.press(screen.getByRole("button", {name: "Save"}));
  expect(useMoney.getState().state!.bills.find(b => b.id === "rent")).toMatchObject({amount: 450, day: 20});
  expect(screen.getByRole("button", {name: "Rent, £450", selected: true})).toBeOnTheScreen();
  expect(screen.getByText("Due Tue 20 Oct, in 15 days")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Edit"}));
  await fireEvent.changeText(screen.getByLabelText("Name"), "Flat");
  await fireEvent.press(screen.getByRole("button", {name: "Cancel"}));
  expect(useMoney.getState().state!.bills.find(b => b.id === "rent")?.name).toBe("Rent");
});

test("a paid bill's sheet lists the payment that paid it", async () => {
  await show(baseState(), [tx({amount: 20, date: "2026-10-01", billId: "phone", forDate: "2026-10-01", note: "EE"})]);
  await openTall("Phone, £20, paid");
  expect(screen.getByText("EE")).toBeOnTheScreen();
  expect(screen.getByText("−£20")).toBeOnTheScreen();
});

test("Delete removes a bill straight away, and Undo in the toast puts it back where it was", async () => {
  await show();
  const before = useMoney.getState().state!.bills;
  await openTall("Rent, £400");
  await fireEvent.press(screen.getByRole("button", {name: "Delete"}));
  expect(screen.queryByRole("button", {name: /^Rent/})).toBeNull();
  const toast = useMoney.getState().toast!;
  expect(toast.msg).toBe("Rent removed");
  await act(() => toast.undo!());
  expect(useMoney.getState().state!.bills).toEqual(before);
  expect(screen.getByRole("button", {name: "Rent, £400"})).toBeOnTheScreen();
});

test("Delete on an everyday amount drops it to nothing, keeping the category; Undo brings the amount back", async () => {
  await show();
  await openTall("Groceries, about £200");
  await fireEvent.press(screen.getByRole("button", {name: "Delete"}));
  expect(screen.queryByRole("button", {name: /^Groceries/})).toBeNull();
  expect(useMoney.getState().state!.categories.find(x => x.id === "groceries")?.budget).toBe(0);
  await act(() => useMoney.getState().toast!.undo!());
  expect(screen.getByRole("button", {name: "Groceries, about £200"})).toBeOnTheScreen();
});

test("+ opens New bill in the sheet; Add bill stays grey until there's a name and an amount, then adds it to the pile", async () => {
  await show();
  await fireEvent.press(screen.getByRole("button", {name: "Add a bill"}));
  expect(screen.getByText("New bill")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Add bill"})).toBeDisabled();
  expect(screen.getByText("Picks itself as you type")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Name"), "Octopus");
  // the icon follows the name
  expect(screen.getByRole("radio", {name: "Energy", checked: true})).toBeOnTheScreen();
  expect(screen.getByText("Picked from the name · tap to change")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Amount"), "95");
  await fireEvent.changeText(screen.getByLabelText("Due"), "the 26th");
  expect(screen.getByText("Counts once each month")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Add bill"}));
  expect(useMoney.getState().state!.bills.at(-1)).toMatchObject({name: "Octopus", amount: 95, freq: "monthly", day: 26});
  expect(useMoney.getState().state!.bills.at(-1)!.icon).toBeUndefined();
  expect(screen.getByRole("button", {name: "Octopus, £95"})).toBeOnTheScreen();
  expect(useMoney.getState().toast?.msg).toBe("Octopus added");
});

test("New bill: How often changes the hint and the note; a tapped icon is kept; a one-off needs its date", async () => {
  await show();
  await fireEvent.press(screen.getByRole("button", {name: "Add a bill"}));
  await fireEvent.changeText(screen.getByLabelText("Name"), "Festival");
  await fireEvent.changeText(screen.getByLabelText("Amount"), "120");
  await fireEvent.press(screen.getByRole("radio", {name: "One-off"}));
  expect(screen.getByPlaceholderText("e.g. Fri 23 Oct")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Add bill"})).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("Due"), "soon");
  expect(screen.getByText('Not sure when that is. Try "Fri 23 Oct"')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Due"), "Fri 23 Oct");
  await fireEvent.press(screen.getByRole("radio", {name: "Music"}));
  expect(screen.getByText("Your choice")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Add bill"}));
  expect(useMoney.getState().state!.bills.at(-1)).toMatchObject({name: "Festival", amount: 120, freq: "oneoff", date: "2026-10-23", icon: "music"});
});

test("Cancel closes New bill without adding anything", async () => {
  await show();
  const n = useMoney.getState().state!.bills.length;
  await fireEvent.press(screen.getByRole("button", {name: "Add a bill"}));
  await fireEvent.changeText(screen.getByLabelText("Name"), "Gym");
  await fireEvent.press(screen.getByRole("button", {name: "Cancel"}));
  expect(useMoney.getState().state!.bills).toHaveLength(n);
  expect(screen.queryByText("New bill")).toBeNull();
});
