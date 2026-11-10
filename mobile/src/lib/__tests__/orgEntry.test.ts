import {entryAt, type EntryGeo} from "../orgEntry";

const G: EntryGeo = {width: 390, pic: 393, drop: 64, at0: 168, bubbleTop: 96, bubble: 88, bs: 0.6, bx: 120, by: 80, fit: 0.3};

describe("entryAt", () => {
  it("from rest starts exactly as his resting picture is: full width, the page's drop down, the picture untouched", () => {
    expect(entryAt(0, "rest", G)).toEqual({left: 0, top: 64, width: 390, height: 393, radius: 0, x: 0, y: 0, scale: 1});
  });

  it("from rest only moves down, the same size, to where he stops", () => {
    const mid = entryAt(0.5, "rest", G), end = entryAt(1, "rest", G);
    expect(mid.top).toBe(116);
    expect(end.top).toBe(168);
    for (const e of [mid, end]) expect([e.left, e.width, e.height, e.radius, e.x, e.y, e.scale]).toEqual([0, 390, 393, 0, 0, 0, 1]);
  });

  it("from his bubble starts as the bubble (round, his face in it) and grows out to the whole picture", () => {
    expect(entryAt(0, "bubble", G)).toEqual({left: 32, top: 96, width: 88, height: 88, radius: 44, x: -72, y: -48, scale: 0.3});
    expect(entryAt(1, "bubble", G)).toEqual({left: 0, top: 168, width: 390, height: 393, radius: 0, x: 0, y: 0, scale: 1});
  });

  it("never goes before the start", () => {
    for (const origin of ["rest", "bubble"] as const) expect(entryAt(-0.4, origin, G)).toEqual(entryAt(0, origin, G));
  });

  it("goes a little past where he stops, which is the bounce, with his picture and corners still sound", () => {
    const rest = entryAt(1.17, "rest", G);
    expect(rest.top).toBeGreaterThan(168);
    expect([rest.left, rest.width, rest.height, rest.scale]).toEqual([0, 390, 393, 1]);
    const bubble = entryAt(1.17, "bubble", G);
    expect(bubble.width).toBeGreaterThan(390);
    expect(bubble.radius).toBe(0);
  });

  it("moves one way on the way there", () => {
    for (const origin of ["rest", "bubble"] as const) {
      let last = entryAt(0, origin, G);
      for (let i = 1; i <= 20; i++) {
        const now = entryAt(i / 20, origin, G);
        expect(now.top).toBeGreaterThanOrEqual(last.top);
        expect(now.width).toBeGreaterThanOrEqual(last.width);
        expect(now.scale).toBeGreaterThanOrEqual(last.scale);
        last = now;
      }
    }
  });
});
