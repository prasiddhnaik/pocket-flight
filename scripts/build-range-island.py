"""Build Anvil Key, the weapons sandbox island, inside Blender.

  Blender --background --python scripts/build-range-island.py

Saves assets/range-island.blend and exports public/assets/range/. To keep hand
sculpting, open the .blend, edit "Anvil Key terrain" (move vertices only, the grid
must stay intact) and re-export the heights and meshes with:

  POCKET_RANGE_EXPORT_ONLY=1 Blender assets/range-island.blend --background --python scripts/build-range-island.py

Layout lives in src/world/range-layout.json, shared with the game.
Metres, Z up. Blender (x, y, z) is game (x, z, -y). Targets face +Y (game -Z).
"""
import bpy, bmesh, json, math, os, random
import numpy as np
from mathutils import Matrix, Vector

BASE = os.environ.get('POCKET_FLIGHT_ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = BASE + '/public/assets/range'
BLEND = BASE + '/assets/range-island.blend'
LAYOUT = json.load(open(BASE + '/src/world/range-layout.json'))
SIZE, N = LAYOUT['size'], LAYOUT['segments']
CELL = SIZE / N
os.makedirs(OUT, exist_ok=True)
smooth = lambda a, b, x: (lambda t: t * t * (3 - 2 * t))(np.clip((x - a) / (b - a), 0, 1))


# ---- Terrain ----
def noise(x, z, scale, seed):
    r = np.random.default_rng(seed).random((256, 256))
    gx, gz = x / scale, z / scale
    ix, iz = np.floor(gx).astype(int), np.floor(gz).astype(int)
    u, v = smooth(0, 1, gx - ix), smooth(0, 1, gz - iz)
    at = lambda a, b: r[b & 255, a & 255]
    return (at(ix, iz) * (1 - u) + at(ix + 1, iz) * u) * (1 - v) + (at(ix, iz + 1) * (1 - u) + at(ix + 1, iz + 1) * u) * v


def fbm(x, z, scale, seed, octaves=5):
    total, amp, weight = 0, 1, 0
    for i in range(octaves):
        total = total + noise(x, z, scale / 2 ** i, seed + i) * amp
        weight += amp
        amp *= .5
    return total / weight


def segment_distance(x, z, a, b):
    ax, az = a
    bx, bz = b
    dx, dz = bx - ax, bz - az
    t = np.clip(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1)
    return np.hypot(x - (ax + t * dx), z - (az + t * dz)), t


def polyline_distance(x, z, line):
    best = np.full(x.shape, 1e9)
    along = np.zeros(x.shape)
    for k in range(len(line) - 1):
        d, t = segment_distance(x, z, line[k], line[k + 1])
        closer = d < best
        best = np.where(closer, d, best)
        along = np.where(closer, (k + t) / (len(line) - 1), along)
    return best, along


def erode(h, land, droplets=70000, seed=11):
    """Particle hydraulic erosion: cuts gullies into the ridge and fans onto the plain."""
    rng = random.Random(seed)
    n = h.shape[0]
    for _ in range(droplets):
        x, z = rng.uniform(1, n - 2), rng.uniform(1, n - 2)
        if land[int(z), int(x)] < .5:
            continue
        dx = dz = 0.0
        speed, water, sediment = 1.0, 1.0, 0.0
        for _ in range(40):
            ix, iz = int(x), int(z)
            if ix < 1 or iz < 1 or ix >= n - 2 or iz >= n - 2:
                break
            u, v = x - ix, z - iz
            a, b, c, d = h[iz, ix], h[iz, ix + 1], h[iz + 1, ix], h[iz + 1, ix + 1]
            gx, gz = (b - a) * (1 - v) + (d - c) * v, (c - a) * (1 - u) + (d - b) * u
            dx, dz = dx * .3 - gx * .7, dz * .3 - gz * .7
            length = math.hypot(dx, dz)
            if length < 1e-6:
                break
            dx, dz = dx / length, dz / length
            nx, nz = x + dx, z + dz
            old = a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v
            jx, jz = int(nx), int(nz)
            if jx < 1 or jz < 1 or jx >= n - 2 or jz >= n - 2:
                break
            p, q = nx - jx, nz - jz
            new = h[jz, jx] * (1 - p) * (1 - q) + h[jz, jx + 1] * p * (1 - q) + h[jz + 1, jx] * (1 - p) * q + h[jz + 1, jx + 1] * p * q
            drop = old - new
            capacity = max(drop * speed * water * .6, .01)
            if drop < 0 or sediment > capacity:
                put = min(-drop, sediment) if drop < 0 else (sediment - capacity) * .3
                sediment -= put
                h[iz, ix] += put * (1 - u) * (1 - v)
                h[iz, ix + 1] += put * u * (1 - v)
                h[iz + 1, ix] += put * (1 - u) * v
                h[iz + 1, ix + 1] += put * u * v
            else:
                take = min((capacity - sediment) * .3, drop)
                sediment += take
                h[iz, ix] -= take * (1 - u) * (1 - v)
                h[iz, ix + 1] -= take * u * (1 - v)
                h[iz + 1, ix] -= take * (1 - u) * v
                h[iz + 1, ix + 1] -= take * u * v
            speed = math.sqrt(max(speed * speed + drop * 1.2, .01))
            water *= .97
            x, z = nx, nz
    return h


def build_heights():
    axis = (np.arange(N + 1) / N - .5) * SIZE
    x, z = np.meshgrid(axis, axis)
    # Warped coordinates keep the coast from reading as a union of ellipses.
    wx = x + (fbm(x + 900, z, 420, 3) - .5) * 300
    wz = z + (fbm(x, z + 700, 420, 8) - .5) * 300
    blob = lambda cx, cz, rx, rz: 1 - np.sqrt(((wx - cx) / rx) ** 2 + ((wz - cz) / rz) ** 2)
    bodies = [blob(-40, -60, 920, 790), blob(-660, 130, 300, 560), blob(-400, -700, 330, 250), blob(720, -80, 300, 820), blob(460, 560, 300, 330), blob(-1010, -330, 62, 54), blob(960, 760, 58, 74), blob(-860, 700, 80, 46)]
    field = np.max(bodies, axis=0)
    # A sheltered bay bites into the south coast and holds the barge.
    field = np.minimum(field, (np.hypot(wx - 130, wz - 840) / 330 - 1) * .9)
    land = field > 0
    # Long shelving beaches around a raised, gently rolling plain.
    plain = 15 + (fbm(x, z, 520, 21) - .5) * 26 + (fbm(x, z, 140, 31) - .5) * 7
    h = np.where(land, plain * smooth(0, .2, field), np.maximum(field * 240, -40))
    # The basalt ridge along the east coast is the range backstop; ridged noise breaks its crest.
    ridge = [(620, -860), (780, -430), (850, -120), (770, 250), (540, 650)]
    d, along = polyline_distance(x, z, ridge)
    ridged = 1 - np.abs(fbm(x, z, 300, 41) * 2 - 1)
    crest = 90 + 190 * np.sin(np.clip(along, 0, 1) * np.pi) ** .8
    # Fades out with the shore, so the ridge slopes to the sea rather than ending in a wall.
    shore = smooth(0, .2, field)
    h += shore * crest * (.55 + .55 * ridged) * np.exp(-(d / 175) ** 2)
    # Low dune hills break up the north cape and the south-east shore.
    for cx, cz, rx, rz, top in [(-330, -800, 170, 110, 62), (-90, -560, 240, 130, 34), (300, 480, 150, 110, 46), (-720, -240, 130, 170, 30)]:
        h += shore * top * (.7 + .5 * fbm(x, z, 90, 51)) * np.exp(-((x - cx) / rx) ** 2 - ((z - cz) / rz) ** 2)
    # Erosion cuts the high ground only; left alone it combs the beaches into spikes.
    h = h + (gaussian(erode(h.copy(), land.astype(float)), 1) - h) * smooth(.12, .34, field)
    # Shared with terrain.ts: airfield plateau including the apron, hangars and tower.
    r = LAYOUT['runway']
    px, pz = x - r['x'], z - r['z']
    margin = CELL * math.sqrt(2)
    strip = (1 - smooth(r['width'] / 2 + margin, r['width'] / 2 + margin + 55, np.abs(px))) * (1 - smooth(r['length'] / 2 + margin, r['length'] / 2 + margin + 80, np.abs(pz)))
    apron = (1 - smooth(40 + margin, 75 + margin, np.abs(px - 50))) * (1 - smooth(81 + margin, 116 + margin, np.abs(pz - 47)))
    blend = np.maximum(strip, apron)
    h = h * (1 - blend) + r['y'] * blend
    for pad in LAYOUT['pads']:
        d = np.hypot(x - pad['x'], z - pad['z'])
        y = pad.get('y', float(h[int((pad['z'] / SIZE + .5) * N), int((pad['x'] / SIZE + .5) * N)]))
        k = 1 - smooth(pad['radius'], pad['radius'] + 45, d)
        h = h * (1 - k) + y * k
    # Roads are graded: each cell blends toward its neighbourhood average across the verge.
    level = gaussian(h, 4)
    for line in LAYOUT['roads']:
        d, _ = polyline_distance(x, z, line)
        k = 1 - smooth(12, 34, d)
        h = h * (1 - k) + level * k
    # The mesh fades into the seabed that surrounds it.
    edge = np.minimum(np.minimum(x + SIZE / 2, SIZE / 2 - x), np.minimum(z + SIZE / 2, SIZE / 2 - z))
    k = smooth(0, 90, edge)
    return h * k - 40 * (1 - k)


def gaussian(h, passes):
    out = h.copy()
    for _ in range(passes):
        out[1:-1, 1:-1] = (out[1:-1, 1:-1] * 4 + out[:-2, 1:-1] + out[2:, 1:-1] + out[1:-1, :-2] + out[1:-1, 2:]) / 8
    return out


def surface(h, x, z):
    """Same triangle interpolation as the game's collision surface."""
    gx, gz = (x + SIZE / 2) / CELL, (z + SIZE / 2) / CELL
    ix, iz = min(max(int(gx), 0), N - 1), min(max(int(gz), 0), N - 1)
    u, v = gx - ix, gz - iz
    b, c = h[iz + 1, ix], h[iz, ix + 1]
    if u + v <= 1:
        return float(h[iz, ix] * (1 - u - v) + c * u + b * v)
    return float(h[iz + 1, ix + 1] * (u + v - 1) + b * (1 - u) + c * (1 - v))


def ecology(h):
    axis = (np.arange(N + 1) / N - .5) * SIZE
    x, z = np.meshgrid(axis, axis)
    gz, gx = np.gradient(h, CELL)
    slope = np.hypot(gx, gz)
    mix = lambda a, b, t: a[..., :] * (1 - t[..., None]) + b * t[..., None]
    sand, straw, scrub = np.array([.62, .50, .30]), np.array([.20, .165, .07]), np.array([.055, .10, .035])
    dirt, burnt, basalt = np.array([.20, .095, .05]), np.array([.035, .03, .025]), np.array([.045, .045, .045])
    colour = mix(np.broadcast_to(sand, h.shape + (3,)), straw, smooth(2.5, 7, h))
    colour = mix(colour, straw * .72, smooth(.35, .7, fbm(x, z, 60, 66)) * .7)
    colour = mix(colour, scrub, smooth(.42, .72, fbm(x, z, 150, 61, 6)) * smooth(5, 12, h) * .85)
    colour = mix(colour, scrub * .75, smooth(40, 90, h) * .75)
    # Worked-over ground: bare laterite around every target area, burnt where it is hit most.
    for pad in LAYOUT['pads']:
        d = np.hypot(x - pad['x'], z - pad['z'])
        grain = fbm(x, z, 60, 71) * 40
        colour = mix(colour, dirt, (1 - smooth(pad['radius'] * .75, pad['radius'] * 1.35 + 20, d + grain - 20)) * .9)
    craters = smooth(.62, .74, fbm(x, z, 46, 81, 3))
    near = np.zeros(h.shape)
    for pad in LAYOUT['pads'][:2]:
        near = np.maximum(near, 1 - smooth(pad['radius'] * .6, pad['radius'] * 1.2, np.hypot(x - pad['x'], z - pad['z'])))
    colour = mix(colour, burnt, craters * near * .85)
    colour = mix(colour, basalt, smooth(.5, .95, slope) * smooth(3, 10, h))
    colour = mix(colour, basalt * 1.3, smooth(170, 240, h) * .75)
    colour = mix(colour, np.array([.40, .34, .22]), (1 - smooth(-3, 2.5, h)))
    return np.concatenate([colour, np.ones(h.shape + (1,))], axis=-1)


# ---- Blender helpers ----
def collection(name):
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(c)
    return c


def material(name, colour, roughness=.85, metallic=0, emission=None):
    m = bpy.data.materials.new(name)
    p = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value = (*colour, 1)
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = metallic
    if emission:
        p.inputs['Emission Color'].default_value = (*emission, 1)
        p.inputs['Emission Strength'].default_value = 1
    return m


def export(c, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in c.objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = next(iter(c.objects))
    bpy.ops.export_scene.gltf(filepath=f'{OUT}/{name}.glb', use_selection=True, export_apply=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False)
    print('EXPORTED', name, os.path.getsize(f'{OUT}/{name}.glb'))


def build_terrain_object(h):
    c = collection('Anvil Key terrain')
    verts = [((ix / N - .5) * SIZE, -(iz / N - .5) * SIZE, float(h[iz, ix])) for iz in range(N + 1) for ix in range(N + 1)]
    faces = []
    for iz in range(N):
        for ix in range(N):
            a = iz * (N + 1) + ix
            b, c2, d = a + N + 1, a + 1, a + N + 2
            faces += [(a, b, c2), (b, d, c2)]
    me = bpy.data.meshes.new('Anvil Key terrain')
    me.from_pydata(verts, [], faces)
    me.update()
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    colours = me.color_attributes.new(name='Ecology', type='FLOAT_COLOR', domain='POINT')
    colours.data.foreach_set('color', ecology(h).reshape(-1))
    m = material('Anvil Key ecology', (1, 1, 1), 1)
    node = m.node_tree.nodes.new('ShaderNodeVertexColor')
    node.layer_name = 'Ecology'
    p = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    m.node_tree.links.new(node.outputs['Color'], p.inputs['Base Color'])
    me.materials.append(m)
    o = bpy.data.objects.new('Anvil Key terrain', me)
    c.objects.link(o)
    return c


def heights_from_mesh():
    """The mesh is the source of truth: collision reads exactly what was sculpted."""
    o = bpy.data.objects['Anvil Key terrain']
    if len(o.data.vertices) != (N + 1) ** 2:
        raise ValueError('Anvil Key terrain must keep its grid: move vertices, do not add or remove them')
    co = np.empty(len(o.data.vertices) * 3)
    o.data.vertices.foreach_get('co', co)
    return co[2::3].reshape(N + 1, N + 1)


def write_heights(h):
    h.astype('<f4').tofile(f'{OUT}/range-island-heights.bin')
    print('HEIGHTS', h.min(), h.max(), 'land cells', int((h > 0).sum()))


class Parts:
    """Builds one mesh object per target, one material slot per finish. Each part must
    overlap the parts before it, so nothing on a dummy can float."""
    def __init__(self, name):
        self.name, self.bm, self.materials, self.bounds = name, bmesh.new(), [], []

    def slot(self, m):
        if m not in self.materials:
            self.materials.append(m)
        return self.materials.index(m)

    def add(self, geom, m, label, free=False):
        verts = [g for g in geom if isinstance(g, bmesh.types.BMVert)]
        low = Vector(min(v.co[i] for v in verts) for i in range(3))
        high = Vector(max(v.co[i] for v in verts) for i in range(3))
        if self.bounds and not free and not any(all(low[i] <= b[1][i] + .001 and high[i] >= b[0][i] - .001 for i in range(3)) for b in self.bounds):
            raise ValueError(f'{self.name}: part "{label}" floats')
        self.bounds.append((low, high))
        for f in {f for v in verts for f in v.link_faces}:
            f.material_index = self.slot(m)

    def box(self, label, centre, size, m, rotate=(0, 0, 0), bevel=.03):
        r = bmesh.ops.create_cube(self.bm, size=1)
        verts = r['verts']
        transform = Matrix.Translation(centre) @ Matrix.Rotation(rotate[2], 4, 'Z') @ Matrix.Rotation(rotate[1], 4, 'Y') @ Matrix.Rotation(rotate[0], 4, 'X') @ Matrix.Diagonal((*size, 1))
        bmesh.ops.transform(self.bm, matrix=transform, verts=verts)
        if bevel:
            edges = list({e for v in verts for e in v.link_edges})
            verts = list({v for g in [bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, segments=1, affect='EDGES')] for v in g['verts']} | {v for v in verts if v.is_valid})
        self.add(verts, m, label)

    def wedge(self, label, centre, bottom, top, height, m, shift=0):
        """A box whose top rectangle is narrower (and optionally shifted along Y)."""
        cx, cy, cz = centre
        (bx, by), (tx, ty) = bottom, top
        points = [(-bx, -by, 0), (bx, -by, 0), (bx, by, 0), (-bx, by, 0), (-tx, shift - ty, height), (tx, shift - ty, height), (tx, shift + ty, height), (-tx, shift + ty, height)]
        verts = [self.bm.verts.new((cx + a, cy + b, cz + c)) for a, b, c in points]
        for f in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]:
            self.bm.faces.new([verts[i] for i in f])
        self.add(verts, m, label)

    def cylinder(self, label, a, b, radius, m, radius2=None, segments=12, free=False):
        a, b = Vector(a), Vector(b)
        axis = b - a
        r = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=segments, radius1=radius, radius2=radius if radius2 is None else radius2, depth=axis.length)
        transform = Matrix.Translation((a + b) / 2) @ axis.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        bmesh.ops.transform(self.bm, matrix=transform, verts=r['verts'])
        self.add(r['verts'], m, label, free)

    def sphere(self, label, centre, size, m, segments=12):
        r = bmesh.ops.create_uvsphere(self.bm, u_segments=segments, v_segments=8, radius=1)
        bmesh.ops.transform(self.bm, matrix=Matrix.Translation(centre) @ Matrix.Diagonal((*size, 1)), verts=r['verts'])
        self.add(r['verts'], m, label)

    def fin(self, label, outline, thickness, m):
        """A flat plate from an outline, in the plane given by the points, thickened along Z."""
        top = [self.bm.verts.new((x, y, z + thickness / 2)) for x, y, z in outline]
        low = [self.bm.verts.new((x, y, z - thickness / 2)) for x, y, z in outline]
        self.bm.faces.new(top)
        self.bm.faces.new(list(reversed(low)))
        for i in range(len(outline)):
            j = (i + 1) % len(outline)
            self.bm.faces.new([low[i], low[j], top[j], top[i]])
        self.add(top + low, m, label)

    def finish(self, c, location=(0, 0, 0)):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.materials:
            me.materials.append(m)
        for p in me.polygons:
            p.use_smooth = False
        o = bpy.data.objects.new(self.name, me)
        o.location = location
        c.objects.link(o)
        return o


# ---- Target dummies ----
def build_targets():
    c = collection('Range targets')
    orange = material('Target orange', (.86, .20, .025), .6)
    white = material('Target white', (.82, .82, .78), .7)
    black = material('Target black', (.018, .018, .02), .8)
    steel = material('Target steel', (.11, .115, .12), .55, .6)
    rubber = material('Target rubber', (.012, .012, .012), .9)
    glass = material('Target glass', (.02, .04, .05), .2, .2)
    olive = material('Target olive', (.085, .10, .05), .85)
    ply = material('Target plywood', (.42, .30, .17), .9)
    rust = material('Target rust', (.17, .075, .035), .9)

    def truck():
        t = Parts('Range_truck')
        t.box('chassis', (0, 0, .95), (1.5, 7, .28), steel, bevel=.02)
        for y in (2.35, -1.1, -2.5):
            t.box('hanger', (0, y, .8), (.9, .3, .4), steel)
            t.cylinder('axle', (-1.25, y, .55), (1.25, y, .55), .09, steel)
            for side in (-1, 1):
                t.cylinder('wheel', (side * .95, y, .55), (side * 1.3, y, .55), .55, rubber, segments=16)
                t.cylinder('hub', (side * 1.27, y, .55), (side * 1.33, y, .55), .25, steel)
        t.box('cab', (0, 2.75, 1.85), (2.3, 1.9, 1.6), orange)
        t.box('hood', (0, 3.85, 1.3), (2.1, .7, .7), orange)
        t.box('windscreen', (0, 3.68, 2.15), (2.0, .08, .75), glass, bevel=0)
        for side in (-1, 1):
            t.box('side window', (side * 1.15, 2.85, 2.2), (.04, 1.1, .6), glass, bevel=0)
        t.box('bumper', (0, 4.2, .95), (2.3, .15, .3), steel, bevel=.02)
        t.box('bed', (0, -1.0, 1.15), (2.4, 4.6, .2), steel, bevel=.02)
        t.box('cargo', (0, -1.0, 2.35), (2.3, 4.4, 2.2), ply)
        for y in (-2.4, -1.0, .4):
            for side in (-1, 1):
                t.box('stripe', (side * 1.16, y, 2.35), (.03, .5, 2.2), white, bevel=0)
        t.box('roof panel', (0, -1, 3.47), (1.3, 1.3, .04), orange, bevel=0)
        return t

    def tank():
        t = Parts('Range_tank')
        t.wedge('lower hull', (0, 0, .45), (1.45, 3.5), (1.75, 3.8), .55, olive)
        t.wedge('upper hull', (0, -.15, 1.0), (1.75, 3.65), (1.5, 2.9), .55, olive, shift=-.2)
        for side in (-1, 1):
            x = side * 1.6
            for y in np.linspace(-2.9, 2.9, 6):
                t.cylinder('road wheel', (x - .3, y, .42), (x + .3, y, .42), .4, steel, segments=14)
            t.cylinder('sprocket', (x - .28, 3.3, .6), (x + .28, 3.3, .6), .35, steel)
            t.cylinder('idler', (x - .28, -3.3, .6), (x + .28, -3.3, .6), .35, steel)
            t.box('track', (x, 0, .13), (.62, 6.8, .26), rubber, bevel=.02)
            t.box('skirt mount', (side * 1.82, 0, 1.0), (.22, 6.3, .3), olive, bevel=.01)
            t.box('skirt', (side * 1.95, 0, .95), (.08, 6.6, .55), olive, bevel=.01)
        t.wedge('turret', (0, -.3, 1.55), (1.25, 1.65), (.9, 1.2), .72, olive, shift=-.1)
        t.cylinder('mantlet', (0, 1.2, 1.9), (0, 1.75, 1.9), .34, olive, radius2=.25)
        t.cylinder('barrel', (0, 1.6, 1.9), (0, 5.3, 1.9), .09, steel)
        t.cylinder('muzzle', (0, 5.1, 1.9), (0, 5.6, 1.9), .125, steel)
        t.cylinder('hatch', (.45, -.6, 2.25), (.45, -.6, 2.4), .34, olive)
        t.box('turret panel left', (-1.03, -.3, 1.93), (.45, 1.1, .5), white, rotate=(0, .47, 0), bevel=0)
        t.box('turret panel right', (1.03, -.3, 1.93), (.45, 1.1, .5), white, rotate=(0, -.47, 0), bevel=0)
        t.box('hull stripe', (0, -2.6, 1.56), (2.1, .5, .05), orange, bevel=0)
        return t

    def board():
        t = Parts('Range_board')
        t.box('panel', (0, 0, 3.6), (9, .14, 6.2), ply, bevel=.015)
        for x in (-3.8, 0, 3.8):
            t.box('post', (x, -.14, 2.2), (.22, .22, 4.4), steel, bevel=.01)
            t.box('strut', (x, -1.14, 1.55), (.14, .14, 3.5), steel, rotate=(-.62, 0, 0), bevel=.01)
            t.box('footing', (x, -.7, .1), (.6, 3.2, .22), steel, bevel=.01)
        for radius, finish, y in [(2.9, white, .09), (2.2, orange, .105), (1.45, white, .12), (.75, black, .135)]:
            t.cylinder('ring', (0, y - .02, 3.6), (0, y + .02, 3.6), radius, finish, segments=32)
            t.cylinder('ring rear', (0, -y + .02, 3.6), (0, -y - .02, 3.6), radius, finish, segments=32)
        return t

    def radar():
        t = Parts('Range_radar')
        t.box('trailer', (0, 0, .95), (2.6, 6.2, .4), olive, bevel=.03)
        t.box('hitch', (0, 3.6, .9), (.3, 1.6, .2), steel, bevel=.01)
        for y in (-1.6, -.2):
            t.box('hanger', (0, y, .7), (1, .3, .3), steel)
            t.cylinder('axle', (-1.5, y, .55), (1.5, y, .55), .1, steel)
            for side in (-1, 1):
                t.cylinder('wheel', (side * 1.15, y, .55), (side * 1.55, y, .55), .55, rubber, segments=16)
        for x, y in [(-1.2, 2.5), (1.2, 2.5), (-1.2, -2.6), (1.2, -2.6)]:
            t.cylinder('jack', (x, y, 0), (x, y, 1.0), .1, steel)
            t.cylinder('jack pad', (x, y, 0), (x, y, .07), .3, steel)
        t.box('cabin', (0, -1.3, 2.15), (2.4, 2.8, 2.0), olive)
        t.box('stripe', (0, -1.3, 3.0), (2.45, 2.85, .24), orange, bevel=0)
        t.cylinder('mast', (0, 1.4, 1.1), (0, 1.4, 5.5), .2, steel, radius2=.13)
        t.box('turntable', (0, 1.4, 5.5), (1.2, 1.2, .25), steel, bevel=.02)
        t.box('dish frame', (0, 1.4, 6.0), (.8, .3, 1.0), steel, bevel=.02)
        # Parabolic reflector: a shallow, solid bowl facing forward.
        t.sphere('reflector', (0, 1.7, 6.5), (2.9, .55, 1.55), white, segments=20)
        t.cylinder('feed arm', (0, 1.9, 6.5), (0, 3.4, 6.5), .05, steel, segments=8)
        t.sphere('feed horn', (0, 3.4, 6.5), (.16, .22, .16), orange, segments=10)
        return t

    def barge():
        t = Parts('Range_barge')
        t.wedge('hull', (0, 0, -1.0), (5.2, 14.5), (6, 16), 3.1, rust)
        t.box('deck', (0, 0, 2.15), (11.8, 31.5, .22), steel, bevel=.03)
        for side in (-1, 1):
            t.box('rub rail', (side * 5.95, 0, 1.8), (.3, 31.5, .3), black, bevel=.02)
        for x, y, colour, z in [(-2.6, 8.5, orange, 3.55), (2.6, 8.5, white, 3.55), (-2.6, -1, white, 3.55), (2.6, -1, orange, 3.55), (-2.6, 3.6, orange, 3.55), (2.6, 3.6, white, 3.55), (-2.6, 3.6, white, 6.15), (-2.6, -10, orange, 3.55)]:
            t.box('container', (x, y, z), (2.45, 6.1, 2.6), colour, bevel=.04)
        t.box('deckhouse', (2.6, -10.5, 3.65), (3.5, 5, 2.8), white)
        t.cylinder('mast', (2.6, -10.5, 5), (2.6, -10.5, 13), .12, steel, radius2=.07)
        t.box('flag', (2.6, -11.3, 12.3), (.05, 1.6, 1.0), orange, bevel=0)
        for y in (13, -13.5):
            t.box('bollard', (0, y, 2.6), (1.2, .6, .7), steel, bevel=.02)
        return t

    def drone():
        # A jet target drone, sized up so that it reads from a kilometre away.
        t = Parts('Range_drone')
        stations = [(-3.3, .34), (-2.3, .42), (-.4, .52), (1.4, .52), (2.6, .43), (3.4, .24), (3.75, .05)]
        for k in range(len(stations) - 1):
            (y0, r0), (y1, r1) = stations[k], stations[k + 1]
            t.cylinder('fuselage', (0, y0, 0), (0, y1, 0), r0, orange if k not in (1, 3) else white, radius2=r1, segments=16)
        t.cylinder('tailpipe', (0, -3.7, 0), (0, -3.25, 0), .26, black, radius2=.32, segments=14)
        for side in (-1, 1):
            t.fin('wing', [(side * .25, 1.0, -.08), (side * 3.5, -.45, -.02), (side * 3.5, -1.15, -.02), (side * .25, -.85, -.08)], .09, white)
            t.box('wing tip', (side * 3.5, -.8, -.02), (.1, .85, .14), orange, bevel=0)
            t.fin('tailplane', [(side * .2, -2.2, .12), (side * 1.5, -3.3, .3), (side * 1.5, -3.75, .3), (side * .2, -3.3, .12)], .06, orange)
        t.box('fin root', (0, -2.85, .5), (.09, 1.1, .35), orange, bevel=0)
        fin = [t.bm.verts.new(p) for p in [(.04, -2.2, .45), (.04, -3.25, 1.5), (.04, -3.8, 1.5), (.04, -3.45, .45), (-.04, -2.2, .45), (-.04, -3.25, 1.5), (-.04, -3.8, 1.5), (-.04, -3.45, .45)]]
        for f in [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]:
            t.bm.faces.new([fin[i] for i in f])
        t.add(fin, orange, 'fin')
        t.wedge('intake', (0, .1, -.72), (.3, .75), (.3, .75), .32, black)
        t.cylinder('nose probe', (0, 3.6, 0), (0, 4.3, 0), .025, steel, segments=6)
        return t

    for build in (truck, tank, board, radar, barge, drone):
        build().finish(c)
    return c


# ---- Island dressing ----
class Batch:
    """One large mesh per finish. Scattered scenery stays a few draw calls in the game."""
    def __init__(self):
        self.verts, self.faces = [], []

    def add(self, verts, faces):
        base = len(self.verts)
        self.verts += verts
        self.faces += [[i + base for i in f] for f in faces]

    def finish(self, c, name, m):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.verts, [], self.faces)
        me.update()
        me.materials.append(m)
        o = bpy.data.objects.new(name, me)
        c.objects.link(o)
        return o


def strip(batch, h, points, width, lift=.3, closed=False):
    """Drapes a ribbon over the terrain. Game z is -Blender y."""
    verts, faces = [], []
    count = len(points)
    for k, (x, z) in enumerate(points):
        ax, az = points[(k - 1) % count if closed else max(k - 1, 0)]
        bx, bz = points[(k + 1) % count if closed else min(k + 1, count - 1)]
        dx, dz = bx - ax, bz - az
        length = math.hypot(dx, dz) or 1
        nx, nz = -dz / length * width / 2, dx / length * width / 2
        for lx, lz in ((x - nx, z - nz), (x + nx, z + nz)):
            verts.append((lx, -lz, surface(h, lx, lz) + lift))
    for k in range(count if closed else count - 1):
        a, b = k * 2, ((k + 1) % count) * 2
        faces.append((a, a + 1, b + 1, b))
    batch.add(verts, faces)


def resample(line, spacing=6.0):
    out = []
    for k in range(len(line) - 1):
        (ax, az), (bx, bz) = line[k], line[k + 1]
        steps = max(1, int(math.hypot(bx - ax, bz - az) / spacing))
        out += [(ax + (bx - ax) * i / steps, az + (bz - az) * i / steps) for i in range(steps)]
    return out + [tuple(line[-1])]


def berm(batch, h, spec):
    """A horseshoe earth bank, open toward the attack run."""
    verts, faces = [], []
    radius, gap = spec['radius'], spec['open'] / 2
    profile = [(-4.5, -.6), (-1.5, 2.2), (0, 3.1), (1.5, 2.2), (4.5, -.6)]
    steps = 26
    for k in range(steps + 1):
        a = gap + (2 * math.pi - 2 * gap) * k / steps
        for offset, rise in profile:
            r = radius + offset
            x, z = spec['x'] + math.sin(a) * r, spec['z'] + math.cos(a) * r
            verts.append((x, -z, surface(h, x, z) + rise))
    width = len(profile)
    for k in range(steps):
        for j in range(width - 1):
            a = k * width + j
            faces.append((a, a + 1, a + width + 1, a + width))
    batch.add(verts, faces)


def crown(batch, x, y, z, rx, rz, rng):
    """A squashed, jittered blob for foliage. Bottom sits inside the trunk or ground."""
    rings = [(.0, .75), (.45, 1.0), (1.0, .55)]
    sides = 6
    verts, faces = [], []
    for level, scale in rings:
        for k in range(sides):
            a = 2 * math.pi * k / sides + rng.uniform(-.2, .2)
            r = rx * scale * rng.uniform(.82, 1.12)
            verts.append((x + math.cos(a) * r, y + math.sin(a) * r, z + level * rz))
    top = len(verts)
    verts.append((x, y, z + rz * 1.28))
    for level in range(len(rings) - 1):
        for k in range(sides):
            a, b = level * sides + k, level * sides + (k + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    for k in range(sides):
        a, b = (len(rings) - 1) * sides + k, (len(rings) - 1) * sides + (k + 1) % sides
        faces.append((a, b, top))
    batch.add(verts, faces)


def trunk(batch, x, y, z, height, radius):
    sides = 5
    verts = [(x + math.cos(2 * math.pi * k / sides) * r, y + math.sin(2 * math.pi * k / sides) * r, z + lift) for lift, r in ((-.5, radius), (height, radius * .6)) for k in range(sides)]
    faces = [(k, (k + 1) % sides, (k + 1) % sides + sides, k + sides) for k in range(sides)]
    batch.add(verts, faces)


def build_dressing(h):
    c = collection('Anvil Key dressing')
    road_paint = material('Range road', (.23, .135, .08), .96)
    ring_paint = material('Range ring', (.62, .60, .54), .95)
    bank = material('Range berm', (.13, .075, .04), 1)
    leaf = material('Range foliage', (.055, .10, .03), .9)
    dry = material('Range dry scrub', (.13, .125, .05), .95)
    bark = material('Range bark', (.06, .045, .03), .95)
    concrete = material('Range concrete', (.34, .33, .30), .92)
    steel = material('Range steel', (.14, .15, .15), .55, .5)
    orange = material('Range orange', (.86, .20, .025), .6)
    white = material('Range white', (.82, .82, .78), .7)
    dark = material('Range dark', (.015, .02, .025), .4)
    roads, rings, banks = Batch(), Batch(), Batch()
    for line in LAYOUT['roads']:
        strip(roads, h, resample(line), 7, .28)
    for spec in LAYOUT['rings']:
        for radius in spec['radii']:
            # Painted rock ring: dashes read as a bullseye from the air.
            count = int(2 * math.pi * radius / 12)
            for k in range(count):
                a0, a1 = 2 * math.pi * k / count, 2 * math.pi * (k + .6) / count
                arc = [(spec['x'] + math.sin(a) * radius, spec['z'] + math.cos(a) * radius) for a in np.linspace(a0, a1, 4)]
                strip(rings, h, arc, 3, .3)
    for spec in LAYOUT['berms']:
        berm(banks, h, spec)
    roads.finish(c, 'Range roads', road_paint)
    rings.finish(c, 'Range rings', ring_paint)
    banks.finish(c, 'Range berms', bank)

    def clear(x, z, pad_margin=12):
        r = LAYOUT['runway']
        if abs(x - r['x'] - 25) < 110 and abs(z - r['z']) < r['length'] / 2 + 90:
            return False
        for pad in LAYOUT['pads']:
            if math.hypot(x - pad['x'], z - pad['z']) < pad['radius'] + pad_margin:
                return False
        for t in LAYOUT['targets']:
            if math.hypot(x - t['x'], z - t['z']) < 24:
                return False
        for b in LAYOUT['buildings']:
            if math.hypot(x - b['x'], z - b['z']) < 26:
                return False
        return True

    rng = random.Random(17)
    road_points = [p for line in LAYOUT['roads'] for p in resample(line, 14)]
    on_road = lambda x, z: any(abs(x - px) < 12 and abs(z - pz) < 12 for px, pz in road_points)
    bushes, dry_bushes, trunks, crowns = Batch(), Batch(), Batch(), Batch()
    placed_trees = placed_bushes = 0
    for _ in range(60000):
        if placed_bushes >= 1700 and placed_trees >= 420:
            break
        x, z = rng.uniform(-SIZE / 2 + 60, SIZE / 2 - 60), rng.uniform(-SIZE / 2 + 60, SIZE / 2 - 60)
        y = surface(h, x, z)
        if y < 4.5 or y > 190:
            continue
        slope = abs(surface(h, x + 6, z) - y) + abs(surface(h, x, z + 6) - y)
        if slope > 5 or not clear(x, z) or on_road(x, z):
            continue
        tree = rng.random() < .2 + .4 * min(1, y / 60)
        if tree and placed_trees < 420:
            height = rng.uniform(3.5, 7)
            trunk(trunks, x, -z, y, height, rng.uniform(.18, .3))
            crown(crowns, x, -z, y + height * .72, rng.uniform(2.6, 4.6), rng.uniform(1.4, 2.4), rng)
            placed_trees += 1
        elif placed_bushes < 1700:
            crown(dry_bushes if rng.random() < .55 else bushes, x, -z, y - .25, rng.uniform(.9, 2.2), rng.uniform(.6, 1.3), rng)
            placed_bushes += 1
    bushes.finish(c, 'Range bushes', leaf)
    dry_bushes.finish(c, 'Range dry bushes', dry)
    trunks.finish(c, 'Range tree trunks', bark)
    crowns.finish(c, 'Range tree crowns', leaf)

    def tower(spec):
        t = Parts('Range observation tower')
        for x, y in [(-2.2, -2.2), (2.2, -2.2), (-2.2, 2.2), (2.2, 2.2)]:
            t.cylinder('leg', (x, y, -1), (x * .62, y * .62, 11), .16, steel, segments=8, free=True)
        for z, half in ((3.5, 2.0), (7.5, 1.65)):
            t.box('brace', (0, 0, z), (half * 2 + .3, half * 2 + .3, .14), steel, bevel=0)
        t.box('deck', (0, 0, 11), (5.2, 5.2, .25), steel, bevel=.02)
        t.box('cabin', (0, 0, 12.5), (4, 4, 2.8), white)
        t.box('windows', (0, 0, 13), (4.08, 4.08, .9), dark, bevel=0)
        t.box('roof', (0, 0, 14), (4.8, 4.8, .25), orange)
        return t

    def bunker(spec):
        t = Parts('Range bunker')
        t.wedge('bunker', (0, 0, -1), (9, 6), (7, 4.5), 4.6, concrete)
        t.box('slit', (0, 4.55, 2.1), (9, .3, .55), dark, bevel=0)
        t.box('roof slab', (0, 0, 3.6), (14.4, 9.4, .25), concrete, bevel=.04)
        return t

    def tanks(spec):
        t = Parts('Range fuel tanks')
        t.box('slab', (0, 0, -.2), (24, 11, .55), concrete, bevel=.04)
        for x in (-7, 0, 7):
            for y in (-2.4, 2.4):
                t.box('saddle', (x, y, .75), (3.4, .6, 1.4), steel, bevel=.02)
            t.cylinder('tank', (x, -3.4, 2.2), (x, 3.4, 2.2), 2.1, white, segments=20)
        t.box('pipe', (0, 0, .4), (20, .3, .3), steel, bevel=0)
        return t

    builders = {'tower': tower, 'bunker': bunker, 'tanks': tanks}
    for spec in LAYOUT['buildings']:
        o = builders[spec['kind']](spec).finish(c, (spec['x'], -spec['z'], surface(h, spec['x'], spec['z'])))
        o.rotation_euler[2] = spec['heading']
    # Red and white range boundary posts ring the live area.
    posts = Batch()
    bands = Batch()
    for k in range(30):
        a = 2 * math.pi * k / 30
        x, z = 120 + math.sin(a) * 590, -80 + math.cos(a) * 520
        y = surface(h, x, z)
        if y < 3:
            continue
        trunk(posts, x, -z, y, 4.2, .22)
        trunk(bands, x, -z, y + 3.1, 1.2, .25)
    posts.finish(c, 'Range boundary posts', white)
    bands.finish(c, 'Range boundary bands', orange)
    return c


def main():
    terrain = None
    if os.environ.get('POCKET_RANGE_EXPORT_ONLY'):
        h = heights_from_mesh()
        terrain = bpy.data.collections['Anvil Key terrain']
        targets = bpy.data.collections['Range targets']
        dressing = bpy.data.collections['Anvil Key dressing']
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        terrain = build_terrain_object(build_heights())
        h = heights_from_mesh()
        targets = build_targets()
        dressing = build_dressing(h)
        for o in dressing.objects:
            for p in o.data.polygons:
                p.use_smooth = o.name in ('Range berms', 'Range tree crowns', 'Range bushes', 'Range dry bushes')
        bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    write_heights(h)
    export(terrain, 'range-island')
    export(dressing, 'range-dressing')
    export(targets, 'range-targets')


main()
