#!/usr/bin/env python3
"""Makes Frank's typing pieces, the stop-motion way (as scripts/frank_eyes.py does for his eyes): replacement pieces cut from
his own picture, swapped in as held poses.

His hands are behind his laptop: all that shows of them is a shirt cuff and a sliver of wrist on each side of it. Typing, each
hand lifts a little off the keys and comes back down, so each piece is that side's cuff and wrist moved up by LIFTS px (a
small lift and a bigger one). It's a smooth warp of his own picture, not a cut-out: the lift is full against the laptop's edge
and fades to nothing towards his elbow (REACH px out), up his sleeve (TOP rows) and down to where his sleeve rests on the desk
(BOTTOM rows), so the knit stretches rather than tears and no gap opens. It's only ever up and down, so the laptop's straight
edge, which is in front of his hands, stays put: the warp stops at it (its soft edge moves with the cuff, as it should).
Saved as assets/frank-hands-left-1.png, -left-2, -right-1, -right-2.

Made from assets/frank.jpg itself, so every piece lines up pixel for pixel with the picture on screen. Prints HANDS_CROP (where
the pieces go in frank.jpg) for src/app/(tabs)/tim.tsx. Run it again whenever frank.jpg changes.
With --dark, the same from his dark-mode picture (assets/frank-dark.jpg, by frank_dark.py), saved as frank-dark-hands-….

Run from mobile/: python3 scripts/frank_hands.py [--dark]   (needs Pillow)
"""
import sys
from math import cos, pi
from pathlib import Path

from PIL import Image

from frank_dark import darkened_piece
from tim_eyes import lum

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "frank.jpg"
ASSETS = ROOT / "assets"

LIFTS = [2.0, 4.0]               # how far a hand lifts, px of frank.jpg: a little, and more
ROWS = (680, 784)                # rows the lift can reach: his sleeve above the cuff, down to the desk
TOP = 26                         # rows at the top over which the lift fades in
BOTTOM = 14                      # rows at the bottom (where his sleeve rests on the desk) over which it fades out
REACH = 42                       # columns out from the laptop's edge over which it fades out, towards his elbow
SIDES = {"left": (230, 300), "right": (560, 640)}  # columns to look for the laptop's edge in, either side
LID = (5, 55, 140)               # the laptop's lid: at least this much bluer than red, and between these brightnesses

# His dark-mode picture is put where his face is in frank.jpg; there his cuffs come down to the desk a few rows lower, and the
# laptop's lid, lit less, is dimmer and only just bluer than red at its edges.
DARK = "--dark" in sys.argv
if DARK:
    SRC = ROOT / "scripts" / "frank-dark-placed.jpg"  # before it was darkened (frank_dark.py); each piece is darkened as it's saved
    ROWS = (680, 790)
    LID = (2, 45, 140)
NAME = "frank-dark" if DARK else "frank"


def laptop(p):
    # the laptop's lid: a flat blue-grey (his jumper is darker and redder, his cuff white)
    return p[2] - p[0] >= LID[0] and LID[1] < lum(p) < LID[2]


def edges(im, side):
    """The laptop's edge in each row: its first column of solid lid, coming in from that side."""
    x0, x1 = SIDES[side]
    found = {}
    for y in range(*ROWS):
        xs = range(x0, x1) if side == "left" else range(x1, x0, -1)
        step = 1 if side == "left" else -1
        found[y] = next(x for x in xs if all(laptop(im.getpixel((x + step * k, y))) for k in range(4)))
    return found


def ease(f):
    """0 to 1, smoothly."""
    f = min(1.0, max(0.0, f))
    return 0.5 - 0.5 * cos(pi * f)


def sample(im, x, y):
    """The picture at (x, y), y fractional: the two rows either side, blended."""
    y0 = int(y)
    f = y - y0
    a, b = im.getpixel((x, y0)), im.getpixel((x, min(im.height - 1, y0 + 1)))
    return tuple(round(a[k] * (1 - f) + b[k] * f) for k in range(3))


def hand(im, edge, side, lift):
    """One side's cuff and wrist lifted `lift` px: each pixel shows what was below it, by as much as the lift reaches there."""
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    for y in range(*ROWS):
        fy = ease((y - ROWS[0]) / TOP) * ease((ROWS[1] - y) / BOTTOM)
        for k in range(1, REACH + 1):
            x = edge[y] - k if side == "left" else edge[y] + k  # k = 1: the laptop's soft edge
            d = lift * fy * ease(1 - (k - 1) / REACH)
            if d > 0.01:
                out.putpixel((x, y), (*sample(im, x, y + d), 255))
    return out


def main():
    im = Image.open(SRC).convert("RGB")
    crops = {}
    for side in SIDES:
        edge = edges(im, side)
        pieces = [hand(im, edge, side, lift) for lift in LIFTS]
        box = pieces[-1].getchannel("A").getbbox()  # the bigger lift reaches furthest
        for i, p in enumerate(pieces, 1):
            (darkened_piece(p) if DARK else p).crop(box).save(ASSETS / f"{NAME}-hands-{side}-{i}.png", optimize=True)
        crops[side] = box
    print("HANDS_CROP = {" + ", ".join(f"{s}: {{x: {b[0]}, y: {b[1]}, w: {b[2] - b[0]}, h: {b[3] - b[1]}}}" for s, b in crops.items()) + "}")
    print(f"(in the {im.width}x{im.height} {SRC.name})")


if __name__ == "__main__":
    main()
