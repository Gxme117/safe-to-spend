import {addDays} from "./dates";
import type {IsoDate} from "./types";

/**
 * Where the Day tab is. Each day you can see sits on a page, and the cards are slid to `-page × stride`.
 * A pane never moves once it's placed: landing makes the page you slid to the day in view, and it's already there,
 * so nothing has to be lined up again (lining up mid-commit is what briefly showed the wrong day).
 */
export interface Pager {
  day: IsoDate;          // the day in view
  page: number;          // the page it sits on
  to: IsoDate | null;    // where a slide is taking you
  move: number;          // which slide is running: only that one can land
}

/** `go`: to a date (a tap on the week). `step`: days on from where you're going (a swipe, the week arrows), read from the latest state.
 *  `landed`: the slide for `move` got there. */
export type PagerEvent = {type: "go"; to: IsoDate} | {type: "step"; by: number} | {type: "landed"; move: number};

export const startPager = (today: IsoDate): Pager => ({day: today, page: 0, to: null, move: 0});

/** The date the title and week show: where you're going, straight away. */
export const heading = (p: Pager) => p.to ?? p.day;

/** Which way a slide is going: 1 to a later day, -1 to an earlier one, 0 when still. */
export const direction = (p: Pager): -1 | 0 | 1 => !p.to ? 0 : p.to > p.day ? 1 : -1;

/** The page the cards are on, or heading for. */
export const goal = (p: Pager) => p.page + direction(p);

const land = (p: Pager): Pager => p.to ? {day: p.to, page: goal(p), to: null, move: p.move} : p;

export function pager(p: Pager, e: PagerEvent): Pager {
  if (e.type === "landed") return e.move === p.move ? land(p) : p;
  const to = e.type === "go" ? e.to : addDays(heading(p), e.by);
  if (to === heading(p)) return p;
  // further on the way a slide is going: land where it was going first, so the cards carry straight on from there.
  // Anywhere else (turning round, or short of where it was going), aim again from the day still in view: its neighbours are already in place
  const at = p.to && (to > p.to) === (p.to > p.day) ? land(p) : p;
  return {...at, to: to === at.day ? null : to, move: p.move + 1};
}

/** The panes to draw: the day in view and the day either side. While sliding, where you're going waits on the side it comes in from,
 *  so a jump of a week looks the same as a swipe. */
export function panes(p: Pager): {d: IsoDate; page: number}[] {
  const dir = direction(p);
  return ([-1, 0, 1] as const).map(k => ({d: k && k === dir ? p.to! : addDays(p.day, k), page: p.page + k}));
}
