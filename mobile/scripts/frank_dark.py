#!/usr/bin/env python3
"""Makes Frank's dark-mode picture, assets/frank-dark.jpg, from the "Frank · your accountant (dark mode)" frame's.

scripts/frank-dark-source.jpg is that picture as drawn: Frank in a dark room, the wall the dark page's colour, so he blends into
it the way frank.jpg does into the light page. It's framed differently (taller, Frank smaller), so it's scaled and placed to put
his face exactly where it is in frank.jpg: the same 874x880, so the screen's layout (where he sits, his captions' boxes, his
bubble) is the same in both modes and only his picture and the pieces made from it change. The fit: SCALE and AT, measured off
both pictures, then nudged a pixel or two (NUDGE) to whatever lines his glasses, eyes and moustache (FACE) up best. Scaled, he
doesn't reach frank.jpg's sides, so each side is filled with the wall beside it, mirrored (its grain carries on, no streaks).
The dark page is darker than the drawn wall now, so the wall is taken down to it last (`darkened`). His pieces are found in the
picture from before that (scripts/frank-dark-placed.jpg, whose colours the scripts' tests were tuned on) and darkened the same way.

His pieces are then made from it the same way as from frank.jpg: frank_eyes.py, frank_mouth.py and frank_hands.py with --dark.

Run from mobile/: python3 scripts/frank_dark.py   (needs Pillow)
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter, ImageOps, ImageStat

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "scripts" / "frank-dark-source.jpg"
LIGHT = ROOT / "assets" / "frank.jpg"
OUT = ROOT / "assets" / "frank-dark.jpg"
PLACED = ROOT / "scripts" / "frank-dark-placed.jpg"  # the same before it's darkened: his pieces are found in it

SCALE = 0.7725                 # px of frank.jpg per px of the drawn picture: his glasses the same size
AT = (7, -32)                  # where the drawn picture's top left lands in frank.jpg
NUDGE = 3                      # px either way to look for a better fit, and SCALE this much either way in 5 steps
NUDGE_SCALE = 0.005
FACE = (340, 330, 540, 500)    # his glasses, eyes, nose and moustache in frank.jpg: what's fitted
FIGURE_ROWS = (240, 511)       # rows his captions sit beside (FRANK_BOX in src/lib/timSpeech.ts): how wide he is there
WALL_OFF = 40                  # further than this (summed over r, g, b) from the wall beside him is him
WALL = (23, 23, 27)            # the wall's brightest grain (r, g, b; 99.9% of its top and sides are at or under it)
PAGE = (14, 14, 16)            # the dark page (#0E0E10, `dark.bg` and `timPage.dark.page` in src/theme/tokens.ts): WALL becomes it


def edges(im):
    """Where things change, stretched to the full range so pictures lit differently compare."""
    return ImageOps.autocontrast(im.convert("L").filter(ImageFilter.GaussianBlur(1)).filter(ImageFilter.FIND_EDGES), cutoff=1)


def likeness(a, b):
    """How alike two same-sized edge maps are: their correlation, -1 to 1."""
    sa, sb = ImageStat.Stat(a), ImageStat.Stat(b)
    both = ImageStat.Stat(ImageChops.multiply(a, b)).mean[0] * 255
    return (both - sa.mean[0] * sb.mean[0]) / (sa.stddev[0] * sb.stddev[0] + 1e-9)


def placed(src, scale, at, size):
    """The drawn picture scaled and put at `at` in a picture `size` big; past its sides, the wall beside it mirrored."""
    w, h = round(src.width * scale), round(src.height * scale)
    big = src.resize((w, h), Image.LANCZOS)
    out = Image.new("RGB", size)
    out.paste(big, at)
    left, right = at[0], at[0] + w  # its first column, and one past its last
    if left > 0:
        out.paste(ImageOps.mirror(out.crop((left, 0, 2 * left, size[1]))), (0, 0))
    if right < size[0]:
        n = size[0] - right
        out.paste(ImageOps.mirror(out.crop((right - n, 0, right, size[1]))), (right, 0))
    return out


def darkened(im):
    """WALL and anything under it becomes PAGE, and everything above it is stretched from there up to white, so the wall is the
    page's colour and he keeps his tones."""
    level = lambda v, k, p: max(p, round(p + (v - k) * (255 - p) / (255 - k)))  # noqa: E731
    return Image.merge("RGB", [im.getchannel(c).point(lambda v, c=c: level(v, WALL[c], PAGE[c])) for c in range(3)])


def darkened_piece(im):
    """A piece made from PLACED, darkened the same way (its see-through edges kept)."""
    return Image.merge("RGBA", [*darkened(im.convert("RGB")).split(), im.getchannel("A")])


def main() -> None:
    src = Image.open(SRC).convert("RGB")
    light = Image.open(LIGHT).convert("RGB")
    want = edges(light.crop(FACE))
    fits = []
    for i in range(5):
        scale = SCALE + NUDGE_SCALE * (i - 2) / 2
        big = src.resize((round(src.width * scale), round(src.height * scale)), Image.LANCZOS)
        got = edges(big)
        for dy in range(-NUDGE, NUDGE + 1):
            for dx in range(-NUDGE, NUDGE + 1):
                x, y = AT[0] + dx, AT[1] + dy
                box = (FACE[0] - x, FACE[1] - y, FACE[2] - x, FACE[3] - y)
                fits.append((likeness(want, got.crop(box)), scale, (x, y)))
    best, scale, at = max(fits)
    out = placed(src, scale, at, light.size)
    out.save(PLACED, quality=95)
    darkened(out).save(OUT, quality=95)

    # how wide he is beside his captions, to check FRANK_BOX's figure still holds
    px = out.load()
    wall = lambda y: (px[2, y], px[out.width - 3, y])
    near = lambda p, q: sum(abs(p[i] - q[i]) for i in range(3)) <= WALL_OFF
    lo, hi = out.width, 0
    for y in range(*FIGURE_ROWS):
        a, b = wall(y)
        him = [x for x in range(out.width) if not near(px[x, y], a) and not near(px[x, y], b)]
        if him:
            lo, hi = min(lo, him[0]), max(hi, him[-1])
    print(f"saved {OUT.relative_to(ROOT)}: scale {scale:.4f}, top left at {at} (fit {best:.3f})")
    print(f"his widest in rows {FIGURE_ROWS[0]}-{FIGURE_ROWS[1]}: columns {lo}-{hi}")


if __name__ == "__main__":
    main()
