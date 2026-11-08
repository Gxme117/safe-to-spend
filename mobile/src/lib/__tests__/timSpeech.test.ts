import {MAX_EYE_CONTACT, ON_TWOS} from "@/lib/timEyes";
import {hankenWidth} from "@/lib/textWidth";
import {lipTrack} from "@/lib/lipsync";
import {answerFrames, ASK, beatsFrom, bubbleFits, beatsOf, captionsOf, FILM_OPENING, FILM_VOICE, FRANK_BOX, FRANK_OPENINGS, FRANK_VOICE, frankFrames, HELLO, HELLO_MS, helloBeats, helloFrames, introFrames, linesOf, roomOf, speechMs, still, syllables, TIM_BOX, TIM_OPENING, TIM_VOICE, timFrames, untagged, voiced, voiceKey, wordsFit, type Clip, type SpeechFrame} from "@/lib/timSpeech";

test("his hello is just \"Hi\", no hesitating dots, and it stays", () => {
  const shown = helloFrames().map(f => f.shown);
  expect(HELLO).toBe("Hi");
  expect(shown.some(s => s.includes("."))).toBe(false);
  expect(shown.at(-1)).toBe(HELLO);
  // never goes backwards
  shown.forEach((s, i) => { if (i) expect(s.startsWith(shown[i - 1])).toBe(true); });
});

test("his mouth moves for each letter, and ends shut", () => {
  const frames = helloFrames();
  expect(frames[0]).toMatchObject({shown: "", mouth: "X"});
  expect(frames.find(f => f.shown === "H")?.mouth).not.toBe("X");
  expect(frames.find(f => f.shown === "Hi")?.mouth).toBe("D"); // wide for the "i" (ah-ee)
  expect(frames.at(-1)?.mouth).toBe("X");
  expect(frames.every(f => f.ms > 0)).toBe(true);
});

test("after \"Hi\" his mouth closes back to his smile and he holds your eye", () => {
  const mouths = helloFrames().map(f => f.mouth);
  const said = mouths.lastIndexOf("C"); // the "i" easing to "ee"
  expect(mouths.slice(said + 1)).toEqual(["B", "X", "X"]);
  expect(helloFrames()[said + 3].ms).toBeGreaterThan(1000);
});

test("his eyes: on you all through his hello, confident, no glancing away", () => {
  const beats = helloBeats();
  expect(beats).toEqual([{look: "you", ms: expect.any(Number)}]);
  expect(beats[0].ms).toBeCloseTo(HELLO_MS);
  expect(beats[0].ms).toBeLessThanOrEqual(MAX_EYE_CONTACT);
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

test("each word comes with his mouth open on its vowel, each line ends shut, and it ends with him holding your eye", () => {
  const frames = introFrames();
  const after = frames.findIndex(f => f.shown === "I'm");
  frames.forEach((f, i) => { if (i >= after && f.shown !== frames[i - 1].shown) expect(f.mouth).not.toBe("X"); });
  expect(frames.find(f => f.shown === "I'm")?.mouth).toBe("D");
  expect(frames.find(f => f.shown.endsWith("you"))?.mouth).toBe("F");
  frames.filter((f, i) => f.said && !frames[i - 1].said).forEach(f => expect(f.mouth).toBe("X"));
  expect(frames.slice(-2)).toMatchObject([{mouth: "X"}, {mouth: "X"}]);
  expect(frames.at(-1)).toMatchObject({shown: ASK, mouth: "X"});
  expect(beatsOf(frames).at(-1)?.look).toBe("you");
  expect(frames.every(f => f.ms > 0)).toBe(true);
});

test("his eyes: at you as he says who he is, a glance down at your payments, then back at you to the end", () => {
  const beats = beatsOf(introFrames());
  expect(beats.map(b => b.look)).toEqual(["you", "downRight", "you"]);
  expect(beats.reduce((sum, b) => sum + b.ms, 0)).toBeCloseTo(speechMs(introFrames()));
});

test.each(FRANK_OPENINGS.map((s, i) => [untagged(s), i]))("Frank looks at you all through his opening (%s), blinking as captions start", (_, i) => {
  for (const frames of [frankFrames(i), frankFrames(i, {})]) { // in his voice, and at his own pace
    const beats = beatsOf(frames);
    expect(beats.every(b => b.look === "you" && b.blink && !b.typing)).toBe(true);
    expect(beats.length).toBeGreaterThanOrEqual(2); // as he starts, and as some captions after the first start
    expect(beats.reduce((sum, b) => sum + b.ms, 0)).toBeCloseTo(speechMs(frames));
    beats.slice(0, -1).forEach(b => { expect(b.ms).toBeGreaterThanOrEqual(2000); expect(b.ms).toBeLessThan(8000); });
  }
});

test("Frank's opening is any of his, not always the same one", () => {
  const random = jest.spyOn(Math, "random");
  try {
    FRANK_OPENINGS.forEach((script, i) => {
      random.mockReturnValue((i + 0.5) / FRANK_OPENINGS.length);
      expect(untagged(script).startsWith(linesOf(frankFrames())[0].line)).toBe(true);
    });
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
  expect(quiet.every(f => f.mouth === "X")).toBe(true);
  expect(speechMs(quiet)).toBeCloseTo(speechMs(frames));
  expect(still(helloFrames()).map(f => f.shown)).toEqual([HELLO]);
});

// Frank's voice: words said at these times (ms)
const spans = (times: [number, number][]) => times.map(([start, end]) => ({start, end}));
const startOf = (frames: SpeechFrame[], i: number) => frames.slice(0, i).reduce((sum, f) => sum + f.ms, 0);
/** His mouth `t` ms into a speech. */
const mouthAt = (frames: SpeechFrame[], t: number) => {
  let at = 0;
  for (const f of frames) { if (t < at + f.ms) return f.mouth; at += f.ms; }
  return frames[frames.length - 1].mouth;
};

test("a caption as he says it: each word appears as he starts it, his mouth as the recording has it, all there until the next", () => {
  const words = ["Frank", "here."], times = spans([[80, 420], [700, 1000]]); // a pause after "Frank"
  const track = lipTrack(words, times, 1000);
  const frames = voiced("Frank here.", times, 0, 1750, "left", track);
  expect(frames[0]).toMatchObject({shown: "Frank"}); // a breath, not a sigh: his first word's there from the start
  const at = (shown: string) => startOf(frames, frames.findIndex(f => f.shown === shown));
  expect(at("Frank here.")).toBe(700);
  for (let k = 0; k < 21; k++) expect(mouthAt(frames, (k + .5) * ON_TWOS)).toBe(track[k] ?? "X");
  expect(mouthAt(frames, 550)).toBe("X"); // shut in the pause
  expect(frames.at(-1)).toMatchObject({shown: "Frank here.", mouth: "X", said: true});
  expect(frames.filter(f => f.said).every(f => f.shown === "Frank here.")).toBe(true);
  expect(speechMs(frames)).toBe(1750);
});

test("a sigh before his first word: nothing shown until he says it", () => {
  const frames = voiced("Frank here.", spans([[550, 880], [930, 1120]]), 0, 2000, "left", "XBBBBBXCCCBBXCCCBXXXXXXXX");
  expect(frames[0]).toMatchObject({shown: "", mouth: "X"});
  expect(startOf(frames, frames.findIndex(f => f.shown === "Frank"))).toBe(550);
  expect(frames.filter(f => f.shown === "").every(f => "XB".includes(f.mouth))).toBe(true);
});

// captions measured simply: so many characters at most
const upTo = (n: number) => (text: string) => text.length <= n;
const evenly = (words: string[], gaps: Record<number, number> = {}) => {
  let t = 0;
  return words.map((_, j) => { t += gaps[j] ?? 0; const s = {start: t, end: t + 250}; t += 300; return s; });
};
const cut = (line: string, fits = upTo(40), gaps: Record<number, number> = {}) => {
  const words = line.split(" ");
  return captionsOf(words, evenly(words, gaps), fits).map(c => c.text);
};

test("captions break where he ends a sentence, and a brief one joins the next", () => {
  expect(cut("Oh. It's you. I've checked every penny.")).toEqual(["Oh. It's you.", "I've checked every penny."]);
  expect(cut("Frank. Accountant. Unfortunately.", upTo(40), {1: 200, 2: 900})).toEqual(["Frank. Accountant.", "Unfortunately."]);
  expect(cut("Frank. Accountant. Unfortunately.", upTo(40), {1: 600, 2: 900})).toEqual(["Frank.", "Accountant.", "Unfortunately."]);
});

test("captions break where he stops for breath after a comma, never in the middle of a phrase", () => {
  expect(cut("Well, I suppose so.", upTo(40), {1: 700})).toEqual(["Well,", "I suppose so."]);
  expect(cut("I've been through your transactions.", upTo(40), {4: 700})).toEqual(["I've been through your transactions."]);
});

test("a caption that wouldn't fit beside him breaks, just after a comma if there's one, never leaving a sentence's last word alone", () => {
  expect(cut("One, two three four five.", upTo(16))).toEqual(["One, two three", "four five."]);
  const all = cut("I've already been through every one of your transactions this month.", upTo(20));
  all.forEach(c => expect(c.length).toBeLessThanOrEqual(20));
  expect(all.join(" ")).toBe("I've already been through every one of your transactions this month.");
});

// an opening in one take: each word 250ms, 50ms between, `pause` more after each sentence, his mouth as the words have it
function take(i: number, pause = 300): Clip {
  const words = untagged(FRANK_OPENINGS[i]).split(" "), spans: {start: number; end: number}[] = [];
  let t = 400; // he takes a breath first
  words.forEach(w => { spans.push({start: t, end: t + 250}); t += 300 + (/[.?!…]$/.test(w) ? pause : 0); });
  return {text: FRANK_OPENINGS[i], ms: t, words: spans};
}
/** When each word of a speech first shows (ms), counting on from the captions before. */
function shownAt(frames: SpeechFrame[]): number[] {
  const at: number[] = [];
  let t = 0, done = 0;
  frames.forEach((f, j) => {
    if (j && f.line !== frames[j - 1].line) done += frames[j - 1].line.split(" ").length;
    const n = f.shown ? f.shown.split(" ").length : 0;
    while (at.length < done + n) at.push(t);
    t += f.ms;
  });
  return at;
}

test("Frank says his opening in one go, as recorded: each caption goes up as he starts it, each word as he says it", () => {
  const voice = {[voiceKey(0)]: take(0)}, frames = frankFrames(0, voice), START = frames[0].ms;
  // the recording plays once, from as he starts
  expect(frames.filter(f => f.voice)).toEqual([expect.objectContaining({voice: "h0"})]);
  expect(startOf(frames, frames.findIndex(f => f.voice))).toBe(START);
  expect(shownAt(frames)).toEqual(voice.h0.words.map(w => START + w.start));
  // all of it, in captions either side of his head in turn, his question last, staying
  const caps = linesOf(frames);
  expect(caps.map(c => c.line).join(" ")).toBe(untagged(FRANK_OPENINGS[0]));
  caps.forEach((c, n) => expect(c.side).toBe(n % 2 ? "right" : "left"));
  expect(caps.at(-1)!.line).toMatch(/\?$/);
  expect(frames.at(-1)).toMatchObject({shown: caps.at(-1)!.line, said: true, mouth: "X"});
  expect(speechMs(frames)).toBeGreaterThan(START + voice.h0.ms + 1000);
});

test("his mouth opens with how loud the recording is, when it has a loudness that fits it", () => {
  const plain = take(1), ticks = Math.ceil(plain.ms * 12 / 1000);
  const mouths = (loud?: string) => frankFrames(1, {[voiceKey(1)]: {...plain, loud}}).map(f => f.mouth);
  // shouting, the open vowels go wide; whispering, they barely open
  expect(mouths("9".repeat(ticks))).toContain("D");
  expect(mouths("1".repeat(ticks))).not.toContain("D");
  // one that doesn't fit the recording (made from another take) isn't used
  expect(mouths("1".repeat(ticks - 1))).toEqual(mouths());
});

test("in one go, he blinks as a caption starts, but never twice close together", () => {
  for (const pause of [50, 300, 1500]) {
    const frames = frankFrames(0, {[voiceKey(0)]: take(0, pause)}), beats = beatsOf(frames);
    expect(beats[0]).toMatchObject({look: "you", blink: true});
    beats.slice(0, -1).forEach(b => expect(b.ms).toBeGreaterThanOrEqual(2000));
    frames.filter(f => f.blink).slice(1).forEach(f => expect(frames[frames.indexOf(f) - 1].line).not.toBe(f.line));
  }
});

test("his eyes from part way through: as they were until his next look, then each look in turn", () => {
  const frames = frankFrames(0, {[voiceKey(0)]: take(0)}), v = frames.findIndex(f => f.voice);
  const beats = beatsFrom(frames, v), next = frames.findIndex((f, j) => j > v && f.look);
  expect(beats[0]).toEqual({look: "you", ms: startOf(frames, next) - startOf(frames, v)});
  expect(beats.slice(1)).toEqual(beatsOf(frames.slice(next)));
  expect(beatsFrom(frames, next)).toEqual(beatsOf(frames.slice(next)));
});

test("a recording of words that aren't his opening any more isn't used: he says it at his own pace", () => {
  const stale = {...take(0), text: "[sighs] Frank's here. And so on."};
  expect(frankFrames(0, {[voiceKey(0)]: stale}).some(f => f.voice)).toBe(false);
  expect(frankFrames(0, {}).some(f => f.voice)).toBe(false);
  expect(linesOf(frankFrames(0, {})).map(c => c.line).join(" ")).toBe(untagged(FRANK_OPENINGS[0]));
});

test("with reduced motion, his voice still plays, from when it would have, each caption there at once", () => {
  const frames = frankFrames(0, {[voiceKey(0)]: take(0)}), quiet = still(frames);
  expect(quiet.filter(f => f.voice)).toHaveLength(1);
  expect(startOf(quiet, quiet.findIndex(f => f.voice))).toBe(startOf(frames, frames.findIndex(f => f.voice)));
  expect(speechMs(quiet)).toBe(speechMs(frames));
  expect(quiet.filter(f => f.shown).map(f => f.shown)).toEqual(linesOf(frames).map(c => c.line));
});

test("how he says it ([sighs], an ellipsis) is for his voice: the tags never show", () => {
  expect(untagged("[sighs] Frank here.")).toBe("Frank here.");
  expect(untagged("They add up... [dryly] unlike most things.")).toBe("They add up… unlike most things.");
  for (const script of FRANK_OPENINGS) {
    expect(script).toMatch(/\[[a-z ,]+\]/); // he says each with some feeling
    untagged(script).split(" ").forEach(w => expect(w).toMatch(/[A-Za-z0-9]/)); // every word shown is one (no lone dashes)
  }
});

test.each(FRANK_OPENINGS.map((s, i) => [untagged(s), i]))("Frank's captions (%s) stay beside his head, above his shoulders (row 511 of frank.jpg), on any phone", (_, i) => {
  for (const frames of [frankFrames(i), frankFrames(i, {})]) {
    const lines = linesOf(frames);
    for (const width of [320, 375, 393, 430, 440]) {
      const k = width / 874, room = roomOf(width, FRANK_BOX.figure);
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
  }
});

test("Tim's recording is of his hello as it is now (change it and run scripts/voice.py --who tim again)", () => {
  const {text, words, ms, loud} = TIM_VOICE[voiceKey(0)];
  expect(text).toBe(TIM_OPENING);
  expect(words).toHaveLength(untagged(text).split(" ").length);
  expect(loud).toHaveLength(Math.ceil(ms * 12 / 1000));
  expect(timFrames().filter(f => f.voice)).toEqual([expect.objectContaining({voice: voiceKey(0)})]);
  // not recorded as written, it's his hello without a voice
  expect(timFrames({})).toEqual(introFrames());
});

test("Tim says it with confidence: at you as he says \"Hi\", a glance down at your transactions, and back at you to the end", () => {
  const frames = timFrames(), looks = frames.filter(f => f.look).map(f => [f.look, !!f.blink]);
  expect(frames[0]).toMatchObject({shown: "", look: "you"});
  expect(looks).toEqual([["you", false], ["downRight", true], ["you", true]]);
  // each look comes before its word is said
  const at = (look: string) => speechMs(frames.slice(0, frames.findIndex(f => f.look === look && f !== frames[0])));
  const said = (word: string) => speechMs(frames.slice(0, frames.findIndex(f => f.shown.split(" ").includes(word))));
  expect(at("downRight")).toBeLessThanOrEqual(said("see"));
  expect(at("you")).toBeLessThanOrEqual(said("so"));
  // and it ends on his question, said
  expect(frames.at(-1)).toMatchObject({shown: expect.stringContaining("What would you like to ask me?"), mouth: "X", said: true});
  expect(linesOf(frames).map(l => l.line).join(" ")).toBe(untagged(TIM_OPENING));
  expect(linesOf(frames).map(l => l.side)).toEqual(linesOf(frames).map((_, n) => n % 2 ? "left" : "right"));
});

test("Tim's captions stay beside his head, above his shoulders (row 575 of tim.jpg), on any phone", () => {
  const lines = linesOf(timFrames());
  for (const width of [320, 375, 393, 430, 440]) {
    const k = width / 874, room = roomOf(width, TIM_BOX.figure);
    const size = wordsFit(lines, room, 22), lineHeight = Math.round(size * 28 / 22);
    for (const {line, side} of lines) {
      let rows = 1, run = 0;
      for (const word of line.split(" ")) {
        const w = hankenWidth(word, size) * 1.05, gap = run ? hankenWidth(" ", size) : 0;
        if (run && run + gap + w > room[side]) { rows++; run = w; } else run += gap + w;
      }
      expect(318 * k + rows * lineHeight).toBeLessThanOrEqual(575 * k);
    }
  }
});

test("Frank's recordings are of his openings as they are now (change one and run scripts/voice.py again)", () => {
  for (const [key, {text, words, ms, loud}] of Object.entries(FRANK_VOICE)) {
    const i = Number(key.match(/^h(\d+)$/)![1]);
    expect(text).toBe(FRANK_OPENINGS[i]);
    expect(words).toHaveLength(untagged(text).split(" ").length);
    expect(loud).toHaveLength(Math.ceil(ms * 12 / 1000));
    // and the app uses each of them
    expect(frankFrames(i).some(f => f.voice === key)).toBe(true);
  }
});

test("Frank says the line of his answer as he says his openings: after a blink, each word as he says it, the take played once", () => {
  const line = "[sighs] Yes... you can have them. [dryly] Rent's out Friday, mind.";
  const words = untagged(line).split(" "), spans = words.map((_, j) => ({start: 200 + j * 400, end: 500 + j * 400}));
  const ms = spans.at(-1)!.end + 100, frames = answerFrames(line, {ms, words: spans}, () => true);
  expect(frames[0]).toMatchObject({shown: "", look: "you", blink: true});
  expect(frames.filter(f => f.voice)).toEqual([expect.objectContaining({voice: "answer"})]);
  const START = frames[0].ms;
  expect(shownAt(frames)).toEqual(spans.map(w => START + w.start));
  // cut where he ends a sentence; the tags never show
  expect(linesOf(frames).map(c => c.line)).toEqual(["Yes… you can have them.", "Rent's out Friday, mind."]);
  expect(frames.at(-1)).toMatchObject({shown: "Rent's out Friday, mind.", said: true, mouth: "X"});
  // his mouth follows the words: the lips shut on the m of "them" and "mind"
  expect(frames.some(f => f.mouth === "A")).toBe(true);
  // a take whose words don't line up still gets said, spread over it
  const odd = answerFrames(line, {ms: 3000, words: spans.slice(1)}, () => true);
  expect(linesOf(odd).map(c => c.line).join(" ")).toBe(untagged(line));
});

test("beside his bubble, a caption is cut where it wouldn't fit", () => {
  const line = "[sighs] There's two hundred and forty pounds left before payday and the gas bill comes out on Tuesday so keep some back";
  const words = untagged(line).split(" "), spans = words.map((_, j) => ({start: j * 300, end: j * 300 + 250}));
  const fits = bubbleFits(160, 18, 3), caps = linesOf(answerFrames(line, {ms: spans.at(-1)!.end, words: spans}, fits));
  expect(caps.length).toBeGreaterThan(1);
  caps.forEach(c => expect(fits(c.line)).toBe(true));
});

test("Frank's video opening is of the script as it is now, its words in order, and its captions follow them (change the script and make the video again)", () => {
  const key = voiceKey(FILM_OPENING), clip = FILM_VOICE[key], words = untagged(FRANK_OPENINGS[FILM_OPENING]).split(" ");
  expect(clip.text).toBe(FRANK_OPENINGS[FILM_OPENING]);
  expect(clip.words).toHaveLength(words.length);
  clip.words.forEach((w, j) => {
    expect(w.end).toBeGreaterThan(w.start);
    if (j) expect(w.start).toBeGreaterThanOrEqual(clip.words[j - 1].end);
  });
  expect(clip.words.at(-1)!.end).toBeLessThanOrEqual(clip.ms);
  // it plays the video's sound from the first caption, and says all of it
  const frames = frankFrames(FILM_OPENING, FILM_VOICE);
  expect(frames.filter(f => f.voice === key)).toHaveLength(1);
  expect(untagged(FRANK_OPENINGS[FILM_OPENING]).startsWith(linesOf(frames)[0].line)).toBe(true);
  expect(linesOf(frames).map(c => c.line).join(" ")).toBe(words.join(" "));
});
