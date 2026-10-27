import {act, fireEvent, render, screen} from "@testing-library/react-native";
import {Dimensions, StyleSheet} from "react-native";
import {SafeAreaProvider} from "react-native-safe-area-context";
import TimScreen from "@/app/(tabs)/tim";
import {baseState, TODAY, tx} from "@/lib/__tests__/fixtures";
import {nextBeats, ON_TWOS} from "@/lib/timEyes";
import {hankenWidth} from "@/lib/textWidth";
import {FRANK_ASK, frankFrames, introFrames, linesOf, speechMs, wordsFit} from "@/lib/timSpeech";
import {useMoney} from "@/store/useMoney";

jest.mock("expo-sqlite/kv-store", () => ({__esModule: true, default: {getItemSync: () => null, setItemSync: () => {}, removeItemSync: () => true}}));
jest.mock("expo-router", () => ({router: {push: jest.fn()}, useFocusEffect: (f: () => void | (() => void)) => jest.requireActual("react").useEffect(f, [f])}));
jest.mock("@/db/transactions", () => ({listSince: jest.fn(async () => []), insertTx: jest.fn(async () => {}), deleteTx: jest.fn(async () => {}), updateFiling: jest.fn(async () => {})}));

const metrics = {frame: {x: 0, y: 0, width: 390, height: 844}, insets: {top: 0, left: 0, right: 0, bottom: 0}};
const show = async (n = 3) => {
  const txs = Array.from({length: n}, (_, i) => tx({id: `t${i}`, amount: 5, date: TODAY}));
  useMoney.setState({state: baseState(), txs, today: TODAY, loaded: true, toast: null, accountant: "tim"});
  await render(<SafeAreaProvider initialMetrics={metrics}><TimScreen /></SafeAreaProvider>);
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

test("Send puts your question in the conversation and empties the box; he says he can't answer yet. An empty box sends nothing", async () => {
  jest.useFakeTimers();
  try {
    await show();
    await fireEvent.press(screen.getByRole("button", {name: "Send"}));
    expect(screen.queryByLabelText(/^You asked/)).toBeNull();
    const box = screen.getByLabelText("Ask Tim a question");
    expect(box.props.multiline).toBe(true);
    await fireEvent.changeText(box, "Can I afford a holiday?");
    await fireEvent.press(screen.getByRole("button", {name: "Send"}));
    expect(screen.getByLabelText("You asked: Can I afford a holiday?")).toBeOnTheScreen();
    expect(screen.getByLabelText("Ask Tim a question").props.value).toBe("");
    // he works it out first, then answers
    expect(screen.queryByLabelText("Tim says: I can't answer that yet. I'm coming soon.")).toBeNull();
    await act(() => jest.advanceTimersByTime(nextBeats("thinking").reduce((sum, b) => sum + b.ms, 0) + 10));
    expect(screen.getByLabelText("Tim says: I can't answer that yet. I'm coming soon.")).toBeOnTheScreen();
    // it's Tim's conversation: Frank's starts empty
    await fireEvent.press(screen.getByRole("radio", {name: "Frank"}));
    expect(screen.queryByLabelText(/^You asked/)).toBeNull();
  } finally {
    jest.useRealTimers();
  }
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
  try {
    await show();
    await fireEvent.press(screen.getByRole("radio", {name: "Frank"}));
    const frames = frankFrames();
    const at = (line: string) => frames.slice(0, frames.findIndex(f => f.shown === line && f.said)).reduce((sum, f) => sum + f.ms, 0);
    // his mouth moves under his moustache as the words come, and is still once they're said
    await act(() => jest.advanceTimersByTime(frames.slice(0, frames.findIndex(f => f.mouth > 0)).reduce((sum, f) => sum + f.ms, 0) + 1));
    expect(screen.getByTestId("frank-mouth", {includeHiddenElements: true})).toBeTruthy();
    await act(() => jest.advanceTimersByTime(at("Frank here.") + 1 - frames.slice(0, frames.findIndex(f => f.mouth > 0)).reduce((sum, f) => sum + f.ms, 0) - 1));
    expect(screen.getByLabelText("Frank says: Frank here.")).toBeOnTheScreen();
    expect(screen.queryByTestId("frank-mouth", {includeHiddenElements: true})).toBeNull();
    expect(StyleSheet.flatten(screen.getByText("Frank here.").props.style).textAlign).toBe("right");
    await act(() => jest.advanceTimersByTime(at("I've already looked through your transactions,") - at("Frank here.")));
    expect(StyleSheet.flatten(screen.getByText("I've already looked through your transactions,").props.style).textAlign).toBe("left");
    await act(() => jest.advanceTimersByTime(speechMs(frames)));
    expect(screen.getByLabelText(`Frank says: ${FRANK_ASK}`)).toBeOnTheScreen();
  } finally {
    jest.useRealTimers();
  }
});

test("Frank's words stay beside his head, above his shoulders (row 511 of frank.jpg), on any phone", () => {
  const lines = linesOf(frankFrames());
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
/** Moves time on in small steps until `done`, at most `ms`; what `each` saw on the way. */
async function until(done: () => boolean, ms: number, each: () => void = () => {}) {
  for (let t = 0; t < ms && !done(); t += 50) { await act(() => jest.advanceTimersByTime(50)); each(); }
  expect(done()).toBe(true);
}

test("Frank looks at you while he says hello, blinking, then now and then looks down at his laptop and types", async () => {
  jest.useFakeTimers();
  try {
    await show();
    await fireEvent.press(screen.getByRole("radio", {name: "Frank"}));
    // a blink as he starts (shut on its second pose)
    await act(() => jest.advanceTimersByTime(ON_TWOS + 10));
    expect(frankLid()).toBeTruthy();
    // all through his hello his eyes are on you, his hands still
    for (let t = 0; t < speechMs(frankFrames()); t += 250) {
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
    await fireEvent.press(screen.getByRole("radio", {name: "Frank"}));
    await act(() => jest.advanceTimersByTime(speechMs(frankFrames())));
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
