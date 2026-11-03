"""Draw the Word Pocket icons: a yellow speech bubble with a dark W on the
app's dark background, in the sizes phones ask for.

Usage: python make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
BG, YELLOW, DARK = (20, 23, 29, 255), (242, 193, 78, 255), (27, 31, 39, 255)


def draw(size, padded):
    big = size * 4
    img = Image.new("RGBA", (big, big), BG)
    d = ImageDraw.Draw(img)
    # a maskable icon keeps its drawing inside the middle 80%
    m = big * (0.2 if padded else 0.14)
    w = big - 2 * m
    d.rounded_rectangle([m, m, m + w, m + w * 0.8], radius=w * 0.2, fill=YELLOW)
    d.polygon([(m + w * 0.18, m + w * 0.75), (m + w * 0.4, m + w * 0.75), (m + w * 0.14, m + w * 0.98)], fill=YELLOW)
    try:
        font = ImageFont.truetype("arialbd.ttf", int(w * 0.52))
    except OSError:
        font = ImageFont.load_default()
    box = d.textbbox((0, 0), "W", font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    d.text((m + (w - tw) / 2 - box[0], m + (w * 0.8 - th) / 2 - box[1]), "W", font=font, fill=DARK)
    return img.resize((size, size), Image.LANCZOS)


for name, size, padded in (("icon-180.png", 180, False), ("icon-192.png", 192, False),
                           ("icon-512.png", 512, False), ("icon-maskable-512.png", 512, True),
                           ("favicon-32.png", 32, False)):
    draw(size, padded).save(HERE / "icons" / name)
print("icons written")
