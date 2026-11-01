import {act, fireEvent, render, screen} from "@testing-library/react-native";
import {router} from "expo-router";
import {Dimensions} from "react-native";
import {SafeAreaProvider} from "react-native-safe-area-context";
import SetupScreen from "@/app/setup";
import {keyboardCover} from "@/components/Setup";
import {TODAY} from "@/lib/__tests__/fixtures";
import * as banks from "@/lib/banks";
import {withCatalog} from "@/lib/categories";
import {DEFAULT_CATEGORIES} from "@/lib/defaults";
import {syncNow} from "@/components/Bank";
import type {FoundPayee, SetupFound} from "@/lib/found";
import {fetchSetupBank, loggedIn} from "@/services/monzo";
import {useMoney} from "@/store/useMoney";

jest.mock("expo-router", () => ({router: {push: jest.fn(), back: jest.fn()}}));
jest.mock("expo-sqlite/kv-store", () => ({__esModule: true, default: {getItemSync: () => null, setItemSync: () => {}, removeItemSync: () => true}}));
jest.mock("@/components/Bank", () => ({syncNow: jest.fn()}));
// no Monzo login saved on this phone, unless a test says so
jest.mock("@/services/monzo", () => ({...jest.requireActual("@/services/monzo"), loggedIn: jest.fn(async () => false), fetchSetupBank: jest.fn()}));
jest.mock("@/db/transactions", () => ({listSince: jest.fn(async () => []), insertTx: jest.fn(async () => {}), deleteTx: jest.fn(async () => {})}));

const show = async () => {
  useMoney.setState({state: null, txs: [], today: TODAY, loaded: true, setupBank: null, setupFound: null});
  const metrics = {frame: {x: 0, y: 0, width: 390, height: 844}, insets: {top: 47, left: 0, right: 0, bottom: 34}};
  return render(<SafeAreaProvider initialMetrics={metrics}><SetupScreen /></SafeAreaProvider>);
};
const next = (name = "Continue") => fireEvent.press(screen.getByRole("button", {name}));
const tap = (name: string) => fireEvent.press(screen.getByRole("button", {name}));
const skipEveryday = () => tap("Skip for now");
// no bank, no bills, and no everyday amounts: setup ends (with a bank connected, the page offering one isn't there)
const noBills = async () => {
  if (screen.queryByRole("button", {name: "I'll enter them myself"})) await tap("I'll enter them myself");
  await tap("I don't have any bills");
  await skipEveryday();
};
// through balance, pay and payday to the page offering a bank
const toBank = async () => {
  await show();
  await fireEvent.changeText(screen.getByLabelText("Your balance"), "1250.50");
  await next();
  await fireEvent.changeText(screen.getByLabelText("Your pay a month, after tax"), "1800");
  await next();
  await next();
};
// and on to the bills page, entering them yourself
const toBills = async () => { await toBank(); await tap("I'll enter them myself"); };
// what Monzo might say, with nothing found unless a test adds it
const found = (over: Partial<SetupFound> = {}): SetupFound => ({pays: [], bills: [], spending: [], payees: [], ...over});
const acme = {amount: 2000, from: "ACME LTD", date: "2026-10-02", rule: {freq: "fourweekly" as const, date: "2026-10-30", n: 3}};
const bar = {amount: 310, from: "THE BAR CO", date: "2026-10-02", rule: null};

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

test("a bank connected in setup asks if the pay it found is yours: yes, and it's what lands each payday, from them", async () => {
  await show();
  await act(() => useMoney.getState().setSetupBank(842.1, found({pays: [acme]})));
  await next();
  expect(screen.getByText("We found a regular payment")).toBeOnTheScreen();
  expect(screen.getByText("Is this your income?")).toBeOnTheScreen();
  expect(screen.getByLabelText("Your pay, from your bank")).toHaveDisplayValue("2000.00");
  expect(screen.getByText("From ACME LTD. Every 4 weeks.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", {name: "Choose another"})).toBeNull();   // nobody else pays you like pay
  await tap("Yes, that's right");
  // payday comes from the same pays, saying why
  expect(screen.getByRole("button", {name: "Every 4 weeks"})).toBeSelected();
  expect(screen.getByText("Your last 3 pays came 4 weeks apart.")).toBeOnTheScreen();
  expect(screen.getByText("£2,000")).toBeOnTheScreen();
  await next();
  await noBills();
  // 4-weekly pay is what lands each time, not a month's pay spread over 13
  expect(useMoney.getState().state!.incomes[0]).toMatchObject({amount: 2000, freq: "fourweekly", date: "2026-10-30", payer: "ACME LTD"});
  expect(useMoney.getState().setupFound).toBeNull();
});

test("I'll enter it myself: the pay page as before, blank, and nobody is remembered as paying you", async () => {
  await show();
  await act(() => useMoney.getState().setSetupBank(842.1, found({pays: [acme]})));
  await next();
  await tap("I'll enter it myself");
  expect(screen.getByLabelText("Your pay a month, after tax")).toHaveDisplayValue("");
  // back shows what the bank found again
  await tap("Back");
  expect(screen.getByText("We found a regular payment")).toBeOnTheScreen();
  await tap("I'll enter it myself");
  await fireEvent.changeText(screen.getByLabelText("Your pay a month, after tax"), "1800");
  await next();
  expect(screen.getByRole("button", {name: "Monthly, last working day"})).toBeSelected();
  expect(screen.queryByText(/Your last \d pays/)).toBeNull();
  await next();
  await noBills();
  expect(useMoney.getState().state!.incomes[0]).toMatchObject({amount: 1800, freq: "monthly-lastworking"});
  expect(useMoney.getState().state!.incomes[0].payer).toBeUndefined();
});

test("choose another: everyone who pays you like pay, and the one you tap is the one asked about", async () => {
  await show();
  await act(() => useMoney.getState().setSetupBank(842.1, found({pays: [acme, bar]})));
  await next();
  await tap("Choose another");
  expect(screen.getByText("Which one is your pay?")).toBeOnTheScreen();
  expect(screen.getByText("Every 4 weeks")).toBeOnTheScreen();
  expect(screen.getByText("Last paid Fri 2 Oct")).toBeOnTheScreen();   // how often isn't clear
  await fireEvent.press(row("THE BAR CO"));
  expect(screen.getByText("We found a payment")).toBeOnTheScreen();
  expect(screen.getByLabelText("Your pay, from your bank")).toHaveDisplayValue("310.00");
  await tap("Yes, that's right");
  expect(screen.getByRole("button", {name: "Monthly, last working day"})).toBeSelected();   // nothing to fill payday in from
  await next();
  await noBills();
  expect(useMoney.getState().state!.incomes[0]).toMatchObject({amount: 310, payer: "THE BAR CO"});
});

test("none of these: the pay page, blank", async () => {
  await show();
  await act(() => useMoney.getState().setSetupBank(842.1, found({pays: [acme, bar]})));
  await next();
  await tap("Choose another");
  await tap("None of these");
  expect(screen.getByText("How much are you paid?")).toBeOnTheScreen();
  expect(screen.getByLabelText("Your pay a month, after tax")).toHaveDisplayValue("");
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

test("no bank yet: before the bills, a shortcut to connect one, never a demand", async () => {
  await toBank();
  expect(screen.getByText("Want us to do the boring part?")).toBeOnTheScreen();
  expect(screen.getByText("Connect your bank and we'll find your regular payments and spending for you.")).toBeOnTheScreen();
  expect(screen.getByText("We'll never move money without your permission.")).toBeOnTheScreen();
  expect(screen.getByLabelText("Step 4 of 8")).toBeOnTheScreen();
  await tap("Connect bank");
  expect(router.push).toHaveBeenCalledWith("/connect-bank?from=setup");
  await tap("I'll enter them myself");
  expect(screen.getByText("Fixed bills")).toBeOnTheScreen();
});

test("the tester build has no banks: setup never offers one, and goes straight to the bills", async () => {
  const off = jest.replaceProperty(banks, "banksOn", false);
  try {
    await show();
    expect(screen.queryByRole("button", {name: "Connect your bank"})).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Your balance"), "1250.50");
    await next();
    await fireEvent.changeText(screen.getByLabelText("Your pay a month, after tax"), "1800");
    await next();
    await next();
    expect(screen.queryByText("Want us to do the boring part?")).toBeNull();
    expect(screen.getByText("Fixed bills")).toBeOnTheScreen();
  } finally { off.restore(); }
});

// what Monzo might find going out
const water = {name: "Thames Water", payee: "Thames Water", amount: 55, varies: false, freq: "monthly" as const, day: 1, method: "dd" as const, n: 3};
const energy = {name: "Octopus Energy", payee: "OCTOPUS ENERGY", amount: 46, varies: true, freq: "monthly" as const, day: 15, method: "dd" as const, n: 3};
const gym = {name: "PureGym", payee: "PureGym", amount: 12.5, varies: false, freq: "fortnightly" as const, date: "2026-10-16", method: "dd" as const, n: 5};

test("connected just before the bills: the bank's balance, and the regular payments it found, ready to check", async () => {
  await toBank();
  await tap("Connect bank");
  await act(() => useMoney.getState().setSetupBank(842.1, found({bills: [water, energy, gym]})));
  expect(screen.getByText("We found some regular payments")).toBeOnTheScreen();
  expect(screen.getByText("From your last 3 months. Tap one to change it.")).toBeOnTheScreen();
  expect(screen.getByText("1st · Every month")).toBeOnTheScreen();
  expect(screen.getByText("15th · Every month · varies")).toBeOnTheScreen();
  expect(screen.getByText("Fri 16 Oct · Every 2 weeks")).toBeOnTheScreen();
  // each one opens on its sheet, as you'd filled it in; one that isn't a bill comes out
  await fireEvent.press(row("Octopus Energy"));
  expect(screen.getByLabelText("How much Octopus Energy is")).toHaveDisplayValue("46");
  await tap("Remove");
  expect(screen.queryByText("Octopus Energy")).toBeNull();
  // something missing: the usual list, with the ones found already picked
  await tap("+ Add a bill");
  expect(screen.getByText("Fixed bills")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Thames Water"})).toBeSelected();
  expect(screen.getByRole("button", {name: "Octopus Energy"})).not.toBeSelected();
  await tap("Council tax");
  await next();
  expect(screen.getAllByText(/^(Council tax|Thames Water|PureGym)$/).map(t => t.props.children)).toEqual(["Council tax", "Thames Water", "PureGym"]);
  expect(screen.getByText("Add amount")).toBeOnTheScreen();
  // back goes to payday, which comes straight back here
  await tap("Back");
  expect(screen.getByText("When are you paid?")).toBeOnTheScreen();
  await next();
  expect(screen.getByText("We found some regular payments")).toBeOnTheScreen();
  await next();
  await skipEveryday();
  const st = useMoney.getState().state!;
  expect(st.balance).toBe(842.1);   // the bank's, not the one typed
  expect(st.incomes[0].payer).toBeUndefined();   // pay was typed, so it isn't tied to anyone
  expect(st.bills).toEqual([
    {id: expect.any(String), name: "Council tax", amount: 0, freq: "monthly", from: {kind: "main"}},
    {id: expect.any(String), name: "Thames Water", amount: 55, freq: "monthly", day: 1, method: "dd", source: "bank", payee: "Thames Water", from: {kind: "main"}},
    {id: expect.any(String), name: "PureGym", amount: 12.5, freq: "fortnightly", date: "2026-10-16", method: "dd", source: "bank", payee: "PureGym", from: {kind: "main"}},
  ]);
  expect(syncNow).toHaveBeenCalled();
});

test("what you usually spend, from the bank: a week's worth to check, then your limits, then what it all comes to", async () => {
  await show();
  await act(() => useMoney.getState().setSetupBank(842.1, found({
    pays: [acme], bills: [water],
    spending: [{name: "Groceries", monthly: 272, n: 12}, {name: "Eating out", monthly: 104, n: 9}, {name: "Shopping", monthly: 60, n: 3}],
  })));
  await next();
  await tap("Yes, that's right");
  await next();
  expect(screen.getByText("We found some regular payments")).toBeOnTheScreen();
  await next();
  // straight to what was found: no list to pick from first
  expect(screen.getByText("Here's what we found")).toBeOnTheScreen();
  expect(screen.getByText("Based on your recent spending. These are estimates: tap one to change it.")).toBeOnTheScreen();
  expect(screen.getByText("£63")).toBeOnTheScreen();   // £272 a month is about £63 a week
  expect(screen.getAllByText("Every week")).toHaveLength(3);
  await fireEvent.press(row("Shopping"));
  await tap("Remove");
  expect(screen.queryByText("Shopping")).toBeNull();
  // something it didn't see
  await tap("+ Add more");
  expect(screen.getByRole("button", {name: "Groceries"})).toBeSelected();
  await tap("Coffee & drinks");
  await next();
  await estimate("Coffee & drinks", "4", "4–6 times a week");
  await next();
  // what you usually spend sits beside the budget, which starts there and is yours to change
  expect(screen.getByText("Usually about £273 a month")).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Your Eating out budget a month"), "80");
  await next();
  expect(screen.getByText("We've done the boring part.")).toBeOnTheScreen();
  expect(screen.getByText("Thames Water")).toBeOnTheScreen();
  expect(screen.getByText("£55")).toBeOnTheScreen();
  expect(screen.getByText("Groceries, Eating out, Coffee & drinks")).toBeOnTheScreen();
  expect(screen.getByText("£440")).toBeOnTheScreen();   // £273 + £80 + £87
  // tap one to go back to it
  await fireEvent.press(row("Everyday spending"));
  expect(screen.getByText("Set your limits")).toBeOnTheScreen();
  await next();
  await next();
  const st = useMoney.getState().state!;
  expect(st.bills).toHaveLength(1);
  expect(st.categories.filter(x => x.group === "everyday")).toEqual([
    {id: "groceries", name: "Groceries", budget: 273, fixed: false, group: "everyday", usual: {amount: 63, freq: "weekly", source: "bank"}},
    {id: "eating", name: "Eating out", budget: 80, fixed: false, group: "everyday", usual: {amount: 24, freq: "weekly", source: "bank"}},
    {id: "coffee", name: "Coffee & drinks", budget: 87, fixed: false, group: "everyday", usual: {amount: 4, freq: "most-days"}},
  ]);
});

const payee = (name: string, amount: number, n: number, last: string, over: Partial<FoundPayee> = {}): FoundPayee =>
  ({name, payee: name.toUpperCase(), amount, varies: false, freq: "monthly", day: +last.slice(8), method: "card", n, last, ...over});

test("pick from your payments: everyone you've paid, tick the bills, and they join the list filled in from what they've been", async () => {
  await toBank();
  await tap("Connect bank");
  await act(() => useMoney.getState().setSetupBank(842.1, found({bills: [water], payees: [
    payee("Thames Water", 55, 3, "2026-10-01", {method: "dd"}), payee("Netflix", 10.99, 3, "2026-10-03"), payee("Sam Lee", 60, 1, "2026-09-20", {method: "transfer"}),
  ]})));
  await tap("Pick from your payments");
  expect(screen.getByText("Pick from your payments")).toBeOnTheScreen();
  expect(screen.getByText("Paid more than once")).toBeOnTheScreen();
  expect(screen.getByText("Paid once")).toBeOnTheScreen();
  expect(screen.getByText("3 payments, the last on Sat 3 Oct")).toBeOnTheScreen();
  expect(screen.getByText("Paid Sun 20 Sep")).toBeOnTheScreen();
  // one already found is ticked and can't be added twice
  expect(screen.getByText("Already in your bills")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Add bills"})).toBeDisabled();
  await fireEvent.press(row("Netflix"));
  await fireEvent.press(row("Sam Lee"));
  expect(row("Netflix")).toBeSelected();
  await fireEvent.press(row("Sam Lee"));   // changed your mind
  expect(row("Sam Lee")).not.toBeSelected();
  await tap("Add 1 bill");
  expect(screen.getByText("We found some regular payments")).toBeOnTheScreen();
  expect(row("Netflix")).toBeOnTheScreen();
  await next();
  await skipEveryday();
  expect(useMoney.getState().state!.bills.map(b => b.name)).toEqual(["Thames Water", "Netflix"]);
  expect(useMoney.getState().state!.bills[1]).toMatchObject({amount: 10.99, freq: "monthly", day: 3, method: "card", source: "bank", payee: "NETFLIX"});
});

test("pick from your payments: with no regular ones found, it's on the usual list's page too, and search narrows a long list", async () => {
  await show();
  const many = Array.from({length: 9}, (_, i) => payee(`Shop ${i + 1}`, 5, 1, "2026-09-10"));
  await act(() => useMoney.getState().setSetupBank(842.1, found({payees: [payee("Council Tax", 160, 2, "2026-10-01"), ...many]})));
  await next();
  await fireEvent.changeText(screen.getByLabelText("Your pay a month, after tax"), "1800");
  await next();
  await next();
  expect(screen.getByText("Fixed bills")).toBeOnTheScreen();
  await tap("Pick from your payments");
  await fireEvent.changeText(screen.getByLabelText("Search your payments"), "council");
  expect(screen.queryByText("Shop 1")).toBeNull();
  await fireEvent.press(row("Council Tax"));
  await tap("Add 1 bill");
  // the usual one, picked rather than added twice, with what's been paid
  expect(screen.getByText("Council tax")).toBeOnTheScreen();
  expect(screen.queryByText("Council Tax")).toBeNull();
  expect(screen.getAllByText("£160")).toHaveLength(2);   // its row, and the total each month
});

test("Start over keeps your Monzo login: setup reads from it straight away", async () => {
  jest.mocked(loggedIn).mockResolvedValueOnce(true);
  jest.mocked(fetchSetupBank).mockResolvedValueOnce({totalPence: 84210, found: found()});
  await show();
  expect(await screen.findByLabelText("Your balance, from Monzo")).toHaveDisplayValue("842.10");
  expect(screen.queryByRole("button", {name: "Connect your bank"})).toBeNull();
});

test("a bank that found no bills: the usual list, and no review at the end", async () => {
  await show();
  await act(() => useMoney.getState().setSetupBank(842.1, found()));
  await next();
  await fireEvent.changeText(screen.getByLabelText("Your pay a month, after tax"), "1800");
  await next();
  await next();
  expect(screen.getByText("Fixed bills")).toBeOnTheScreen();
  expect(screen.getByText("Which of these do you pay regularly?")).toBeOnTheScreen();
  await tap("I don't have any bills");
  await tap("Groceries");
  await next();
  await next();
  expect(screen.getByText("Set your limits")).toBeOnTheScreen();
  await next();
  expect(screen.queryByText("We've done the boring part.")).toBeNull();
  expect(useMoney.getState().state).not.toBeNull();
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
  expect(screen.getByRole("button", {name: "Continue"})).toHaveStyle({backgroundColor: "#FABD54"});
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
  expect(screen.getByRole("button", {name: "Continue"})).toHaveStyle({backgroundColor: "#ECEDEF"});   // ink until every amount is in
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
  expect(useMoney.getState().state!.categories).toEqual(withCatalog(DEFAULT_CATEGORIES));
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
  expect(screen.getByRole("button", {name: "Continue"})).toHaveStyle({backgroundColor: "#ECEDEF"});   // ink until every amount is in
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
  expect(screen.getByRole("button", {name: "Continue"})).toHaveStyle({backgroundColor: "#FABD54"});
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
  expect(screen.getByText("How much is in your account right now?")).toHaveStyle({color: "#ECEDEF"});
});

test("Continue lifts by what the keyboard covers, not its height: a hardware keyboard parks the number pad below the screen", () => {
  const h = Dimensions.get("window").height;
  expect(keyboardCover({screenY: h - 336, height: 336})).toBe(336);   // the number pad
  expect(keyboardCover({screenY: h - 55, height: 336})).toBe(55);     // only the small bar shows
  expect(keyboardCover({screenY: h, height: 336})).toBe(0);           // all of it below the screen
});
