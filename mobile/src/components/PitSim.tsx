import {useEffect, useMemo, useState, type ReactNode} from "react";
import {Animated, PanResponder} from "react-native";
import {atHome, dropIn, step, type Body} from "@/lib/pit";

type Home = {id: string; r: number; x: number; y: number};
// a press that moves further than this is a drag, not a tap
const DRAG = 8;

/** Runs lib/pit.ts every frame while anything's moving, and stops once the pile's still. Each bubble is drawn at its body's place
 *  through an Animated value. The first pile drops in; after that, a bubble that's new (Undo after Delete) drops in on its own, and
 *  one whose place changes (paid, or the pile re-packed) makes its own way there. With reduced motion everything is simply at home:
 *  a drag moves the bubble, letting go puts it straight back. */
export class PitSim {
  bodies: Body[] = [];
  key = "";
  private xy = new Map<string, Animated.ValueXY>();
  private grab: {id: string; x: number; y: number; x0: number; y0: number} | null = null;
  private w = 0;
  private h = 0;
  private reduced = false;
  private frame: number | null = null;
  private last = 0;

  sync(key: string, homes: Home[], w: number, h: number, reduced: boolean) {
    if (key === this.key) return;
    const first = !this.key;
    Object.assign(this, {key, w, h, reduced});
    if (first) this.bodies = reduced ? atHome(homes) : dropIn(homes);
    else {
      const was = new Map(this.bodies.map(b => [b.id, b]));
      this.bodies = homes.map(p => {
        const b = was.get(p.id);
        if (!b) return reduced ? atHome([p])[0] : dropIn([p])[0];
        return Object.assign(b, {r: p.r, hx: p.x, hy: p.y});
      });
      if (reduced) this.home();
    }
    for (const b of this.bodies) if (!this.xy.has(b.id)) this.xy.set(b.id, new Animated.ValueXY(this.corner(b)));
  }

  /** Where a bubble's drawn: the top left corner of its box. */
  value(id: string) { return this.xy.get(id)!; }

  wake() {
    if (this.reduced) { this.home(); this.push(); return; }
    if (this.frame === null) { this.last = 0; this.frame = requestAnimationFrame(this.tick); }
  }

  stop() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  grabStart(id: string, dx: number, dy: number) {
    const b = this.bodies.find(x => x.id === id);
    if (!b) return;
    // measured from where the finger first went down, so the bubble doesn't jump by the distance it took to start the drag
    this.grab = {id, x: b.x, y: b.y, x0: b.x - dx, y0: b.y - dy};
    this.wake();
  }

  grabMove(dx: number, dy: number) {
    const g = this.grab;
    if (!g) return;
    g.x = g.x0 + dx; g.y = g.y0 + dy;
    const b = this.bodies.find(x => x.id === g.id);
    if (this.reduced && b) {
      b.x = Math.min(Math.max(g.x, b.r), this.w - b.r); b.y = Math.min(Math.max(g.y, b.r), this.h - b.r);
      this.push();
    }
  }

  grabEnd() {
    this.grab = null;
    this.wake();
  }

  private tick = (t: number) => {
    const dt = this.last ? Math.min((t - this.last) / 1000, 1 / 30) : 1 / 60;
    this.last = t;
    const moving = step(this.bodies, dt, this.w, this.h, this.grab);
    this.push();
    this.frame = moving ? requestAnimationFrame(this.tick) : null;
  };

  private home() {
    for (const b of this.bodies) if (b.id !== this.grab?.id) Object.assign(b, {x: b.hx, y: b.hy, vx: 0, vy: 0, wait: 0});
  }

  private corner(b: Body) { return {x: b.x - b.r, y: b.y - b.r}; }

  private push() { for (const b of this.bodies) this.xy.get(b.id)?.setValue(this.corner(b)); }
}

/** The pile's bodies for these places (in pack order, so the drop-in goes biggest first), run while anything's moving. */
export function usePitSim(homes: Home[], w: number, h: number, reduced: boolean) {
  const [sim] = useState(() => new PitSim());
  const key = `${w}x${h}${reduced ? "r" : ""}:${homes.map(p => `${p.id}@${p.x.toFixed(1)},${p.y.toFixed(1)},${p.r.toFixed(1)}`).join(";")}`;
  sim.sync(key, homes, w, h, reduced);
  useEffect(() => { sim.wake(); }, [sim, key]);
  useEffect(() => () => sim.stop(), [sim]);
  return sim;
}

/** One bubble in the pit, drawn where its body is. Drag it (once the finger's moved DRAG) and it shoves the others; a shorter press is
 *  left to the bubble (a tap). `drag` off (a sheet's open), it can't be moved. */
export function Floater({sim, id, drag, children}: {sim: PitSim; id: string; drag: boolean; children: ReactNode}) {
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, g) => drag && Math.hypot(g.dx, g.dy) > DRAG,
    onPanResponderGrant: (_, g) => sim.grabStart(id, g.dx, g.dy),
    onPanResponderMove: (_, g) => sim.grabMove(g.dx, g.dy),
    onPanResponderRelease: () => sim.grabEnd(),
    onPanResponderTerminate: () => sim.grabEnd(),
    onPanResponderTerminationRequest: () => false,
  }), [sim, id, drag]);
  return (
    <Animated.View {...pan.panHandlers} style={{position: "absolute", left: 0, top: 0, transform: sim.value(id).getTranslateTransform()}}>
      {children}
    </Animated.View>
  );
}
