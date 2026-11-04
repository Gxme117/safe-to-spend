"""Frank peeking over a wall, for the compact card island (Live Activity): the island's bottom edge is the wall, and all that
shows over it is his hair, brows, glasses and eyes, looking at you. Made from his dark picture (scripts/frank-dark-placed.jpg,
the same 874x880 framing as frank.jpg) with the wall taken down to pure black, the island's own colour, so he looks to be
inside it. Cut flat just under his glasses' lower rim: the cut is the wall's top. Saved as assets/frank-peek.png.

    python3 scripts/frank_peek.py
"""
from pathlib import Path
from PIL import Image

from frank_dark import WALL

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "scripts/frank-dark-placed.jpg"
OUT = ROOT / "assets/frank-peek.png"
# measured off SRC: his hair's top is row 178, he's 286 to 581 wide at his hair and ears, and his glasses' lower rim is
# darkest at row 414 and gone by 418, so the wall starts at 419 (a sliver of cheek under the rim, his nose's bridge between)
CROP = (280, 172, 588, 419)
TALL = 108  # px: 36pt at 3x, the island's whole height, so it's sharp at any size the island draws it
# the whites of his eyes, either side under his pupils (checked on a zoom: no lid, lash or pupil in them). The dark room's
# light is warm (they're 1.13 as red as blue, the light picture's 1.07), so they're what's balanced to neutral
WHITES = [(378, 386, 392, 396), (492, 386, 506, 396)]


def balanced(im):
    """White balance: each channel scaled so his eye whites come out grey, as bright as before."""
    px = [im.getpixel((x, y)) for b in WHITES for y in range(b[1], b[3]) for x in range(b[0], b[2])]
    avg = [sum(p[c] for p in px) / len(px) for c in range(3)]
    gain = [sum(avg) / 3 / a for a in avg]
    print("white balance gains r, g, b:", ", ".join(f"{g:.3f}" for g in gain))
    return Image.merge("RGB", [im.getchannel(c).point(lambda v, c=c: min(255, round(v * gain[c]))) for c in range(3)])


def black(im):
    """WALL and anything under it becomes 0, and everything above it is stretched from there to white (frank_dark's
    `darkened`, down to the island's black instead of the page's), so the wall goes and he keeps his tones."""
    level = lambda v, k: max(0, round((v - k) * 255 / (255 - k)))  # noqa: E731
    return Image.merge("RGB", [im.getchannel(c).point(lambda v, c=c: level(v, WALL[c])) for c in range(3)])


def main():
    # black first: WALL was measured on SRC's own colours, and black stays black however it's balanced
    pic = balanced(black(Image.open(SRC).convert("RGB"))).crop(CROP)
    w, h = pic.size
    out = pic.resize((round(w * TALL / h), TALL), Image.LANCZOS)
    out.save(OUT, optimize=True)
    print(f"crop {CROP} ({w}x{h}px, {w / h:.3f} wide per tall) -> {OUT.relative_to(ROOT)} {out.width}x{out.height}px")


if __name__ == "__main__":
    main()
