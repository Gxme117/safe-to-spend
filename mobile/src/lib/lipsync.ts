// How Tim's and Frank's mouths follow what they say, the way animators lip-sync. A small set of mouth shapes
// (mouthShapes.json: the Hanna-Barbera / Preston Blair set, as Rhubarb Lip Sync names it), worked out from the spelling and
// when each word is said. It hits the vowels and the closes (m, b, p always shut the lips, for a pose at least) rather than
// every letter; each shape is held on twos, a pose ahead of the sound so it reads as you hear it; a louder or longer vowel
// opens wider, a quiet one less; short gaps between words don't shut the mouth, pauses do. Pure.
import table from "./mouthShapes.json";
import {ON_TWOS} from "./timEyes";

/** X rest, A m b p, B most consonants and ee, C e and a (cat), D ah, E o and er, F oo and w, G f v, H l. */
export type Shape = keyof typeof table.shapes;
export const SHAPES = Object.keys(table.shapes) as Shape[];
type Span = {start: number; end: number};
type Unit = {shape: Shape; vowel: boolean};

const LEAD = 1; // poses the mouth is ahead of the sound
const JOIN = 150; // ms: a gap between words this short doesn't shut the mouth
const CLOSE = ON_TWOS / 4; // ms of an m, b or p in a pose and the lips shut for it
// which shape a pose takes when it has several in it: the ones you'd notice missing first
const WEIGHT: Record<Shape, number> = {X: 0, A: 0, B: 0.6, C: 1, D: 1, H: 1, E: 1.3, F: 1.3, G: 1.5};

// spelling to shapes, longest first; vowels take about twice as long to say as consonants
const VOWELS: [string, Shape][] = [
  ["igh", "D"], ["oo", "F"], ["ew", "F"], ["ue", "F"], ["ou", "E"], ["ow", "E"], ["oa", "E"], ["oi", "E"], ["oy", "E"],
  ["au", "E"], ["aw", "E"], ["or", "E"], ["er", "E"], ["ir", "E"], ["ur", "E"], ["ar", "D"],
  ["ee", "B"], ["ea", "B"], ["ie", "B"], ["ey", "B"], ["ai", "C"], ["ay", "C"], ["ei", "C"],
  ["a", "C"], ["e", "C"], ["i", "C"], ["o", "E"], ["u", "C"], ["y", "B"],
];
const CONSONANTS: [string, Shape | null][] = [
  ["th", "B"], ["sh", "B"], ["ch", "B"], ["ph", "G"], ["wh", "F"], ["qu", "F"], ["ck", "B"], ["ng", "B"], ["gh", null],
  ["m", "A"], ["b", "A"], ["p", "A"], ["f", "G"], ["v", "G"], ["l", "H"], ["w", "F"], ["h", null],
];
// a vowel made long by a silent e after the next letter ("time", "make", "use"): how it's said then
const LONG: Record<string, Shape> = {a: "C", i: "D", o: "E", u: "F"};

/** The shapes a word is said with, in order, from its spelling (a number: open and shut for each digit). */
export function visemesOf(word: string): Unit[] {
  if (/\d/.test(word)) return word.replace(/\D/g, "").split("").flatMap(() => [{shape: "C" as Shape, vowel: true}, {shape: "B" as Shape, vowel: false}]);
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w === "i" || /^i[mv']/.test(word.toLowerCase().replace(/’/g, "'"))) return [{shape: "D", vowel: true}, ...visemesOf(w.slice(1)).filter(u => !u.vowel)];
  if (/^[^aeiou]*y$/.test(w) && w.length > 1) return [...visemesOf(w.slice(0, -1)), {shape: "D", vowel: true}]; // my, why
  const long = w.match(/([aiou])[^aeiouy]e$/);
  if (w.length > 2 && /[^aeiou]e$/.test(w) && !w.endsWith("le")) w = w.slice(0, -1); // a silent e
  const out: Unit[] = [];
  for (let i = 0; i < w.length;) {
    if (w[i] === "y" && /[aeiou]/.test(w[i + 1] ?? "")) { out.push({shape: "B", vowel: false}); i++; continue; } // yes, you
    const v = VOWELS.find(([s]) => w.startsWith(s, i)), c = !v && CONSONANTS.find(([s]) => w.startsWith(s, i));
    if (v) {
      const end = v[0] === "ou" && i === w.length - 2; // you: oo
      const shape = end ? "F" : long && i === w.length - 2 && v[0] === long[1] ? LONG[long[1]] : v[1];
      out.push({shape, vowel: true});
      i += v[0].length;
    } else if (c) {
      if (c[1]) out.push({shape: c[1], vowel: false});
      i += c[0].length;
    } else { out.push({shape: "B", vowel: false}); i++; }
  }
  return out;
}

/** A word's vowel shapes, one a syllable, for saying it without a recording (never none). */
export const vowelShapes = (word: string): Shape[] => {
  const v = visemesOf(word).filter(u => u.vowel).map(u => u.shape);
  return v.length ? v : ["C"];
};

/** His mouth all through a speech, one shape letter a pose on twos (ON_TWOS), from when each word is said (`times`, ms) and,
 *  if the recording says, how loud he is each pose (`loud`: a digit 0-9 a pose, scripts/voice.py). Each word's shapes share
 *  its time (vowels twice as long); each pose takes the shape you'd most notice missing in it, an m, b or p shutting the lips
 *  however short; the whole track a pose early. Louder or longer vowels open wider, quiet ones less. Between words it rests,
 *  except for a short gap, which keeps the last shape; a sigh outside words opens it a little at most. */
export function lipTrack(words: string[], times: Span[], ms: number, loud?: string): string {
  const n = Math.ceil(ms * 12 / 1000), levels = loud?.length === n ? [...loud].map(d => Number(d) / 9) : undefined;
  const segs: {start: number; end: number; shape: Shape}[] = [];
  words.forEach((word, j) => {
    const units = visemesOf(word), {start} = times[j];
    const next = times[j + 1]?.start, end = next !== undefined && next - times[j].end <= JOIN ? next : times[j].end;
    const total = units.reduce((sum, u) => sum + (u.vowel ? 2 : 1), 0);
    let t = start;
    for (const u of units) {
      const d = (end - start) * (u.vowel ? 2 : 1) / total;
      segs.push({start: t, end: t += d, shape: u.shape});
    }
  });
  const track: Shape[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k + LEAD) * ON_TWOS, b = a + ON_TWOS, level = levels?.[k + LEAD];
    let best: (typeof segs)[number] | undefined, score = 0, shut = false;
    for (const s of segs) {
      const over = Math.min(b, s.end) - Math.max(a, s.start);
      if (over <= 0) continue;
      if (s.shape === "A" && over >= CLOSE) shut = true;
      if (over * WEIGHT[s.shape] > score) { score = over * WEIGHT[s.shape]; best = s; }
    }
    let shape: Shape = shut ? "A" : best?.shape ?? "X";
    if (shape === "X") { if (level !== undefined && level >= 0.15) shape = "B"; }
    else if (level !== undefined) {
      if (shape === "C" && level >= 0.75) shape = "D";
      else if (shape === "D" && level < 0.3) shape = "C";
      else if (shape === "C" && level < 0.15) shape = "B";
    } else if (shape === "C" && best && best.end - best.start >= 2.5 * ON_TWOS) shape = "D";
    track.push(shape);
  }
  // a lone pose open between rests is only a little open
  for (let k = 1; k < n - 1; k++) if (track[k - 1] === "X" && track[k + 1] === "X" && !"XAB".includes(track[k])) track[k] = "B";
  return track.join("");
}

/** Which of `who`'s drawn mouth pieces shows a shape (some stand in for others until they have their own). */
export const pieceFor = (who: keyof typeof table.pieces, shape: Shape): number => table.pieces[who][shape];
