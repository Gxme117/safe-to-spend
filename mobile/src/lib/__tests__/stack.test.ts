import {bringOut, bringToFront, startOrder} from "../stack";

test("starts with ours in front, then the cards above it in turn", () => {
  expect(startOrder(4)).toEqual([3, 2, 1, 0]);
});

test("a tapped card comes to the front and the one that was in front goes just behind it", () => {
  let o = startOrder(4);
  o = bringToFront(o, 0);
  expect(o).toEqual([0, 3, 2, 1]);
  o = bringToFront(o, 1);
  expect(o).toEqual([1, 0, 3, 2]);
  o = bringToFront(o, 3);
  expect(o).toEqual([3, 1, 0, 2]);
});

test("tapping the front card changes nothing", () => {
  const o = [2, 0, 1];
  expect(bringToFront(o, 2)).toBe(o);
});

test("Day 2: a card tapped brings every card out with the days to payday at the back; tapping the days tucks them away again", () => {
  // the days to payday (2) in front, the bank cards' tops above it
  let o = startOrder(3);
  o = bringOut(o, 0, 2);
  expect(o).toEqual([0, 1, 2]);
  // out, a tap swaps the cards; the days stay at the back
  o = bringOut(o, 1, 2);
  expect(o).toEqual([1, 0, 2]);
  o = bringToFront(o, 2);
  expect(o).toEqual([2, 1, 0]);
});
