#!/usr/bin/env python3
"""Takes the notebook and pen off Frank's desk (bottom right of his picture).

scripts/frank-with-book.jpg is the picture as drawn; this writes assets/frank.jpg without them. The book is everything in BOX
that isn't the flat background, except his sleeve: near it, only light pixels (the book's tan cover, the desk) count, never the
dark knit. Each pixel under the book is filled down its column, from the clean desk above it to the clean desk below; next to his
sleeve it eases in from the desk on its left, so the soft shadow under his arm carries on instead of stopping in a hard line.
The edge is feathered a pixel so there's no seam.

Run from mobile/: python3 scripts/frank_clean.py   (needs Pillow)
"""
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "scripts" / "frank-with-book.jpg"
OUT = ROOT / "assets" / "frank.jpg"

BOX = (724, 750, 873, 818)  # left, top, right (last column), bottom: the book, the pen and the book's shadow
SLEEVE = (742, 786)          # left of this column and above this row, the dark pixels are his sleeve, not the book
BG = 245                     # the flat background
OFF = 8                      # further from BG than this is something drawn
EASE = 14                    # columns over which a fill next to his sleeve eases from the desk on its left
WIDTH = 874                  # the picture's width
SPREAD = 8                  # columns either side averaged for each column's ends


def near(px, m, x: int, y: int, way: int, spread: int = SPREAD) -> tuple:
    """The clean desk at (x, y), averaged over the columns either side and a few rows further out (away from the book), so
    single pixels' grain doesn't streak down a whole column. Skips anything under the book and anything dark (his sleeve)."""
    got = []
    for dy in range(3):
        for dx in range(-spread, spread + 1):
            xx, yy = x + dx, y + way * dy
            if 0 <= xx < WIDTH and not m[xx, yy]:
                p = px[xx, yy]
                if sum(p) / 3 > 200:
                    got.append(p)
    if not got:
        return px[x, y]
    return tuple(sum(p[i] for p in got) / len(got) for i in range(3))


def main() -> None:
    im = Image.open(SRC).convert("RGB")
    px = im.load()
    l, t, r, b = BOX
    lum = lambda p: (p[0] + p[1] + p[2]) / 3

    mask = Image.new("L", im.size, 0)
    m = mask.load()
    for y in range(t, b + 1):
        for x in range(l, r + 1):
            v = lum(px[x, y])
            if abs(v - BG) <= OFF:
                continue
            if x < SLEEVE[0] and y < SLEEVE[1] and v < 120:
                continue  # his sleeve
            m[x, y] = 255
    mask = mask.filter(ImageFilter.MaxFilter(5))  # a little past the book's soft edge
    m = mask.load()

    out = im.copy()
    o = out.load()
    for x in range(l, r + 1):
        rows = [y for y in range(t - 2, b + 3) if m[x, y]]
        if not rows:
            continue
        top, bot = rows[0] - 1, rows[-1] + 1
        a, c = near(px, m, x, top, -1), near(px, m, x, bot, 1)
        if lum(a) < 200:
            a = c  # above is his sleeve: use the desk below
        for y in rows:
            k = (y - top) / (bot - top)
            fill = [a[i] + (c[i] - a[i]) * k for i in range(3)]
            # next to his sleeve, ease in from the desk on the left of the book, row by row
            left = l - 1
            while left > 0 and m[left, y]:
                left -= 1
            d = x - left
            if d < EASE and lum(px[left, y]) > 120:
                w = 1 - d / EASE
                fill = [fill[i] * (1 - w) + px[left, y][i] * w for i in range(3)]
            o[x, y] = tuple(round(v) for v in fill)

    soft = mask.filter(ImageFilter.GaussianBlur(1))
    Image.composite(out, im, soft).save(OUT, quality=95)
    print(f"saved {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
