#!/usr/bin/env python3
"""Makes Frank's eye pieces, the stop-motion way (as scripts/tim_eyes.py does for Tim): replacement pieces cut from his own
picture, swapped in as held poses.

He's deadpan: his lids already sit half down, and his eyes only ever move to look down at his laptop.

Look down: his pupils painted out (each row of the white filled from either side, inside the eye only), then each pupil put
back DOWN px lower and kept inside the white, so it tucks under the lid and the eye's bottom edge. Only its lower half shows in
the picture (the rest is under his lid), so the top half is the lower half mirrored; looking down, it's a little squashed, as on
a round eye. His lid comes half down over it (frank-blink-2, lidFor in src/lib/timEyes.ts), so it stays about as covered as it
is now. Saved as assets/frank-look-down.png.

Blink lids: in each column his own upper lid comes down over the eye: the rim (the darker line along the top of the eye) slides
to top + t * (bottom - top) and the lid skin above it, from just under his glasses' top rim down, stretches to meet it. One lid,
so no second rim is left behind. Past each corner the movement fades out, so no column jumps. Nothing is ever drawn over his
glasses: the lid stops where the frame starts (on the nose side it's only a few pixels away), and covers only the frame's soft
edge, so the old rim's end, where it met the frame, doesn't stick out. Part-shut lids have a see-through shadow under the rim, so
they sit over the eye. Saved as assets/frank-blink-1.png, -2, -3 (t = 0.2, 0.5, 1). The half lid is held while he looks down,
so it has to hold up to a long look, not just a blink.

Made from assets/frank.jpg itself, so every piece lines up pixel for pixel with the picture on screen. Prints LOOK_CROP and
LID_CROP (where the pieces go in frank.jpg) for src/app/(tabs)/tim.tsx. Run it again whenever frank.jpg changes.

Run from mobile/: python3 scripts/frank_eyes.py   (needs Pillow)
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

from tim_eyes import POSES, SHADOW, SS, eye_mask, lum, save, smooth

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "frank.jpg"

DOWN = 19                        # looking down at his laptop: how far his pupils drop
SQUASH_DOWN = 0.85               # ...and how much shorter they look, on a round eye
PUPIL_DARK = 70                  # darker than this, under his lid, is a pupil
PUPIL_PAD = 2.5                  # painted out this far past the pupil, so no dark ring is left
LID_SHADE = 2                    # rows under a pupil's centre still in his lid's warm shadow

EYES = [(358, 432), (448, 522)]  # columns to look for each eye in (inside each lens of his glasses)
ROWS = (362, 412)                # rows to look in: under the glasses' top rim, over its bottom one
FRAME = 80                       # darker than this is his glasses' frame (or a pupil, or a lid's dark line)
FRAME_SEEDS = [(402, 356), (480, 356)]  # a pixel on the frame's top rim over each eye: the frame is everything dark joined to these
SHADE = 3                        # rows under the frame's top rim kept as they are: its soft shadow isn't stretched into the lid
TAPER = 6                        # columns past each corner over which the lid's movement fades to nothing
COVER = 1                        # shut, the lid comes this far past the white's bottom edge, onto the line where the lids meet
MIN_SKIN = 8                     # rows of lid skin a column needs to make its own lid from
RIM_DARK = 105                   # a lid rim darker than this is in the shadow over his pupil, not the lid's own edge (~115-140)


def white(p):
    # the white of his eye, shaded grey at the corners and soft where it meets the frame; skin has red well above blue, and the
    # frame is dark
    return lum(p) >= FRAME and p[0] - p[2] < 45


def pupil(p):
    return lum(p) < 70 and p[0] - p[2] < 35


def skin(p):
    return p[0] - p[2] >= 45


def pale(p):
    return lum(p) > 120 and p[0] - p[2] < 62


def frame_mask(im):
    """His glasses: everything dark joined to the top rim (not grown: past its edge is the white, which the lid must cover)."""
    mask = Image.new("L", im.size, 0)
    seen, todo = set(), list(FRAME_SEEDS)
    x0, x1 = EYES[0][0] - 20, EYES[1][1] + 20
    while todo:
        x, y = todo.pop()
        if (x, y) in seen or not (x0 <= x < x1 and ROWS[0] - 20 <= y < ROWS[1] + 12) or lum(im.getpixel((x, y))) >= FRAME:
            continue
        seen.add((x, y))
        mask.putpixel((x, y), 255)
        todo += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    return mask


def keep_off(frame):
    """Where a lid is never drawn: his glasses, without the bump where his lid's rim runs into them (opened), and less their
    soft edge (eroded a pixel), so the moved lid meets the frame cleanly."""
    return frame.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))


def measure(im, frame, x0, x1):
    """The eye in each column: its first row (up through the pupil, which sits under his lid, to the first skin or the frame) and
    the white's last row."""
    found = {}
    for x in range(x0, x1):
        runs, start, last = [], None, None
        for y in range(*ROWS):
            if white(im.getpixel((x, y))) or pale(im.getpixel((x, y))):
                if start is None or y - last > 3:
                    if start is not None:
                        runs.append((start, last))
                    start = y
                last = y
        if start is not None:
            runs.append((start, last))
        best = max(runs, key=lambda r: r[1] - r[0], default=None)
        if not best:
            continue  # even a pixel of white counts, so the lid covers the eye's soft corners too
        top, bottom = best
        while top > ROWS[0] and not skin(im.getpixel((x, top - 1))) and not frame.getpixel((x, top - 1)):
            top -= 1
        while bottom < ROWS[1] and pale(im.getpixel((x, bottom + 1))):
            bottom += 1  # the white's soft lower edge, pinker as it meets the lower lid
        found[x] = (top, bottom)
    # only the eye itself: the longest stretch of columns in a row
    blocks, cur = [], []
    for x in sorted(found):
        if cur and x != cur[-1] + 1:
            blocks.append(cur)
            cur = []
        cur.append(x)
    blocks.append(cur)
    return {x: found[x] for x in max(blocks, key=len)}


def skin_top(frame, x, rim):
    """The first row of clean lid skin in a column: up from the lid's rim to the frame's top rim (from below, as his eyebrows
    touch the frame above it), then back down past its shadow."""
    y = rim
    while y > ROWS[0] - 20 and not frame.getpixel((x, y - 1)):
        y -= 1
    return y + SHADE


def median(xs, values, width):
    out = {}
    for x in xs:
        near = sorted(values[i] for i in range(x - width // 2, x + width // 2 + 1) if i in values)
        out[x] = near[len(near) // 2]
    return out


def rim_end(im, x, top):
    """Just under the lid's rim: the darkest row of lid (not pupil) right above the eye (the lower of two as dark), plus one."""
    rows = [y for y in range(top - 4, top) if not pupil(im.getpixel((x, y)))]
    return min(rows, key=lambda y: (round(lum(im.getpixel((x, y)))), -y)) + 1


def lid_plan(im, frame, eyes, pupils):
    """Per column: the lid skin it's made from (srcs: column, first row, end row, share; one, or two blended), the row it's drawn
    from (start), where its rim is now (rim), how far it comes down when shut (drop), and how much of the lid shows (weight)."""
    plan = {}
    for eye, (cx, _, r) in zip(eyes, pupils):
        xs = sorted(eye)
        rows = {x: rim_end(im, x, eye[x][0]) for x in xs}
        rows = {x: min(eye[x][0], v) for x, v in median(xs, rows, 5).items()}  # a smooth line, so one column can't jump; never into the eye
        rim = smooth(xs, rows, 9)
        end = {x: eye[x][1] + 1 + COVER for x in xs}
        end = {x: max(end[x], v) for x, v in smooth(xs, end, 5).items()}  # smoothed, never short of covering the eye
        cols = range(xs[0] - TAPER, xs[-1] + TAPER + 1)
        src = {x: rows[min(max(x, xs[0]), xs[-1])] for x in cols}  # past the corners, the corner's
        skin = {x: skin_top(frame, x, src[x]) for x in cols}
        open_ = [x for x in cols if skin[x] < src[x]]  # the columns with some lid skin (not all frame, as under the bridge)
        skin |= {x: round(v) for x, v in smooth(open_, {x: skin[x] for x in open_}, 9).items()}
        # a column makes its lid from the skin above it. Right by the bridge of his glasses there's too little (the frame's shadow
        # comes down to the eye), so the lid there is a stretch of that shadow, as it would be. Where the rim is the dark shadow
        # over his pupil, it's the nearest columns either side with a clean rim, blended. (Only over the pupil: next to the frame
        # the rim is dark from the frame's shadow, which stays on the lid.)
        short = {x for x in cols if src[x] - skin[x] < MIN_SKIN}
        shaded = lambda x: abs(x - cx) <= r + PUPIL_PAD and lum(im.getpixel((x, src[x] - 1))) < RIM_DARK
        good = [x for x in cols if x not in short and not shaded(x)]

        def srcs(x):
            if x in short:
                return [(x, src[x] - MIN_SKIN, src[x], 1.0)]
            left = max((g for g in good if g <= x), default=None)
            right = min((g for g in good if g >= x), default=None)
            if left is None or right is None or left == right:
                g = right if left is None else left
                return [(g, skin[g], src[g], 1.0)]
            f = (x - left) / (right - left)
            return [(left, skin[left], src[left], 1 - f), (right, skin[right], src[right], f)]

        start = lambda x: src[x] - MIN_SKIN if x in short else skin[x]
        for x in xs:
            plan[x] = (srcs(x), start(x), rim[x], end[x] - rim[x], 1.0)
        # past each corner: the rim stays at the corner's height, its drop eases out like the round corner of a lid, and the moved
        # lid fades into the face, so its rim doesn't poke out past the eye
        for edge, step in ((xs[0], -1), (xs[-1], 1)):
            for k in range(1, TAPER + 1):
                f = k / (TAPER + 1)
                x = edge + step * k
                plan[x] = (srcs(x), start(x), rim[edge], (end[edge] - rim[edge]) * (1 - f * f) ** 0.5 * (1 - f), (1 - f) ** 2)
    return plan


def lid(im, frame, plan, t):
    """The lid t of the way down, as a transparent layer: lid skin, and a see-through shadow under its rim. Never over his glasses."""
    out = Image.new("RGBA", (im.width, im.height * SS), (0, 0, 0, 0))
    for x, (srcs, start, rim, drop, weight) in plan.items():
        n = round((rim + t * drop - start) * SS)
        if n <= 0:
            continue
        # cut out first: resizing with a box would sample past its end, smearing the white under the rim into the lid's edge
        cut = lambda sx, a, b: im.crop((sx, a, sx + 1, b)).resize((1, n), Image.BICUBIC)
        (sx, a, b, _), *more = srcs
        strip = cut(sx, a, b)
        for sx, a, b, share in more:
            strip = Image.blend(strip, cut(sx, a, b), share)
        strip = strip.convert("RGBA")
        strip.putalpha(round(255 * weight))
        out.paste(strip, (x, start * SS))
        end = start * SS + n
        if t < 1:
            for j in range(SHADOW * SS):
                out.putpixel((x, end + j), (40, 16, 6, round(255 * 0.22 * (1 - j / (SHADOW * SS)) * weight)))
    out = out.convert("RGBa").resize(im.size, Image.BOX).convert("RGBA")
    out.putalpha(ImageChops.multiply(out.getchannel("A"), ImageChops.invert(keep_off(frame))))
    return out


# ---- looking down ----

def find_pupil(im, eye):
    """A pupil's centre and radius. Only its lower part shows under his lid, so the centre is its radius (half its width) up
    from its bottom edge."""
    dark = [(x, y) for x, (t, b) in eye.items() for y in range(t, b + 1) if lum(im.getpixel((x, y))) < PUPIL_DARK]
    x0, x1 = min(p[0] for p in dark), max(p[0] for p in dark)
    r = (x1 - x0 + 1) / 2
    return (x0 + x1) / 2, max(p[1] for p in dark) + 0.5 - r, r


def paint_out(im, eyes, pupils):
    """The picture with the pupils gone: each row across a pupil filled from the pixels either side of it, inside the eye only
    (his lid above stays as it is), then softened."""
    out = im.copy()
    region = Image.new("L", im.size, 0)
    for eye, (cx, cy, r) in zip(eyes, pupils):
        R = r + PUPIL_PAD
        for y in range(int(cy - R), int(cy + R) + 2):
            half = max(0.0, R * R - (y - cy) ** 2) ** 0.5
            if half <= 0:
                continue
            xl, xr = int(cx - half) - 1, int(cx + half) + 1
            a, b = im.getpixel((xl, y)), im.getpixel((xr, y))
            for x in range(xl + 1, xr):
                if x not in eye or y < eye[x][0]:
                    continue
                f = (x - xl) / (xr - xl)
                out.putpixel((x, y), tuple(round(a[i] * (1 - f) + b[i] * f) for i in range(3)))
                region.putpixel((x, y), 255)
    soft = out.filter(ImageFilter.GaussianBlur(1.2))
    out.paste(soft, (0, 0), region.filter(ImageFilter.GaussianBlur(1)))
    return out, region


def cut_pupil(im, clean, pupil):
    """The pupil as a round piece, in its own colour, with the soft edge it has in the picture. Its top half is under his lid,
    so the edge there is its lower half's, mirrored. Its colour is from below the lid's warm shadow (LID_SHADE rows down from
    the centre): moved down, that shadow would be a stripe across it; the lid's own rim shadow shades it instead."""
    cx, cy, r = pupil
    size = int(2 * (r + 3)) + 1
    x0, y0 = round(cx) - size // 2, round(cy) - size // 2
    inside = [im.getpixel((x, y)) for x in range(x0, x0 + size) for y in range(round(cy) + LID_SHADE, y0 + size)
              if ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 <= r - 1.5]
    colour = tuple(round(sum(p[k] for p in inside) / len(inside)) for k in range(3))
    core = lum(colour)
    piece = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    for j in range(size):
        for i in range(size):
            x, y = x0 + i, y0 + j
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d > r + 1.5:
                continue
            sy = y if y >= cy else round(2 * cy - y)
            p, c = im.getpixel((x, sy)), clean.getpixel((x, sy))
            a = 1.0 if d <= r - 1.5 else max(0.0, min(1.0, (lum(c) - lum(p)) / max(1.0, lum(c) - core)))
            if a > 0:
                piece.putpixel((i, j), (*colour, round(a * 255)))
    return piece, (cx - x0, cy - y0)


def look_down(im, eyes, pupils):
    """The eyes looking down: the whites with his pupils DOWN px lower, kept inside the whites; only where it changed."""
    clean, painted = paint_out(im, eyes, pupils)
    mask = eye_mask(im, eyes)
    out = clean.convert("RGBA")
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    for pupil in pupils:
        piece, (ox, oy) = cut_pupil(im, clean, pupil)
        piece = piece.resize((piece.width, round(piece.height * SQUASH_DOWN)), Image.LANCZOS)
        cx, cy, _ = pupil
        layer.alpha_composite(piece, (round(cx - ox), round(cy + DOWN - oy * SQUASH_DOWN)))
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), mask))
    out.alpha_composite(layer)
    out.putalpha(ImageChops.lighter(mask, painted.filter(ImageFilter.GaussianBlur(1))))
    return out


def main():
    im = Image.open(SRC).convert("RGB")
    frame = frame_mask(im)
    eyes = [measure(im, frame, x0, x1) for x0, x1 in EYES]
    pupils = [find_pupil(im, eye) for eye in eyes]
    look_crop = save([look_down(im, eyes, pupils)], "frank-look-", ["down"])
    plan = lid_plan(im, frame, eyes, pupils)
    lid_crop = save([lid(im, frame, plan, t) for t in POSES], "frank-blink-", ["1", "2", "3"])
    print(f"LOOK_CROP = {{x: {look_crop['x']}, y: {look_crop['y']}, w: {look_crop['w']}, h: {look_crop['h']}}}")
    print(f"LID_CROP = {{x: {lid_crop['x']}, y: {lid_crop['y']}, w: {lid_crop['w']}, h: {lid_crop['h']}}}")
    print(f"(in the {im.width}x{im.height} frank.jpg; eyes in columns " + ", ".join(f"{min(e)}-{max(e)}" for e in eyes)
          + "; pupils at " + ", ".join(f"({cx:.1f}, {cy:.1f}) r {r:.1f}" for cx, cy, r in pupils) + ")")


if __name__ == "__main__":
    main()
