import {MAX_EYE_CONTACT} from "@/lib/timEyes";
import {hankenWidth} from "@/lib/textWidth";
import {ASK, beatsOf, FRANK_HELLOS, frankFrames, HELLO, HELLO_MS, helloBeats, helloFrames, introFrames, linesOf, speechMs, still, syllables, wordsFit, type SpeechFrame} from "@/lib/timSpeech";

test("his hello builds up dot by dot to \"...Hi\", and stays", () => {
  const shown = helloFrames().map(f => f.shown);
  expect(shown.slice(0, 4)).toEqual(["", ".", "..", "..."]);
  expect(shown.at(-1)).toBe(HELLO);
  // never goes backwards
  shown.forEach((s, i) => { if (i) expect(s.startsWith(shown[i - 1])).toBe(true); });
});

test("his mouth only moves once the dots are done, for each letter, and ends shut", () => {
  const frames = helloFrames();
  expect(frames.filter(f => f.shown.length <= 3).every(f => f.mouth === 0)).toBe(true);
  expect(frames.find(f => f.shown === "...H")?.mouth).toBeGreaterThan(0);
  expect(frames.find(f => f.shown === "...Hi")?.mouth).toBe(2); // open for the "i"
  expect(frames.at(-1)?.mouth).toBe(0);
  expect(frames.every(f => f.ms > 0)).toBe(true);
});

test("after \"Hi\" his mouth closes back to his smile and he holds your eye a moment", () => {
  const mouths = helloFrames().map(f => f.mouth);
  const said = mouths.lastIndexOf(3); // the "i" narrowing
  expect(mouths.slice(said + 1)).toEqual([1, 0, 0, 0]);
  expect(helloFrames()[said + 3].ms).toBeGreaterThan(1000);
});

test("his eyes: down for the dots, up at you (with a blink) before he speaks, and away (he's shy) once he's held it", () => {
  const [down, up, away] = helloBeats();
  expect(down.look).toBe("down");
  expect(up).toMatchObject({look: "you", blink: true});
  expect(away.look).not.toBe("you");
  expect(down.ms + up.ms + away.ms).toBeCloseTo(HELLO_MS);
  expect(up.ms).toBeLessThanOrEqual(MAX_EYE_CONTACT);
  // he looks away right after holding your eye
  const frames = helloFrames();
  const held = frames.slice(0, frames.findIndex(f => f.look === "downRight")).reduce((sum, f) => sum + f.ms, 0);
  expect(down.ms + up.ms).toBeCloseTo(held);
  // he's looking up before his mouth opens
  const speaks = frames.slice(0, frames.findIndex(f => f.mouth > 0)).reduce((sum, f) => sum + f.ms, 0);
  expect(down.ms).toBeLessThan(speaks);
});

// each line he says, once, in order
const lines = (frames: SpeechFrame[]) => frames.filter(f => f.said).map(f => f.shown).filter((s, i, all) => s !== all[i - 1]);

test("the first time, he says who he is after his hello, a line at a time, and ends on asking", () => {
  expect(lines(introFrames())).toEqual([HELLO, "I'm Tim.", "I can see your recent transactions,", "so I can help you make sense of your money.", ASK]);
});

test("each line goes on the other side of his head from the one before", () => {
  expect(linesOf(introFrames()).map(l => l.side)).toEqual(["right", "left", "right", "left", "right"]);
  expect(linesOf(helloFrames())).toEqual([{line: HELLO, side: "right"}]);
});

test("his words are as big as they can be with every word fitting beside his head, the same size for all of them", () => {
  const all = linesOf(introFrames());
  expect(wordsFit(all, {left: 200, right: 200})).toBe(22); // plenty of room: as drawn
  const size = wordsFit(all, {left: 98, right: 111}); // a 393pt phone
  expect(size).toBeLessThan(22);
  all.forEach(({line, side}) => line.split(" ").forEach(w => expect(hankenWidth(w, size)).toBeLessThanOrEqual(side === "left" ? 98 : 111)));
  // a size bigger and some word wouldn't fit
  expect(all.some(({line, side}) => line.split(" ").some(w => hankenWidth(w, size + 1) * 1.05 > (side === "left" ? 98 : 111)))).toBe(true);
});

test("text widths come from the font itself", () => {
  expect(hankenWidth("transactions,", 100)).toBeCloseTo(580, -1);
  expect(hankenWidth("Hi", 10)).toBeCloseTo(9.15, 1);
});

test("each word comes with his mouth open, each line ends shut, and it ends with him looking away", () => {
  const frames = introFrames();
  const after = frames.findIndex(f => f.shown === "I'm");
  frames.forEach((f, i) => { if (i >= after && f.shown !== frames[i - 1].shown) expect(f.mouth).toBe(2); });
  frames.filter((f, i) => f.said && !frames[i - 1].said).forEach(f => expect(f.mouth).toBe(0));
  expect(frames.slice(-2)).toMatchObject([{mouth: 0}, {mouth: 0, look: "downRight"}]);
  expect(frames.at(-1)).toMatchObject({shown: ASK, mouth: 0});
  expect(frames.every(f => f.ms > 0)).toBe(true);
});

test("his eyes: at you as he says who he is, down at your payments, back at you to ask, never staring", () => {
  const beats = beatsOf(introFrames());
  expect(beats.map(b => b.look)).toEqual(["down", "you", "downRight", "nearLeft", "you", "downRight"]);
  beats.filter(b => b.look === "you").forEach(b => expect(b.ms).toBeLessThanOrEqual(MAX_EYE_CONTACT));
  expect(beats.reduce((sum, b) => sum + b.ms, 0)).toBeCloseTo(speechMs(introFrames()));
});

test.each(FRANK_HELLOS.map((h, i) => [h.lines[0], i]))("Frank looks at you all through his hello (%s), blinking as each line starts", (_, i) => {
  const frames = frankFrames(i), beats = beatsOf(frames);
  expect(beats.every(b => b.look === "you" && b.blink && !b.typing)).toBe(true);
  expect(beats).toHaveLength(4); // as he starts, and at each line after the first
  expect(beats.reduce((sum, b) => sum + b.ms, 0)).toBeCloseTo(speechMs(frames));
  beats.slice(0, -1).forEach(b => { expect(b.ms).toBeGreaterThan(1500); expect(b.ms).toBeLessThan(6000); });
});

test("Frank's hello is any of his, not always the same one", () => {
  const random = jest.spyOn(Math, "random");
  try {
    const said = FRANK_HELLOS.map((h, i) => {
      random.mockReturnValue((i + 0.5) / FRANK_HELLOS.length);
      return linesOf(frankFrames())[0].line;
    });
    expect(said).toEqual(FRANK_HELLOS.map(h => h.lines[0]));
  } finally {
    random.mockRestore();
  }
});

test("syllables, about right, for his mouth", () => {
  expect(["I'm", "Tim.", "Your", "accountant.", "I've", "anything.", "payments.", "214"].map(syllables)).toEqual([1, 1, 1, 3, 1, 3, 2, 4]);
});

test("with reduced motion, each line is there at once, his mouth still, for as long as it'd take to say", () => {
  const frames = introFrames(), quiet = still(frames);
  expect(quiet.map(f => f.shown)).toEqual(lines(frames));
  expect(quiet.every(f => f.mouth === 0)).toBe(true);
  expect(speechMs(quiet)).toBeCloseTo(speechMs(frames));
  expect(still(helloFrames()).map(f => f.shown)).toEqual([HELLO]);
});
