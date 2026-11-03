"""Build the F-15C's outer skin in Blender and merge it with the CAD mechanical parts.

  Blender --background --python scripts/build-f15c-skin.py

Reads assets/f15c/GLB/f15c-cad.glb, saves assets/f15c-skin.blend and exports the game
model, public/assets/f15c-eagle.glb. Set POCKET_F15C_EXPORT_ONLY=1 and open the .blend to
re-export after sculpting by hand. Check with check-f15c-skin.py and the comparison scripts.

Blender axes, matching the game model on import: X right, Y forward, Z up, nose at
Y = 10. Station heights are written from the nose tip, as measured off the reference.
The body is separate closed lofts fused by a voxel remesh, so it stays one surface:
edit a loft in "Skin sources", and the fused body updates through its modifiers.
"""
import bmesh, bpy, json, math, os, re, struct
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAD = BASE + '/assets/f15c/GLB/f15c-cad.glb'
BLEND = BASE + '/assets/f15c-skin.blend'
OUT = BASE + '/public/assets/f15c-eagle.glb'
# The fin tip sets this: the gear is fixed, and total height stays 5.6261 m.
GEAR_BOTTOM = -2.38
HEIGHT = 5.6261
FIN_TIP = 3.728
NOSE_Z = GEAR_BOTTOM + HEIGHT - FIN_TIP
RING = 56
# Nozzles move forward and inboard, and shrink to the measured diameter.
NOZZLE_OLD = Vector((1.025, -9.431, -.125))
NOZZLE_NEW = Vector((.6, -7.95, NOSE_Z + .24))
NOZZLE_SCALE = .84
# The cockpit follows the lower, narrower canopy.
COCKPIT_DROP = NOSE_Z + 1.77 - 1.5
COCKPIT_WIDTH = .85
GUN_OLD = Vector((2, 2.05, .66))
# Barrel tips stand just proud of the port, so the spin can be seen.
GUN_NEW = Vector((1.80, 2.78, NOSE_Z + .5))


def lerp_table(table, y):
    """Interpolates a station table, sorted nose first, at y."""
    if y >= table[0][0]:
        return table[0][1:]
    for a, b in zip(table, table[1:]):
        if b[0] <= y <= a[0]:
            t = (a[0] - y) / (a[0] - b[0])
            return tuple(p + (q - p) * t for p, q in zip(a[1:], b[1:]))
    return table[-1][1:]


def ring(y, cx, half, top, bottom, power=2.0):
    """A closed section. Higher powers give flatter sides and tops."""
    cz = (top + bottom) / 2 + NOSE_Z
    rz = (top - bottom) / 2
    points = []
    for k in range(RING):
        a = 2 * math.pi * k / RING
        c, s = math.cos(a), math.sin(a)
        points.append((
            cx + half * math.copysign(abs(c) ** (2 / power), c),
            y,
            cz + rz * math.copysign(abs(s) ** (2 / power), s),
        ))
    return points


def closed_loft(name, sections, collection, material=None):
    count = len(sections[0])
    verts = [p for section in sections for p in section]
    faces = []
    for i in range(len(sections) - 1):
        for k in range(count):
            a, b = i * count + k, i * count + (k + 1) % count
            faces.append((a, a + count, b + count, b))
    faces.append(tuple(range(count - 1, -1, -1)))
    last = (len(sections) - 1) * count
    faces.append(tuple(range(last, last + count)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    # Normals must face out for the remesher and for shading.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    if material:
        mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def stations(table, ys, side=1):
    """Rings along a table of (y, cx, half, top, bottom, power)."""
    return [ring(y, side * lerp_table(table, y)[0], *lerp_table(table, y)[1:]) for y in ys]


def fine(table, step=.25):
    """Station positions between a table's ends, keeping its own stations."""
    first, last = table[0][0], table[-1][0]
    ys = set(row[0] for row in table)
    y = first
    while y > last:
        ys.add(round(y, 4))
        y -= step
    return sorted(ys, reverse=True)


# ---- Body tables: y, centre x, half width, top, bottom, flatness ----
FOREBODY = [
    (10.0, 0, .006, .006, -.006, 2), (9.75, 0, .11, .14, -.09, 2), (9.25, 0, .27, .37, -.21, 2),
    (8.75, 0, .39, .55, -.29, 2), (8.25, 0, .49, .70, -.33, 2), (7.75, 0, .56, .83, -.34, 2.1),
    (7.25, 0, .60, .96, -.32, 2.2), (6.75, 0, .64, 1.04, -.31, 2.3), (6.25, 0, .65, 1.05, -.31, 2.4),
    (5.25, 0, .67, 1.03, -.32, 2.5), (4.25, 0, .68, 1.0, -.33, 2.5), (3.25, 0, .68, .98, -.35, 2.5),
    (2.25, 0, .66, .98, -.38, 2.5), (.5, 0, .7, .9, -.36, 2.5), (-3, 0, .55, .7, -.36, 2.4),
    (-5.2, 0, .42, .55, -.2, 2.2), (-6.3, 0, .2, .3, -.05, 2),
]
SPINE = [
    (3.3, 0, .46, 1.5, .55, 2.4), (2.75, 0, .52, 1.44, .55, 2.4), (2.25, 0, .55, 1.35, .55, 2.4),
    (1.25, 0, .58, 1.22, .55, 2.4), (.25, 0, .55, 1.10, .55, 2.4), (-.75, 0, .5, .98, .5, 2.4),
    (-1.75, 0, .42, .88, .5, 2.4), (-2.75, 0, .3, .82, .5, 2.2), (-3.4, 0, .12, .75, .5, 2),
]
DECK = [
    (3.45, 0, 1.50, .9, .25, 4), (3.25, 0, 1.53, .92, .1, 4), (2.75, 0, 1.68, .92, .05, 4),
    (2.25, 0, 1.80, .9, .05, 4), (1.75, 0, 1.90, .88, .05, 4), (1.25, 0, 1.96, .86, .05, 4),
    (.75, 0, 2.0, .84, .05, 4), (-2, 0, 2.0, .78, .05, 4), (-5.2, 0, 1.97, .80, .05, 4),
    (-6.2, 0, 1.74, .74, .1, 4), (-7.2, 0, 1.36, .55, .18, 3.5), (-7.6, 0, 1.0, .35, .2, 3),
]
INTAKE = [
    (4.76, 1.13, .39, .49, .45, 5), (4.25, 1.125, .405, .64, .32, 5), (3.75, 1.13, .40, .80, .17, 5),
    (3.4, 1.135, .40, .92, .06, 5), (3.25, 1.135, .40, .92, .02, 5), (2.75, 1.14, .40, .92, -.13, 5),
    (2.5, 1.13, .42, .92, -.2, 5), (2.25, 1.12, .44, .92, -.44, 5), (1.75, 1.08, .5, .9, -.51, 4.5),
    (1.25, 1.0, .52, .88, -.54, 4), (.25, .88, .59, .8, -.58, 3.5),
]
NACELLE = [
    (.25, .88, .59, .6, -.58, 3.2), (-1, .84, .61, .45, -.6, 3.2), (-3, .82, .61, .4, -.58, 2.4),
    (-5, .75, .62, .35, -.48, 2.0), (-6.5, .64, .54, .62, -.34, 2.2), (-7.4, .6, .5, .74, -.26, 2),
]
BOOM = [
    (-1.5, 1.60, .3, .74, -.05, 3), (-3.2, 1.62, .37, .84, -.1, 3), (-5.2, 1.62, .38, .92, -.1, 3),
    (-6.5, 1.66, .26, .82, .02, 2.6), (-7.5, 1.66, .14, .5, .1, 2.2),
]
STING = [(-5, 0, .16, .3, -.05, 2), (-7, 0, .08, .3, .02, 2), (-8.05, 0, .02, .19, .13, 2)]
CANOPY = [
    (6.87, 0, .28, 1.06, .92, 2.2), (6.25, 0, .43, 1.40, .86, 2.3), (5.75, 0, .47, 1.65, .86, 2.4),
    (5.25, 0, .485, 1.77, .86, 2.4), (4.75, 0, .485, 1.77, .86, 2.4), (4.25, 0, .47, 1.72, .86, 2.4),
    (3.75, 0, .44, 1.64, .86, 2.4), (3.25, 0, .39, 1.54, .86, 2.3), (2.75, 0, .22, 1.44, .92, 2),
]
NOZZLE = [(-7.1, .6, .5, .74, -.26, 2), (-7.95, .6, .47, .71, -.23, 2)]


RADOME = [row for row in FOREBODY if row[0] >= 7.25]
# A blunt nose carries the compact round port; the fairing blends away aft.
GUN_FAIRING = [
    (2.66, 1.80, .10, .60, .40, 2), (2.6, 1.80, .135, .635, .365, 2), (2.3, 1.80, .15, .65, .35, 2.2),
    (1.8, 1.82, .15, .64, .36, 2.2), (1.3, 1.86, .1, .6, .4, 2), (.9, 1.9, .03, .52, .48, 2),
]

# ---- What is cut out of the fused body ----
DUCT_ROOF = [(4.76, .45), (4.25, .60), (3.75, .76), (3.4, .86), (2.5, .86), (1.25, .82), (.2, .7)]
# Ahead of the lower lip the duct is open right through, leaving a roof and two side walls.
DUCT_FLOOR = [(6.0, -1.5), (2.68, -1.5), (2.42, -.4), (1.25, -.4), (.2, -.3)]


def duct_rows(side):
    rows = []
    for y in [6.0, 4.76, 4.25, 3.75, 3.4, 3.0, 2.68, 2.42, 2.0, 1.25, .7, .2]:
        roof = lerp_table(DUCT_ROOF, y)[0]
        floor = lerp_table(DUCT_FLOOR, y)[0]
        half = .35 if y > 1.5 else .35 - (1.5 - y) * .05
        rows.append(ring(y, side * 1.12, half, roof, floor, 6))
    return rows


TUB = [(6.2, 0, .36, 1.6, .2, 3), (5.5, 0, .45, 1.6, .18, 3), (4, 0, .46, 1.7, .18, 3), (3.15, 0, .36, 1.7, .25, 3)]


def box(name, low, high, collection, material):
    (x0, y0, z0), (x1, y1, z1) = low, high
    verts = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])
    mesh.update()
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


# ---- Lifting surfaces: span x, leading y, trailing y, height from the nose, thickness ----
WING = [
    (1.5, .82, -4.91, .62, .36), (1.98, .816, -4.91, .62, .36), (3.0, -.19, -4.91, .57, .30),
    (3.92, -1.12, -4.91, .54, .24), (5.0, -2.2, -5.11, .49, .17), (5.78, -2.98, -5.30, .46, .15),
    (6.2, -3.40, -4.55, .44, .12), (6.42, -3.62, -4.05, .43, .09), (6.524625, -3.72, -3.84, .42, .03),
]
STABILATOR = [
    (1.45, -5.6, -7.68, .16, .2), (1.92, -5.8, -8.89, .16, .17), (2.64, -6.62, -9.1, .16, .15),
    (2.92, -6.52, -9.18, .165, .13), (3.5, -7.21, -9.36, .175, .1), (3.75, -7.51, -9.431, .17, .1),
    (4.0, -7.8, -9.38, .17, .08), (4.25, -8.1, -9.05, .17, .05), (4.36, -8.45, -8.8, .17, .02),
]
FLAP_HINGE = lambda x: -3.96
AILERON_HINGE = lambda x: -4.15 - (x - 3.97) * .296
CHORD = 14


def span_row(table, x, side, c0=0., c1=1.):
    """One closed chordwise section between chord fractions c0 and c1 of a biconvex foil."""
    lead, trail, z, thick = lerp_table([(-row[0],) + row[1:] for row in table], -x)
    upper, lower = [], []
    for k in range(CHORD + 1):
        c = c0 + (c1 - c0) * k / CHORD
        t = thick / 2 * 4 * c * (1 - c)
        y = lead + (trail - lead) * c
        upper.append((side * x, y, z + NOSE_Z + t))
        lower.append((side * x, y, z + NOSE_Z - t - 1e-4))
    return upper + lower[::-1]


def chord_at(table, x, y):
    lead, trail = lerp_table([(-row[0],) + row[1:] for row in table], -x)[:2]
    return (y - lead) / (trail - lead)


def wing_surface_z(x):
    return lerp_table([(-row[0],) + row[1:] for row in WING], -x)[2] + NOSE_Z


def fixed_wing_rows(side):
    rows = []
    for x in [1.5, 1.94, 1.95, 3.0, 3.86, 3.87, 3.94, 3.95, 5.0, 5.58, 5.59, 5.78, 6.2, 6.42, 6.524625]:
        if 1.95 <= x <= 3.86:
            end = chord_at(WING, x, FLAP_HINGE(x))
        elif 3.95 <= x <= 5.58:
            end = chord_at(WING, x, AILERON_HINGE(x))
        else:
            end = 1.
        rows.append(span_row(WING, x, side, 0, end))
    return rows


def control_rows(xs, hinge, side, gap=.015):
    return [span_row(WING, x, side, chord_at(WING, x, hinge(x) - gap), 1) for x in xs]


# Three bladders per wing, separated by ribs. A rib at x 3.9 also marks where the
# flap hinge gives way to the aileron hinge.
BLADDERS = ((1, [2.05, 2.6, 3.0]), (2, [3.04, 3.5, 3.88]), (3, [3.96, 4.5, 5.0, 5.5]))
BLADDER_FILL = .9
FUEL_USABLE_M3 = 1350 / .8 / 1000
FUEL_UNUSABLE_M3 = .025


def bladder_chord(x):
    hinge = FLAP_HINGE(x) if x <= 3.9 else AILERON_HINGE(x)
    return .07, chord_at(WING, x, hinge) - .025


def bladder_rows(side, xs):
    rows = []
    for x in xs:
        c0, c1 = bladder_chord(x)
        lead, trail, z, thick = lerp_table([(-row[0],) + row[1:] for row in WING], -x)
        upper, lower = [], []
        for k in range(CHORD + 1):
            c = c0 + (c1 - c0) * k / CHORD
            t = thick / 2 * 4 * c * (1 - c) * BLADDER_FILL
            y = lead + (trail - lead) * c
            upper.append((side * x, y, z + NOSE_Z + t))
            lower.append((side * x, y, z + NOSE_Z - t))
        rows.append(upper + lower[::-1])
    return rows


def fuel_line(name, a, b, collection, material, radius=.022):
    """A round pipe along the span, between two points."""
    rows = []
    for x, y, z in (a, b):
        rows.append([(x, y + radius * math.cos(2 * math.pi * k / 10), z + radius * math.sin(2 * math.pi * k / 10)) for k in range(10)])
    return closed_loft(name, rows, collection, material)


def fuel_samples():
    """How the right wing's fuel settles, in game axes, from the bladder shapes above."""
    step_x, step_y, step_z = .03, .03, .008
    columns = []
    for _, xs in BLADDERS:
        x = xs[0] + step_x / 2
        while x < xs[-1]:
            c0, c1 = bladder_chord(x)
            lead, trail, z, thick = lerp_table([(-row[0],) + row[1:] for row in WING], -x)
            y0, y1 = lead + (trail - lead) * c0, lead + (trail - lead) * c1
            ys = np.arange(y1 + step_y / 2, y0, step_y)
            c = (ys - lead) / (trail - lead)
            half = thick / 2 * 4 * c * (1 - c) * BLADDER_FILL
            for y, h in zip(ys, half):
                zs = np.arange(z + NOSE_Z - h + step_z / 2, z + NOSE_Z + h, step_z)
                columns.append(np.column_stack((np.full(zs.shape, x), zs, np.full(zs.shape, -y))))
            x += step_x
    cells = np.concatenate(columns)
    cells = cells[np.argsort(cells[:, 1], kind='stable')]
    cell_volume = step_x * step_y * step_z
    capacity = len(cells) * cell_volume
    if capacity < FUEL_USABLE_M3 + FUEL_UNUSABLE_M3:
        raise ValueError(f'Wing bladders hold only {capacity:.3f} m3')

    def state(volume):
        taken = cells[:max(2, int(volume / cell_volume))]
        centre = taken.mean(axis=0)
        d = taken - centre
        xx, yy, zz = (d[:, 0] ** 2).mean(), (d[:, 1] ** 2).mean(), (d[:, 2] ** 2).mean()
        xy, xz, yz = (d[:, 0] * d[:, 1]).mean(), (d[:, 0] * d[:, 2]).mean(), (d[:, 1] * d[:, 2]).mean()
        inertia = [yy + zz, -xy, -xz, -xy, xx + zz, -yz, -xz, -yz, xx + yy]
        return {'level': round(float(taken[:, 1].max()), 5), 'center': [round(float(n), 5) for n in centre], 'inertiaPerKg': [round(float(n), 6) for n in inertia]}

    samples = [dict(fraction=i / 16, **state(FUEL_UNUSABLE_M3 + FUEL_USABLE_M3 * i / 16)) for i in range(17)]
    low, high = cells.min(axis=0), cells.max(axis=0)
    data = {
        'source': 'Measured from the wing bladders in scripts/build-f15c-skin.py',
        'capacityLitres': round(capacity * 1000, 2),
        'size': [round(float(n), 3) for n in high - low],
        'samples': samples,
        'residual': {k: v for k, v in state(FUEL_UNUSABLE_M3).items() if k != 'level'},
    }
    with open(BASE + '/src/aircraft/f15c/wing-fuel.json', 'w') as f:
        json.dump(data, f, indent=1)
    print('WING FUEL capacity', data['capacityLitres'], 'litres, full centre', samples[-1]['center'])


def mesh_volume(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    volume = abs(bm.calc_volume(signed=True))
    bm.free()
    return volume


# ---- Stores: where the photos and drawing put them. Heights are from the nose. ----
PYLON_X = 2.79
# y, half width, top (inside the wing), keel. The nose wedge rises back into the wing's underside.
PYLON = [(.36, .012, .03, -.01), (.03, .04, .2, -.015), (-.53, .07, .57, -.03), (-1.5, .075, .58, -.03), (-3.0, .07, .58, -.02), (-3.6, .05, .58, .02), (-3.85, .015, .58, .05)]
AIM9_NOSE_Y = .92
AIM9_AXIS = .1865
RAILS = (('inner', 2.55), ('outer', 3.03))
# Body missiles ride the lower outer corners of the engine housings, in two pairs.
BODY_STATIONS = (('fwd', 1.29, 1.75), ('aft', 1.24, -2.2))
BODY_LENGTH = 3.65
BODY_RADIUS = .089


def anchor(name, position, mount, root, collection):
    node = bpy.data.objects.new(name, None)
    collection.objects.link(node)
    node.parent = root
    node.matrix_local = Matrix.Translation(position)
    node['mount'] = mount
    return node


def fin_section(z, lead, trail, thick, side, c0=0., c1=1.):
    full = lambda c: 4 * c * (1 - c)
    x0 = side * (1.762 - .006 * z)
    upper, lower = [], []
    for k in range(CHORD + 1):
        c = c0 + (c1 - c0) * k / CHORD
        y = lead + (trail - lead) * c
        t = thick / 2 * full(c)
        upper.append((x0 + t, y, z + NOSE_Z))
        lower.append((x0 - t - 1e-4, y, z + NOSE_Z))
    return upper + lower[::-1]


FIN = [(.5, -4.9, -8.0, .15), (.93, -5.21, -8.0, .15), (2.2, -6.23, -8.12, .1), (3.0, -6.87, -8.2, .08), (3.68, -7.46, -8.28, .05)]
RUDDER_BOTTOM, RUDDER_TOP = 1.1, 2.9
RUDDER_HINGE = lambda z: -7.28 - (z - 1.1) * .09


def fin_rows(side):
    rows = []
    for z in [.5, .93, RUDDER_BOTTOM - .01, RUDDER_BOTTOM, 2.2, RUDDER_TOP, RUDDER_TOP + .01, 3.68]:
        lead, trail, thick = lerp_table([(-row[0],) + row[1:] for row in FIN], -z)
        end = (RUDDER_HINGE(z) - lead) / (trail - lead) if RUDDER_BOTTOM <= z <= RUDDER_TOP else 1.
        rows.append(fin_section(z, lead, trail, thick, side, 0, end))
    return rows


def rudder_rows(side, gap=.015):
    rows = []
    for z in [RUDDER_BOTTOM + .012, 2.0, RUDDER_TOP - .012]:
        lead, trail, thick = lerp_table([(-row[0],) + row[1:] for row in FIN], -z)
        rows.append(fin_section(z, lead, trail, thick, side, (RUDDER_HINGE(z) - gap - lead) / (trail - lead), 1))
    return rows


# ---- Canopy: half-width, top, rim. Open underneath so the cockpit shows through. ----
GLASS = [
    (6.87, .28, 1.06, .92), (6.25, .43, 1.40, .86), (5.75, .47, 1.65, .86), (5.25, .485, 1.77, .86),
    (4.75, .485, 1.77, .86), (4.25, .47, 1.72, .86), (3.75, .44, 1.64, .86), (3.25, .39, 1.54, .86), (2.76, .2, 1.44, .92),
]
BOW = 5.72


def arch(y, half, top, rim, grow=0., count=28):
    points = []
    for k in range(count + 1):
        a = math.pi * k / count
        c, s = math.cos(a), math.sin(a)
        points.append((
            (half + grow) * math.copysign(abs(c) ** (2 / 2.4), c),
            y,
            rim + NOSE_Z + (top - rim + grow) * abs(s) ** (2 / 2.4),
        ))
    return points


def sheet(name, sections, collection, material, closed=False):
    count = len(sections[0])
    verts = [p for section in sections for p in section]
    faces = [(i * count + k, i * count + k + 1, (i + 1) * count + k + 1, (i + 1) * count + k) for i in range(len(sections) - 1) for k in range(count - 1)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


def glass_rows(y0, y1):
    ys = sorted({y for y, *_ in GLASS if y1 <= y <= y0} | {y0, y1}, reverse=True)
    return [arch(y, *lerp_table(GLASS, y)) for y in ys]


def frame(name, y, collection, material, depth=.06, thickness=.018):
    half, top, rim = lerp_table(GLASS, y)
    inner, outer = arch(y, half, top, rim), arch(y, half, top, rim, thickness)
    rows = []
    for dy in (-depth / 2, depth / 2):
        rows.append([(p[0], p[1] + dy, p[2]) for p in inner + outer[::-1]])
    return closed_loft(name, rows, collection, material)


# ---- Fitting parts to the new skin ----
def family(o):
    yield o
    for child in o.children:
        yield from family(child)


def to_game(point):
    return [point[0], point[2], -point[1]]


def to_game_axis(axis):
    return [axis[0], axis[2], -axis[1]]


def rebake(obj, transform):
    """Moves a kept mesh by a world transform, baking it so its node stays where it was."""
    world = transform @ obj.matrix_world
    obj.data = obj.data.copy()
    parent_inverse = (obj.parent.matrix_world if obj.parent else Matrix.Identity(4)).inverted()
    local = parent_inverse @ world
    obj.data.transform(local)
    obj.data.update()
    obj.matrix_world = obj.parent.matrix_world if obj.parent else Matrix.Identity(4)


def place_hinge(name, origin, axis=None):
    """Moves a hinge node. Its stored data is in game axes, as the game reads it."""
    node = bpy.data.objects[name]
    children = [(c, c.matrix_world.copy()) for c in node.children]
    parent_inverse = (node.parent.matrix_world if node.parent else Matrix.Identity(4)).inverted()
    node.matrix_local = parent_inverse @ Matrix.Translation(origin)
    bpy.context.view_layer.update()
    node['hinge'] = to_game(origin)
    if axis is not None:
        old = list(node['hinge_axis'])
        game = Vector(to_game_axis(axis)).normalized()
        # Keep the old sign: control code reads it to choose each surface's direction.
        strongest = max(range(3), key=lambda i: abs(old[i]))
        if (old[strongest] > 0) != (game[strongest] > 0):
            game = -game
        node['hinge_axis'] = list(game)
    return node, children


def attach(obj, parent):
    """Parents a part built in world coordinates to a hinge node, keeping it in place."""
    bpy.context.view_layer.update()
    obj.parent = parent
    obj.data.transform(parent.matrix_world.inverted())
    obj.data.update()
    obj.matrix_local = Matrix.Identity(4)


def ground_panel(name, body_tree, x0, x1, y0, y1, collection, material, up=False, nx=10, ny=14, thick=.012, lift=.004):
    """A thin panel following the body, from rays cast up from below (or down from above)."""
    sign = -1 if up else 1
    top, bottom = [], []
    for j in range(ny + 1):
        for i in range(nx + 1):
            x = x0 + (x1 - x0) * i / nx
            y = y0 + (y1 - y0) * j / ny
            origin = Vector((x, y, 12 if up else -12))
            hit = body_tree.ray_cast(origin, Vector((0, 0, -1 if up else 1)))[0]
            z = hit.z if hit else origin.z
            z += (lift if up else -lift)
            top.append((x, y, z))
            bottom.append((x, y, z + (-thick if up else thick)))
    verts = top + bottom
    row = nx + 1
    n = len(top)
    faces = []
    for j in range(ny):
        for i in range(nx):
            a = j * row + i
            faces.append((a, a + 1, a + row + 1, a + row))
            faces.append((n + a, n + a + row, n + a + row + 1, n + a + 1))
    for i in range(nx):
        faces.append((i, n + i, n + i + 1, i + 1))
        a = ny * row + i
        faces.append((a, a + 1, n + a + 1, n + a))
    for j in range(ny):
        a = j * row
        faces.append((a, a + row, n + a + row, n + a))
        a = j * row + nx
        faces.append((a, n + a, n + a + row, a + row))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    return obj


class Seams:
    """Panel lines: thin ribbons draped on the skin."""
    def __init__(self):
        self.verts, self.faces = [], []

    def line(self, points, tree, up=True, width=.009, step=.2):
        for (x0, y0), (x1, y1) in zip(points, points[1:]):
            length = math.hypot(x1 - x0, y1 - y0)
            count = max(1, int(length / step))
            dx, dy = (x1 - x0) / length * width / 2, (y1 - y0) / length * width / 2
            previous = None
            for k in range(count + 1):
                x, y = x0 + (x1 - x0) * k / count, y0 + (y1 - y0) * k / count
                pair = []
                for ox, oy in ((-dy, dx), (dy, -dx)):
                    hit = tree.ray_cast(Vector((x + ox, y + oy, 14 if up else -14)), Vector((0, 0, -1 if up else 1)))[0]
                    pair.append((x + ox, y + oy, hit.z + (.003 if up else -.003)) if hit else None)
                if pair[0] and pair[1]:
                    base = len(self.verts)
                    self.verts += pair
                    if previous is not None:
                        a, b = previous, base
                        self.faces.append((a, b, b + 1, a + 1) if up else (a, a + 1, b + 1, b))
                    previous = base
                else:
                    previous = None

    def mirrored(self, points, tree, up=True):
        self.line(points, tree, up)
        self.line([(-x, y) for x, y in points], tree, up)

    def finish(self, name, collection, material):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.verts, [], self.faces)
        mesh.update()
        mesh.materials.append(material)
        obj = bpy.data.objects.new(name, mesh)
        collection.objects.link(obj)
        return obj


def flat_material(name, colour, roughness=.7, metallic=0.):
    m = bpy.data.materials.new(name)
    p = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value = (*colour, 1)
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = metallic
    return m


# Everything from the CAD model the new skin replaces or makes unnecessary.
REPLACED = re.compile(
    r'^(Fuselage|Radome|Intake_skin_|Duct_|Ramp_|Splitter_|Wing_fixed_|Flap_(Left|Right)_skin|Flap_hinge_|'
    r'Aileron_(Left|Right)_skin|Aileron_hinge_|Fin_|Rudder_(Left|Right)_skin|Rudder_actuator_|Rudder_hinge_|'
    r'Stabilator_(Left|Right)_skin|Stabilator_shaft_(Left|Right)_skin|Stabilator_bearing_|Canopy_glass|Canopy_rail_|'
    r'Canopy_front_bow|Windshield_|Door_.*_skin|Mount_Door_|Airbrake_panel|Gun_port_fairing|Gun_recess_liner|'
    r'Gun_vent_|Dorsal_|Upper_beacon|Formation_light_)'
)
ENGINE_PART = re.compile(r'^(Convergent_petal|Divergent_petal|Nozzle_|Afterburner_|Engine_collar)')
GUN_PART = re.compile(r'^(Gun_(barrel|muzzle_face|support)|M61_)')


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=CAD)
    scene = bpy.context.scene
    objects = bpy.data.objects
    root = objects['F15C_Eagle']
    paint = next(s.material for s in objects['Fuselage'].material_slots)
    radome_paint = next(s.material for s in objects['Radome'].material_slots)
    glass = next(s.material for s in objects['Canopy_glass'].material_slots)
    frame_paint = next(s.material for s in objects['Windshield_front_frame'].material_slots)
    dark = flat_material('Duct • F-15C intake', (.012, .013, .015), .9)
    bay = flat_material('Bay • F-15C wells', (.26, .28, .29), .75)
    seam = flat_material('Seam • F-15C panels', (.17, .19, .205), .8)
    gun_dark = next(s.material for s in objects['Gun_support_Left'].material_slots)
    fuel_paint = flat_material('Fuel • F-15C wing cell', (.32, .2, .05), .6)
    fuel_line_paint = flat_material('Fuel • F-15C line', (.5, .5, .48), .35, .8)
    pylon_paint = flat_material('Paint • F-15C pylon', (.2, .24, .27), .5, .1)

    for o in [o for o in objects if o.type == 'MESH' and REPLACED.match(o.name)]:
        objects.remove(o, do_unlink=True)

    sources = bpy.data.collections.new('Skin sources')
    cutters = bpy.data.collections.new('Skin cutters')
    skin = scene.collection
    scene.collection.children.link(sources)
    scene.collection.children.link(cutters)

    # ---- Fused body ----
    pieces = [
        closed_loft('Forebody', stations(FOREBODY, [7.42] + [y for y in fine(FOREBODY) if y < 7.42]), sources),
        closed_loft('Spine', stations(SPINE, fine(SPINE)), sources),
        closed_loft('Deck', stations(DECK, fine(DECK)), sources),
        closed_loft('Sting', stations(STING, fine(STING)), sources),
    ]
    for side, label in ((1, 'Right'), (-1, 'Left')):
        for table, name in ((INTAKE, 'Intake'), (NACELLE, 'Nacelle'), (BOOM, 'Boom')):
            pieces.append(closed_loft(f'{name}_{label}', stations(table, fine(table), side), sources))
    copies = []
    for piece in pieces:
        copy = piece.copy()
        copy.data = piece.data.copy()
        scene.collection.objects.link(copy)
        copies.append(copy)
    sources.hide_viewport = sources.hide_render = True
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = copies[0]
    for copy in copies:
        copy.select_set(True)
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = body.data.name = 'Fuselage'
    for material in (paint, dark, bay):
        body.data.materials.append(material)
    remesh = body.modifiers.new('Fuse', 'REMESH')
    remesh.mode = 'VOXEL'
    remesh.voxel_size = .022
    remesh.use_smooth_shade = True
    blend = body.modifiers.new('Blend', 'SMOOTH')
    blend.factor = .6
    blend.iterations = 10
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    solid = BVHTree.FromObject(body, depsgraph)

    # ---- Openings ----
    for side, label in ((1, 'Right'), (-1, 'Left')):
        closed_loft(f'Cut duct {label}', duct_rows(side), cutters, dark)
        x0, x1 = sorted((side * .09, side * 1.19))
        # Two boxes, each the footprint of the doors that close it, so nothing stays open.
        box(f'Cut main well {label}', (x0, -1.615, -3), (x1, .23, NOSE_Z + .46), cutters, bay)
        x2, x3 = sorted((side * .70, side * 1.12))
        box(f'Cut main well aft {label}', (x2, -2.84, -3), (x3, -1.61, NOSE_Z + .46), cutters, bay)
    box('Cut nose well front', (-.23, 6.25, -3), (.23, 7.04, NOSE_Z + .8), cutters, bay)
    box('Cut nose well aft', (-.23, 3.81, -3), (.23, 6.3, NOSE_Z + .16), cutters, bay)
    closed_loft('Cut cockpit tub', stations(TUB, fine(TUB)), cutters, bay)
    # The body is only hollowed where the fairing covers it; the fairing's own cut opens the port.
    closed_loft('Cut gun bay', [ring(y, GUN_NEW.x, .085, .5 + .085, .5 - .085) for y in (2.6, 1.55)], cutters, dark)
    gun_cut = closed_loft('Gun port cutter', [ring(y, GUN_NEW.x, .085, .5 + .085, .5 - .085) for y in (2.9, 1.55)], sources, dark)
    cutters.hide_viewport = cutters.hide_render = True
    cut = body.modifiers.new('Openings', 'BOOLEAN')
    cut.operation = 'DIFFERENCE'
    cut.operand_type = 'COLLECTION'
    cut.collection = cutters
    cut.solver = 'MANIFOLD'
    cut.material_mode = 'TRANSFER'
    budget = body.modifiers.new('Budget', 'DECIMATE')
    budget.ratio = .12
    body.parent = root

    # ---- Radome, separate so its seam and tone stay ----
    radome = closed_loft('Radome', stations(FOREBODY, [y for y in fine(FOREBODY, .12) if y > 7.42] + [7.40]), skin, radome_paint)
    radome.parent = root

    # ---- Gun port, on the outer right wing-root shoulder ----
    fairing = closed_loft('Gun_port_fairing', stations(GUN_FAIRING, fine(GUN_FAIRING, .1)), skin, paint)
    fairing.parent = root
    fairing.data.materials.append(dark)
    port = fairing.modifiers.new('Port', 'BOOLEAN')
    port.operation = 'DIFFERENCE'
    port.operand_type = 'OBJECT'
    port.object = gun_cut
    port.solver = 'MANIFOLD'
    port.material_mode = 'TRANSFER'
    # Open at both ends: the barrels show through it.
    liner = sheet('Gun_recess_liner', [(lambda r: r + r[:1])(ring(y, GUN_NEW.x, .088, .5 + .088, .5 - .088)) for y in (2.62, 1.5)], skin, gun_dark)
    liner.parent = root

    # ---- Wings ----
    moving = {}
    for side, label in ((1, 'Right'), (-1, 'Left')):
        wing_node = objects[f'Wing_{label}']
        fixed = closed_loft(f'Wing_fixed_{label}', fixed_wing_rows(side), skin, paint)
        fixed.parent = wing_node
        flap_xs = [1.97, 3.0, 3.84]
        aileron_xs = [3.97, 5.0, 5.57]
        flap = closed_loft(f'Flap_{label}_skin', control_rows(flap_xs, FLAP_HINGE, side), skin, paint)
        aileron = closed_loft(f'Aileron_{label}_skin', control_rows(aileron_xs, AILERON_HINGE, side), skin, paint)
        for node, part, xs, hinge in ((f'Flap_{label}', flap, flap_xs, FLAP_HINGE), (f'Aileron_{label}', aileron, aileron_xs, AILERON_HINGE)):
            a = Vector((side * xs[0], hinge(xs[0]), wing_surface_z(xs[0])))
            b = Vector((side * xs[-1], hinge(xs[-1]), wing_surface_z(xs[-1])))
            hinge_node, _ = place_hinge(node, (a + b) / 2, b - a)
            attach(part, hinge_node)

        total = 0
        for number, xs in BLADDERS:
            cell = closed_loft(f'Wing_fuel_cell_{label}_{number}', bladder_rows(side, xs), skin, fuel_paint)
            cell.parent = wing_node
            total += mesh_volume(cell)
        print('WING FUEL ROOM', label, round(total, 3), 'm3')
        # Pipes run along the thickest part of the chord, through the ribs and into the body.
        pipe = lambda x: (side * x, -1.9 if x < 3.4 else -2.75, wing_surface_z(x))
        for number, x0, x1 in ((1, 2.98, 3.06), (2, 3.86, 3.98)):
            line = fuel_line(f'Wing_fuel_line_{label}_{number}', pipe(x0), (side * x1, pipe(x0)[1], wing_surface_z(x1)), skin, fuel_line_paint)
            line.parent = wing_node
        feed = fuel_line(f'Wing_fuel_feed_{label}', (side * 1.72, -1.9, wing_surface_z(1.72)), pipe(2.1), skin, fuel_line_paint)
        feed.parent = wing_node

        # ---- Pylon, with a rail each side of it, as in the underside photo ----
        pylon_x = side * PYLON_X
        pylon = closed_loft(f'Pylon_{label}', [ring(y, pylon_x, half, top, keel, 3) for y, half, top, keel in PYLON], skin, pylon_paint)
        pylon.parent = root
        for slot, x in RAILS:
            rail_x = side * x
            shoulder = closed_loft(f'Pylon_arm_{label}_{slot}', [ring(y, (rail_x + pylon_x) / 2, abs(rail_x - pylon_x) / 2 + .03, .32, .25, 6) for y in (-.15, -1.3)], skin, pylon_paint)
            shoulder.parent = root
            rail = closed_loft(f'Pylon_rail_{label}_{slot}', [ring(y, rail_x, half, .31, .225, 4) for y, half in ((.68, .012), (.5, .04), (-1.6, .04), (-1.85, .012))], skin, pylon_paint)
            rail.parent = root
            anchor(f'Store_aim9_{label}_{slot}', (rail_x, AIM9_NOSE_Y, AIM9_AXIS + NOSE_Z), f'Pylon_rail_{label}_{slot}', root, skin)

        # ---- Body launchers, fitted to the corner they ride on ----
        for slot, x, nose in BODY_STATIONS:
            body_x = side * x
            heights = []
            for k in range(9):
                y = nose - BODY_LENGTH * k / 8
                hit = solid.ray_cast(Vector((body_x, y, -12)), Vector((0, 0, 1)))[0]
                if hit:
                    heights.append(hit.z)
            low, high = min(heights), max(heights)
            axis = low - BODY_RADIUS + .02
            launcher = closed_loft(f'Launcher_{label}_{slot}', [ring(y, body_x, half, high + .04 - NOSE_Z, axis + .05 - NOSE_Z, 3) for y, half in ((nose - .5, .012), (nose - .8, .05), (nose - 2.9, .05), (nose - 3.2, .012))], skin, pylon_paint)
            launcher.parent = root
            anchor(f'Store_aim120_{label}_{slot}', (body_x, nose, axis), f'Launcher_{label}_{slot}', root, skin)

        # ---- Tail ----
        fin = closed_loft(f'Fin_{label}', fin_rows(side), skin, paint)
        fin.parent = root
        rudder = closed_loft(f'Rudder_{label}_skin', rudder_rows(side), skin, paint)
        a = Vector((side * (1.762 - .006 * RUDDER_BOTTOM), RUDDER_HINGE(RUDDER_BOTTOM), RUDDER_BOTTOM + NOSE_Z))
        b = Vector((side * (1.762 - .006 * RUDDER_TOP), RUDDER_HINGE(RUDDER_TOP), RUDDER_TOP + NOSE_Z))
        hinge_node, _ = place_hinge(f'Rudder_{label}', (a + b) / 2, b - a)
        attach(rudder, hinge_node)
        tip = closed_loft(f'Fin_tip_fairing_{label}', [ring(y, side * 1.74, r, 3.68 + r * .8, 3.68 - r * .8) for y, r in [(-7.05, .004), (-7.3, .05), (-7.7, .06), (-8.05, .05), (-8.3, .004)]], skin, paint)
        tip.parent = root

        stab_rows = []
        for x in [row[0] for row in STABILATOR]:
            stab_rows.append(span_row(STABILATOR, x, side))
        stab = closed_loft(f'Stabilator_{label}_skin', stab_rows, skin, paint)
        origin = Vector((side * 1.95, -7.35, .16 + NOSE_Z))
        hinge_node, _ = place_hinge(f'Stabilator_{label}', origin, Vector((side, 0, 0)))
        attach(stab, hinge_node)
        shaft = closed_loft(f'Stabilator_shaft_{label}_skin', [[(side * x, -7.35 + .05 * math.cos(2 * math.pi * k / 16), .16 + NOSE_Z + .05 * math.sin(2 * math.pi * k / 16)) for k in range(16)] for x in (1.4, 2.05)], skin, paint)
        hinge_node, _ = place_hinge(f'Stabilator_shaft_{label}', origin, Vector((side, 0, 0)))
        attach(shaft, hinge_node)
    bpy.context.view_layer.update()

    # ---- Canopy ----
    canopy_hinge = Vector((0, 3.13, .86 + NOSE_Z))
    place_hinge('Canopy', canopy_hinge)
    canopy_node = objects['Canopy']
    moving_glass = sheet('Canopy_glass', glass_rows(BOW - .01, 2.76), skin, glass)
    attach(moving_glass, canopy_node)
    windshield = sheet('Windshield_glass', glass_rows(6.87, BOW + .01), skin, glass)
    windshield.parent = root
    frames = frame('Canopy_front_bow', BOW, skin, frame_paint)
    attach(frames, canopy_node)
    front = frame('Windshield_front_frame', 6.62, skin, frame_paint, depth=.07)
    front.parent = root
    for side, label in ((1, 'Right'), (-1, 'Left')):
        rim = []
        for y in (5.68, 2.84):
            half = lerp_table(GLASS, y)[0]
            rim.append([(side * (half + dx), y, .86 + NOSE_Z + dz) for dx, dz in ((-.03, -.02), (.035, -.02), (.035, .035), (-.03, .035))])
        rail = closed_loft(f'Canopy_rail_{label}', rim, skin, frame_paint)
        attach(rail, canopy_node)

    # ---- Doors and airbrake follow the body ----
    doors = [
        ('Door_Nose_Forward', -.23, .23, 5.71, 7.04), ('Door_Nose_Aft', -.23, .23, 3.81, 5.70),
    ]
    for side, label in ((1, 'Right'), (-1, 'Left')):
        for name, x0, x1, y0, y1 in (('Forward', .64, 1.19, -1.61, .23), ('Inner', .09, .63, -1.61, .23), ('Aft', .70, 1.12, -2.84, -1.62)):
            a, b = sorted((side * x0, side * x1))
            doors.append((f'Door_{label}_{name}', a, b, y0, y1))
    for name, x0, x1, y0, y1 in doors:
        panel = ground_panel(name + '_skin', solid, x0, x1, y0, y1, skin, paint)
        node = objects[name]
        hx, hy = node['hinge'][0], -node['hinge'][2]
        if name.endswith('_Aft') and 'Nose' not in name:
            # Hinged on the inboard edge, so the open door hangs clear of the body missile.
            hx = math.copysign(.70, hx)
            node['hinge_axis'] = [-n for n in node['hinge_axis']]
        hit = solid.ray_cast(Vector((hx, hy, -12)), Vector((0, 0, 1)))[0]
        node, _ = place_hinge(name, Vector((hx, hy, hit.z if hit else node['hinge'][1])))
        attach(panel, node)
    spine_at = solid.ray_cast(Vector((0, .32, 12)), Vector((0, 0, -1)))[0]
    airbrake, _ = place_hinge('Airbrake', Vector((0, .32, spine_at.z)))
    panel = ground_panel('Airbrake_panel', solid, -.52, .52, -2.6, .3, skin, paint, up=True, nx=14, ny=16, thick=.02, lift=.006)
    attach(panel, airbrake)
    for o in family(airbrake):
        if o.type == 'MESH' and o.name != 'Airbrake_panel':
            rebake(o, Matrix.Translation((0, 0, spine_at.z - 1.07)))

    # ---- Beacon and antenna on the new spine ----
    beacon_hit = solid.ray_cast(Vector((0, .6, 12)), Vector((0, 0, -1)))[0]
    beacon = closed_loft('Upper_beacon', [[(r * math.cos(2 * math.pi * k / 12), .6 + r * math.sin(2 * math.pi * k / 12), beacon_hit.z + h) for k in range(12)] for r, h in ((.05, -.02), (.05, .025), (.02, .05))], skin, flat_material('Beacon • F-15C', (.6, .05, .03), .3))
    beacon.parent = root

    # ---- Panel lines ----
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    seams = Seams()
    wing_tree = {}
    for label in ('Right', 'Left'):
        wing_tree[label] = BVHTree.FromObject(objects[f'Wing_fixed_{label}'], depsgraph)
    for side, label in ((1, 'Right'), (-1, 'Left')):
        tree = wing_tree[label]
        for up in (True, False):
            for x0, y0, x1, y1 in (
                (3.0, -.3, 3.0, -3.9), (3.92, -1.2, 3.92, -4.1), (5.1, -2.4, 5.1, -4.5),
                (2.05, -2.7, 5.6, -4.45),
            ):
                seams.line([(side * x0, y0), (side * x1, y1)], tree, up)
    for up, lines in ((True, (
        ((.5, 6.9), (.62, 6.9)), ((-.62, 6.9), (-.5, 6.9)), ((.2, 7.4), (.2, 6.95)), ((.62, 6.4), (.62, 3.0)),
        ((.78, 3.3), (1.45, 3.3)), ((.78, 2.2), (1.7, 2.2)), ((.8, 3.8), (.8, -2.6)), ((1.2, 2.2), (1.2, -5.0)),
        ((.8, .9), (1.9, .9)), ((.65, -.9), (1.9, -.9)), ((.55, -2.6), (1.9, -2.6)), ((1.28, -2.6), (1.28, -5.2)),
        ((.45, -3.0), (.25, -5.1)), ((.25, -5.1), (1.28, -5.2)),
    )), (False, (
        ((.15, 8.2), (.15, 7.3)), ((.3, 6.9), (.62, 6.9)), ((.62, 6.0), (.62, 3.2)), ((1.0, 2.4), (1.0, -6.4)),
        ((.45, 2.4), (.45, -6.4)), ((.45, -2.0), (1.45, -2.0)), ((.45, -3.6), (1.4, -3.6)), ((.5, -5.2), (1.35, -5.2)),
    ))):
        for points in lines:
            seams.mirrored(list(points), solid, up)
    lines = seams.finish('Panel_lines', skin, seam)
    lines.parent = root

    # ---- Kept mechanical parts move to fit ----
    bpy.context.view_layer.update()
    for o in list(objects):
        if o.type != 'MESH':
            continue
        if ENGINE_PART.match(o.name):
            side = -1 if 'Left' in o.name else 1
            old = Vector((side * NOZZLE_OLD.x, NOZZLE_OLD.y, NOZZLE_OLD.z))
            new = Vector((side * NOZZLE_NEW.x, NOZZLE_NEW.y, NOZZLE_NEW.z))
            rebake(o, Matrix.Translation(new) @ Matrix.Scale(NOZZLE_SCALE, 4) @ Matrix.Translation(-old))
        elif GUN_PART.match(o.name):
            rebake(o, Matrix.Translation(GUN_NEW - GUN_OLD))
    cockpit_move = Matrix.Translation((0, 0, COCKPIT_DROP)) @ Matrix.Scale(COCKPIT_WIDTH, 4, (1, 0, 0))
    canopy_children = [o for o in family(objects['Canopy']) if o.type == 'MESH' and o.name not in ('Canopy_glass', 'Canopy_front_bow') and not o.name.startswith('Canopy_rail')]
    cockpit_children = [o for o in family(objects['Cockpit_fixed']) if o.type == 'MESH']
    for o in canopy_children + cockpit_children:
        rebake(o, cockpit_move)
    bpy.context.view_layer.update()
    # ---- Gun firing animation: a blurred barrel cylinder and the clips that time it ----
    gun_metal = next(s.material for s in objects['Gun_barrel_1'].material_slots)
    def blur_ring(y, radius):
        return [(GUN_NEW.x + radius * math.cos(2 * math.pi * k / 32), y, GUN_NEW.z + radius * math.sin(2 * math.pi * k / 32)) for k in range(32)]

    face = GUN_NEW.y - .027
    blur_mesh = closed_loft('Gun_barrel_blur', [blur_ring(GUN_NEW.y - .49, .0585), blur_ring(face - .012, .0585), blur_ring(face, .054)], skin, gun_metal)
    blur_mesh.parent = root
    # The six bores sweep a dark ring across the end of the blurred cylinder.
    bore_rows = [blur_ring(face - .001, .049), blur_ring(face + .0015, .049)]
    bores = closed_loft('Gun_blur_bores', bore_rows, skin, gun_dark)
    bores.parent = root
    hub = closed_loft('Gun_blur_hub', [blur_ring(face - .001, .029), blur_ring(face + .004, .029)], skin, gun_metal)
    hub.parent = blur_mesh
    gun_clips(root)
    root['gunMuzzle'] = to_game(GUN_NEW)
    root['skinSource'] = 'scripts/build-f15c-skin.py'
    return root


def clean_material_names(path):
    """Blender numbers repeated names, but the game's finish code matches them exactly."""
    with open(path, 'rb') as f:
        data = bytearray(f.read())
    length = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20 + length])
    for material in gltf.get('materials', []):
        material['name'] = re.sub(r'\.\d{3}$', '', material['name'])
    chunk = json.dumps(gltf, separators=(',', ':')).encode()
    chunk += b' ' * (-len(chunk) % 4)
    rest = data[20 + length:]
    out = bytearray(data[:12]) + struct.pack('<I', len(chunk)) + data[16:20] + chunk + rest
    struct.pack_into('<I', out, 8, len(out))
    with open(path, 'wb') as f:
        f.write(out)


def gun_clips(root):
    """Clips the game reads as curves: scale x is the fraction of full barrel speed."""
    scene = bpy.context.scene
    scene.render.fps = 60

    def curve(node_name, clip, keys, path='scale'):
        node = bpy.data.objects.new(node_name, None)
        scene.collection.objects.link(node)
        node.parent = root
        for frame, value in keys:
            if path == 'scale':
                node.scale = (value, 1, 1)
            else:
                node.location = value
            node.keyframe_insert(path, frame=frame)
        node.animation_data.action.name = clip
        if path == 'scale':
            node.scale = (1, 1, 1)
        return node

    # Spin-up leans in hard; wind-down coasts, long and heavy, like a real drive running out.
    curve('Gun_spin_up_curve', 'Gun_spin_up', [(0, 0), (20, 1)])
    curve('Gun_wind_down_curve', 'Gun_wind_down', [(0, 1), (60, 0)])
    curve('Gun_shake_curve', 'Gun_muzzle_shake', [
        (0, (0, 0, 0)), (1.5, (.0022, 0, .0012)), (3, (0, 0, -.0016)), (4.5, (-.0022, 0, .0012)), (6, (0, 0, 0)),
    ], 'location')


def export(root):
    bpy.ops.object.select_all(action='DESELECT')
    for o in family(root):
        o.hide_set(False)
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_apply=True, export_extras=True, export_yup=True, export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True, export_frame_step=1, export_optimize_animation_size=False)
    clean_material_names(OUT)
    tris = 0
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for o in family(root):
        if o.type == 'MESH':
            mesh = o.evaluated_get(depsgraph).to_mesh()
            mesh.calc_loop_triangles()
            tris += len(mesh.loop_triangles)
            o.evaluated_get(depsgraph).to_mesh_clear()
    print('TRIANGLES', tris, 'BYTES', os.path.getsize(OUT))
    print('NOSE_Z', NOSE_Z, 'NOZZLE', NOZZLE_NEW, 'GUN', to_game(GUN_NEW), 'COCKPIT_DROP', COCKPIT_DROP)


def main():
    if os.environ.get('POCKET_F15C_EXPORT_ONLY'):
        root = bpy.data.objects['F15C_Eagle']
    else:
        root = build()
        fuel_samples()
        bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    export(root)


main()
