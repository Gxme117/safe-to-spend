// Tim saying something, the stop-motion way: a list of held poses, each with the words shown so far, his mouth, and where he
// looks from then on.
// His hello, "...Hi": shy, he looks down while the dots come one by one, pauses, looks up at you with a blink, then says it,
// his mouth opening for each letter (H, i held, then narrowing) and closing again. He holds your eye a moment, then glances away
// (he's shy). The words stay after.
// The first time you meet him, he goes on to say who he is, a line at a time beside his head (each replacing the last, on the
// other side of his head from the one before): "I'm Tim.", "I can see your recent transactions," (looking down at them),
// "so I can help you make sense of your money.", then "What would you like to ask me?" back at you, held.
// His mouth opens and half-closes for each syllable as the words come.
// He always smiles. Mouth poses are pieces made from his own picture by scripts/tim_mouth.py: 0 his smile, shut, 1 slightly
// open, 2 open ("e"), 3 narrower ("y"), all opening from the smile.
import {hankenWidth} from "./textWidth";
import {BLINK, ON_TWOS, type Beat, type Look} from "./timEyes";

export type Mouth = 0 | 1 | 2 | 3;
export type Side = "left" | "right";
// line: the whole line this pose is part of; side: which side of his head it goes. look: where he looks from this pose on
// (blink: with a blink). said: the line's all there (the screen reader gets it then).
export type SpeechFrame = {ms: number; shown: string; line: string; side: Side; mouth: Mouth; look?: Look; blink?: boolean; said?: boolean};

const START = 600, DOT = 350, PAUSE = 400, HOLD = 1400 + 2 * ON_TWOS, AWAY = 1200, GAP = 400;
const SPARE = 1.05; // a little more room than the font says, for rounding on screen
const LOOK_UP = BLINK.length * ON_TWOS; // the blink as he looks up, before he speaks
// each letter's mouth, held on twos: H opens a little, i opens and holds, then narrows, then it closes
const SAY: [string, Mouth][] = [["H", 1], ["i", 2], ["i", 2], ["i", 2], ["i", 3], ["i", 1]];

export const HELLO = "...Hi";
export const ASK = "What would you like to ask me?";
// who he is, after his hello, each line on the other side from the one before; looks: where he looks as he starts it
const INTRO: [string, Side, Look?, boolean?][] = [
  ["I'm Tim.", "left"], ["I can see your recent transactions,", "right", "downRight", true],
  ["so I can help you make sense of your money.", "left", "nearLeft"],
];

/** "...Hi": the dots while he looks down, then up at you with a blink, and he says it. Ends with his mouth shut. */
function hey(): SpeechFrame[] {
  const on = {line: HELLO, side: "right"} as const;
  const frames: SpeechFrame[] = [{ms: START, shown: "", ...on, mouth: 0, look: "down"}];
  for (let i = 1; i <= 3; i++) frames.push({ms: i < 3 ? DOT : DOT + PAUSE, shown: ".".repeat(i), ...on, mouth: 0});
  frames.push({ms: LOOK_UP, shown: "...", ...on, mouth: 0, look: "you", blink: true});
  let said = "...";
  SAY.forEach(([letter, mouth], i) => {
    if (i === 0 || SAY[i - 1][0] !== letter) said += letter;
    frames.push({ms: ON_TWOS, shown: said, ...on, mouth});
  });
  frames.push({ms: ON_TWOS, shown: said, ...on, mouth: 0, said: true});
  return frames;
}

/** Done, he holds your eye a moment, then looks away. The words stay. */
const held = (shown: string, side: Side): SpeechFrame[] => [
  {ms: HOLD, shown, line: shown, side, mouth: 0, said: true},
  {ms: AWAY, shown, line: shown, side, mouth: 0, look: "downRight", blink: true, said: true},
];

/** About how many syllables a word has, for his mouth: groups of vowels (a silent e at the end left out); a number, a few. */
export function syllables(word: string): number {
  if (/\d/.test(word)) return word.replace(/\D/g, "").length + 1;
  return word.toLowerCase().replace(/e\b/, "").match(/[aeiouy]+/g)?.length || 1;
}

/** One line, word by word: each word appears with its first syllable, his mouth open then half-closed for each. Ends shut. */
function say(line: string, side: Side, look?: Look, blink?: boolean): SpeechFrame[] {
  const frames: SpeechFrame[] = [];
  let shown = "";
  for (const word of line.split(" ")) {
    shown = shown ? `${shown} ${word}` : word;
    for (let i = 0; i < syllables(word); i++) frames.push({ms: ON_TWOS, shown, line, side, mouth: 2}, {ms: ON_TWOS, shown, line, side, mouth: 1});
  }
  frames.push({ms: ON_TWOS, shown, line, side, mouth: 0, said: true});
  if (look) Object.assign(frames[0], {look, ...(blink && {blink})});
  return frames;
}

/** Long enough to read a line, held after he's said it. */
const readMs = (line: string) => 700 + 25 * line.length;

/** His hello, pose by pose. Played in order; the last pose stays. */
export function helloFrames(): SpeechFrame[] {
  return [...hey(), ...held(HELLO, "right")];
}

/** The first time you meet him: his hello, then who he is, line by line, and he holds your eye. */
export function introFrames(): SpeechFrame[] {
  const frames: SpeechFrame[] = [...hey(), {ms: GAP, shown: HELLO, line: HELLO, side: "right", mouth: 0, said: true}];
  for (const [line, side, look, blink] of INTRO) {
    const f = say(line, side, look, blink);
    f[f.length - 1].ms = readMs(line);
    frames.push(...f);
  }
  return [...frames, ...say(ASK, "right", "you", true), ...held(ASK, "right")];
}

// Frank's, each time his tab opens: deadpan, so no "...Hi" and no looking about, straight to it. He looks at you all through
// it (up from his laptop, with a blink, if he was typing), and blinks as each later line starts, about every 4s as in his frame.
const FRANK_INTRO: [string, Side][] = [
  ["Frank here.", "left"], ["I've already looked through your transactions,", "right"],
  ["so let's not make this harder than it needs to be.", "left"],
];
export const FRANK_ASK = "What do you want?";

/** Frank's hello, a line at a time, each on the other side of his head from the last; the question stays. */
export function frankFrames(): SpeechFrame[] {
  const frames: SpeechFrame[] = [{ms: START, shown: "", line: FRANK_INTRO[0][0], side: "left", mouth: 0, look: "you", blink: true}];
  FRANK_INTRO.forEach(([line, side], i) => {
    const f = i ? say(line, side, "you", true) : say(line, side);
    f[f.length - 1].ms = readMs(line);
    frames.push(...f);
  });
  const ask = say(FRANK_ASK, "right", "you", true);
  ask[ask.length - 1].ms = HOLD;
  return [...frames, ...ask];
}

/** The font size his words go in, so the longest word of every line fits the room beside his head on its side (pt) and nothing
 *  breaks mid-word or runs off the screen: as big as `max`, smaller only when needed, the same for all of them so it doesn't jump
 *  from line to line. Widths are the font's own (lib/textWidth.ts), with a little to spare. */
export function wordsFit(lines: {line: string; side: Side}[], room: Record<Side, number>, max = 22): number {
  let size = max;
  for (const {line, side} of lines)
    for (const word of line.split(" ")) size = Math.min(size, Math.floor(room[side] / (hankenWidth(word, 1) * SPARE)));
  return size;
}

/** Each line he says in a speech, once, with its side. */
export const linesOf = (frames: SpeechFrame[]) =>
  frames.filter((f, i) => f.line && f.line !== frames[i - 1]?.line).map(({line, side}) => ({line, side}));

/** How long a speech takes, end to end. */
export const speechMs = (frames: SpeechFrame[]) => frames.reduce((sum, f) => sum + f.ms, 0);

/** How long his hello takes, end to end. */
export const HELLO_MS = speechMs(helloFrames());

/** Where his eyes are while he speaks: each look held until the next. */
export function beatsOf(frames: SpeechFrame[]): Beat[] {
  const beats: Beat[] = [];
  for (const f of frames) {
    if (f.look) beats.push({look: f.look, ms: 0, ...(f.blink && {blink: true})});
    if (beats.length) beats[beats.length - 1].ms += f.ms;
  }
  return beats;
}

/** Where his eyes are while he says hello: down for the dots, up at you with a blink while he says it, then away. */
export const helloBeats = () => beatsOf(helloFrames());

/** With reduced motion: each line there all at once, for as long as it would have taken to say, his mouth still. */
export function still(frames: SpeechFrame[]): SpeechFrame[] {
  const out: SpeechFrame[] = [];
  for (const f of frames) {
    const last = out[out.length - 1];
    if (last && f.shown.startsWith(last.shown)) { last.ms += f.ms; last.shown = f.shown; }
    else out.push({ms: f.ms, shown: f.shown, line: f.line, side: f.side, mouth: 0, said: true});
  }
  return out;
}
