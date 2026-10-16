import {deepen, inkOn, parseHex} from "../color";

test("reads hex colours with or without #, short or long", () => {
  expect(parseHex("#c3eada")).toBe("#C3EADA");
  expect(parseHex("c3eada")).toBe("#C3EADA");
  expect(parseHex(" #0af ")).toBe("#00AAFF");
  expect(parseHex("#c3ead")).toBeNull();
  expect(parseHex("mint")).toBeNull();
});

test("picks the ink that reads on the accent", () => {
  expect(inkOn("#C3EADA")).toBe("#000000");
  expect(inkOn("#FFFF00")).toBe("#000000");
  expect(inkOn("#1A237E")).toBe("#FFFFFF");
  expect(inkOn("#000000")).toBe("#FFFFFF");
});

test("deepens a colour until white text reads on it, keeping its tint", () => {
  const lum = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  for (const h of ["#FFC845", "#C3EADA", "#FFFF00", "#1A237E"]) {
    const d = deepen(h), [r, g, b] = lum(d), [r0, g0, b0] = lum(h);
    expect(inkOn(d)).toBe("#FFFFFF");
    // the same mix of red, green and blue, just less of each
    expect(r <= r0 && g <= g0 && b <= b0).toBe(true);
  }
  expect(deepen("#000000")).toBe("#000000");
});
