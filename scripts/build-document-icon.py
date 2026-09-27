"""Draws the Cue project document icon (build/document.png, .ico and .icns):
a page with a folded corner, Cue's bars and red dot, and CUEPROJ under them.
Run: python3 scripts/build-document-icon.py (needs Pillow; iconutil on macOS)."""
import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), "..")
S = 1024


def draw(size: int) -> Image.Image:
    k = size / S
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # The page: macOS document proportions, with a soft shadow.
    left, top, right, bottom = 190 * k, 70 * k, 834 * k, 954 * k
    fold = 170 * k
    page = [(left, top), (right - fold, top), (right, top + fold), (right, bottom), (left, bottom)]
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).polygon([(x, y + 10 * k) for x, y in page], fill=(0, 0, 0, 90))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14 * k)))
    d = ImageDraw.Draw(img)
    d.polygon(page, fill=(250, 250, 252, 255), outline=(200, 200, 206, 255), width=max(1, round(4 * k)))
    # The folded corner.
    d.polygon([(right - fold, top), (right - fold, top + fold), (right, top + fold)], fill=(222, 222, 228, 255))
    d.line([(right - fold, top), (right - fold, top + fold), (right, top + fold)], fill=(200, 200, 206, 255), width=max(1, round(4 * k)))
    # Cue's mark: three rounded bars and the record dot.
    ink = (30, 30, 34, 255)
    cx = S / 2
    for x, y0, y1 in ((cx - 150, 400, 600), (cx - 25, 330, 670), (cx + 100, 430, 570)):
        w = 56
        d.rounded_rectangle([(x - w / 2) * k, y0 * k, (x + w / 2) * k, y1 * k], radius=w / 2 * k, fill=ink)
    d.ellipse([(cx + 170) * k, 290 * k, (cx + 240) * k, 360 * k], fill=(239, 68, 68, 255))
    # The file type under it.
    if size >= 128:
        font = None
        for f in ("/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Helvetica.ttc"):
            if os.path.exists(f):
                font = ImageFont.truetype(f, round(88 * k))
                break
        font = font or ImageFont.load_default()
        text = "CUEPROJ"
        w = d.textlength(text, font=font)
        d.text((cx * k - w / 2, 760 * k), text, font=font, fill=(110, 110, 118, 255))
    return img


def main() -> None:
    build = os.path.join(ROOT, "build")
    draw(S).save(os.path.join(build, "document.png"))
    draw(256).save(os.path.join(build, "document.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    if shutil.which("iconutil") is None:
        return
    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, "document.iconset")
        os.mkdir(iconset)
        for base in (16, 32, 128, 256, 512):
            draw(base).save(os.path.join(iconset, f"icon_{base}x{base}.png"))
            draw(base * 2).save(os.path.join(iconset, f"icon_{base}x{base}@2x.png"))
        subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(build, "document.icns")], check=True)


if __name__ == "__main__":
    main()
