#!/usr/bin/env python3
"""Render Cue's original style studies from licensed stock and Cue footage.

Requires ffmpeg and Pillow. Stock is downloaded into .cache/style-stock; only
the edited studies and their posters are committed. See resources/assets/README.md.
"""
from __future__ import annotations

import json
import subprocess
import urllib.request
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
STOCK = ROOT / ".cache/style-stock"
FRAMES = STOCK / "frames"
OUT = ROOT / "resources/styles/previews"
SITE = ROOT / "site/public/styles"
ASSET_POSTERS = ROOT / "resources/assets/posters"
SITE_ASSETS = ROOT / "site/public/assets"
FONT_BOLD = ROOT / "site/assets/Inter-Bold.ttf"
FONT_REGULAR = ROOT / "site/assets/Inter-Regular.ttf"
W, H, FPS, DURATION = 640, 360, 24, 4
ASSETS = json.loads((ROOT / "resources/assets/catalog.json").read_text())


def command(args: list[str], *, stdin=None) -> None:
    subprocess.run(args, stdin=stdin, check=True, stdout=subprocess.DEVNULL)


def prepare() -> None:
    for folder in (STOCK, FRAMES, OUT, SITE, ASSET_POSTERS, SITE_ASSETS):
        folder.mkdir(parents=True, exist_ok=True)
    for asset in ASSETS:
        if "downloadUrl" not in asset:
            continue
        target = STOCK / asset["file"]
        if not target.exists() or target.stat().st_size == 0:
            print("Downloading", asset["name"], flush=True)
            request = urllib.request.Request(asset["downloadUrl"], headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(request, timeout=90) as response:
                target.write_bytes(response.read())
        extract(target, target.stem)
        poster = frame(target.stem, 1.5)
        poster.save(ASSET_POSTERS / f'{asset["id"]}.jpg', quality=86)
        poster.save(SITE_ASSETS / f'{asset["id"]}.jpg', quality=86)
    extract(ROOT / "site/public/videos/edit.mp4", "screen")
    draw_original_assets()


def extract(path: Path, name: str) -> None:
    folder = FRAMES / name
    folder.mkdir(parents=True, exist_ok=True)
    if (folder / "0096.jpg").exists():
        return
    command([
        "ffmpeg", "-v", "error", "-y", "-i", str(path), "-t", "5.1",
        "-vf", f"fps={FPS},scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}",
        "-q:v", "3", str(folder / "%04d.jpg"),
    ])


@lru_cache(maxsize=140)
def frame(name: str, at: float) -> Image.Image:
    n = max(1, min(120, int(at * FPS) + 1))
    file = FRAMES / name / f"{n:04d}.jpg"
    if not file.exists():
        files = sorted((FRAMES / name).glob("*.jpg"))
        file = files[min(n - 1, len(files) - 1)]
    with Image.open(file) as image:
        return image.convert("RGB").copy()


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size)


def text(im: Image.Image, xy: tuple[int, int], words: str, size: int, color: str,
         *, bold: bool = False, anchor: str | None = None, stroke: int = 0,
         stroke_color: str = "#000000") -> None:
    ImageDraw.Draw(im).text(xy, words, font=font(size, bold), fill=color,
                            anchor=anchor, stroke_width=stroke, stroke_fill=stroke_color)


def rect(im: Image.Image, box: tuple[int, int, int, int], fill: str, radius: int = 0) -> None:
    ImageDraw.Draw(im).rounded_rectangle(box, radius=radius, fill=fill)


def mix(a: Image.Image, b: Image.Image, weight: float) -> Image.Image:
    return Image.blend(a, b, max(0, min(1, weight)))


def ease(x: float) -> float:
    x = max(0, min(1, x))
    return x * x * (3 - 2 * x)


def shade(im: Image.Image, amount: float = .33) -> Image.Image:
    return mix(im, Image.new("RGB", (W, H), "#11131a"), amount)


def paste_panel(im: Image.Image, source: str, t: float, box: tuple[int, int, int, int],
                *, border: int = 5, shadow: bool = True) -> None:
    x, y, width, height = box
    if shadow:
        rect(im, (x + 9, y + 10, x + width + 9, y + height + 10), "#9f9a8d")
    rect(im, (x - border, y - border, x + width + border, y + height + border), "#faf7ed")
    shot = frame(source, t).resize((width, height), Image.Resampling.LANCZOS)
    im.paste(shot, (x, y))


def kinetic(t: float) -> Image.Image:
    im = shade(frame("runner", t + .4), .50)
    rect(im, (27, 25, 32, 68), "#ef6d45")
    text(im, (45, 27), "01  /  KINETIC QUOTE", 13, "#f0eeea", bold=True)
    words = [("EVERY", .3), ("FRAME", 1.05), ("CAN", 1.85), ("COUNT.", 2.55)]
    current = max((i for i, (_, start) in enumerate(words) if t >= start), default=-1)
    if current >= 0:
        word, start = words[current]
        enter = ease((t - start) / .24)
        y = 150 + int((1 - enter) * 38)
        if current > 0:
            text(im, (37, 121), " / ".join(w for w, _ in words[:current]), 14,
                 "#e8ddd3", bold=True)
        text(im, (34, y), word, 76 if word != "COUNT." else 68,
             "#ff7448" if word == "COUNT." else "#fff8ee", bold=True)
    text(im, (36, 327), "A LINE, CUT TO ITS OWN RHYTHM", 12, "#e0ddd7", bold=True)
    return im


def beat(t: float) -> Image.Image:
    sequence = [(0, "city"), (.44, "runner"), (.86, "hands"), (1.28, "camera"),
                (1.70, "mountain"), (2.14, "portrait"), (3.08, "city"), (3.48, "runner")]
    index = max(i for i, (start, _) in enumerate(sequence) if t >= start)
    start, source = sequence[index]
    im = shade(frame(source, .6 + t - start), .12)
    rect(im, (0, 0, 640, 26), "#111015")
    for i in range(8):
        x = 13 + i * 79
        rect(im, (x, 9, x + 62, 14), "#edbd6f" if i <= index else "#6a6263")
    text(im, (25, 298), f"{index + 1:02d} / 08", 37, "#fff8e7", bold=True)
    text(im, (585, 310), "CUT ON THE BEAT", 12, "#fff8e7", bold=True, anchor="ra")
    return im


def match_motion(t: float) -> Image.Image:
    cut = 1.9
    im = frame("camera", t + 1.5) if t < cut else frame("city", t - cut + 1.7)
    if abs(t - cut) < .16:
        streak = im.filter(ImageFilter.GaussianBlur(9))
        im = mix(im, streak, (1 - abs(t - cut) / .16) * .85)
    im = shade(im, .19)
    rect(im, (25, 29, 265, 61), "#f3f0e6")
    text(im, (36, 37), "MATCH THE DIRECTION", 14, "#24232c", bold=True)
    x = int(260 + (t % 1.9) / 1.9 * 300)
    ImageDraw.Draw(im).line((x - 75, 290, x, 290), fill="#f4e6bb", width=3)
    ImageDraw.Draw(im).polygon(((x, 282), (x + 15, 290), (x, 298)), fill="#f4e6bb")
    return im


def collage(t: float) -> Image.Image:
    im = Image.new("RGB", (W, H), "#d5cfbd")
    draw = ImageDraw.Draw(im)
    for y in range(0, H, 36):
        draw.line((0, y, W, y), fill="#cac2ae", width=1)
    if t > .12:
        paste_panel(im, "mountain", t + .5, (38, 45, 340, 192))
    if t > .7:
        paste_panel(im, "camera", t + .7, (352, 78, 235, 140))
    if t > 1.3:
        paste_panel(im, "hands", t, (257, 203, 244, 117))
    rect(im, (32, 255, 281, 340), "#df6c4c")
    text(im, (45, 268), "CUT / PASTE", 35, "#f9f5e8", bold=True)
    text(im, (46, 310), "A STORY IN LAYERS", 11, "#f9f5e8", bold=True)
    return im


def light_leak(t: float) -> Image.Image:
    cut = 1.95
    im = frame("mountain", t + .9) if t < cut else frame("runner", t - cut + .5)
    im = ImageEnhance.Color(im).enhance(.86)
    strength = max(0, 1 - abs(t - cut) / .48)
    if strength:
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        draw = ImageDraw.Draw(glow)
        draw.ellipse((-175, -190, 480, 620), fill=(255, 132, 55, int(205 * strength)))
        draw.ellipse((170, -190, 760, 510), fill=(255, 228, 150, int(175 * strength)))
        im = Image.alpha_composite(im.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(62))).convert("RGB")
        im = mix(im, Image.new("RGB", (W, H), "#fbe6bd"), strength ** 3 * .52)
    text(im, (26, 31), "02  /  LIGHT PASSAGE", 13, "#fff6e7", bold=True,
         stroke=1, stroke_color="#44281a")
    return im


def screen_focus(t: float) -> Image.Image:
    base = frame("screen", t + .7)
    zoom = 1 + .62 * (ease((t - .8) / .7) - ease((t - 2.7) / .65))
    if zoom > 1.002:
        width, height = round(W / zoom), round(H / zoom)
        left = round((W - width) * .45)
        top = round((H - height) * .55)
        base = base.crop((left, top, left + width, top + height)).resize((W, H), Image.Resampling.LANCZOS)
    im = base
    rect(im, (17, 18, 196, 46), "#161c28")
    text(im, (28, 24), "FOCUS ON THE ACTION", 12, "#f5f7fa", bold=True)
    return im


def split_reveal(t: float) -> Image.Image:
    original = frame("mountain", t + .5)
    before = ImageEnhance.Color(original).enhance(.38)
    before = ImageEnhance.Contrast(before).enhance(.85)
    after = ImageEnhance.Color(original).enhance(1.65)
    after = ImageEnhance.Contrast(after).enhance(1.1)
    split = int(W * (.5 + .5 * ease((t - 1.6) / 1.75)))
    # The graded result grows from left to right.
    im = before.copy()
    im.paste(after.crop((0, 0, split, H)), (0, 0))
    ImageDraw.Draw(im).line((split, 0, split, H), fill="#fffaf0", width=4)
    rect(im, (18, 22, 112, 48), "#191d22")
    text(im, (30, 28), "AFTER", 12, "#fff8ed", bold=True)
    if split < W - 80:
        rect(im, (W - 111, 22, W - 18, 48), "#191d22")
        text(im, (W - 99, 28), "BEFORE", 12, "#fff8ed", bold=True)
    return im


def quiet(t: float) -> Image.Image:
    im = frame("portrait", t + .7)
    im = mix(im, Image.new("RGB", (W, H), "#17222c"), .13)
    if t > 1.0:
        alpha = ease((t - 1) / .65)
        title = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(title).text((36, 267), "THE SMALL MOMENTS", font=font(27, True),
                                   fill=(255, 249, 237, int(255 * alpha)))
        im = Image.alpha_composite(im.convert("RGBA"), title).convert("RGB")
    text(im, (36, 35), "PORTRAIT / 01", 12, "#343034", bold=True)
    return im


def whip(t: float) -> Image.Image:
    cut = 1.95
    before = frame("city", t + .5)
    after = frame("mountain", t - cut + .5)
    im = before if t < cut else after
    distance = abs(t - cut)
    if distance < .2:
        shift = int((1 - distance / .2) * 320)
        rolled = Image.new("RGB", (W, H), "#172437")
        rolled.paste(im, (-shift if t < cut else shift, 0))
        im = mix(rolled, im.filter(ImageFilter.GaussianBlur(10)), .4)
    text(im, (28, 30), "WHIP / CHANGE OF PLACE", 13, "#ffffff", bold=True,
         stroke=1, stroke_color="#121212")
    return im


def filmstrip(t: float) -> Image.Image:
    im = Image.new("RGB", (W, H), "#181715")
    sources = ("runner", "camera", "city", "hands")
    offset = int((t * 62) % 188)
    for i, source in enumerate(sources):
        x = i * 198 - offset - 52
        shot = frame(source, t + i * .4).resize((184, 242), Image.Resampling.LANCZOS)
        im.paste(shot, (x, 58))
        rect(im, (x, 38, x + 184, 53), "#282620")
        rect(im, (x, 305, x + 184, 321), "#282620")
        for hole in range(7):
            rect(im, (x + 7 + hole * 26, 42, x + 19 + hole * 26, 49), "#d2c5aa", 2)
            rect(im, (x + 7 + hole * 26, 309, x + 19 + hole * 26, 316), "#d2c5aa", 2)
    text(im, (24, 16), "CONTACT / 24 FPS", 11, "#f6e4bd", bold=True)
    return im


def mask_title(t: float) -> Image.Image:
    footage = frame("runner", t + .5)
    if t < 2.7:
        background = Image.new("RGB", (W, H), "#161a19")
        mask = Image.new("L", (W, H), 0)
        d = ImageDraw.Draw(mask)
        d.text((W // 2, H // 2 - 15), "MOVE", font=font(150, True), fill=255, anchor="mm",
               stroke_width=2, stroke_fill=255)
        background.paste(footage, (0, 0), mask)
        text(background, (34, 315), "A WORLD INSIDE THE WORD", 14, "#ebe6d6", bold=True)
        return background
    im = mix(footage, Image.new("RGB", (W, H), "#161a19"), .13)
    text(im, (35, 280), "MOVE", 67, "#f7f0dc", bold=True)
    return im


def grid(t: float) -> Image.Image:
    im = Image.new("RGB", (W, H), "#eee9db")
    sources = ("mountain", "runner", "hands", "camera")
    chosen = ease((t - 2.35) / 1.25)
    if chosen:
        im = mix(im, frame("camera", t + .5), chosen)
    for index, source in enumerate(sources):
        if chosen > .95:
            break
        x = 12 + (index % 2) * 314
        y = 12 + (index // 2) * 170
        tile = frame(source, t + index * .45).resize((302, 158), Image.Resampling.LANCZOS)
        if index == 3 and chosen:
            tile = mix(tile, frame("camera", t + .5).resize((302, 158)), chosen)
        im.paste(tile, (x, y))
    if t > 2.35:
        text(im, (32, 313), "SELECT THE FRAME", 22, "#fffaf0", bold=True,
             stroke=1, stroke_color="#1b1c1e")
    return im


def dossier(t: float) -> Image.Image:
    im = Image.new("RGB", (W, H), "#ded8c8")
    draw = ImageDraw.Draw(im)
    for x in range(36, W, 48):
        draw.line((x, 0, x, H), fill="#c4bda9", width=1)
    for y in range(25, H, 48):
        draw.line((0, y, W, y), fill="#c4bda9", width=1)
    if t < 2.4:
        paste_panel(im, "mountain", t + .5, (315, 46, 283, 189), border=7)
        text(im, (30, 42), "WHY THIS", 45, "#202927", bold=True)
        text(im, (30, 93), "ROAD?", 58, "#202927", bold=True)
        rect(im, (29, 185, 215, 209), "#df6345")
        text(im, (39, 190), "A VISUAL EXPLAINER", 11, "#fff8eb", bold=True)
        draw.line((88, 253, 240, 305), fill="#cf5942", width=5)
        draw.ellipse((77, 242, 99, 264), fill="#cf5942")
        draw.ellipse((229, 294, 251, 316), fill="#cf5942")
        text(im, (340, 266), "01 / THE TERRAIN", 13, "#303a35", bold=True)
    else:
        paste_panel(im, "city", t - 2 + .7, (25, 40, 272, 177), border=6)
        text(im, (326, 50), "THE", 32, "#202927", bold=True)
        text(im, (326, 91), "HUMAN", 43, "#202927", bold=True)
        text(im, (326, 139), "SCALE", 43, "#202927", bold=True)
        rect(im, (31, 251, 609, 326), "#243c40")
        text(im, (49, 268), "CLAIM  →  IMAGE  →  EVIDENCE", 27, "#f5eee0", bold=True)
    return im


def draw_original_assets() -> None:
    folder = ROOT / "resources/assets/original"
    folder.mkdir(parents=True, exist_ok=True)
    for name, background in (("cartographic-grid", "#ded8c8"), ("document-paper", "#e7dfcd")):
        im = Image.new("RGB", (1280, 720), background)
        draw = ImageDraw.Draw(im)
        if name == "cartographic-grid":
            for x in range(0, 1280, 80):
                draw.line((x, 0, x, 720), fill="#bdb6a5", width=2)
            for y in range(0, 720, 80):
                draw.line((0, y, 1280, y), fill="#bdb6a5", width=2)
            draw.line((210, 525, 405, 430, 650, 470, 900, 270, 1050, 200), fill="#bd533f", width=9)
            for x, y in ((210, 525), (650, 470), (1050, 200)):
                draw.ellipse((x - 14, y - 14, x + 14, y + 14), fill="#bd533f")
            draw.text((60, 58), "MAP / FIELD NOTES", font=font(41, True), fill="#263330")
        else:
            for y in range(132, 690, 52):
                draw.line((85, y, 1195, y), fill="#beb7a9", width=2)
            draw.rectangle((65, 53, 1215, 106), fill="#263330")
            draw.text((86, 65), "DOCUMENT / EVIDENCE", font=font(30, True), fill="#f9f1df")
            draw.line((123, 110, 123, 700), fill="#cf715c", width=3)
        file = folder / f"{name}.png"
        im.save(file)
        thumb = im.resize((640, 360), Image.Resampling.LANCZOS)
        thumb.save(ASSET_POSTERS / f"{name}.jpg", quality=84)
        thumb.save(SITE_ASSETS / f"{name}.jpg", quality=84)


def route_reveal(t: float) -> Image.Image:
    im = Image.new("RGB", (W, H), "#d9d4c7")
    draw = ImageDraw.Draw(im)
    for x in range(0, W, 40):
        draw.line((x, 0, x, H), fill="#bbb8aa", width=1)
    for y in range(0, H, 40):
        draw.line((0, y, W, y), fill="#bbb8aa", width=1)
    points = [(85, 265), (180, 224), (290, 246), (392, 143)]
    progress = ease((t - .4) / 2.0)
    count = 1 + round(progress * (len(points) - 1))
    if count > 1:
        draw.line(points[:count], fill="#c6553d", width=8, joint="curve")
    for x, y in points[:count]:
        draw.ellipse((x - 8, y - 8, x + 8, y + 8), fill="#c6553d")
    text(im, (28, 25), "01 / THE ROUTE", 25, "#243432", bold=True)
    text(im, (48, 283), "DEPARTURE", 14, "#243432", bold=True)
    if t > 2.0:
        paste_panel(im, "winding-road", t, (374, 183, 238, 135), border=5)
        text(im, (400, 157), "ARRIVAL", 14, "#243432", bold=True)
    return im


def evidence_pullquote(t: float) -> Image.Image:
    im = shade(frame("newspaper-pages", t + .2), .5)
    rect(im, (28, 26, 326, 51), "#e7d9bd")
    text(im, (38, 31), "SOURCE / PUBLIC RECORD", 12, "#263430", bold=True)
    if t > .7:
        rect(im, (35, 108, 604, 275), "#eee7d6")
        text(im, (58, 127), "“THE EVIDENCE", 41, "#263430", bold=True)
        text(im, (58, 177), "TELLS A STORY.”", 41, "#263430", bold=True)
        rect(im, (58, 240, 290, 244), "#c7583d")
    text(im, (37, 316), "VERIFY WORDING  /  NAME THE SOURCE", 13, "#fff7e9", bold=True)
    return im


def journey_cuts(t: float) -> Image.Image:
    source = "crosswalk-crowd" if t < 1.3 else "subway-arrival" if t < 2.6 else "winding-road"
    local = t if t < 1.3 else t - 1.3 if t < 2.6 else t - 2.6
    im = shade(frame(source, local + .4), .25)
    labels = ("LEAVE", "IN MOTION", "ARRIVE")
    stage = 0 if t < 1.3 else 1 if t < 2.6 else 2
    rect(im, (25, 25, 31, 71), "#f0724a")
    text(im, (44, 27), f"0{stage + 1} / {labels[stage]}", 22, "#fff7e9", bold=True)
    for i in range(3):
        rect(im, (25 + i * 60, 325, 73 + i * 60, 329), "#f0724a" if i <= stage else "#aaa39a")
    return im


def data_contrast(t: float) -> Image.Image:
    im = shade(frame("city-aerial", t + .5), .72)
    text(im, (31, 28), "ONE QUESTION / TWO MEASURES", 16, "#eee9dc", bold=True)
    first = ease((t - .35) / .6)
    second = ease((t - 1.35) / .6)
    rect(im, (53, 222 - int(first * 104), 272, 260), "#e7d5af")
    rect(im, (368, 222 - int(second * 157), 587, 260), "#e66d4c")
    if first > .95:
        text(im, (67, 130), "40%", 42, "#263632", bold=True)
    if second > .95:
        text(im, (382, 77), "60%", 42, "#263632", bold=True)
    text(im, (61, 275), "BEFORE", 18, "#eee9dc", bold=True)
    text(im, (378, 275), "AFTER", 18, "#eee9dc", bold=True)
    text(im, (31, 328), "DEMO VALUES  /  REPLACE WITH SOURCED DATA", 12, "#eee9dc", bold=True)
    return im


def process_closeups(t: float) -> Image.Image:
    sources = ("hands", "microscope-scientist", "market-fruit")
    stage = min(2, int(t / 1.3))
    im = frame(sources[stage], (t % 1.3) + .3)
    rect(im, (0, 274, W, H), "#263632")
    label = ("PREPARE", "EXAMINE", "RESULT")[stage]
    text(im, (27, 288), f"0{stage + 1}   {label}", 34, "#fff5e7", bold=True)
    rect(im, (28, 338, 28 + int(584 * min(1, t / 4)), 342), "#ef7152")
    return im


STYLES = {
    "kinetic-quote": kinetic,
    "beat-grid": beat,
    "match-motion": match_motion,
    "paper-collage": collage,
    "light-leak": light_leak,
    "screen-focus": screen_focus,
    "split-reveal": split_reveal,
    "quiet-portrait": quiet,
    "whip-pan": whip,
    "film-strip": filmstrip,
    "video-mask-title": mask_title,
    "contact-grid": grid,
    "explainer-dossier": dossier,
    "route-reveal": route_reveal,
    "evidence-pullquote": evidence_pullquote,
    "journey-cuts": journey_cuts,
    "data-contrast": data_contrast,
    "process-closeups": process_closeups,
}


def render(name: str, painter) -> None:
    destination = OUT / f"{name}.mp4"
    pipe = subprocess.Popen([
        "ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", f"{W}x{H}", "-r", str(FPS), "-i", "pipe:0", "-an",
        "-c:v", "libx264", "-preset", "medium", "-crf", "25",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(destination),
    ], stdin=subprocess.PIPE)
    poster = None
    assert pipe.stdin is not None
    try:
        for i in range(DURATION * FPS):
            image = painter(i / FPS).convert("RGB")
            if i == (72 if name == "route-reveal" else 60 if name == "data-contrast" else 44):
                poster = image.copy()
            pipe.stdin.write(image.tobytes())
    finally:
        pipe.stdin.close()
    if pipe.wait() != 0:
        raise RuntimeError(f"Failed to render {name}")
    assert poster is not None
    poster.save(OUT / f"{name}.jpg", quality=86)
    (SITE / f"{name}.mp4").write_bytes(destination.read_bytes())
    (SITE / f"{name}.jpg").write_bytes((OUT / f"{name}.jpg").read_bytes())
    print(name, f"{destination.stat().st_size // 1024} KiB", flush=True)


if __name__ == "__main__":
    prepare()
    for style_name, painter in STYLES.items():
        render(style_name, painter)
