import {lipTrack, pieceFor, SHAPES, visemesOf, vowelShapes} from "@/lib/lipsync";
import {ON_TWOS} from "@/lib/timEyes";

const shapes = (word: string) => visemesOf(word).map(u => u.shape).join("");
/** A word said from `start` for `ms`, alone in a take with room after. */
const alone = (word: string, start = 0, ms = 500) => lipTrack([word], [{start, end: start + ms}], start + ms + 500);

test("a word's shapes from its spelling: lips shut on m, b, p; puckered on oo and w; wide on ah", () => {
  expect(shapes("mum")).toBe("ACA");
  expect(shapes("you")).toBe("BF");
  expect(shapes("your")).toBe("BEB");
  expect(shapes("soon")).toBe("BFB");
  expect(shapes("why")).toBe("FD"); // wh, then a long y
  expect(shapes("time")).toBe("BDA"); // a silent e makes the i long
  expect(shapes("five")).toBe("GDG");
  expect(shapes("I'm")).toBe("DA");
  expect(shapes("here.")).toBe("E"); // h and a silent e are nothing to see
  expect(shapes("£214")).toBe("CBCBCB");
  expect(vowelShapes("money")).toEqual(["E", "B"]);
  expect(vowelShapes("hm")).toEqual(["C"]); // never none
});

test("a track has one shape a pose for the whole take, resting outside the words", () => {
  const track = alone("mum", 300);
  expect(track).toHaveLength(Math.ceil(1300 / ON_TWOS));
  expect(track.startsWith("XX")).toBe(true);
  expect(track.endsWith("XXXX")).toBe(true);
  expect([...track].every(s => SHAPES.includes(s as never))).toBe(true);
});

test("the lips shut for each m of \"mum\", and the mouth is a pose ahead of the sound", () => {
  const track = alone("mum", 300, 400);
  expect(track.replace(/(.)\1+/g, "$1")).toBe("XACAX");
  // the first m is said from 300ms (pose 3); the mouth shuts for it a pose before
  expect(track.indexOf("A")).toBe(Math.floor(300 / ON_TWOS) - 1);
});

test("\"you\" ends puckered, never shut", () => {
  expect(alone("you")).toMatch(/F/);
  expect(alone("you")).not.toMatch(/A/);
  expect(alone("woo")).toMatch(/F/);
});

test("a short gap between words keeps the mouth going; a pause shuts it", () => {
  const two = (gap: number) => lipTrack(["no", "no"], [{start: 0, end: 300}, {start: 300 + gap, end: 600 + gap}], 1500);
  expect(two(100).replace(/X+$/, "")).not.toMatch(/X/);
  expect(two(400).replace(/X+$/, "")).toMatch(/EX+B/);
});

test("louder vowels open wider, quiet ones less, and a sigh outside words opens it a little at most", () => {
  const n = Math.ceil(1000 / ON_TWOS), at = (loud: string) => lipTrack(["cat"], [{start: 0, end: 500}], 1000, loud);
  expect(at("9".repeat(n))).toMatch(/D/);
  expect(at("1".repeat(n))).not.toMatch(/[CD]/);
  // a loud breath before any word: a little open, no more
  const sigh = lipTrack(["cat"], [{start: 600, end: 900}], 1000, "555550000000");
  expect(sigh.slice(0, 4)).toMatch(/^B+$/);
  // a loudness that doesn't fit the take isn't used
  expect(lipTrack(["cat"], [{start: 0, end: 500}], 1000, "9")).toBe(lipTrack(["cat"], [{start: 0, end: 500}], 1000));
});

test("no pose is held for less than one tick, and a lone one between rests is only a little open", () => {
  const track = lipTrack(["a"], [{start: 180, end: 240}], 600); // inside one pose
  expect(track).toHaveLength(Math.ceil(600 / ON_TWOS));
  expect(track.replace(/X/g, "")).toBe("B");
});

test("each shape shows one of their drawn pieces, the ones without their own standing in", () => {
  for (const who of ["tim", "frank"] as const) {
    expect(pieceFor(who, "X")).toBe(0);
    expect(pieceFor(who, "A")).toBe(0); // shut: the smile (Tim), his own picture (Frank)
    expect(pieceFor(who, "B")).toBe(1);
    expect(pieceFor(who, "D")).toBe(2);
    expect(pieceFor(who, "F")).toBe(3);
    SHAPES.forEach(s => expect([0, 1, 2, 3]).toContain(pieceFor(who, s)));
  }
});
