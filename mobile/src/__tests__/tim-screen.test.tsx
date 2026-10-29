import {act, fireEvent, render, screen} from "@testing-library/react-native";
import {Dimensions, StyleSheet} from "react-native";
import {SafeAreaProvider} from "react-native-safe-area-context";
import TimScreen from "@/app/(tabs)/tim";
import {baseState, TODAY, tx} from "@/lib/__tests__/fixtures";
import {ON_TWOS} from "@/lib/timEyes";
import {hankenWidth} from "@/lib/textWidth";
import {FRANK_HELLOS, frankFrames, introFrames, linesOf, speechMs, wordsFit} from "@/lib/timSpeech";
import {AccountantFail, send} from "@/services/accountant";
import {useMoney} from "@/store/useMoney";

// the box rides the keyboard on the UI thread; under test there's no keyboard, so it stays put
jest.mock("react-native-keyboard-controller", () => jest.requireActual("react-native-keyboard-controller/jest"));
jest.mock("react-native-reanimated", () => ({
  __esModule: true, default: {View: jest.requireActual("react-native").View}, useAnimatedStyle: (f: () => object) => f(),
  useSharedValue: <T,>(v: T) => jest.requireActual("react").useRef({value: v}).current, withTiming: <T,>(v: T) => v,
  Easing: {out: (f: unknown) => f, cubic: (x: number) => x},
}));
jest.mock("expo-sqlite/kv-store", () => ({__esModule: true, default: {getItemSync: () => null, setItemSync: () => {}, removeItemSync: () => true}}));
jest.mock("expo-router", () => ({router: {push: jest.fn()}, useFocusEffect: (f: () => void | (() => void)) => jest.requireActual("react").useEffect(f, [f])}));
jest.mock("@/db/transactions", () => ({listSince: jest.fn(async () => []), insertTx: jest.fn(async () => {}), deleteTx: jest.fn(async () => {}), updateFiling: jest.fn(async () => {})}));
// his brain is on a server; here, each test says what Claude hands back
jest.mock("@/services/accountant", () => {
  class MockFail extends Error {
    kind: string;
    constructor(why: string) { super(why); this.kind = why; }
  }
  return {AccountantFail: MockFail, send: jest.fn()};
});
const sendMock = send as jest.Mock;
const asks = (name: string, input: object) => ({content: [{type: "tool_use", id: `tu_${name}`, name, input}], stop_reason: "tool_use"});
const says = (text: string) => ({content: [{type: "text", text}], stop_reason: "end_turn"});
beforeEach(() => { sendMock.mockReset(); sendMock.mockImplementation(() => new Promise(() => {})); }); // by default he's still thinking

const metrics = {frame: {x: 0, y: 0, width: 390, height: 844}, insets: {top: 0, left: 0, right: 0, bottom: 0}};
const show = async (n = 3, aiConsent = true) => {
  const txs = Array.from({length: n}, (_, i) => tx({id: `t${i}`, amount: 5, date: TODAY}));
  useMoney.setState({state: baseState(), txs, today: TODAY, loaded: true, toast: null, accountant: "tim", aiConsent, notes: []});
  await render(<SafeAreaProvider initialMetrics={metrics}><TimScreen /></SafeAreaProvider>);
};
const ask = async (text: string, name = "Tim") => {
  await fireEvent.changeText(screen.getByLabelText(`Ask ${name} a question`), text);
  await fireEvent.press(screen.getByRole("button", {name: "Send"}));
};

test("only what's needed: him, and the box to ask him (no name, no suggestions)", async () => {
  await show(3);
  expect(screen.getByLabelText("Ask Tim a question")).toBeOnTheScreen();
  expect(screen.queryByRole("header")).toBeNull();
  expect(screen.queryByText(/knows|Where did my money go/)).toBeNull();
  // he always smiles: at rest, his mouth is the smile
  expect(screen.getByTestId("tim-smile", {includeHiddenElements: true})).toBeTruthy();
});

// his eye pieces are hidden from screen readers, so they're looked for among hidden elements too
const lookingAt = () => screen.queryAllByTestId(/^tim-look-/, {includeHiddenElements: true}).map(e => e.props.testID);

test("his eyes follow what you do: he reads the box as you type, and works it out when you send", async () => {
  jest.useFakeTimers();
  try {
    await show();
    // after he's said who he is, idle, he starts by looking at you (the picture itself: no look piece; past a blink, if he does one)
    await act(() => jest.advanceTimersByTime(speechMs(introFrames()) + 200));
    expect(lookingAt()).toEqual([]);
    // the box gets focus: straight away he looks down at it, his lid following a little
    await fireEvent(screen.getByLabelText("Ask Tim a question"), "focus");
    await act(() => jest.advanceTimersByTime(10));
    expect(lookingAt()[0]).toMatch(/^tim-look-down/);
    expect(screen.getByTestId("tim-lid", {includeHiddenElements: true})).toBeTruthy();
    // sent: he does the maths, up and to the side
    await fireEvent.changeText(screen.getByLabelText("Ask Tim a question"), "Can I afford a holiday?");
    await fireEvent.press(screen.getByRole("button", {name: "Send"}));
    await act(() => jest.advanceTimersByTime(10));
    expect(lookingAt()).toEqual(["tim-look-upLeft"]);
  } finally {
    jest.useRealTimers();
  }
});

test("he says \"...Hi\" beside him: shy at first, then his mouth moves, and the words stay", async () => {
  jest.useFakeTimers();
  try {
    await show();
    await act(() => jest.advanceTimersByTime(10));
    expect(lookingAt()).toEqual(["tim-look-down"]);
    expect(screen.queryByText("...Hi")).toBeNull();
    // the dots come first, his mouth still
    await act(() => jest.advanceTimersByTime(1400));
    expect(screen.getByText("...")).toBeOnTheScreen();
    expect(screen.queryByTestId("tim-mouth", {includeHiddenElements: true})).toBeNull();
    // then he says it
    const frames = introFrames(), upTo = (i: number) => frames.slice(0, i).reduce((sum, f) => sum + f.ms, 0);
    const speaks = upTo(frames.findIndex(f => f.mouth > 0));
    await act(() => jest.advanceTimersByTime(speaks - 1410 + 1));
    expect(screen.getByTestId("tim-mouth", {includeHiddenElements: true})).toBeTruthy();
    await act(() => jest.advanceTimersByTime(upTo(frames.findIndex(f => f.said)) - speaks));
    expect(screen.getByLabelText("Tim says: Hi")).toHaveTextContent("...Hi");
    expect(screen.queryByTestId("tim-mouth", {includeHiddenElements: true})).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test("then he says who he is, a line at a time, either side of his head", async () => {
  jest.useFakeTimers();
  try {
    await show(214);
    const frames = introFrames();
    const at = (line: string) => frames.slice(0, frames.findIndex(f => f.shown === line && f.said)).reduce((sum, f) => sum + f.ms, 0);
    // "I'm Tim." on the left of his head, right up to it, from the page's 16pt edge
    await act(() => jest.advanceTimersByTime(at("I'm Tim.") + 1));
    const {width} = Dimensions.get("window");
    const left = StyleSheet.flatten(screen.getByText("I'm Tim.").props.style);
    expect(left).toMatchObject({left: 16, textAlign: "right"});
    expect(left.left + left.width).toBeLessThan(width / 2);
    await act(() => jest.advanceTimersByTime(at("I can see your recent transactions,") - at("I'm Tim.")));
    expect(screen.getByLabelText("Tim says: I can see your recent transactions,")).toBeOnTheScreen();
    // then on the right, up to the other edge
    const right = StyleSheet.flatten(screen.getByText("I can see your recent transactions,").props.style);
    expect(right.textAlign).toBe("left");
    expect(right.left).toBeGreaterThan(width / 2);
    expect(right.left + right.width).toBeCloseTo(width - 16);
    expect(screen.queryByText("I'm Tim.")).toBeNull(); // each line replaces the last
    await act(() => jest.advanceTimersByTime(at("so I can help you make sense of your money.") - at("I can see your recent transactions,")));
    expect(screen.getByText("so I can help you make sense of your money.")).toBeOnTheScreen();
    await act(() => jest.advanceTimersByTime(speechMs(frames)));
    expect(screen.getByLabelText("Tim says: What would you like to ask me?")).toBeOnTheScreen();
  } finally {
    jest.useRealTimers();
  }
});

test("every time the tab opens, he says it all again from the start", async () => {
  jest.useFakeTimers();
  try {
    const frames = introFrames();
    const at = frames.slice(0, frames.findIndex(f => f.shown === "I'm Tim." && f.said)).reduce((sum, f) => sum + f.ms, 0);
    for (let time = 0; time < 2; time++) {
      await show();
      await act(() => jest.advanceTimersByTime(at + 1));
      expect(screen.getByText("I'm Tim.")).toBeOnTheScreen();
      await act(() => jest.advanceTimersByTime(speechMs(frames)));
      expect(screen.getByText("What would you like to ask me?")).toBeOnTheScreen();
      await screen.unmount();
    }
  } finally {
    jest.useRealTimers();
  }
});

describe("asking him", () => {
// his eyes keep moving while he thinks: on the test's clock, so it can wait for his answer
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("Send puts your question in the conversation and empties the box; he looks it up, then answers with what it was checked against. An empty box sends nothing", async () => {
  sendMock.mockResolvedValueOnce(asks("overview", {})).mockImplementationOnce(() => new Promise(() => {}));
  await show();
  await fireEvent.press(screen.getByRole("button", {name: "Send"}));
  expect(screen.queryByLabelText(/^You asked/)).toBeNull();
  const box = screen.getByLabelText("Ask Tim a question");
  expect(box.props.multiline).toBe(true);
  await ask("Can I afford a holiday?");
  expect(screen.getByLabelText("You asked: Can I afford a holiday?")).toBeOnTheScreen();
  expect(screen.getByLabelText("Ask Tim a question").props.value).toBe("");
  // while he works it out: what he's doing, where his answer will go, and one question at a time
  expect(await screen.findByText("Checking your numbers…")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Send"})).toBeDisabled();
  expect(sendMock.mock.calls[0][0]).toBe("tim");
  await screen.unmount();

  sendMock.mockReset();
  sendMock.mockResolvedValueOnce(asks("overview", {})).mockResolvedValueOnce(says("Yes, if it's a cheap one. Wait till payday for anything bigger."));
  await show();
  await ask("Can I afford a holiday?");
  expect(await screen.findByLabelText("Tim says: Yes, if it's a cheap one. Wait till payday for anything bigger.")).toBeOnTheScreen();
  expect(screen.getByText("Checked against your numbers (your balance from Thu 1 Oct)")).toBeOnTheScreen();
  expect(screen.queryByText("Checking your numbers…")).toBeNull();
  expect(screen.getByRole("button", {name: "Send"})).toBeEnabled();
  // it's Tim's conversation: Frank's starts empty
  await fireEvent.press(screen.getByRole("radio", {name: "Frank"}));
  expect(screen.queryByLabelText(/^You asked/)).toBeNull();
});

test("once you've asked, he's a bubble pinned at the top with your latest question beside it, and no hello; tap it and he's back; the other accountant is as he was", async () => {
  sendMock.mockResolvedValueOnce(says("Not much is due.")).mockResolvedValueOnce(says("Then it's easier.")).mockResolvedValueOnce(says("About the same."));
  await show();
  const sticky = () => screen.getByTestId("conversation").props.stickyHeaderIndices;
  expect(screen.getByRole("button", {name: "Hear Tim say who he is"})).toBeOnTheScreen();
  expect(sticky()).toEqual([]);
  await ask("What's due?");
  expect(screen.getByLabelText("You asked: What's due?")).toBeOnTheScreen();
  expect(screen.getByText("You asked")).toBeOnTheScreen();
  expect(sticky()).toEqual([0]);
  expect(screen.queryByRole("button", {name: "Hear Tim say who he is"})).toBeNull();
  expect(screen.queryByLabelText(/^Tim says: (\.|I'm|Hi)/)).toBeNull();
  await screen.findByLabelText("Tim says: Not much is due.");
  // a follow-up goes beside him, the first question back in the conversation under him
  await ask("And if I wait till payday?");
  await screen.findByLabelText("Tim says: Then it's easier.");
  expect(screen.getByLabelText("You asked: And if I wait till payday?")).toBeOnTheScreen();
  expect(screen.getByLabelText("You asked: What's due?")).toBeOnTheScreen();
  expect(screen.getAllByText("You asked")).toHaveLength(1);
  // tap the bubble: he's back as he was, the conversation still under him
  await fireEvent.press(screen.getByRole("button", {name: "Show Tim again"}));
  expect(screen.getByRole("button", {name: "Hear Tim say who he is"})).toBeOnTheScreen();
  expect(screen.queryByText("You asked")).toBeNull();
  expect(sticky()).toEqual([]);
  expect(screen.getByLabelText("You asked: What's due?")).toBeOnTheScreen();
  expect(screen.getByLabelText("You asked: And if I wait till payday?")).toBeOnTheScreen();
  // ask again and he's a bubble again
  await ask("And next month?");
  expect(screen.getByLabelText("You asked: And next month?")).toBeOnTheScreen();
  expect(screen.getByText("You asked")).toBeOnTheScreen();
  expect(sticky()).toEqual([0]);
  await screen.findByLabelText("Tim says: About the same.");
  await fireEvent.press(screen.getByRole("radio", {name: "Frank"}));
  expect(screen.getByRole("button", {name: "Hear Frank say who he is"})).toBeOnTheScreen();
  expect(screen.queryByText("You asked")).toBeNull();
});

test("a follow-up carries on the same conversation", async () => {
  sendMock.mockResolvedValueOnce(says("Not much is due.")).mockResolvedValueOnce(says("Then it's easier."));
  await show();
  await ask("What's due?");
  await screen.findByLabelText("Tim says: Not much is due.");
  await ask("And if I wait till payday?");
  await screen.findByLabelText("Tim says: Then it's easier.");
  // the second request: the first question, his answer as it came, then the follow-up
  const second = sendMock.mock.calls[1][1];
  expect(second[0].content[1].text).toBe("What's due?");
  expect(second[1]).toEqual({role: "assistant", content: says("Not much is due.").content});
  expect(second[2].content[1].text).toBe("And if I wait till payday?");
});

test("a figure he can't trace back is shown, but flagged", async () => {
  sendMock.mockResolvedValueOnce(says("About £999.")).mockResolvedValueOnce(says("About £999."));
  await show();
  await ask("Roughly how much?");
  expect(await screen.findByText("I couldn't check £999 against your numbers.")).toBeOnTheScreen();
});

test("the first time, he asks before looking at your numbers: Not now puts your question back; Agree and ask sends it", async () => {
  sendMock.mockResolvedValueOnce(says("You're fine for a holiday."));
  await show(3, false);
  await ask("Can I afford a holiday?");
  expect(screen.getByText("Before Tim looks at your numbers")).toBeOnTheScreen();
  expect(sendMock).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole("button", {name: "Not now"}));
  expect(screen.getByLabelText("Ask Tim a question").props.value).toBe("Can I afford a holiday?");
  expect(screen.queryByLabelText(/^You asked/)).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Send"}));
  await fireEvent.press(screen.getByRole("button", {name: "Agree and ask"}));
  expect(useMoney.getState().aiConsent).toBe(true);
  expect(await screen.findByLabelText("Tim says: You're fine for a holiday.")).toBeOnTheScreen();
});

test("when he can't answer, he says so calmly in his own voice, and your question stays", async () => {
  sendMock.mockRejectedValueOnce(new AccountantFail("offline"));
  await show();
  await ask("Can I afford a holiday?");
  expect(await screen.findByLabelText("Tim says: I can't reach my notes right now. Check your connection and ask me again.")).toBeOnTheScreen();
  expect(screen.getByLabelText("You asked: Can I afford a holiday?")).toBeOnTheScreen();
  expect(screen.getByRole("button", {name: "Send"})).toBeEnabled();
});

test("something you tell him that will matter later is noted straight away, with Undo", async () => {
  sendMock.mockResolvedValueOnce(asks("remember", {kind: "goal", text: "Saving for a TV", amount: 600, by: "2026-12-20"})).mockResolvedValueOnce(says("Noted."));
  await show();
  await ask("I'm saving £600 for a TV by Christmas");
  await screen.findByLabelText("Tim says: Noted.");
  expect(useMoney.getState().notes).toEqual([expect.objectContaining({kind: "goal", text: "Saving for a TV", amount: 600, by: "2026-12-20", who: "tim", at: TODAY})]);
  const toast = useMoney.getState().toast!;
  expect(toast.msg).toBe("Tim noted: Saving for a TV");
  toast.undo!();
  expect(useMoney.getState().notes).toEqual([]);
});
});

test("Frank can be your accountant instead: his name and picture, and it's remembered", async () => {
  await show();
  await fireEvent.press(screen.getByRole("radio", {name: "Frank"}));
  expect(useMoney.getState().accountant).toBe("frank");
  expect(screen.getByLabelText(/^Frank, a clay-style accountant/)).toBeOnTheScreen();
  expect(screen.getByLabelText("Ask Frank a question")).toBeOnTheScreen();
  expect(screen.queryAllByTestId(/^tim-/, {includeHiddenElements: true})).toEqual([]);
  await fireEvent.press(screen.getByRole("radio", {name: "Tim"}));
  expect(useMoney.getState().accountant).toBe("tim");
});

test("Frank says his own hello, a line at a time either side of his head, and his question stays", async () => {
  jest.useFakeTimers();
  const random = jest.spyOn(Math, "random").mockReturnValue(0); // his first hello
  try {
    await show();
    await fireEvent.press(screen.getByRole("radio", {name: "Frank"}));
    const frames = frankFrames(0), [first, second] = FRANK_HELLOS[0].lines;
    const at = (line: string) => frames.slice(0, frames.findIndex(f => f.shown === line && f.said)).reduce((sum, f) => sum + f.ms, 0);
    // his mouth moves under his moustache as the words come, and is still once they're said
    await act(() => jest.advanceTimersByTime(frames.slice(0, frames.findIndex(f => f.mouth > 0)).reduce((sum, f) => sum + f.ms, 0) + 1));
    expect(screen.getByTestId("frank-mouth", {includeHiddenElements: true})).toBeTruthy();
    await act(() => jest.advanceTimersByTime(at(first) + 1 - frames.slice(0, frames.findIndex(f => f.mouth > 0)).reduce((sum, f) => sum + f.ms, 0) - 1));
    expect(screen.getByLabelText(`Frank says: ${first}`)).toBeOnTheScreen();
    expect(screen.queryByTestId("frank-mouth", {includeHiddenElements: true})).toBeNull();
    expect(StyleSheet.flatten(screen.getByText(first).props.style).textAlign).toBe("right");
    await act(() => jest.advanceTimersByTime(at(second) - at(first)));
    expect(StyleSheet.flatten(screen.getByText(second).props.style).textAlign).toBe("left");
    await act(() => jest.advanceTimersByTime(speechMs(frames)));
    expect(screen.getByLabelText(`Frank says: ${FRANK_HELLOS[0].ask}`)).toBeOnTheScreen();
  } finally {
    random.mockRestore();
    jest.useRealTimers();
  }
});

test.each(FRANK_HELLOS.map((h, i) => [h.lines[0], i]))("Frank's words (%s) stay beside his head, above his shoulders (row 511 of frank.jpg), on any phone", (_, i) => {
  const lines = linesOf(frankFrames(i));
  for (const width of [320, 375, 393, 430, 440]) {
    const k = width / 874, room = {left: 288 * k - 24, right: width - 16 - 579 * k - 8};
    const size = wordsFit(lines, room, 22), lineHeight = Math.round(size * 28 / 22);
    for (const {line, side} of lines) {
      let rows = 1, run = 0;
      for (const word of line.split(" ")) {
        const w = hankenWidth(word, size) * 1.05, gap = run ? hankenWidth(" ", size) : 0;
        if (run && run + gap + w > room[side]) { rows++; run = w; } else run += gap + w;
      }
      expect(240 * k + rows * lineHeight).toBeLessThanOrEqual(511 * k);
    }
  }
});

// Frank's pieces, among hidden elements too
const frankLid = () => screen.queryByTestId("frank-lid", {includeHiddenElements: true});
const frankDown = () => screen.queryByTestId("frank-look-down", {includeHiddenElements: true});
const frankHands = () => screen.queryAllByTestId(/^frank-hand-/, {includeHiddenElements: true}).map(e => e.props.testID);
/** Switches to Frank, who says his first hello (FRANK_HELLOS[0]), so a test knows how long it lasts. */
async function toFrank() {
  const random = jest.spyOn(Math, "random").mockReturnValue(0);
  try { await fireEvent.press(screen.getByRole("radio", {name: "Frank"})); } finally { random.mockRestore(); }
}
/** Moves time on in small steps until `done`, at most `ms`; what `each` saw on the way. */
async function until(done: () => boolean, ms: number, each: () => void = () => {}) {
  for (let t = 0; t < ms && !done(); t += 50) { await act(() => jest.advanceTimersByTime(50)); each(); }
  expect(done()).toBe(true);
}

test("Frank looks at you while he says hello, blinking, then now and then looks down at his laptop and types", async () => {
  jest.useFakeTimers();
  try {
    await show();
    await toFrank();
    // a blink as he starts (shut on its second pose)
    await act(() => jest.advanceTimersByTime(ON_TWOS + 10));
    expect(frankLid()).toBeTruthy();
    // all through his hello his eyes are on you, his hands still
    for (let t = 0; t < speechMs(frankFrames(0)); t += 250) {
      await act(() => jest.advanceTimersByTime(250));
      expect(frankDown()).toBeNull();
      expect(frankHands()).toEqual([]);
    }
    // your typing doesn't change where he looks
    await fireEvent(screen.getByLabelText("Ask Frank a question"), "focus");
    await act(() => jest.advanceTimersByTime(10));
    expect(screen.queryAllByTestId(/-look-/, {includeHiddenElements: true})).toEqual([]);
    // then, within 12s or so, he looks down at his laptop, his heavy lid half down over it
    await until(() => frankDown() !== null, 13000);
    expect(frankLid()).toBeTruthy();
    // and types: each hand lifting and coming down, one at a time, until he looks back up at you
    const seen = new Set<string>();
    await until(() => frankDown() === null, 6500, () => {
      expect(frankHands().length).toBeLessThanOrEqual(1);
      frankHands().forEach(h => seen.add(h));
    });
    expect([...seen].sort()).toEqual(["frank-hand-left", "frank-hand-right"]);
    expect(frankHands()).toEqual([]);
  } finally {
    jest.useRealTimers();
  }
});

test("a tap on Frank while he's typing: he looks up at you and stops, to say it again", async () => {
  jest.useFakeTimers();
  try {
    await show();
    await toFrank();
    await act(() => jest.advanceTimersByTime(speechMs(frankFrames(0))));
    await until(() => frankHands().length > 0, 20000);
    await fireEvent.press(screen.getByRole("button", {name: "Hear Frank say who he is"}));
    await act(() => jest.advanceTimersByTime(10));
    expect(frankHands()).toEqual([]);
    await act(() => jest.advanceTimersByTime(ON_TWOS)); // up at you while the lid's shut
    expect(frankDown()).toBeNull();
    await act(() => jest.advanceTimersByTime(4 * ON_TWOS));
    expect(frankLid()).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test("a tap on him and he says it again", async () => {
  jest.useFakeTimers();
  try {
    await show();
    await act(() => jest.advanceTimersByTime(speechMs(introFrames()) + 10));
    expect(screen.queryByText("I'm Tim.")).toBeNull(); // he's finished
    await fireEvent.press(screen.getByRole("button", {name: "Hear Tim say who he is"}));
    const frames = introFrames();
    const at = frames.slice(0, frames.findIndex(f => f.shown === "I'm Tim." && f.said)).reduce((sum, f) => sum + f.ms, 0);
    await act(() => jest.advanceTimersByTime(at + 1));
    expect(screen.getByText("I'm Tim.")).toBeOnTheScreen();
  } finally {
    jest.useRealTimers();
  }
});
