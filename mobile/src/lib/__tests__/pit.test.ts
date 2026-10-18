import {bubbleRadii, pack, R_ADD} from "../living";
import {atHome, dropIn, step, STAGGER, type Body, type Grab} from "../pit";

const DT = 1 / 60;
// runs until it stops (or gives up after `max` seconds); returns how long that took
const settle = (bodies: Body[], W = 300, H = 400, grab: Grab = null, max = 10) => {
  let t = 0;
  while (step(bodies, DT, W, H, grab) && t < max) t += DT;
  return t;
};

test("pushed out of place, a bubble drifts home and stops there", () => {
  const [b] = atHome([{id: "a", r: 40, x: 150, y: 360}]);
  b.x = 60; b.y = 200;
  const t = settle([b]);
  expect(t).toBeGreaterThan(0.5);
  expect(t).toBeLessThan(4);
  expect(b).toMatchObject({x: 150, y: 360, vx: 0, vy: 0});
});

test("at home and still, there's nothing to run", () => {
  const bodies = atHome([{id: "a", r: 40, x: 40, y: 360}, {id: "b", r: 40, x: 119.7, y: 360}]);
  expect(step(bodies, DT, 300, 400, null)).toBe(false);
});

test("overlapping bubbles push apart, the small one moving more", () => {
  const [big, small] = atHome([{id: "big", r: 60, x: 100, y: 200}, {id: "small", r: 20, x: 170, y: 200}]);
  step([big, small], DT, 300, 400, null);
  expect(small.x - big.x).toBeGreaterThanOrEqual(79.4);
  expect(small.x - 170).toBeGreaterThan(100 - big.x);
});

test("a dragged bubble goes where the finger is and shoves the others, which can't push it back", () => {
  const bodies = atHome([{id: "a", r: 40, x: 60, y: 360}, {id: "b", r: 40, x: 140, y: 360}]);
  const grab = {id: "a", x: 120, y: 360};
  step(bodies, DT, 300, 400, grab);
  expect(bodies[0]).toMatchObject({x: 120, y: 360});
  expect(bodies[1].x).toBeGreaterThanOrEqual(199);
  // let go, both find their way home
  settle(bodies);
  expect(bodies.map(b => [b.x, b.y])).toEqual([[60, 360], [140, 360]]);
});

test("the dragged one stays inside the pit", () => {
  const bodies = atHome([{id: "a", r: 40, x: 60, y: 360}]);
  step(bodies, DT, 300, 400, {id: "a", x: -50, y: 900});
  expect(bodies[0]).toMatchObject({x: 40, y: 360});
});

test("two bubbles swapping sides get past each other", () => {
  const bodies = atHome([{id: "a", r: 30, x: 40, y: 370}, {id: "b", r: 30, x: 260, y: 370}]);
  bodies[0].x = 260; bodies[0].y = 300; bodies[1].x = 40; bodies[1].y = 300;
  expect(settle(bodies)).toBeLessThan(5);
  expect(bodies.map(b => [b.x, b.y])).toEqual([[40, 370], [260, 370]]);
});

test("with collisions off, they pass straight through each other", () => {
  const bodies = atHome([{id: "a", r: 30, x: 40, y: 370}, {id: "b", r: 30, x: 100, y: 370}]);
  bodies[0].x = 100; bodies[1].x = 40;
  step(bodies, DT, 300, 400, null, false);
  expect(bodies[0].x).toBeGreaterThan(40);
  expect(bodies[0].x).toBeLessThan(100);
  expect(bodies[0].y).toBe(370);
});

test("a full pile drops in and settles, and a bubble dragged right through it lets everything find its way home", () => {
  const amounts = [750, 220, 120, 95, 80, 35, 28, 25, 18, 12, 11];
  const radii = bubbleRadii(amounts);
  const pos = pack([...amounts.map((_, i) => ({id: `b${i}`, r: radii[i]})), {id: "add", r: R_ADD}], 358, 500);
  const homes = Object.values(pos);
  const bodies = dropIn(homes);
  expect(settle(bodies, 358, 500)).toBeLessThan(3);
  expect(bodies.map(b => [b.x, b.y])).toEqual(homes.map(p => [p.x, p.y]));
  // drag the smallest from one side of the pile to the other along the bottom, and let go
  const small = bodies.find(b => b.id === "b10")!;
  for (let t = 0; t <= 1; t += DT) step(bodies, DT, 358, 500, {id: "b10", x: small.hx + (20 - small.hx) * t, y: 480});
  expect(settle(bodies, 358, 500)).toBeLessThan(3);
  expect(bodies.map(b => [b.x, b.y])).toEqual(homes.map(p => [p.x, p.y]));
});

test("dropping in, they start above the pit and join in one after another, then settle in place", () => {
  const homes = [{id: "a", r: 60, x: 60, y: 340}, {id: "b", r: 40, x: 160, y: 360}, {id: "add", r: 26, x: 230, y: 374}];
  const bodies = dropIn(homes);
  expect(bodies.every(b => b.y < 0)).toBe(true);
  expect(bodies.map(b => b.wait)).toEqual([0, STAGGER, 2 * STAGGER]);
  step(bodies, DT, 300, 400, null);
  // the first is on its way, the last still waiting above
  expect(bodies[0].y).toBeGreaterThan(-68);
  expect(bodies[2].y).toBe(-34);
  settle(bodies);
  expect(bodies.map(b => [b.x, b.y])).toEqual(homes.map(p => [p.x, p.y]));
});
