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
  useMoney.setState({state, txs, today: TODAY, loaded: true, livingView: "pit"});
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
  // at the end of the sheet's line (the bubble shows only its icon)
  expect(screen.getAllByText("£400")).toHaveLength(1);
  expect(screen.queryByText("Due Thu 15 Oct, in 10 days")).toBeNull();
  expect(screen.queryByRole("button", {name: "Edit"})).toBeNull();
  // another bubble swaps it, still short
  await fireEvent.press(screen.getByRole("button", {name: "Groceries, £200"}));
  expect(screen.queryByRole("button", {name: "Log spending"})).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Groceries, £200. Show more"}));
  // tall: the amount big (a fixed budget: no "About"), what's been spent of it, and the buttons
  expect(screen.queryByText(/About/)).toBeNull();
  expect(screen.getByText("Spent £0 of £200")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Log spending"})).toBeOnTheScreen();
  // closed and opened again, it's short again
  await fireEvent.press(screen.getByTestId("pit-space"));
  await fireEvent.press(screen.getByRole("button", {name: "Groceries, £200"}));
  expect(screen.queryByRole("button", {name: "Log spending"})).toBeNull();
});

test("< and > step through the months: one gone shows what was spent, one to come what's expected, and their bubbles are only to look at", async () => {
  // September: rent paid, phone paid, £150 of groceries
  const txs = [tx({amount: 400, date: "2026-09-15", billId: "rent", forDate: "2026-09-15"}), tx({amount: 20, date: "2026-09-01", billId: "phone", forDate: "2026-09-01"}),
    tx({amount: 150, date: "2026-09-12", cat: "groceries"})];
  await show(baseState(), txs);
  await fireEvent.press(screen.getByRole("button", {name: "Show September"}));
  const lay = () => fireEvent(screen.getByTestId("pit"), "layout", {nativeEvent: {layout: {width: 358, height: 560}}});
  await lay();
  expect(screen.getByLabelText("Spent, £570 in September. On bills and everyday")).toBeOnTheScreen();
  expect(screen.getByText("Sep")).toBeOnTheScreen();
  // what went out, not marked paid (it all went), and no "+"
  expect(screen.getByRole("button", {name: "Groceries, £150"})).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Rent, £400"})).toBeOnTheScreen();
  expect(screen.queryByRole("button", {name: "Add a bill"})).toBeNull();
  await openTall("Rent, £400");
  expect(screen.getByText("Paid")).toBeOnTheScreen();
  expect(screen.queryByRole("button", {name: "Edit"})).toBeNull();
  expect(screen.queryByRole("button", {name: "Mark as unpaid"})).toBeNull();

  // two on: November, what's expected
  await fireEvent.press(screen.getByRole("button", {name: "Show October"}));
  await fireEvent.press(screen.getByRole("button", {name: "Show November"}));
  await lay();
  expect(screen.getByLabelText("Expected, £620 in November. Bills and everyday budgets")).toBeOnTheScreen();
  await openTall("Rent, £400");
  // the 15th is a Sunday: it goes out the next working day
  expect(screen.getByText("Due Mon 16 Nov")).toBeOnTheScreen();
  expect(screen.queryByRole("button", {name: "Mark as paid"})).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Close details"}));
  await fireEvent.press(screen.getByRole("button", {name: "Groceries, £200"}));
  await fireEvent.press(screen.getByRole("button", {name: /Show more$/}));
  expect(screen.getByText("Your budget for November")).toBeOnTheScreen();
});

test("< and > stop 12 months either way", async () => {
  await show();
  for (let i = 0; i < 12; i++) await fireEvent.press(screen.getByTestId("month-back"));
  expect(screen.getByText("Oct 2025")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Show September 2025"})).toBeDisabled();
  for (let i = 0; i < 24; i++) await fireEvent.press(screen.getByTestId("month-forward"));
  expect(screen.getByText("Oct 2027")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Show November 2027"})).toBeDisabled();
});

test("spent well past an everyday budget last pay cycle: its sheet suggests a new one and says why; Change sets it, Keep leaves it", async () => {
  // a payment from before last pay cycle, so the app has seen all of it, and £260 of groceries in it
  const txs = [tx({amount: 5, date: "2026-08-20", cat: "other"}), tx({amount: 260, date: "2026-09-10", cat: "groceries"})];
  await show(baseState(), txs);
  await openTall("Groceries, £200");
  expect(screen.getByText("You spent £260 on Groceries last pay cycle, against a budget of £200.")).toBeOnTheScreen();
  expect(screen.getByText(/^Your daily number would be £\d+ instead of £\d+\.$/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: "Change to £260"}));
  expect(useMoney.getState().state?.categories.find(k => k.id === "groceries")?.budget).toBe(260);
  expect(screen.queryByText(/against a budget/)).toBeNull();
  expect(screen.getByRole("button", {name: "Groceries, £260"})).toBeOnTheScreen();

  // kept: the budget stays, and it isn't asked again this pay cycle
  await show(baseState(), txs);
  await openTall("Groceries, £200");
  await fireEvent.press(screen.getByRole("button", {name: "Keep £200"}));
  expect(useMoney.getState().state?.categories.find(k => k.id === "groceries")).toMatchObject({budget: 200, budgetKept: TODAY});
  expect(screen.queryByText(/against a budget/)).toBeNull();
});

test("the list: the same bills and everyday amounts with their figures; a row opens the sheet, and the choice is kept", async () => {
  await show(baseState(), [tx({amount: 20, date: "2026-10-01", billId: "phone", forDate: "2026-10-01"})]);
  await fireEvent.press(screen.getByRole("button", {name: "Show as list"}));
  expect(screen.queryByTestId("pit")).toBeNull();
  expect(screen.getByRole("header", {name: "Bills, £420 a month"})).toBeOnTheScreen();
  expect(screen.getByRole("header", {name: "Everyday, £200 a month"})).toBeOnTheScreen();
  // each row says what it costs and when it's due; paid is said in words
  expect(screen.getByText("£400")).toBeOnTheScreen();
  // Groceries' row, and the Everyday total it makes up on its own
  expect(screen.getAllByText("£200")).toHaveLength(2);
  expect(screen.getByText("Due Thu 15 Oct, in 10 days")).toBeOnTheScreen();
  expect(screen.getByText("Paid")).toBeOnTheScreen();
  // a row opens the same sheet as its bubble
  await fireEvent.press(screen.getByRole("button", {name: "Rent, £400"}));
  expect(screen.getByRole("button", {name: "Rent, £400", selected: true})).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", {name: /Show more$/}));
  expect(screen.getByRole("button", {name: "Mark as paid"})).toBeOnTheScreen();
  // + opens New bill
  await fireEvent.press(screen.getByRole("button", {name: "Add a bill"}));
  expect(screen.getByText("New bill")).toBeOnTheScreen();
  // kept for next time, and back to the pit
  expect(useMoney.getState().livingView).toBe("list");
  await fireEvent.press(screen.getByRole("button", {name: "Show as bubbles"}));
  expect(screen.getByTestId("pit")).toBeOnTheScreen();
  expect(useMoney.getState().livingView).toBe("pit");
});

test("what it all costs a month, what's still to go out before payday, and a bubble for each bill and everyday amount", async () => {
  await show(baseState(), [tx({amount: 20, date: "2026-10-01", billId: "phone", forDate: "2026-10-01"})]);
  // the header reads as one: what this month costs, and what's still to go out before payday; the month's under it
  expect(screen.getByLabelText(/^Cost of living, £620 in October\. £\d[\d,]* to pay before payday$/)).toBeOnTheScreen();
  // drawn, though a screen reader hears them in the header's label
  expect(screen.getByText("Cost of living", {includeHiddenElements: true})).toBeOnTheScreen();
  expect(screen.getByText("a month", {includeHiddenElements: true})).toBeOnTheScreen();
  expect(screen.getByText("Oct")).toBeOnTheScreen();
  // nothing's open before a tap
  expect(screen.getByRole("button", {name: "Rent, £400", selected: false})).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Groceries, £200"})).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Phone, £20, paid"})).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Add a bill"})).toBeOnTheScreen();
  // bubbles show only their icon: what they cost is in their label and their sheet
  expect(screen.queryByText("£400")).toBeNull();
  expect(screen.queryByText("~£200")).toBeNull();
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
  await fireEvent.press(screen.getByRole("button", {name: "Groceries, £200"}));
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
  expect(screen.getByLabelText(/^Cost of living, £0 in October/)).toBeOnTheScreen();
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
  await openTall("Groceries, £200");
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
  await openTall("Groceries, £200");
  await fireEvent.press(screen.getByRole("button", {name: "Delete"}));
  expect(screen.queryByRole("button", {name: /^Groceries/})).toBeNull();
  expect(useMoney.getState().state!.categories.find(x => x.id === "groceries")?.budget).toBe(0);
  await act(() => useMoney.getState().toast!.undo!());
  expect(screen.getByRole("button", {name: "Groceries, £200"})).toBeOnTheScreen();
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

test("a month to come still has the \"+\": New bill starts on One-off, and a day on its own is that month's", async () => {
  await show();
  await fireEvent.press(screen.getByRole("button", {name: "Show November"}));
  await fireEvent.press(screen.getByRole("button", {name: "Show December"}));
  await fireEvent(screen.getByTestId("pit"), "layout", {nativeEvent: {layout: {width: 358, height: 560}}});
  await fireEvent.press(screen.getByRole("button", {name: "Add a bill"}));
  expect(screen.getByRole("radio", {name: "One-off", checked: true})).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Name"), "MOT");
  await fireEvent.changeText(screen.getByLabelText("Amount"), "55");
  await fireEvent.changeText(screen.getByLabelText("Due"), "the 3rd");
  await fireEvent.press(screen.getByRole("button", {name: "Add bill"}));
  expect(useMoney.getState().state!.bills.at(-1)).toMatchObject({name: "MOT", amount: 55, freq: "oneoff", date: "2026-12-03"});
  expect(screen.getByRole("button", {name: "MOT, £55"})).toBeOnTheScreen();
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

// to do: the year view isn't built yet. This is its spec, kept until it is
test.skip("the month's name zooms out to the year, a month a row; a tap on one zooms back in to it", async () => {
  await show();
  await fireEvent.press(screen.getByRole("button", {name: "October. Show the year"}));
  // what you'd have on 31 Dec: £1,000 now, + £1,200 in October, + £1,180 in each of November and December
  expect(screen.getByLabelText("By 31 Dec, £4,560, 2026. If your pay, bills and budgets go to plan.")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "October, this month. £1,800 in, £600 out, £2,200 at the end"})).toBeOnTheScreen();
  // < and > go a year at a time, as far as Living can show
  await fireEvent.press(screen.getByTestId("year-forward"));
  expect(screen.getByText("2027")).toBeOnTheScreen();
  expect(screen.getByTestId("year-forward")).toBeDisabled();
  expect(screen.getByRole("button", {name: /^December\./})).toBeDisabled();
  await fireEvent.press(screen.getByRole("button", {name: /^March\./}));
  await fireEvent(screen.getByTestId("pit"), "layout", {nativeEvent: {layout: {width: 358, height: 560}}});
  expect(screen.getByText("Mar 2027")).toBeOnTheScreen();
  // and back out, then close to the month it came from
  await fireEvent.press(screen.getByTestId("month-year"));
  await fireEvent.press(screen.getByTestId("year-close"));
  expect(screen.getByText("Mar 2027")).toBeOnTheScreen();
});
