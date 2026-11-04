"""Frank's face for the card island (Live Activity): his chat bubble's crop of frank.jpg (BUBBLE in tim.tsx: scale .23 pt
per px, top left 242, 151, an 88pt bubble), cut round on white and saved at 160px as assets/frank-face.png.

    python3 scripts/frank_face.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SCALE, X, Y, D = .23, 242, 151, 88   # BUBBLE.frank and BUBBLE_D in tim.tsx
OUT = 160                            # px: the island draws it at 21.33pt (compact) to 53.33pt (expanded), 3x

def main():
    pic = Image.open(ROOT / "assets/frank.jpg").convert("RGB")
    side = D / SCALE
    face = pic.crop((round(X), round(Y), round(X + side), round(Y + side))).resize((OUT, OUT), Image.LANCZOS)
    # his wall (a flat 245 grey) goes white, so he sits on a white bubble on the black island: only the lightest tones
    # move (200 to 245 stretched to 200 to 255), so his hair's edge against the wall carries no grey fringe
    face = face.point(lambda v: v if v <= 200 else min(255, round(200 + (v - 200) * 55 / 45)))
    # a round mask drawn 4x and scaled down, so the edge is smooth
    big = Image.new("L", (OUT * 4, OUT * 4), 0)
    ImageDraw.Draw(big).ellipse((0, 0, OUT * 4 - 1, OUT * 4 - 1), fill=255)
    face.putalpha(big.resize((OUT, OUT), Image.LANCZOS))
    face.save(ROOT / "assets/frank-face.png", optimize=True)
    print(f"crop {X},{Y} {side:.1f}px square -> assets/frank-face.png {OUT}px")

if __name__ == "__main__":
    main()
