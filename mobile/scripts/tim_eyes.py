#!/usr/bin/env python3
"""Makes Tim's eye pieces, the stop-motion way: replacement pieces cut from his own picture, swapped in as held poses.

Looks: his pupils painted out (each row of the white filled from either side, so its shading stays), then each pupil, cut from
the original with its highlight, put back somewhere else and kept inside the white, so it tucks under the lid or the eye's edge.
Far to one side it's squashed a little, as on a round eye. Saved as assets/tim-look-<name>.png.

Blink lids: his own upper lid comes down over each eye, column by column: the rim (the darker line along the top of the eye)
slides to top + t * (bottom - top) and the lid skin above it, from the crease under his brow down, stretches to meet it. One lid,
so no second rim is left behind. Past each corner the movement fades out, so no column jumps. Part-shut lids have a see-through
shadow under the rim, so they sit over any look. Saved as assets/tim-blink-1.png, -2, -3 (t = 0.2, 0.5, 1).

Made from assets/tim.jpg itself, so every piece lines up pixel for pixel with the picture on screen. Prints LOOK_CROP and LID_CROP
(where the pieces go in tim.jpg) for src/app/(tabs)/tim.tsx. Run it again whenever tim.jpg changes.

Run from mobile/: python3 scripts/tim_eyes.py   (needs Pillow)
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "tim.jpg"
ASSETS = ROOT / "assets"

# Where to look, in px of tim.jpg (both eyes move together). (0, 0) is the picture: looking straight at you.
LOOKS = {
    "left": (-15, 5), "right": (15, 5),                              # glancing away
    "down": (0, 13), "downLeft": (-10, 12), "downRight": (10, 12),    # looking down (at what you type)
    "upLeft": (-13, -3), "upRight": (13, -3),                         # working something out
    "nearLeft": (-4, 1), "nearRight": (4, 1),                         # tiny shifts while looking at you
}
SQUASH = 0.18                   # how much a pupil narrows at 15px to the side
POSES = [0.2, 0.5, 1.0]         # blink lids

SKIN_TOP = 244                  # first row of clean lid skin; above it is the dark crease under his brow
EYES = [(356, 429), (447, 518)]  # columns to look for each eye in (his grey hair is just outside them)
ROWS = (258, 322)               # rows to look in
TAPER = 8                       # columns past each corner over which the lid's movement fades to nothing
SHADOW = 4                      # rows of soft shadow under the rim on part-shut lids
LIFT = 2                        # the lid is taken from this many rows above the eye, so no white edge is stretched into it
COVER = 3                       # shut, the lid comes this far past the eye's bottom edge, so no pale line shows under it
SS = 4                          # lids are drawn at 4x height and shrunk back, so their edge is smooth
PUPIL_PAD = 2.5                 # painted out this far past the pupil, so no dark ring is left


def eyeish(p):
    # the white of the eye (even where it's shaded pink-grey at the corners) or the pupil; skin has red well above blue
    return p[0] - p[2] < 72


def lum(p):
    return 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2]


def measure(im, x0, x1):
    """The eye's first and last rows in each column it's in: the longest run of eye pixels (gaps of 2 allowed)."""
    found = {}
    for x in range(x0, x1):
        runs, start, last = [], None, None
        for y in range(*ROWS):
            if eyeish(im.getpixel((x, y))):
                if start is None or y - last > 3:
                    if start is not None:
                        runs.append((start, last))
                    start = y
                last = y
        if start is not None:
            runs.append((start, last))
        best = max(runs, key=lambda r: r[1] - r[0], default=None)
        if best and best[1] - best[0] >= 3:
            found[x] = best
    # only the eye itself: the longest stretch of columns in a row
    blocks, cur = [], []
    for x in sorted(found):
        if cur and x != cur[-1] + 1:
            blocks.append(cur)
            cur = []
        cur.append(x)
    blocks.append(cur)
    keep = max(blocks, key=len)
    return {x: found[x] for x in keep}


def smooth(xs, values, width=3):
    out = {}
    for x in xs:
        near = [values[i] for i in range(x - width // 2, x + width // 2 + 1) if i in values]
        out[x] = sum(near) / len(near)
    return out


# ---- looks ----

def find_pupil(im, eye):
    dark = [(x, y) for x, (t, b) in eye.items() for y in range(t, b + 1) if max(im.getpixel((x, y))) < 80]
    cx = sum(p[0] for p in dark) / len(dark)
    cy = sum(p[1] for p in dark) / len(dark)
    r = (max(p[0] for p in dark) - min(p[0] for p in dark) + 1) / 2
    return cx, cy, r


def paint_out(im, pupils):
    """The picture with the pupils gone: each row across a pupil filled from the pixels either side of it, then softened."""
    out = im.copy()
    region = Image.new("L", im.size, 0)
    draw = ImageDraw.Draw(region)
    for cx, cy, r in pupils:
        R = r + PUPIL_PAD
        draw.ellipse((cx - R, cy - R, cx + R, cy + R), fill=255)
        for y in range(int(cy - R), int(cy + R) + 2):
            half = (max(0.0, R * R - (y - cy) ** 2)) ** 0.5
            if half <= 0:
                continue
            xl, xr = int(cx - half) - 1, int(cx + half) + 1
            a, b = im.getpixel((xl, y)), im.getpixel((xr, y))
            for x in range(xl + 1, xr):
                f = (x - xl) / (xr - xl)
                out.putpixel((x, y), tuple(round(a[i] * (1 - f) + b[i] * f) for i in range(3)))
    soft = out.filter(ImageFilter.GaussianBlur(1.2))
    out.paste(soft, (0, 0), region.filter(ImageFilter.GaussianBlur(1)))
    return out, region


def cut_pupil(im, clean, pupil):
    """The pupil as a round piece: its own pixels in the middle, a soft edge worked out against the white it sat on."""
    cx, cy, r = pupil
    size = int(2 * (r + 3)) + 1
    x0, y0 = round(cx) - size // 2, round(cy) - size // 2
    core = min(lum(im.getpixel((x, y))) for x in range(x0, x0 + size) for y in range(y0, y0 + size))
    piece = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    for j in range(size):
        for i in range(size):
            x, y = x0 + i, y0 + j
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d > r + 1.5:
                continue
            p, c = im.getpixel((x, y)), clean.getpixel((x, y))
            if d > r - 1.5 and not eyeish(p):
                continue  # the lid's rim touching the pupil's edge: not part of the pupil
            if d <= r - 1.5:
                a = 1.0
            else:
                a = max(0.0, min(1.0, (lum(c) - lum(p)) / max(1.0, lum(c) - core)))
            if a <= 0:
                continue
            col = p if a >= 1 else tuple(max(0, min(255, round((p[k] - (1 - a) * c[k]) / a))) for k in range(3))
            piece.putpixel((i, j), (*col, round(a * 255)))
    return piece, (cx - x0, cy - y0)


def eye_mask(im, eyes):
    """Where the whites are: a pupil is only ever drawn inside these."""
    mask = Image.new("L", im.size, 0)
    for eye in eyes:
        for x, (t, b) in eye.items():
            mask.paste(255, (x, t, x + 1, b + 1))
    return mask.filter(ImageFilter.GaussianBlur(0.6))


def look(clean, mask, pupils, pieces, dx, dy):
    out = clean.convert("RGBA")
    layer = Image.new("RGBA", clean.size, (0, 0, 0, 0))
    for (cx, cy, _), (piece, (ox, oy)) in zip(pupils, pieces):
        squash = 1 - SQUASH * min(1.0, (abs(dx) / 15) ** 2)
        p = piece.resize((max(1, round(piece.width * squash)), piece.height), Image.LANCZOS) if squash < 1 else piece
        layer.alpha_composite(p, (round(cx + dx - ox * squash), round(cy + dy - oy)))
    alpha = ImageChops.multiply(layer.getchannel("A"), mask)
    layer.putalpha(alpha)
    out.alpha_composite(layer)
    return out


# ---- blink lids ----

def lid_plan(im, eyes):
    """Per column: where the rim is now (top), how far it comes down when shut (drop), and how much of the lid shows (weight)."""
    plan = {}
    for eye in eyes:
        xs = sorted(eye)
        top = smooth(xs, {x: eye[x][0] for x in xs}, 9)
        drop = {x: eye[x][1] + COVER - top[x] for x in xs}  # down to just past the eye's bottom edge
        drop = {x: max(drop[x], v) for x, v in smooth(xs, drop, 5).items()}  # smoothed, never short of covering the eye
        for x in xs:
            plan[x] = (top[x], drop[x], 1.0)
        # past each corner: the rim stays at the corner's height, its drop eases out like the round corner of a lid, and the
        # moved lid fades into the face, so its rim doesn't poke out past the eye
        for edge, step in ((xs[0], -1), (xs[-1], 1)):
            t0, d0, _ = plan[edge]
            for k in range(1, TAPER + 1):
                f = k / (TAPER + 1)
                plan[edge + step * k] = (t0, d0 * (1 - f * f) ** 0.5 * (1 - f), (1 - f) ** 2)
    return plan


def lid(im, plan, t):
    """The lid t of the way down, as a transparent layer: lid skin, and a see-through shadow under its rim."""
    big = im.resize((im.width, im.height * SS), Image.BICUBIC)
    out = Image.new("RGBA", big.size, (0, 0, 0, 0))
    for x, (top, drop, weight) in plan.items():
        n = round((top + t * drop - SKIN_TOP) * SS)
        if n <= 0:
            continue
        strip = big.resize((1, n), Image.BICUBIC, box=(x, SKIN_TOP * SS, x + 1, (top - LIFT) * SS)).convert("RGBA")
        strip.putalpha(round(255 * weight))
        out.paste(strip, (x, SKIN_TOP * SS))
        end = SKIN_TOP * SS + n
        if t < 1:
            for j in range(SHADOW * SS):
                out.putpixel((x, end + j), (40, 16, 6, round(255 * 0.22 * (1 - j / (SHADOW * SS)) * weight)))
    return out.convert("RGBa").resize(im.size, Image.BOX).convert("RGBA")


def save(pieces, prefix, names):
    box = pieces[0].getchannel("A").getbbox()
    for p in pieces[1:]:
        b = p.getchannel("A").getbbox()
        box = (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    box = (box[0] - 1, box[1] - 1, box[2] + 1, box[3] + 1)
    for p, name in zip(pieces, names):
        p.crop(box).save(ASSETS / f"{prefix}{name}.png", optimize=True)
    return {"x": box[0], "y": box[1], "w": box[2] - box[0], "h": box[3] - box[1]}


def main():
    im = Image.open(SRC).convert("RGB")
    eyes = [measure(im, x0, x1) for x0, x1 in EYES]

    pupils = [find_pupil(im, eye) for eye in eyes]
    clean, painted = paint_out(im, pupils)
    pupil_pieces = [cut_pupil(im, clean, p) for p in pupils]
    mask = eye_mask(im, eyes)
    looks = []
    changed = ImageChops.lighter(mask, painted.filter(ImageFilter.GaussianBlur(1)))
    for dx, dy in LOOKS.values():
        piece = look(clean, mask, pupils, pupil_pieces, dx, dy)
        piece.putalpha(changed)
        looks.append(piece)
    look_crop = save(looks, "tim-look-", list(LOOKS))

    plan = lid_plan(im, eyes)
    lid_crop = save([lid(im, plan, t) for t in POSES], "tim-blink-", ["1", "2", "3"])

    print(f"LOOK_CROP = {{x: {look_crop['x']}, y: {look_crop['y']}, w: {look_crop['w']}, h: {look_crop['h']}}}")
    print(f"LID_CROP = {{x: {lid_crop['x']}, y: {lid_crop['y']}, w: {lid_crop['w']}, h: {lid_crop['h']}}}")
    print(f"(in the {im.width}x{im.height} tim.jpg; pupils at " + ", ".join(f"({cx:.1f}, {cy:.1f}) r {r:.1f}" for cx, cy, r in pupils) + ")")


if __name__ == "__main__":
    main()
