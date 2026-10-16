import {isSideways, swipeStep} from "../swipe";

test("only a clearly sideways drag is a swipe; scrolling stays scrolling", () => {
  expect(isSideways(30, 5)).toBe(true);
  expect(isSideways(-30, 5)).toBe(true);
  expect(isSideways(8, 0)).toBe(false);
  expect(isSideways(20, 30)).toBe(false);
});

test("left goes forward a day, right goes back, a small nudge stays put", () => {
  expect(swipeStep(-80, 0)).toBe(1);
  expect(swipeStep(80, 0)).toBe(-1);
  expect(swipeStep(-30, -0.8)).toBe(1);
  expect(swipeStep(30, 0.1)).toBe(0);
});
