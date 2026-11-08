import {act, fireEvent, render, screen, waitFor} from "@testing-library/react-native";
import {SafeAreaProvider} from "react-native-safe-area-context";
import {CategoryPick} from "@/components/CategoryPick";
import {CategorySheet} from "@/components/CategorySheet";
import {OrgCard} from "@/components/OrgCard";
import {updateFiling} from "@/db/transactions";
import {baseState, TODAY, tx} from "@/lib/__tests__/fixtures";
import type {OrgExample, OrgReport} from "@/lib/organise";
import type {Ctx} from "@/lib/types";
import {useMoney} from "@/store/useMoney";

jest.mock("expo-router", () => ({router: {push: jest.fn(), back: jest.fn()}, useLocalSearchParams: () => ({})}));
jest.mock("expo-sqlite/kv-store", () => ({__esModule: true, default: {getItemSync: () => null, setItemSync: () => {}, removeItemSync: () => true}}));
jest.mock("@/db/transactions", () => ({listSince: jest.fn(async () => []), insertTx: jest.fn(async () => {}), deleteTx: jest.fn(async () => {}), updateFiling: jest.fn(async () => {})}));

const metrics = {frame: {x: 0, y: 0, width: 390, height: 844}, insets: {top: 0, left: 0, right: 0, bottom: 0}};

// three sorted payments: two groceries, one eating out (the Costa one a guess worth a check)
const txs = [
  tx({id: "a", amount: 14.2, date: TODAY, note: "Tesco", cat: "groceries"}),
  tx({id: "b", amount: 3.5, date: "2026-10-04", note: "Costa", cat: "eating"}),
  tx({id: "c", amount: 30, date: "2026-10-03", note: "Aldi", cat: "groceries"}),
];
const report: OrgReport = {
  runId: "r1", at: 0, reviewed: 3, auto: 2, provisional: 1, left: 0, more: 0, failed: 0, byCat: [],
  check: [{txId: "b", note: "Costa", date: "2026-10-04", amount: 3.5, to: "Eating out", why: "Name matches"}],
  unclear: [], rows: ["a", "b", "c"],
};
const noProposal = {preview: {runId: "r1", high: 2, medium: 1, low: 0, total: 3, more: 0, examples: []}};

const props = () => ({
  who: "frank" as const, color: "#000", box: "#fff", edge: "#ddd",
  onConfirm: jest.fn(), onCancel: jest.fn(), onUndo: jest.fn(), onEdit: jest.fn(), onEditGroup: jest.fn(),
});
const card = (ctx: Ctx, onEdit = jest.fn(), status: "done" | "undone" = "done", rep = report) => (
  <OrgCard {...props()} proposal={noProposal} status={status} report={rep} ctx={ctx} onEdit={onEdit} />
);
const ctxOf = (list = txs): Ctx => ({state: baseState(), txs: list, today: TODAY});

describe("the done card", () => {
  test("says what was found, the three counts, and his line", async () => {
    await render(card(ctxOf()));
    expect(screen.getByText("Smart Sort")).toBeOnTheScreen();
    expect(screen.getByText("FRANK'S ORGANISATION")).toBeOnTheScreen();
    expect(screen.getByText("Organised")).toBeOnTheScreen();
    expect(screen.getByLabelText(/^Frank found 3 items\./)).toBeOnTheScreen();
    expect(screen.getByLabelText("2 Auto-sorted")).toBeOnTheScreen();
    expect(screen.getByLabelText("1 Needs review")).toBeOnTheScreen();
    expect(screen.getByLabelText("0 Can't place")).toBeOnTheScreen();
    expect(screen.queryByText("FRANK SAYS")).toBeNull(); // no quote box
  });

  test("leads with a sorted one and the one to review, each as it's filed now", async () => {
    await render(card(ctxOf()));
    expect(screen.getByRole("button", {name: "Tesco, Groceries. Edit"})).toBeOnTheScreen();
    expect(screen.getByRole("button", {name: "Costa, Eating out, to review. Edit"})).toBeOnTheScreen();
  });

  test("every payment is listed, a sorted one with Sorted and a tick on the right, one to check with Review", async () => {
    await render(card(ctxOf()));
    expect(screen.getAllByTestId(/^org-row-/)).toHaveLength(3);
    expect(screen.getAllByLabelText("Sorted")).toHaveLength(2); // Tesco and Aldi; Costa is Review
    expect(screen.getAllByText("Review")).toHaveLength(1);
    // nothing to open first
    expect(screen.queryByText("VIEW ALL")).toBeNull();
    expect(screen.queryByText("Edit")).toBeNull();
  });

  test("a payment moved elsewhere shows under its new category", async () => {
    const moved = txs.map(t => t.id === "b" ? {...t, cat: "groceries"} : t);
    await render(card(ctxOf(moved)));
    expect(screen.getByRole("button", {name: "Costa, Groceries, to review. Edit"})).toBeOnTheScreen();
  });

  test("tapping a payment asks to change it", async () => {
    const onEdit = jest.fn();
    await render(card(ctxOf(), onEdit));
    await fireEvent.press(screen.getByTestId("org-row-b"));
    expect(onEdit).toHaveBeenCalledWith("b");
  });

  describe("with a long list", () => {
    const many = Array.from({length: 25}, (_, i) => tx({id: `m${i}`, amount: 1 + i, date: TODAY, note: `Shop ${i}`, cat: "groceries"}));
    const rep: OrgReport = {...report, reviewed: 25, auto: 24, provisional: 1, rows: many.map(t => t.id),
      check: [{txId: "m3", note: "Shop 3", date: TODAY, amount: 4, to: "Groceries", why: "Name matches"}]};

    test("shows a page of them, and the rest a page at a time", async () => {
      await render(card(ctxOf(many), jest.fn(), "done", rep));
      expect(screen.getAllByTestId(/^org-row-/)).toHaveLength(20);
      await fireEvent.press(screen.getByRole("button", {name: "Show 5 more"}));
      expect(screen.getAllByTestId(/^org-row-/)).toHaveLength(25);
      expect(screen.queryByRole("button", {name: /^Show \d+ more/})).toBeNull();
    });
  });

  test("Undo is there", async () => {
    const p = props();
    await render(<OrgCard {...p} proposal={noProposal} status="done" report={{...report, provisional: 0, check: []}} ctx={ctxOf()} />);
    await fireEvent.press(screen.getByRole("button", {name: "Undo"}));
    expect(p.onUndo).toHaveBeenCalled();
  });

  test("an undone run lists nothing", async () => {
    await render(card(ctxOf(), jest.fn(), "undone"));
    expect(screen.getByText("Undone")).toBeOnTheScreen();
    expect(screen.queryByTestId(/^org-row-/)).toBeNull();
    expect(screen.queryByRole("button", {name: "Undo"})).toBeNull();
  });
});

describe("the preview card", () => {
  const ex = (key: string, note: string, catId: string, cat: string, confidence: "high" | "medium", sub?: string, count = 1): OrgExample =>
    ({key, note, toCatId: catId, toCatName: cat, toSubName: sub, confidence, count});
  const proposal = {preview: {runId: "r2", high: 2, medium: 3, low: 1, total: 6, more: 0, examples: [
    ex("tesco", "Tesco", "groceries", "Groceries", "high", "Supermarket"), ex("aldi", "Aldi", "groceries", "Groceries", "high"),
    ex("netflix", "Netflix", "bills", "Bills", "medium", undefined, 2), ex("amzn", "AMZN MKTP", "shopping", "Shopping", "medium"),
  ]}};
  const preview = (over = {}) => <OrgCard {...props()} proposal={proposal} status="open" ctx={ctxOf()} {...over} />;

  test("shows the counts, what's found and what he says he'll do", async () => {
    await render(preview());
    expect(screen.queryByText("Ready")).toBeNull(); // an open card needs no status
    expect(screen.getByLabelText(/^Frank found 6 items\./)).toBeOnTheScreen();
    expect(screen.getByLabelText("2 Auto-sorted")).toBeOnTheScreen();
    expect(screen.getByLabelText("3 Needs review")).toBeOnTheScreen();
    expect(screen.getByLabelText("1 Can't place")).toBeOnTheScreen();
    expect(screen.queryByText("FRANK SAYS")).toBeNull();
    expect(screen.getByText("Groceries → Supermarket")).toBeOnTheScreen();
  });

  test("Confirm is there from the start, with nothing to open first", async () => {
    const p = props();
    await render(<OrgCard {...p} proposal={proposal} status="open" ctx={ctxOf()} />);
    await fireEvent.press(screen.getByRole("button", {name: "Confirm"}));
    expect(p.onConfirm).toHaveBeenCalled();
  });

  test("every shop is listed, and tapping one says which shop and where it's going", async () => {
    const p = props();
    await render(<OrgCard {...p} proposal={proposal} status="open" ctx={ctxOf()} />);
    expect(screen.getAllByTestId(/^org-group-/)).toHaveLength(4);
    await fireEvent.press(screen.getByRole("button", {name: "Netflix, Bills, to review. Edit"}));
    expect(p.onEditGroup).toHaveBeenCalledWith({key: "netflix", name: "Netflix", cat: "bills", sub: undefined, count: 2});
  });

  test("a shop you've edited shows where you put it, and stops counting as his guess", async () => {
    await render(preview({edits: {netflix: {cat: "groceries"}}}));
    // Netflix had two payments, so Needs review drops by two and Auto-sorted goes up by two
    expect(screen.getByLabelText("4 Auto-sorted")).toBeOnTheScreen();
    expect(screen.getByLabelText("1 Needs review")).toBeOnTheScreen();
    expect(screen.getByRole("button", {name: "Netflix, Groceries. Edit"})).toBeOnTheScreen();
  });

  test("a long list of shops shows a page, and the rest are one tap away", async () => {
    const many = Array.from({length: 27}, (_, i) => ex(`shop${i}`, `Shop ${i}`, "groceries", "Groceries", "high"));
    const big = {preview: {runId: "r3", high: 27, medium: 0, low: 0, total: 27, more: 0, examples: many}};
    await render(preview({proposal: big}));
    expect(screen.getAllByTestId(/^org-group-/)).toHaveLength(20);
    await fireEvent.press(screen.getByRole("button", {name: "Show 7 more"}));
    expect(screen.getAllByTestId(/^org-group-/)).toHaveLength(27);
  });

  test("Cancel leaves everything as it was", async () => {
    const p = props();
    await render(<OrgCard {...p} proposal={proposal} status="open" ctx={ctxOf()} />);
    await fireEvent.press(screen.getByRole("button", {name: "Cancel"}));
    expect(p.onCancel).toHaveBeenCalled();
  });

  test("once cancelled it says so and offers nothing", async () => {
    await render(preview({status: "cancelled"}));
    expect(screen.getByText("Left as it was")).toBeOnTheScreen();
    expect(screen.queryByRole("button", {name: "Cancel"})).toBeNull();
    expect(screen.queryByRole("button", {name: "Confirm"})).toBeNull();
  });
});

describe("the picker for a shop in a preview", () => {
  const target = {key: "netflix", name: "Netflix", cat: "groceries", count: 2};
  const show = async (t: typeof target | null, onPick = jest.fn(), onClose = jest.fn()) => {
    await render(<SafeAreaProvider initialMetrics={metrics}><CategoryPick target={t} state={baseState()} onPick={onPick} onClose={onClose} /></SafeAreaProvider>);
    return {onPick, onClose};
  };

  test("shows nothing with no shop", async () => {
    await show(null);
    expect(screen.queryByText("What was it for?")).toBeNull();
  });

  test("says how many payments it covers, and picking a category hands it back and closes", async () => {
    const {onPick, onClose} = await show(target);
    expect(screen.getByText("Netflix")).toBeOnTheScreen();
    expect(screen.getByText("2 payments will go where you choose")).toBeOnTheScreen();
    expect(screen.getByRole("button", {name: "Groceries"})).toBeSelected();
    await fireEvent.press(screen.getByRole("button", {name: "Eating out"}));
    expect(onPick).toHaveBeenCalledWith("netflix", "eating", undefined);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("the category sheet", () => {
  const show = async (id: string | null, onMoved = jest.fn(), onClose = jest.fn()) => {
    useMoney.setState({state: baseState(), txs, today: TODAY, loaded: true, toast: null});
    await render(<SafeAreaProvider initialMetrics={metrics}><CategorySheet txId={id} onClose={onClose} onMoved={onMoved} /></SafeAreaProvider>);
    return {onMoved, onClose};
  };

  test("shows nothing with no payment", async () => {
    await show(null);
    expect(screen.queryByText("What was it for?")).toBeNull();
  });

  test("picking a category files the payment, tells him, and offers Undo", async () => {
    const {onMoved, onClose} = await show("b");
    expect(screen.getByText("Costa")).toBeOnTheScreen();
    expect(screen.getByRole("button", {name: "Eating out"})).toBeSelected();
    await act(async () => { await fireEvent.press(screen.getByRole("button", {name: "Groceries"})); });
    await waitFor(() => expect(updateFiling).toHaveBeenCalledWith("b", {cat: "groceries"}));
    expect(useMoney.getState().txs.find(t => t.id === "b")?.cat).toBe("groceries");
    expect(onMoved).toHaveBeenCalledWith("Moved Costa from Eating out to Groceries.");
    expect(onClose).toHaveBeenCalled();
    const toast = useMoney.getState().toast;
    expect(toast?.msg).toBe("Moved to Groceries");
    await act(async () => { await toast!.undo!(); });
    await waitFor(() => expect(useMoney.getState().txs.find(t => t.id === "b")?.cat).toBe("eating"));
  });
});
