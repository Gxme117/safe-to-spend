import {swipeStep} from "@/components/CycleGrid";

test("a swipe left steps to the next month, right to the one before, a short drag nowhere", () => {
  expect(swipeStep(-60, 0)).toBe(1);
  expect(swipeStep(60, 0)).toBe(-1);
  expect(swipeStep(-20, 0)).toBe(0);
  expect(swipeStep(20, 0)).toBe(0);
});

test("a quick flick counts before it's gone far, but only the way the finger went", () => {
  expect(swipeStep(-20, -0.8)).toBe(1);
  expect(swipeStep(20, 0.8)).toBe(-1);
  // dragged back the other way at the end: where it ended up wins
  expect(swipeStep(20, -0.8)).toBe(0);
});
