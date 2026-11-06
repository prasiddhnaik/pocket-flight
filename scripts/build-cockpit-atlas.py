"""Paints one aircraft's cockpit texture atlas and writes the gauge scales the game reads.

Run with: python3 scripts/build-cockpit-atlas.py <id> (needs Pillow and the macOS fonts).
"""
import importlib
import json
import math
import random
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts/cockpit"))
layout = importlib.import_module(sys.argv[1])

OUT = ROOT / f"assets/{layout.ID}/cockpit"
SIZE = 2048
FONT = "/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf"
DIGITS = "/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf"
SURFACES = layout.SURFACES
INK = (232, 234, 228)
GRAY = getattr(layout, "PANEL_PAINT", (112, 118, 122))
BLACK = getattr(layout, "PLATE_PAINT", (24, 25, 27))
FACE = (17, 17, 18)
COLOURS = {"white": INK, "red": (232, 72, 58), "amber": (240, 176, 60), "green": (96, 226, 120), "yellow": (232, 196, 44)}

atlas = Image.new("RGB", (SIZE, SIZE), BLACK)
glow = Image.new("L", (SIZE, SIZE), 0)
paint = ImageDraw.Draw(atlas)
lit = ImageDraw.Draw(glow)
fonts = {}
random.seed(15)


def font(pixels, path=FONT):
    pixels = max(6, round(pixels))
    key = (path, pixels)
    if key not in fonts:
        fonts[key] = ImageFont.truetype(path, pixels)
    return fonts[key]


def px(surface, x, y):
    s = SURFACES[surface]
    return s["left"] + (x - s["x0"]) * s["scale"], s["top"] + (s["y1"] - y) * s["scale"]


def text(x, y, value, pixels, colour=INK, anchor="mm", glowing=True, path=FONT):
    paint.text((x, y), value, fill=colour, font=font(pixels, path), anchor=anchor)
    if glowing:
        lit.text((x, y), value, fill=210, font=font(pixels, path), anchor=anchor)


def legend(surface, entry):
    s = SURFACES[surface]
    x, y = px(surface, entry["x"], entry["y"])
    anchor = {"c": "mm", "l": "lm", "r": "rm"}[entry["align"]]
    text(x, y, entry["text"], entry["size"] * s["scale"], COLOURS[entry["colour"]], anchor)


def rect(surface, x0, y0, x1, y1, fill, outline=None):
    a, b = px(surface, x0, y1), px(surface, x1, y0)
    paint.rectangle([a, b], fill=fill, outline=outline)


def stripes(box):
    x0, y0, x1, y1 = [round(v) for v in box]
    w, h = max(1, x1 - x0), max(1, y1 - y0)
    tile = Image.new("RGB", (w, h), (226, 186, 38))
    ink = ImageDraw.Draw(tile)
    band = max(4, h // 4)
    for k in range(-h, w + h, band * 2):
        ink.polygon([(k, h), (k + band, h), (k + band + h, 0), (k + h, 0)], fill=(18, 18, 18))
    atlas.paste(tile, (x0, y0))


def weather(surface, x0, y0, x1, y1, count, strength=10):
    a, b = px(surface, x0, y1), px(surface, x1, y0)
    for _ in range(count):
        x, y = random.uniform(a[0], b[0]), random.uniform(a[1], b[1])
        angle, length = random.uniform(0, math.pi), random.uniform(3, 26)
        shade = random.randint(-strength, strength)
        base = atlas.getpixel((int(x), int(y)))
        colour = tuple(max(0, min(255, c + shade)) for c in base)
        end = (min(b[0], max(a[0], x + math.cos(angle) * length)), min(b[1], max(a[1], y + math.sin(angle) * length)))
        paint.line([(x, y), end], fill=colour, width=1)


# ---- Main panel and console paint ----
for name, area in SURFACES.items():
    rect(name, area["x0"], area["y0"], area["x1"], area["y1"], GRAY)
    weather(name, area["x0"], area["y0"], area["x1"], area["y1"], int(2400 * (area["x1"] - area["x0"]) * (area["y1"] - area["y0"]) / 0.6) + 200, 7)


def control_print(surface, control):
    s = SURFACES[surface]
    kind = control["kind"]
    x, y = px(surface, control["x"], control["y"])
    pts = s["scale"]
    if control.get("label"):
        text(x, y - 0.018 * pts, control["label"], 0.0048 * pts)
    if kind == "button":
        w, h = control["w"] * pts, control["h"] * pts
        box = [x - w / 2, y - h / 2, x + w / 2, y + h / 2]
        colour = control["colour"]
        if colour == "stripes":
            stripes(box)
            paint.rectangle([x - w * 0.42, y - h * 0.3, x + w * 0.42, y + h * 0.3], fill=(214, 44, 38))
            text(x, y, control["face"], h * 0.46, (250, 246, 236))
        else:
            fill = {"annunciator": (28, 22, 12), "amberbutton": (176, 124, 22), "black": (46, 48, 50)}[colour]
            ink = {"annunciator": (158, 112, 34), "amberbutton": (20, 18, 12), "black": INK}[colour]
            paint.rectangle(box, fill=fill, outline=(12, 12, 12))
            lines = control["face"].split("|") if control["face"] else []
            longest = max((len(line) for line in lines), default=1)
            size = min(h * (0.52 if len(lines) == 1 else 0.33), w / longest * 1.45)
            for i, line in enumerate(lines):
                text(x, y + (i - (len(lines) - 1) / 2) * size * 1.12, line, size, ink)
    if kind in ("toggle", "guard"):
        if control.get("up"):
            text(x, y - 0.0125 * pts, control["up"], 0.0042 * pts)
        if control.get("down"):
            text(x, y + 0.0125 * pts, control["down"], 0.0042 * pts)
    if kind == "guard":
        d = 0.0115 * pts
        stripes([x - d, y - d, x + d, y + d])
    if kind in ("rotary", "knob"):
        r = control["r"] * 1.65 * pts
        positions = control.get("marks") or [-120, -80, -40, 0, 40, 80, 120]
        for angle in positions:
            a = math.radians(angle)
            paint.line([(x + math.sin(a) * r, y - math.cos(a) * r), (x + math.sin(a) * r * 1.22, y - math.cos(a) * r * 1.22)], fill=INK, width=1)
            lit.line([(x + math.sin(a) * r, y - math.cos(a) * r), (x + math.sin(a) * r * 1.22, y - math.cos(a) * r * 1.22)], fill=170, width=1)
    if kind == "pull":
        d = 0.012 * pts
        stripes([x - d * 0.6, y - d * 1.2, x + d * 0.6, y + d * 1.2])


for entry in layout.PLATES:
    surface = entry["surface"]
    pts = SURFACES[surface]["scale"]
    fill = GRAY if entry["colour"] == "gray" else BLACK
    rect(surface, entry["x0"], entry["y0"], entry["x1"], entry["y1"], fill, (60, 62, 64) if fill == BLACK else (84, 88, 92))
    if fill == BLACK:
        weather(surface, entry["x0"], entry["y0"], entry["x1"], entry["y1"], 60, 9)
    if entry["title"]:
        x, y = px(surface, (entry["x0"] + entry["x1"]) / 2, entry["y1"] - 0.011)
        text(x, y, entry["title"], 0.0064 * pts)
        a, b = px(surface, entry["x0"] + 0.012, entry["y1"] - 0.019), px(surface, entry["x1"] - 0.012, entry["y1"] - 0.019)
        paint.line([a, b], fill=INK, width=1)
        lit.line([a, b], fill=150, width=1)
    for item in entry["legends"]:
        legend(surface, item)
    for control in entry["controls"]:
        control_print(surface, control)

for value, x, y, size in getattr(layout, "PRINTED", ()):
    legend("main", layout.L(value, x, y, size))


# ---- Dial faces, packed below the main panel ----
rects = {}
# Row-packed bins: under the main panel, then under the two console strips.
bins = layout.BINS


def allot(name, width, height=None):
    height = height or width
    for shelf in bins:
        x, y, row = shelf["x"], shelf["y"], shelf["row"]
        if x + width > shelf["x1"]:
            x, y, row = shelf["x0"], y + row + 4, 0
        if y + height <= SIZE:
            shelf.update(x=x + width + 4, y=y, row=max(row, height))
            rects[name] = (x, y, width, height)
            return rects[name]
    raise ValueError(f"The atlas has no room left for {name}.")


def interpolate(stops, value):
    if value <= stops[0][0]:
        return stops[0][1]
    for (a, x), (b, y) in zip(stops, stops[1:]):
        if value <= b:
            return x + (y - x) * (value - a) / (b - a)
    return stops[-1][1]


def point(cx, cy, radius, degrees):
    a = math.radians(degrees)
    return cx + math.sin(a) * radius, cy - math.cos(a) * radius


def dial(name, scale, size):
    x, y, w, _ = allot(name, size)
    cx, cy, r = x + w / 2, y + w / 2, w / 2
    paint.rectangle([x, y, x + w, y + w], fill=FACE)
    paint.ellipse([x + 1, y + 1, x + w - 1, y + w - 1], fill=(13, 13, 14))
    stops = scale["stops"]
    for low, high, colour in scale["arcs"]:
        a0, a1 = interpolate(stops, low), interpolate(stops, high)
        box = [cx - r * 0.93, cy - r * 0.93, cx + r * 0.93, cy + r * 0.93]
        paint.arc(box, a0 - 90, a1 - 90, fill=colour, width=max(2, round(r * 0.05)))
    for value in scale["minor"]:
        a = interpolate(stops, value)
        for image in (paint, lit):
            image.line([point(cx, cy, r * 0.9, a), point(cx, cy, r * 0.8, a)], fill=INK if image is paint else 180, width=max(1, round(r / 70)))
    for value in scale["major"]:
        a = interpolate(stops, value)
        for image in (paint, lit):
            image.line([point(cx, cy, r * 0.92, a), point(cx, cy, r * 0.74, a)], fill=INK if image is paint else 230, width=max(2, round(r / 40)))
        label = scale["labels"].get(value)
        if label:
            tx, ty = point(cx, cy, r * 0.6, a)
            text(tx, ty, label, r * 0.23, INK, path=DIGITS)
    text(cx, cy - r * 0.27, scale["title"], r * 0.125)
    if scale["sub"]:
        text(cx, cy + r * 0.26, scale["sub"], r * 0.095)


SIZES = {"airspeed": 288, "altimeter": 288, "aoa": 224, "gmeter": 224, "vvi": 224, "rpm": 192, "ftit": 192, "fuelflow": 192, "nozzle": 192, "oil": 128, "hydraulic": 128, "fuel": 240, "cabin": 160, "oxygen": 192}
for name in sorted({g[1] for g in layout.GAUGES}, key=lambda n: -SIZES.get(n, 192)):
    dial(f"dial_{name}", layout.SCALES[name], SIZES.get(name, 192))

# Clock.
x, y, w, _ = allot("dial_clock", 224)
cx, cy, r = x + w / 2, y + w / 2, w / 2
paint.rectangle([x, y, x + w, y + w], fill=FACE)
for minute in range(60):
    a = minute * 6
    major = minute % 5 == 0
    for image in (paint, lit):
        image.line([point(cx, cy, r * 0.93, a), point(cx, cy, r * (0.76 if major else 0.86), a)], fill=INK if image is paint else 210, width=3 if major else 1)
for hour in range(1, 13):
    tx, ty = point(cx, cy, r * 0.6, hour * 30)
    text(tx, ty, str(hour), r * 0.24, INK, path=DIGITS)
text(cx, cy + r * 0.3, "8 DAY", r * 0.1)

# ADI ball as an equirectangular strip: pale sky over dark ground, ladder every 10 degrees.
x, y, w, h = allot("adi_ball", 512, 256)
sky, ground = (92, 102, 110), (20, 20, 22)
paint.rectangle([x, y, x + w, y + h / 2], fill=sky)
paint.rectangle([x, y + h / 2, x + w, y + h], fill=ground)
paint.rectangle([x, y + h / 2 - 2, x + w, y + h / 2 + 1], fill=(246, 246, 240))
for pitch in range(-80, 90, 10):
    if pitch == 0:
        continue
    row = y + h / 2 - pitch / 180 * h
    ink = (20, 20, 20) if pitch > 0 else (232, 232, 226)
    for centre in (x + w / 4, x + 3 * w / 4):
        half = 22 if pitch % 30 == 0 else 13
        paint.line([(centre - half, row), (centre + half, row)], fill=ink, width=2)
        if pitch % 20 == 0:
            paint.text((centre - half - 3, row), str(abs(pitch)), fill=ink, font=font(12), anchor="rm")
            paint.text((centre + half + 3, row), str(abs(pitch)), fill=ink, font=font(12), anchor="lm")
for heading in range(0, 360, 30):
    column = x + heading / 360 * w
    for row in (y + h / 2 - 7, y + h / 2 + 7):
        paint.line([(column, row - 3), (column, row + 3)], fill=(246, 246, 240), width=2)
glow.paste(46, (x, y, x + w, y + h // 2))

# ADI and HSI front rings.
x, y, w, _ = allot("adi_ring", 288)
cx, cy, r = x + w / 2, y + w / 2, w / 2
paint.rectangle([x, y, x + w, y + w], fill=FACE)
for bank in (-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60):
    major = bank % 30 == 0
    for image in (paint, lit):
        image.line([point(cx, cy, r * 0.94, bank), point(cx, cy, r * (0.82 if major else 0.87), bank)], fill=INK if image is paint else 220, width=4 if major else 2)
x, y, w, _ = allot("hsi_ring", 288)
cx, cy, r = x + w / 2, y + w / 2, w / 2
paint.rectangle([x, y, x + w, y + w], fill=FACE)
for bearing in range(0, 360, 45):
    for image in (paint, lit):
        image.polygon([point(cx, cy, r * 0.96, bearing), point(cx, cy, r * 0.86, bearing - 3), point(cx, cy, r * 0.86, bearing + 3)], fill=INK if image is paint else 220)
x, y, w, _ = allot("hsi_card", 320)
cx, cy, r = x + w / 2, y + w / 2, w / 2
paint.rectangle([x, y, x + w, y + w], fill=FACE)
paint.ellipse([x + 1, y + 1, x + w - 1, y + w - 1], fill=(20, 20, 22))
for degrees in range(0, 360, 5):
    major = degrees % 30 == 0
    tick = r * (0.8 if major else 0.87 if degrees % 10 == 0 else 0.91)
    for image in (paint, lit):
        image.line([point(cx, cy, r * 0.97, degrees), point(cx, cy, tick, degrees)], fill=INK if image is paint else 220, width=3 if major else 1)
for degrees, label in {0: "N", 30: "3", 60: "6", 90: "E", 120: "12", 150: "15", 180: "S", 210: "21", 240: "24", 270: "W", 300: "30", 330: "33"}.items():
    tile = Image.new("L", (80, 80), 0)
    ImageDraw.Draw(tile).text((40, 40), label, fill=255, font=font(r * 0.2, DIGITS), anchor="mm")
    tile = tile.rotate(-degrees, resample=Image.BICUBIC)
    tx, ty = point(cx, cy, r * 0.65, degrees)
    box = (round(tx - 40), round(ty - 40))
    atlas.paste(INK, box, tile)
    glow.paste(210, box, tile)
text(cx, cy, "HDG", r * 0.1, (150, 150, 146))

# Altimeter and fuel counter drums: one column of digits.
x, y, w, h = allot("drum", 32, 320)
paint.rectangle([x, y, x + w, y + h], fill=(16, 16, 17))
for digit in range(10):
    text(x + w / 2, y + (digit + 0.5) * h / 10, str(digit), h / 10 * 0.82, INK, path=DIGITS)

# Warning handle stripes and seat labels.
x, y, w, h = allot("stripes", 128, 128)
stripes([x, y, x + w, y + h])
x, y, w, h = allot("eject", 256, 48)
paint.rectangle([x, y, x + w, y + h], fill=(226, 186, 38))
text(x + w / 2, y + h / 2, "PULL TO EJECT", h * 0.56, (14, 14, 14), glowing=False)
x, y, w, h = allot("placard", 256, 64)
paint.rectangle([x, y, x + w, y + h], fill=(190, 188, 176))
text(x + w / 2, y + h * 0.34, "CANOPY JETTISON", h * 0.28, (20, 20, 20), glowing=False)
text(x + w / 2, y + h * 0.7, "PULL TO RELEASE", h * 0.22, (150, 30, 24), glowing=False)

OUT.mkdir(parents=True, exist_ok=True)
atlas.save(OUT / "atlas.png", optimize=True)
glow.resize((1024, 1024), Image.BILINEAR).filter(ImageFilter.GaussianBlur(0.4)).save(OUT / "atlas-glow.png", optimize=True)
(OUT / "atlas.json").write_text(json.dumps({"size": SIZE, "surfaces": SURFACES, "rects": rects}, indent=1))
gauges = {g[0]: g[1] for g in layout.GAUGES}
scales = {name: layout.SCALES[name]["stops"] for name in sorted(set(gauges.values()))}
(ROOT / f"src/aircraft/{layout.ID}/cockpit-gauges.json").write_text(json.dumps({"scales": scales, "gauges": gauges}, indent=1) + "\n")
print("atlas", atlas.size, "rects", len(rects), "bins end at", [b["y"] + b["row"] for b in bins])
