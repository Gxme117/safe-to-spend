// Smart Organisation's way in (pure): where Frank's picture is, from his start to where he stops, for the screen that comes up
// while he looks through your payments. It starts where he already is, so the move reads as one thing:
//   "rest": he's the full picture on his tab (the page's DROP down, as wide as the screen). He slides down to the middle
//           of the screen, the same size, nothing else about him changing.
//   "bubble": he's in his bubble at the top of a chat, and grows out of it to the middle of the screen.
// `p` runs 0 (where he started) to 1 (where he stops). A spring drives it, so it goes a little past 1 and settles back (the
// bounce); it never goes before 0, and the circle's corners never go negative.

export type OrgOrigin = "rest" | "bubble";

export type EntryGeo = {
  width: number; pic: number; // his whole picture, as wide as the screen
  drop: number; // how far down his tab he sits at rest
  at0: number; // where he stops, from the top
  bubbleTop: number; bubble: number; // his bubble: from the top of the screen, and its width
  bs: number; bx: number; by: number; fit: number; // his bubble's crop (BUBBLE) and the picture's scale in it
};

// the circle (clip) he's seen through, and how his picture sits in it
export type EntryAt = {left: number; top: number; width: number; height: number; radius: number; x: number; y: number; scale: number};

export function entryAt(p: number, origin: OrgOrigin, g: EntryGeo): EntryAt {
  "worklet";
  const t = Math.max(0, p), at = (a: number, b: number) => a + (b - a) * t;
  if (origin === "rest") return {left: 0, top: at(g.drop, g.at0), width: g.width, height: g.pic, radius: 0, x: 0, y: 0, scale: 1};
  return {
    left: at(32, 0), top: at(g.bubbleTop, g.at0), width: at(g.bubble, g.width), height: at(g.bubble, g.pic), radius: Math.max(0, at(g.bubble / 2, 0)),
    x: at(-g.bx * g.bs, 0), y: at(-g.by * g.bs, 0), scale: at(g.fit, 1),
  };
}
