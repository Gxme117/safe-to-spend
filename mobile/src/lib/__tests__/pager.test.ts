import {addDays} from "../dates";
import {goal, heading, pager, panes, startPager, type Pager, type PagerEvent} from "../pager";
import {TODAY} from "./fixtures";

const run = (events: PagerEvent[], p = startPager(TODAY)) => events.reduce(pager, p);
const shown = (p: Pager) => panes(p).map(x => `${x.d}@${x.page}`);

test("starts on today, with the day either side waiting", () => {
  const p = startPager(TODAY);
  expect(heading(p)).toBe(TODAY);
  expect(shown(p)).toEqual([`${addDays(TODAY, -1)}@-1`, `${TODAY}@0`, `${addDays(TODAY, 1)}@1`]);
});

test("a move shows where you're going straight away, and lands there when its slide gets there", () => {
  const p = run([{type: "step", by: 1}]);
  expect(heading(p)).toBe(addDays(TODAY, 1));
  expect(p.day).toBe(TODAY);
  expect(goal(p)).toBe(1);
  const landed = pager(p, {type: "landed", move: p.move});
  expect(landed).toMatchObject({day: addDays(TODAY, 1), page: 1, to: null});
});

test("only the latest slide lands: one cut short by another move changes nothing", () => {
  const p = run([{type: "step", by: 1}, {type: "step", by: 1}]);
  expect(pager(p, {type: "landed", move: p.move - 1})).toBe(p);
  // and landing again once it's there is nothing too
  const there = pager(p, {type: "landed", move: p.move});
  expect(pager(there, {type: "landed", move: there.move})).toBe(there);
});

test("a second swipe mid-slide carries on from where the first was going", () => {
  const p = run([{type: "step", by: 1}, {type: "step", by: 1}]);
  expect(p).toMatchObject({day: addDays(TODAY, 1), page: 1, to: addDays(TODAY, 2)});
  expect(goal(p)).toBe(2);
});

test("turning round mid-slide slides home, with nothing to land", () => {
  const p = run([{type: "step", by: 1}, {type: "step", by: -1}]);
  expect(p).toMatchObject({day: TODAY, to: null, page: 0});
  // the move still counts, so the cards slide back to its page
  expect(p.move).toBe(2);
  expect(goal(p)).toBe(0);
});

test("going back past where a slide started aims from the day still in view, whose neighbours are already there", () => {
  const p = run([{type: "step", by: -1}, {type: "go", to: addDays(TODAY, 1)}]);
  expect(p).toMatchObject({day: TODAY, page: 0, to: addDays(TODAY, 1)});
  expect(shown(p)).toEqual([`${addDays(TODAY, -1)}@-1`, `${TODAY}@0`, `${addDays(TODAY, 1)}@1`]);
});

test("a week away waits on the side it slides in from, so it looks like a swipe", () => {
  const next = run([{type: "step", by: 7}]);
  expect(shown(next)[2]).toBe(`${addDays(TODAY, 7)}@1`);
  const back = run([{type: "step", by: -7}]);
  expect(shown(back)[0]).toBe(`${addDays(TODAY, -7)}@-1`);
});

test("going to the day you're on, or where you're already going, is nothing", () => {
  const p = startPager(TODAY);
  expect(pager(p, {type: "go", to: TODAY})).toBe(p);
  expect(pager(p, {type: "step", by: 0})).toBe(p);
});

// a small fixed-seed random number generator, so the walk is the same every run
function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) % 2 ** 32; return seed / 2 ** 32; };
}

test("whatever happens, a pane that stays on screen never changes page, and no date is drawn twice", () => {
  const rand = rng(7);
  let p = startPager(TODAY);
  for (let i = 0; i < 5000; i++) {
    const r = rand();
    const e: PagerEvent =
      r < 0.3 ? {type: "step", by: rand() < 0.5 ? 1 : -1}
      : r < 0.4 ? {type: "step", by: rand() < 0.5 ? 7 : -7}
      : r < 0.5 ? {type: "go", to: addDays(heading(p), Math.floor(rand() * 13) - 6)}
      : r < 0.9 ? {type: "landed", move: p.move}
      : {type: "landed", move: p.move - 1 - Math.floor(rand() * 3)};
    const before = new Map(panes(p).map(x => [x.d, x.page]));
    const next = pager(p, e);
    const after = panes(next);
    expect(new Set(after.map(x => x.d)).size).toBe(3);
    for (const x of after) if (before.has(x.d)) expect([e, x.d, x.page]).toEqual([e, x.d, before.get(x.d)]);
    // the day in view always has a pane, and so does where you're going
    expect(after.some(x => x.d === next.day && x.page === next.page)).toBe(true);
    expect(after.some(x => x.d === heading(next) && x.page === goal(next))).toBe(true);
    p = next;
  }
});
