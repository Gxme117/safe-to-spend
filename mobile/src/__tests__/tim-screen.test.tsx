import {act, fireEvent, render, screen, waitFor} from "@testing-library/react-native";
import {openBrowserAsync} from "expo-web-browser";
import {Alert, Dimensions, StyleSheet} from "react-native";
import {SafeAreaProvider} from "react-native-safe-area-context";
import TimScreen from "@/app/(tabs)/tim";
import {baseState, ctx as makeCtx, TODAY, tx} from "@/lib/__tests__/fixtures";
import {NO_BRIEFS} from "@/lib/briefing";
import {whatIf} from "@/lib/today";
import {ON_TWOS} from "@/lib/timEyes";
import {frankFrames, introFrames, linesOf, speechMs, TIM_OPENING, timFrames, untagged} from "@/lib/timSpeech";
import {AccountantFail, say, send, shop} from "@/services/accountant";
import {ResearchCard} from "@/components/ResearchCard";
import {researchView, type OldResearchView, type Product} from "@/lib/ai/research";
import {useMoney} from "@/store/useMoney";

// a dev build, not Expo Go, so the native modules the shims look for (the keyboard, the microphone) are there
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {executionEnvironment: "bare"},
  ExecutionEnvironment: {Bare: "bare", Standalone: "standalone", StoreClient: "storeClient"},
}));
// the box rides the keyboard on the UI thread; under test there's no keyboard, so it stays put
jest.mock("react-native-keyboard-controller", () => jest.requireActual("react-native-keyboard-controller/jest"));
jest.mock("react-native-reanimated", () => ({
  __esModule: true, default: {View: jest.requireActual("react-native").View, Text: jest.requireActual("react-native").Text}, useAnimatedStyle: (f: () => object) => f(),
  useSharedValue: <T,>(v: T) => jest.requireActual("react").useRef({value: v}).current, withTiming: <T,>(v: T) => v, withSpring: <T,>(v: T) => v, withSequence: <T,>(...v: T[]) => v[v.length - 1],
  Easing: {in: (f: unknown) => f, out: (f: unknown) => f, inOut: (f: unknown) => f, cubic: (x: number) => x, quad: (x: number) => x},
}));
jest.mock("expo-sqlite/kv-store", () => ({__esModule: true, default: {getItemSync: () => null, setItemSync: () => {}, removeItemSync: () => true}}));
jest.mock("expo-router", () => ({router: {push: jest.fn()}, useLocalSearchParams: () => ({}), useFocusEffect: (f: () => void | (() => void)) => jest.requireActual("react").useEffect(f, [f])}));
jest.mock("@/db/transactions", () => ({listSince: jest.fn(async () => []), insertTx: jest.fn(async () => {}), deleteTx: jest.fn(async () => {}), updateFiling: jest.fn(async () => {}), fileBills: jest.fn(async () => {})}));
jest.mock("expo-web-browser", () => ({openBrowserAsync: jest.fn(async () => ({type: "opened"}))}));
// the kept chats, in memory: copied in and out, as the database would
jest.mock("@/db/chats", () => {
  const kept = new Map<string, {id: string; updated: number; said: unknown; transcript: unknown}>();
  const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
  return {
    kept,
    listChats: jest.fn(async (since: number) => [...kept.values()].filter(c => c.updated >= since).sort((a, b) => b.updated - a.updated)
      .map(({said: _s, transcript: _t, ...row}) => copy(row))),
    loadChat: jest.fn(async (id: string) => kept.has(id) ? copy(kept.get(id)) : null),
    saveChat: jest.fn(async (c: {id: string; updated: number; said: unknown; transcript: unknown}) => { kept.set(c.id, copy(c)); }),
    deleteChat: jest.fn(async (id: string) => { kept.delete(id); }),
    pruneChats: jest.fn(async () => {}),
  };
});
// his brain is on a server; here, each test says what Claude hands back
jest.mock("@/services/accountant", () => {
  class MockFail extends Error {
    kind: string;
    constructor(why: string) { super(why); this.kind = why; }
  }
  return {AccountantFail: MockFail, send: jest.fn(), say: jest.fn(), photo: jest.fn(async () => null), shop: jest.fn()};
});
// Frank's voice: his first opening recorded (each word 300ms, 50ms between), played by a player the test can see. Its sound
// starts `late` ms after play(), or never if it's `stuck` (the ringer's off), and it says how far in it is.
jest.mock("@/lib/frankVoice.json", () => {
  const {script} = jest.requireActual("@/lib/frankHellos.json")[0];
  const shown: string = script.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim(); // as untagged has it (timSpeech needs this file)
  const words = shown.split(" ").map((_, j) => ({start: 100 + j * 350, end: 400 + j * 350}));
  return {h0: {text: script, ms: words[words.length - 1].end + 150, words}};
});
jest.mock("../../assets/frank-voice", () => ({FRANK_CLIPS: {h0: 100}}));
jest.mock("../../assets/frankWait-voice", () => ({FRANK_WAIT_CLIPS: {h0: 300}}));
// Tim's voice: not recorded here (his hello as he says it without one, introFrames), unless a test puts a take in
jest.mock("@/lib/timVoice.json", () => ({}));
jest.mock("../../assets/tim-voice", () => ({TIM_CLIPS: {h0: 200}}));
// their pictures and some of Frank's pieces, by name (every image is otherwise just 1 here), to tell light from dark
jest.mock("../../assets/tim.jpg", () => "tim.jpg");
jest.mock("../../assets/frank.jpg", () => "frank.jpg");
jest.mock("../../assets/frank-blink-2.png", () => "frank-blink-2.png");
jest.mock("../../assets/frank-mouth-1.png", () => "frank-mouth-1.png");
jest.mock("../../assets/frank-dark.jpg", () => "frank-dark.jpg");
jest.mock("../../assets/frank-dark-room.png", () => "frank-dark-room.png");
jest.mock("../../assets/frank-dark-blink-2.png", () => "frank-dark-blink-2.png");
jest.mock("../../assets/frank-dark-look-down.png", () => "frank-dark-look-down.png");
jest.mock("../../assets/frank-dark-hands-left-1.png", () => "frank-dark-hands-left-1.png");
jest.mock("../../assets/frank-dark-mouth-1.png", () => "frank-dark-mouth-1.png");
const mockSound = {late: 0, stuck: false, from: null as number | null};
const mockPlayer = {
  replace: jest.fn(() => { mockSound.from = null; }),
  play: jest.fn(() => { mockSound.from = mockSound.stuck ? null : jest.now() + mockSound.late; }),
  pause: jest.fn(() => { mockSound.from = null; }),
  isLoaded: true,
  isBuffering: false,
  get playing() { return mockSound.from !== null; },
  get currentTime() { return mockSound.from === null ? 0 : Math.max(0, jest.now() - mockSound.from) / 1000; },
};
jest.mock("expo-audio", () => ({useAudioPlayer: () => mockPlayer, setAudioModeAsync: jest.fn(async () => {})}));
// His opening as a video is being tried out (light mode): here there's no video module, so his openings are his recordings.
jest.mock("@/services/video", () => ({useVideoPlayer: () => null, VideoView: null}));
// The microphone is a native module: here the test says what the phone can do, and plays its events back by hand.
// All of it is built inside the factory, because the screen's shim reads the module as it's imported — before anything
// out here has run.
jest.mock("expo-speech-recognition", () => {
  const can = {onDevice: true, available: true, granted: true};
  const started: Record<string, unknown> = {};
  const events: Record<string, ((e: unknown) => void)[]> = {};
  const fire = (name: string, e?: unknown) => (events[name] ?? []).slice().forEach(f => f(e));
  return {
    can, started, events,
    ExpoSpeechRecognitionModule: {
      start: jest.fn((o: object) => { Object.assign(started, o); fire("start", null); }),
      stop: jest.fn(() => fire("end", null)),
      abort: jest.fn(() => { fire("error", {error: "aborted"}); fire("end", null); }),
      requestMicrophonePermissionsAsync: jest.fn(async () => ({granted: can.granted, canAskAgain: true})),
      supportsOnDeviceRecognition: () => can.onDevice,
      isRecognitionAvailable: () => can.available,
    },
    useSpeechRecognitionEvent: (name: string, f: (e: unknown) => void) =>
      jest.requireActual("react").useEffect(() => {
        (events[name] ??= []).push(f);
        return () => { events[name] = events[name].filter(g => g !== f); };
      }, [name, f]),
  };
});
const spoken = jest.requireMock("expo-speech-recognition") as {
  can: {onDevice: boolean; available: boolean; granted: boolean};
  started: Record<string, unknown>;
  events: Record<string, ((e: unknown) => void)[]>;
  ExpoSpeechRecognitionModule: Record<string, jest.Mock>;
};
const mockModule = spoken.ExpoSpeechRecognitionModule;
const mockMic = spoken.can, mockStart = spoken.started;
/** play one of the recogniser's events back, as the native side would */
const heard = async (text: string) => await act(async () => { spoken.events.result?.slice().forEach(f => f({isFinal: false, results: [{transcript: text}]})); });
const went = async (error: string) => await act(async () => { spoken.events.error?.slice().forEach(f => f({error})); });
const audio = jest.requireMock("expo-audio") as {setAudioModeAsync: jest.Mock};
const sendMock = send as jest.Mock;
const asks = (name: string, input: object) => ({content: [{type: "tool_use", id: `tu_${name}`, name, input}], stop_reason: "tool_use"});
const says = (text: string) => ({content: [{type: "text", text}], stop_reason: "end_turn"});
beforeEach(() => {
  sendMock.mockReset(); sendMock.mockImplementation(() => new Promise(() => {})); // by default he's still thinking
  [mockPlayer.replace, mockPlayer.play, mockPlayer.pause].forEach(f => f.mockClear());
  Object.assign(mockSound, {late: 0, stuck: false, from: null});
  [mockModule.start, mockModule.stop, mockModule.abort, mockModule.requestMicrophonePermissionsAsync].forEach(f => f.mockClear());
  audio.setAudioModeAsync.mockClear();
  Object.assign(mockMic, {onDevice: true, available: true, granted: true});
  Object.keys(mockStart).forEach(k => delete mockStart[k]);
  jest.spyOn(console, "log").mockImplementation(() => {}); // the dev log's timing line for each question
});

const metrics = {frame: {x: 0, y: 0, width: 390, height: 844}, insets: {top: 0, left: 0, right: 0, bottom: 0}};
// briefed: Frank's had today's briefing already, so his tab opens with his opening (his briefings have their own tests)
const show = async (n = 3, aiConsent = true, briefed = true) => {
  const txs = Array.from({length: n}, (_, i) => tx({id: `t${i}`, amount: 5, date: TODAY}));
  useMoney.setState({state: baseState(), txs, today: TODAY, loaded: true, toast: null, theme: "system", frankRoom: "plain", accountant: "tim", aiConsent, notes: [],
    briefLog: briefed ? {...NO_BRIEFS, lastDaily: TODAY} : NO_BRIEFS});
  await render(<SafeAreaProvider initialMetrics={metrics}><TimScreen /></SafeAreaProvider>);
};
const ask = async (text: string, name = "Tim") => {
  await fireEvent.changeText(screen.getByLabelText(`Ask ${name} a question`), text);
  await fireEvent.press(screen.getByRole("button", {name: "Send"}));
};

test("only what's needed: him, the box to ask him, and what he can do (no name)", async () => {
  await show(3);
  expect(screen.getByLabelText("Ask Tim a question")).toBeOnTheScreen();
  expect(screen.queryByRole("header")).toBeNull();
  expect(screen.queryByText(/knows/)).toBeNull();
  expect(screen.getByTestId("features")).toBeOnTheScreen();
  for (const title of ["Smart Save", "Look Ahead", "What If"]) expect(screen.getByRole("button", {name: title})).toBeOnTheScreen();
  expect(screen.queryByRole("button", {name: "Smart Sort"})).toBeNull();
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

test("he says \"Hi\" beside him, looking at you, his mouth moving, and the words stay", async () => {
  jest.useFakeTimers();
  try {
    await show();
    await act(() => jest.advanceTimersByTime(10));
    expect(lookingAt()).toEqual([]); // at you
    expect(screen.queryByText("Hi")).toBeNull();
    expect(screen.queryByTestId("tim-mouth", {includeHiddenElements: true})).toBeNull();
    // then he says it
    const frames = introFrames(), upTo = (i: number) => frames.slice(0, i).reduce((sum, f) => sum + f.ms, 0);
    const speaks = upTo(frames.findIndex(f => f.mouth !== "X"));
    await act(() => jest.advanceTimersByTime(speaks - 10 + 1));
    expect(screen.getByTestId("tim-mouth", {includeHiddenElements: true})).toBeTruthy();
    expect(lookingAt()).toEqual([]);
    await act(() => jest.advanceTimersByTime(upTo(frames.findIndex(f => f.said)) - speaks));
    expect(screen.getByLabelText("Tim says: Hi")).toHaveTextContent("Hi");
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

test("Send puts your question in the conversation and empties the box; he looks it up, then answers with what it was checked against. An empty box offers the microphone, not Send", async () => {
  sendMock.mockResolvedValueOnce(asks("overview", {})).mockImplementationOnce(() => new Promise(() => {}));
  await show();
  // nothing to send, so there's nothing offering to send it
  expect(screen.queryByRole("button", {name: "Send"})).toBeNull();
  expect(screen.getByRole("button", {name: "Speak your question"})).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText("Ask Tim a question"), "   "); // spaces alone are still nothing
  expect(screen.queryByRole("button", {name: "Send"})).toBeNull();
  await fireEvent.changeText(screen.getByLabelText("Ask Tim a question"), "");
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
  // he's done, so the empty box is ready for the next question
  expect(screen.getByRole("button", {name: "Speak your question"})).toBeOnTheScreen();
  // it's Tim's conversation: Frank's starts empty
  await fireEvent.press(screen.getByRole("radio", {name: "Frank"}));
  expect(screen.queryByLabelText(/^You asked/)).toBeNull();
});

describe("what he found on the web", () => {
  const search = {type: "server_tool_use", id: "s1", name: "web_search", input: {query: "netflix uk price"}};
  const found = {type: "web_search_tool_result", tool_use_id: "s1", content: [{type: "web_search_result", url: "https://www.netflix.com/gb", title: "Netflix", encrypted_content: "x"}]};
  const citation = {type: "web_search_result_location", url: "https://www.netflix.com/gb/plans", title: "Netflix plans", encrypted_index: "i", cited_text: "Standard £12.99 a month"};

  test("the page he cites is under his answer, a tap away, and never passed off as your numbers", async () => {
    sendMock.mockResolvedValueOnce(asks("overview", {})).mockResolvedValueOnce({stop_reason: "end_turn", content: [search, found,
      {type: "text", text: "Netflix lists Standard at "}, {type: "text", text: "£12.99 a month", citations: [citation]}, {type: "text", text: "."}]});
    await show();
    await ask("How much is Netflix now?");
    expect(await screen.findByLabelText("Tim says: Netflix lists Standard at £12.99 a month.")).toBeOnTheScreen();
    expect(screen.getByText("Your figures checked against your numbers (your balance from Thu 1 Oct)")).toBeOnTheScreen();
    expect(screen.getByText("From the web, as listed:")).toBeOnTheScreen();
    expect(screen.queryByText(/I couldn't check/)).toBeNull();
    await fireEvent.press(screen.getByRole("link", {name: "Open Netflix plans, on netflix.com"}));
    expect(openBrowserAsync).toHaveBeenCalledWith("https://www.netflix.com/gb/plans");
  });

  test("a price with no source says so, and he said he looked", async () => {
    const answer = {stop_reason: "end_turn", content: [search, found, {type: "text", text: "It's about £12.99."}]};
    sendMock.mockResolvedValueOnce(answer).mockResolvedValueOnce(answer);
    await show();
    await ask("How much is Netflix now?");
    expect(await screen.findByText("I couldn't check £12.99 against your numbers or a source.")).toBeOnTheScreen();
    expect(screen.getByText("Looked on the web, nothing to cite.")).toBeOnTheScreen();
    expect(screen.queryByRole("link")).toBeNull();
  });

  describe("something to buy he looked up", () => {
    const shopMock = shop as jest.Mock;
    beforeEach(() => { shopMock.mockReset(); });
    const seen = new Date().toISOString();
    const item = (over: Partial<Product>): Omit<Product, "id"> => ({name: "Sony WH-1000XM6 Headphones", brand: "Sony", model: "WH-1000XM6", group: "sony", retailer: "Argos", host: "argos.co.uk",
      url: "https://www.argos.co.uk/product/1", price: 349.99, confidence: "search_listed", priceSource: "https://www.argos.co.uk/product/1", image: "https://imgs.search.brave.com/sony.jpg",
      condition: "new", delivery: "free", checked: seen, ...over});
    const SHOPPED = {products: [
      item({}),
      item({name: "Bose QuietComfort Ultra Headphones", group: "bose", retailer: "John Lewis", host: "johnlewis.com", url: "https://www.johnlewis.com/bose/p2", price: 449.95, confidence: "verified", delivery: null, image: null}),
      item({name: "Sony WH-CH720N Headphones", group: "ch720n", retailer: "Very", host: "very.co.uk", url: "https://www.very.co.uk/3.prd", price: 79.99, delivery: 3.99}),
      item({name: "JBL Tune 770NC Headphones", group: "jbl", retailer: "AO", host: "ao.com", url: "https://ao.com/p4", price: 69.49, confidence: "estimated"}),
      item({name: "Sennheiser Momentum 4 Headphones", group: "senn", retailer: "Richer Sounds", host: "richersounds.com", url: "https://www.richersounds.com/p5", price: null, confidence: null, priceSource: null}),
    ]};
    const find = asks("find_products", {queries: ["wireless headphones UK"], match: ["headphones"], exclude: [], max_price: 0});
    const QUESTION = "Can I afford some wireless headphones?";

    test("a card leads his answer: the products as tiles, each its price and how sure that price is; the small arrow opens the shop", async () => {
      shopMock.mockResolvedValueOnce(SHOPPED);
      sendMock.mockResolvedValueOnce(find).mockResolvedValueOnce(says("Here are five pairs."));
      await show();
      await ask(QUESTION);
      expect(await screen.findByLabelText("Tim says: Here are five pairs.")).toBeOnTheScreen();
      expect(screen.getByTestId("research-card")).toBeOnTheScreen();
      expect(screen.getByRole("header", {name: "Headphones"})).toBeOnTheScreen();
      for (const t of ["£349.99", "£449.95", "About £69", "No price found"]) expect(screen.getByText(t)).toBeOnTheScreen();
      // how sure each price is: an icon on the card, the words read out with the tile
      expect(screen.queryByText("On the shop's page")).toBeNull();
      expect(screen.getAllByLabelText(/On the shop's page/).length).toBeGreaterThan(0);
      expect(screen.getAllByLabelText(/Listed in search/).length).toBeGreaterThan(0);
      expect(screen.queryByText("New · £3.99 delivery")).toBeNull(); // the tiles are minimal: condition and delivery aren't on them
      expect(screen.getByText(/^Prices as of \d\d:\d\d\. Tap one to ask about it$/)).toBeOnTheScreen();
      // a photo each, the shop's letter where there's none
      expect(screen.getAllByTestId("research-photo")).toHaveLength(4);
      await fireEvent.press(screen.getByRole("link", {name: "Open John Lewis's page for Bose QuietComfort Ultra Headphones"})); // the arrow; a tile asks him
      expect(openBrowserAsync).toHaveBeenCalledWith("https://www.johnlewis.com/bose/p2");
      // the card holds the shops, so there's no list of them under his words, and no estimate line
      expect(screen.queryByText(/From the web|nothing to cite|estimate\./)).toBeNull();
      expect(shopMock).toHaveBeenCalledWith({queries: ["wireless headphones UK"], match: ["headphones"], exclude: [], max_price: 0});
    });

    test("tap a product: you ask whether it fits, he's told which by its id (never its price), and his answer's card tries it against your money", async () => {
      shopMock.mockResolvedValueOnce(SHOPPED);
      sendMock.mockResolvedValueOnce(find).mockResolvedValueOnce(says("Here are five pairs."))
        .mockResolvedValueOnce(asks("show_products", {title: "Bose QuietComfort Ultra Headphones", note: "", ids: ["p2"], pick: "p2"}))
        .mockResolvedValueOnce(says("John Lewis has it at £449.95."));
      await show();
      await ask(QUESTION);
      await screen.findByLabelText("Tim says: Here are five pairs.");
      await fireEvent.press(screen.getByTestId("tile-p2"));
      expect(await screen.findByLabelText("Tim says: John Lewis has it at £449.95.")).toBeOnTheScreen();
      expect(screen.getByText("Can I afford the Bose QuietComfort Ultra Headphones from John Lewis?")).toBeOnTheScreen();
      const asked = sendMock.mock.calls[2][1] as {role: string; content: string | {type: string; text?: string}[]}[];
      const context = asked.flatMap(m => m.role === "user" && Array.isArray(m.content) ? m.content : []).map(b => b.text ?? "").find(t => t.includes("They tapped"))!;
      expect(context).toContain("They tapped p2 on your card");
      expect(context).not.toContain("£");
      const st = useMoney.getState();
      // what buying it would do is in his words, not repeated on the card
      expect(screen.queryByText(whatIf({state: st.state!, txs: st.txs, today: st.today}, 449.95)!.line)).toBeNull();
      expect(screen.queryByText("If you bought it today")).toBeNull();
      expect(screen.getByLabelText("Going by: Bose QuietComfort Ultra Headphones, £449.95, at John Lewis · On the shop's page")).toBeOnTheScreen();
      expect(screen.getByLabelText(/^Bose QuietComfort Ultra Headphones at John Lewis, £449\.95.*the one he went by$/)).toBeOnTheScreen();
    });

    test("a product with no price found isn't one to tap; nor is any while he's working", async () => {
      shopMock.mockResolvedValueOnce(SHOPPED);
      sendMock.mockResolvedValueOnce(find).mockResolvedValueOnce(says("Here are five pairs."));
      await show();
      await ask(QUESTION);
      await screen.findByLabelText("Tim says: Here are five pairs.");
      await fireEvent.press(screen.getByTestId("tile-p5")); // no price, nothing to ask about
      expect(sendMock).toHaveBeenCalledTimes(2);
      await ask("And which is quietest?");
      await fireEvent.press(screen.getByTestId("tile-p1")); // not while he's working
      expect(sendMock).toHaveBeenCalledTimes(3);
    });

    test("the shops couldn't be reached: no card, and he says so; prices talked about with no card are marked as an estimate", async () => {
      shopMock.mockRejectedValueOnce(new Error("unavailable"));
      sendMock.mockResolvedValueOnce(find).mockResolvedValueOnce(says("I couldn't look round the shops just now."));
      await show();
      await ask(QUESTION);
      expect(await screen.findByLabelText("Tim says: I couldn't look round the shops just now.")).toBeOnTheScreen();
      expect(screen.queryByTestId("research-card")).toBeNull();
      await screen.unmount();
      const searched = {stop_reason: "end_turn", content: [{type: "server_tool_use", id: "s9", name: "web_search", input: {query: "iphone 17 price uk"}},
        {type: "web_search_tool_result", tool_use_id: "s9", content: [{type: "web_search_result", url: "https://www.argos.co.uk/x", title: "iPhone 17", encrypted_content: "x"}]},
        {type: "text", text: "Around £799."}]};
      sendMock.mockReset();
      sendMock.mockResolvedValueOnce(searched).mockResolvedValueOnce(says("Around £799, but I couldn't find a shop's listing."));
      await show();
      await ask("Can I afford a new iPhone?");
      expect(await screen.findByText("No shop's listing was found for this, so any price here is an estimate.")).toBeOnTheScreen();
    });

    test("while he works: he's looking up prices, then round the shops, then the shops he found, then trying one against your money", async () => {
      let found: (v: unknown) => void = () => {};
      shopMock.mockImplementationOnce(() => new Promise(r => { found = r; }));
      sendMock.mockResolvedValueOnce(find).mockImplementationOnce(() => new Promise(() => {}));
      await show();
      await ask(QUESTION);
      expect(await screen.findByText("Looking round the shops…")).toBeOnTheScreen();
      await act(async () => { found(SHOPPED); });
      expect(await screen.findByTestId("looked", {includeHiddenElements: true})).toHaveTextContent("argos.co.uk · johnlewis.com · very.co.uk +2");
    });

    test("best value: the pick dearer than the cheapest says so over its price, with why and how much more, and its tile is tagged", async () => {
      const p = (id: string, retailer: string, price: number): Product => ({id, name: "Samsung Q60D 65 inch QLED TV", brand: "Samsung", model: "Q60D", group: id, retailer,
        host: "x.co.uk", url: `https://x.co.uk/${id}`, price, confidence: "search_listed", priceSource: `https://x.co.uk/${id}`, image: null, condition: "new", delivery: null, checked: new Date().toISOString()});
      const view = researchView(makeCtx({state: baseState()}), {v: 2, title: "Samsung 65-inch QLED TV", products: [p("p7", "Appliances Direct", 460), p("p1", "Currys", 391.97)],
        pick: "p7", why: "Newer 2024 model; the cheaper one is an older Frame"}, new Date());
      await render(<ResearchCard view={view} box="#fff" edge="#eee" onOpen={() => {}} />);
      expect(screen.getAllByText("Best value")).toHaveLength(2); // over the headline price, and the tile's tag
      expect(screen.getAllByText("£460.00")).toHaveLength(1); // the headline only: the tile says "Going by"
      expect(screen.getByText("Going by")).toBeOnTheScreen();
      expect(screen.getByLabelText(/^Samsung Q60D 65 inch QLED TV at Appliances Direct.*the one he went by$/)).toBeOnTheScreen();
      expect(screen.getByTestId("best-why")).toHaveTextContent("Newer 2024 model; the cheaper one is an older Frame");
      expect(screen.getByTestId("best-more")).toHaveTextContent("£68.03 more than the cheapest, at Currys");
      expect(screen.getByTestId("value-p7")).toBeOnTheScreen();
      expect(screen.queryByTestId("value-p1")).toBeNull();
      expect(screen.getByTestId("lowest-p1")).toBeOnTheScreen();
    });

    test("a card kept from before is drawn as it was: one product, each shop a tile that opens its page", async () => {
      const old: OldResearchView = {product: "iPhone 17, 128GB", note: "The newest standard model", best: {label: "Best price", price: "£799.00", by: "at Argos · New"},
        rows: [{seller: "Argos", meta: "New", price: "£799.00", url: "https://www.argos.co.uk/x", host: "argos.co.uk", pick: true, label: "Open Argos's listing, £799.00, New, on argos.co.uk"}],
        ifLabel: "If you bought it today", ifToday: null, checked: "Prices as listed, checked 09:12"};
      const opened = jest.fn();
      await render(<ResearchCard view={old} box="#fff" edge="#eee" onOpen={opened} />);
      expect(screen.getByRole("header", {name: "iPhone 17, 128GB"})).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole("link", {name: "Open Argos's listing, £799.00, New, on argos.co.uk"}));
      expect(opened).toHaveBeenCalledWith("https://www.argos.co.uk/x");
      expect(screen.queryByText(/Tap one/)).toBeNull();
    });
  });

  test("an answer that never searched has nothing about the web under it", async () => {
    sendMock.mockResolvedValueOnce(says("Not much is due."));
    await show();
    await ask("What's due?");
    expect(await screen.findByLabelText("Tim says: Not much is due.")).toBeOnTheScreen();
    expect(screen.queryByText(/on the web|From the web/)).toBeNull();
  });
});

test("once you've asked, he's a bubble pinned at the top with his name beside it, and no hello; tap it and he's back; the other accountant is as he was", async () => {
  sendMock.mockResolvedValueOnce(says("Not much is due.")).mockResolvedValueOnce(says("Then it's easier.")).mockResolvedValueOnce(says("About the same."));
  await show();
  const sticky = () => screen.getByTestId("conversation").props.stickyHeaderIndices;
  expect(screen.getByRole("button", {name: "Hear Tim say who he is"})).toBeOnTheScreen();
  expect(sticky()).toEqual([]);
  await ask("What's due?");
  expect(screen.getAllByLabelText("You asked: What's due?")).toHaveLength(1);
  expect(screen.getByText("Tap him for a new chat")).toBeOnTheScreen();
  expect(sticky()).toEqual([0]);
  expect(screen.queryByRole("button", {name: "Hear Tim say who he is"})).toBeNull();
  expect(screen.queryByLabelText(/^Tim says: (\.|I'm|Hi)/)).toBeNull();
  await screen.findByLabelText("Tim says: Not much is due.");
  // a follow-up carries on under it: every question stays in the conversation, once
  await ask("And if I wait till payday?");
  await screen.findByLabelText("Tim says: Then it's easier.");
  expect(screen.getAllByLabelText("You asked: And if I wait till payday?")).toHaveLength(1);
  expect(screen.getAllByLabelText("You asked: What's due?")).toHaveLength(1);
  // tap the bubble: he's back as he was, for a new chat
  await fireEvent.press(screen.getByRole("button", {name: "New chat with Tim"}));
  expect(screen.getByRole("button", {name: "Hear Tim say who he is"})).toBeOnTheScreen();
  expect(screen.queryByText("Tap him for a new chat")).toBeNull();
  expect(sticky()).toEqual([]);
  expect(screen.queryByLabelText("You asked: What's due?")).toBeNull();
  expect(screen.queryByLabelText("Tim says: Then it's easier.")).toBeNull();
  // ask again and he's a bubble again, the new chat starting from nothing
  await ask("And next month?");
  expect(screen.getByLabelText("You asked: And next month?")).toBeOnTheScreen();
  expect(screen.getByText("Tap him for a new chat")).toBeOnTheScreen();
  expect(sticky()).toEqual([0]);
  await screen.findByLabelText("Tim says: About the same.");
  expect(sendMock.mock.calls[2][1][0].content[1].text).toBe("And next month?");
  await fireEvent.press(screen.getByRole("radio", {name: "Frank"}));
  expect(screen.getByRole("button", {name: "Hear Frank say who he is"})).toBeOnTheScreen();
  expect(screen.queryByText("Tap him for a new chat")).toBeNull();
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

test("Frank's empty chat has a stack of what he can do: Smart Sort and Find my bills ask, Shopping starts your question; they go once you type or the chat's begun", async () => {
  sendMock.mockResolvedValueOnce(says("Nothing to sort."));
  await show();
  await fireEvent.press(screen.getByRole("radio", {name: "Frank"}));
  expect(screen.getByTestId("features")).toBeOnTheScreen();
  for (const title of ["Smart Sort", "Shopping", "Find my bills"]) expect(screen.getByRole("button", {name: title})).toBeOnTheScreen();
  // Shopping needs a product: it starts the question in the box, and the stack steps aside for the typing
  await fireEvent.press(screen.getByRole("button", {name: "Shopping"}));
  expect(screen.getByLabelText("Ask Frank a question").props.value).toBe("Can I afford ");
  expect(screen.queryByTestId("features")).toBeNull();
  await fireEvent.changeText(screen.getByLabelText("Ask Frank a question"), "");
  // with nothing unsorted, Smart Sort just asks
  await fireEvent.press(screen.getByRole("button", {name: "Smart Sort"}));
  expect(screen.getByLabelText("You asked: Smart Sort my payments")).toBeOnTheScreen();
  expect(sendMock.mock.calls[0][1][0].content[1].text).toBe("Smart Sort my payments");
  expect(screen.queryByTestId("features")).toBeNull();
});

test("Smart Sort with payments to sort comes up as a screen from where Frank is: the rows and box stay put while its background fades in over them, then go", async () => {
  sendMock.mockResolvedValueOnce(says("Done."));
  await show(3);
  await act(() => { useMoney.setState(st => ({txs: st.txs.map(t => ({...t, needsCat: true}))})); });
  await fireEvent.press(screen.getByRole("radio", {name: "Frank"}));
  await fireEvent.press(screen.getByRole("button", {name: /^Smart Sort/}));
  expect(screen.getByTestId("org-screen")).toBeOnTheScreen();
  // the screen is modal, so what's under it counts as hidden to the test, but it's still there
  expect(screen.getByTestId("features", {includeHiddenElements: true})).toBeOnTheScreen();
  await act(() => jest.advanceTimersByTime(400));
  expect(screen.queryByTestId("features", {includeHiddenElements: true})).toBeNull();
});

test("under his latest answer, what you might ask next: one tap asks it, and only the latest has them", async () => {
  sendMock.mockResolvedValueOnce(says("Not much is due.\n<next>What about next week? | Is rent covered?</next>"));
  await show();
  await ask("What's due?");
  await screen.findByLabelText("Tim says: Not much is due.");
  expect(screen.queryByText(/<next>/)).toBeNull();
  expect(screen.getByRole("button", {name: "Is rent covered?"})).toBeOnTheScreen();
  // he's working it out: they're gone
  await fireEvent.press(screen.getByRole("button", {name: "What about next week?"}));
  expect(screen.getByLabelText("You asked: What about next week?")).toBeOnTheScreen();
  expect(screen.queryByTestId("next")).toBeNull();
  expect(sendMock.mock.calls[1][1].at(-1).content[1].text).toBe("What about next week?");
});

test("he can lead with a picture: what the figure is, the figure, and a bar of what it's made of, above his words", async () => {
  sendMock.mockResolvedValueOnce(says(`<figure label="Spent so far">£1,284</figure>\n<split>£650 rent | £634 everything else</split>\n\nThe rest is mostly food.`));
  await show();
  await ask("I've spent 1284: 650 rent, 634 the rest. Where did it go?");
  const pic = await screen.findByTestId("answer-figure");
  expect(pic).toHaveProp("accessibilityLabel", "Spent so far, £1,284. £650 rent, £634 everything else.");
  expect(screen.getByText("Spent so far")).toBeOnTheScreen();
  expect(screen.getByText("£1,284")).toBeOnTheScreen();
  expect(screen.getByText("£650")).toBeOnTheScreen();
  expect(screen.getByLabelText("Tim says: The rest is mostly food.")).toBeOnTheScreen();
  expect(screen.queryByText(/<figure|<split/)).toBeNull();
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
  // he's not working any more, so the box is ready to ask again
  expect(screen.getByRole("button", {name: "Speak your question"})).toBeOnTheScreen();
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

// A change to your bills: a card under his answer, and nothing changes until you say yes to it
describe("bills, only with your yes", () => {
  const gym = {name: "Gym", amount: 30, how_often: "monthly", day_of_month: 20, next_date: null, varies: null, from_regular: null};
  const card = async () => {
    sendMock.mockResolvedValueOnce(asks("add_bill", gym)).mockResolvedValueOnce(says("Here's your gym. Check the card."));
    await show();
    useMoney.setState({speaks: false});
    await ask("Add my gym, £30 on the 20th");
    await screen.findByLabelText("Tim says: Here's your gym. Check the card.");
  };
  const gyms = () => useMoney.getState().state!.bills.filter(b => b.name === "Gym");
  // what the app told him in front of your message (the conversation goes on growing after it's sent, so it's found by your words)
  type M = {role: string; content: {text?: string}[] | string};
  const contextOf = (q: string) => {
    const m = sendMock.mock.calls.flatMap(c => c[1] as M[]).find(x => x.role === "user" && Array.isArray(x.content) && x.content[1]?.text === q);
    return (m!.content as {text: string}[])[0].text;
  };

  test("the card shows what it'd be and today's amount; nothing's saved until you tap Add, then he says it's done, with Undo", async () => {
    await card();
    expect(screen.getByText("Add Gym")).toBeOnTheScreen();
    expect(screen.getByText("£30 every month")).toBeOnTheScreen();
    expect(screen.getByText(/^Today's amount: £\d+ → £\d+$/)).toBeOnTheScreen();
    expect(gyms()).toEqual([]);
    await fireEvent.press(screen.getByRole("button", {name: "Add it"}));
    expect(await screen.findByLabelText("Tim says: Done. I've added Gym to your bills at £30 a month.")).toBeOnTheScreen();
    expect(gyms()).toEqual([expect.objectContaining({amount: 30, day: 20, since: TODAY})]);
    expect(screen.getByText("Done")).toBeOnTheScreen();
    const toast = useMoney.getState().toast!;
    expect(toast.msg).toBe("Gym added");
    await act(async () => { toast.undo!(); });
    expect(gyms()).toEqual([]);
    expect(screen.getByText("Undone: put back as it was")).toBeOnTheScreen();
    // he's told on your next message, without asking Claude for the yes itself
    expect(sendMock).toHaveBeenCalledTimes(2);
    sendMock.mockResolvedValueOnce(says("Fine."));
    await ask("ok thanks");
    await screen.findByLabelText("Tim says: Fine.");
    const context = contextOf("ok thanks");
    expect(context).toContain("They tapped yes on your card: Add Gym");
    expect(context).toContain("then undid it");
  });

  test("a plain typed yes is the same as tapping it; a no leaves everything", async () => {
    await card();
    await ask("go ahead");
    expect(await screen.findByLabelText("Tim says: Done. I've added Gym to your bills at £30 a month.")).toBeOnTheScreen();
    expect(screen.getByLabelText("You asked: go ahead")).toBeOnTheScreen();
    expect(gyms()).toHaveLength(1);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  test("Not now saves nothing", async () => {
    await card();
    await fireEvent.press(screen.getByRole("button", {name: "Not now"}));
    expect(await screen.findByLabelText("Tim says: No problem. I've left it as it was.")).toBeOnTheScreen();
    expect(gyms()).toEqual([]);
  });

  test("anything else goes to him, and the card closes with nothing changed", async () => {
    await card();
    sendMock.mockResolvedValueOnce(says("Got it, £35 then."));
    await ask("it's £35 actually");
    await screen.findByLabelText("Tim says: Got it, £35 then.");
    expect(screen.getByText("Not answered: nothing changed")).toBeOnTheScreen();
    expect(gyms()).toEqual([]);
    expect(contextOf("it's £35 actually")).toContain("They didn't answer your card: Add Gym");
  });

  test("if it can't be saved, the card says so and stays to try again", async () => {
    await card();
    useMoney.setState({state: {...useMoney.getState().state!, bills: [...useMoney.getState().state!.bills, {id: "g", name: "Gym", amount: 25, freq: "monthly"}]}});
    await fireEvent.press(screen.getByRole("button", {name: "Add it"}));
    expect(await screen.findByText("There's a bill like it now. Ask him again.")).toBeOnTheScreen();
    expect(gyms()).toHaveLength(1);
  });
});

// Saying your question instead of typing it. One button does all three jobs, and the recogniser's events are played
// back by hand (`heard`, `went`), as the native side would send them.
describe("saying it out loud", () => {
const mic = () => screen.getByRole("button", {name: "Speak your question"});

test("what you say fills the box as you speak, and Send takes the microphone's place once there are words", async () => {
  await show();
  await fireEvent.press(mic());
  expect(mockModule.requestMicrophonePermissionsAsync).toHaveBeenCalled();
  // listening: the box says so, and the only thing offered is stop
  expect(screen.getByRole("button", {name: "Stop listening"})).toBeOnTheScreen();
  expect(screen.getByLabelText("Ask Tim a question").props.placeholder).toBe("Listening…");
  await heard("what can I");
  expect(screen.getByLabelText("Ask Tim a question").props.value).toBe("what can I");
  // each result replaces the last, so the words don't stutter
  await heard("what can I spend today?");
  expect(screen.getByLabelText("Ask Tim a question").props.value).toBe("what can I spend today?");
  // still listening, so it's still stop
  expect(screen.queryByRole("button", {name: "Send"})).toBeNull();
  await fireEvent.press(screen.getByRole("button", {name: "Stop listening"}));
  expect(mockModule.stop).toHaveBeenCalled();
  // stopped: what was heard is yours to read, and Send is there for it
  expect(screen.getByLabelText("Ask Tim a question").props.value).toBe("what can I spend today?");
  expect(screen.getByRole("button", {name: "Send"})).toBeOnTheScreen();
});

test("what you'd already typed stays put: the words you say are added after it, and sent together", async () => {
  sendMock.mockResolvedValueOnce(asks("overview", {})).mockResolvedValueOnce(says("About £18."));
  await show();
  await fireEvent.changeText(screen.getByLabelText("Ask Tim a question"), "what about");
  // there are words, so it's Send — the microphone comes back by emptying the box, as in the chat apps
  expect(screen.queryByRole("button", {name: "Speak your question"})).toBeNull();
  await fireEvent.changeText(screen.getByLabelText("Ask Tim a question"), "");
  await fireEvent.press(mic());
  await heard("a holiday");
  await fireEvent.press(screen.getByRole("button", {name: "Stop listening"}));
  expect(screen.getByLabelText("Ask Tim a question").props.value).toBe("a holiday");
});

test("nothing you say leaves the phone: it only ever listens on the device", async () => {
  await show();
  await fireEvent.press(mic());
  expect(mockStart).toMatchObject({requiresOnDeviceRecognition: true, interimResults: true, continuous: true});
});

test("a phone that can't turn speech into words on its own never offers the microphone", async () => {
  mockMic.onDevice = false;
  await show();
  expect(screen.queryByRole("button", {name: "Speak your question"})).toBeNull();
  // the box is exactly as it was: Send, and nothing said about a microphone
  expect(screen.getByRole("button", {name: "Send"})).toBeOnTheScreen();
  expect(screen.getByLabelText("Ask Tim a question").props.placeholder).toBe("Ask Tim anything…");
});

test("he stops talking before the microphone opens, and the app's sound is put back as it was afterwards", async () => {
  await show();
  await fireEvent.press(screen.getByRole("radio", {name: "Frank"})); // Frank talks out loud
  mockPlayer.pause.mockClear();
  audio.setAudioModeAsync.mockClear();
  await fireEvent.press(screen.getByRole("button", {name: "Speak your question"}));
  expect(mockPlayer.pause).toHaveBeenCalled(); // he isn't the one being heard
  await fireEvent.press(screen.getByRole("button", {name: "Stop listening"}));
  expect(audio.setAudioModeAsync).toHaveBeenCalledWith({playsInSilentMode: true, interruptionMode: "mixWithOthers"});
});

test("asked for the microphone and told no, he says where to turn it on and stops offering it", async () => {
  mockMic.granted = false;
  await show();
  await fireEvent.press(mic());
  expect(await screen.findByLabelText(/^Tim says: I can't hear you/)).toBeOnTheScreen();
  expect(screen.getByLabelText(/^Tim says:.*Settings/)).toBeOnTheScreen();
  expect(mockModule.start).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", {name: "Speak your question"})).toBeNull();
});

test("saying nothing passes in silence, and the microphone is offered again", async () => {
  await show();
  await fireEvent.press(mic());
  await went("no-speech");
  await act(async () => { spoken.events.end?.slice().forEach(f => f(null)); });
  expect(screen.queryByLabelText(/Type your question|can't hear you/)).toBeNull(); // nothing to tell you
  expect(mic()).toBeOnTheScreen();
});

test("switching accountant closes the microphone, and the box keeps its words", async () => {
  await show();
  await fireEvent.press(mic());
  await heard("what can I spend");
  await fireEvent.press(screen.getByRole("radio", {name: "Frank"}));
  expect(mockModule.abort).toHaveBeenCalled();
  expect(screen.getByLabelText("Ask Frank a question").props.value).toBe("what can I spend");
  expect(screen.queryByLabelText(/Type your question|can't hear you/)).toBeNull(); // we closed it, so there's nothing to say
});

test("leaving the screen while it's listening closes the microphone", async () => {
  await show();
  await fireEvent.press(mic());
  expect(mockModule.abort).not.toHaveBeenCalled();
  await screen.unmount();
  expect(mockModule.abort).toHaveBeenCalled();
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

// Frank's first opening: its captions, where its sound starts, and when each caption's all been said (ms into his speech)
const opening = () => {
  const frames = frankFrames(0), caps = linesOf(frames).map(c => c.line), startOf = (i: number) => speechMs(frames.slice(0, i));
  return {frames, caps, voice: startOf(frames.findIndex(f => f.voice)), said: (line: string) => startOf(frames.findIndex(f => f.line === line && f.said))};
};
const LISTEN = 20; // how often he checks whether his sound has started (ms)

test("Frank says his own opening, a caption at a time either side of his head, and his question stays", async () => {
  jest.useFakeTimers();
  try {
    await show();
    await toFrank();
    const {frames, caps, said} = opening(), [first, second] = caps;
    // his mouth moves under his moustache as the words come
    let moved = false;
    for (let t = 0; t < said(first); t += 40) {
      await act(() => jest.advanceTimersByTime(40));
      moved ||= !!screen.queryByTestId("frank-mouth", {includeHiddenElements: true});
    }
    expect(moved).toBe(true);
    await act(() => jest.advanceTimersByTime(LISTEN + 40));
    expect(screen.getByLabelText(`Frank says: ${first}`)).toBeOnTheScreen();
    expect(StyleSheet.flatten(screen.getByText(first).props.style).textAlign).toBe("right");
    await act(() => jest.advanceTimersByTime(said(second) - said(first)));
    expect(StyleSheet.flatten(screen.getByText(second).props.style).textAlign).toBe("left");
    // his question stays, his mouth still
    await act(() => jest.advanceTimersByTime(speechMs(frames)));
    expect(screen.getByLabelText(`Frank says: ${caps.at(-1)}`)).toBeOnTheScreen();
    expect(screen.queryByTestId("frank-mouth", {includeHiddenElements: true})).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test("Frank says his opening out loud, in one go, and stops when you leave him or start him over", async () => {
  jest.useFakeTimers();
  try {
    await show();
    // Tim's hello isn't recorded here, so nothing plays
    await act(() => jest.advanceTimersByTime(speechMs(introFrames())));
    expect(mockPlayer.play).not.toHaveBeenCalled();
    await toFrank();
    const {frames, caps, voice} = opening();
    // the recording loads while he looks up, and plays as he starts
    expect(mockPlayer.replace).toHaveBeenLastCalledWith(100);
    await act(() => jest.advanceTimersByTime(voice - 1));
    expect(mockPlayer.play).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(1));
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    // and plays through all of it: nothing starts again between his captions
    await act(() => jest.advanceTimersByTime(speechMs(frames)));
    expect(screen.getByLabelText(`Frank says: ${caps.at(-1)}`)).toBeOnTheScreen();
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    // a tap on him: he stops, and starts over (the same opening, here)
    mockPlayer.pause.mockClear();
    const random = jest.spyOn(Math, "random").mockReturnValue(0);
    try { await fireEvent.press(screen.getByRole("button", {name: "Hear Frank say who he is"})); } finally { random.mockRestore(); }
    expect(mockPlayer.pause).toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(voice));
    expect(mockPlayer.replace).toHaveBeenLastCalledWith(100);
    expect(mockPlayer.play).toHaveBeenCalledTimes(2);
    // back to Tim: Frank stops talking
    mockPlayer.pause.mockClear();
    await fireEvent.press(screen.getByRole("radio", {name: "Tim"}));
    expect(mockPlayer.pause).toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test("his captions follow his voice: when the sound starts late, they wait for it", async () => {
  jest.useFakeTimers();
  mockSound.late = 500; // loading, or AirPods
  try {
    await show();
    await toFrank();
    const {caps, voice, said} = opening(), first = caps[0];
    // on time, he'd have said it all by now; he hasn't, because you haven't heard it yet
    await act(() => jest.advanceTimersByTime(said(first) + 100));
    expect(screen.queryByLabelText(`Frank says: ${first}`)).toBeNull();
    await act(() => jest.advanceTimersByTime(500 + LISTEN));
    expect(screen.getByLabelText(`Frank says: ${first}`)).toBeOnTheScreen();
    expect(voice).toBeGreaterThan(0);
  } finally {
    jest.useRealTimers();
  }
});

test("when his voice can't play (the ringer's off), his captions go on without it", async () => {
  jest.useFakeTimers();
  mockSound.stuck = true;
  try {
    await show();
    await toFrank();
    const {frames, caps, voice} = opening();
    await act(() => jest.advanceTimersByTime(voice + 1100)); // he waits a moment for it
    expect(mockPlayer.pause).toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(speechMs(frames)));
    expect(screen.getByLabelText(`Frank says: ${caps.at(-1)}`)).toBeOnTheScreen();
  } finally {
    jest.useRealTimers();
  }
});

test("Frank stops talking out loud once you've asked him something", async () => {
  jest.useFakeTimers();
  try {
    await show();
    await toFrank();
    await act(() => jest.advanceTimersByTime(1000));
    mockPlayer.pause.mockClear();
    await ask("How am I doing?", "Frank");
    expect(mockPlayer.pause).toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test("Tim says his hello out loud when it's recorded, his words in step with it", async () => {
  jest.useFakeTimers();
  const recorded = jest.requireMock("@/lib/timVoice.json") as Record<string, unknown>;
  const words = untagged(TIM_OPENING).split(" ").map((_, j) => ({start: 100 + j * 300, end: 350 + j * 300}));
  recorded.h0 = {text: TIM_OPENING, ms: words.at(-1)!.end + 100, words};
  try {
    await show();
    const frames = timFrames(), voice = speechMs(frames.slice(0, frames.findIndex(f => f.voice)));
    expect(mockPlayer.replace).toHaveBeenLastCalledWith(200);
    await act(() => jest.advanceTimersByTime(voice));
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    await act(() => jest.advanceTimersByTime(speechMs(frames) + 200));
    expect(screen.getByLabelText(`Tim says: ${linesOf(frames).at(-1)!.line}`)).toBeOnTheScreen();
  } finally {
    delete recorded.h0;
    jest.useRealTimers();
  }
});

describe("Answers out loud", () => {
const sayMock = say as jest.Mock;
const LINE = "[sighs] Fine... go on, then. [dryly] Rent's out Friday.";
// his take of LINE: each word 300ms, 50ms between
const words = "Fine... go on, then. Rent's out Friday.".split(" ").map((_, j) => ({start: 100 + j * 350, end: 400 + j * 350}));
const TAKE = {uri: "file:///cache/frank-says-1.mp3", ms: words.at(-1)!.end + 100, words};
const answer = says(`Go on, then. Rent's out Friday.\n\n<say>${LINE}</say>`);
beforeEach(() => { jest.useFakeTimers(); sayMock.mockReset(); sayMock.mockResolvedValue(TAKE); useMoney.setState({speaks: true}); });
afterEach(() => jest.useRealTimers());
const aloud = () => screen.queryByTestId("said-aloud");

test("he says a line of his answer from his bubble, his words beside it as he says them, then his name's back", async () => {
  sendMock.mockResolvedValueOnce(answer);
  await show();
  await toFrank();
  await ask("Can I buy trainers?", "Frank");
  // the answer's written in full, without the line he says
  expect(await screen.findByLabelText("Frank says: Go on, then. Rent's out Friday.")).toBeOnTheScreen();
  expect(sayMock).toHaveBeenCalledWith("frank", LINE, undefined); // an answer's line, not a briefing
  await act(async () => {});
  expect(mockPlayer.replace).toHaveBeenLastCalledWith({uri: TAKE.uri});
  await until(() => aloud()?.props.children === "Fine… go on, then.", 3000);
  expect(screen.queryByText("Tap him for a new chat")).toBeNull();
  await until(() => aloud()?.props.children === "Rent's out Friday.", 3000);
  await until(() => aloud() === null, 5000);
  expect(screen.getByText("Tap him for a new chat")).toBeOnTheScreen();
  expect(sayMock).toHaveBeenCalledTimes(1);

  // a tap on his answer and he says it again, from the take he's got: no new recording
  mockPlayer.replace.mockClear();
  await fireEvent.press(screen.getByRole("button", {name: /Frank says: Go on/}));
  expect(mockPlayer.replace).toHaveBeenLastCalledWith({uri: TAKE.uri});
  await until(() => aloud() !== null, 1000);
  expect(sayMock).toHaveBeenCalledTimes(1);
});

test("his answer's there to read straight away, while his voice is still on its way", async () => {
  sayMock.mockImplementation(() => new Promise(() => {})); // ElevenLabs never gets back
  sendMock.mockResolvedValueOnce(answer);
  await show();
  await toFrank();
  await ask("Can I buy trainers?", "Frank");
  expect(await screen.findByLabelText("Frank says: Go on, then. Rent's out Friday.")).toBeOnTheScreen();
  expect(screen.queryByText("Checking your numbers…")).toBeNull();
  expect(screen.getByRole("button", {name: "Speak your question"})).toBeOnTheScreen(); // ready for the next question
  expect(aloud()).toBeNull();
});

test("Tim says a line of his answer too, in his own voice", async () => {
  sendMock.mockResolvedValueOnce(says("Yes, you can.\n\n<say>[calmly] Yes... you can.</say>"));
  await show();
  await ask("Can I buy trainers?");
  expect(await screen.findByLabelText("Tim says: Yes, you can.")).toBeOnTheScreen();
  expect(sayMock).toHaveBeenCalledWith("tim", "[calmly] Yes... you can.", undefined);
  await act(async () => {});
  expect(mockPlayer.replace).toHaveBeenLastCalledWith({uri: TAKE.uri});
  await until(() => aloud()?.props.children === "you can.", 3000);
  expect(screen.getByLabelText("Tim says: you can.")).toBeOnTheScreen();
});

test("switched off in Settings, his voice is never asked for", async () => {
  useMoney.setState({speaks: false});
  sendMock.mockResolvedValueOnce(answer);
  await show();
  useMoney.setState({speaks: false});
  await toFrank();
  await ask("Can I buy trainers?", "Frank");
  await screen.findByLabelText("Frank says: Go on, then. Rent's out Friday.");
  expect(sayMock).not.toHaveBeenCalled();
});

test("no take (his voice couldn't be had), he just doesn't say it", async () => {
  sayMock.mockResolvedValue(null);
  sendMock.mockResolvedValueOnce(answer);
  await show();
  await toFrank();
  await ask("Can I buy trainers?", "Frank");
  await screen.findByLabelText("Frank says: Go on, then. Rent's out Friday.");
  await act(async () => {});
  expect(aloud()).toBeNull();
  expect(screen.getByLabelText("You asked: Can I buy trainers?")).toBeOnTheScreen();
});

test("he stops when you switch to Tim, and Tim's answers are in Tim's own voice", async () => {
  sendMock.mockResolvedValueOnce(answer);
  await show();
  await toFrank();
  await ask("Can I buy trainers?", "Frank");
  await screen.findByLabelText("Frank says: Go on, then. Rent's out Friday.");
  await until(() => aloud() !== null, 2000);
  await fireEvent.press(screen.getByRole("radio", {name: "Tim"}));
  expect(aloud()).toBeNull();
  sendMock.mockResolvedValueOnce(answer);
  await ask("And you?");
  await screen.findByLabelText("Tim says: Go on, then. Rent's out Friday.");
  expect(sayMock.mock.calls.map(([who]) => who)).toEqual(["frank", "tim"]);
});
});

// Frank's pieces, among hidden elements too
const frankLid = () => screen.queryByTestId("frank-lid", {includeHiddenElements: true});
const frankDown = () => screen.queryByTestId("frank-look-down", {includeHiddenElements: true});
const frankHands = () => screen.queryAllByTestId(/^frank-hand-/, {includeHiddenElements: true}).map(e => e.props.testID);
/** Switches to Frank, who says his first opening (frankFrames(0)), so a test knows how long it lasts. */
async function toFrank() {
  const random = jest.spyOn(Math, "random").mockReturnValue(0);
  try { await fireEvent.press(screen.getByRole("radio", {name: "Frank"})); } finally { random.mockRestore(); }
}
/** Moves time on in small steps until `done`, at most `ms`; what `each` saw on the way. */
async function until(done: () => boolean, ms: number, each: () => void = () => {}) {
  for (let t = 0; t < ms && !done(); t += 50) { await act(() => jest.advanceTimersByTime(50)); each(); }
  expect(done()).toBe(true);
}

describe("dark mode", () => {
  const images = () => screen.container.queryAll(i => i.type === "Image").map(i => i.props.source);
  const dark = async () => await act(async () => { useMoney.setState({theme: "dark"}); });

  test("Frank is in his dark room, his pieces made from it; Tim has only his own picture so far", async () => {
    await show();
    await dark();
    await toFrank();
    expect(images()).toEqual(expect.arrayContaining(["frank-dark.jpg", "frank-dark-blink-2.png", "frank-dark-look-down.png", "frank-dark-hands-left-1.png", "frank-dark-mouth-1.png"]));
    expect(images()).not.toContain("frank.jpg");
    expect(images()).not.toContain("frank-blink-2.png");
    expect(images()).not.toContain("frank-dark-room.png"); // plain black, until the office is chosen
    expect(screen.getByTestId("frank-picture").props.accessibilityLabel).toMatch(/in a dark room$/);
    await fireEvent.press(screen.getByRole("radio", {name: "Tim"}));
    expect(images()).toContain("tim.jpg");
  });

  test("with the office chosen in Settings, its lights hang behind Frank, not Tim", async () => {
    await show();
    await dark();
    await act(async () => { useMoney.getState().setFrankRoom("office"); });
    await toFrank();
    expect(images()).toEqual(expect.arrayContaining(["frank-dark.jpg", "frank-dark-room.png", "frank-dark-blink-2.png", "frank-dark-mouth-1.png"]));
    await fireEvent.press(screen.getByRole("radio", {name: "Tim"}));
    expect(images()).not.toContain("frank-dark-room.png");
  });

  test("in light mode he's at his light desk, as before", async () => {
    await show();
    await toFrank();
    expect(images()).toEqual(expect.arrayContaining(["frank.jpg", "frank-blink-2.png", "frank-mouth-1.png"]));
    expect(images().filter(s => typeof s === "string" && s.startsWith("frank-dark"))).toEqual([]);
  });

  test("asked something, Frank's hair comes out over his bubble's top (his picture's background is the page's); Tim's doesn't", async () => {
    sendMock.mockResolvedValue(says("Doing fine."));
    await show();
    await dark();
    await ask("How am I doing?");
    await screen.findByLabelText("Tim says: Doing fine."); // one question at a time: his answer's in before Frank is asked
    // (the Smart Organisation screen keeps its own copy of his picture ready, undrawn, so it's there the moment it's wanted)
    expect(images().filter(s => s === "tim.jpg")).toHaveLength(1 + 1);
    await toFrank();
    await ask("How am I doing?", "Frank");
    expect(images().filter(s => s === "frank-dark.jpg")).toHaveLength(2 + 1); // his picture in the bubble, and his hair over it
  });
});

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

describe("Frank's briefing", () => {
const BRIEF = "[flatly] Morning. I've had a look... steady enough. Nothing due this week. <mentioned>f1</mentioned>";
const SHOWN = "Morning. I've had a look... steady enough. Nothing due this week.";
const briefOf = (call: unknown[]) => ((call[1] as {content: {text: string}[]}[])[0].content[1].text);
const clipOf = (n: number) => mockPlayer.replace.mock.calls.some(c => (c as unknown[])[0] === n);
const sayMock = say as jest.Mock;
beforeEach(() => { sayMock.mockReset(); sayMock.mockResolvedValue(null); useMoney.setState({speaks: true}); });

test("the first visit of the day, he says he's having a look and briefs you instead of his opening, out loud; once a day", async () => {
  let land!: (t: unknown) => void;
  sendMock.mockImplementationOnce(() => new Promise(r => { land = r; }));
  await show(3, true, false);
  await toFrank();
  // "Just a second… let me have a look.", from its recording, not his opening's
  await waitFor(() => expect(clipOf(300)).toBe(true));
  expect(clipOf(100)).toBe(false);
  expect(sendMock).toHaveBeenCalledTimes(1);
  expect(sendMock.mock.calls[0][0]).toBe("frank");
  expect(briefOf(sendMock.mock.calls[0])).toMatch(/^<app_brief kind="daily">\n/);
  await act(async () => { land(says(BRIEF)); });
  // his first message, from his bubble; the tags and his marks never show
  expect(await screen.findByLabelText(`Frank says: ${SHOWN}`)).toBeOnTheScreen();
  expect(screen.getByText("Tap him for a new chat")).toBeOnTheScreen();
  expect(useMoney.getState().briefLog).toMatchObject({lastDaily: TODAY, last: {kind: "daily", text: SHOWN}, said: {today: {stage: TODAY, told: true}}});
  // all of it out loud, tags and all, as a briefing (so it may be longer than an answer's line)
  expect(sayMock).toHaveBeenCalledWith("frank", BRIEF.replace(" <mentioned>f1</mentioned>", ""), "brief");
  // the next visit the same day: his opening, no second briefing
  await screen.unmount();
  sendMock.mockClear();
  mockPlayer.replace.mockClear();
  await render(<SafeAreaProvider initialMetrics={metrics}><TimScreen /></SafeAreaProvider>);
  await act(async () => {});
  expect(sendMock).not.toHaveBeenCalled();
  expect(clipOf(300)).toBe(false);
});

test("with their answers not read out, the briefing's only written: no take is asked for", async () => {
  sendMock.mockResolvedValueOnce(says(BRIEF));
  await show(3, true, false);
  useMoney.setState({speaks: false});
  await toFrank();
  expect(await screen.findByLabelText(`Frank says: ${SHOWN}`)).toBeOnTheScreen();
  expect(sayMock).not.toHaveBeenCalled();
});

test("a question after it carries on from the briefing", async () => {
  sendMock.mockResolvedValueOnce(says(BRIEF)).mockResolvedValueOnce(says("Can't pay it for you. Your bank's app can."));
  await show(3, true, false);
  await toFrank();
  await screen.findByLabelText(`Frank says: ${SHOWN}`);
  await ask("Can you pay that for me?", "Frank");
  expect(await screen.findByLabelText("Frank says: Can't pay it for you. Your bank's app can.")).toBeOnTheScreen();
  const sent = sendMock.mock.calls[1][1] as {role: string; content: {text: string}[]}[];
  expect(sent[0].content[1].text).toMatch(/^<app_brief/);
  expect(sent[1].role).toBe("assistant");
  expect(sent[2].content[1].text).toBe("Can you pay that for me?");
});

test("only Frank, only once you've said he can look at your numbers", async () => {
  await show(3, true, false);
  await act(async () => {});
  expect(sendMock).not.toHaveBeenCalled(); // Tim never briefs
  await screen.unmount();
  await show(3, false, false);
  await toFrank();
  await act(async () => {});
  expect(sendMock).not.toHaveBeenCalled();
  expect(clipOf(100)).toBe(true); // his opening, as ever
});

test("if he can't, or there's nothing worth saying, it's his opening; only a briefing he gave counts as given", async () => {
  sendMock.mockRejectedValueOnce(new AccountantFail("offline"));
  await show(3, true, false);
  await toFrank();
  await waitFor(() => expect(clipOf(100)).toBe(true));
  expect(useMoney.getState().briefLog.lastDaily).toBeNull();
  expect(screen.queryByLabelText(/^Frank says: No connection/)).toBeNull(); // no failure in the chat: he just carries on
  await screen.unmount();
  mockPlayer.replace.mockClear();
  sendMock.mockResolvedValueOnce(says("<nothing/>"));
  await show(3, true, false);
  await toFrank();
  await waitFor(() => expect(clipOf(100)).toBe(true));
  expect(useMoney.getState().briefLog.lastDaily).toBe(TODAY);
});
});

test("the burger button opens recent chats, and a tap on the page closes it", async () => {
  await show();
  const burger = screen.getByRole("button", {name: "Recent chats"});
  expect(burger).toBeCollapsed();
  await fireEvent.press(burger);
  expect(burger).toBeExpanded();
  expect(screen.getByRole("header", {name: "Pocket"})).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId("close-recent-chats"));
  expect(burger).toBeCollapsed();
});

describe("recent chats", () => {
  const kept = (jest.requireMock("@/db/chats") as {kept: Map<string, unknown>}).kept;
  beforeEach(() => kept.clear());
  const openPanel = async () => {
    await fireEvent.press(screen.getByRole("button", {name: "Recent chats"}));
    await waitFor(() => expect(screen.queryByText("No chats yet")).toBeNull());
  };

  test("a chat is kept, listed under Today with your first question, and opened again to carry on", async () => {
    sendMock.mockResolvedValueOnce(says("Have a look at your Living tab first.")).mockResolvedValueOnce(says("Rent's your biggest one."));
    await show();
    await ask("What are my bills?");
    expect(await screen.findByLabelText("Tim says: Have a look at your Living tab first.")).toBeOnTheScreen();

    // a new chat from the panel's Chat button: the conversation goes, and the next question is a chat of its own
    await openPanel();
    expect(screen.getByRole("header", {name: "Today"})).toBeOnTheScreen();
    expect(screen.getByRole("button", {name: "What are my bills?, with Tim"})).toBeSelected();
    await fireEvent.press(screen.getByRole("button", {name: "New chat"}));
    expect(screen.queryByLabelText("You asked: What are my bills?")).toBeNull();
    await ask("What's my biggest bill?");
    expect(await screen.findByLabelText("Tim says: Rent's your biggest one.")).toBeOnTheScreen();
    await waitFor(() => expect(kept.size).toBe(2));

    // the first one, back as it was, and asking again carries on its conversation
    await openPanel();
    expect(screen.getByRole("button", {name: "What's my biggest bill?, with Tim"})).toBeSelected();
    await fireEvent.press(screen.getByRole("button", {name: "What are my bills?, with Tim"}));
    expect(await screen.findByLabelText("You asked: What are my bills?")).toBeOnTheScreen();
    expect(screen.getByLabelText("Tim says: Have a look at your Living tab first.")).toBeOnTheScreen();
    expect(screen.queryByLabelText("You asked: What's my biggest bill?")).toBeNull();
    sendMock.mockClear();
    sendMock.mockResolvedValueOnce(says("Done."));
    await ask("And the smallest?");
    await waitFor(() => expect(sendMock).toHaveBeenCalled());
    // what Claude sees is that chat's conversation, then this question; nothing from the other chat
    const seen = JSON.stringify(sendMock.mock.calls[0][1]);
    expect(seen).toContain("What are my bills?");
    expect(seen).toContain("Have a look at your Living tab first.");
    expect(seen).toContain("And the smallest?");
    expect(seen).not.toContain("biggest");
  });

  test("search finds a chat by what was said, and a chat with Frank opens with Frank", async () => {
    sendMock.mockResolvedValueOnce(says("It's Netflix, and it's going up."));
    await show();
    await fireEvent.press(screen.getByRole("radio", {name: "Frank"}));
    await ask("Any subscriptions?", "Frank");
    expect(await screen.findByLabelText("Frank says: It's Netflix, and it's going up.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("radio", {name: "Tim"}));

    await openPanel();
    await fireEvent.changeText(screen.getByLabelText("Search chats"), "netflix");
    expect(screen.getByRole("button", {name: "Any subscriptions?, with Frank"})).toBeOnTheScreen();
    // his face is on the row, not Tim's
    expect(screen.getByTestId("chat-face-frank", {includeHiddenElements: true})).toBeOnTheScreen();
    expect(screen.queryByTestId("chat-face-tim", {includeHiddenElements: true})).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Search chats"), "rent");
    expect(screen.getByText("No chats match that")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Search chats"), "");
    await fireEvent.press(screen.getByRole("button", {name: "Any subscriptions?, with Frank"}));
    await waitFor(() => expect(useMoney.getState().accountant).toBe("frank"));
    expect(screen.getByLabelText("You asked: Any subscriptions?")).toBeOnTheScreen();
  });

  test("press and hold to delete a chat, after asking", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => buttons?.find(b => b.text === "Delete")?.onPress?.());
    sendMock.mockResolvedValueOnce(says("Have a look at your Living tab first."));
    await show();
    await ask("What are my bills?");
    expect(await screen.findByLabelText("Tim says: Have a look at your Living tab first.")).toBeOnTheScreen();
    await openPanel();
    await fireEvent(screen.getByRole("button", {name: "What are my bills?, with Tim"}), "longPress");
    expect(alert).toHaveBeenCalledWith("Delete this chat?", "What are my bills?", expect.anything());
    await waitFor(() => expect(screen.getByText("No chats yet")).toBeOnTheScreen());
    expect(kept.size).toBe(0);
    // it was the chat on screen, so a new one starts
    expect(screen.queryByLabelText("You asked: What are my bills?")).toBeNull();
    alert.mockRestore();
  });
});
