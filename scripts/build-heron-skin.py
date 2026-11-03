"""Build the Heron's outer skin in Blender, shaped after the Cessna 208B Grand Caravan.

  Blender --background --python-exit-code 1 --python scripts/build-heron-skin.py

Reads the CAD model written by prepare-heron.ts, saves assets/heron-skin.blend, renders review
images to output/heron-redesign/detail and exports the game model, public/assets/heron-ut9.glb.
Set POCKET_HERON_NO_EXPORT=1 to look without exporting. Check with check-heron-skin.py.

Mechanical parts stay in CAD: wheels, gear, propeller, seats and the wing with its flaps and
ailerons. Flight numbers do not follow this shape; see geometry.json and measure-heron.ts.

Blender axes, matching the game model on import: X right, Y forward, Z up. Tables are
written as the reference was measured: z runs aft from the nose as in the game (the spinner
tip is at z = -4.5), and h is height above the ground, 2.05 m below the body datum.
"""
import bmesh, bpy, json, math, os, re, struct
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAD = BASE + '/assets/heron/GLB/heron-ut9-cad.glb'
BLEND = BASE + '/assets/heron-skin.blend'
OUT = BASE + '/public/assets/heron-ut9.glb'
REVIEW = BASE + '/output/heron-redesign/detail'
PHOTO = BASE + '/assets/heron/references/ex-taxi.jpg'
GROUND = 2.05
RING = 64
VOXEL = .036
# The dense copy that gives the lighter skin its shading.
SHADING_VOXEL = .016
# The real wing root sits further back than the CAD wing; the real propeller sits lower.
WING_AFT = 1.25
PROP_DOWN = .34

# z, half width, roof, keel, roof squareness, floor squareness, widest point up the section.
BODY = [
    (-4.02, .34, 2.20, 1.66, 2.2, 2.2, .5),
    (-3.93, .46, 2.31, 1.53, 2.3, 2.3, .5),
    (-3.60, .55, 2.37, 1.37, 2.5, 2.5, .52),
    (-3.00, .62, 2.40, 1.29, 2.7, 2.7, .55),
    (-2.30, .70, 2.42, 1.24, 2.9, 3.0, .55),
    (-2.00, .77, 2.54, 1.20, 3.0, 3.4, .52),
    (-1.50, .84, 2.72, 1.14, 3.1, 3.8, .5),
    (-1.05, .875, 2.87, 1.10, 3.2, 4.2, .5),
    (-.64, .885, 2.93, 1.08, 3.2, 4.4, .5),
    (.50, .885, 2.89, 1.08, 3.2, 4.4, .5),
    (1.83, .88, 2.79, 1.08, 3.2, 4.4, .5),
    (2.90, .85, 2.70, 1.11, 3.0, 4.0, .5),
    (4.00, .72, 2.59, 1.24, 2.7, 3.2, .52),
    (5.00, .55, 2.48, 1.42, 2.4, 2.6, .55),
    (6.00, .38, 2.37, 1.63, 2.2, 2.2, .55),
    (7.00, .21, 2.27, 1.86, 2.1, 2.1, .55),
    (7.75, .09, 2.20, 2.02, 2.0, 2.0, .55),
    (7.90, .04, 2.17, 2.07, 2.0, 2.0, .55),
]
# The carry-through over the roof: a blister ahead of the wing that runs out behind it.
WING_FAIRING = [
    (-1.00, .30, 2.87, 2.45, 2.2, 2.2, .3),
    (-.70, .55, 2.97, 2.45, 2.4, 2.2, .3),
    (-.25, .72, 3.07, 2.45, 2.6, 2.2, .3),
    (.20, .80, 3.13, 2.45, 2.8, 2.2, .3),
    (1.10, .84, 3.20, 2.45, 3.0, 2.2, .3),
    (2.05, .80, 3.17, 2.40, 2.8, 2.2, .3),
    (2.60, .62, 3.01, 2.35, 2.5, 2.2, .3),
    (3.20, .36, 2.81, 2.30, 2.3, 2.2, .3),
    (3.70, .10, 2.66, 2.30, 2.2, 2.2, .3),
]
POD = [
    (-2.28, .22, 1.30, 1.06, 2.2, 2.2, .5),
    (-2.12, .46, 1.30, .78, 2.4, 2.6, .55),
    (-1.70, .60, 1.30, .56, 2.6, 3.2, .55),
    (-.80, .64, 1.30, .49, 2.8, 3.6, .55),
    (2.40, .64, 1.30, .49, 2.8, 3.6, .55),
    (3.10, .58, 1.34, .63, 2.6, 3.0, .55),
    (3.90, .44, 1.40, .90, 2.4, 2.6, .55),
    (4.55, .20, 1.46, 1.20, 2.2, 2.2, .55),
]
# h, leading z, trailing z, half thickness. The fin ends at the rudder hinge line.
FIN = [(2.15, 6.05, 7.42, .10), (2.60, 6.42, 7.47, .10), (3.05, 6.50, 7.51, .085), (4.00, 7.00, 7.58, .06), (4.55, 7.28, 7.63, .042), (4.70, 7.36, 7.64, .022)]
RUDDER = [(2.05, 7.455, 7.90, .05), (2.60, 7.495, 7.92, .05), (4.00, 7.60, 8.02, .036), (4.55, 7.65, 8.07, .024), (4.695, 7.665, 8.07, .012)]
# The rudder's hinge line: two points as (h, z). It rakes aft, so the rudder gets a tilted mount.
RUDDER_HINGE = ((2.05, 7.44), (4.70, 7.65))
# Along the spine: z, roof height of the dorsal fillet ahead of the fin.
DORSAL = [(4.30, 2.56), (4.80, 2.64), (5.40, 2.76), (5.95, 2.93), (6.42, 3.14), (6.80, 3.40)]
# Where the tailplane meets the tail cone.
TAIL_FAIRING = [(5.75, .05, 2.26, 2.18, 2, 2, .5), (6.25, .42, 2.31, 2.13, 2, 2, .5), (7.00, .42, 2.29, 2.13, 2, 2, .5), (7.45, .20, 2.27, 2.15, 2, 2, .5), (7.80, .05, 2.24, 2.17, 2, 2, .5)]
TAIL_H = 2.22
HINGE_Z = 7.30
# x, leading z, trailing z, half thickness. Rows inboard of the rudder's swing are cut short.
TAILPLANE = [(.05, 6.30, 8.17, .08), (1.20, 6.48, 8.17, .07), (2.60, 6.86, 8.17, .05), (3.05, 7.02, 8.17, .03), (3.125, 7.12, 8.12, .012)]
ELEVATOR_ROOT = (.13, .40)
# Wing planform from CAD, moved aft: x, leading z, chord, height at the leading edge.
WING = [(.52, -1.15, 1.95, 3.08), (4.80, -.90, 1.70, 3.23), (7.45, -.62, 1.31, 3.36), (7.68, -.53, 1.18, 3.37)]
STRUT = ((.80, .78, 1.28), (4.45, .86, 3.20))
GEAR_FAIRING = [(.30, .02, 1.22, 1.12, 2, 2, .5), (.52, .10, 1.24, 1.03, 2.2, 2.2, .5), (.92, .10, 1.24, 1.03, 2.2, 2.2, .5), (1.25, .02, 1.22, 1.13, 2, 2, .5)]
CHIN = [(-3.93, .22, 1.78, 1.52, 2.2, 2.2, .5), (-3.62, .36, 1.70, 1.21, 2.4, 2.6, .5), (-2.95, .41, 1.60, 1.11, 2.5, 2.8, .5), (-2.40, .36, 1.50, 1.13, 2.4, 2.6, .5), (-2.05, .08, 1.40, 1.22, 2.2, 2.2, .5)]
# Exhaust stack on the right side, as on the real aircraft: x, z, h, half width, half height.
EXHAUST = [(.46, -3.02, 1.72, .05, .06), (.58, -2.72, 1.63, .06, .07), (.70, -2.32, 1.46, .07, .08), (.79, -1.95, 1.32, .08, .09), (.84, -1.62, 1.23, .115, .125)]
# The top runs well above the roof, so the glass spans it from the cowl to the eyebrow.
WINDSHIELD = [(-2.18, 2.36), (-2.18, 3.6), (-1.07, 3.6), (-1.07, 2.84), (-1.24, 2.48), (-1.56, 2.14)]
PILOT_WINDOW = [(-1.24, 2.14), (-.82, 2.52), (-.64, 2.48), (-.64, 2.10)]
# Window centres: z and height. The row steps down aft with the roof.
CABIN_WINDOWS = ((-.27, 2.29), (.44, 2.25), (1.20, 2.21), (2.10, 2.17), (2.75, 2.14), (3.37, 2.12), (3.98, 2.09))
TIP_PAINT = 3.95
BOOT_ROWS = 2
# Everything rebuilt here. Wheels, gear, propeller, seats and the wing itself stay in CAD.
REPLACED = re.compile(
    r'^(Fuselage|Cabin_window|Windshield|Pilot_door|Cabin_door|Cowling|Cooling_slot|Cabin_cheatline|Curved_belly|Wing_carry|'
    r'Tailplane|Elevator_hinge|Elevator_skin|Rudder_hinge|Rudder_skin|Fin_|Cargo_|Chin_cowling|Engine_inlet|Exhaust|Door_handle|'
    r'Wing_strut|Strut_attach)')
# The paint line: z, height. It follows the keel up the tail, as on the real aircraft.
PAINT_LINE = [(-4.3, 1.74), (-2.3, 1.56), (2.6, 1.50), (4.5, 1.57), (5.6, 1.66), (6.6, 1.72), (8.3, 1.72)]
STRIPE = .05
CABIN_FLOOR = 1.46
COCKPIT_AFT = .32
WALL = .035
CREW_DOOR = [(-1.52, 1.32), (-1.52, 2.10), (-.98, 2.66), (-.60, 2.66), (-.60, 1.32)]
CARGO_DOOR = [(2.44, 1.24), (2.44, 2.62), (3.71, 2.58), (3.71, 1.32)]
POD_DOORS = ((-1.74, -1.03), (-.82, -.04), (.16, 1.30))
WING_RIBS = (1.45, 2.55, 3.65, 4.80, 5.85, 6.90)


def to_game(point):
    return [point[0], point[2], -point[1]]


def family(o):
    yield o
    for child in o.children:
        yield from family(child)


def smooth(table, step=.04, window=.3):
    """Evenly spaced rows between the measured ones, without corners at the stations."""
    rows = np.array(table, dtype=float)
    z = np.linspace(rows[0, 0], rows[-1, 0], max(2, round((rows[-1, 0] - rows[0, 0]) / step) + 1))
    fine = np.column_stack([z] + [np.interp(z, rows[:, 0], rows[:, c]) for c in range(1, rows.shape[1])])
    reach = max(1, round(window / step))
    for c in range(1, rows.shape[1]):
        padded = np.pad(fine[:, c], reach, mode='edge')
        fine[:, c] = np.convolve(padded, np.ones(2 * reach + 1) / (2 * reach + 1), mode='valid')
    return fine


def section(z, half, roof, keel, crown, floor, widest, cx=0.):
    """A closed section. Higher squareness gives flatter sides, roof and floor."""
    mid = keel + (roof - keel) * widest
    points = []
    for k in range(RING):
        a = 2 * math.pi * k / RING
        c, s = math.cos(a), math.sin(a)
        power, reach = (crown, roof - mid) if s >= 0 else (floor, mid - keel)
        points.append((
            cx + half * math.copysign(abs(c) ** (2 / power), c),
            -z,
            mid - GROUND + reach * math.copysign(abs(s) ** (2 / power), s),
        ))
    return points


def rows(table, cx=0., step=.04, window=.3):
    return [section(*r, cx) for r in smooth(table, step, window)]


def closed_loft(name, sections, material=None):
    count = len(sections[0])
    verts = [p for s in sections for p in s]
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
    bpy.context.scene.collection.objects.link(obj)
    return obj


def foil_thickness(u):
    """A NACA four-digit section, scaled so its thickest point is 1."""
    u = max(u, 0.)
    return (.2969 * math.sqrt(u) - .126 * u - .3516 * u ** 2 + .2843 * u ** 3 - .1036 * u ** 4) / .1


def foil(position, lead, trail, half, c0=0., c1=1., count=15):
    """A symmetric section between two chord fractions: top surface aft, then bottom surface forward."""
    fractions = [c0 + (c1 - c0) * (1 - math.cos(math.pi * k / (count - 1))) / 2 for k in range(count)]
    top = [position(lead + (trail - lead) * u, half * foil_thickness(u)) for u in fractions]
    bottom = [position(lead + (trail - lead) * u, -half * foil_thickness(u)) for u in reversed(fractions)]
    return top + bottom


def paint_slots(obj, *materials):
    obj.data.materials.clear()
    for m in materials:
        obj.data.materials.append(m)


def boot(obj, row_count, count, dark):
    """De-ice boots: paints the leading-edge rows of a foil built with foil() above."""
    obj.data.materials.append(dark)
    slot = len(obj.data.materials) - 1
    half = count // 2
    for i in range(row_count - 1):
        for k in list(range(BOOT_ROWS)) + list(range(count - BOOT_ROWS - 1, count)):
            obj.data.polygons[i * count + k].material_index = slot


def material(name, colour, roughness=.38, metallic=0., alpha=1.):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    node = m.node_tree.nodes['Principled BSDF']
    node.inputs['Base Color'].default_value = (*colour, 1)
    node.inputs['Roughness'].default_value = roughness
    node.inputs['Metallic'].default_value = metallic
    if alpha < 1:
        node.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
        m.use_backface_culling = False
    return m


def apply_all(obj):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    for modifier in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)


def boolean(obj, operation, other):
    modifier = obj.modifiers.new(operation, 'BOOLEAN')
    modifier.operation = operation
    modifier.solver = 'EXACT'
    modifier.object = other
    apply_all(obj)
    if not obj.data.polygons:
        raise RuntimeError(f'{obj.name}: {operation} with {other.name} left nothing')
    return obj


def duplicate(obj, name):
    copy = obj.copy()
    copy.data = obj.data.copy()
    copy.name = copy.data.name = name
    bpy.context.scene.collection.objects.link(copy)
    return copy


def remove(obj):
    mesh = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    if mesh and not mesh.users:
        bpy.data.meshes.remove(mesh)


def fuse(name, tables):
    """One continuous skin from separate closed lofts, like the F-15C's body."""
    target = closed_loft(name, tables[0])
    extras = []
    for i, sections in enumerate(tables[1:]):
        extra = closed_loft(f'{name} source {i}', sections)
        modifier = target.modifiers.new(f'join {i}', 'BOOLEAN')
        modifier.operation = 'UNION'
        modifier.solver = 'EXACT'
        modifier.object = extra
        extras.append(extra)
    remesh = target.modifiers.new('fuse', 'REMESH')
    remesh.mode = 'VOXEL'
    remesh.voxel_size = SHADING_VOXEL
    remesh.use_smooth_shade = True
    # Eases the creases, such as where the dorsal fillet meets the body, that voxels turn to steps.
    fair = target.modifiers.new('fair', 'SMOOTH')
    fair.factor = .6
    fair.iterations = 14
    apply_all(target)
    for extra in extras:
        remove(extra)
    detailed = duplicate(target, f'{name} shading')
    # A uniform voxel mesh stays clean for the cuts below; a decimated one tears them.
    remesh = target.modifiers.new('even', 'REMESH')
    remesh.mode = 'VOXEL'
    remesh.voxel_size = VOXEL
    remesh.use_smooth_shade = True
    fair = target.modifiers.new('fair', 'SMOOTH')
    fair.factor = .5
    fair.iterations = 3
    apply_all(target)
    target.data.materials.clear()
    return target, detailed


def prism(points, x0=-1.6, x1=1.6):
    """Side-view polygons (z, h) extruded across the aircraft, as one mesh."""
    verts, faces = [], []
    for polygon in points:
        base, count = len(verts), len(polygon)
        verts += [(x0, -z, h - GROUND) for z, h in polygon] + [(x1, -z, h - GROUND) for z, h in polygon]
        faces.append(tuple(range(base + count - 1, base - 1, -1)))
        faces.append(tuple(range(base + count, base + 2 * count)))
        faces += [(base + k, base + (k + 1) % count, base + count + (k + 1) % count, base + count + k) for k in range(count)]
    mesh = bpy.data.meshes.new('Cutter')
    mesh.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new('Cutter', mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def rounded_rect(z, h, half_z, half_h, radius=.07, corner=5):
    points = []
    for sz, sh, start in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        for k in range(corner + 1):
            a = math.radians(start + 90 * k / corner)
            points.append((z + sz * (half_z - radius) + radius * math.cos(a), h + sh * (half_h - radius) + radius * math.sin(a)))
    return points


def volume_below(table, lift=0., floor=-3.):
    """A block under a side-view line, for splitting the paint with a crisp edge."""
    z = np.arange(table[0][0], table[-1][0] + .1, .1)
    line = np.interp(z, [t[0] for t in table], [t[1] for t in table])
    kernel = np.ones(9) / 9
    line = np.convolve(np.pad(line, 4, mode='edge'), kernel, mode='valid')
    sections = [[(-2, -a, floor), (2, -a, floor), (2, -a, b + lift - GROUND), (-2, -a, b + lift - GROUND)] for a, b in zip(z, line)]
    return closed_loft('Paint cutter', sections)


def keep_outer(obj, outer, tolerance=.0025):
    """Splits a cut solid into its outer skin, kept here, and its inner walls, returned."""
    inner = duplicate(obj, f'{obj.name} inner')
    for target, want_outer in ((obj, True), (inner, False)):
        bm = bmesh.new()
        bm.from_mesh(target.data)
        bm.faces.ensure_lookup_table()
        doomed = []
        for face in bm.faces:
            hit, normal, _, distance = outer.find_nearest(face.calc_center_median())
            # Only opposite-facing counts against it: at the thin tail a neighbour can point well away.
            on_skin = hit is not None and distance < tolerance and normal.dot(face.normal) > -.2
            if on_skin != want_outer:
                doomed.append(face)
        bmesh.ops.delete(bm, geom=doomed, context='FACES')
        bm.to_mesh(target.data)
        bm.free()
    return inner


def join(name, objects, mat=None):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = joined.data.name = name
    if mat:
        paint_slots(joined, mat)
        for polygon in joined.data.polygons:
            polygon.material_index = 0
    joined.select_set(False)
    return joined


def split_loose(obj):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='LOOSE')
    bpy.ops.object.mode_set(mode='OBJECT')
    pieces = list(bpy.context.selected_objects)
    bpy.ops.object.select_all(action='DESELECT')
    return pieces


def centre(obj):
    verts = [v.co for v in obj.data.vertices]
    return sum(verts, Vector()) / len(verts)


def inset(obj, amount):
    """Sits glass just under the skin it was cut from."""
    obj.data.update()
    for vertex in obj.data.vertices:
        vertex.co -= vertex.normal * amount
    obj.data.update()


class Seams:
    """Panel lines: thin ribbons draped on the skin, from side, top or bottom."""
    def __init__(self):
        self.verts, self.faces = [], []

    def _ribbon(self, points, width, step, cast, offset):
        for (a0, b0), (a1, b1) in zip(points, points[1:]):
            length = math.hypot(a1 - a0, b1 - b0)
            if length < 1e-6:
                continue
            count = max(1, int(length / step))
            ox, oy = -(b1 - b0) / length * width / 2, (a1 - a0) / length * width / 2
            previous = None
            for k in range(count + 1):
                a, b = a0 + (a1 - a0) * k / count, b0 + (b1 - b0) * k / count
                pair = [cast(a + sx * ox, b + sx * oy) for sx in (-1, 1)]
                if pair[0] and pair[1]:
                    base = len(self.verts)
                    self.verts += [(hit + normal * offset)[:] for hit, normal in pair]
                    if previous is not None:
                        self.faces.append((previous, base, base + 1, previous + 1))
                    previous = base
                else:
                    previous = None

    def side(self, points, tree, side, width=.008, step=.07, offset=.0035):
        def cast(z, h):
            hit, normal, _, _ = tree.ray_cast(Vector((side * 4, -z, h - GROUND)), Vector((-side, 0, 0)))
            return (hit, normal) if hit else None
        self._ribbon(points, width, step, cast, offset)

    def vertical(self, points, tree, up=True, width=.008, step=.07, offset=.0035):
        """Points are (x, z), cast down from above or up from below."""
        def cast(x, z):
            hit, normal, _, _ = tree.ray_cast(Vector((x, -z, 14 if up else -14)), Vector((0, 0, -1 if up else 1)))
            return (hit, normal) if hit else None
        self._ribbon(points, width, step, cast, offset)

    def finish(self, name, mat):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(self.verts, [], self.faces)
        mesh.update()
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()
        mesh.materials.append(mat)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def patch(name, tree, side, z0, z1, h0, h1, mat, lift=.01, embed=.006, nz=5, nh=4):
    """A small part laid on the skin and sunk into it, so it can never float."""
    sections = []
    for i in range(nz):
        z = z0 + (z1 - z0) * i / (nz - 1)
        front, back = [], []
        for k in range(nh):
            h = h0 + (h1 - h0) * k / (nh - 1)
            hit, normal, _, _ = tree.ray_cast(Vector((side * 4, -z, h - GROUND)), Vector((-side, 0, 0)))
            if not hit:
                raise RuntimeError(f'{name} misses the skin at z {z:.2f} h {h:.2f}')
            front.append((hit + normal * lift)[:])
            back.append((hit - normal * embed)[:])
        sections.append(front + back[::-1])
    return closed_loft(name, sections, mat)


def build_tail(root, white, navy, dark):
    objects = bpy.data.objects
    count = 30
    fin_group = objects['Vertical_stabilizer']
    fin_rows = smooth(FIN, step=.08, window=.1)
    fin = closed_loft('Fin_skin', [foil(lambda along, off, h=r[0]: (off, -along, h - GROUND), r[1], r[2], r[3]) for r in fin_rows], white)
    fin.parent = fin_group
    # The rudder's hinge rakes aft, so a tilted mount gives the game a plain rotation about it.
    (h0, z0), (h1, z1) = RUDDER_HINGE
    bottom, top = Vector((0, -z0, h0 - GROUND)), Vector((0, -z1, h1 - GROUND))
    mount = bpy.data.objects.new('Rudder_mount', None)
    bpy.context.scene.collection.objects.link(mount)
    mount.parent = root
    mount.matrix_world = Matrix.Translation(bottom) @ Vector((0, 0, 1)).rotation_difference((top - bottom).normalized()).to_matrix().to_4x4()
    rudder_node = objects['Rudder']
    rudder_node.parent = mount
    rudder_node.matrix_local = Matrix.Identity(4)
    rudder_node['hinge'] = to_game(bottom)
    bpy.context.view_layer.update()
    rudder_rows = smooth(RUDDER, step=.08, window=.1)
    rudder = closed_loft('Rudder_skin', [foil(lambda along, off, h=r[0]: (off, -along, h - GROUND), r[1], r[2], r[3]) for r in rudder_rows], white)
    for obj in (fin, rudder):
        paint_slots(obj, white, navy)
        for polygon in obj.data.polygons:
            polygon.material_index = 1 if polygon.center.z + GROUND > TIP_PAINT else 0
    rudder.data.transform(rudder_node.matrix_world.inverted())
    rudder.parent = rudder_node

    elevator = objects['Elevator']
    hinge = Vector((0, -HINGE_Z, TAIL_H - GROUND))
    elevator.matrix_local = Matrix.Translation(hinge)
    elevator['hinge'] = to_game(hinge)
    bpy.context.view_layer.update()
    tail_table = smooth(TAILPLANE, step=.06, window=.05)
    for side, label in ((1, 'Right'), (-1, 'Left')):
        place = lambda x: (lambda along, off: (side * x, -along, TAIL_H - GROUND + off))
        fixed = [foil(place(r[0]), r[1], r[2], r[3], 0., (HINGE_Z - .012 - r[1]) / (r[2] - r[1])) for r in tail_table]
        plane = closed_loft(f'Tailplane_{label}', fixed, white)
        boot(plane, len(fixed), count, dark)
        plane.parent = root
        # Inboard, the elevator is cut back so the rudder can swing past it.
        moving = []
        for r in tail_table:
            if r[0] < ELEVATOR_ROOT[1]:
                continue
            moving.append(foil(place(r[0]), r[1], r[2], r[3], (HINGE_Z + .012 - r[1]) / (r[2] - r[1]), 1.))
        r = tail_table[0]
        trail = HINGE_Z + .24
        moving.insert(0, foil(place(ELEVATOR_ROOT[0]), r[1], trail, r[3], (HINGE_Z + .012 - r[1]) / (trail - r[1]), 1.))
        skin = closed_loft(f'Elevator_skin_{label}', moving, white)
        skin.data.transform(elevator.matrix_world.inverted())
        skin.parent = elevator


def build_boots(wing_tree, side, dark):
    """De-ice boots wrapped round the wing's leading edge, as on most Grand Caravans."""
    table = np.array(WING)
    outer, inner = [], []
    for x in np.arange(1.25, 7.36, .1):
        lead = float(np.interp(x, table[:, 0], table[:, 1])) + WING_AFT
        height = float(np.interp(x, table[:, 0], table[:, 3])) - GROUND
        nose, nose_normal, _, _ = wing_tree.find_nearest(Vector((side * x, -lead + .7, height)))
        wrap = []
        for up, offsets in ((False, (.15, .10, .06, .03, .012)), (None, (0,)), (True, (.012, .03, .06, .10, .15))):
            for back in offsets:
                hit = None
                if up is not None:
                    hit, normal, _, _ = wing_tree.ray_cast(Vector((side * x, nose.y - back, 14 if up else -14)), Vector((0, 0, -1 if up else 1)))
                if hit is None:
                    hit, normal = nose, nose_normal
                wrap.append((hit, normal))
        outer.append([(hit + normal * .007)[:] for hit, normal in wrap])
        inner.append([(hit - normal * .005)[:] for hit, normal in wrap])
    return closed_loft(f'Wing_boot_{"Right" if side > 0 else "Left"}', [o + i[::-1] for o, i in zip(outer, inner)], dark)


def world_tree(obj):
    """BVHTree.FromObject works in the object's own space, which ignores where its node has moved."""
    verts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    return BVHTree.FromPolygons(verts, [p.vertices for p in obj.data.polygons])


def frame_around(pieces, name, mat, tree, width=.022, lift=.006, sink=.012):
    """A window frame made from each pane's own edge, so it follows the cut exactly."""
    verts, faces = [], []
    for piece in pieces:
        bm = bmesh.new()
        bm.from_mesh(piece.data)
        bm.transform(piece.matrix_world)
        bm.normal_update()
        for edge in bm.edges:
            if not edge.is_boundary:
                continue
            a, b = edge.verts[0].co, edge.verts[1].co
            # The skin's direction, not the pane's: cuts leave slivers with useless normals.
            normal = tree.find_nearest((a + b) / 2)[1]
            across = (b - a).cross(normal)
            if across.length < 1e-7:
                continue
            across = across.normalized() * width / 2
            base = len(verts)
            verts += [(a - across + normal * lift)[:], (b - across + normal * lift)[:], (b + across + normal * lift)[:], (a + across + normal * lift)[:],
                      (a - normal * sink)[:], (b - normal * sink)[:]]
            faces += [(base, base + 1, base + 2, base + 3), (base, base + 4, base + 5, base + 1), (base + 3, base + 2, base + 5, base + 4)]
        bm.free()
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def lighten(objects, patterns):
    """The CAD tires and hoses carry far more triangles than the game can show."""
    for name_pattern, ratio in patterns:
        for obj in objects:
            if obj.type == 'MESH' and re.match(name_pattern, obj.name):
                reduce = obj.modifiers.new('lighter', 'DECIMATE')
                reduce.ratio = ratio
                apply_all(obj)


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(REVIEW, exist_ok=True)
    bpy.ops.import_scene.gltf(filepath=CAD)
    objects = bpy.data.objects
    root = objects['Heron_UT9']
    metal = next(m for m in bpy.data.materials if m.name.startswith('Metal'))
    for obj in [o for o in objects if o.type == 'MESH' and REPLACED.match(o.name)]:
        bpy.data.objects.remove(obj, do_unlink=True)

    white = material('Paint • Heron glacier white, navy and copper', (.86, .87, .88), .3)
    navy = material('Paint • Heron glacier white, navy and copper', (.018, .05, .13), .32)
    copper = material('Paint • Heron glacier white, navy and copper', (.55, .22, .08), .35)
    glass = material('Glazing • Heron flush tinted windows', (.02, .05, .06), .1, alpha=.66)
    liner = material('Fabric • Heron cabin liner', (.13, .13, .14), .8)
    seam = material('Seam • Heron panels', (.3, .32, .35), .7)
    frame = material('Seam • Heron window frames', (.05, .055, .06), .5)
    rubber = material('Rubber • Heron de-ice boot', (.018, .018, .02), .85)
    dark = material('Rubber • Heron inlet', (.008, .008, .009), .9)
    hot_metal = material('Metal • Heron exhaust', (.3, .25, .2), .42, 1.)

    # ---- Move what stays in CAD to where the real aircraft has it ----
    for label in ('Left', 'Right'):
        wing = objects[f'Wing_{label}']
        wing.location.y -= WING_AFT
        for node in family(wing):
            if 'hinge' in node:
                x, y, z = node['hinge']
                node['hinge'] = [x, y, z + WING_AFT]
    propeller = objects['Propeller']
    propeller.location.z -= PROP_DOWN
    x, y, z = propeller['hinge']
    propeller['hinge'] = [x, y - PROP_DOWN, z]
    bpy.context.view_layer.update()

    # ---- One continuous body, then real cuts through it ----
    dorsal = [(z, .02 + .08 * min(1, (z - 4.3) / .9), roof, 2.2, 2.2, 2.2, .5) for z, roof in DORSAL]
    solid, shading = fuse('Heron_body', [rows(BODY), rows(WING_FAIRING), rows(dorsal, window=.2), rows(TAIL_FAIRING, window=.2)])
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    skin = BVHTree.FromObject(solid, depsgraph)
    outer = skin

    side_windows = [rounded_rect(z, h, .2, .17) for z, h in CABIN_WINDOWS]
    openings = prism([WINDSHIELD, PILOT_WINDOW] + side_windows)
    # Glass is cut from the skin itself, so it follows every curve of the body.
    panes = boolean(duplicate(solid, 'Glass'), 'INTERSECT', openings)
    inner_panes = keep_outer(panes, outer)
    remove(inner_panes)
    glazing = []
    for piece in split_loose(panes):
        glazing.append(piece)
        c = centre(piece)
        z, label = -c.y, 'Right' if c.x > 0 else 'Left'
        paint_slots(piece, glass)
        for polygon in piece.data.polygons:
            polygon.material_index = 0
        inset(piece, .007)
        piece.parent = root
        if z < -1.0 and abs(c.x) < .75 and len(piece.data.vertices) > 40 and c.z + GROUND > 2.2:
            piece.name = 'Windshield'
        elif z < -.5:
            piece.name = f'Crew_window_{label}'
        else:
            index = min(range(len(CABIN_WINDOWS)), key=lambda i: abs(CABIN_WINDOWS[i][0] - z)) + 1
            piece.name = f'Cabin_window_{label}_{index}'

    cabin = [(r[0], r[1] - WALL, r[2] - WALL, max(CABIN_FLOOR, r[3] + WALL), r[4], 4.5, r[6]) for r in smooth(BODY) if -2.2 <= r[0] <= 4.6]
    hollow = closed_loft('Cabin cutter', [section(*r) for r in cabin])
    shell = boolean(duplicate(solid, 'Shell'), 'DIFFERENCE', hollow)
    boolean(shell, 'DIFFERENCE', openings)
    remove(hollow)
    remove(openings)

    # ---- Paint, with crisp edges from real cuts ----
    with_stripe = volume_below(PAINT_LINE, STRIPE)
    below = volume_below(PAINT_LINE)
    belly = boolean(duplicate(shell, 'Curved_belly_livery'), 'INTERSECT', below)
    stripe = boolean(boolean(duplicate(shell, 'Cabin_cheatline'), 'INTERSECT', with_stripe), 'DIFFERENCE', below)
    upper = boolean(duplicate(shell, 'Fuselage'), 'DIFFERENCE', with_stripe)
    remove(shell), remove(below), remove(with_stripe)
    inner = []
    for part, paint in ((upper, white), (belly, navy), (stripe, copper)):
        inner.append(keep_outer(part, outer))
        paint_slots(part, paint)
        for polygon in part.data.polygons:
            polygon.material_index = 0
            polygon.use_smooth = True
        part.parent = root
    cabin_liner = join('Cabin_liner', inner, liner)
    cabin_liner.parent = root
    for polygon in cabin_liner.data.polygons:
        polygon.use_smooth = False
    # The dense copy's normals keep the light skin's shading smooth.
    for part in (upper, belly, stripe):
        transfer = part.modifiers.new('shading', 'DATA_TRANSFER')
        transfer.object = shading
        transfer.use_loop_data = True
        transfer.data_types_loops = {'CUSTOM_NORMAL'}
        transfer.loop_mapping = 'NEAREST_POLYNOR'
        apply_all(part)
    remove(shading)

    # ---- Separate shapes ----
    pod = closed_loft('Cargo_pod', rows(POD), navy)
    pod.parent = root
    chin = closed_loft('Chin_cowling', rows(CHIN, window=.15), navy)
    chin.parent = root
    inlet = closed_loft('Engine_inlet', rows([(-3.975, .17, 1.72, 1.56, 2.4, 2.4, .5), (-3.80, .2, 1.74, 1.54, 2.4, 2.4, .5)], step=.05, window=.01), dark)
    inlet.parent = root
    for side, label in ((1, 'Right'), (-1, 'Left')):
        fairing = closed_loft(f'Gear_fairing_{label}', rows(GEAR_FAIRING, cx=side * .80, window=.15), navy)
        fairing.parent = root
    exhaust = [[(x + a * math.cos(2 * math.pi * k / 32), -z, h - GROUND + b * math.sin(2 * math.pi * k / 32)) for k in range(32)] for x, z, h, a, b in EXHAUST]
    stack = closed_loft('Exhaust_Right', exhaust, hot_metal)
    stack.parent = root
    x, z, h, a, b = EXHAUST[-1]
    throat = [[(x + .82 * a * math.cos(2 * math.pi * k / 32), -(z + along), h - GROUND + .82 * b * math.sin(2 * math.pi * k / 32)) for k in range(32)] for along in (-.04, .006)]
    closed_loft('Exhaust_throat', throat, dark).parent = root
    build_tail(root, white, navy, rubber)

    # ---- Wing struts and boots ----
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    wing_trees = {}
    for side, label in ((1, 'Right'), (-1, 'Left')):
        wing_node = objects[f'Wing_{label}']
        skin_mesh = objects[f'Wing_skin_{label}']
        wing_trees[label] = world_tree(skin_mesh)
        (x0, z0, h0), (x1, z1, h1) = STRUT
        start, end = Vector((side * x0, -z0, h0 - GROUND)), Vector((side * x1, -z1, h1 - GROUND))
        sections = []
        for t in np.linspace(0, 1, 14):
            at = start.lerp(end, float(t))
            half = .05 if t < .9 else .05 - (float(t) - .9) * .15
            sections.append(foil(lambda along, off, at=at: (at.x, at.y + along, at.z + off), .17, -.17, half, count=12))
        strut = closed_loft(f'Wing_strut_{label}', sections, white)
        strut.data.transform(wing_node.matrix_world.inverted())
        strut.parent = wing_node
        for name, at in ((f'Strut_attach_{label}_root', start), (f'Strut_attach_{label}_wing', end)):
            fitting = closed_loft(name, [[(at.x + a, at.y + b, at.z + dz) for a, b in ((-.05, -.13), (.05, -.13), (.05, .13), (-.05, .13))] for dz in (-.07, .07)], metal)
            fitting.data.transform(wing_node.matrix_world.inverted())
            fitting.parent = wing_node
        boots = build_boots(wing_trees[label], side, rubber)
        boots.data.transform(wing_node.matrix_world.inverted())
        boots.parent = wing_node

    # ---- Fit what stays to the new cabin and roof ----
    behind_screen = Matrix.Translation((0, -COCKPIT_AFT, -.06))
    for obj in objects:
        if obj.type == 'MESH' and re.match(r'^(Instrument_panel|Panel_support|Yoke_|Throttle_|Display_bezel)', obj.name):
            world = behind_screen @ obj.matrix_world
            obj.data = obj.data.copy()
            obj.data.transform((obj.parent.matrix_world.inverted() if obj.parent else Matrix.Identity(4)) @ world)
            obj.data.update()
            obj.matrix_world = obj.parent.matrix_world if obj.parent else Matrix.Identity(4)
    def seat_on_roof(names, old_z, old_h, new_z):
        hit = skin.ray_cast(Vector((0, -new_z, 14)), Vector((0, 0, -1)))[0]
        move = Matrix.Translation((0, -(new_z - old_z), hit.z - .012 - (old_h - GROUND)))
        for name in names:
            obj = objects[name]
            world = move @ obj.matrix_world
            obj.data = obj.data.copy()
            obj.data.transform((obj.parent.matrix_world.inverted() if obj.parent else Matrix.Identity(4)) @ world)
            obj.data.update()
            obj.matrix_world = obj.parent.matrix_world if obj.parent else Matrix.Identity(4)
    seat_on_roof(['Beacon_base', 'Beacon_lens'], 2.70, 3.01, 3.95)
    seat_on_roof(['Dorsal_antenna'], 1.80, 2.99, 5.05)

    # ---- Small parts laid on the skin ----
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    pod_tree = BVHTree.FromObject(pod, depsgraph)
    for side, label in ((1, 'Right'), (-1, 'Left')):
        for k, h in enumerate((1.88, 1.83, 1.78)):
            patch(f'Cooling_slot_{label}_{k + 1}', skin, side, -3.06, -2.84, h, h + .016, dark, lift=.003).parent = root
        patch(f'Door_handle_{label}_crew', skin, side, -.92, -.70, 2.02, 2.06, metal, lift=.02).parent = root
        for k, (z0, z1) in enumerate(POD_DOORS):
            for j, at in enumerate((.3, .7)):
                z = z0 + (z1 - z0) * at
                patch(f'Cargo_latch_{label}_{k + 1}_{j + 1}', pod_tree, side, z - .05, z + .05, .94, .98, metal, lift=.008).parent = root
    patch('Door_handle_Left_cargo', skin, -1, 2.55, 2.77, 2.02, 2.06, metal, lift=.02).parent = root

    # ---- Panel lines and frames ----
    seams = Seams()
    outline = lambda points: list(points) + [points[0]]
    for side in (1, -1):
        seams.side(outline(CREW_DOOR), skin, side)
        # Firewall, cowl split and the skin laps along the cabin.
        seams.side([(-2.24, 1.30), (-2.24, 2.40)], skin, side)
        seams.side([(-3.86, 1.98), (-2.24, 1.98)], skin, side)
        seams.side([(-3.34, 1.42), (-3.34, 2.33)], skin, side)
        seams.side(outline([(-2.72, 2.08), (-2.72, 2.20), (-2.48, 2.20), (-2.48, 2.08)]), skin, side)
        seams.side([(-.60, 2.66), (4.6, 2.50)], skin, side)
        seams.side([(-.60, 1.80), (5.6, 1.84)], skin, side, width=.006)
        for z in (.05, .85, 1.60, 2.42, 4.25, 4.85, 5.45, 6.05):
            roof = float(np.interp(z, [r[0] for r in BODY], [r[2] for r in BODY]))
            seams.side([(z, 1.34 if z < 3 else 1.5 + (z - 3) * .22), (z, roof - .22)], skin, side, width=.006)
        for z0, z1 in POD_DOORS:
            seams.side(outline([(z0, .66), (z0, 1.04), (z1, 1.04), (z1, .66)]), pod_tree, side)
    seams.side(outline(CARGO_DOOR), skin, -1)
    seams.side([(3.07, 1.26), (3.07, 2.60)], skin, -1)
    seams.side(outline([(1.82, 1.84), (1.82, 2.50), (2.38, 2.50), (2.38, 1.84)]), skin, 1)
    for x in (.42, -.42):
        seams.vertical([(x, 3.8), (x, 6.2)], skin, True, width=.006)
        seams.vertical([(x, -3.8), (x, -2.3)], skin, True, width=.006)
        seams.vertical([(x, 3), (x, 7.4)], skin, False, width=.006)
    for z in (-3.34, -2.24):
        seams.vertical([(-.68, z), (.68, z)], skin, True)
    for z in (3.9, 4.9, 5.9):
        seams.vertical([(-.86, z), (.86, z)], skin, True, width=.006)
    wing = np.array(WING)
    for side, label in ((1, 'Right'), (-1, 'Left')):
        tree = wing_trees[label]
        for up in (True, False):
            for x in WING_RIBS:
                lead = float(np.interp(x, wing[:, 0], wing[:, 1])) + WING_AFT
                chord = float(np.interp(x, wing[:, 0], wing[:, 2]))
                seams.vertical([(side * x, lead + .03), (side * x, lead + chord * .6)], tree, up, width=.006)
            for fraction in (.26, .58):
                span = [(side * x, float(np.interp(x, wing[:, 0], wing[:, 1])) + WING_AFT + fraction * float(np.interp(x, wing[:, 0], wing[:, 2]))) for x in (1.0, 2.5, 4.8, 6.2, 7.4)]
                seams.vertical(span, tree, up, width=.006)
    seams.finish('Panel_lines', seam).parent = root

    frame_around(glazing, 'Window_frames', frame, skin).parent = root
    post = Seams()
    post.vertical([(0, -2.17), (0, -1.08)], skin, True, width=.05, step=.05, offset=.009)
    post.finish('Windshield_post', frame).parent = root
    remove(solid)
    lighten(list(objects), ((r'^(Nose|Main)_tire', .45), (r'^Brake_hose', .3), (r'^Propeller_Blade', .55), (r'^Beacon_lens', .3)))
    return root


def bounds(objects):
    low, high = Vector((1e9, 1e9, 1e9)), Vector((-1e9, -1e9, -1e9))
    for obj in objects:
        if obj.type != 'MESH':
            continue
        for vertex in obj.data.vertices:
            world = obj.matrix_world @ vertex.co
            low = Vector(map(min, low, world))
            high = Vector(map(max, high, world))
    return low, high


def render_views(centre_point, reach):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('sky')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (.62, .74, .86, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = .9
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    scene.collection.objects.link(sun)
    sun.data.energy = 3.4
    sun.rotation_euler = (math.radians(52), math.radians(8), math.radians(150))
    camera = bpy.data.objects.new('camera', bpy.data.cameras.new('camera'))
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.lens = 70
    camera.data.clip_end = 2000
    for name, direction, focus, scale in (
        ('front-quarter', (.8, 1.05, .32), centre_point, 1.5), ('rear-quarter', (-.75, -1.05, .3), centre_point, 1.5),
        ('front', (0, 1.7, .08), centre_point, 1.5), ('top', (0, .001, 1.75), centre_point, 1.5), ('under-quarter', (.8, .9, -.45), centre_point, 1.5),
        ('close-nose', (.75, 1.0, .25), Vector((0, 2.4, .1)), .62), ('close-cabin', (-1, .25, .12), Vector((0, -1.5, .2)), .72),
        ('close-tail', (-.85, -.8, .35), Vector((0, -6.6, .9)), .55),
    ):
        camera.location = focus + Vector(direction) * reach * scale
        camera.rotation_euler = (focus - camera.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = f'{REVIEW}/{name}.png'
        bpy.ops.render.render(write_still=True)
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 1920 / 141.3
    scene.render.resolution_x, scene.render.resolution_y = 1920, 1280
    camera.location = (-30, 4.5 - (1920 / 2 - 55) / 141.3, -GROUND + (854 - 640) / 130.6)
    camera.rotation_euler = (math.radians(90), 0, math.radians(-90))
    scene.render.pixel_aspect_y = 141.3 / 130.6
    scene.render.filepath = f'{REVIEW}/side.png'
    bpy.ops.render.render(write_still=True)
    scene.render.pixel_aspect_y = 1


def clean_material_names(path):
    """Blender numbers repeated names, but the game's finish code matches them exactly."""
    with open(path, 'rb') as f:
        data = bytearray(f.read())
    length = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20 + length])
    for mat in gltf.get('materials', []):
        mat['name'] = re.sub(r'\.\d{3}$', '', mat['name'])
    chunk = json.dumps(gltf, separators=(',', ':')).encode()
    chunk += b' ' * (-len(chunk) % 4)
    rest = data[20 + length:]
    out = bytearray(data[:12]) + struct.pack('<I', len(chunk)) + data[16:20] + chunk + rest
    struct.pack_into('<I', out, 8, len(out))
    with open(path, 'wb') as f:
        f.write(out)


def export(root):
    bpy.ops.object.select_all(action='DESELECT')
    for o in family(root):
        o.hide_set(False)
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_format='GLB', export_apply=True, export_extras=True, export_yup=True, export_normals=True, export_animations=False)
    clean_material_names(OUT)
    print('EXPORTED', os.path.getsize(OUT), 'bytes')


def main():
    root = build()
    bpy.context.view_layer.update()
    scene_objects = list(family(root))
    low, high = bounds(scene_objects)
    size = high - low
    tris = 0
    for obj in scene_objects:
        if obj.type == 'MESH':
            obj.data.calc_loop_triangles()
            tris += len(obj.data.loop_triangles)
    print('SKIN size', [round(v, 4) for v in size], 'target [15.87, 12.67, 4.70]')
    print('SKIN low', [round(v, 4) for v in low], 'high', [round(v, 4) for v in high])
    print('SKIN triangles', tris, 'budget 479176')
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    if not os.environ.get('POCKET_HERON_NO_RENDER'):
        render_views((low + high) / 2, max(size))
    if not os.environ.get('POCKET_HERON_NO_EXPORT'):
        export(root)


main()
