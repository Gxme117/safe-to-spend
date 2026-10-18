// The Living tab's bubbles as soft bodies: each one is pulled back to its place in the pile (from `pack`) by a spring, overlapping ones
// push each other apart (a big one shoves a small one more than the other way round), and the walls and floor hold them in.
// A bubble being dragged goes where the finger is and pushes the rest; let go, everything drifts back home past each other,
// slowly, like bubbles in a bottle of soda. Pure: `step` moves the bodies it's given in place, so the screen can run it every frame.

/** One bubble: where it is (its centre, from the pit's top left), how fast it's going (pt/s), where it lives, how long until it
 *  joins in (dropping in, the later ones wait above the pit), and the closest it's got to home lately and how long since. Stuck too
 *  long, it's a `ghost` that slips through the others until it's home: `pack` can put a small bubble in a pocket whose way in is
 *  narrower than it. */
export type Body = {
  id: string; r: number; x: number; y: number; vx: number; vy: number; hx: number; hy: number; wait: number; best: number; stuck: number; ghost: boolean;
};
/** The bubble being dragged, and where the finger wants it. */
export type Grab = {id: string; x: number; y: number} | null;

// the pull home: a spring of K, damped by C, so it settles in about 1.3s with a small overshoot (a slow, buoyant drift)
export const K = 16, C = 6;
// how much a bump bounces (0 dead, 1 fully)
const BOUNCE = 0.2;
// bubbles packed this close (pack allows a hair of overlap) don't push each other
const SLACK = 0.5;
// side on, the lighter of two bumping bubbles rises by this much of their overlap
const SLIP = 0.6;
// settled: everything this close to home and this slow, so it can stop
const NEAR = 0.5, SLOW = 3;
// dropping in, each bubble waits this much longer than the one before (biggest first)
export const STAGGER = 0.05;
// further than FAR from home and not a point closer for STUCK seconds, with nothing being dragged: it slips through
const FAR = 6, STUCK = 0.3;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Bodies for a pile that drops in: each starts just above the pit, over its place, and they join in one after another in the order
 *  given (pack order: biggest first, paid ones and the "+" last). */
export function dropIn(homes: {id: string; r: number; x: number; y: number}[]): Body[] {
  return homes.map((p, i) => ({...atHome([p])[0], y: -p.r - 8, wait: i * STAGGER}));
}

/** Bodies already at home. */
export function atHome(homes: {id: string; r: number; x: number; y: number}[]): Body[] {
  return homes.map(p => ({id: p.id, r: p.r, x: p.x, y: p.y, vx: 0, vy: 0, hx: p.x, hy: p.y, wait: 0, best: 0, stuck: 0, ghost: false}));
}

/** Moves every body on by `dt` seconds in a W × H pit, in place. `collide` off lets them pass through each other (so nothing can stay
 *  stuck). Returns false once everything's home and still (they're snapped exactly home), so the screen can stop running it. */
export function step(bodies: Body[], dt: number, W: number, H: number, grab: Grab, collide = true): boolean {
  let moving = !!grab;
  const live = bodies.filter(b => b.wait <= 0);
  for (const b of bodies) {
    if (b.wait > 0) { b.wait -= dt; moving = true; continue; }
    if (grab?.id === b.id) {
      const x = clamp(grab.x, b.r, W - b.r), y = clamp(grab.y, b.r, H - b.r);
      b.vx = (x - b.x) / dt; b.vy = (y - b.y) / dt; b.x = x; b.y = y;
      continue;
    }
    b.vx += (K * (b.hx - b.x) - C * b.vx) * dt;
    b.vy += (K * (b.hy - b.y) - C * b.vy) * dt;
    b.x += b.vx * dt; b.y += b.vy * dt;
    const away = Math.hypot(b.hx - b.x, b.hy - b.y);
    if (grab || away <= FAR || away < b.best - 1) { b.best = away; b.stuck = 0; } else b.stuck += dt;
    if (b.stuck > STUCK) b.ghost = true;
    if (b.ghost && away < 1) b.ghost = false;
  }
  // the dragged one can't be pushed; otherwise the bigger the bubble, the less it gives
  const give = (b: Body) => grab?.id === b.id ? 0 : 1 / (b.r * b.r);
  if (collide) for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (a.ghost || b.ghost) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r - SLACK;
      if (d >= min || d === 0) continue;
      const ga = give(a), gb = give(b);
      if (ga + gb === 0) continue;
      const nx = dx / d, ny = dy / d, over = min - d;
      a.x -= nx * over * ga / (ga + gb); a.y -= ny * over * ga / (ga + gb);
      b.x += nx * over * gb / (ga + gb); b.y += ny * over * gb / (ga + gb);
      // meeting side on, the lighter one slips up and over, so two heading past each other never jam
      if (Math.abs(ny) < 0.7) { const up = ga > gb ? a : b; if (give(up) > 0) up.y -= over * SLIP; }
      // heading into each other: a soft bump
      const closing = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (pass === 0 && closing < 0) {
        const k = -(1 + BOUNCE) * closing / (ga + gb);
        a.vx -= k * ga * nx; a.vy -= k * ga * ny;
        b.vx += k * gb * nx; b.vy += k * gb * ny;
      }
    }
  }
  // the walls and the floor (no lid: dropping in, they come from above)
  for (const b of live) {
    if (grab?.id === b.id) continue;
    if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * BOUNCE; }
    if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * BOUNCE; }
    if (b.y > H - b.r) { b.y = H - b.r; b.vy = -Math.abs(b.vy) * BOUNCE; }
  }
  if (!moving) moving = live.some(b => Math.hypot(b.vx, b.vy) > SLOW || Math.hypot(b.hx - b.x, b.hy - b.y) > NEAR);
  if (!moving) for (const b of bodies) { b.x = b.hx; b.y = b.hy; b.vx = 0; b.vy = 0; }
  return moving;
}
