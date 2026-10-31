import {calmly, micRefused, micState, MIC_BUTTON, speechLang, transcriptOf, withHeard} from "@/lib/dictation";

const state = (p: Partial<Parameters<typeof micState>[0]>) => micState({listening: false, text: "", working: false, canDictate: true, ...p});

test("an empty box offers the microphone, words in it offer Send, and while it's listening the only thing offered is stop", () => {
  expect(state({})).toBe("mic");
  expect(state({text: "what can I spend today?"})).toBe("send");
  expect(state({listening: true})).toBe("stop");
  // listening beats words, so the first thing heard doesn't turn it into Send mid-sentence
  expect(state({listening: true, text: "what can I spend"})).toBe("stop");
});

test("spaces alone are not words: the box still offers the microphone", () => {
  expect(state({text: "   "})).toBe("mic");
  expect(state({text: "\n "})).toBe("mic");
});

test("while he's working one out it stays on Send, waiting, so one question at a time still reads plainly", () => {
  expect(state({working: true})).toBe("send");
  expect(state({working: true, text: "and a car?"})).toBe("send");
});

test("a phone that can't listen offers the box exactly as it was: Send, and no microphone", () => {
  expect(state({canDictate: false})).toBe("send");
  expect(state({canDictate: false, text: "anything"})).toBe("send");
});

test("Send keeps its name, so nothing that knew the button has to learn a new one", () => {
  expect(MIC_BUTTON.send).toEqual({icon: "up", label: "Send"});
  expect(MIC_BUTTON.mic.label).toBe("Speak your question");
  expect(MIC_BUTTON.stop.label).toBe("Stop listening");
});

test("what he hears goes after what you'd already typed, with one space between and never two", () => {
  expect(withHeard("", "a holiday")).toBe("a holiday");
  expect(withHeard("what about", "a holiday")).toBe("what about a holiday");
  expect(withHeard("what about ", "a holiday")).toBe("what about a holiday");
  expect(withHeard("what about\n", "a holiday")).toBe("what about a holiday");
  // nothing typed but spaces counts as nothing typed
  expect(withHeard("   ", "a holiday")).toBe("a holiday");
  // nothing heard yet leaves what you typed exactly as it was
  expect(withHeard("what about", "")).toBe("what about");
});

test("each result replaces the last, so the words don't stutter as you keep speaking", () => {
  const typed = "what about";
  expect(withHeard(typed, "a")).toBe("what about a");
  expect(withHeard(typed, "a holiday")).toBe("what about a holiday");
  expect(withHeard(typed, "a holiday in June")).toBe("what about a holiday in June");
});

test("the words come out of a result event, trimmed, and an empty one is no words at all", () => {
  expect(transcriptOf({results: [{transcript: "  can I afford it?  "}]})).toBe("can I afford it?");
  expect(transcriptOf({results: []})).toBe("");
  expect(transcriptOf({})).toBe("");
  expect(transcriptOf({results: [{}]})).toBe("");
});

test("stopping it yourself, or saying nothing at all, passes in silence: there's nothing to tell you", () => {
  expect(calmly("aborted")).toBeNull();
  expect(calmly("no-speech")).toBeNull();
  expect(calmly("speech-timeout")).toBeNull();
  expect(calmly("nomatch")).toBeNull();
});

test("with the microphone turned off he says where to turn it on, and it isn't offered again", () => {
  expect(calmly("not-allowed")).toContain("Settings");
  expect(micRefused("not-allowed")).toBe(true);
  expect(micRefused("service-not-allowed")).toBe(true);
  // a quiet moment, or a busy microphone, is not a refusal: it's offered again
  expect(micRefused("no-speech")).toBe(false);
  expect(micRefused("busy")).toBe(false);
  expect(micRefused("audio-capture")).toBe(false);
});

test("every problem he can't fix ends with something you can do instead, and none of them tells you off", () => {
  const codes = ["audio-capture", "interrupted", "busy", "network", "language-not-supported", "bad-grammar", "client", "unknown", "something-new"];
  for (const code of codes) {
    const line = calmly(code);
    expect(line).toBeTruthy();
    expect(line).toMatch(/Type your question|Try again/);
    expect(line).not.toMatch(/sorry|error|failed|too much|should have|short/i);
  }
});

test("it listens in the phone's own language, and falls back to UK English when that isn't one", () => {
  expect(speechLang("en-GB")).toBe("en-GB");
  expect(speechLang("fr-FR")).toBe("fr-FR");
  expect(speechLang("en_US")).toBe("en-US"); // as some phones write it
  expect(speechLang("en")).toBe("en");
  expect(speechLang(undefined)).toBe("en-GB");
  expect(speechLang("")).toBe("en-GB");
  expect(speechLang("not a locale")).toBe("en-GB");
});
