// Where Tim looks, and when. He's an AI who found himself inside your phone and now helps you with your money: wise and
// confident, good at his job (really good at maths). His eyes show it:
// - idle: he holds your eye, steadily, for a few seconds (now and then a tiny shift), then glances away for a moment, mostly to
//   the side or up as if thinking something through, now and then down, and back. He blinks now and then, not as he looks away.
// - typing: he reads what you type (down at the box), glancing up at you now and then to check. Reading, he blinks less.
// - thinking (just after Send): quick maths scans up and to the sides, then a steady look at you (he's sure of himself).
// Eyes jump between points rather than glide, so every change is instant; the screen holds each look for `ms`.
// A beat with `blink` starts with a blink, and the look changes while the lid is shut. A beat with `typing`: he types on his
// laptop all through it (Frank; typingPoses says how his hands go).
// Frank (frankBeats) is deadpan: he looks at you, blinking now and then, and every so often goes back to his laptop to type.

export type Look = "you" | "nearLeft" | "nearRight" | "left" | "right" | "down" | "downLeft" | "downRight" | "upLeft" | "upRight";
export type Mood = "idle" | "typing" | "thinking";
export type Beat = {look: Look; ms: number; blink?: boolean; typing?: boolean};

export const MAX_EYE_CONTACT = 6000;

/** One held pose "on twos": 2 frames at 24fps. Blinks and his mouth both move at this pace. */
export const ON_TWOS = 1000 / 12;
/** A blink: how far the lid is down in each pose, held ON_TWOS each (half, shut, shut, half, a quarter, open). */
export const BLINK = [.5, 1, 1, .5, .2, 0];

/** How far his upper lid is down for a look: looking down, it follows the eyes down (`down`: a little for Tim; Frank's heavy
 *  lids, half way, so his pupils stay about as covered as they always are). */
export const lidFor = (look: Look, down = .2): number => (look.startsWith("down") ? down : 0);

const between = (rand: () => number, lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));

/** Frank's round, played over and over. He looks at you for 6–12s, deadpan, his heavy lids blinking every 3–5s and now and
 *  then twice in a row, as in his "Accountant-Frank" frame (each a BLINK, about .4s); then he looks down at his laptop and types
 *  for 3–6s. He blinks as he looks down and as he looks back up (each round starts with it), so his half-shut lid never jumps. */
export function frankBeats(rand: () => number = Math.random): Beat[] {
  const beats: Beat[] = [];
  let left = between(rand, 6000, 12000), double = false;
  while (left > 0) {
    // a blink, then his eyes on you until the next one; a double blink is two, 500ms apart (the frame's 6.4s and 6.9s)
    double = !double && rand() < .2;
    const ms = double ? 500 : between(rand, 3000, 5000);
    beats.push({look: "you", ms: left - ms < 1500 ? left : ms, blink: true});
    left -= beats[beats.length - 1].ms;
  }
  beats.push({look: "down", ms: between(rand, 3000, 6000), blink: true, typing: true});
  return beats;
}

/** How far a hand is lifted off the keys: down, a little, or more (scripts/frank_hands.py's pieces). */
export type Lift = 0 | 1 | 2;
export type HandsPose = {left: Lift; right: Lift; ms: number};

/** Frank's hands while he types for `ms`: held poses on twos. He reads a moment first, then types in bursts of 3–8 keys: for
 *  each, one hand lifts (a little, now and then more) for one pose and comes back down, mostly the other hand from the last;
 *  a pose or two between keys, a few between bursts, and now and then he stops to read. Ends with both down, at exactly `ms`. */
export function typingPoses(ms: number, rand: () => number = Math.random): HandsPose[] {
  const poses: HandsPose[] = [];
  let total = 0;
  const add = (pose: HandsPose) => { poses.push(pose); total += pose.ms; };
  const rest = (twos: number) => add({left: 0, right: 0, ms: twos * ON_TWOS});
  rest(between(rand, 4, 6)); // reading what's on his screen
  let hand: "left" | "right" = rand() < .5 ? "left" : "right";
  while (total < ms) {
    for (let keys = between(rand, 3, 8); keys > 0; keys--) {
      if (rand() < .7) hand = hand === "left" ? "right" : "left";
      add({left: 0, right: 0, [hand]: rand() < .25 ? 2 : 1, ms: ON_TWOS});
      rest(between(rand, 1, 2));
    }
    rest(rand() < .15 ? between(rand, 6, 14) : between(rand, 2, 5));
  }
  // cut at `ms`, the last pose with both hands down
  const cut: HandsPose[] = [];
  let at = 0;
  for (const p of poses) {
    if (at >= ms) break;
    cut.push(p);
    at += p.ms;
  }
  const last = cut[cut.length - 1];
  if (last) Object.assign(last, {left: 0, right: 0, ms: last.ms - (at - ms)});
  return cut;
}
function pick<T>(rand: () => number, options: [T, number][]): T {
  let r = rand() * options.reduce((sum, [, w]) => sum + w, 0);
  for (const [o, w] of options) if ((r -= w) < 0) return o;
  return options[options.length - 1][0];
}

/** The next few looks for his mood. Played one after another, then asked again. */
export function nextBeats(mood: Mood, rand: () => number = Math.random): Beat[] {
  if (mood === "typing") return [
    {look: pick<Look>(rand, [["down", 3], ["downLeft", 1], ["downRight", 1]]), ms: between(rand, 2000, 4000)},
    {look: "you", ms: between(rand, 400, 700), blink: rand() < .4},
  ];
  if (mood === "thinking") return [
    {look: "upLeft", ms: 300}, {look: "upRight", ms: 280}, {look: "upLeft", ms: 320},
    {look: "you", ms: 3400, blink: true},
  ];
  // idle: steady eye contact (sometimes with a tiny shift part way), then a moment away
  const contact = between(rand, 3000, MAX_EYE_CONTACT), blink = rand() < .8;
  const beats: Beat[] = [];
  if (rand() < .35) {
    const first = between(rand, 1500, contact - 1000);
    beats.push({look: "you", ms: first, blink}, {look: rand() < .5 ? "nearLeft" : "nearRight", ms: contact - first, blink: rand() < .4});
  } else beats.push({look: "you", ms: contact, blink});
  const away = pick<Look>(rand, [["left", 2], ["right", 2], ["upLeft", 1.5], ["upRight", 1.5], ["downLeft", .75], ["downRight", .75]]);
  beats.push({look: away, ms: between(rand, 800, 1600), blink: rand() < .2});
  return beats;
}
