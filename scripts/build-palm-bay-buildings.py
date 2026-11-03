"""Build Palm Bay's landmark buildings in Blender: control tower, terminal, fuel farm, lighthouse,
marina and village landmarks.

  Blender --background --python-exit-code 1 --python scripts/build-palm-bay-buildings.py

Writes one model per landmark to public/assets/scenery and review renders to output/island/buildings.
The hangars and cottages come from build-coastal-assets.py. Meters, Z up; each model stands on its
origin, with foundations carried below ground so it can never hover. Before export, every part must
reach the first part through real contact, or the build fails.
"""
import bmesh, bpy, math, os
from mathutils import Vector
from mathutils.bvhtree import BVHTree

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = BASE + '/public/assets/scenery'
REVIEW = BASE + '/output/island/buildings'
TOUCHING = .012
COLOURS = {
    'stucco': ((.74, .71, .62), .85), 'trim': ((.8, .79, .73), .7), 'concrete': ((.36, .36, .33), .95), 'white': ((.82, .82, .78), .6),
    'glass': ((.03, .09, .11), .12), 'frame': ((.1, .11, .12), .5), 'steel': ((.24, .26, .27), .55), 'coral': ((.42, .15, .09), .75),
    'roof': ((.2, .27, .27), .6), 'wood': ((.24, .16, .09), .85), 'deck': ((.33, .25, .16), .9), 'deck2': ((.27, .2, .13), .9),
    'piling': ((.13, .1, .07), .95), 'red': ((.5, .06, .04), .5), 'navy': ((.03, .07, .15), .5), 'lamp': ((.95, .85, .55), .3),
    'stone': ((.3, .29, .26), .95), 'dark': ((.03, .03, .035), .8), 'sign': ((.05, .16, .2), .5), 'hull': ((.8, .8, .76), .45),
}
materials = {}


def mat(name):
    if name not in materials:
        colour, roughness = COLOURS[name]
        m = bpy.data.materials.new(f'Palm Bay {name}')
        m.use_nodes = True
        node = m.node_tree.nodes['Principled BSDF']
        node.inputs['Base Color'].default_value = (*colour, 1)
        node.inputs['Roughness'].default_value = roughness
        if name in ('glass',):
            node.inputs['Metallic'].default_value = .2
        materials[name] = m
    return materials[name]


class Model:
    def __init__(self, name):
        self.name = name
        self.parts = []

    def add(self, name, verts, faces, paint, smooth=False):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([tuple(v) for v in verts], [], faces)
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()
        mesh.materials.append(mat(paint))
        for polygon in mesh.polygons:
            polygon.use_smooth = smooth
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        self.parts.append(obj)
        return obj

    def box(self, paint, centre, size, name='box', taper=1.):
        cx, cy, cz = centre
        sx, sy, sz = (s / 2 for s in size)
        verts = [(cx + a * sx * (taper if c > 0 else 1), cy + b * sy * (taper if c > 0 else 1), cz + c * sz) for c in (-1, 1) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        return self.add(name, verts, faces, paint)

    def bar(self, paint, a, b, width, name='bar'):
        a, b = Vector(a), Vector(b)
        axis = (b - a).normalized()
        side = axis.cross(Vector((0, 0, 1)) if abs(axis.z) < .95 else Vector((1, 0, 0))).normalized() * width / 2
        up = axis.cross(side).normalized() * width / 2
        ring = lambda p: [p + side + up, p - side + up, p - side - up, p + side - up]
        return self.add(name, ring(a) + ring(b), [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], paint)

    def loft(self, paint, rings, name='loft', smooth=True, caps=True):
        """Round sections: (x, y, z, radius) or (x, y, z, rx, ry), stacked in order."""
        sides = 16
        verts, faces = [], []
        for ring in rings:
            x, y, z, rx = ring[:4]
            ry = ring[4] if len(ring) > 4 else rx
            verts += [(x + rx * math.cos(2 * math.pi * k / sides), y + ry * math.sin(2 * math.pi * k / sides), z) for k in range(sides)]
        for i in range(len(rings) - 1):
            for k in range(sides):
                a, b = i * sides + k, i * sides + (k + 1) % sides
                faces.append((a, b, b + sides, a + sides))
        if caps:
            faces.append(tuple(range(sides - 1, -1, -1)))
            faces.append(tuple(range((len(rings) - 1) * sides, len(rings) * sides)))
        return self.add(name, verts, faces, paint, smooth)

    def polygon_prism(self, paint, points, z0, z1, name='prism', top_scale=1., centre=(0, 0)):
        count = len(points)
        cx, cy = centre
        verts = [(x, y, z0) for x, y in points] + [(cx + (x - cx) * top_scale, cy + (y - cy) * top_scale, z1) for x, y in points]
        faces = [tuple(range(count - 1, -1, -1)), tuple(range(count, 2 * count))]
        faces += [(k, (k + 1) % count, count + (k + 1) % count, count + k) for k in range(count)]
        return self.add(name, verts, faces, paint)

    def gable(self, paint, centre, width, length, rise, eave=.5, axis='y', name='gable roof'):
        """A pitched roof with its ridge along the given axis. Width is across the ridge."""
        cx, cy, z = centre
        w, l = width / 2 + eave, length / 2 + eave
        if axis == 'y':
            verts = [(cx - w, cy - l, z), (cx + w, cy - l, z), (cx + w, cy + l, z), (cx - w, cy + l, z), (cx, cy - l, z + rise), (cx, cy + l, z + rise)]
        else:
            verts = [(cx - l, cy - w, z), (cx - l, cy + w, z), (cx + l, cy + w, z), (cx + l, cy - w, z), (cx - l, cy, z + rise), (cx + l, cy, z + rise)]
        return self.add(name, verts, [(0, 1, 4), (2, 3, 5), (0, 4, 5, 3), (1, 2, 5, 4), (0, 3, 2, 1)], paint)

    def hip(self, paint, centre, width, length, rise, eave=.7, name='hip roof'):
        cx, cy, z = centre
        w, l = width / 2 + eave, length / 2 + eave
        ridge = max(0, l - w)
        verts = [(cx - w, cy - l, z), (cx + w, cy - l, z), (cx + w, cy + l, z), (cx - w, cy + l, z), (cx, cy - ridge, z + rise), (cx, cy + ridge, z + rise)]
        return self.add(name, verts, [(0, 1, 4), (2, 3, 5), (1, 2, 5, 4), (3, 0, 4, 5), (0, 3, 2, 1)], paint)

    def check_contact(self):
        """Walks outward from the first part through real contact. Anything left over is floating."""
        trees = {}
        for obj in self.parts:
            trees[obj] = BVHTree.FromPolygons([v.co for v in obj.data.vertices], [p.vertices for p in obj.data.polygons])
        joined, frontier = {self.parts[0]}, [self.parts[0]]
        waiting = set(self.parts[1:])
        while frontier:
            current = frontier.pop()
            for obj in list(waiting):
                near = trees[obj].overlap(trees[current]) or any(
                    (trees[current].find_nearest(v.co)[3] or 9) <= TOUCHING for v in obj.data.vertices)
                if near:
                    waiting.remove(obj)
                    joined.add(obj)
                    frontier.append(obj)
        if waiting:
            raise RuntimeError(f'{self.name}: floating parts: {sorted(o.name for o in waiting)[:12]}')

    def finish(self):
        self.check_contact()
        by_paint = {}
        for obj in self.parts:
            by_paint.setdefault(obj.data.materials[0].name, []).append(obj)
        merged = []
        for paint, objects in by_paint.items():
            bpy.ops.object.select_all(action='DESELECT')
            for obj in objects:
                obj.select_set(True)
            bpy.context.view_layer.objects.active = objects[0]
            if len(objects) > 1:
                bpy.ops.object.join()
            active = bpy.context.view_layer.objects.active
            active.name = f'{self.name}: {paint}'
            merged.append(active)
        bpy.ops.object.select_all(action='DESELECT')
        for obj in merged:
            obj.select_set(True)
        bpy.ops.export_scene.gltf(filepath=f'{OUT}/{self.name}.glb', use_selection=True, export_format='GLB', export_yup=True, export_normals=True, export_animations=False)
        tris = 0
        for obj in merged:
            obj.data.calc_loop_triangles()
            tris += len(obj.data.loop_triangles)
        print('BUILT', self.name, tris, 'triangles', os.path.getsize(f'{OUT}/{self.name}.glb'), 'bytes')
        return merged


def octagon(radius, turn=math.pi / 8):
    return [(radius * math.cos(turn + k * math.pi / 4), radius * math.sin(turn + k * math.pi / 4)) for k in range(8)]


def control_tower():
    m = Model('airfield-tower')
    m.box('concrete', (0, 0, -.3), (10.6, 12.6, 1.2), 'foundation')
    m.box('stucco', (0, 0, 2.3), (10, 12, 4.2), 'ops block')
    m.box('trim', (0, 0, 4.5), (10.8, 12.8, .3), 'ops roof')
    for y in (-4.2, -2.1, 0, 2.1, 4.2):
        for x in (-5.01, 5.01):
            m.box('frame', (x, y, 2.5), (.05, 1.5, 1.4), 'window frame')
            m.box('glass', (x + (.015 if x > 0 else -.015), y, 2.5), (.04, 1.3, 1.2), 'window')
    for x in (-3, 0, 3):
        m.box('frame', (x, -6.01, 2.5), (1.6, .05, 1.4), 'window frame')
        m.box('glass', (x, -6.03, 2.5), (1.4, .04, 1.2), 'window')
    m.box('frame', (-5.01, 5.4, 1.6), (.06, 1.2, 2.4), 'door')
    # The shaft narrows as it rises, with a strip of stair windows up one side.
    m.box('stucco', (0, 0, 7.6), (4.4, 4.4, 7), 'shaft', taper=.86)
    for z in (5.8, 7.4, 9.0, 10.4):
        m.box('glass', (-2.2 + (z - 4.6) * .045, 0, z), (.1, .8, 1), 'stair window')
    # A cab that leans outward, so the controllers' glass does not reflect the sky back at them.
    m.polygon_prism('concrete', octagon(3.5), 10.9, 11.25, 'cab floor')
    m.polygon_prism('stucco', octagon(2.75), 11.2, 12.05, 'cab sill')
    m.polygon_prism('glass', octagon(2.72), 12, 14.15, 'cab glass', top_scale=1.17)
    corners = octagon(2.78)
    for x, y in corners:
        m.bar('frame', (x, y, 12), (x * 1.17, y * 1.17, 14.16), .09, 'mullion')
    m.polygon_prism('trim', octagon(3.7), 14.1, 14.42, 'cab roof')
    # Catwalk rail.
    rail = octagon(3.42)
    for i, (x, y) in enumerate(rail):
        nx, ny = rail[(i + 1) % 8]
        m.bar('steel', (x, y, 11.2), (x, y, 12.3), .055, 'rail post')
        m.bar('steel', (x, y, 12.28), (nx, ny, 12.28), .05, 'rail')
    m.bar('steel', (0, 0, 14.4), (0, 0, 17.6), .09, 'mast')
    m.loft('red', [(0, 0, 17.5, .1), (0, 0, 17.7, .2), (0, 0, 17.95, .1)], 'beacon')
    m.bar('steel', (1.6, 1.2, 14.4), (1.6, 1.2, 15.8), .05, 'antenna')
    m.box('steel', (-1.4, -1.2, 14.7), (1, 1, .7), 'roof unit')
    return m


def terminal():
    # Faces the runway along -X, with its length along Y.
    m = Model('airfield-terminal')
    m.box('concrete', (0, 0, -.3), (13, 29, 1.2), 'foundation')
    m.box('stucco', (0, 0, 2.2), (11, 26, 4.4), 'hall')
    m.hip('coral', (0, 0, 4.35), 11, 26, 3, .9, 'roof')
    # A deep veranda along the front, as open-air island terminals have.
    m.box('concrete', (-7.2, 0, .1), (4, 26, .3), 'veranda floor')
    m.add('veranda roof', [(-5.3, -13.6, 4.5), (-5.3, 13.6, 4.5), (-9.6, 13.6, 3.7), (-9.6, -13.6, 3.7)], [(0, 1, 2, 3)], 'coral')
    for y in (-13, -8.67, -4.33, 0, 4.33, 8.67, 13):
        m.bar('white', (-9.1, y, 0), (-9.1, y, 3.85), .28, 'post')
    for y in (-11, -7, -3, 3, 7, 11):
        m.box('trim', (-5.52, y, 2.2), (.08, 2.4, 2.4), 'window frame')
        m.box('glass', (-5.56, y, 2.2), (.06, 2, 2), 'window')
    m.box('trim', (-5.52, 0, 1.6), (.08, 3.2, 2.9), 'door frame')
    m.box('glass', (-5.56, 0, 1.6), (.06, 2.8, 2.6), 'doors')
    m.box('frame', (-5.6, 0, 1.6), (.03, .1, 2.6), 'door split')
    for y in (-10, -5, 0, 5, 10):
        m.box('trim', (5.52, y, 2.4), (.08, 1.8, 1.5), 'rear window frame')
        m.box('glass', (5.56, y, 2.4), (.06, 1.5, 1.2), 'rear window')
    # The name board stands on the veranda roof, held up by the two posts beneath it.
    m.box('sign', (-9.25, 0, 4.55), (.16, 8, 1.1), 'name board')
    m.bar('white', (-9.25, -3.5, 3.6), (-9.25, -3.5, 5), .12, 'board post')
    m.bar('white', (-9.25, 3.5, 3.6), (-9.25, 3.5, 5), .12, 'board post')
    bpy.ops.object.text_add(location=(-9.36, 0, 4.26), rotation=(math.pi / 2, 0, -math.pi / 2))
    text = bpy.context.object
    text.data.body = 'PALM BAY'
    text.data.size = .78
    text.data.align_x = 'CENTER'
    text.data.extrude = .02
    bpy.ops.object.convert(target='MESH')
    letters = bpy.context.object
    letters.name = 'name letters'
    letters.data.transform(letters.matrix_world)
    letters.matrix_world.identity()
    letters.data.materials.clear()
    letters.data.materials.append(mat('white'))
    m.parts.append(letters)
    return m


def fuel_farm():
    m = Model('airfield-fuel')
    m.box('concrete', (0, 0, -.1), (14, 8, .8), 'pad')
    for y in (-1.9, 1.9):
        verts, faces = [], []
        for i, x in enumerate((-5, -4.8, 4.8, 5)):
            radius = 1.05 if x in (-5, 5) else 1.4
            verts += [(x, y + radius * math.cos(2 * math.pi * k / 18), 2.2 + radius * math.sin(2 * math.pi * k / 18)) for k in range(18)]
        for i in range(3):
            for k in range(18):
                a, b = i * 18 + k, i * 18 + (k + 1) % 18
                faces.append((a, b, b + 18, a + 18))
        faces += [tuple(range(17, -1, -1)), tuple(range(54, 72))]
        m.add('tank', verts, faces, 'white', True)
        band = [(x, y + 1.408 * math.cos(2 * math.pi * k / 18), 2.2 + 1.408 * math.sin(2 * math.pi * k / 18)) for x in (-.5, .5) for k in range(18)]
        m.add('tank band', band, [(k, (k + 1) % 18, 18 + (k + 1) % 18, 18 + k) for k in range(18)], 'red', True)
        for x in (-3.4, 3.4):
            m.box('concrete', (x, y, .55), (.6, 2.2, 1.4), 'saddle')
    m.box('steel', (6.1, 0, .9), (1.2, 1.2, 1.8), 'pump')
    m.bar('steel', (5, -1.9, 2.2), (6.1, -.2, 1.5), .1, 'pipe')
    m.bar('steel', (5, 1.9, 2.2), (6.1, .2, 1.5), .1, 'pipe')
    # A low bund around it.
    for a, b in (((-7, -4), (7, -4)), ((7, -4), (7, 4)), ((7, 4), (-7, 4)), ((-7, 4), (-7, -4))):
        m.bar('concrete', (*a, .25), (*b, .25), .3, 'bund')
    return m


def lighthouse():
    m = Model('palm-bay-lighthouse')
    m.loft('stone', [(0, 0, -1.2, 4.2), (0, 0, .35, 4.2)], 'plinth')
    rings = [(0, 0, .3, 3.3), (0, 0, 6, 2.75), (0, 0, 12, 2.25), (0, 0, 17.2, 1.95)]
    m.loft('white', rings, 'tower')
    # The bands follow the tower's own taper, so they lie on its surface.
    def radius_at(z):
        for (_, _, z0, r0), (_, _, z1, r1) in zip(rings, rings[1:]):
            if z <= z1:
                return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
        return rings[-1][3]
    for low, high in ((5.1, 7.6), (11, 13.5)):
        m.loft('red', [(0, 0, z, radius_at(z) + .006) for z in (low, (low + high) / 2, high)], 'band', caps=False)
    m.box('wood', (0, -3.1, 1.6), (1.3, .5, 2.6), 'door')
    m.box('stone', (0, -3.2, 3.05), (1.7, .5, .3), 'lintel')
    for z, turn in ((4.2, 0), (9.2, 2.1), (14.6, 4.2)):
        r = radius_at(z)
        # Set into the wall along its radius, so a window on a round tower does not stick out as a box.
        out = Vector((math.sin(turn), -math.cos(turn), 0))
        m.bar('glass', out * (r - .2) + Vector((0, 0, z)), out * (r + .012) + Vector((0, 0, z)), .72, 'window')
    # Gallery, rail and lantern.
    m.loft('stone', [(0, 0, 17.1, 2.1), (0, 0, 17.65, 3.15)], 'gallery brackets')
    m.loft('stone', [(0, 0, 17.6, 3.15), (0, 0, 17.8, 3.15)], 'gallery')
    for k in range(16):
        a, b = 2 * math.pi * k / 16, 2 * math.pi * (k + 1) / 16
        p, q = (3 * math.cos(a), 3 * math.sin(a)), (3 * math.cos(b), 3 * math.sin(b))
        m.bar('dark', (*p, 17.7), (*p, 18.7), .05, 'rail post')
        m.bar('dark', (*p, 18.68), (*q, 18.68), .05, 'rail')
    m.loft('white', [(0, 0, 17.75, 2), (0, 0, 18.8, 2)], 'watch room')
    m.loft('glass', [(0, 0, 18.75, 1.72), (0, 0, 21, 1.72)], 'lantern glass')
    for k in range(8):
        a = 2 * math.pi * k / 8
        m.bar('dark', (1.76 * math.cos(a), 1.76 * math.sin(a), 18.75), (1.76 * math.cos(a), 1.76 * math.sin(a), 21), .08, 'lantern bar')
    m.loft('lamp', [(0, 0, 18.75, .3), (0, 0, 19.2, .42), (0, 0, 20, .42), (0, 0, 20.5, .25)], 'lamp')
    m.loft('red', [(0, 0, 20.95, 2), (0, 0, 21.55, 1.5), (0, 0, 22.3, .55), (0, 0, 22.75, .12)], 'dome')
    m.loft('dark', [(0, 0, 22.7, .1), (0, 0, 22.95, .19), (0, 0, 23.2, .05)], 'finial')
    # The keeper's cottage, joined to the tower by a covered passage.
    m.box('concrete', (9, 0, -.2), (8.6, 7.6, 1.4), 'cottage footing')
    m.box('white', (9, 0, 1.9), (8, 7, 3.4), 'cottage')
    m.gable('red', (9, 0, 3.6), 7, 8, 2.1, .5, 'x', 'cottage roof')
    m.box('stone', (3.6, 0, 1), (3.8, 1.8, 2.5), 'passage')
    for x in (7, 11):
        m.box('glass', (x, -3.52, 2.1), (1.1, .06, 1.2), 'cottage window')
    return m


def marina_pier():
    # Origin at the waterline at the middle of the pier; the deck runs along Y.
    m = Model('marina-pier')
    LENGTH, WIDTH, DECK = 75, 5.6, 2.3
    m.box('piling', (0, 0, DECK - .46), (WIDTH - .5, LENGTH, .32), 'bearer')
    y = -LENGTH / 2
    k = 0
    while y < LENGTH / 2 - 1e-6:
        step = min(1.5, LENGTH / 2 - y)
        m.box('deck' if k % 2 else 'deck2', (0, y + step / 2, DECK - .17), (WIDTH, step, .3), 'plank run')
        y += step
        k += 1
    for pair in range(7):
        y = -LENGTH / 2 + 2 + pair * (LENGTH - 4) / 6
        for side in (-1, 1):
            x = side * (WIDTH / 2 - .1)
            m.loft('piling', [(x, y, -4, .24), (x, y, DECK + .85, .2)], 'piling')
            if pair % 2 == 0:
                m.loft('piling', [(x + side * .16, y, DECK - .3, .13), (x + side * .16, y, DECK + .3, .11)], 'bollard')
    for y in (-30, 0, 30):
        m.bar('steel', (2.3, y, DECK - .1), (2.3, y, DECK + 3.4), .09, 'lamp post')
        m.loft('lamp', [(2.3, y, DECK + 3.3, .1), (2.3, y, DECK + 3.55, .19), (2.3, y, DECK + 3.75, .08)], 'lamp')
    return m


def fishing_boat():
    # Bow toward +Y, waterline at z = 0.
    m = Model('marina-boat')
    stations = [(-3.2, .95, .1, 1.02), (-2, 1.2, -.42, 1.1), (0, 1.3, -.56, 1.15), (2, 1, -.42, 1.35), (3.2, .42, -.12, 1.62), (3.9, .03, .3, 1.8)]
    verts, faces = [], []
    for y, half, keel, sheer in stations:
        verts += [(-half, y, sheer), (-half * .88, y, keel + .3), (0, y, keel), (half * .88, y, keel + .3), (half, y, sheer)]
    for i in range(len(stations) - 1):
        for k in range(4):
            a = i * 5 + k
            faces.append((a, a + 1, a + 6, a + 5))
        faces.append((i * 5 + 4, i * 5, i * 5 + 5, i * 5 + 9))
    faces += [(4, 3, 2, 1, 0), (len(verts) - 5, len(verts) - 4, len(verts) - 3, len(verts) - 2, len(verts) - 1)]
    m.add('hull', verts, faces, 'hull', True)
    m.box('red', (0, .1, .42), (2.42, 6.2, .2), 'boot stripe', taper=.96)
    m.box('deck', (0, -.5, 1.05), (2.2, 4.8, .12), 'deck')
    m.box('white', (0, .75, 1.7), (1.6, 2, 1.25), 'cabin')
    m.box('glass', (0, 1.76, 1.92), (1.3, .05, .55), 'windscreen')
    m.box('navy', (0, .75, 2.38), (1.9, 2.3, .12), 'cabin roof')
    m.bar('steel', (0, -.1, 2.4), (0, -.1, 4.4), .06, 'mast')
    m.bar('steel', (0, -.1, 3.1), (0, -2.4, 1.15), .03, 'boom stay')
    return m


def boathouse():
    # Doors face the piers along +Y... the water side. Stands on the beach.
    m = Model('marina-boathouse')
    m.box('concrete', (0, 0, -.35), (11, 15, 1.1), 'slab')
    m.box('wood', (0, 0, 1.9), (10, 14, 3.4), 'shed')
    m.gable('roof', (0, 0, 3.55), 10, 14, 2.3, .5, 'y', 'roof')
    m.box('dark', (0, 7.02, 1.5), (5.6, .06, 2.8), 'doors')
    m.box('white', (0, 7.06, 1.5), (.14, .1, 2.8), 'door split')
    m.box('white', (0, 7.05, 3.15), (6, .08, .3), 'door header')
    return m


def church():
    # The door faces -X, toward the village street.
    m = Model('village-church')
    m.box('concrete', (0, 0, -.3), (17.4, 9.4, 1.2), 'footing')
    m.box('white', (0, 0, 2.6), (16, 8, 5), 'nave')
    m.gable('roof', (0, 0, 5.05), 8, 16, 3.3, .45, 'x', 'nave roof')
    m.box('white', (-9.2, 0, 4.2), (3.2, 3.2, 8.4), 'tower')
    m.box('trim', (-9.2, 0, 8.5), (3.6, 3.6, .25), 'tower cornice')
    m.box('white', (-9.2, 0, 9.5), (2.5, 2.5, 2), 'belfry')
    m.box('dark', (-10.47, 0, 9.5), (.06, 1.1, 1.3), 'belfry opening')
    m.box('dark', (-9.2, -1.27, 9.5), (1.1, .06, 1.3), 'belfry opening')
    m.box('dark', (-9.2, 1.27, 9.5), (1.1, .06, 1.3), 'belfry opening')
    m.box('trim', (-9.2, 0, 10.55), (2.9, 2.9, .2), 'belfry cornice')
    m.polygon_prism('roof', [(-10.6, -1.4), (-7.8, -1.4), (-7.8, 1.4), (-10.6, 1.4)], 10.6, 14.6, 'spire', top_scale=.03, centre=(-9.2, 0))
    m.bar('frame', (-9.2, 0, 14.5), (-9.2, 0, 15.6), .09, 'cross post')
    m.bar('frame', (-9.2, -.3, 15.2), (-9.2, .3, 15.2), .09, 'cross arm')
    m.box('wood', (-10.84, 0, 1.4), (.1, 1.5, 2.8), 'door')
    for x in (-5, -1.7, 1.6, 4.9):
        for y in (-4.02, 4.02):
            m.box('glass', (x, y, 3), (1, .08, 2.6), 'tall window')
    return m


def village_store():
    # A false-front general store, door and porch facing -X.
    m = Model('village-store')
    m.box('concrete', (0, 0, -.3), (12.6, 10.6, 1.2), 'footing')
    m.box('stucco', (0, 0, 2.5), (12, 10, 4.8), 'store')
    m.gable('roof', (.8, 0, 4.85), 10, 10.4, 1.9, .25, 'x', 'roof')
    m.box('trim', (-6.05, 0, 3.85), (.2, 10, 3.5), 'false front')
    m.box('sign', (-6.2, 0, 4.4), (.1, 7, 1), 'name board')
    m.box('deck', (-8, 0, .3), (4, 10, .4), 'porch')
    m.add('awning', [(-5.9, -5.2, 3.25), (-5.9, 5.2, 3.25), (-9.8, 5.2, 2.9), (-9.8, -5.2, 2.9)], [(0, 1, 2, 3)], 'coral')
    for y in (-4.6, -1.55, 1.55, 4.6):
        m.bar('white', (-9.4, y, .3), (-9.4, y, 3), .18, 'porch post')
    for y in (-3.3, 3.3):
        m.box('glass', (-6.03, y, 1.5), (.06, 2.6, 1.8), 'shop window')
    m.box('wood', (-6.03, 0, 1.4), (.08, 1.5, 2.6), 'door')
    return m


def water_tower():
    m = Model('village-water-tower')
    for x, y in ((-2.4, -2.4), (2.4, -2.4), (2.4, 2.4), (-2.4, 2.4)):
        m.box('concrete', (x, y, -.1), (1, 1, 1), 'footing')
        m.bar('steel', (x, y, 0), (x * .62, y * .62, 11), .22, 'leg')
    for z, s in ((3.7, .87), (7.4, .75)):
        corners = [(-2.4 * s, -2.4 * s), (2.4 * s, -2.4 * s), (2.4 * s, 2.4 * s), (-2.4 * s, 2.4 * s)]
        for i in range(4):
            m.bar('steel', (*corners[i], z), (*corners[(i + 1) % 4], z), .1, 'brace')
    m.loft('white', [(0, 0, 10.9, 2.5), (0, 0, 14.4, 2.5)], 'tank')
    m.loft('red', [(0, 0, 14.35, 2.75), (0, 0, 15.5, 1.3), (0, 0, 16, .12)], 'tank roof')
    return m


def review(models):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 900, 640
    world = bpy.data.worlds.new('sky')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (.62, .74, .86, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = .9
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    scene.collection.objects.link(sun)
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(52), 0, math.radians(35))
    camera = bpy.data.objects.new('camera', bpy.data.cameras.new('camera'))
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.lens = 50
    everything = [o for parts in models.values() for o in parts]
    for name, parts in models.items():
        for obj in everything:
            obj.hide_render = obj not in parts
        low, high = Vector((1e9, 1e9, 1e9)), Vector((-1e9, -1e9, -1e9))
        for obj in parts:
            for v in obj.data.vertices:
                low = Vector(map(min, low, v.co))
                high = Vector(map(max, high, v.co))
        focus, reach = (low + high) / 2, max(high - low)
        camera.location = focus + Vector((-1.05, -1.25, .55)) * reach * 1.25
        camera.rotation_euler = (focus - camera.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = f'{REVIEW}/{name}.png'
        bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(REVIEW, exist_ok=True)
    models = {}
    for build in (control_tower, terminal, fuel_farm, lighthouse, marina_pier, fishing_boat, boathouse, church, village_store, water_tower):
        model = build()
        models[model.name] = model.finish()
    if not os.environ.get('POCKET_NO_REVIEW'):
        review(models)


main()
