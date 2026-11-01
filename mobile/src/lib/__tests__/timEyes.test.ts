import {frankBeats, lidFor, MAX_EYE_CONTACT, nextBeats, ON_TWOS, typingPoses, type Beat} from "@/lib/timEyes";

// a seeded random, so each run sees the same Tim
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const run = (mood: Parameters<typeof nextBeats>[0], rounds: number, seed = 1) => {
  const rand = seeded(seed), beats: Beat[] = [];
  for (let i = 0; i < rounds; i++) beats.push(...nextBeats(mood, rand));
  return beats;
};
const contact = (b: Beat) => b.look === "you" || b.look.startsWith("near");

test("idle, he holds your eye steadily for a few seconds, glances away a moment, and comes back", () => {
  const beats = run("idle", 200);
  // eye contact (looking at you, or a tiny shift while doing it) runs 3-6s in one go
  let held = 0;
  beats.forEach((b, i) => {
    held = contact(b) ? held + b.ms : 0;
    expect(held).toBeLessThanOrEqual(MAX_EYE_CONTACT);
    if (!contact(b)) {
      expect(contact(beats[i - 1])).toBe(true);
      expect(b.ms).toBeLessThanOrEqual(1600); // away only a moment
    }
  });
  for (let i = 0; i < 200; i++) {
    const round = nextBeats("idle", seeded(i));
    expect(round[0].look).toBe("you");
    expect(round.filter(contact).reduce((s, b) => s + b.ms, 0)).toBeGreaterThanOrEqual(3000);
    expect(contact(round[round.length - 1])).toBe(false);
  }
  // mostly to the side or up, thinking; only now and then down
  const away = beats.filter(b => !contact(b)).map(b => b.look);
  expect(away.filter(l => l.startsWith("down")).length / away.length).toBeLessThan(.25);
  expect(away.some(l => l.startsWith("up"))).toBe(true);
});

test("idle, he blinks every few seconds on average, not as he looks away", () => {
  const beats = run("idle", 300);
  const ms = beats.reduce((s, b) => s + b.ms, 0), blinks = beats.filter(b => b.blink).length;
  expect(ms / blinks).toBeGreaterThan(2500);
  expect(ms / blinks).toBeLessThan(7000);
  const away = beats.filter(b => !contact(b));
  expect(away.filter(b => b.blink).length / away.length).toBeLessThan(.3);
});

test("typing, he reads the box and glances up at you to check", () => {
  const beats = run("typing", 50);
  const down = beats.filter(b => b.look.startsWith("down")).reduce((s, b) => s + b.ms, 0);
  const all = beats.reduce((s, b) => s + b.ms, 0);
  expect(down / all).toBeGreaterThan(.75);
  expect(beats.some(b => b.look === "you" && b.ms <= 700)).toBe(true);
});

test("thinking, he does the maths up and to the sides, then looks at you steadily", () => {
  const beats = nextBeats("thinking", seeded(3));
  expect(beats.slice(0, 3).map(b => b.look)).toEqual(["upLeft", "upRight", "upLeft"]);
  expect(beats.slice(0, 3).every(b => b.ms <= 400)).toBe(true);
  expect(beats.slice(3)).toEqual([{look: "you", ms: 3400, blink: true}]);
});

test("looking down, his lid follows a little; otherwise it's up", () => {
  expect(lidFor("down")).toBe(.2);
  expect(lidFor("downLeft")).toBe(.2);
  expect(lidFor("you")).toBe(0);
  expect(lidFor("upLeft")).toBe(0);
  // Frank's heavy lids come half down
  expect(lidFor("down", .5)).toBe(.5);
  expect(lidFor("you", .5)).toBe(0);
});

test("Frank looks at you a while, blinking now and then, then goes back to his laptop and types", () => {
  for (let i = 0; i < 200; i++) {
    const round = frankBeats(seeded(i)), spell = round[round.length - 1];
    const atYou = round.slice(0, -1);
    // deadpan: his eyes are on you, 6-12s, then down at his laptop, typing, 3-6s
    expect(atYou.every(b => b.look === "you" && !b.typing)).toBe(true);
    const contact = atYou.reduce((s, b) => s + b.ms, 0);
    expect(contact).toBeGreaterThanOrEqual(6000);
    expect(contact).toBeLessThanOrEqual(12000);
    expect(spell).toMatchObject({look: "down", typing: true});
    expect(spell.ms).toBeGreaterThanOrEqual(3000);
    expect(spell.ms).toBeLessThanOrEqual(6000);
    // he blinks as he looks back up (the round starts with it) and as he looks down, so his half-shut lid never jumps
    expect(round[0].blink).toBe(true);
    expect(spell.blink).toBe(true);
    // a double blink is two, 500ms apart, never three; otherwise his eyes stay on you at least 1.5s between blinks
    atYou.forEach((b, j) => {
      if (b.ms < 1500) expect(b.ms === 500 && atYou[j - 1]?.ms !== 500).toBe(true);
    });
  }
});

test("Frank blinks every few seconds while he's looking at you, as in his frame", () => {
  const rand = seeded(7), beats: Beat[] = [];
  for (let i = 0; i < 100; i++) beats.push(...frankBeats(rand).slice(0, -1));
  const ms = beats.reduce((s, b) => s + b.ms, 0), blinks = beats.filter(b => b.blink).length;
  expect(ms / blinks).toBeGreaterThan(2500);
  expect(ms / blinks).toBeLessThan(5000);
  expect(beats.some(b => b.ms === 500)).toBe(true); // now and then twice in a row
});

test("Frank's hands while he types: he reads first, then keys one hand at a time, on twos, and ends with them down", () => {
  for (let i = 0; i < 100; i++) {
    const ms = 3000 + i * 30, poses = typingPoses(ms, seeded(i));
    expect(poses.reduce((s, p) => s + p.ms, 0)).toBeCloseTo(ms);
    // held poses on twos (all but the last, cut to fit)
    for (const p of poses.slice(0, -1)) expect(p.ms / ON_TWOS).toBeCloseTo(Math.round(p.ms / ON_TWOS));
    // reading what's on his screen first, both hands down, about .4s
    expect(poses[0]).toMatchObject({left: 0, right: 0});
    expect(poses[0].ms).toBeGreaterThanOrEqual(4 * ON_TWOS - .01);
    // one hand at a time, for one pose, then down again
    poses.forEach((p, j) => {
      expect(p.left && p.right).toBeFalsy();
      if (p.left || p.right) {
        expect(p.ms).toBeCloseTo(ON_TWOS);
        expect(poses[j + 1]).toMatchObject({left: 0, right: 0});
      }
    });
    expect(poses[poses.length - 1]).toMatchObject({left: 0, right: 0});
  }
  // both hands type, mostly a little lift and now and then more, a few keys a second
  const poses = typingPoses(60000, seeded(1)), keys = poses.filter(p => p.left || p.right);
  expect(keys.some(p => p.left) && keys.some(p => p.right)).toBe(true);
  expect(keys.filter(p => (p.left || p.right) === 2).length / keys.length).toBeGreaterThan(.1);
  expect(keys.filter(p => (p.left || p.right) === 2).length / keys.length).toBeLessThan(.4);
  expect(keys.length / 60).toBeGreaterThan(2);
  expect(keys.length / 60).toBeLessThan(6);
});
