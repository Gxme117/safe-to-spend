import {sum} from "../sum";

test("plain arithmetic, the usual way round: times and divide before plus and minus, brackets first", () => {
  expect(sum("2 + 3 * 4")).toEqual({value: 14});
  expect(sum("(2 + 3) * 4")).toEqual({value: 20});
  expect(sum("(600 - 140) / 4")).toEqual({value: 115});
  expect(sum("10 - 4 - 3")).toEqual({value: 3});
  expect(sum("-5 + 2")).toEqual({value: -3});
  expect(sum(".5 * 3")).toEqual({value: 1.5});
});

test("to the penny, and money as it's written: pound signs, thousands commas, × and ÷", () => {
  expect(sum("10 / 3")).toEqual({value: 3.33});
  expect(sum("£1,234.50 - £34.50")).toEqual({value: 1200});
  expect(sum("12 × 3 ÷ 4")).toEqual({value: 9});
  expect(sum("0.1 + 0.2")).toEqual({value: 0.3});
});

test("anything that isn't arithmetic is refused, with why", () => {
  expect(sum("2 + abc")).toEqual({error: expect.stringContaining("can't read")});
  expect(sum("Math.max(1, 2)")).toEqual({error: expect.stringContaining("can't read")});
  expect(sum("5 / (3 - 3)")).toEqual({error: "That divides by zero."});
  expect(sum("(1 + 2")).toEqual({error: "A bracket isn't closed."});
  expect(sum("1 + 2)")).toEqual({error: "There's a bracket too many."});
  expect(sum("3 +")).toEqual({error: "It ends too early."});
  expect(sum("  ")).toEqual({error: "There's nothing to work out."});
  expect(sum("1+".repeat(150) + "1")).toEqual({error: expect.stringContaining("too long")});
});
