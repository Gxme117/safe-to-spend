#!/usr/bin/env python3
"""Makes the room Frank sits in, in dark mode: square LED panels hanging from a high ceiling behind him, as a layer of its own,
assets/frank-dark-room.png.

It goes over his dark picture (assets/frank-dark.jpg, the same 874x880) and under everything that moves: his eyes, lids, hands
and mouth are pieces laid over the picture at fixed crops (ART in src/app/(tabs)/tim.tsx), and neither they nor the picture
change. The picture is solid, so nothing can go behind it; instead Frank is cut out of the layer (found in
scripts/frank-dark-placed.jpg, where his dark jumper still stands apart from the wall), so over the flat wall the lights are
behind him, and his hair is in front of the nearest one. The light stops above his shoulders (LIMIT), and the script checks
that none of it is inside any piece's crop (CROPS).

The lights are placed off the user's mock-up against his own hair (HAIR_TOP) and middle (MID), in perspective: each panel a
dark rim (its front edge) over its glowing underside, which narrows towards the horizon (HORIZON, under MID) as it goes back,
two cords up into the dark, a bloom round it and its light on the wall.

Run from mobile/: python3 scripts/frank_room.py [--preview DIR]   (needs Pillow; DIR gets it laid on his picture, with his
pieces, and on a phone's screen, to look at)
"""
import sys
from math import exp
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

from frank_dark import PAGE, WALL_OFF

ROOT = Path(__file__).resolve().parent.parent
PLACED = ROOT / "scripts" / "frank-dark-placed.jpg"
PIC = ROOT / "assets" / "frank-dark.jpg"
OUT = ROOT / "assets" / "frank-dark-room.png"

HAIR_TOP, MID = 176, 437       # the top of his hair and his middle, in his picture's px (the first row he's in)
HORIZON = 600                  # the row the panels' undersides narrow towards as they go back (eye level, about)
LIMIT = (440, 600)             # the light fades out between these rows, above his shoulders, so it never reaches his hands
EDGE, EDGE_KEY = 3, (WALL_OFF, 160)  # his soft edge: px into him, and how far from the wall's colour (summed) is all him
REGROW = 6                     # px the wall grows back into the pockets between his curls
SS = 4                         # the panels are drawn this many times bigger, then shrunk, for clean edges
# each panel: the top of its front edge, its left and right ends, the rim's height, and how far down its underside shows
PANELS = [
    {"top": HAIR_TOP - 70, "x": (MID - 145, MID + 145), "rim": 6, "under": 68},   # the nearest, over him; his hair in front
    {"top": HAIR_TOP - 10, "x": (MID - 347, MID - 219), "rim": 4, "under": 40},   # further back, lower and smaller, left
    {"top": HAIR_TOP - 10, "x": (MID + 225, MID + 352), "rim": 4, "under": 40},   # and right
]
FACE = (236, 243, 255)         # a panel's glowing underside: cool white, not warm
RIM = (32, 34, 39)             # its dark front edge
RIM_LIT = (78, 84, 94)         # the rim's bottom edge, catching the light
CORD = (48, 51, 57)            # the cords it hangs from
GLOW = (196, 214, 242)         # its light in the air and on the wall
# his pieces' crops in his dark picture (ART.frank.dark in tim.tsx): the light must never be inside one
CROPS = {
    "look down": (363, 372, 154, 36), "lids": (359, 361, 162, 46), "mouth": (378, 437, 119, 69),
    "left hand": (210, 681, 46, 109), "right hand": (607, 681, 48, 109),
}
PIECES = {  # one pose of each, for the preview
    "lids": "frank-dark-blink-2.png", "look down": "frank-dark-look-down.png", "mouth": "frank-dark-mouth-2.png",
    "left hand": "frank-dark-hands-left-2.png", "right hand": "frank-dark-hands-right-2.png",
}


def corners(p):
    """A panel's rim (a rectangle) and underside (a trapezoid narrowing towards the horizon), in its picture's px."""
    (x0, x1), top = p["x"], p["top"]
    near = top + p["rim"]
    far = near + p["under"]
    s = (far - HORIZON) / (near - HORIZON)  # how much smaller its back edge is than its front
    back = lambda x: MID + (x - MID) * s  # noqa: E731
    return (x0, top, x1, near), [(x0, near), (x1, near), (back(x1), far), (back(x0), far)]


def him(placed):
    """Where he is (255) and where the wall is (0). The wall is what's near the wall beside him on its row (WALL_OFF), reached
    from the top of the picture: narrowed first, so it can't seep into his dark jumper through the gaps in the knit, then
    grown back inside what's near the wall (REGROW px, into the pockets between his curls). His edge is soft: within EDGE px of
    the wall, a pixel is him as far as it's from the wall's colour (EDGE_KEY), so his hair's wispy edge takes the light as the
    wall behind it would, rather than outlining him."""
    px, (w, h) = placed.load(), placed.size
    wall, key = Image.new("L", placed.size, 0), Image.new("L", placed.size, 255)
    wp, kp = wall.load(), key.load()
    lo, hi = EDGE_KEY
    for y in range(LIMIT[1]):  # below it there's no light to cut him out of
        a, b = px[2, y], px[w - 3, y]
        for x in range(w):
            p = px[x, y]
            d = min(sum(abs(p[i] - a[i]) for i in range(3)), sum(abs(p[i] - b[i]) for i in range(3)))
            wp[x, y] = 255 if d <= WALL_OFF else 0
            kp[x, y] = max(0, min(255, round(255 * (d - lo) / (hi - lo))))
    reached = wall.filter(ImageFilter.MinFilter(7))
    for x in range(w):
        if reached.getpixel((x, 0)) == 255:
            ImageDraw.floodfill(reached, (x, 0), 128)
    reached = reached.point(lambda v: 255 if v == 128 else 0).filter(ImageFilter.MaxFilter(7))
    for _ in range(REGROW):
        reached = ImageChops.multiply(reached.filter(ImageFilter.MaxFilter(3)), wall)
    edge = reached.filter(ImageFilter.MaxFilter(2 * EDGE + 1))  # the wall and the edge of him next to it
    return ImageChops.invert(ImageChops.multiply(edge, ImageChops.invert(key)))


def spot(size, cx, cy, rx, ry, peak):
    """A soft round light, `peak` (0-1) at (cx, cy), gone rx across and ry down (Pillow's radial gradient is 181 at the middle
    of its edges, 255 in its corners)."""
    fall = [round(255 * peak * max(0, (exp(-4 * (v / 181) ** 2) - exp(-4)) / (1 - exp(-4)))) for v in range(256)]
    g = Image.radial_gradient("L").point(fall).resize((2 * rx, 2 * ry), Image.BILINEAR)
    out = Image.new("L", size, 0)
    out.paste(g, (cx - rx, cy - ry))
    return out


def scaled(im, k):
    return im.point(lambda v: round(v * k))


def rows(size, a, b):
    """0 on row a and past it, 255 on row b and past it, evenly between."""
    col = Image.new("L", (1, size[1]))
    col.putdata([max(0, min(255, round(255 * (y - a) / (b - a)))) for y in range(size[1])])
    return col.resize(size)


def room(size):
    """The lights, cords and glow on a see-through layer, before he's cut out of it."""
    w, h = size
    # the glow: a halo round each underside, and below it (they light downwards: above them it's dark) a bloom and its light
    # on the wall
    glow = Image.new("L", size, 0)
    for i, p in enumerate(PANELS):
        rim, under = corners(p)
        face = Image.new("L", size, 0)
        ImageDraw.Draw(face).polygon(under, fill=255)
        mid, bottom = round((p["x"][0] + p["x"][1]) / 2), round(under[2][1])
        down = scaled(face.filter(ImageFilter.GaussianBlur(24)), .5)
        down = ImageChops.add(down, spot(size, mid, bottom + 40, 330, 320, .28) if i == 0 else spot(size, mid, bottom + 20, 120, 150, .1))
        glow = ImageChops.add(glow, scaled(face.filter(ImageFilter.GaussianBlur(4)), .55))
        glow = ImageChops.add(glow, ImageChops.multiply(down, rows(size, rim[1], bottom)))
    glow = ImageChops.multiply(glow, rows(size, LIMIT[1], LIMIT[0]))
    out = Image.new("RGBA", size, GLOW + (0,))
    out.putalpha(glow)

    # the panels and their cords, drawn big and shrunk
    big = Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    for p in PANELS:
        rim, under = corners(p)
        x0, top, x1, near = (v * SS for v in rim)
        inset = round((x1 - x0) * .1)
        for x in (x0 + inset, x1 - inset):  # its cords, fading as they go up into the dark
            for y in range(0, top):
                d.line([(x, y), (x + 4, y)], fill=CORD + (round(255 * (.25 + .75 * y / top)),))
        d.polygon([(x * SS, y * SS) for x, y in under], fill=FACE + (255,))
        d.rectangle([x0, top, x1, near], fill=RIM + (255,))
        d.rectangle([x0, near - SS, x1, near], fill=RIM_LIT + (255,))
    return Image.alpha_composite(out, big.resize(size, Image.LANCZOS))


def main() -> None:
    placed = Image.open(PLACED).convert("RGB")
    layer = room(placed.size)
    alpha = ImageChops.multiply(layer.getchannel("A"), ImageChops.invert(him(placed)))
    layer.putalpha(alpha)
    for name, (x, y, w, h) in CROPS.items():
        if alpha.crop((x, y, x + w, y + h)).getextrema()[1]:
            sys.exit(f"the light reaches his {name}'s crop: move it")
    layer.save(OUT, optimize=True)
    print(f"saved {OUT.relative_to(ROOT)}: nothing in any of his pieces' crops ({', '.join(CROPS)})")
    for p in PANELS:
        rim, under = corners(p)
        print(f"panel: rim {rim}, underside {[(round(x), round(y)) for x, y in under]}")

    if "--preview" in sys.argv:
        to = Path(sys.argv[sys.argv.index("--preview") + 1])
        on = Image.alpha_composite(Image.open(PIC).convert("RGBA"), layer)
        on.convert("RGB").save(to / "room-on-frank.png")
        posed = on.copy()
        for name, file in PIECES.items():
            x, y, _, _ = CROPS[name]
            posed.alpha_composite(Image.open(ROOT / "assets" / file).convert("RGBA"), (x, y))
        posed.convert("RGB").save(to / "room-with-pieces.png")
        # as on the screen: 393pt wide at the mock-up's 2.1654 px a pt, the picture 64pt down (DROP), fading into the page 40pt
        # at the top and bottom (FADE), under the switch's strip (the status bar and switch, about 102pt)
        k, page = 2.1654, PAGE + (255,)
        sw, ph = round(393 * k), round(393 * k * 443 / 440)
        screen = Image.new("RGBA", (sw, round(852 * k)), page)
        pic, fade = posed.resize((sw, ph), Image.LANCZOS), round(40 * k)
        veil = Image.new("RGBA", pic.size, (0, 0, 0, 0))
        for i in range(fade):
            a = round(255 * (1 - i / fade))
            ImageDraw.Draw(veil).line([(0, i), (sw, i)], fill=PAGE + (a,))
            ImageDraw.Draw(veil).line([(0, ph - 1 - i), (sw, ph - 1 - i)], fill=PAGE + (a,))
        screen.alpha_composite(Image.alpha_composite(pic, veil), (0, round(64 * k)))
        ImageDraw.Draw(screen).rectangle([0, 0, sw, round(102 * k)], fill=page)
        screen.convert("RGB").save(to / "room-on-screen.png")
        print(f"previews in {to}")


if __name__ == "__main__":
    main()
