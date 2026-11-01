// Tim saying something, the stop-motion way: a list of held poses, each with the words shown so far, his mouth, and where he
// looks from then on.
// His hello, "Hi": wise and confident, he's looking at you from the start and says it, his mouth opening for each letter
// (H, i held, then narrowing) and closing again. He holds your eye. The words stay after.
// The first time you meet him, he goes on to say who he is, a line at a time beside his head (each replacing the last, on the
// other side of his head from the one before): "I'm Tim.", "I can see your recent transactions," (glancing down at them),
// "so I can help you make sense of your money." back at you, then "What would you like to ask me?", held.
// His mouth takes each syllable's shape as the words come.
// He always smiles. His mouth is one of the lip-sync shapes (lib/lipsync.ts, X at rest), each shown by a piece made from his
// own picture by scripts/tim_mouth.py, all opening from the smile.
import hellos from "./frankHellos.json";
import recorded from "./frankVoice.json";
import waits from "./frankWaitHellos.json";
import waitRecorded from "./frankWaitVoice.json";
import {lipTrack, vowelShapes, type Shape} from "./lipsync";
import {hankenWidth} from "./textWidth";
import {BLINK, ON_TWOS, type Beat, type Look} from "./timEyes";
import timHellos from "./timHellos.json";
import timRecorded from "./timVoice.json";

export type Mouth = Shape;
export type Side = "left" | "right";
// line: the whole line this pose is part of; side: which side of his head it goes. look: where he looks from this pose on
// (blink: with a blink). said: the line's all there (the screen reader gets it then). voice: the recording of the line, played
// from this pose (his, by voiceKey, or "answer").
export type SpeechFrame = {ms: number; shown: string; line: string; side: Side; mouth: Mouth; look?: Look; blink?: boolean; said?: boolean; voice?: string};
// Something recorded in his voice (scripts/voice.py): the script it was made from, how long it is, when each word is said
// in it (ms from the start), and how loud he is all through it, one digit 0-9 a pose on twos (his mouth opens with it).
type Span = {start: number; end: number};
export type Clip = {text: string; ms: number; words: Span[]; loud?: string};
// Their openings in their voices, by voiceKey (<who>Voice.json, made by scripts/voice.py; the recordings are in
// assets/<who>-voice/).
export const FRANK_VOICE = recorded as Record<string, Clip>;
export const TIM_VOICE = timRecorded as Record<string, Clip>;
// Where he looks from a moment in what he says, ms into it (a blink too, if it's with one).
type Mark = {at: number; look: Look; blink?: boolean};

const START = 600, HOLD = 1400 + 2 * ON_TWOS, GAP = 400;
const SPARE = 1.05; // a little more room than the font says, for rounding on screen
const LOOK_UP = BLINK.length * ON_TWOS; // the blink as he looks up, before he speaks
// each letter's mouth, held on twos: H opens a little, i ("ah-ee") opens wide and holds, then eases to "ee", then it closes
const SAY: [string, Mouth][] = [["H", "B"], ["i", "D"], ["i", "D"], ["i", "D"], ["i", "C"], ["i", "B"]];

export const HELLO = "Hi";
export const ASK = "What would you like to ask me?";
// who he is, after his hello, each line on the other side from the one before; looks: where he looks as he starts it
const INTRO: [string, Side, Look?, boolean?][] = [
  ["I'm Tim.", "left"], ["I can see your recent transactions,", "right", "downRight", true],
  ["so I can help you make sense of your money.", "left", "you", true],
];

/** "Hi": looking at you, he says it. Ends with his mouth shut. */
function hey(): SpeechFrame[] {
  const on = {line: HELLO, side: "right"} as const;
  const frames: SpeechFrame[] = [{ms: START, shown: "", ...on, mouth: "X", look: "you"}];
  let said = "";
  SAY.forEach(([letter, mouth], i) => {
    if (i === 0 || SAY[i - 1][0] !== letter) said += letter;
    frames.push({ms: ON_TWOS, shown: said, ...on, mouth});
  });
  frames.push({ms: ON_TWOS, shown: said, ...on, mouth: "X", said: true});
  return frames;
}

/** Done, he holds your eye. The words stay. */
const held = (shown: string, side: Side): SpeechFrame[] => [{ms: HOLD, shown, line: shown, side, mouth: "X", said: true}];

/** About how many syllables a word has, for his mouth: groups of vowels (a silent e at the end left out); a number, a few. */
export function syllables(word: string): number {
  if (/\d/.test(word)) return word.replace(/\D/g, "").length + 1;
  return word.toLowerCase().replace(/e\b/, "").match(/[aeiouy]+/g)?.length || 1;
}

/** One line, word by word: each word appears with its first syllable, his mouth in the syllable's vowel then a little open for
 *  each. Ends shut. */
function say(line: string, side: Side, look?: Look, blink?: boolean): SpeechFrame[] {
  const frames: SpeechFrame[] = [];
  let shown = "";
  for (const word of line.split(" ")) {
    shown = shown ? `${shown} ${word}` : word;
    const vowels = vowelShapes(word);
    for (let i = 0; i < syllables(word); i++)
      frames.push({ms: ON_TWOS, shown, line, side, mouth: vowels[Math.min(i, vowels.length - 1)]}, {ms: ON_TWOS, shown, line, side, mouth: "B"});
  }
  frames.push({ms: ON_TWOS, shown, line, side, mouth: "X", said: true});
  if (look) Object.assign(frames[0], {look, ...(blink && {blink})});
  return frames;
}

/** Long enough to read a line, held after he's said it. */
const readMs = (line: string) => 700 + 25 * line.length;

const QUIET = 150; // ms: longer than this before his first word (a sigh) and nothing's shown until he says it
const BLINKS = 2000; // Frank blinks as a caption starts, but never sooner than this (ms) after his last blink
const BREATH = 400; // ms: a pause this long in what he says, after a comma or the like, starts a new caption
const CLAUSE = /[,;:]["')]*$/; // a word that ends a clause: a caption can break after it (never mid-phrase, "your | transactions")
const BRIEF = 800; // ms: a caption up for less than this joins the next (as subtitles do: 20 frames at least)
const ENDS = /[.?!…]["')]*$/; // a word that ends a sentence

/** One caption as it's said (`times`: when each of its words is said, ms into the speech; `track`: his mouth on twos all
 *  through it, one shape a pose, lipTrack): each word appears as he starts saying it (before his first, a sigh say, nothing yet), his
 *  mouth as the track has it. Its poses run from `from` to `until` in the speech; once it's all there it waits for the next.
 *  marks: where he looks, at moments in the speech (those in this caption's time are its). */
export function voiced(line: string, times: Span[], from: number, until: number, side: Side, track: string, look?: Look, blink?: boolean, marks: Mark[] = []): SpeechFrame[] {
  const words = line.split(" "), on = {line, side}, mine = marks.filter(m => m.at > from && m.at < until);
  // where what's shown can change (a word starts), where his mouth can (each pose on twos) and where he looks
  const cuts = new Set([from, until, ...times.map(t => t.start).filter(t => t > from && t < until), ...mine.map(m => m.at)]);
  for (let k = Math.ceil(from / ON_TWOS); k * ON_TWOS < until; k++) if (k * ON_TWOS > from) cuts.add(k * ON_TWOS);
  const at = [...cuts].sort((a, b) => a - b), frames: SpeechFrame[] = [];
  for (let c = 0; c < at.length - 1; c++) {
    const n = times.filter(t => t.start <= at[c]).length;
    const shown = n ? words.slice(0, n).join(" ") : times[0].start - from > QUIET ? "" : words[0];
    const mouth = (track[Math.floor(at[c] / ON_TWOS + 1e-6)] ?? "X") as Mouth, last = frames[frames.length - 1];
    const mark = marks.find(m => m.at === at[c]);
    if (last?.shown === shown && last.mouth === mouth && !mark) last.ms += at[c + 1] - at[c];
    else frames.push({ms: at[c + 1] - at[c], shown, ...on, mouth, ...(shown === line && {said: true}), ...(mark && {look: mark.look, ...(mark.blink && {blink: true})})});
  }
  if (look) Object.assign(frames[0], {look, ...(blink && {blink})});
  // whole ms, rounded on the running total so every word still lands on its time in the recording
  let t = 0;
  return frames.map(f => ({...f, ms: Math.round(t + f.ms) - Math.round((t += f.ms) - f.ms)}));
}

/** What he says, cut into captions the way he says it: a new one after he ends a sentence, where he stops for breath after a
 *  comma or the like (a pause mid-phrase doesn't split it), or where the next word wouldn't fit (just after a comma, if
 *  there's one to break at); then one that would be up too briefly joins the next, if they fit together. Each is the words
 *  `from` up to `to`. */
export function captionsOf(words: string[], times: Span[], fits: (text: string) => boolean): {text: string; from: number; to: number}[] {
  const text = (ix: number[]) => ix.map(j => words[j]).join(" ");
  const caps: number[][] = [];
  let cur: number[] = [];
  words.forEach((word, j) => {
    const prev = cur[cur.length - 1];
    const breath = prev !== undefined && CLAUSE.test(words[prev]) && times[j].start - times[prev].end >= BREATH;
    if (prev !== undefined && (ENDS.test(words[prev]) || breath)) { caps.push(cur); cur = []; }
    else if (prev !== undefined && !fits(text([...cur, j]))) {
      const comma = cur.findLastIndex(k => CLAUSE.test(words[k]));
      if (comma >= 0 && comma < cur.length - 1 && fits(text([...cur.slice(comma + 1), j]))) { caps.push(cur.slice(0, comma + 1)); cur = cur.slice(comma + 1); }
      else {
        // a sentence's last word never goes on alone: the word before it goes with it ("your money.")
        const keep = ENDS.test(word) && cur.length > 1 && fits(text([cur[cur.length - 1], j])) ? cur.length - 1 : cur.length;
        caps.push(cur.slice(0, keep)); cur = cur.slice(keep);
      }
    }
    cur.push(j);
  });
  caps.push(cur);
  for (let c = 0; c < caps.length - 1;) {
    const up = times[caps[c + 1][0]].start - times[caps[c][0]].start, both = [...caps[c], ...caps[c + 1]];
    if (up < BRIEF && fits(text(both))) caps.splice(c, 2, both);
    else c++;
  }
  return caps.map(ix => ({text: text(ix), from: ix[0], to: ix[ix.length - 1] + 1}));
}

// His words go beside his head (CAPTION: the page's edge, the gap to him, the biggest size and its line height). Frank's, in
// frank.jpg's px (874 wide, as wide as the screen): his figure at its widest where the words can reach, the row they start
// on, and his shoulders, which spread out below row 511, so they mustn't reach them. frank-dark.jpg (dark mode) has his face in
// the same place and the same figure; its shoulders start a few rows higher, inside CAPTION.gap.
export const CAPTION = {edge: 16, gap: 8, size: 22, leading: 28 / 22};
export const FRANK_BOX = {src: 874, figure: {left: 288, right: 579}, top: 240, floor: 511};
// Tim's, in tim.jpg's px: his hair at its widest, the row his words start on, and his shoulders, past his hair below row 575.
export const TIM_BOX = {src: 874, figure: {left: 271, right: 573}, top: 318, floor: 575};
type Box = typeof FRANK_BOX;
const PHONES = [320, 375, 393, 430, 440]; // pt wide

/** The room either side of him for words (pt), on a screen `width` wide; `figure` in his picture's px, `src` px wide. */
export function roomOf(width: number, figure: {left: number; right: number}, src = FRANK_BOX.src): Record<Side, number> {
  const k = width / src;
  return {left: figure.left * k - CAPTION.gap - CAPTION.edge, right: width - CAPTION.edge - figure.right * k - CAPTION.gap};
}

/** How many rows a line takes, `size` pt, wrapped word by word in `room` pt (widths as wordsFit has them). */
export function rowsOf(line: string, size: number, room: number): number {
  let rows = 1, run = 0;
  for (const word of line.split(" ")) {
    const w = hankenWidth(word, size) * SPARE, gap = run ? hankenWidth(" ", size) : 0;
    if (run && run + gap + w > room) { rows++; run = w; } else run += gap + w;
  }
  return rows;
}

/** Whether a caption fits beside his head (`box`) above his shoulders on every phone, either side, however big his words
 *  come out: never bigger than the longest word of all he says allows (wordsFit), and a bigger size never takes fewer rows. */
export function fitsBeside(box: Box, words: string[]): (text: string) => boolean {
  const longest = Math.max(...words.map(w => hankenWidth(w, 1))) * SPARE;
  return text => PHONES.every(width => {
    const room = roomOf(width, box.figure, box.src), k = width / box.src;
    const size = Math.min(CAPTION.size, Math.floor(Math.max(room.left, room.right) / longest));
    const rows = Math.max(rowsOf(text, size, room.left), rowsOf(text, size, room.right));
    return box.top * k + rows * Math.round(size * CAPTION.leading) <= box.floor * k;
  });
}

/** Whether a caption of Frank's fits beside his head above his shoulders on every phone. */
export const frankFits = (words: string[]) => fitsBeside(FRANK_BOX, words);

/** His hello, pose by pose. Played in order; the last pose stays. */
export function helloFrames(): SpeechFrame[] {
  return [...hey(), ...held(HELLO, "right")];
}

/** The first time you meet him: his hello, then who he is, line by line, and he holds your eye. */
export function introFrames(): SpeechFrame[] {
  const frames: SpeechFrame[] = [...hey(), {ms: GAP, shown: HELLO, line: HELLO, side: "right", mouth: "X", said: true}];
  for (const [line, side, look, blink] of INTRO) {
    const f = say(line, side, look, blink);
    f[f.length - 1].ms = readMs(line);
    frames.push(...f);
  }
  return [...frames, ...say(ASK, "right"), ...held(ASK, "right")];
}

// Frank's opening, each time his tab opens: no "...Hi" and no looking about, straight to it. He's a grumpy old accountant
// who's had enough of the job (fees, waste), never of you, so it's a different grumble each time. Each is one script in
// frankHellos.json, written to be heard: how he says it in [audio tags] ("[sighs] Frank here.") and its cadence in its
// punctuation (an ellipsis for a pause). scripts/frank_voice.py records it in his voice in one take, and everything here
// follows the recording: it's cut into captions where he ends a sentence or stops for breath, each word shows as he says it,
// and his mouth follows the words, opening with how loud he is (lipTrack). He looks at you all through it (up from his laptop, with a
// blink, if he was typing), and blinks as a caption starts, if he hasn't just. The tags are for his voice, never shown.
export const FRANK_OPENINGS = (hellos as {script: string}[]).map(h => h.script);

/** A script as it's shown: its audio tags left out, three dots an ellipsis. */
export const untagged = (script: string) => script.replace(/\[[^\]]*\]/g, " ").replace(/\.\.\./g, "…").replace(/\s+/g, " ").trim();

/** Which recording of his is opening `i`: all of it, in one take. */
export const voiceKey = (i: number) => `h${i}`;

/** When each word would be said at his own pace, for an opening that isn't recorded: two poses a syllable, and after each
 *  sentence long enough to read it. */
function paced(words: string[]): Clip {
  const spans: Span[] = [];
  let t = 0, sentence: string[] = [];
  for (const word of words) {
    spans.push({start: t, end: t += syllables(word) * 2 * ON_TWOS});
    sentence.push(word);
    if (ENDS.test(word)) { t += readMs(sentence.join(" ")); sentence = []; }
  }
  return {text: "", ms: spans[spans.length - 1].end, words: spans};
}

/** Frank's opening (one of FRANK_OPENINGS, any of them unless `i` says which), caption by caption, each on the other side of
 *  his head from the last; the last (his question) stays. Recorded in his voice (`voice`), the first caption's first pose
 *  plays it, and everything is where the recording has it; not recorded, it's at his own pace. */
export function frankFrames(i = Math.floor(Math.random() * FRANK_OPENINGS.length), voice: Record<string, Clip> = FRANK_VOICE, scripts = FRANK_OPENINGS): SpeechFrame[] {
  const script = scripts[i], words = untagged(script).split(" ");
  const clip = voice[voiceKey(i)], recorded = clip?.text === script && clip.words.length === words.length;
  const {words: times, ms, loud} = recorded ? clip : paced(words);
  const track = lipTrack(words, times, ms, loud);
  const caps = captionsOf(words, times, frankFits(words));
  const frames: SpeechFrame[] = [{ms: START, shown: "", line: caps[0].text, side: "left", mouth: "X", look: "you", blink: true}];
  let blinked = -START; // when he last blinked, ms into the speech
  caps.forEach((cap, n) => {
    const from = n ? times[cap.from].start : 0, until = n < caps.length - 1 ? times[caps[n + 1].from].start : ms + HOLD;
    const blink = n > 0 && from - blinked >= BLINKS;
    if (blink) blinked = from;
    frames.push(...voiced(cap.text, times.slice(cap.from, cap.to), from, until, n % 2 ? "right" : "left", track, blink ? "you" : undefined, blink));
  });
  if (recorded) frames[1].voice = voiceKey(i);
  return frames;
}

// What Frank says while he writes his briefing ("Just a second…"), recorded as his openings are (scripts/voice.py --who
// frankWait), and played the same way, from its own recording.
export const FRANK_WAITS = (waits as {script: string}[]).map(h => h.script);
export const waitFrames = () => frankFrames(0, waitRecorded as Record<string, Clip>, FRANK_WAITS);

// Tim's opening in his voice: his hello and who he is, one script in timHellos.json (written to be heard, as Frank's are),
// recorded in one take by scripts/voice.py --who tim. Everything follows the recording, as Frank's does. He's wise and
// confident: he's looking at you as he starts, and where he looks after is the script's (`looks`: from a word on, a blink
// too, starting just before it so his eyes are there as he says it), and he ends holding your eye. Captions go right, left,
// right… and fit beside his head above his shoulders (TIM_BOX).
type Glance = {at: string; look: Look; blink?: boolean};
const TIM_HELLO = timHellos[0] as {script: string; looks?: Glance[]};
export const TIM_OPENING = TIM_HELLO.script;

/** A word as the script's `looks` name it: no punctuation, any case. */
const bare = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/** Tim's opening, caption by caption, in his voice (`voice`); not recorded as it's written now, it's his hello as he says it
 *  without a voice (introFrames). */
export function timFrames(voice: Record<string, Clip> = TIM_VOICE): SpeechFrame[] {
  const words = untagged(TIM_OPENING).split(" "), clip = voice[voiceKey(0)];
  if (clip?.text !== TIM_OPENING || clip.words.length !== words.length) return introFrames();
  const {words: times, ms, loud} = clip;
  const track = lipTrack(words, times, ms, loud);
  const caps = captionsOf(words, times, fitsBeside(TIM_BOX, words));
  const marks: Mark[] = (TIM_HELLO.looks ?? []).flatMap(g => {
    const j = words.findIndex(w => bare(w) === bare(g.at));
    return j < 0 ? [] : [{at: Math.max(0, times[j].start - (g.blink ? LOOK_UP : 0)), look: g.look, ...(g.blink && {blink: true})}];
  });
  const frames: SpeechFrame[] = [{ms: START, shown: "", line: caps[0].text, side: "right", mouth: "X", look: "you"}];
  caps.forEach((cap, n) => {
    const from = n ? times[cap.from].start : 0, until = n < caps.length - 1 ? times[caps[n + 1].from].start : ms + HOLD;
    frames.push(...voiced(cap.text, times.slice(cap.from, cap.to), from, until, n % 2 ? "left" : "right", track, undefined, undefined, marks));
  });
  frames[1].voice = voiceKey(0);
  return frames;
}

/** A line of his answer as ElevenLabs recorded it (the accountant function's /say): where the take is on the phone, how long
 *  it is, and when each word is said. */
export type Take = {uri: string; ms: number; words: Span[]};

/** The line of his answer Frank says out loud, from his bubble: the same as an opening (captions cut where he ends a sentence
 *  or stops for breath, or where the next word wouldn't fit `fits`, each word as he says it, his mouth from when each is
 *  said), after a blink as he looks up at you. The first pose with the take plays it (`voice`). If the take's words don't
 *  line up with the line's, they're spread over it evenly, so he still says it. */
export function answerFrames(line: string, take: Pick<Take, "ms" | "words">, fits: (text: string) => boolean): SpeechFrame[] {
  const words = untagged(line).split(" ");
  const times = take.words.length === words.length ? take.words
    : words.map((_, j) => ({start: j * take.ms / words.length, end: (j + 1) * take.ms / words.length}));
  const track = lipTrack(words, times, take.ms), caps = captionsOf(words, times, fits);
  const frames: SpeechFrame[] = [{ms: LOOK_UP, shown: "", line: caps[0].text, side: "right", mouth: "X", look: "you", blink: true}];
  caps.forEach((cap, n) => {
    const from = n ? times[cap.from].start : 0, until = n < caps.length - 1 ? times[caps[n + 1].from].start : take.ms + HOLD;
    frames.push(...voiced(cap.text, times.slice(cap.from, cap.to), from, until, "right", track));
  });
  frames[1].voice = "answer";
  return frames;
}

/** Whether a caption fits beside his bubble, in `room` pt at `size`, in `rows` rows at most. */
export const bubbleFits = (room: number, size: number, rows: number) => (text: string) => rowsOf(text, size, room) <= rows;

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

/** Where his eyes are from pose `i` on: as they were until his next look, then each look held until the next. */
export function beatsFrom(frames: SpeechFrame[], i: number): Beat[] {
  if (frames[i].look) return beatsOf(frames.slice(i));
  const now = frames.slice(0, i).findLast(f => f.look)?.look ?? "you", next = frames.findIndex((f, j) => j > i && f.look);
  return [{look: now, ms: speechMs(frames.slice(i, next < 0 ? undefined : next))}, ...beatsOf(frames.slice(i))];
}

/** Where his eyes are while he says hello: down for the dots, up at you with a blink while he says it, then away. */
export const helloBeats = () => beatsOf(helloFrames());

/** With reduced motion: each line there all at once, for as long as it would have taken to say, his mouth still. A recorded
 *  line still plays, from when it would have. */
export function still(frames: SpeechFrame[]): SpeechFrame[] {
  const out: SpeechFrame[] = [];
  for (const f of frames) {
    const last = out[out.length - 1];
    if (last && !f.voice && f.line === last.line) { last.ms += f.ms; last.shown = f.shown; }
    else out.push({ms: f.ms, shown: f.shown, line: f.line, side: f.side, mouth: "X", said: true, ...(f.voice && {voice: f.voice})});
  }
  return out;
}
