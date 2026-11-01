#!/usr/bin/env python3
"""Makes Tim's mouth pieces, the stop-motion way (like scripts/tim_eyes.py): replacement poses cut from his own picture.

He always smiles. His picture has a straight mouth, so the smile is measured from another picture of him smiling
(scripts/tim-smile.jpg, a different render, lined up on his eyes and nose: SMILE_FIT). His own line is taken out (each column
filled from the skin above and below it), then the smile's shading is carried across from a narrow band along its line (each
pixel as a share of the skin around it there), so its curve, its curled ends and their dimples come with it but none of that
picture's own skin or nose. Saved as tim-mouth-0.png: his face at rest, always laid over the picture.

Talking, his whole mouth moves, column by column, so it reads as much as Frank's moustache does:
- his jaw drops from the smile: everything under the line, down to his chin, is pushed down by the opening there (most in the
  middle, nothing at its ends, a rounded shape) and squashed into the rows above the chin, so the chin stays put and nothing
  tears;
- his upper lip lifts in the middle (the rows above the line squashed up into the ones above them), and the smile's curled tips
  ease down, as a smile does when it talks (the skin past them stretched to meet them);
- for "o" the tips are pulled in too (pinch: the columns either side drawn towards the middle, eased out above, below and past
  the tips).
The gap is the inside of his mouth: the line's own dark brown at its edges, darker in the middle, with a little shadow under
the upper lip and, in the wider poses, a soft hint of upper teeth under it. The line's lower half ends up as the lower lip's
edge.

Poses: tim-mouth-0 (the smile, shut), -1 (slightly open), -2 (open, "e"), -3 (round, "o"). Each is the whole smile with that
opening, so only one shows at a time. Saved as transparent PNGs cropped to one box.
Prints MOUTH_CROP (where they go in tim.jpg) for src/app/(tabs)/tim.tsx. Run it again whenever tim.jpg changes.

Run from mobile/: python3 scripts/tim_mouth.py   (needs Pillow)
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "tim.jpg"
ASSETS = ROOT / "assets"

COLS = (400, 480)       # columns to look for the line in
ROWS = (406, 432)       # rows to look for the line in (the smile's corners are higher than its middle)
DARK = 380              # r+g+b below this is the line (its middle is ~200, the skin around it ~430)
CHIN = 480              # the jaw's movement fades out by here; below, the picture is untouched
SS = 4                  # drawn at 4x and shrunk back, so the edges are smooth
INSIDE = (62, 24, 18)   # the deepest part of his mouth
TEETH = (196, 170, 150) # his upper teeth, in the mouth's warm shadow
UP = 7                  # rows above the line his upper lip lifts (squashed into them, so nothing tears)
TIP = 1.05              # the corners move most here, at the curled tips (a share of the line's half-width)
REACH = 1.45            # and their movement fades out by here
BAND = 9                # rows either side of the line the corners are pulled in over (eased out at its edges)
# (how far it opens in the middle, in px; how wide the opening is, as a share of the line; how far the upper lip lifts in the
# middle; how far the corners come down; how far they're pulled in, px; how much of the opening shows upper teeth)
POSES = [(4.5, 0.82, 1.5, 1.5, 0, 0.3), (11, 0.80, 3.0, 3.0, 0, 0.3), (7, 0.56, 2.0, 2.5, 8, 0)]
SMILE_SRC = ROOT / "scripts" / "tim-smile.jpg"
SMILE_FIT = (1.532, -43.5, 9.0)  # tim-smile.jpg px = scale * tim.jpg px + offset (x, y): the best fit of his eyes and nose
SMILE_COLS = (402, 476)          # columns the smile covers in tim.jpg (eased in and out over FEATHER at each end)
SMILE_UP, SMILE_DOWN = 5, 6      # the band along the smile's line its shading is taken from, rows above and below
CLEAN = (416, 433)               # rows of tim.jpg his own line is taken out between
FEATHER = 5


def measure(im):
    """The line: per column, the row (to a fraction of a px) its dark middle is on; and its first and last columns."""
    line = {}
    for x in range(*COLS):
        ws = [(y, max(0, 400 - sum(im.getpixel((x, y))) * 400 / 600)) for y in range(*ROWS)]
        darkest = min(range(*ROWS), key=lambda y: sum(im.getpixel((x, y))))
        if sum(im.getpixel((x, darkest))) > DARK:
            continue
        near = [(y, w) for y, w in ws if abs(y - darkest) <= 2]
        total = sum(w for _, w in near)
        line[x] = sum(y * w for y, w in near) / total if total else darkest
    xs = sorted(line)
    return line, xs[0], xs[-1]


def mix(a, b, f):
    return tuple(round(a[i] * (1 - f) + b[i] * f) for i in range(3))


def smooth(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def row_at(line, x):
    """The line's row at a fractional column (past its ends, the nearest end's)."""
    xs = sorted(line)
    x = min(xs[-1], max(xs[0], x))
    a = int(x)
    b = min(xs[-1], a + 1)
    ya, yb = line.get(a, line[min(xs, key=lambda k: abs(k - a))]), line.get(b, line[min(xs, key=lambda k: abs(k - b))])
    return ya + (yb - ya) * (x - a)


def pinch(im, line, x0, x1, inward):
    """The smile's ends pulled `inward` px towards the middle (for "o"), the skin either side following, eased out above and
    below the line and past its ends, so nothing tears."""
    if not inward:
        return im
    cx, half = (x0 + x1) / 2, (x1 - x0) / 2
    out = im.copy()
    for y in range(round(min(line.values())) - BAND, round(max(line.values())) + BAND + 1):
        for x in range(round(cx - half * REACH) - 1, round(cx + half * REACH) + 2):
            t = abs(x - cx) / half
            # how far this column is pulled in: none in the middle, most at the ends, none again past REACH
            k = inward * smooth(t / 0.9) * (1 - smooth((t - 0.9) / (REACH - 0.9)))
            k *= 1 - smooth(abs(y - row_at(line, x)) / BAND)
            src = x + (k if x > cx else -k)
            a = int(src)
            f = src - a
            p, q = im.getpixel((a, y)), im.getpixel((a + 1, y))
            out.putpixel((x, y), tuple(round(p[i] * (1 - f) + q[i] * f) for i in range(3)))
    return out


def pose(im, line, x0, x1, opening, width, lift, corner, inward, teeth):
    """The mouth opened `opening` px in the middle over `width` of the line, the upper lip lifted `lift` px, the corners come
    down `corner` px (and pulled in `inward`), upper teeth over `teeth` of the opening, as a layer over the picture."""
    cx, full = (x0 + x1) / 2, (x1 - x0) / 2  # the smile as it was, so the layer covers all the pinch moved
    im = pinch(im, line, x0, x1, inward)
    if inward:
        line, _, _ = measure(im)
    big = im.resize((im.width * SS, im.height * SS), Image.BICUBIC)
    out = Image.new("RGBA", big.size, (0, 0, 0, 0))
    half = full * width
    for X in range(round((cx - full * REACH) * SS), round((cx + full * REACH) * SS) + 1):
        x = (X + 0.5) / SS - 0.5
        u, v = (x - cx) / half, abs(x - cx) / full
        shape = (1 - u * u) ** 0.55 if abs(u) < 1 else 0  # the opening: rounded, fuller in the middle
        top = row_at(line, x)
        lip = (top + 0.5) * SS                              # the lower half of the line starts here
        # the upper lip's edge: up in the middle, the corners down, easing out past the ends
        dy = (-lift * shape + corner * smooth(v / TIP) * (1 - smooth((v - TIP) / (REACH - TIP)))) * SS
        gap = opening * shape * SS
        a = (top - UP) * SS
        rim = big.getpixel((X, round(top * SS)))           # the line's own colour
        for j in range(round(a), CHIN * SS):
            edge = lip + dy
            if j < edge:
                # above: the upper lip, squashed up into (or stretched down over) the rows above it
                src = a + (j - a) * (lip - a) / (edge - a)
                px = big.getpixel((X, round(src)))
            elif j < edge + gap:
                # inside: the line's colour at the edges, deep in the middle, darkest just under the upper lip; the upper
                # teeth just under it in the middle of a wide opening
                f = (j - edge) / gap
                depth = min(1.0, 4 * f * (1 - f) + 0.25 * (1 - f)) * min(1.0, (1 - abs(u)) * 3)
                px = mix(rim, INSIDE, depth)
                show = teeth * smooth((1 - abs(u)) / 0.5)
                if show and f < show:
                    px = mix(px, TEETH, 0.8 * smooth(min(f, show - f) * gap / SS / 1.2))
            else:
                # below: the jaw, squashed into what's left above the chin
                src = lip + (j - edge - gap) * (CHIN * SS - lip) / (CHIN * SS - edge - gap)
                px = big.getpixel((X, min(big.height - 1, round(src))))
            out.putpixel((X, j), (*px[:3], 255))
    return out.resize(im.size, Image.BOX)


def smile(im):
    """His smile, as a transparent layer over the picture."""
    s, ox, oy = SMILE_FIT
    ref = Image.open(SMILE_SRC).convert("RGB").transform(im.size, Image.AFFINE, (s, 0, ox, 0, s, oy), Image.BICUBIC)
    lum = lambda p: sum(p)
    avg = lambda img, x, ys: tuple(sum(img.getpixel((x, y))[i] for y in ys) / len(ys) for i in range(3))
    lerp = lambda a, b, t: tuple(a[i] * (1 - t) + b[i] * t for i in range(3))
    own, _, _ = measure(im)  # his own straight line, before the smile
    c0, c1 = SMILE_COLS
    # the smile's line, per column: its darkest row (past its ends, the nearest end's)
    sl = {}
    for x in range(c0, c1 + 1):
        y = min(range(395, 432), key=lambda y: lum(ref.getpixel((x, y))))
        if lum(ref.getpixel((x, y))) < DARK + 10:
            sl[x] = y
    found = sorted(sl)
    for x in range(c0, c1 + 1):
        sl.setdefault(x, sl[min(found, key=lambda k: abs(k - x))])
    mid = sl[round((found[0] + found[-1]) / 2)]
    dy = round(sum(own.values()) / len(own)) - mid  # where the smile's middle lands on his own line
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    t0, t1 = CLEAN
    for x in range(c0, c1 + 1):
        ease = min(1, (x - c0) / FEATHER, (c1 - x) / FEATHER)
        a, b = avg(im, x, range(t0 - 2, t0 + 1)), avg(im, x, range(t1, t1 + 3))
        rt, rb = sl[x] - SMILE_UP, sl[x] + SMILE_DOWN
        ra, rbb = avg(ref, x, range(rt - 2, rt + 1)), avg(ref, x, range(rb, rb + 3))
        for y in range(min(t0, rt + dy), max(t1, rb + dy) + 1):
            orig = im.getpixel((x, y))
            base = lerp(a, b, (y - t0) / (t1 - t0)) if t0 <= y <= t1 else orig
            ry = y - dy
            if rt <= ry <= rb:
                rp, rbase = ref.getpixel((x, ry)), lerp(ra, rbb, (ry - rt) / (rb - rt))
                shade = [min(1.0, rp[i] / max(1, rbase[i])) for i in range(3)]
            else:
                shade = [1, 1, 1]
            px = [(base[i] * shade[i]) * ease + orig[i] * (1 - ease) for i in range(3)]
            out.putpixel((x, y), (*(max(0, min(255, round(v))) for v in px), 255))
    return out


def save(pieces, prefix, names):
    box = pieces[0].getchannel("A").getbbox()
    for p in pieces[1:]:
        b = p.getchannel("A").getbbox()
        box = (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    for p, name in zip(pieces, names):
        p.crop(box).save(ASSETS / f"{prefix}{name}.png", optimize=True)
    return {"x": box[0], "y": box[1], "w": box[2] - box[0], "h": box[3] - box[1]}


def main():
    im = Image.open(SRC).convert("RGB")
    rest = smile(im)
    smiling = im.copy()
    smiling.paste(rest, (0, 0), rest)
    line, x0, x1 = measure(smiling)
    pieces = [rest]
    for args in POSES:
        p = rest.copy()
        p.alpha_composite(pose(smiling, line, x0, x1, *args))
        pieces.append(p)
    crop = save(pieces, "tim-mouth-", [str(i) for i in range(len(pieces))])
    print(f"MOUTH_CROP = {{x: {crop['x']}, y: {crop['y']}, w: {crop['w']}, h: {crop['h']}}}")
    print(f"(in the {im.width}x{im.height} tim.jpg; the smile runs {x0}..{x1} at y {min(line.values()):.1f}..{max(line.values()):.1f})")


if __name__ == "__main__":
    main()
