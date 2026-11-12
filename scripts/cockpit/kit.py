"""Blender toolkit behind the detail cockpits: mesh builders, instruments, checks and export.

Each aircraft module in this folder holds its layout and a build(k) function that calls
this kit. Run through scripts/build-cockpit.py.
"""
import json
import math
from collections import defaultdict
from contextlib import contextmanager
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[2]
TAU = math.tau
PLATE_Z = 0.003
MATERIALS = {
    # name: (base colour in sRGB, metallic, roughness, extras)
    "atlas": ((255, 255, 255), 0.0, 0.62, {}),
    "atlas_lit": ((255, 255, 255), 0.0, 0.62, {}),
    "paint": ((96, 102, 106), 0.0, 0.6, {}),
    "paint_dark": ((58, 62, 66), 0.0, 0.68, {}),
    "black": ((26, 27, 29), 0.0, 0.55, {}),
    "knob": ((22, 22, 24), 0.05, 0.34, {}),
    "metal": ((166, 168, 170), 1.0, 0.36, {}),
    "metal_dark": ((70, 72, 76), 1.0, 0.45, {}),
    "white": ((230, 230, 224), 0.0, 0.5, {}),
    "orange": ((238, 120, 30), 0.0, 0.5, {}),
    "yellow": ((226, 186, 38), 0.0, 0.48, {}),
    "red": ((168, 28, 24), 0.0, 0.32, {}),
    "rubber": ((20, 20, 21), 0.0, 0.82, {}),
    "cover": ((64, 67, 70), 0.0, 0.8, {}),
    "fabric": ((86, 94, 72), 0.0, 0.92, {}),
    "cushion": ((58, 64, 54), 0.0, 0.88, {}),
    "webbing": ((74, 80, 62), 0.0, 0.94, {}),
    "chute": ((70, 82, 66), 0.0, 0.9, {}),
    "wire": ((34, 36, 34), 0.0, 0.7, {}),
    "wire_white": ((176, 172, 158), 0.0, 0.7, {}),
    "lamp_red": ((60, 12, 10), 0.0, 0.25, {}),
    "lamp_green": ((12, 44, 18), 0.0, 0.25, {}),
    "lamp_amber": ((58, 38, 8), 0.0, 0.25, {}),
    "screen": ((6, 9, 8), 0.0, 0.2, {}),
    "mirror": ((150, 170, 190), 0.9, 0.08, {}),
    "liner": ((206, 200, 186), 0.0, 0.7, {}),
    "carpet": ((46, 46, 48), 0.0, 0.96, {}),
    "glass": ((8, 10, 12), 0.0, 0.08, {"alpha": 0.1}),
    "hud_glass": ((170, 220, 190), 0.0, 0.04, {"alpha": 0.16}),
}


class Part:
    __slots__ = ("name", "material", "verts", "faces", "uvs", "node", "group")

    def __init__(self, name, material, verts, faces, uvs, node, group=""):
        self.name, self.material, self.verts, self.faces, self.uvs, self.node, self.group = name, material, verts, faces, uvs, node, group


PARTS = []
NODES = {}
FRAMES = {}
MOD = None
ATLAS = None
PREFIX = ""
TRANSFORM = Matrix.Identity(4)


def setup(module):
    """Loads an aircraft's atlas map and surface frames, ready for its build."""
    global MOD, ATLAS
    MOD = module
    ATLAS = json.loads((ROOT / f"assets/{module.ID}/cockpit/atlas.json").read_text())
    MATERIALS.update(getattr(module, "MATERIALS", {}))
    for name, spec in module.FRAMES.items():
        FRAMES[name] = make_frame(*spec)


def make_frame(kind, origin, tilt=0.0):
    x, y, z = origin
    if kind == "panel":
        t = math.radians(tilt)
        return Matrix(((1, 0, 0, x), (0, math.sin(t), -math.cos(t), y), (0, math.cos(t), math.sin(t), z), (0, 0, 0, 1)))
    if kind == "overhead":
        # Read looking up from the seat: the top of the text points aft.
        return Matrix(((1, 0, 0, x), (0, -1, 0, y), (0, 0, -1, z), (0, 0, 0, 1)))
    return Matrix(((1, 0, 0, x), (0, 1, 0, y), (0, 0, 1, z), (0, 0, 0, 1)))


@contextmanager
def placed(offset=(0.0, 0.0, 0.0), prefix=""):
    """Builds the enclosed parts shifted bodily, optionally as the rear cockpit's copies."""
    global TRANSFORM, PREFIX
    saved = TRANSFORM, PREFIX
    TRANSFORM, PREFIX = Matrix.Translation(offset) @ TRANSFORM, prefix or PREFIX
    yield
    TRANSFORM, PREFIX = saved


def node(name, frame, parent=None):
    name = PREFIX + name
    NODES[name] = dict(matrix=TRANSFORM @ frame, parent=parent)
    return name


def emit(name, material, mesh, frame=Matrix.Identity(4), owner=None):
    verts, faces, uvs = mesh
    base = TRANSFORM @ frame
    if owner is not None:
        base = NODES[owner]["matrix"].inverted() @ base
    PARTS.append(Part(name, material, [base @ Vector(v) for v in verts], faces, uvs, owner, PREFIX))


# ---- Mesh builders: each returns (verts, faces, uvs). Duplicated verts make hard edges. ----
def merge(*meshes):
    verts, faces, uvs = [], [], []
    for mesh in meshes:
        offset = len(verts)
        verts += mesh[0]
        faces += [tuple(i + offset for i in face) for face in mesh[1]]
        uvs += mesh[2] if mesh[2] else [(0.0, 0.0)] * len(mesh[0])
    return verts, faces, uvs


def box(x0, y0, z0, x1, y1, z1, chamfer=0.0):
    c = min(chamfer, abs(x1 - x0) * 0.45, abs(y1 - y0) * 0.45, abs(z1 - z0) * 0.45)
    verts, faces = [], []

    def quad(a, b, cc, d):
        n = len(verts)
        verts.extend([a, b, cc, d])
        faces.append((n, n + 1, n + 2, n + 3))

    def tri(a, b, cc):
        n = len(verts)
        verts.extend([a, b, cc])
        faces.append((n, n + 1, n + 2))

    X0, X1, Y0, Y1, Z0, Z1 = x0 + c, x1 - c, y0 + c, y1 - c, z0 + c, z1 - c
    quad((X0, Y0, z1), (X1, Y0, z1), (X1, Y1, z1), (X0, Y1, z1))
    quad((X0, Y1, z0), (X1, Y1, z0), (X1, Y0, z0), (X0, Y0, z0))
    quad((X0, y0, Z0), (X1, y0, Z0), (X1, y0, Z1), (X0, y0, Z1))
    quad((X1, y1, Z0), (X0, y1, Z0), (X0, y1, Z1), (X1, y1, Z1))
    quad((x1, Y0, Z0), (x1, Y1, Z0), (x1, Y1, Z1), (x1, Y0, Z1))
    quad((x0, Y1, Z0), (x0, Y0, Z0), (x0, Y0, Z1), (x0, Y1, Z1))
    if c > 0:
        quad((X0, y0, Z1), (X1, y0, Z1), (X1, Y0, z1), (X0, Y0, z1))
        quad((X1, y1, Z1), (X0, y1, Z1), (X0, Y1, z1), (X1, Y1, z1))
        quad((x1, Y0, Z1), (x1, Y1, Z1), (X1, Y1, z1), (X1, Y0, z1))
        quad((x0, Y1, Z1), (x0, Y0, Z1), (X0, Y0, z1), (X0, Y1, z1))
        quad((X1, y0, Z0), (X0, y0, Z0), (X0, Y0, z0), (X1, Y0, z0))
        quad((X0, y1, Z0), (X1, y1, Z0), (X1, Y1, z0), (X0, Y1, z0))
        quad((x1, Y1, Z0), (x1, Y0, Z0), (X1, Y0, z0), (X1, Y1, z0))
        quad((x0, Y0, Z0), (x0, Y1, Z0), (X0, Y1, z0), (X0, Y0, z0))
        quad((X1, y0, Z0), (x1, Y0, Z0), (x1, Y0, Z1), (X1, y0, Z1))
        quad((x1, Y1, Z0), (X1, y1, Z0), (X1, y1, Z1), (x1, Y1, Z1))
        quad((X0, y1, Z0), (x0, Y1, Z0), (x0, Y1, Z1), (X0, y1, Z1))
        quad((x0, Y0, Z0), (X0, y0, Z0), (X0, y0, Z1), (x0, Y0, Z1))
        for sx, xa, xb in ((1, X1, x1), (-1, X0, x0)):
            for sy, ya, yb in ((1, Y1, y1), (-1, Y0, y0)):
                for za, zb, sz in ((Z1, z1, 1), (Z0, z0, -1)):
                    a, b, d = (xb, ya, za), (xa, yb, za), (xa, ya, zb)
                    tri(a, b, d) if sx * sy * sz > 0 else tri(b, a, d)
    return verts, faces, []


def lathe(profile, n=12, start=0.0):
    """Revolves (radius, z) about Z. Hard between profile steps, smooth around the ring."""
    verts, faces = [], []
    for (r0, z0), (r1, z1) in zip(profile, profile[1:]):
        base = len(verts)
        for r, z in ((r0, z0), (r1, z1)):
            for k in range(n):
                a = start + k / n * TAU
                verts.append((math.cos(a) * r, math.sin(a) * r, z))
        for k in range(n):
            m = (k + 1) % n
            faces.append((base + k, base + m, base + n + m, base + n + k))
    return verts, faces, []


def prism(section, z0, z1, cap=True):
    """Extrudes a CCW outline along Z with flat sides."""
    verts, faces = [], []
    count = len(section)
    for k in range(count):
        a, b = section[k], section[(k + 1) % count]
        base = len(verts)
        verts += [(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)]
        faces.append((base, base + 1, base + 2, base + 3))
    if cap:
        base = len(verts)
        verts += [(p[0], p[1], z1) for p in section]
        faces.append(tuple(range(base, base + count)))
    return verts, faces, []


def transform(mesh, matrix):
    return [tuple(matrix @ Vector(v)) for v in mesh[0]], mesh[1], mesh[2]


def disk(r, z, rect=None, n=32, rotate=0.0):
    verts, faces, uvs = [(0.0, 0.0, z)], [], [uv_rect(rect, 0.5, 0.5) if rect else (0.0, 0.0)]
    for k in range(n):
        a = k / n * TAU
        verts.append((math.cos(a) * r, math.sin(a) * r, z))
        ax, ay = math.cos(a + rotate), math.sin(a + rotate)
        uvs.append(uv_rect(rect, 0.5 + ax * 0.5, 0.5 + ay * 0.5) if rect else (0.0, 0.0))
    for k in range(n):
        faces.append((0, 1 + k, 1 + (k + 1) % n))
    return verts, faces, uvs


def annulus(r0, r1, z, rect=None, n=32):
    verts, faces, uvs = [], [], []
    for k in range(n):
        a = k / n * TAU
        for r in (r0, r1):
            verts.append((math.cos(a) * r, math.sin(a) * r, z))
            uvs.append(uv_rect(rect, 0.5 + math.cos(a) * r / r1 * 0.5, 0.5 + math.sin(a) * r / r1 * 0.5) if rect else (0.0, 0.0))
    for k in range(n):
        m = (k + 1) % n
        faces.append((k * 2, k * 2 + 1, m * 2 + 1, m * 2))
    return verts, faces, uvs


def rectangle(x0, y0, x1, y1, z, uv=None, step=0.03):
    xs = sorted({x0, x1} | {x0 + i * step for i in range(1, int((x1 - x0) / step)) if x0 + i * step < x1 - step / 3})
    ys = sorted({y0, y1} | {y0 + i * step for i in range(1, int((y1 - y0) / step)) if y0 + i * step < y1 - step / 3})
    verts = [(x, y, z) for y in ys for x in xs]
    uvs = [uv(x, y) for x, y, _ in verts] if uv else [(0.0, 0.0)] * len(verts)
    w = len(xs)
    faces = [(j * w + i, j * w + i + 1, (j + 1) * w + i + 1, (j + 1) * w + i) for j in range(len(ys) - 1) for i in range(w - 1)]
    return verts, faces, uvs


def loft(sections, closed=False, reverse=False):
    verts = [tuple(p) for section in sections for p in section]
    count = len(sections[0])
    faces = []
    for j in range(len(sections) - 1):
        for k in range(count if closed else count - 1):
            m = (k + 1) % count
            quad = (j * count + k, j * count + m, (j + 1) * count + m, (j + 1) * count + k)
            faces.append(quad[::-1] if reverse else quad)
    return verts, faces, []


def tube(path, r, n=6):
    path = [Vector(p) for p in path]
    sections = []
    up = Vector((0.0, 0.0, 1.0))
    for i, p in enumerate(path):
        tangent = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        side = tangent.cross(up)
        if side.length < 1e-4:
            side = tangent.cross(Vector((1.0, 0.0, 0.0)))
        side.normalize()
        normal = side.cross(tangent).normalized()
        up = normal
        sections.append([tuple(p + side * math.cos(k / n * TAU) * r + normal * math.sin(k / n * TAU) * r) for k in range(n)])
    return loft(sections, closed=True)


def strap(path, width, thick=0.0025, up_hint=(0.0, 0.0, 1.0)):
    path = [Vector(p) for p in path]
    sections = []
    for i, p in enumerate(path):
        tangent = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        side = tangent.cross(Vector(up_hint))
        if side.length < 1e-4:
            side = tangent.cross(Vector((1.0, 0.0, 0.0)))
        side = side.normalized() * width / 2
        normal = side.cross(tangent).normalized() * thick / 2
        sections.append([tuple(p - side - normal), tuple(p + side - normal), tuple(p + side + normal), tuple(p - side + normal)])
    return loft(sections, closed=True)


def uv_rect(rect, u, v):
    x, y, w, h = ATLAS["rects"][rect]
    size = ATLAS["size"]
    return (x + u * w) / size, 1 - (y + (1 - v) * h) / size


def surface_uv(surface):
    s = ATLAS["surfaces"][surface.split("@")[0]]
    size = ATLAS["size"]

    def uv(x, y):
        return (s["left"] + (x - s["x0"]) * s["scale"]) / size, 1 - (s["top"] + (s["y1"] - y) * s["scale"]) / size

    return uv


def at(surface, x, y, z=0.0):
    return FRAMES[surface] @ Matrix.Translation((x, y, z))


# ---- Small hardware ----
def fastener(name, surface, x, y, z=0.0, r=0.0032):
    frame = at(surface, x, y, z)
    emit(name, "metal_dark", lathe([(r, -0.001), (r, 0.0009), (r * 0.72, 0.0014), (0.0, 0.0014)], 8), frame)
    emit(name + "_slot", "black", box(-r * 0.72, -r * 0.14, 0.0009, r * 0.72, r * 0.14, 0.00155), frame)


def control_knob(name, surface, c, z):
    r = c["r"]
    frame = at(surface, c["x"], c["y"], z)
    emit(name, "knob", lathe([(r * 1.22, -0.001), (r * 1.22, 0.0016), (r * 1.02, 0.0028), (r * 0.9, 0.011), (r * 0.78, 0.0132), (0.0, 0.0134)], 16), frame)
    for k in range(8):
        a = k / 8 * TAU
        emit(name + "_rib", "knob", box(-0.0006, -0.0006, 0.002, 0.0006, 0.0006, 0.0115), frame @ Matrix.Rotation(a, 4, "Z") @ Matrix.Translation((r * 0.98, 0, 0)))
    pointer = math.radians(-35 + (sum(map(ord, name)) % 7) * 12)
    emit(name + "_mark", "white", box(-0.0006, r * 0.2, 0.0130, 0.0006, r * 0.95, 0.0142), frame @ Matrix.Rotation(pointer, 4, "Z"))


def control_rotary(name, surface, c, z):
    r = c["r"]
    frame = at(surface, c["x"], c["y"], z)
    emit(name, "knob", lathe([(r * 1.12, -0.001), (r * 1.12, 0.0022), (r * 0.98, 0.0032), (0.0, 0.0032)], 18), frame)
    lobes = 3
    section = []
    for k in range(lobes * 12):
        a = k / (lobes * 12) * TAU
        section.append((math.cos(a) * r * (0.62 + 0.12 * math.cos(a * lobes)), math.sin(a) * r * (0.62 + 0.12 * math.cos(a * lobes))))
    pointer = math.radians(-50 + (sum(map(ord, name)) % 5) * 25)
    emit(name + "_grip", "knob", transform(prism(section, 0.003, 0.0135), Matrix.Rotation(pointer, 4, "Z")), frame)
    bar = box(-r * 0.2, -r * 0.24, 0.003, r * 0.2, r * 1.0, 0.0145, chamfer=0.001)
    emit(name + "_bar", "knob", transform(bar, Matrix.Rotation(pointer, 4, "Z")), frame)
    emit(name + "_mark", "white", transform(box(-0.0006, r * 0.3, 0.0144, 0.0006, r * 0.98, 0.0154), Matrix.Rotation(pointer, 4, "Z")), frame)


def control_toggle(name, surface, c, z, material="metal"):
    frame = at(surface, c["x"], c["y"], z)
    emit(name + "_nut", "metal_dark", lathe([(0.0042, -0.0006), (0.0042, 0.0016), (0.0032, 0.0024), (0.0, 0.0024)], 6), frame)
    emit(name + "_sleeve", "metal", lathe([(0.0026, 0.0018), (0.0026, 0.0052), (0.0019, 0.0058), (0.0, 0.0058)], 8), frame)
    lean = math.radians(24 if sum(map(ord, name)) % 2 else -24)
    bat = lathe([(0.0011, 0.0), (0.0014, 0.006), (0.0021, 0.0125), (0.0017, 0.0142), (0.0, 0.0148)], 8)
    emit(name + "_bat", material, transform(bat, Matrix.Translation((0, 0, 0.0036)) @ Matrix.Rotation(lean, 4, "X")), frame)


def control_guard(name, surface, c, z):
    control_toggle(name, surface, c, z, "red")
    frame = at(surface, c["x"], c["y"], z)
    for side in (-1, 1):
        emit(name + "_cheek", "yellow", box(side * 0.0088 - 0.0009, -0.0095, -0.0005, side * 0.0088 + 0.0009, 0.0095, 0.0115, chamfer=0.0004), frame)
    emit(name + "_bar", "yellow", box(-0.0088, 0.0088, 0.0, 0.0088, 0.0108, 0.0115, chamfer=0.0005), frame)


def control_button(name, surface, c, z):
    w, h = c["w"], c["h"]
    frame = at(surface, c["x"], c["y"], z)
    uv = surface_uv(surface)
    owner = c["node"]
    if owner:
        node(owner, frame)
    emit(name + "_well", "black", box(-w / 2 - 0.0012, -h / 2 - 0.0012, -0.0006, w / 2 + 0.0012, h / 2 + 0.0012, 0.0012, chamfer=0.0004), frame)
    emit(name + "_side", "knob", box(-w / 2, -h / 2, 0.0006, w / 2, h / 2, 0.0029, chamfer=0.0004), frame, owner)
    cap = rectangle(-w / 2 + 0.0004, -h / 2 + 0.0004, w / 2 - 0.0004, h / 2 - 0.0004, 0.00295, lambda x, y: uv(c["x"] + x, c["y"] + y), step=1.0)
    emit(name, printed(surface), cap, frame, owner)


def control_lamp(name, surface, c, z):
    r = c["r"]
    frame = at(surface, c["x"], c["y"], z)
    owner = c["node"]
    if owner:
        node(owner, frame)
    emit(name + "_rim", "metal_dark", lathe([(r * 1.35, -0.0005), (r * 1.35, 0.0016), (r * 1.08, 0.0026), (r * 0.98, 0.0016)], 14), frame)
    dome = [(r, 0.0012)] + [(r * math.cos(a), 0.0012 + r * 0.6 * math.sin(a)) for a in (0.5, 0.95, 1.3)] + [(0.0, 0.0012 + r * 0.6)]
    emit(name, f"lamp_{c['colour']}", lathe(dome, 12), frame, owner)


def control_pull(name, surface, c, z):
    frame = at(surface, c["x"], c["y"], z)
    emit(name + "_collar", "metal_dark", lathe([(0.0052, -0.0005), (0.0052, 0.002), (0.0036, 0.0028), (0.0, 0.0028)], 10), frame)
    emit(name + "_shaft", "metal", lathe([(0.0022, 0.002), (0.0022, 0.012), (0.0, 0.012)], 8), frame)
    x0, y0, w, h = -0.0065, -0.0125, 0.013, 0.025
    grip = box(x0, y0, 0.0108, x0 + w, y0 + h, 0.0165, chamfer=0.0014)
    uvs = [uv_rect("stripes", (v[0] - x0) / w, (v[1] - y0) / h) for v in grip[0]]
    emit(name, "atlas", (grip[0], grip[1], uvs), frame)


def control_wheel(name, surface, c, z):
    frame = at(surface, c["x"], c["y"], z)
    # The lever moves in a slot; its pivot sits behind the panel face.
    emit(name + "_slot", "rubber", box(-0.006, -0.03, -0.0005, 0.006, 0.03, 0.0008, chamfer=0.0002), frame)
    owner = node("Gear_handle", frame @ Matrix.Translation((0, 0.0, 0.0)))
    emit(name + "_lever", "metal", box(-0.0035, -0.0035, -0.002, 0.0035, 0.0035, 0.033, chamfer=0.0008), frame, owner)
    wheel = Matrix.Translation((0, 0, 0.033)) @ Matrix.Rotation(math.pi / 2, 4, "Y")
    tyre = lathe([(0.0085, -0.0052), (0.0145, -0.0052), (0.0165, -0.003), (0.0165, 0.003), (0.0145, 0.0052), (0.0085, 0.0052), (0.0085, -0.0052)], 22)
    emit(name, "red", transform(tyre, wheel), frame, owner)
    emit(name + "_hub", "metal", transform(lathe([(0.0088, -0.0036), (0.0088, 0.0036), (0.0, 0.0036)], 14), wheel), frame, owner)


BUILDERS = {"knob": control_knob, "rotary": control_rotary, "toggle": control_toggle, "guard": control_guard, "button": control_button, "lamp": control_lamp, "pull": control_pull, "wheel": control_wheel}


# ---- Instruments ----
def housing(name, surface, x, y, half, depth=0.0011):
    frame = at(surface, x, y)
    emit(name + "_case", "black", box(-half, -half, -0.002, half, half, depth, chamfer=0.0012), frame)
    if half > 0.02:
        inset = half - 0.0044
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            fastener(name + "_screw", surface, x + sx * inset, y + sy * inset, depth, r=0.0021)


def dial_needle(name, surface, x, y, r, length, tail=0.28, width=0.0016, z=0.0052, material="white", tip=False):
    frame = at(surface, x, y)
    owner = node(name, frame)
    blade = [(-width * 0.6, -r * tail), (width * 0.6, -r * tail), (width * 0.55, r * length * 0.72), (0.0, r * length), (-width * 0.55, r * length * 0.72)]
    emit(name, material, prism(blade, z - 0.0005, z), frame, owner)
    emit(name + "_hub", "knob", lathe([(0.0032 if r > 0.025 else 0.0022, z - 0.003), (0.0032 if r > 0.025 else 0.0022, z + 0.0006), (0.0, z + 0.0009)], 10), frame, owner)
    if tip:
        cap = [(-width * 0.5, r * length * 0.72), (width * 0.5, r * length * 0.72), (0.0, r * length)]
        emit(name + "_tip", "orange", prism(cap, z, z + 0.0002), frame, owner)
    return owner


def gauge(name, scale, surface, x, y, r):
    housing(f"Case_{name}", surface, x, y, r + 0.0075)
    frame = at(surface, x, y)
    rim = [(r + 0.0058, 0.0008), (r + 0.0058, 0.0066), (r + 0.0028, 0.0078), (r + 0.0006, 0.0072), (r + 0.0006, 0.0012)]
    emit(f"Rim_{name}", "knob", lathe(rim, 32), frame)
    emit(f"Dial_{name}", "atlas", disk(r + 0.001, 0.0014, f"dial_{scale}", 36), frame)
    dial_needle(f"Needle_{name}", surface, x, y, r, 0.86, tip=r > 0.03)
    emit(f"Glass_{name}", "glass", disk(r + 0.001, 0.0072, None, 24), frame)


def drums(prefix, surface, x, y, count, width, height, z=0.0046):
    frame = at(surface, x, y)
    half_w, half_h, rim = count * width / 2, height / 2, 0.0011
    emit(prefix + "_back", "black", box(-half_w, -half_h, 0.0012, half_w, half_h, 0.0016), frame)
    for bar in (box(-half_w - rim, half_h, 0.0012, half_w + rim, half_h + rim, 0.0056), box(-half_w - rim, -half_h - rim, 0.0012, half_w + rim, -half_h, 0.0056), box(-half_w - rim, -half_h, 0.0012, -half_w, half_h, 0.0056), box(half_w, -half_h, 0.0012, half_w + rim, half_h, 0.0056)):
        emit(prefix + "_frame", "knob", bar, frame)
    rad = height * 0.46
    for k in range(count):
        cx = -half_w + width * (k + 0.5)
        centre = frame @ Matrix.Translation((cx, 0, z - rad))
        owner = node(f"{prefix}_{k}", centre)
        verts, faces, uvs = [], [], []
        n = 20
        side = width * 0.46
        for j in range(n + 1):
            a = j / n * TAU
            for edge, u in ((-side, 0.0), (side, 1.0)):
                verts.append((edge, math.sin(a) * rad, math.cos(a) * rad))
                uvs.append(uv_rect("drum", u, 1 - j / n))
        for j in range(n):
            faces.append((j * 2 + 1, j * 2 + 3, j * 2 + 2, j * 2))
        emit(f"{prefix}_{k}", "atlas", (verts, faces, uvs), centre, owner)
        emit(prefix + "_axle", "metal_dark", box(cx - width * 0.47, -0.0006, z - rad - 0.0006, cx + width * 0.47, 0.0006, z - rad + 0.0006), frame)


def attitude_ball(name, surface, x, y, r):
    radius = r * 1.02
    z = 0.003 - radius
    emit(f"{name}_cup", "rubber", lathe([(r * 1.03, 0.0052), (r * 1.03, z - 0.003)], 32), at(surface, x, y))
    frame = at(surface, x, y, z)
    owner = node(name, frame)
    rings, segments = 18, 32
    verts, faces, uvs = [], [], []
    for j in range(rings + 1):
        lat = -math.pi / 2 + j / rings * math.pi
        for k in range(segments + 1):
            lon = -math.pi + k / segments * TAU
            verts.append((math.sin(lon) * math.cos(lat) * radius, math.sin(lat) * radius, math.cos(lon) * math.cos(lat) * radius))
            uvs.append(uv_rect("adi_ball", k / segments, j / rings))
    width = segments + 1
    for j in range(rings):
        for k in range(segments):
            faces.append((j * width + k, j * width + k + 1, (j + 1) * width + k + 1, (j + 1) * width + k))
    emit(name, "atlas", (verts, faces, uvs), frame, owner)


def adi(data, name="ADI", ball="ADI_ball", surface="main"):
    x, y, r = data["x"], data["y"], data["r"]
    half = r + 0.009
    frame = at(surface, x, y)
    # A deep square case around an open round window onto the ball.
    outline = [(-half, -half), (half, -half), (half, half), (-half, half)]
    emit(f"{name}_case_side", "black", prism(outline, -0.03, 0.0052, cap=False), frame)
    emit(f"{name}_ring", "atlas", annulus(r * 0.86, r * 1.03, 0.0056, "adi_ring", 40), frame)
    square = []
    faces = []
    rim = 40
    for k in range(rim):
        a = k / rim * TAU
        square.append((math.cos(a) * r * 1.03, math.sin(a) * r * 1.03, 0.0052))
        limit = half / max(abs(math.cos(a)), abs(math.sin(a)))
        square.append((math.cos(a) * limit, math.sin(a) * limit, 0.0052))
    for k in range(rim):
        m = (k + 1) % rim
        faces.append((k * 2, k * 2 + 1, m * 2 + 1, m * 2))
    emit(f"{name}_face", "black", (square, faces, []), frame)
    emit(f"{name}_bezel", "knob", lathe([(r + 0.005, 0.005), (r + 0.005, 0.0074), (r + 0.003, 0.0086), (r * 1.01, 0.0078), (r * 1.01, 0.002)], 36), frame)
    attitude_ball(ball, surface, x, y, r)
    # Fixed aircraft symbol, roll index and flags in front of the ball.
    span = r * 0.62
    for side in (-1, 1):
        emit(f"{name}_wing", "yellow", box(min(side * span, side * r * 0.14), -r * 0.022, 0.0062, max(side * span, side * r * 0.14), r * 0.022, 0.0074), frame)
        emit(f"{name}_arm", "black", box(side * span - 0.0009, -r * 0.03, 0.0048, side * span + 0.0009, r * 0.03, 0.0062), frame)
        emit(f"{name}_strut", "black", box(min(side * r * 1.0, side * span), -0.0009, 0.0049, max(side * r * 1.0, side * span), 0.0009, 0.0062), frame)
    emit(f"{name}_dot", "yellow", lathe([(r * 0.05, 0.0062), (r * 0.05, 0.0076), (0.0, 0.0078)], 10), frame)
    emit(f"{name}_index", "white", prism([(0.0, r * 0.86), (r * 0.05, r * 0.72), (-r * 0.05, r * 0.72)], 0.0052, 0.0066), frame)
    emit(f"{name}_glass", "glass", disk(r * 1.01, 0.008, None, 28), frame)
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        fastener(f"{name}_screw", surface, x + sx * (half - 0.0046), y + sy * (half - 0.0046), 0.0048, r=0.0023)


def hsi(data, surface="main"):
    x, y, r = data["x"], data["y"], data["r"]
    housing("HSI", surface, x, y, r + 0.0095)
    frame = at(surface, x, y)
    emit("HSI_rim", "knob", lathe([(r + 0.0058, 0.0008), (r + 0.0058, 0.0074), (r + 0.003, 0.0086), (r + 0.0006, 0.0078), (r + 0.0006, 0.0014)], 36), frame)
    emit("HSI_back", "atlas", annulus(r * 0.82, r + 0.001, 0.0016, "hsi_ring", 40), frame)
    owner = node("HSI_card", frame)
    emit("HSI_card", "atlas", disk(r * 0.82, 0.0024, "hsi_card", 44), frame, owner)
    course = node("HSI_course", frame)
    emit("HSI_course", "orange", box(-0.00085, -r * 0.62, 0.0036, 0.00085, r * 0.62, 0.0042), frame, course)
    emit("HSI_arrow", "orange", prism([(0.0, r * 0.76), (-r * 0.075, r * 0.6), (r * 0.075, r * 0.6)], 0.0036, 0.0042), frame, course)
    emit("HSI_aircraft", "white", box(-r * 0.2, -0.0007, 0.0052, r * 0.2, 0.0007, 0.0058), frame)
    emit("HSI_aircraft_body", "white", box(-0.0007, -r * 0.16, 0.0052, 0.0007, r * 0.18, 0.0058), frame)
    emit("HSI_aircraft_tail", "white", box(-r * 0.08, -r * 0.16, 0.0052, r * 0.08, -r * 0.13, 0.0058), frame)
    emit("HSI_mount", "knob", lathe([(0.0034, 0.0014), (0.0034, 0.0052), (0.0, 0.0052)], 10), frame)
    emit("HSI_lubber", "white", prism([(0.0, r * 0.82), (-r * 0.04, r * 0.92), (r * 0.04, r * 0.92)], 0.0034, 0.0044), frame)
    emit("HSI_glass", "glass", disk(r + 0.001, 0.0078, None, 28), frame)
    for side in (-1, 1):
        emit("HSI_setknob", "knob", lathe([(0.006, 0.0008), (0.006, 0.0112), (0.0048, 0.0126), (0.0, 0.0126)], 12), at(surface, x + side * (r * 0.9), y - r * 0.92))


def clock(data, surface="main"):
    x, y, r = data["x"], data["y"], data["r"]
    housing("Case_clock", surface, x, y, r + 0.0075)
    frame = at(surface, x, y)
    emit("Rim_clock", "knob", lathe([(r + 0.0058, 0.0008), (r + 0.0058, 0.0066), (r + 0.0028, 0.0078), (r + 0.0006, 0.0072), (r + 0.0006, 0.0012)], 32), frame)
    emit("Dial_clock", "atlas", disk(r + 0.001, 0.0014, "dial_clock", 36), frame)
    dial_needle("Needle_clock_hour", surface, x, y, r, 0.52, width=0.0022, z=0.0044)
    dial_needle("Needle_clock_minute", surface, x, y, r, 0.78, width=0.0016, z=0.0052)
    dial_needle("Needle_clock_second", surface, x, y, r, 0.86, width=0.0007, z=0.0059, material="orange")
    emit("Glass_clock", "glass", disk(r + 0.001, 0.0072, None, 24), frame)
    emit("Clock_winder", "knob", lathe([(0.0042, 0.0), (0.0042, 0.0072), (0.0032, 0.0086), (0.0, 0.0086)], 10), at(surface, x - r * 0.84, y - r * 0.84, 0.0045))


def screen(name, surface, x, y, size, bezel, round_face=False, height=None, bezel_height=None):
    frame = at(surface, x, y)
    height = height or size
    bezel_height = bezel_height or bezel
    half, half_v, inner, inner_v = bezel / 2, bezel_height / 2, size / 2, height / 2
    z = 0.009
    emit(f"{name}_case", "black", box(-half, -half_v, -0.002, half, half_v, 0.0012, chamfer=0.0008), frame)
    # Sloped frame round the glass, as on the real tubes.
    outer_ring = [(-inner - 0.008, -inner_v - 0.008), (inner + 0.008, -inner_v - 0.008), (inner + 0.008, inner_v + 0.008), (-inner - 0.008, inner_v + 0.008)]
    glass = [(-inner, -inner_v), (inner, -inner_v), (inner, inner_v), (-inner, inner_v)]
    verts, faces = [], []
    for k in range(4):
        a0, a1, b0, b1 = outer_ring[k], outer_ring[(k + 1) % 4], glass[k], glass[(k + 1) % 4]
        n = len(verts)
        verts += [(a0[0], a0[1], z), (a1[0], a1[1], z), (b1[0], b1[1], 0.0034), (b0[0], b0[1], 0.0034)]
        faces.append((n, n + 1, n + 2, n + 3))
    emit(f"{name}_slope", "knob", (verts, faces, []), frame)
    for k in range(4):
        a0, a1 = outer_ring[k], outer_ring[(k + 1) % 4]
        n = [(a0[0], a0[1], 0.001), (a1[0], a1[1], 0.001), (a1[0], a1[1], z), (a0[0], a0[1], z)]
        emit(f"{name}_lip", "knob", (n, [(0, 1, 2, 3)], []), frame)
    if round_face:
        verts, faces = [], []
        rim = 44
        for k in range(rim):
            a = k / rim * TAU
            verts.append((math.cos(a) * inner * 0.96, math.sin(a) * inner * 0.96, 0.0037))
            limit = inner / max(abs(math.cos(a)), abs(math.sin(a)))
            verts.append((math.cos(a) * limit, math.sin(a) * limit, 0.0037))
        for k in range(rim):
            m = (k + 1) % rim
            faces.append((k * 2, k * 2 + 1, m * 2 + 1, m * 2))
        emit(f"{name}_mask", "knob", (verts, faces, []), frame)
    owner = node(f"Screen_{name}", frame)
    quad = ([(-inner, -inner_v, 0.0036), (inner, -inner_v, 0.0036), (inner, inner_v, 0.0036), (-inner, inner_v, 0.0036)], [(0, 1, 2, 3)], [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])
    emit(f"Screen_{name}", "screen", quad, frame, owner)
    emit(f"{name}_glass", "glass", ([(-inner, -inner_v, 0.0041), (inner, -inner_v, 0.0041), (inner, inner_v, 0.0041), (-inner, inner_v, 0.0041)], [(0, 1, 2, 3)], []), frame)
    for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        fastener(f"{name}_screw", surface, x + sx * (half - 0.0052), y + sy * (half_v - 0.0052), 0.0012, r=0.0024)


def display_keys(surface, x, y, screen_size, bezel):
    """Bezel keys round a display, five to a side."""
    frame = at(surface, x, y)
    half = bezel / 2 - 0.0085
    spacing = screen_size / 5
    for k in range(5):
        offset = (k - 2) * spacing
        for px, py in ((offset, half), (offset, -half), (-half, offset), (half, offset)):
            emit("MPCD_key", "knob", box(px - 0.0056, py - 0.0056, 0.0008, px + 0.0056, py + 0.0056, 0.0042, chamfer=0.0009), frame)
            emit("MPCD_key_mark", "white", box(px - 0.0028, py - 0.0007, 0.0041, px + 0.0028, py + 0.0007, 0.0045), frame)


# ---- Panels ----
def inside(outline, x, y):
    hit = False
    for (x0, y0), (x1, y1) in zip(outline, outline[1:] + outline[:1]):
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            hit = not hit
    return hit


def main_panel(surface="main", outline=None, balls=(), fasteners=(), edge_y=None):
    outline = outline or MOD.PANEL_OUTLINE
    uv = surface_uv(surface)
    step = 0.024
    low_x, high_x = min(p[0] for p in outline), max(p[0] for p in outline)
    low_y, high_y = min(p[1] for p in outline), max(p[1] for p in outline)
    xs = sorted({p[0] for p in outline} | {round(low_x + i * step, 5) for i in range(int((high_x - low_x) / step) + 1)})
    ys = sorted({p[1] for p in outline} | {round(low_y + i * step, 5) for i in range(int((high_y - low_y) / step) + 1)})
    index, verts, faces, uvs = {}, [], [], []
    # Windows for the attitude balls, which sit behind the panel face.
    holes = [(d["x"], d["y"], d["r"] + 0.007) for d in balls]
    xs = sorted(set(xs) | {h[0] + side * h[2] for h in holes for side in (-1, 1)})
    ys = sorted(set(ys) | {h[1] + side * h[2] for h in holes for side in (-1, 1)})

    def vert(x, y):
        key = (x, y)
        if key not in index:
            index[key] = len(verts)
            verts.append((x, y, 0.0))
            uvs.append(uv(x, y))
        return index[key]

    for y0, y1 in zip(ys, ys[1:]):
        for x0, x1 in zip(xs, xs[1:]):
            mx, my = (x0 + x1) / 2, (y0 + y1) / 2
            if inside(outline, mx, my) and not any(abs(mx - h[0]) < h[2] and abs(my - h[1]) < h[2] for h in holes):
                faces.append((vert(x0, y0), vert(x1, y0), vert(x1, y1), vert(x0, y1)))
    frame = FRAMES[surface]
    emit("Panel_face", "atlas", (verts, faces, uvs), frame)
    # Back edge so the panel has thickness when seen past the knee wells.
    edges = [(a, b) for a, b in zip(outline, outline[1:] + outline[:1])]
    side_verts, side_faces = [], []
    for (x0, y0), (x1, y1) in edges:
        n = len(side_verts)
        side_verts += [(x1, y1, 0.0), (x0, y0, 0.0), (x0, y0, -0.03), (x1, y1, -0.03)]
        side_faces.append((n, n + 1, n + 2, n + 3))
    emit("Panel_edge", "paint", (side_verts, side_faces, []), frame)
    for x, y in fasteners:
        fastener("Panel_fastener", surface, x, y, 0.0, r=0.0029)


def printed(surface):
    """Panels that face away from the daylight are backlit, or they could never be read."""
    return "atlas_lit" if surface.split("@")[0] in getattr(MOD, "BACKLIT", ()) else "atlas"


def plate(entry, suffix=""):
    surface = entry["surface"] + suffix
    uv = surface_uv(surface)
    x0, y0, x1, y1 = entry["x0"], entry["y0"], entry["x1"], entry["y1"]
    frame = FRAMES[surface]
    emit(f"Plate_{entry['id']}", printed(surface), rectangle(x0, y0, x1, y1, PLATE_Z, uv, step=0.03), frame)
    verts, faces = [], []
    corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    for k in range(4):
        a, b = corners[k], corners[(k + 1) % 4]
        n = len(verts)
        verts += [(a[0], a[1], -0.001), (b[0], b[1], -0.001), (b[0], b[1], PLATE_Z), (a[0], a[1], PLATE_Z)]
        faces.append((n, n + 1, n + 2, n + 3))
    emit(f"Plate_{entry['id']}_edge", "black", (verts, faces, []), frame)
    for cx, cy in corners:
        fastener(f"Plate_{entry['id']}_screw", surface, cx + (0.0042 if cx == x0 else -0.0042), cy + (0.0042 if cy == y0 else -0.0042), PLATE_Z, r=0.0022)
    for index, control in enumerate(entry["controls"]):
        BUILDERS[control["kind"]](f"{entry['id']}_{control['kind']}_{index}", surface, control, PLATE_Z)


def gauges(suffix=""):
    for name, scale, x, y, r, surface in MOD.GAUGES:
        gauge(name, scale, surface + suffix, x, y, r)


def readout(name, surface, x, y, w, h):
    """A long display set into a plate, such as an up-front control."""
    frame = at(surface, x, y, PLATE_Z)
    half_w, half_h = w / 2, h / 2
    emit(f"{name}_frame", "knob", box(-half_w - 0.0045, -half_h - 0.0045, -0.001, half_w + 0.0045, half_h + 0.0045, 0.0032, chamfer=0.001), frame)
    owner = node(f"Screen_{name}", frame)
    emit(f"Screen_{name}", "screen", ([(-half_w, -half_h, 0.0033), (half_w, -half_h, 0.0033), (half_w, half_h, 0.0033), (-half_w, half_h, 0.0033)], [(0, 1, 2, 3)], [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]), frame, owner)


# ---- Tub, consoles and floor ----
def arch_section(half, top, bottom, exponent, y, z_cut, count=30, shrink=0.006):
    """Lower run of a superellipse hull from one sill, under the floor, to the other."""
    centre = (top + bottom) / 2
    height = (top - bottom) / 2
    half -= shrink
    height -= shrink
    ratio = (z_cut - centre) / height
    sine = math.copysign(abs(ratio) ** (exponent / 2), ratio)
    start = math.asin(max(-1.0, min(1.0, sine)))
    first, last = math.pi - start, TAU + start
    points = []
    for k in range(count + 1):
        a = first + (last - first) * k / count
        c, s = math.cos(a), math.sin(a)
        points.append((half * math.copysign(abs(c) ** (2 / exponent), c), y, centre + height * math.copysign(abs(s) ** (2 / exponent), s)))
    return points


def lerp_rows(rows, y):
    """Reads a table of (y, values...) running from the nose aft."""
    for a, b in zip(rows, rows[1:]):
        if a[0] >= y >= b[0]:
            t = (a[0] - y) / (a[0] - b[0])
            return tuple(a[i] + (b[i] - a[i]) * t for i in range(1, len(a)))
    return rows[0][1:] if y > rows[0][0] else rows[-1][1:]


def hull_half(rows, sill, y, shrink=0.006):
    half, top, bottom, exponent = lerp_rows(rows, y)
    centre, height = (top + bottom) / 2, (top - bottom) / 2 - shrink
    ratio = min(0.999, abs((sill - centre) / height))
    return (half - shrink) * (1 - ratio ** exponent) ** (1 / exponent)


def tub(rows, sill, ys):
    emit("Tub", "paint_dark", loft([arch_section(*lerp_rows(rows, y)[:4], y, sill) for y in ys]))


def sill_rails(rows, sill, y0, y1, count=14):
    for side in (-1, 1):
        def run(inner, outer, low, high, material, name):
            sections = []
            for k in range(13):
                y = y0 + (y1 - y0) * k / 12
                h = hull_half(rows, sill, y)
                a, b = side * (h + inner), side * (h + outer)
                if side < 0:
                    a, b = b, a
                sections.append([(a, y, low), (b, y, low), (b, y, high), (a, y, high)])
            emit(name, material, loft(sections, closed=True, reverse=True))

        run(-0.03, 0.006, sill - 0.012, sill + 0.012, "black", f"Sill_{side}")
        run(-0.032, -0.022, sill + 0.008, sill + 0.02, "rubber", f"Sill_seal_{side}")
        for k in range(count):
            y = y0 + (k + 0.6) / count * (y1 - y0)
            frame = Matrix.Translation((side * (hull_half(rows, sill, y) - 0.012), y, sill + 0.012))
            emit("Sill_fastener", "metal_dark", lathe([(0.0034, -0.001), (0.0034, 0.0008), (0.0024, 0.0013), (0.0, 0.0013)], 8), frame)


def ceiling(rows, cut, ys, material="liner", count=24, shrink=0.05):
    """Upper run of the hull from one side over the top to the other, above the windows."""
    sections = []
    for y in ys:
        half, top, bottom, exponent = lerp_rows(rows, y)
        centre, height = (top + bottom) / 2, (top - bottom) / 2 - shrink
        half -= shrink
        ratio = (cut - centre) / height
        start = math.asin(max(-1.0, min(1.0, math.copysign(abs(ratio) ** (exponent / 2), ratio))))
        ring = []
        for k in range(count + 1):
            a = start + (math.pi - 2 * start) * k / count
            c, s = math.cos(a), math.sin(a)
            ring.append((half * math.copysign(abs(c) ** (2 / exponent), c), y, centre + height * math.copysign(abs(s) ** (2 / exponent), s)))
        sections.append(ring)
    emit("Ceiling", material, loft(sections, reverse=False))


def yoke(side, x, y, floor_z, height):
    """A control column rocking from the floor with a wheel turning on top."""
    base = Matrix.Translation((x, y, floor_z))
    emit("Yoke_base", "metal_dark", box(-0.05, -0.07, 0.0, 0.05, 0.07, 0.03, chamfer=0.006), base)
    emit("Yoke_boot", "rubber", lathe([(0.04, 0.028), (0.036, 0.05), (0.029, 0.07), (0.033, 0.09), (0.024, 0.11), (0.018, 0.13)], 16), base)
    owner = node(f"Yoke_{side}", base)
    aft = -0.09
    column = [(0.0, 0.0, 0.02), (0.0, aft * 0.3, height * 0.35), (0.0, aft * 0.7, height * 0.75), (0.0, aft, height)]
    emit("Yoke_column", "metal", tube(column, 0.019, 12), base, owner)
    emit("Yoke_collar", "metal_dark", transform(lathe([(0.027, 0.0), (0.027, 0.024), (0.02, 0.03), (0.0, 0.03)], 14), Matrix.Translation((0, aft, height - 0.03))), base, owner)
    head = base @ Matrix.Translation((0.0, aft - 0.004, height))
    wheel = node(f"Yoke_{side}_wheel", head, parent=owner)
    emit("Yoke_hub", "knob", box(-0.07, -0.022, -0.028, 0.07, 0.012, 0.03, chamfer=0.008), head, wheel)
    for sign in (-1, 1):
        horn = []
        for k in range(9):
            a = k / 8 * math.pi
            horn.append((sign * (0.07 + 0.052 * math.sin(a * 0.6)), -0.008, -0.022 + 0.11 * k / 8 + 0.016 * math.sin(a)))
        emit("Yoke_horn", "rubber", tube(horn, 0.0165, 10), head, wheel)
        emit("Yoke_horn_cap", "knob", transform(lathe([(0.0165, 0.0), (0.0165, 0.012), (0.009, 0.019), (0.0, 0.02)], 10), Matrix.Translation(horn[-1])), head, wheel)
        emit("Yoke_trim", "metal", transform(box(-0.008, -0.004, -0.005, 0.008, 0.0, 0.005, chamfer=0.0012), Matrix.Translation((sign * 0.098, -0.024, 0.044))), head, wheel)
        emit("Yoke_ptt", "red", transform(lathe([(0.0052, 0.0), (0.0052, 0.003), (0.0, 0.0045)], 8), Matrix.Translation((sign * 0.112, -0.02, 0.02)) @ Matrix.Rotation(math.pi / 2, 4, "X")), head, wheel)
    emit("Yoke_chart", "white", box(-0.042, -0.0235, -0.012, 0.042, -0.02, 0.022), head, wheel)
    emit("Yoke_badge", "metal", box(-0.03, -0.0245, -0.024, 0.03, -0.021, -0.016), head, wheel)


def crew_seat(x, y, floor_z, cushion):
    """Airliner-style crew seat beside a centre pedestal: track, column, leather cushions, arm rests clear of the side shelf and a five-point harness."""
    for rail in (x - 0.14, x + 0.14):
        emit("Seat_track", "metal_dark", box(rail - 0.012, y - 0.32, floor_z, rail + 0.012, y + 0.3, floor_z + 0.022, chamfer=0.003))
    emit("Seat_column", "metal_dark", box(x - 0.15, y - 0.2, floor_z + 0.018, x + 0.15, y + 0.16, cushion - 0.07, chamfer=0.012))
    emit("Seat_shroud", "black", box(x - 0.1, y - 0.14, floor_z + 0.02, x + 0.1, y + 0.17, cushion - 0.06, chamfer=0.01))
    rings = []
    for offset, half, z0, z1 in [(0.26, 0.143, -0.07, -0.02), (0.245, 0.168, -0.075, 0.012), (0.2, 0.181, -0.08, 0.03), (0.0, 0.189, -0.08, 0.036), (-0.17, 0.185, -0.08, 0.02), (-0.21, 0.168, -0.08, 0.0)]:
        ring = []
        for k in range(20):
            a = k / 20 * TAU
            c, s = math.cos(a), math.sin(a)
            ring.append((x + half * math.copysign(abs(c) ** 0.55, c), y + offset, cushion + (z0 + z1) / 2 + (z1 - z0) / 2 * math.copysign(abs(s) ** 0.75, s)))
        rings.append(ring)
    emit("Seat_pan", "cushion", loft(rings, closed=True, reverse=True))
    for offset in (-0.09, 0.0, 0.09):
        emit("Seat_pan_seam", "fabric", box(x + offset - 0.002, y - 0.17, cushion + 0.018, x + offset + 0.002, y + 0.22, cushion + 0.038))
    back = Matrix.Translation((x, y - 0.21, cushion)) @ Matrix.Rotation(math.radians(13), 4, "X")
    emit("Seat_back_shell", "black", box(-0.215, -0.07, 0.06, 0.215, -0.02, 0.62, chamfer=0.022), back)
    emit("Seat_back_pad", "cushion", box(-0.2, -0.025, 0.06, 0.2, 0.038, 0.6, chamfer=0.024), back)
    for z in (0.17, 0.31, 0.45):
        emit("Seat_back_seam", "fabric", box(-0.2, 0.036, z, 0.2, 0.041, z + 0.005), back)
    for sign in (-1, 1):
        emit("Seat_bolster", "cushion", box(sign * 0.19 - 0.03, -0.03, 0.07, sign * 0.19 + 0.03, 0.05, 0.56, chamfer=0.02), back)
    emit("Seat_headrest_post", "metal", box(-0.05, -0.04, 0.6, 0.05, -0.02, 0.69), back)
    emit("Seat_headrest", "cushion", box(-0.115, -0.05, 0.66, 0.115, 0.045, 0.83, chamfer=0.03), back)
    for sign in (-1, 1):
        rest = Matrix.Translation((x + sign * 0.245, y - 0.21, cushion + 0.177))
        # The arm rest beside the pedestal is stowed up along the seat back, clear of the arm reaching for the levers.
        if sign * x < 0:
            rest = rest @ Matrix.Rotation(math.radians(103), 4, "X")
        emit("Seat_arm", "cushion", box(-0.03, 0.0, -0.022, 0.03, 0.34, 0.02, chamfer=0.012), rest)
        emit("Seat_arm_pivot", "metal", box(-0.038, -0.035, -0.035, 0.038, 0.015, 0.03, chamfer=0.006), rest)
        shoulder = [(x + sign * 0.085, y - 0.3, cushion + 0.6), (x + sign * 0.09, y - 0.2, cushion + 0.52), (x + sign * 0.075, y - 0.03, cushion + 0.27), (x + sign * 0.022, y + 0.09, cushion + 0.09)]
        emit("Harness_shoulder", "webbing", strap(shoulder, 0.046, 0.003, (1.0, 0.0, 0.0)))
        lap = [(x + sign * 0.175, y - 0.15, cushion + 0.02), (x + sign * 0.14, y - 0.02, cushion + 0.07), (x + sign * 0.04, y + 0.09, cushion + 0.09)]
        emit("Harness_lap", "webbing", strap(lap, 0.042, 0.003))
        emit("Harness_fitting", "metal", box(x + sign * 0.08 - 0.02, y - 0.09, cushion + 0.33, x + sign * 0.08 + 0.02, y - 0.05, cushion + 0.36, chamfer=0.004))
    crotch = [(x, y + 0.2, cushion + 0.03), (x, y + 0.14, cushion + 0.06), (x, y + 0.09, cushion + 0.09)]
    emit("Harness_crotch", "webbing", strap(crotch, 0.04, 0.003, (1.0, 0.0, 0.0)))
    emit("Harness_buckle", "metal", lathe([(0.034, -0.006), (0.034, 0.006), (0.022, 0.012), (0.0, 0.012)], 18), Matrix.Translation((x, y + 0.095, cushion + 0.09)) @ Matrix.Rotation(-math.pi / 2, 4, "X"))


def glazing_outline(path, name, scale):
    """Reads a window's outline from the flight model, in real metres and in order round the edge."""
    import struct

    with open(ROOT / path, "rb") as handle:
        handle.read(12)
        size, _ = struct.unpack("<II", handle.read(8))
        doc = json.loads(handle.read(size))
        size, _ = struct.unpack("<II", handle.read(8))
        blob = handle.read(size)
    nodes = doc["nodes"]
    parents = {child: i for i, n in enumerate(nodes) for child in n.get("children", [])}
    index = next(i for i, n in enumerate(nodes) if n.get("name") == name)
    matrix, cursor = Matrix.Identity(4), index
    while cursor is not None:
        n = nodes[cursor]
        r, size3 = n.get("rotation", (0, 0, 0, 1)), n.get("scale", (1, 1, 1))
        local = Matrix.Translation(n.get("translation", (0, 0, 0))) @ Quaternion((r[3], r[0], r[1], r[2])).to_matrix().to_4x4() @ Matrix.Diagonal((*size3, 1.0))
        matrix, cursor = local @ matrix, parents.get(cursor)
    primitive = doc["meshes"][nodes[index]["mesh"]]["primitives"][0]

    def read(accessor_index, width, formats):
        accessor = doc["accessors"][accessor_index]
        view = doc["bufferViews"][accessor["bufferView"]]
        code = formats[accessor["componentType"]]
        start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        stride = view.get("byteStride", struct.calcsize("<" + code * width))
        return [struct.unpack_from("<" + code * width, blob, start + k * stride) for k in range(accessor["count"])]

    raw = read(primitive["attributes"]["POSITION"], 3, {5126: "f"})
    points = []
    for x, y, z in raw:
        p = matrix @ Vector((x, y, z))
        points.append(Vector((scale * p.x, -scale * p.z, scale * p.y)))
    if "indices" in primitive:
        # Weld seams, then keep the edges used by one triangle: the glass's own boundary.
        weld = {}
        key = [weld.setdefault(tuple(round(c, 5) for c in p), len(weld)) for p in points]
        where = {key[k]: points[k] for k in range(len(points))}
        flat = [i for (i,) in read(primitive["indices"], 1, {5121: "B", 5123: "H", 5125: "I"})]
        uses = defaultdict(int)
        for t in range(0, len(flat) - 2, 3):
            a, b, c = key[flat[t]], key[flat[t + 1]], key[flat[t + 2]]
            for edge in ((a, b), (b, c), (c, a)):
                uses[tuple(sorted(edge))] += 1
        boundary = [edge for edge, count in uses.items() if count == 1]
        if boundary:
            return [where[v] for v in sorted({v for edge in boundary for v in edge})]
    centre = sum(points, Vector()) / len(points)
    reach = sum((p - centre).length for p in points) / len(points)
    # A glazing fan has a few inner vertices; the edge is what remains.
    return [p for p in points if (p - centre).length > 0.72 * reach]


def _surface(rows, y, angle, shrink):
    half, top, bottom, exponent = lerp_rows(rows, y)
    centre, height = (top + bottom) / 2, (top - bottom) / 2 - shrink
    half -= shrink
    c, s = math.cos(angle), math.sin(angle)
    return (half * math.copysign(abs(c) ** (2 / exponent), c), y, centre + height * math.copysign(abs(s) ** (2 / exponent), s))


def _angle(rows, point):
    half, top, bottom, exponent = lerp_rows(rows, point.y)
    centre, height = (top + bottom) / 2, (top - bottom) / 2
    x, z = point.x / half, (point.z - centre) / height
    angle = math.atan2(math.copysign(abs(z) ** (exponent / 2), z), math.copysign(abs(x) ** (exponent / 2), x))
    # Run on past pi down the left side, so a window straddling mid-height does not wrap round.
    return angle + 2 * math.pi if angle < -math.pi / 2 else angle


def window_param(rows, outline):
    """An outline in hull coordinates (distance along the hull, angle round it), in order."""
    params = [(p.y, _angle(rows, p)) for p in outline]
    my, ma = sum(q[0] for q in params) / len(params), sum(q[1] for q in params) / len(params)
    return sorted(params, key=lambda q: math.atan2(q[1] - ma, q[0] - my)), (my, ma)


def _inside(polygon, y, a):
    hit = False
    for (y0, a0), (y1, a1) in zip(polygon, polygon[1:] + polygon[:1]):
        if (a0 > a) != (a1 > a) and y < (y1 - y0) * (a - a0) / (a1 - a0) + y0:
            hit = not hit
    return hit


def windowed_liner(rows, cut, ys, windows, material="liner", steps=120, shrink=0.012, name="Liner"):
    """A skin following the hull from one side over the top to the other, open at each window."""
    half, top, bottom, exponent = lerp_rows(rows, ys[0])
    verts, faces, index = [], [], {}
    def angle_limits(y):
        half, top, bottom, exponent = lerp_rows(rows, y)
        ratio = (cut - (top + bottom) / 2) / ((top - bottom) / 2 - shrink)
        start = math.asin(max(-1.0, min(1.0, math.copysign(abs(ratio) ** (exponent / 2), ratio))))
        return start, math.pi - start

    def vertex(i, j):
        if (i, j) not in index:
            y = ys[i]
            low, high = angle_limits(y)
            index[(i, j)] = len(verts)
            verts.append(_surface(rows, y, low + (high - low) * j / steps, shrink))
        return index[(i, j)]

    polygons = [window_param(rows, outline)[0] for outline in windows]
    for i in range(len(ys) - 1):
        for j in range(steps):
            # A cell touching a window is left out; the frame covers the stepped edge this leaves.
            low0, high0 = angle_limits(ys[i])
            low1, high1 = angle_limits(ys[i + 1])
            corners = [(ys[i], low0 + (high0 - low0) * (j + u) / steps) for u in (0, 1)] + [(ys[i + 1], low1 + (high1 - low1) * (j + u) / steps) for u in (0, 1)]
            if any(_inside(polygon, y, a) for polygon in polygons for y, a in corners):
                continue
            faces.append((vertex(i, j), vertex(i, j + 1), vertex(i + 1, j + 1), vertex(i + 1, j)))
    emit(name, material, (verts, faces, []))


def window_frame(rows, outline, seal=0.009, trim=0.034, material="cover"):
    """A rubber seal and a trim band round a window, covering the stepped edge of the liner."""
    polygon, (my, ma) = window_param(rows, outline)

    def ring(grow, inward):
        points = []
        for y, a in polygon:
            dy, da = y - my, (a - ma) * lerp_rows(rows, y)[0]
            length = max(1e-4, math.hypot(dy, da))
            point = _surface(rows, y + dy / length * grow, a + da / length * grow / lerp_rows(rows, y)[0], 0.012 + inward)
            points.append(point)
        return points

    emit("Window_seal", "rubber", loft([ring(-0.002, 0.0), ring(seal, 0.008)], closed=True))
    emit("Window_trim", material, loft([ring(seal, 0.008), ring(trim, 0.004)], closed=True))


def console(surface, inner, outer, back, front, top, floor_z):
    """A side console: printed top, inner wall to the floor and a rear cap."""
    side = -1 if inner < 0 else 1
    uv = surface_uv(surface)
    frame = FRAMES[surface]
    centre = frame.translation.y
    area = ATLAS["surfaces"][surface.split("@")[0]]
    x0, x1 = min(inner, outer), max(inner, outer)

    def clipped(x, y):
        return uv(min(area["x1"] - 0.004, max(area["x0"] + 0.004, x)), min(area["y1"] - 0.005, max(area["y0"] + 0.005, y)))

    emit(f"Console_top_{surface}", "atlas", rectangle(x0, back - centre, x1, front - centre, 0.0, clipped, step=0.04), frame)
    wall = [(inner, back, floor_z), (inner, front, floor_z), (inner, front, top), (inner, back, top)]
    emit(f"Console_wall_{surface}", "paint_dark", (wall, [(0, 1, 2, 3) if side > 0 else (3, 2, 1, 0)], []))
    emit(f"Console_lip_{surface}", "black", box(min(inner, inner + side * 0.008), back, top - 0.012, max(inner, inner + side * 0.008), front, top + 0.0015, chamfer=0.001))
    rear = [(inner, back, floor_z), (outer, back, floor_z), (outer, back, top), (inner, back, top)]
    emit(f"Console_rear_{surface}", "paint_dark", (rear, [(0, 1, 2, 3) if side < 0 else (3, 2, 1, 0)], []))
    length = front - back
    for k in range(5):
        y = back + 0.19 + k * (length - 0.3) / 5
        emit(f"Console_rib_{surface}", "paint", box(min(inner, inner - side * 0.006), y, floor_z + 0.045, max(inner, inner - side * 0.006), y + 0.015, top - 0.03))
    for k in range(9):
        y = back + 0.03 + k * (length - 0.06) / 8
        fr = Matrix.Translation((inner, y, top - 0.009)) @ Matrix.Rotation(-side * math.pi / 2, 4, "Y")
        emit(f"Console_rivet_{surface}", "metal_dark", lathe([(0.0022, -0.0008), (0.0022, 0.0008), (0.0, 0.0012)], 6), fr)


def wall_details(rows, sill, back, front, top, count=7):
    """Formers, stringers and clipped wiring on the walls above the consoles."""
    for side in (-1, 1):
        spacing = (front - back) / max(1, count)
        wall = lambda y: side * (hull_half(rows, sill, y) - 0.004)
        for k in range(count):
            y = back + 0.01 + k * spacing
            x = wall(y)
            emit("Former", "paint", box(min(x, x - side * 0.03), y, top - 0.01, max(x, x - side * 0.03), y + 0.018, sill - 0.006, chamfer=0.002))
            for z in (top + 0.07, top + 0.15, top + 0.23, top + 0.3):
                if z < sill - 0.02:
                    fr = Matrix.Translation((x - side * 0.03, y + 0.009, z)) @ Matrix.Rotation(side * math.pi / 2, 4, "Y") @ Matrix.Rotation(math.pi, 4, "X")
                    emit("Former_rivet", "metal_dark", lathe([(0.0028, -0.001), (0.0028, 0.0008), (0.0, 0.0014)], 6), fr)
        runs = 12
        emit("Stringer", "paint", loft([[(wall(y), y, top + 0.17), (wall(y) - side * 0.012, y, top + 0.17), (wall(y) - side * 0.012, y, top + 0.186), (wall(y), y, top + 0.186)] for y in [back + (front - back) * j / runs for j in range(runs + 1)]], closed=True))
        for offset, material, radius in ((0.0, "wire", 0.0058), (0.011, "wire_white", 0.0034), (-0.01, "wire", 0.0036)):
            path = [(wall(back + (front - back) * j / 10) - side * 0.024, back + (front - back) * j / 10, top + 0.1 + offset + 0.012 * math.sin(j * 1.7)) for j in range(11)]
            emit("Wiring", material, tube(path, radius, 6))
        for k in range(6):
            y = back + 0.05 + k * (front - back - 0.1) / 5
            j = (y - back) / (front - back) * 10
            z = top + 0.1 + 0.012 * math.sin(j * 1.7)
            x = wall(y)
            emit("Wire_clamp", "metal_dark", box(min(x + side * 0.004, x - side * 0.036), y - 0.005, z - 0.018, max(x + side * 0.004, x - side * 0.036), y + 0.005, z + 0.018, chamfer=0.001))


def wall_frame(x, y, z, side):
    """Local Z points in off a side wall, local Y up it."""
    return Matrix.Translation((x, y, z)) @ Matrix(((0, 0, -side, 0), (side, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def jettison_handle(x, y, z, side=-1):
    frame = wall_frame(x, y, z, side)
    emit("Jettison_mount", "black", box(-0.06, -0.03, -0.012, 0.06, 0.03, 0.012, chamfer=0.003), frame)
    emit("Jettison_shaft", "metal", lathe([(0.0034, 0.012), (0.0034, 0.04), (0.0, 0.04)], 8), frame)
    grip = box(-0.034, -0.012, 0.036, 0.034, 0.012, 0.05, chamfer=0.003)
    uvs = [uv_rect("stripes", (v[0] + 0.034) / 0.068, (v[1] + 0.012) / 0.024) for v in grip[0]]
    emit("Jettison_grip", "atlas", (grip[0], grip[1], uvs), frame)
    plaque = rectangle(-0.048, -0.028, -0.002, -0.012, 0.0125, lambda a, b: uv_rect("placard", (a + 0.048) / 0.046, (b + 0.028) / 0.016), step=1.0)
    emit("Jettison_placard", "atlas", plaque, frame)


def map_case(x, y, z, side=1):
    frame = wall_frame(x, y, z, side)
    emit("Map_case", "cover", box(-0.16, -0.09, -0.006, 0.16, 0.09, 0.03, chamfer=0.006), frame)
    emit("Map_case_flap", "cushion", box(0.02, -0.086, 0.028, 0.155, 0.086, 0.034, chamfer=0.002), frame)
    for sy in (-1, 1):
        emit("Map_case_snap", "metal", lathe([(0.0042, 0.03), (0.0042, 0.036), (0.0, 0.0375)], 8), frame @ Matrix.Translation((0.03, sy * 0.05, 0)))


def breaker_panel(x, y, z, side=1, columns=8, rows=4):
    frame = wall_frame(x, y, z, side)
    emit("Breaker_panel", "black", box(-0.14, -0.06, -0.006, 0.14, 0.06, 0.006, chamfer=0.002), frame)
    for i in range(columns):
        for j in range(rows):
            fr = frame @ Matrix.Translation((-0.115 + i * 0.033, -0.042 + j * 0.028, 0.006))
            emit("Breaker", "white" if (i + j) % 5 == 0 else "knob", lathe([(0.0042, -0.0008), (0.0042, 0.003), (0.0028, 0.0052), (0.0, 0.0056)], 8), fr)


def floor(z, back, front, half):
    emit("Floor", "paint_dark", rectangle(-half, back, half, front, z, step=0.08))
    count = int((front - back - 0.04) / 0.27)
    for k in range(count):
        y = back + 0.04 + k * 0.27
        emit("Floor_plate", "black", box(-half + 0.007, y, z - 0.001, half - 0.007, y + 0.24, z + 0.003, chamfer=0.0012))
        for sx in (-half + 0.017, half - 0.017):
            for sy in (y + 0.012, y + 0.228):
                emit("Floor_fastener", "metal_dark", lathe([(0.0034, 0.0025), (0.0034, 0.0045), (0.0, 0.005)], 8), Matrix.Translation((sx, sy, z)))
        columns = max(1, int((2 * half - 0.07) / 0.042))
        for i in range(columns):
            for j in range(5):
                x = -half + 0.035 + i * 0.042
                emit("Tread", "rubber", box(x, y + 0.02 + j * 0.044, z + 0.0026, x + 0.02, y + 0.05 + j * 0.044, z + 0.0048))


def knee_well(z, top, wall_y, half, pedestal_half, pedestal_front, pedestal_top, wiring=True):
    """Back wall of the knee wells, the pedestal between them and the bundled wiring inside."""
    emit("Knee_wall", "paint_dark", ([(-half, wall_y, z), (half, wall_y, z), (half, wall_y, top), (-half, wall_y, top)], [(3, 2, 1, 0)], []))
    emit("Pedestal", "paint", box(-pedestal_half, pedestal_front, z, pedestal_half, wall_y + 0.02, pedestal_top, chamfer=0.004))
    for k in range(4):
        fr = Matrix.Translation(((-0.09 + k * 0.06) * pedestal_half / 0.125, pedestal_front - 0.003, z + 0.075))
        emit("Pedestal_duct", "metal_dark", lathe([(0.012, -0.008), (0.012, 0.0), (0.0, 0.002)], 12), fr @ Matrix.Rotation(math.pi / 2, 4, "X"))
    if wiring:
        for side in (-1, 1):
            for k in range(3):
                path = [(side * (pedestal_half + 0.022 + k * 0.03), wall_y, z + 0.085 - k * 0.022), (side * (pedestal_half + 0.042 + k * 0.03), wall_y - 0.03, z + 0.155), (side * (pedestal_half + 0.082 + k * 0.012), wall_y - 0.01, z + 0.225)]
                emit("Well_wiring", "wire", tube(path, 0.0052, 6))


def pedals(x, y, z, rail_back=-0.16, rail_front=0.14):
    """A rudder pedal pair either side of the centreline."""
    for side in (-1, 1):
        px = side * x
        for rail in (px - 0.035, px + 0.035):
            emit("Pedal_rail", "metal_dark", box(rail - 0.006, y + rail_back, z, rail + 0.006, y + rail_front, z + 0.014, chamfer=0.002))
        frame = Matrix.Translation((px, y, z + 0.02))
        owner = node(f"Pedal_{'left' if side < 0 else 'right'}", frame)
        tilt_back = Matrix.Rotation(math.radians(-22), 4, "X")
        emit("Pedal_arm", "metal_dark", transform(box(-0.008, -0.01, -0.012, 0.008, 0.01, 0.17, chamfer=0.003), tilt_back), frame, owner)
        emit("Pedal_carriage", "metal_dark", box(-0.042, -0.04, -0.014, 0.042, 0.04, 0.012, chamfer=0.003), frame, owner)
        emit("Pedal_face", "metal", transform(box(-0.05, -0.012, 0.03, 0.05, 0.002, 0.2, chamfer=0.006), tilt_back), frame, owner)
        for j in range(7):
            emit("Pedal_tread", "rubber", transform(box(-0.044, -0.015, 0.045 + j * 0.022, 0.044, -0.011, 0.056 + j * 0.022), tilt_back), frame, owner)
        emit("Pedal_strap", "webbing", transform(box(-0.046, -0.04, 0.13, 0.046, -0.012, 0.142, chamfer=0.002), tilt_back), frame, owner)


def stick(base_y, z, name="Stick"):
    """Centre stick; the grip stands above a seated pilot's thighs (palm 0.56 above the pivot, see measure-pilot-seats.ts)."""
    frame = Matrix.Translation((0.0, base_y, z))
    emit("Stick_base", "metal_dark", box(-0.075, -0.09, 0.0, 0.075, 0.09, 0.022, chamfer=0.006), frame)
    for sx in (-0.062, 0.062):
        for sy in (-0.078, 0.078):
            emit("Stick_bolt", "metal", lathe([(0.0045, 0.021), (0.0045, 0.026), (0.0, 0.0275)], 6), frame @ Matrix.Translation((sx, sy, 0)))
    pivot = Matrix.Translation((0.0, base_y, z + 0.06))
    boot_rings = [(0.052, 0.022), (0.05, 0.03)] + [(0.04 - k * 0.0028 + (0.0035 if k % 2 else -0.0015), 0.038 + k * 0.012) for k in range(8)] + [(0.02, 0.135)]
    emit("Stick_boot", "rubber", lathe(boot_rings, 20), frame)
    owner = node(name, pivot)
    shaft = [(0.0, 0.0, 0.0), (0.0, -0.012, 0.11), (0.0, -0.03, 0.30), (0.0, -0.04, 0.54)]
    emit("Stick_shaft", "metal_dark", tube(shaft, 0.0125, 10), pivot, owner)
    emit("Stick_collar", "metal", transform(lathe([(0.0175, 0.0), (0.0175, 0.016), (0.014, 0.022), (0.0, 0.022)], 14), Matrix.Translation((0, -0.034, 0.46))), pivot, owner)
    grip(pivot, owner, 0.47, -0.036)
    for k in range(3):
        emit("Stick_cable", "wire", tube([(-0.008 + k * 0.008, -0.03, 0.46), (-0.012 + k * 0.012, -0.025, 0.25), (-0.015 + k * 0.015, -0.012, 0.07)], 0.0024, 5), pivot, owner)


def grip(pivot, owner, bottom, aft):
    """Contoured pistol grip with trigger, pickle, trim hat and castle switch."""
    raised = Matrix.Translation((0.0, aft + 0.036, bottom - 0.35))
    sections = []
    stations = [(0.35, 0.021, 0.026, 0.0), (0.385, 0.023, 0.03, -0.003), (0.42, 0.022, 0.032, -0.006), (0.455, 0.0205, 0.031, -0.004), (0.49, 0.0205, 0.03, 0.0), (0.52, 0.022, 0.031, 0.005), (0.545, 0.0225, 0.031, 0.012), (0.558, 0.017, 0.024, 0.015), (0.564, 0.006, 0.01, 0.016)]
    for h, rx, ry, shift in stations:
        centre_y = -0.036 + shift + (h - 0.35) * 0.06
        ring = []
        for k in range(16):
            a = k / 16 * TAU
            finger = 0.002 * math.cos(a * 2) if math.sin(a) < 0 else 0.0
            ring.append((math.cos(a) * rx, centre_y + math.sin(a) * (ry + finger), h))
        sections.append(ring)
    emit("Stick_grip", "rubber", transform(loft(sections, closed=True), raised), pivot, owner)
    emit("Stick_trigger_guard", "metal_dark", transform(box(-0.0095, -0.002, 0.446, 0.0095, 0.01, 0.46, chamfer=0.002), raised), pivot, owner)
    trigger = transform(box(-0.0075, 0.0, 0.0, 0.0075, 0.01, 0.022, chamfer=0.002), raised @ Matrix.Translation((0, -0.002, 0.456)) @ Matrix.Rotation(math.radians(20), 4, "X"))
    emit("Stick_trigger", "red", trigger, pivot, owner)
    top = raised @ Matrix.Translation((0.0, -0.022, 0.55))
    emit("Stick_pickle", "red", transform(lathe([(0.0078, 0.0), (0.0078, 0.0065), (0.006, 0.0088), (0.0, 0.009)], 12), top @ Matrix.Translation((-0.009, -0.005, 0.002))), pivot, owner)
    emit("Stick_trim_hat", "knob", transform(lathe([(0.0062, 0.0), (0.0062, 0.0035), (0.0035, 0.0085), (0.0, 0.009)], 10), top @ Matrix.Translation((0.008, -0.006, 0.003))), pivot, owner)
    emit("Stick_castle", "knob", transform(box(-0.0055, -0.0055, 0.0, 0.0055, 0.0055, 0.009, chamfer=0.0016), raised @ Matrix.Translation((0.019, -0.022, 0.525)) @ Matrix.Rotation(math.pi / 2, 4, "Y")), pivot, owner)
    emit("Stick_paddle", "metal", transform(box(-0.012, -0.056, 0.42, 0.012, -0.05, 0.47, chamfer=0.002), raised), pivot, owner)
    emit("Stick_nws", "knob", transform(lathe([(0.0048, 0.0), (0.0048, 0.0035), (0.0, 0.0045)], 10), raised @ Matrix.Translation((-0.0225, -0.03, 0.51)) @ Matrix.Rotation(-math.pi / 2, 4, "Y")), pivot, owner)


def side_stick(surface, x, y, name="Stick"):
    """Short console-mounted stick with a forearm rest behind it."""
    frame = at(surface, x, y, PLATE_Z)
    emit("Sidestick_base", "metal_dark", box(-0.042, -0.05, -0.001, 0.042, 0.05, 0.014, chamfer=0.004), frame)
    emit("Sidestick_boot", "rubber", lathe([(0.032, 0.012), (0.03, 0.022), (0.024, 0.03), (0.027, 0.038), (0.02, 0.046), (0.0115, 0.058)], 16), frame)
    pivot = frame @ Matrix.Translation((0, 0, 0.03))
    owner = node(name, pivot)
    emit("Sidestick_shaft", "metal_dark", lathe([(0.012, 0.0), (0.012, 0.05), (0.0, 0.05)], 10), pivot, owner)
    emit("Sidestick_collar", "metal", lathe([(0.026, 0.038), (0.026, 0.052), (0.0, 0.052)], 14), pivot, owner)
    grip(pivot, owner, 0.045, 0.012)
    rest = frame @ Matrix.Translation((0, -0.2, 0.0))
    emit("Arm_rest", "cushion", box(-0.045, -0.12, 0.018, 0.045, 0.12, 0.052, chamfer=0.012), rest)
    emit("Arm_rest_post", "metal_dark", box(-0.02, -0.05, -0.001, 0.02, 0.05, 0.02, chamfer=0.002), rest)


def throttle(surface, x_left, x_right, slot_y0, slot_y1, base_y, stop_y):
    frame = FRAMES[surface]
    z = PLATE_Z
    for x in (x_left, x_right):
        emit("Throttle_slot", "rubber", box(x - 0.006, slot_y0, z - 0.0006, x + 0.006, slot_y1, z + 0.0014), frame)
        emit("Throttle_slot_lip", "metal_dark", box(x - 0.009, slot_y0 - 0.005, z - 0.0006, x - 0.006, slot_y1 + 0.005, z + 0.0028), frame)
        emit("Throttle_slot_lip", "metal_dark", box(x + 0.006, slot_y0 - 0.005, z - 0.0006, x + 0.009, slot_y1 + 0.005, z + 0.0028), frame)
    emit("Throttle_stop", "red", box(x_left - 0.015, stop_y, z, x_right + 0.015, stop_y + 0.006, z + 0.008, chamfer=0.001), frame)
    for side, x in (("left", x_left), ("right", x_right)):
        base = frame @ Matrix.Translation((x, base_y, z))
        owner = node(f"Throttle_{side}", base)
        emit("Throttle_arm", "metal_dark", transform(box(-0.0045, -0.012, -0.002, 0.0045, 0.012, 0.09, chamfer=0.002), Matrix.Rotation(math.radians(-4), 4, "X")), base, owner)
        inboard = side == "right"
        emit("Throttle_neck", "knob", box(-0.0135, -0.021, 0.07, 0.0135, 0.021, 0.0795, chamfer=0.002), base, owner)
        sections = []
        stations = [(0.078, 0.0135, 0.021, 0.0), (0.095, 0.0155, 0.027, 0.002), (0.118, 0.0165, 0.031, 0.008), (0.138, 0.0165, 0.031, 0.014), (0.152, 0.0135, 0.026, 0.017), (0.158, 0.006, 0.014, 0.018)]
        for h, rx, ry, forward in stations:
            ring = []
            for k in range(16):
                a = k / 16 * TAU
                c, s_ = math.cos(a), math.sin(a)
                ring.append((rx * math.copysign(abs(c) ** 0.6, c), forward + ry * math.copysign(abs(s_) ** 0.6, s_), h))
            sections.append(ring)
        emit(f"Throttle_grip_{side}", "knob", loft(sections, closed=True), base, owner)
        direction = 1 if inboard else -1
        emit("Throttle_button", "metal", transform(lathe([(0.0045, 0.0), (0.0045, 0.0025), (0.0, 0.003)], 8), Matrix.Translation((direction * 0.0135, 0.014, 0.138)) @ Matrix.Rotation(direction * math.radians(60), 4, "Y")), base, owner)
        emit("Throttle_hat", "knob", transform(lathe([(0.0052, 0.0), (0.0052, 0.003), (0.003, 0.0072), (0.0, 0.0076)], 8), Matrix.Translation((0.0, 0.02, 0.153))), base, owner)
        emit("Throttle_slider", "red" if inboard else "knob", box(direction * 0.016 - 0.003, 0.0, 0.098, direction * 0.016 + 0.003, 0.024, 0.113, chamfer=0.001), base, owner)


def hood_arc(half, top, side, y, count=30, exponent=3.8):
    return [(half * math.copysign(abs(math.cos(a)) ** (2 / exponent), math.cos(a)), y, side + (top - side) * abs(math.sin(a)) ** (2 / exponent)) for a in (math.pi * k / count for k in range(count + 1))]


def hood(stations, lip, stud_y=None, exponent=3.8, name="Hood"):
    """Glareshield: outer skin aft to the lip, then the rolled lip back to the panel."""
    emit(name, "cover", loft([hood_arc(h, t, s, y, exponent=exponent) for y, h, t, s in stations], reverse=True))
    emit(f"{name}_lip", "rubber", loft([hood_arc(h, t, s, y, exponent=exponent) for y, h, t, s in lip], reverse=True))
    if stud_y is None:
        return
    half, top, side = lerp_rows(sorted(stations, reverse=True), stud_y)
    for k in range(13):
        a = math.pi * (k + 0.5) / 13
        x = half * math.copysign(abs(math.cos(a)) ** (2 / exponent), math.cos(a))
        z = side + (top - side) * abs(math.sin(a)) ** (2 / exponent)
        emit(f"{name}_stud", "metal_dark", lathe([(0.0042, -0.002), (0.0042, 0.0008), (0.0, 0.0014)], 8), Matrix.Translation((x, stud_y, z)))


def hud_unit(w=0.128, h=0.122, centre=0.955, top=1.085, back=5.54, post=5.6, rail_depth=0.006):
    """The HUD built about y 5.65: projector, two A-frames and combiner glass. Move it with placed()."""
    emit("HUD_pedestal", "black", box(-0.135, back, 0.65, 0.135, 5.79, 0.712, chamfer=0.008))
    emit("HUD_control_strip", "knob", box(-0.09, back - 0.005, 0.668, 0.09, back + 0.01, 0.705, chamfer=0.002))
    for k in range(6):
        emit("HUD_vent", "metal_dark", box(-0.11 + k * 0.044, 5.6, 0.711, -0.08 + k * 0.044, 5.72, 0.715))
    emit("HUD_lens", "mirror", lathe([(0.075, 0.0), (0.075, 0.004), (0.0, 0.004)], 24), Matrix.Translation((0.0, 5.66, 0.711)))
    emit("HUD_lens_ring", "metal_dark", lathe([(0.083, 0.0), (0.083, 0.012), (0.075, 0.012), (0.075, 0.002)], 24), Matrix.Translation((0.0, 5.66, 0.711)))
    for side in (-1, 1):
        x = side * (w + 0.002 if w < 0.128 else 0.128)
        rear_low, rear_high = Vector((x, post, 0.705)), Vector((x, post + 0.02, top))
        front_low = Vector((x, 5.79, 0.705))
        emit("HUD_post", "black", strap([rear_low, (rear_low + rear_high) / 2, rear_high], 0.016, 0.011, (1.0, 0.0, 0.0)))
        emit("HUD_strut", "black", strap([front_low, (front_low + rear_high) / 2, rear_high], 0.014, 0.011, (1.0, 0.0, 0.0)))
        brace_low, brace_high = rear_low.lerp(rear_high, 0.38), front_low.lerp(rear_high, 0.38)
        emit("HUD_brace", "black", strap([brace_low, (brace_low + brace_high) / 2, brace_high], 0.012, 0.01, (1.0, 0.0, 0.0)))
        emit("HUD_foot", "metal_dark", box(x - 0.016, post - 0.015, 0.704, x + 0.016, 5.81, 0.718, chamfer=0.002))
        for z_h in [0.705 + (top - 0.705) * f for f in (0.145, 0.408, 0.671)]:
            emit("HUD_rivet", "metal", transform(lathe([(0.0028, 0.0), (0.0028, 0.002), (0.0, 0.003)], 6), Matrix.Rotation(math.pi / 2, 4, "Y") if side > 0 else Matrix.Rotation(-math.pi / 2, 4, "Y")), Matrix.Translation((x + side * 0.0048, post + (z_h - 0.705) * 0.02 / (top - 0.705), z_h)))
    rake = Matrix.Translation((0.0, 5.65, centre)) @ Matrix.Rotation(math.radians(84), 4, "X")
    emit("HUD_combiner", "hud_glass", ([(-w, -h, 0.0), (w, -h, 0.0), (w, h, 0.0), (-w, h, 0.0)], [(0, 1, 2, 3)], []), rake)
    owner = node("Screen_HUD", rake)
    emit("Screen_HUD", "screen", ([(-w, -h, 0.002), (w, -h, 0.002), (w, h, 0.002), (-w, h, 0.002)], [(0, 1, 2, 3)], [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]), rake, owner)
    emit("HUD_upper_rail", "black", box(-w - 0.007, h - 0.006, -rail_depth, w + 0.007, h + 0.004, 0.006, chamfer=0.002), rake)
    emit("HUD_lower_rail", "black", box(-w - 0.007, -h - 0.004, -rail_depth, w + 0.007, -h + 0.006, 0.006, chamfer=0.002), rake)


def canopy_trim(glass, y, rails, mirrors=(0.0, -0.235, 0.235), exponent=2.4, reach=0.042, depth=0.04):
    """Seal, fasteners, rail liners and mirrors fixed to the opening canopy. glass rows are (y, half, top, rim)."""
    owner = node("Canopy_attached", Matrix.Identity(4))
    frame = Matrix.Identity(4)

    def arch(y0, grow=0.0, count=40):
        half, top, rim = lerp_rows(glass, y0)
        return [((half + grow) * math.copysign(abs(math.cos(a)) ** (2 / exponent), math.cos(a)), y0, rim + (top - rim + grow) * abs(math.sin(a)) ** (2 / exponent)) for a in (math.pi * k / count for k in range(count + 1))]

    # A rail runs dead straight between its stations, as on the flight model.
    def rail_at(py):
        for a, b in zip(rails, rails[1:]):
            if a >= py >= b:
                t = (a - py) / (a - b)
                ha, _, ra = lerp_rows(glass, a)
                hb, _, rb = lerp_rows(glass, b)
                return ha + (hb - ha) * t, ra + (rb - ra) * t
        return lerp_rows(glass, py)[0], lerp_rows(glass, py)[2]

    for side in (-1, 1):
        rims = [[(side * (rail_at(station)[0] + dx), station, rail_at(station)[1] + dz) for dx, dz in ((-0.036, -0.03), (-0.036, 0.0), (-0.03, 0.03), (0.0, 0.037), (0.04, 0.037))] for station in rails]
        emit("Rail_liner", "black", loft(rims, reverse=side < 0), frame, owner)
        for k in range(11):
            t = (k + 0.5) / 11
            py = rails[0] + (rails[-1] - rails[0]) * t
            half, rim = rail_at(py)
            emit("Rail_liner_fastener", "metal_dark", lathe([(0.0034, -0.001), (0.0034, 0.0008), (0.0, 0.0014)], 8), Matrix.Translation((side * (half - 0.0355), py, rim)) @ Matrix.Rotation(side * math.pi / 2, 4, "Y") @ Matrix.Rotation(math.pi, 4, "X"), owner)
    outer, inner = arch(y - 0.002, -0.004), arch(y - 0.002, -reach)
    back_outer, back_inner = arch(y - depth, -0.008), arch(y - depth, -reach - 0.004)
    emit("Bow_seal", "rubber", loft([outer, inner, back_inner, back_outer, outer]), frame, owner)
    for k in range(5, 37, 2):
        p = Vector(back_inner[k])
        emit("Bow_fastener", "metal_dark", lathe([(0.0034, -0.001), (0.0034, 0.0008), (0.0, 0.0014)], 8), Matrix.Translation((p.x, y - depth - 0.002, p.z)) @ Matrix.Rotation(math.pi / 2, 4, "X"), owner)
    for index, x in enumerate(mirrors):
        turn = 0.0 if x == 0 else (-0.34 if x > 0 else 0.34)
        half, top, rim = lerp_rows(glass, y - depth)
        ratio = min(0.999, abs(x) / (half - reach - 0.004))
        z = rim + (top - rim - reach - 0.004) * (1 - ratio ** exponent) ** (1 / exponent)
        pivot = Matrix.Translation((x, y - depth - 0.005, z - 0.018)) @ Matrix.Rotation(turn, 4, "Y") @ Matrix.Rotation(math.radians(110), 4, "X")
        emit("Mirror_back", "black", box(-0.06, -0.022, -0.006, 0.06, 0.022, 0.0005, chamfer=0.003), pivot, owner)
        emit("Mirror", "mirror", box(-0.056, -0.018, 0.0, 0.056, 0.018, 0.0018), pivot, owner)
        emit("Mirror_stalk", "metal_dark", box(-0.006, -0.006, -0.03, 0.006, 0.006, 0.0), pivot, owner)
        emit("Mirror_foot", "metal_dark", box(x - 0.012, y - depth - 0.012, z - 0.03, x + 0.012, y - depth + 0.01, z + 0.006, chamfer=0.002), Matrix.Identity(4), owner)


def seat(top=0.1, front=4.5):
    """ACES II: bucket, cushions, headbox and the yellow handle between the knees.

    `top` is the cushion base height. `front` shortens the pan: everything forward
    of the seat back is drawn for 3.98-4.5 and then pulled in to 3.98-front.
    """
    start = len(PARTS)
    _seat(top)
    if front != 4.5:
        origin, squeeze = TRANSFORM.translation.y + 3.98, (front - 3.98) / (4.5 - 3.98)
        for part in PARTS[start:]:
            part.verts = [Vector((v.x, origin + (v.y - origin) * squeeze, v.z)) if v.y > origin else v for v in part.verts]


def _seat(top):
    rear, front = 3.98, 4.5
    sections = []
    for y, half, z0, z1 in [(front, 0.17, top - 0.05, top - 0.012), (front - 0.012, 0.185, top - 0.05, top + 0.006), (front - 0.05, 0.195, top - 0.05, top + 0.018), (front - 0.2, 0.2, top - 0.05, top + 0.022), (rear + 0.04, 0.195, top - 0.05, top + 0.014), (rear, 0.18, top - 0.05, top)]:
        ring = []
        for k in range(20):
            a = k / 20 * TAU
            c, s = math.cos(a), math.sin(a)
            ring.append((half * math.copysign(abs(c) ** 0.55, c), y, (z0 + z1) / 2 + (z1 - z0) / 2 * math.copysign(abs(s) ** 0.75, s)))
        sections.append(ring)
    emit("Seat_cushion", "cushion", loft(sections, closed=True, reverse=True))
    emit("Seat_crease", "fabric", box(-0.003, 4.02, top + 0.008, 0.003, 4.47, top + 0.0245))
    for side in (-1, 1):
        emit("Seat_crease", "fabric", box(side * 0.1 - 0.002, 4.04, top + 0.008, side * 0.1 + 0.002, 4.46, top + 0.021))
        # Bucket sides with the side-mounted handle guards.
        emit("Seat_bucket", "black", box(min(side * 0.2, side * 0.218), 3.94, -0.245, max(side * 0.2, side * 0.218), 4.53, top + 0.04, chamfer=0.006))
        emit("Seat_rail_cap", "metal_dark", box(min(side * 0.2, side * 0.222), 3.94, top + 0.038, max(side * 0.2, side * 0.222), 4.53, top + 0.05, chamfer=0.003))
        emit("Seat_handle", "yellow", box(min(side * 0.222, side * 0.232), 4.34, top - 0.05, max(side * 0.222, side * 0.232), 4.44, top + 0.03, chamfer=0.003))
        for y in (4.0, 4.14, 4.28, 4.42):
            fr = Matrix.Translation((side * 0.218, y, top)) @ Matrix.Rotation(side * math.pi / 2, 4, "Y")
            emit("Seat_rivet", "metal", lathe([(0.0034, -0.001), (0.0034, 0.0008), (0.0, 0.0014)], 8), fr)
        # Survival kit releases and the emergency oxygen ring.
        emit("Seat_release", "red", box(min(side * 0.17, side * 0.195), 4.5, top - 0.03, max(side * 0.17, side * 0.195), 4.525, top - 0.005, chamfer=0.003))
    emit("Seat_front", "black", box(-0.2, 4.5, -0.245, 0.2, 4.53, top - 0.012, chamfer=0.004))
    # Pull-to-eject loop stands up between the knees at the seat front.
    loop_centre = Vector((0.0, 4.545, top + 0.03))
    path = []
    for k in range(17):
        a = math.pi * k / 16
        path.append(loop_centre + Vector((math.cos(a) * 0.085, 0.0, math.sin(a) * 0.1 - 0.055)))
    emit("Eject_loop", "yellow", strap(path, 0.024, 0.0075, (0.0, 1.0, 0.0)))
    for k in range(5, 12, 2):
        a = math.pi * k / 16
        p = loop_centre + Vector((math.cos(a) * 0.085, 0.0, math.sin(a) * 0.1 - 0.055))
        emit("Eject_stripe", "black", transform(box(-0.0125, -0.0048, -0.0045, 0.0125, 0.0048, 0.0045), Matrix.Translation(p) @ Matrix.Rotation(-(a - math.pi / 2), 4, "Y") @ Matrix.Rotation(math.pi / 2, 4, "Z")))
    emit("Eject_mount", "black", box(-0.1, 4.52, top - 0.045, 0.1, 4.56, top - 0.01, chamfer=0.004))
    # Seat back, shoulder pads and headbox.
    back = box(-0.195, 3.87, top, 0.195, 3.965, 0.76, chamfer=0.016)
    emit("Seat_back_frame", "black", back)
    emit("Seat_back_cushion", "cushion", box(-0.172, 3.955, top + 0.03, 0.172, 3.995, 0.66, chamfer=0.016))
    for z in (0.26, 0.42, 0.56):
        emit("Seat_back_seam", "fabric", box(-0.172, 3.994, z, 0.172, 3.999, z + 0.006))
    emit("Headbox", "chute", box(-0.158, 3.83, 0.74, 0.158, 3.97, 1.03, chamfer=0.02))
    emit("Headrest", "cushion", box(-0.1, 3.965, 0.78, 0.1, 4.008, 0.98, chamfer=0.016))
    emit("Headbox_strap", "webbing", box(-0.16, 3.82, 0.86, 0.16, 3.975, 0.872))
    for side in (-1, 1):
        emit("Seat_rail", "metal_dark", box(min(side * 0.17, side * 0.2), 3.84, -0.245, max(side * 0.17, side * 0.2), 3.87, 1.0, chamfer=0.004))
        # Harness: shoulder straps from the back to the chest, lap belt from the sides.
        shoulder = [(side * 0.09, 3.995, 0.63), (side * 0.095, 4.09, 0.56), (side * 0.085, 4.24, 0.34), (side * 0.03, 4.33, top + 0.09)]
        emit("Harness_shoulder", "webbing", strap(shoulder, 0.042, 0.003, (1.0, 0.0, 0.0)))
        lap = [(side * 0.205, 4.02, top + 0.035), (side * 0.15, 4.2, top + 0.075), (side * 0.06, 4.33, top + 0.09)]
        emit("Harness_lap", "webbing", strap(lap, 0.042, 0.003))
        leg = [(side * 0.11, 4.43, top + 0.024), (side * 0.085, 4.4, top + 0.06), (side * 0.03, 4.335, top + 0.085)]
        emit("Harness_leg", "webbing", strap(leg, 0.03, 0.003))
        emit("Harness_fitting", "metal", box(side * 0.05 - 0.022, 4.3, top + 0.075, side * 0.05 + 0.022, 4.33, top + 0.1, chamfer=0.004))
        emit("Harness_adjuster", "metal", box(side * 0.09 - 0.017, 4.2, 0.38, side * 0.09 + 0.017, 4.232, 0.405, chamfer=0.003))
    emit("Harness_buckle", "metal", box(-0.038, 4.31, top + 0.07, 0.038, 4.345, top + 0.104, chamfer=0.006))
    emit("Harness_release", "red", lathe([(0.012, 0.0), (0.012, 0.005), (0.0, 0.006)], 10), Matrix.Translation((0.0, 4.345, top + 0.087)) @ Matrix.Rotation(-math.pi / 2, 4, "X"))
    # Oxygen and comm hose from the right console to the seat.
    path = [(0.21, 4.38, top + 0.03)] + [(0.2 - k * 0.012 + 0.012 * math.sin(k * 1.9), 4.37 - k * 0.012, top + 0.045 + k * 0.014 + 0.012 * math.cos(k * 1.9)) for k in range(14)]
    emit("Oxygen_hose", "rubber", tube(path, 0.011, 8))
    for k in range(0, 14):
        p = path[k + 1]
        emit("Oxygen_hose_rib", "rubber", transform(lathe([(0.0122, -0.0015), (0.0122, 0.0015), (0.0, 0.002)], 8), Matrix.Translation(p)))


# ---- Checks ----
def world_verts(part):
    if part.node is None:
        return part.verts
    matrix = NODES[part.node]["matrix"]
    return [matrix @ v for v in part.verts]


FIT_SCENE_Y = {"f15c": 0.0, "peregrine": -2.3 * 0.7, "aurelia": -1.265,
               "stormbird": -json.loads((ROOT / "src/aircraft/stormbird/stormbird-geometry.json").read_text())["centerOffsetY"]}


def aircraft_point(point):
    """Kit world (x right, y forward, z up) to aircraft-group metres.

    world_verts and captured frames already include placed() offsets, including
    Aurelia's OFFSET. Match measure-pilot-seats.ts: cancel the cockpit root scale,
    apply glTF's Y-up conversion, then the flight scene's vertical offset.
    """
    return [round(v, 4) or 0.0 for v in (point.x, point.z + FIT_SCENE_Y[MOD.ID], -point.y)]


@contextmanager
def capture_fit_surfaces():
    """Observe existing builders without changing geometry, including placed copies."""
    global plate, screen, readout, hud_unit
    original_hud = hud_unit
    original_plate, original_screen, original_readout = plate, screen, readout
    surfaces = []

    def capture_plate(entry, suffix=""):
        surface = entry["surface"] + suffix
        frame = TRANSFORM @ FRAMES[surface]
        corners = [(entry["x0"], entry["y0"], PLATE_Z),
                   (entry["x1"], entry["y0"], PLATE_Z),
                   (entry["x0"], entry["y1"], PLATE_Z)]
        surfaces.append(dict(id=PREFIX + "Plate_" + entry["id"], surface=surface,
                             corners=[frame @ Vector(p) for p in corners]))
        original_plate(entry, suffix)

    def capture_display(builder):
        def capture(name, surface, *args, **kwargs):
            start = len(PARTS)
            builder(name, surface, *args, **kwargs)
            for part in PARTS[start:]:
                if part.material == "screen":
                    verts = world_verts(part)
                    surfaces.append(dict(id=part.node, surface=surface,
                                         corners=[verts[i] for i in (0, 1, 3)]))
        return capture

    def capture_hud(*args, **kwargs):
        start = len(PARTS)
        original_hud(*args, **kwargs)
        for part in PARTS[start:]:
            if part.material == "screen":
                verts = world_verts(part)
                surfaces.append(dict(id=part.node, surface="hud",
                                     corners=[verts[i] for i in (0, 1, 3)]))

    hud_unit = capture_hud
    plate, screen, readout = capture_plate, capture_display(screen), capture_display(readout)
    try:
        yield surfaces
    finally:
        hud_unit = original_hud
        plate, screen, readout = original_plate, original_screen, original_readout


def write_fit_map(output, surfaces):
    """Write each named kit part at rest, before material merging or export."""
    parts = []
    for part in PARTS:
        points = [aircraft_point(v) for v in world_verts(part)]
        parts.append(dict(name=part.group + part.name, material=part.material,
                          min=[min(p[i] for p in points) for i in range(3)],
                          max=[max(p[i] for p in points) for i in range(3)]))
    faces = [dict(id=s["id"], surface=s["surface"],
                  corners=[aircraft_point(p) for p in s["corners"]]) for s in surfaces]
    key = lambda value: json.dumps(value, sort_keys=True)
    data = dict(id=MOD.ID, parts=sorted(parts, key=key), surfaces=sorted(faces, key=key))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, indent=1, sort_keys=True) + "\n")


def contact_check():
    """Every part must touch another, in one connected island reaching the tub."""
    count = len(PARTS)
    verts = [world_verts(p) for p in PARTS]
    boxes = []
    for vs in verts:
        xs, ys, zs = [v.x for v in vs], [v.y for v in vs], [v.z for v in vs]
        boxes.append((min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)))
    parent = list(range(count))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    cell = 0.08
    grid = defaultdict(list)
    for index, (x0, y0, z0, x1, y1, z1) in enumerate(boxes):
        for i in range(int(x0 // cell), int(x1 // cell) + 1):
            for j in range(int(y0 // cell), int(y1 // cell) + 1):
                for k in range(int(z0 // cell), int(z1 // cell) + 1):
                    grid[(i, j, k)].append(index)
    tolerance = 0.0035
    trees = {}

    def tree(index):
        if index not in trees:
            trees[index] = BVHTree.FromPolygons(verts[index], [tuple(f) for f in PARTS[index].faces], epsilon=0.0)
        return trees[index]

    def overlaps(a, b):
        A, B = boxes[a], boxes[b]
        return all(A[i] - tolerance <= B[i + 3] and B[i] - tolerance <= A[i + 3] for i in range(3))

    def touching(a, b):
        small, large = (a, b) if len(verts[a]) <= len(verts[b]) else (b, a)
        target = tree(large)
        for v in verts[small]:
            hit = target.find_nearest(v)
            if hit[0] is not None and hit[3] <= tolerance:
                return True
        return bool(tree(small).overlap(target))

    seen = set()
    for members in grid.values():
        for i, a in enumerate(members):
            for b in members[i + 1:]:
                key = (a, b) if a < b else (b, a)
                if key in seen:
                    continue
                seen.add(key)
                if find(a) != find(b) and overlaps(a, b) and touching(a, b):
                    parent[find(a)] = find(b)
    root = find(next(i for i, p in enumerate(PARTS) if p.name == "Tub"))
    floating = sorted({PARTS[i].name for i in range(count) if find(i) != root})
    return dict(parts=count, floating=floating)


# ---- Baked contact shadow ----
HEMISPHERE = []
for k in range(18):
    # Fibonacci hemisphere, cosine weighted towards the pole.
    z = math.sqrt(1 - (k + 0.5) / 18)
    radius = math.sqrt(1 - z * z)
    a = k * 2.399963
    HEMISPHERE.append(Vector((math.cos(a) * radius, math.sin(a) * radius, z)))


def bake_ao(meshes):
    blockers_v, blockers_f = [], []
    for part in PARTS:
        if part.material in ("glass", "hud_glass", "screen"):
            continue
        offset = len(blockers_v)
        blockers_v += world_verts(part)
        blockers_f += [tuple(i + offset for i in f) for f in part.faces]
    tree = BVHTree.FromPolygons(blockers_v, blockers_f, epsilon=0.0)
    for mesh, matrix in meshes:
        attribute = mesh.color_attributes.new("AO", "FLOAT_COLOR", "POINT")
        normal_matrix = matrix.to_3x3()
        for vertex, value in zip(mesh.vertices, attribute.data):
            normal = (normal_matrix @ vertex.normal).normalized()
            origin = matrix @ vertex.co + normal * 0.0012
            basis = normal.to_track_quat("Z", "Y").to_matrix()
            open_sky = 0.0
            for sample in HEMISPHERE:
                _, _, _, distance = tree.ray_cast(origin, basis @ sample, 0.22)
                open_sky += 1.0 if distance is None else min(1.0, (distance / 0.22) ** 0.7)
            level = 0.18 + 0.82 * (open_sky / len(HEMISPHERE)) ** 1.25
            value.color = (level, level, level, 1.0)
        mesh.color_attributes.active_color = attribute
        if len(mesh.vertices) > 300:
            print(f"  shade {mesh.name}: {sum(d.color[0] for d in attribute.data) / len(attribute.data):.2f}")


# ---- Blender scene and export ----
def linear(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def make_materials():
    made = {}
    folder = ROOT / f"assets/{MOD.ID}/cockpit"
    atlas = bpy.data.images.load(str(folder / "atlas.png"))
    glow = bpy.data.images.load(str(folder / "atlas-glow.png"))
    for name, (colour, metallic, roughness, extra) in MATERIALS.items():
        material = bpy.data.materials.new(f"Cockpit {name}")
        material.use_nodes = True
        bsdf = material.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (*[linear(c) for c in colour], 1.0)
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
        if "alpha" in extra:
            bsdf.inputs["Alpha"].default_value = extra["alpha"]
            material.surface_render_method = "BLENDED"
        if name == "atlas":
            image = material.node_tree.nodes.new("ShaderNodeTexImage")
            image.image = atlas
            material.node_tree.links.new(image.outputs["Color"], bsdf.inputs["Base Color"])
            emission = material.node_tree.nodes.new("ShaderNodeTexImage")
            emission.image = glow
            glow.colorspace_settings.name = "sRGB"
            material.node_tree.links.new(emission.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = 1.0
        if name == "atlas_lit":
            image = material.node_tree.nodes.new("ShaderNodeTexImage")
            image.image = atlas
            material.node_tree.links.new(image.outputs["Color"], bsdf.inputs["Base Color"])
            material.node_tree.links.new(image.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = 0.85
        made[name] = material
    return made


def to_mesh(name, parts, materials):
    verts, faces, uvs = [], [], []
    for part in parts:
        offset = len(verts)
        verts += [tuple(v) for v in part.verts]
        faces += [tuple(i + offset for i in f) for f in part.faces]
        uvs += part.uvs if part.uvs else [(0.0, 0.0)] * len(part.verts)
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    layer = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        polygon.use_smooth = True
        for loop in polygon.loop_indices:
            layer.data[loop].uv = uvs[mesh.loops[loop].vertex_index]
    mesh.materials.append(materials[parts[0].material])
    mesh.update()
    return mesh


def export(output):
    materials = make_materials()
    collection = bpy.data.collections.new("Cockpit")
    bpy.context.scene.collection.children.link(collection)
    root = bpy.data.objects.new(f"{MOD.ID}_cockpit", None)
    collection.objects.link(root)
    # Parts are built in real metres; the root brings them back to the model's own units.
    root.scale = (1 / MOD.SCALE,) * 3
    created = {}
    for name, data in NODES.items():
        obj = bpy.data.objects.new(name, None)
        collection.objects.link(obj)
        created[name] = obj
    for name, data in NODES.items():
        obj = created[name]
        parent = data["parent"]
        obj.parent = created[parent] if parent else root
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj.matrix_basis = (NODES[parent]["matrix"].inverted() @ data["matrix"]) if parent else data["matrix"]
    groups = defaultdict(list)
    for part in PARTS:
        groups[(part.node, part.material, part.group)].append(part)
    bake = []
    for (owner, material, group), parts in groups.items():
        # Separate meshes per cockpit let the renderer skip whichever is out of view.
        label = f"{owner}__{material}" if owner else f"{group}Static_{material}"
        mesh = to_mesh(label, parts, materials)
        obj = bpy.data.objects.new(label, mesh)
        collection.objects.link(obj)
        obj.parent = created[owner] if owner else root
        obj.matrix_parent_inverse = Matrix.Identity(4)
        bake.append((mesh, NODES[owner]["matrix"] if owner else Matrix.Identity(4)))
    print("Baking contact shadows into", sum(len(m.vertices) for m, _ in bake), "vertices")
    bake_ao(bake)
    bpy.context.view_layer.update()
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in collection.objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(output), export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
        export_normals=True, export_tangents=False, export_materials="EXPORT", export_image_format="AUTO",
        export_vertex_color="ACTIVE", export_active_vertex_color_when_no_material=True, export_animations=False,
        export_cameras=False, export_lights=False, export_extras=False,
    )


def triangle_count():
    return sum(max(0, len(f) - 2) for p in PARTS for f in p.faces)


def carve_box(box_min, box_max, keep, touching=False):
    """Removes the old cockpit faces from the imported airframe, matching the game's carve."""
    low = Vector((box_min[0], -box_max[2], box_min[1]))
    high = Vector((box_max[0], -box_min[2], box_max[1]))
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH" or "Static_" in obj.name or obj.name.startswith("Canopy_attached"):
            continue
        chain, cursor = obj.name, obj.parent
        while cursor:
            chain += "/" + cursor.name
            cursor = cursor.parent
        if keep.search(chain) or f"{MOD.ID}_cockpit" in chain:
            continue
        data = bmesh.new()
        data.from_mesh(obj.data)
        matrix = obj.matrix_world
        test = any if touching else all
        doomed = [f for f in data.faces if test(all(low[i] <= (matrix @ v.co)[i] <= high[i] for i in range(3)) for v in f.verts)]
        if doomed:
            bmesh.ops.delete(data, geom=doomed, context="FACES_ONLY")
            data.to_mesh(obj.data)
        data.free()


def review(names):
    """Renders from the pilot's eye with the real airframe around the new cockpit."""
    folder = ROOT / f"assets/{MOD.ID}/review/cockpit-detail"
    folder.mkdir(parents=True, exist_ok=True)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / MOD.MODEL))
    hide = getattr(MOD, "REVIEW_HIDE", ())
    for obj in list(bpy.context.scene.objects):
        chain, cursor = obj.name, obj.parent
        while cursor:
            chain += "/" + cursor.name
            cursor = cursor.parent
        if any(token in chain for token in hide):
            obj.hide_render = True
        if obj.name.startswith("Screen_HUD"):
            obj.hide_render = True
    carve = getattr(MOD, "CARVE", None)
    if carve:
        carve_box(carve["min"], carve["max"], carve["keep"], carve.get("touching", False))
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    world = bpy.data.worlds.new("Sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.72, 0.95, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.1
    scene.world = world
    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = 2.8
    sun.angle = 0.05
    sun_object = bpy.data.objects.new("Sun", sun)
    sun_object.rotation_euler = (math.radians(35), math.radians(25), math.radians(20))
    scene.collection.objects.link(sun_object)
    camera = bpy.data.cameras.new("Eye")
    camera.sensor_fit = "VERTICAL"
    camera.clip_start = 0.02
    eye = bpy.data.objects.new("Eye", camera)
    scene.collection.objects.link(eye)
    scene.camera = eye
    for name, (origin, target, fov) in MOD.VIEWS.items():
        if names and name not in names:
            continue
        camera.angle_y = math.radians(fov)
        origin, target = Vector(origin) / MOD.SCALE, Vector(target) / MOD.SCALE
        eye.location = origin
        eye.rotation_euler = (target - origin).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(folder / f"{name}.png")
        bpy.ops.render.render(write_still=True)
