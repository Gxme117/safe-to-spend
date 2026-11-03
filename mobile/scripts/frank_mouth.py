#!/usr/bin/env python3
"""Makes Frank's talking poses, the stop-motion way (like scripts/tim_mouth.py): replacement poses cut from his own picture.

His mouth is under his big moustache, so at rest it's just his picture (no piece). Talking, two things move, column by column:
- his jaw drops under the middle of the moustache (most in the middle, nothing at the ends of the opening, a rounded shape):
  everything under it, down to his chin, is pushed down by the opening and squashed into the rows above the chin, so the chin
  stays put and nothing tears;
- the whole moustache lifts with his upper lip, its tips most, so it bobs as he talks. Under his nose (which stays in front)
  its top stays put and it's squashed up; out towards its tips, where there's only cheek above, it moves up whole, and the skin
  under them stretches up to meet them.
The gap between them is the inside of his mouth: the shadow under the moustache at its edges, darker in the middle.

Poses: frank-mouth-1 (slightly open), -2 (open, "e"), -3 (narrower, "y"), as Tim's. Saved as transparent PNGs cropped to one box.
Prints MOUTH_CROP (where they go in frank.jpg) for src/app/(tabs)/tim.tsx. Run it again whenever frank.jpg changes.
With --dark, the same from his dark-mode picture (assets/frank-dark.jpg, by frank_dark.py), saved as frank-dark-mouth-1..3.png.

Run from mobile/: python3 scripts/frank_mouth.py [--dark]   (needs Pillow)
"""
import sys
from pathlib import Path

from PIL import Image

from tim_mouth import INSIDE, SS, mix, save

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "frank.jpg"

COLS = (378, 500)       # columns to look for the moustache in
ROWS = (440, 486)       # rows to look for it in (under his nose, down to its drooping ends)
CHIN = 506              # the jaw's movement fades out by here; below, his collar, untouched
HALF = 24               # the opening's half-width at its widest, in px: under the middle of the moustache
SPLIT = 6               # the split between the moustache's halves is narrower than twice this
SKIN = 8                # rows of skin under the moustache's ends that stretch up as they lift
NOSE = 0.4              # his nose covers the moustache's middle this far out (a share of its half-width)
# (how far the jaw drops in the middle, in px; how wide the opening is, as a share of HALF; how much more the moustache's middle
# lifts; how far the whole moustache lifts, its tips most)
POSES = [(2.5, 0.8, 1.0, 2.5), (6.0, 0.9, 1.5, 4.5), (4.0, 0.6, 1.0, 3.0)]

# His dark-mode picture is put where his face is in frank.jpg, so the same columns and rows find his moustache.
DARK = "--dark" in sys.argv
if DARK:
    SRC = ROOT / "scripts" / "frank-dark-placed.jpg"  # before it was darkened (frank_dark.py); each piece is darkened as it's saved
NAME = "frank-dark" if DARK else "frank"
if DARK:
    from frank_dark import darkened_piece
    _save = save
    save = lambda pieces, prefix, names: _save([darkened_piece(p) for p in pieces], prefix, names)  # noqa: E731


def red(p):
    # the moustache's knit, lit or in shadow: hardly any green; his skin and nose have plenty
    return p[0] > 50 and p[1] < p[0] * 0.33


def measure(im):
    """The moustache in each column: its first and last rows (the longest run of red)."""
    found = {}
    for x in range(*COLS):
        runs, start, last = [], None, None
        for y in range(*ROWS):
            if red(im.getpixel((x, y))):
                if start is None or y - last > 2:
                    if start is not None:
                        runs.append((start, last))
                    start = y
                last = y
        if start is not None:
            runs.append((start, last))
        if runs:
            found[x] = max(runs, key=lambda r: r[1] - r[0])
    # its lower edge as one smooth line: the little split between its halves filled (the highest of the lowest nearby), then
    # evened out, so the opening under it has a clean edge
    xs = sorted(found)
    near = lambda x, w: [i for i in range(x - w, x + w + 1) if i in found]
    filled = {x: max(found[i][1] for i in near(x, SPLIT)) for x in xs}
    filled = {x: min(filled[i] for i in near(x, SPLIT)) for x in xs}
    return {x: (found[x][0], sum(filled[i] for i in near(x, 2)) / len(near(x, 2))) for x in xs}


def pose(im, tash, cx, opening, width, lift, wings):
    """The mouth opened `opening` px in the middle, the moustache's middle lifted `lift` more and the whole of it `wings` (its
    tips most), as a transparent layer over the picture."""
    big = im.resize((im.width, im.height * SS), Image.BICUBIC)
    out = Image.new("RGBA", big.size, (0, 0, 0, 0))
    half, reach = HALF * width, max(cx - min(tash), max(tash) - cx)
    for x in sorted(tash):
        u, v = (x - cx) / half, (x - cx) / reach
        shape = (1 - u * u) ** 0.55 if abs(u) < 1 else 0  # the opening: rounded, fuller in the middle
        top, bottom = tash[x]
        under = (bottom + 1) * SS                   # the first row under the moustache
        up = (wings * (0.6 + 0.4 * v * v) + lift * shape) * SS
        gap = opening * shape * SS
        # the moustache's lower edge comes up. Under his nose (which stays in front) its top stays put and it's squashed; out
        # towards its ends, where there's only cheek above, it moves up whole
        whole = min(1.0, max(0.0, (abs(v) - NOSE) / NOSE))
        start = top * SS - up * whole
        for j in range(round(start), round(under - up)):
            src = top * SS + (j - start) * (under - top * SS) / (under - up - start)
            out.putpixel((x, j), (*big.getpixel((x, round(src))), 255))
        if not shape:
            # past the opening: the skin under it stretched up to meet it
            for j in range(round(under - up), round(under + SKIN * SS)):
                src = under + (j - under + up) * SKIN * SS / (SKIN * SS + up)
                out.putpixel((x, j), (*big.getpixel((x, round(src))), 255))
            continue
        rim = big.getpixel((x, round(under + SS)))  # the shadow just under the moustache
        for j in range(round(under - up), CHIN * SS):
            if j < under + gap:
                # inside: the shadow's colour at the edges, deep in the middle, darkest right under the moustache
                f = (j - (under - up)) / (gap + up)
                depth = min(1.0, 4 * f * (1 - f) + 0.4 * (1 - f)) * min(1.0, (1 - abs(u)) * 3)
                out.putpixel((x, j), (*mix(rim, INSIDE, depth), 255))
            else:
                # below: the jaw, squashed into what's left above the chin
                src = under + (j - under - gap) * (CHIN * SS - under) / (CHIN * SS - under - gap)
                out.putpixel((x, j), (*big.getpixel((x, round(src))), 255))
    return out.resize(im.size, Image.BOX)


def main():
    im = Image.open(SRC).convert("RGB")
    tash = measure(im)
    # the opening's middle: the middle of the columns where the moustache's lower edge is highest
    low = min(b for _, b in tash.values())
    mid = sorted(x for x, (_, b) in tash.items() if b <= low + 2)
    cx = (mid[0] + mid[-1]) / 2
    pieces = [pose(im, tash, cx, *p) for p in POSES]
    crop = save(pieces, f"{NAME}-mouth-", [str(i + 1) for i in range(len(pieces))])
    print(f"MOUTH_CROP = {{x: {crop['x']}, y: {crop['y']}, w: {crop['w']}, h: {crop['h']}}}")
    print(f"(in the {im.width}x{im.height} {SRC.name}; the opening's middle at x {cx:.1f}, moustache's lowest middle row {low})")


if __name__ == "__main__":
    main()
