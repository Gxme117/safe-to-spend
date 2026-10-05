import {act, fireEvent, render, screen} from "@testing-library/react-native";
import {router} from "expo-router";
import {Dimensions} from "react-native";
import {SafeAreaProvider} from "react-native-safe-area-context";
import SetupScreen from "@/app/setup";
import {keyboardCover} from "@/components/Setup";
import {TODAY} from "@/lib/__tests__/fixtures";
import {DEFAULT_CATEGORIES} from "@/lib/defaults";
import {syncNow} from "@/components/Bank";
import type {SetupFound} from "@/lib/found";
import {useMoney} from "@/store/useMoney";

jest.mock("expo-router", () => ({router: {push: jest.fn(), back: jest.fn()}}));
jest.mock("expo-sqlite/kv-store", () => ({__esModule: true, default: {getItemSync: () => null, setItemSync: () => {}, removeItemSync: () => true}}));
jest.mock("@/components/Bank", () => ({syncNow: jest.fn()}));
jest.mock("@/db/transactions", () => ({listSince: jest.fn(async () => []), insertTx: jest.fn(async () => {}), deleteTx: jest.fn(async () => {})}));

const show = async () => {
  useMoney.setState({state: null, txs: [], today: TODAY, loaded: true, setupBank: null, setupFound: null});
  const metrics = {frame: {x: 0, y: 0, width: 390, height: 844}, insets: {top: 47, left: 0, right: 0, bottom: 34}};
  return render(<SafeAreaProvider initialMetrics={metrics}><SetupScreen /></SafeAreaProvider>);
};
const next = (name = "Continue") => fireEvent.press(screen.getByRole("button", {name}));
const tap = (name: string) => fireEvent.press(screen.getByRole("button", {name}));
const skipEveryday = () => tap("Skip for now");
// no bills, and no everyday amounts: setup ends
const noBills = async () => { await tap("I don't have any bills"); await skipEveryday(); };
// through balance, pay and payday to the bills page
const toBills = async () => {
  await show();
  await fireEvent.changeText(screen.getByLabelText("Your balance"), "1250.50");
  await next();
  await fireEvent.changeText(screen.getByLabelText("Your pay a month, after tax"), "1800");
  await next();
  await next();
};
// what Monzo might say, with nothing found unless a test adds it
const found = (over: Partial<SetupFound> = {}): SetupFound => ({pay: null, rule: null, ...over});

test("one question per page, and Continue waits for an answer", async () => {
  await show();
  expect(screen.getByText("How much is in your account right now?")).toBeOnTheScreen();
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
  await next();
  await noBills();
  const st = useMoney.getState().state!;
  expect(st.bills).toEqual([]);
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
  await next();
  await noBills();
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

test("connect your bank: opens Monzo, then the balance comes from the bank and syncs when setup ends", async () => {
  await show();
  await fireEvent.press(screen.getByRole("button", {name: "Connect your bank"}));
  expect(router.push).toHaveBeenCalledWith("/connect-bank?from=setup");
  await act(() => useMoney.getState().setSetupBank(842.1));
  expect(screen.getByLabelText("Your balance, from Monzo")).toHaveDisplayValue("842.10");
  expect(screen.getByText("Your Monzo account and all its pots, just now.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", {name: "Connect your bank"})).toBeNull();
  await next();
  await fireEvent.press(screen.getByRole("button", {name: "I'm not paid regularly"}));
  expect(useMoney.getState().state!.balance).toBe(842.1);
  expect(useMoney.getState().setupBank).toBeNull();
  expect(syncNow).toHaveBeenCalled();
});

test("a bank connected in setup fills in your last pay, and says where it came from", async () => {
  await show();
  await act(() => useMoney.getState().setSetupBank(842.1, found({pay: {amount: 2140, from: "ACME LTD", date: "2026-09-30"}})));
  await next();
  expect(screen.getByLabelText("Your pay a month, after tax")).toHaveDisplayValue("2140.00");
  expect(screen.getByText("Your last pay from ACME LTD, Wed 30 Sep.")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Continue"})).toBeEnabled();
  await fireEvent.changeText(screen.getByLabelText("Your pay a month, after tax"), "2000");
  expect(screen.queryByText(/Your last pay from/)).toBeNull();
  await next();
  await next();
  await noBills();
  expect(useMoney.getState().state!.incomes[0].amount).toBe(2000);
  // you changed it and it doesn't repeat, so it may not be your pay: nobody is remembered as paying you
  expect(useMoney.getState().state!.incomes[0].payer).toBeUndefined();
  expect(useMoney.getState().setupFound).toBeNull();
});

test("a bank connected in setup fills in payday too, saying why, and remembers who pays you", async () => {
  await show();
  await act(() => useMoney.getState().setSetupBank(842.1, found({
    pay: {amount: 2140, from: "ACME LTD", date: "2026-09-30"},
    rule: {freq: "monthly-date", day: 25, date: "2026-10-25", n: 3},
  })));
  await next();
  await next();
  expect(screen.getByRole("button", {name: "Monthly on a date"})).toBeSelected();
  expect(screen.getByText("Your last 3 pays came on the 25th.")).toBeOnTheScreen();
  await next();
  await noBills();
  expect(useMoney.getState().state!.incomes[0]).toMatchObject({amount: 2140, freq: "monthly-date", day: 25, payer: "ACME LTD"});
});

test("a bank that found nothing leaves every page as it was", async () => {
  await show();
  await act(() => useMoney.getState().setSetupBank(842.1, found()));
  await next();
  await fireEvent.changeText(screen.getByLabelText("Your pay a month, after tax"), "1800");
  await next();
  expect(screen.getByRole("button", {name: "Monthly, last working day"})).toBeSelected();
  expect(screen.queryByText(/Your last \d pays/)).toBeNull();
  await next();
  await noBills();
  expect(useMoney.getState().state!.incomes[0]).toMatchObject({amount: 1800, freq: "monthly-lastworking"});
  expect(useMoney.getState().state!.incomes[0].payer).toBeUndefined();
});

test("fixed bills: tap the ones you pay, and Continue waits for one", async () => {
  await toBills();
  expect(screen.getByText("Fixed bills")).toBeOnTheScreen();
  expect(screen.getByText("Which of these do you pay regularly?")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Continue"})).toBeDisabled();
  await tap("Council tax");
  expect(screen.getByRole("button", {name: "Council tax"})).toBeSelected();
  expect(screen.getByRole("button", {name: "Gas"})).not.toBeSelected();
  expect(screen.getByRole("button", {name: "Continue"})).toBeEnabled();
  await tap("Council tax");
  expect(screen.getByRole("button", {name: "Council tax"})).not.toBeSelected();
  expect(screen.getByRole("button", {name: "Continue"})).toBeDisabled();
});

test("fixed bills: add one of your own, and it joins the list picked", async () => {
  await toBills();
  await tap("Add more");
  expect(screen.getByText("What else do you pay regularly?")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Add"})).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("What else you pay regularly"), "  Pet insurance ");
  await tap("Add");
  expect(screen.getByText("Fixed bills")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Pet insurance"})).toBeSelected();
  // tap it again and it stays, unpicked
  await tap("Pet insurance");
  expect(screen.getByRole("button", {name: "Pet insurance"})).not.toBeSelected();
});

test("fixed bills: typing a usual one picks it rather than adding it twice, and back adds nothing", async () => {
  await toBills();
  await tap("Add more");
  await fireEvent.changeText(screen.getByLabelText("What else you pay regularly"), "council tax");
  await fireEvent(screen.getByLabelText("What else you pay regularly"), "submitEditing");
  expect(screen.getAllByRole("button", {name: /council tax/i})).toHaveLength(1);
  expect(screen.getByRole("button", {name: "Council tax"})).toBeSelected();
  await tap("Add more");
  await fireEvent.changeText(screen.getByLabelText("What else you pay regularly"), "Spotify");
  await tap("Back");
  expect(screen.getByText("Fixed bills")).toBeOnTheScreen();
  expect(screen.queryByRole("button", {name: "Spotify"})).toBeNull();
});

test("fixed bills: back to payday and forward again keeps your picks", async () => {
  await toBills();
  await tap("Rent / mortgage");
  await tap("Back");
  expect(screen.getByText("When are you paid?")).toBeOnTheScreen();
  await next();
  expect(screen.getByRole("button", {name: "Rent / mortgage"})).toBeSelected();
});

// on through Fixed bills to Your bills, with these picked
const toAmounts = async (...names: string[]) => {
  await toBills();
  for (const n of names) await tap(n);
  await next();
};
// a swipe down on the sheet: the event reaches the Modal from anything in it
const swipeAway = () => fireEvent(screen.getByRole("button", {name: "Done"}), "requestClose");
const row = (name: string) => screen.getByRole("button", {name: new RegExp(`^${name.replace(/[/]/g, "\\/")}`)});

test("your bills: only the ones you picked, home first, each asking how much", async () => {
  await toAmounts("Phone", "Rent / mortgage");
  expect(screen.getByText("Your bills")).toBeOnTheScreen();
  expect(screen.getByText("How much do you pay?")).toBeOnTheScreen();
  expect(screen.getByLabelText("Step 5 of 8")).toBeOnTheScreen();
  expect(screen.getAllByText(/^(Rent \/ mortgage|Phone|Council tax)$/).map(t => t.props.children)).toEqual(["Rent / mortgage", "Phone"]);
  expect(screen.getAllByText("Add amount")).toHaveLength(2);
  expect(screen.getByText("Total each month")).toBeOnTheScreen();
  expect(screen.getByText("£0")).toBeOnTheScreen();
});

test("tap a bill: the amount first, then when it goes out, and the row fills itself in", async () => {
  await toAmounts("Rent / mortgage");
  await fireEvent.press(row("Rent / mortgage"));
  const amount = screen.getByLabelText("How much Rent / mortgage is");
  expect(amount).toHaveProp("autoFocus", true);
  await fireEvent.changeText(amount, "750");
  // the first Done asks for the payment date
  await tap("Done");
  await fireEvent.press(screen.getByRole("radio", {name: "1st"}));
  expect(screen.getByRole("button", {name: "Payment date, 1st of every month"})).toBeOnTheScreen();
  await tap("Done");
  expect(screen.queryByRole("button", {name: "Done"})).toBeNull();
  expect(screen.getByText("1st · Every month")).toBeOnTheScreen();
  expect(screen.getAllByText("£750")).toHaveLength(2);   // the row and the monthly total
  // every amount is in: Continue lights up in the accent
  expect(screen.getByRole("button", {name: "Continue"})).toHaveStyle({backgroundColor: "#C3EADA"});
  await next();
  // on to everyday next; back returns to your bills
  expect(screen.getByText("What do you spend on regularly?")).toBeOnTheScreen();
  await tap("Back");
  expect(screen.getByText("Your bills")).toBeOnTheScreen();
  await next();
  await skipEveryday();
  expect(useMoney.getState().state!.bills).toEqual([{id: expect.any(String), name: "Rent / mortgage", amount: 750, freq: "monthly", day: 1, from: {kind: "main"}}]);
});

test("a yearly bill keeps its own amount, counts a month's share, and its date can wait", async () => {
  await toAmounts("Council tax");
  await fireEvent.press(row("Council tax"));
  await fireEvent.changeText(screen.getByLabelText("How much Council tax is"), "720");
  await tap("Frequency, Every month");
  await tap("Every year");
  expect(screen.getByText("every year, so £60 a month")).toBeOnTheScreen();
  await tap("Done");
  await tap("I'll add this later");
  expect(screen.getByRole("button", {name: "Payment date, Later"})).toBeOnTheScreen();
  await tap("Done");
  expect(screen.getByText("Every year")).toBeOnTheScreen();
  expect(screen.getByText("£720")).toBeOnTheScreen();
  expect(screen.getByText("£60")).toBeOnTheScreen();
  expect(screen.getByText("Bills that aren't monthly count as a month's share.")).toBeOnTheScreen();
  await next();
  await skipEveryday();
  const [bill] = useMoney.getState().state!.bills;
  expect(bill).toMatchObject({name: "Council tax", amount: 720, freq: "yearly"});
  expect(bill.date).toBeUndefined();
});

test("swiping a sheet away keeps what you typed", async () => {
  await toAmounts("Rent / mortgage", "Phone");
  await fireEvent.press(row("Phone"));
  await fireEvent.changeText(screen.getByLabelText("How much Phone is"), "35");
  await swipeAway();
  expect(screen.getByText("Every month")).toBeOnTheScreen();
  await fireEvent.press(row("Rent / mortgage"));
  await fireEvent.changeText(screen.getByLabelText("How much Rent / mortgage is"), "750");
  await swipeAway();
  expect(screen.getByText("£785")).toBeOnTheScreen();
});

test("an amount you don't know yet can stay blank (or 0): Done and Continue still work, and it's saved without one", async () => {
  await toAmounts("Rent / mortgage", "Gym");
  expect(screen.getByRole("button", {name: "Continue"})).toBeEnabled();
  expect(screen.getByRole("button", {name: "Continue"})).toHaveStyle({backgroundColor: "#FFFFFF"});   // ink until every amount is in
  await fireEvent.press(row("Gym"));
  await fireEvent.changeText(screen.getByLabelText("How much Gym is"), "0");
  // no amount: Done closes straight away, without asking for the date
  await tap("Done");
  expect(screen.queryByRole("button", {name: "Done"})).toBeNull();
  expect(screen.getAllByText("Add amount")).toHaveLength(2);
  await next();
  await skipEveryday();
  expect(useMoney.getState().state!.bills.map(b => `${b.name} ${b.amount}`)).toEqual(["Rent / mortgage 0", "Gym 0"]);
});

test("subscriptions: tap the ones you have at their usual price, add your own, and the total is the bill", async () => {
  await toAmounts("Subscriptions");
  await fireEvent.press(row("Subscriptions"));
  // the sheet's total, and the page behind it keeping up
  const shows = (total: string) => expect(screen.getAllByText(total).length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText("Tap the ones you have.")).toBeOnTheScreen();
  expect(screen.queryByLabelText("How much Subscriptions is")).toBeNull();
  await tap("Netflix");
  await tap("Spotify");
  expect(screen.getByLabelText("Netflix a month")).toHaveDisplayValue("13.99");
  shows("£26.98");
  expect(screen.getByText("Usual UK prices. Change any that's different.")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Spotify a month"), "11.99");
  shows("£25.98");
  // one of your own joins the list picked, its amount blank
  await tap("Add more");
  await fireEvent.changeText(screen.getByLabelText("Another subscription"), " Audible ");
  await fireEvent(screen.getByLabelText("Another subscription"), "submitEditing");
  expect(screen.getByRole("button", {name: "Audible"})).toBeSelected();
  expect(screen.getByLabelText("Audible a month")).toHaveDisplayValue("");
  await fireEvent.changeText(screen.getByLabelText("Audible a month"), "7.99");
  shows("£33.97");
  // a usual one typed out is just picked, not added twice; tap one again to take it off
  await tap("Add more");
  await fireEvent.changeText(screen.getByLabelText("Another subscription"), "disney+");
  await fireEvent(screen.getByLabelText("Another subscription"), "submitEditing");
  expect(screen.getAllByRole("button", {name: /^disney\+$/i})).toHaveLength(1);
  expect(screen.getByLabelText("Disney+ a month")).toHaveDisplayValue("9.99");
  await tap("Netflix");
  expect(screen.queryByLabelText("Netflix a month")).toBeNull();
  shows("£29.97");
  await tap("Done");
  expect(screen.getByText("Spotify, Disney+, Audible")).toBeOnTheScreen();
  expect(screen.getAllByText("£29.97")).toHaveLength(2);   // the row and the monthly total
  await next();
  await skipEveryday();
  const [bill] = useMoney.getState().state!.bills;
  expect(bill).toMatchObject({name: "Subscriptions", amount: 29.97, freq: "monthly"});
  expect(bill.day).toBeUndefined();
});

test("back, unpick and pick again: the figures stay, and an unpicked bill leaves the total", async () => {
  await toAmounts("Rent / mortgage", "Phone");
  await fireEvent.press(row("Phone"));
  await fireEvent.changeText(screen.getByLabelText("How much Phone is"), "35");
  await swipeAway();
  await tap("Back");
  await tap("Phone");
  await next();
  expect(screen.queryByText("Phone")).toBeNull();
  expect(screen.getByText("£0")).toBeOnTheScreen();
  await tap("Back");
  await tap("Phone");
  await next();
  expect(screen.getAllByText("£35")).toHaveLength(2);
});

// on past bills (none) to the everyday page
const toEveryday = async () => { await toBills(); await tap("I don't have any bills"); };
// on to "What do you normally spend?", with these picked
const toUsual = async (...names: string[]) => { await toEveryday(); for (const n of names) await tap(n); await next(); };
// fill one in on its sheet: how much, and how often if it isn't its usual
const estimate = async (name: string, amount: string, often?: string) => {
  await fireEvent.press(row(name));
  await fireEvent.changeText(screen.getByLabelText(`How much you usually spend on ${name}`), amount);
  if (often) await tap(often);
  await tap("Done");
};

test("everyday: pick what you spend on, Continue waits for one, and no amounts are asked yet", async () => {
  await toEveryday();
  expect(screen.getByText("What do you spend on regularly?")).toBeOnTheScreen();
  expect(screen.getByText("Pick anything that applies. We'll help you work out the rest.")).toBeOnTheScreen();
  expect(screen.getByLabelText("Step 6 of 8")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Continue"})).toBeDisabled();
  await tap("Groceries");
  expect(screen.getByRole("button", {name: "Groceries"})).toBeSelected();
  expect(screen.getByRole("button", {name: "Fuel"})).not.toBeSelected();
  expect(screen.queryByLabelText(/How much/)).toBeNull();
  expect(screen.getByRole("button", {name: "Continue"})).toBeEnabled();
  // with no bills, back goes to the bills you can pick
  await tap("Back");
  expect(screen.getByText("Fixed bills")).toBeOnTheScreen();
});

test("everyday: Skip for now ends setup with the starting categories, nothing set aside", async () => {
  await toEveryday();
  await tap("Groceries");
  await skipEveryday();
  expect(useMoney.getState().state!.categories).toEqual(DEFAULT_CATEGORIES);
});

test("everyday: add one of your own, and typing a usual one picks it rather than adding it twice", async () => {
  await toEveryday();
  await tap("Add more");
  expect(screen.getByText("What else do you spend on?")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Add"})).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText("What else you spend on"), " Pets ");
  await tap("Add");
  expect(screen.getByText("What do you spend on regularly?")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Pets"})).toBeSelected();
  await tap("Add more");
  await fireEvent.changeText(screen.getByLabelText("What else you spend on"), "coffee & drinks");
  await fireEvent(screen.getByLabelText("What else you spend on"), "submitEditing");
  expect(screen.getAllByRole("button", {name: /coffee & drinks/i})).toHaveLength(1);
  expect(screen.getByRole("button", {name: "Coffee & drinks"})).toBeSelected();
});

test("what you normally spend: only your picks, in the list's order, and nothing is required", async () => {
  await toUsual("Eating out", "Groceries");   // tapped out of order
  expect(screen.getByText("What do you normally spend?")).toBeOnTheScreen();
  expect(screen.getByText("An estimate is fine. We'll turn it into a realistic budget.")).toBeOnTheScreen();
  expect(screen.getAllByText(/^(Groceries|Eating out|Transport)$/).map(x => x.props.children)).toEqual(["Groceries", "Eating out"]);
  expect(screen.getAllByText("Add amount")).toHaveLength(2);
  expect(screen.getByRole("button", {name: "Continue"})).toBeEnabled();
  expect(screen.getByRole("button", {name: "Continue"})).toHaveStyle({backgroundColor: "#FFFFFF"});   // ink until every amount is in
});

test("tap one: how much (the number pad opens), how often, and what that comes to a month", async () => {
  await toUsual("Groceries", "Eating out");
  await fireEvent.press(row("Groceries"));
  expect(screen.getByText("How much do you usually spend?")).toBeOnTheScreen();
  expect(screen.getByText("Not sure? An estimate is fine.")).toBeOnTheScreen();
  const amount = screen.getByLabelText("How much you usually spend on Groceries");
  expect(amount).toHaveProp("autoFocus", true);
  expect(screen.getByRole("button", {name: "Every week"})).toBeSelected();   // groceries start at every week
  await fireEvent.changeText(amount, "60");
  expect(screen.getByText("about £260")).toBeOnTheScreen();
  await tap("Done");
  expect(screen.queryByRole("button", {name: "Done"})).toBeNull();
  expect(screen.getByText("Every week")).toBeOnTheScreen();
  expect(screen.getByText("£60")).toBeOnTheScreen();
  // the amount is each time: £15, 2–3 times a week
  await estimate("Eating out", "15", "2–3 times a week");
  expect(screen.getByText("2–3 times a week")).toBeOnTheScreen();
  expect(screen.getByText("£15")).toBeOnTheScreen();
  // every one has an amount: Continue lights up in the accent
  expect(screen.getByRole("button", {name: "Continue"})).toHaveStyle({backgroundColor: "#C3EADA"});
});

test("set your limits: each starts at what you usually spend, change any, and the total follows", async () => {
  await toUsual("Groceries", "Eating out", "Health");
  await estimate("Groceries", "60");
  await estimate("Eating out", "15", "2–3 times a week");
  await next();
  expect(screen.getByText("Set your limits")).toBeOnTheScreen();
  expect(screen.getByText("Based on what you normally spend, choose what you want to allow yourself.")).toBeOnTheScreen();
  expect(screen.getByLabelText("Step 8 of 8")).toBeOnTheScreen();
  expect(screen.getByText("Usually about £260 a month")).toBeOnTheScreen();
  expect(screen.getByText("Usually about £163 a month")).toBeOnTheScreen();
  expect(screen.getByText("No estimate yet")).toBeOnTheScreen();
  expect(screen.getByLabelText("Your Groceries budget a month")).toHaveDisplayValue("260");
  expect(screen.getByLabelText("Your Eating out budget a month")).toHaveDisplayValue("163");
  expect(screen.getByLabelText("Your Health budget a month")).toHaveDisplayValue("");
  expect(screen.getByText("Everyday spending")).toBeOnTheScreen();
  expect(screen.getByText("£423")).toBeOnTheScreen();
  expect(screen.getByText("Each month, about £98 a week.")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Your Eating out budget a month"), "120");
  expect(screen.getByText("£380")).toBeOnTheScreen();
  expect(screen.getByText("Each month, about £88 a week.")).toBeOnTheScreen();
  await next();
  // both are kept: what you usually spend, and what you chose; one with no budget holds nothing back
  const cats = useMoney.getState().state!.categories;
  expect(cats.filter(x => x.group === "everyday")).toEqual([
    {id: "groceries", name: "Groceries", budget: 260, fixed: false, group: "everyday", usual: {amount: 60, freq: "weekly"}},
    {id: "eating", name: "Eating out", budget: 120, fixed: false, group: "everyday", usual: {amount: 15, freq: "few-times"}},
  ]);
  expect(cats.find(x => x.id === "health")).toEqual({id: "health", name: "Health", budget: 0, fixed: false, group: "free"});
});

test("back keeps your estimates, and a budget follows its estimate until you type your own", async () => {
  await toUsual("Groceries", "Transport");
  await estimate("Groceries", "60");
  await next();
  await fireEvent.changeText(screen.getByLabelText("Your Transport budget a month"), "100");
  await tap("Back");
  expect(screen.getByText("£60")).toBeOnTheScreen();
  await estimate("Groceries", "50");
  await next();
  expect(screen.getByLabelText("Your Groceries budget a month")).toHaveDisplayValue("217");   // £50 a week
  expect(screen.getByLabelText("Your Transport budget a month")).toHaveDisplayValue("100");   // yours stays yours
});

test("setup is dark for now, even when the app is set to light", async () => {
  await show();
  await act(() => useMoney.setState({theme: "light"}));
  expect(screen.getByText("How much is in your account right now?")).toHaveStyle({color: "#FFFFFF"});
});

test("Continue lifts by what the keyboard covers, not its height: a hardware keyboard parks the number pad below the screen", () => {
  const h = Dimensions.get("window").height;
  expect(keyboardCover({screenY: h - 336, height: 336})).toBe(336);   // the number pad
  expect(keyboardCover({screenY: h - 55, height: 336})).toBe(55);     // only the small bar shows
  expect(keyboardCover({screenY: h, height: 336})).toBe(0);           // all of it below the screen
});
