/** A drag counts as sideways once it's gone 12px and is clearly more across than down, so scrolling still scrolls. */
export const isSideways = (dx: number, dy: number) => Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5;

/** Where a sideways swipe ends up: left is the next day, right the day before (like turning a page).
 *  It has to travel 60px, or be a quick flick; anything less stays put. */
export function swipeStep(dx: number, vx: number): -1 | 0 | 1 {
  if (dx <= -60 || vx <= -0.5) return 1;
  if (dx >= 60 || vx >= 0.5) return -1;
  return 0;
}
