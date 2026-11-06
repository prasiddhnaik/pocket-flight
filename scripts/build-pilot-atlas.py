"""Packs the fighter pilot's eleven 4K material sets into one colour, normal and roughness atlas.

Run with: python3 -I scripts/build-pilot-atlas.py <folder holding scene.gltf and textures/>
Writes assets/pilot/atlas-{color,normal,orm}.jpg and atlas.json, read by scripts/build-pilot.py.
The source is "Fighter Pilot Character" by SoftNote (CC-BY-4.0); keep it outside the repository.
"""
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets/pilot"
WIDTH, HEIGHT, PAD = 4096, 2048, 8
# Parts seen close up from the seat get large cells; the helmet is only seen from outside.
CELLS = {
    "C-PANTS": (0, 0, 1024), "C-GLOVES-BOOTS": (1024, 0, 1024), "C-JACKET": (2048, 0, 1024), "C-LIFEVEST": (3072, 0, 1024),
    "C-STRAPS": (0, 1024, 1024), "C-NECKWRAP": (1024, 1024, 1024), "H-STRAPS": (2048, 1024, 1024),
    "H-HELMET": (3072, 1024, 512), "H-FACEMASK.002": (3584, 1024, 512), "H-VISOR": (3072, 1536, 512), "H-PIPECABLE": (3584, 1536, 512),
}
SLOTS = {"color": "baseColor", "normal": "normal", "orm": "metallicRoughness"}


def cell(image, size, pad):
    """Fits one texture into a cell, then repeats its edge pixels into the padding against bleeding."""
    inner = image.convert("RGB").resize((size - 2 * pad, size - 2 * pad), Image.LANCZOS)
    out = Image.new("RGB", (size, size))
    out.paste(inner.resize((size, size), Image.NEAREST))
    out.paste(inner, (pad, pad))
    return out


def main(source):
    OUT.mkdir(parents=True, exist_ok=True)
    rects = {}
    for slot, suffix in SLOTS.items():
        scale = 1 if slot == "color" else 2
        atlas = Image.new("RGB", (WIDTH // scale, HEIGHT // scale), (128, 128, 255) if slot == "normal" else (0, 200, 0) if slot == "orm" else (40, 40, 40))
        for name, (x, y, size) in CELLS.items():
            with Image.open(source / "textures" / f"{name}_{suffix}.png") as image:
                atlas.paste(cell(image, size // scale, PAD // scale), (x // scale, y // scale))
            # Blender UVs start at the bottom left.
            rects[name] = [(x + PAD) / WIDTH, 1 - (y + size - PAD) / HEIGHT, (x + size - PAD) / WIDTH, 1 - (y + PAD) / HEIGHT]
        atlas.save(OUT / f"atlas-{slot}.jpg", quality=86 if slot == "color" else 90, optimize=True)
        print("wrote", f"atlas-{slot}.jpg", atlas.size)
    (OUT / "atlas.json").write_text(json.dumps({"cells": rects}, indent=1))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
