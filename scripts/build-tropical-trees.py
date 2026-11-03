"""Build the island's trees in Blender: solid, hyper-light models with their shading baked in.

  Blender --background --python-exit-code 1 --python scripts/build-tropical-trees.py

Writes public/assets/scenery/tropical-trees.glb and review renders to output/trees. Each kind has
meshes named <kind>_<level>, from level 0 (close) to the coarsest. Meters, Z up, standing on the
origin. Tree tops are at 3.4 and palm tops at 12 at scale 1, which is what the collision expects.

There are no textures and no transparency. A canopy is one closed hull, so nothing inside it is
ever drawn. Sun and sky stay out of the bake: the game lights each vertex from its normal, which
points away from the canopy's centre so the whole crown shades as one soft mass. The colours only
hold what light cannot move: darker undersides and hollows, and patches of varied leaf.
"""
import bmesh, bpy, math, os, random
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = BASE + '/public/assets/scenery/tropical-trees.glb'
REVIEW = BASE + '/output/trees'
TREE_TOP = 3.4
PALM_TOP = 12
VOXEL = .085
# Canopy triangles per level. The last hull is projected, not decimated, so it keeps its outline.
CANOPY = {'broadleaf': (170, 42), 'round': (150, 38), 'tall': (150, 38), 'shrub': (44,)}
LEAVES = {
    'broadleaf': ((.105, .205, .042), (.016, .05, .018)),
    'round': ((.085, .19, .05), (.014, .052, .022)),
    'tall': ((.125, .215, .036), (.022, .056, .016)),
    'shrub': ((.095, .19, .04), (.024, .07, .022)),
}
BARK = ((.1, .075, .052), (.2, .155, .105))
PALM_BARK = ((.14, .115, .085), (.26, .22, .165))
PALM_LEAF = ((.085, .22, .04), (.19, .36, .08))


def lobes_for(kind):
    rng = random.Random(hash_name(kind))
    jitter = lambda a: rng.uniform(-a, a)
    around = lambda count, reach, z, rx, rz, turn=0.: [
        (reach * math.cos(i * math.tau / count + turn) + jitter(.14), reach * math.sin(i * math.tau / count + turn) + jitter(.14), z + jitter(.16), rx + jitter(.08), rx + jitter(.08), rz + jitter(.07))
        for i in range(count)
    ]
    # Crowns are deep, start low and lean to one side, and each is built from uneven clumps at
    # several heights: flat, even lobes centred on a long bare trunk read as mushrooms.
    if kind == 'broadleaf':
        return around(5, 1.02, 2.12, .9, .78, .3) + around(3, .52, 2.82, .84, .62, .9) + around(4, .86, 1.26, .74, .6, 1.) + [(.86, .42, 1.86, .74, .7, .62)]
    if kind == 'round':
        return around(4, .72, 1.12, .84, .76, .5) + around(4, .66, 2.1, .88, .78) + [(.2, -.14, 2.92, .66, .62, .54), (-.62, .4, 1.5, .62, .6, .6)]
    if kind == 'tall':
        return around(3, .5, .9, .76, .66) + around(3, .54, 1.66, .8, .7, 1.) + around(3, .36, 2.4, .64, .58, 2.) + [(.12, .06, 3.02, .42, .4, .42), (.42, -.3, 1.3, .56, .54, .6)]
    if kind == 'shrub':
        return [(0, 0, .42, .62, .62, .56), (.42, .18, .34, .46, .46, .4), (-.32, -.3, .3, .46, .46, .38)]
    raise ValueError(kind)


def hash_name(name):
    return sum((i + 1) * ord(c) for i, c in enumerate(name))


def hull(kind):
    """One closed, lumpy surface around the lobes, with its top on the species' height."""
    bm = bmesh.new()
    for x, y, z, rx, ry, rz in lobes_for(kind):
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1, matrix=Matrix.Translation((x, y, z)) @ Matrix.Diagonal((rx, ry, rz, 1)))
    mesh = bpy.data.meshes.new(f'{kind} hull')
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(mesh.name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    remesh = obj.modifiers.new('fuse', 'REMESH')
    remesh.mode = 'VOXEL'
    remesh.voxel_size = VOXEL if kind != 'shrub' else VOXEL / 2
    smooth = obj.modifiers.new('ease', 'SMOOTH')
    smooth.factor = .7
    smooth.iterations = 4
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    for modifier in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    # Leaf clumps: lumps big enough to survive the reduction to a few dozen triangles.
    mesh.update()
    amount = .44 if kind != 'shrub' else .2
    for vertex in mesh.vertices:
        p = vertex.co
        lump = noise.noise(p * 2.3 + Vector((3.1, 1.7, hash_name(kind) % 9))) * amount + noise.noise(p * 5.6) * amount * .35
        vertex.co = p + vertex.normal * lump
    top = max(v.co.z for v in mesh.vertices)
    target = 1 if kind == 'shrub' else TREE_TOP
    for vertex in mesh.vertices:
        vertex.co.z *= target / top
    mesh.update()
    obj.select_set(False)
    return obj


def reduced(source, triangles):
    obj = source.copy()
    obj.data = source.data.copy()
    bpy.context.scene.collection.objects.link(obj)
    source_tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    decimate = obj.modifiers.new('reduce', 'DECIMATE')
    decimate.ratio = triangles / source_tris
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier='reduce')
    obj.select_set(False)
    obj.data.calc_loop_triangles()
    verts = [v.co.copy() for v in obj.data.vertices]
    faces = [tuple(t.vertices) for t in obj.data.loop_triangles]
    mesh = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.meshes.remove(mesh)
    return verts, faces


def projected(source_tree, centre):
    """Twenty triangles shot onto the hull from outside: the outline survives where reducing it would not."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1)
    bm.verts.ensure_lookup_table()
    verts = []
    for vertex in bm.verts:
        direction = vertex.co.normalized()
        hit = source_tree.ray_cast(centre + direction * 30, -direction)[0]
        verts.append(hit if hit else centre + direction)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    faces = [tuple(v.index for v in f.verts) for f in bm.faces]
    bm.free()
    # Faces that look straight down cannot be seen from this far away, so they go.
    # (Shrubs keep this too: from where their last level shows, only the top is visible.)
    keep = []
    for a, b, c in faces:
        normal = (verts[b] - verts[a]).cross(verts[c] - verts[a])
        mid = (verts[a] + verts[b] + verts[c]) / 3
        keep.append((a, b, c) if normal.dot(mid - centre) > 0 else (a, c, b))
    keep = [f for f in keep if (verts[f[1]] - verts[f[0]]).cross(verts[f[2]] - verts[f[0]]).normalized().z > -.72]
    return verts, keep


class Part:
    """Vertices, triangles, normals and colours, gathered before any mesh exists."""
    def __init__(self):
        self.verts, self.faces, self.normals, self.colours = [], [], [], []

    def add(self, verts, faces, normals, colours):
        base = len(self.verts)
        self.verts += verts
        self.normals += normals
        self.colours += colours
        self.faces += [tuple(i + base for i in f) for f in faces]


def canopy_shading(verts, faces, kind, tree):
    """Soft normals from the crown's centre, and colour that holds only what the sun cannot move."""
    low = min(v.z for v in verts)
    high = max(v.z for v in verts)
    span_x = max(abs(v.x) for v in verts) or 1
    span_y = max(abs(v.y) for v in verts) or 1
    centre = Vector((0, 0, low + (high - low) * .42))
    half_z = max(.001, (high - low) / 2)
    bright, shadow = LEAVES[kind]
    bright, shadow = Vector(bright), Vector(shadow)
    # Face normals, averaged, for the small share of real form in the blend.
    face_normals = [Vector() for _ in verts]
    for a, b, c in faces:
        n = (verts[b] - verts[a]).cross(verts[c] - verts[a])
        for i in (a, b, c):
            face_normals[i] += n
    normals, colours = [], []
    rays = [Vector((math.cos(a) * .7, math.sin(a) * .7, .72)).normalized() for a in [i * math.tau / 6 for i in range(6)]] + [Vector((0, 0, 1))]
    for vertex, face_normal in zip(verts, face_normals):
        offset = vertex - centre
        ball = Vector((offset.x / span_x, offset.y / span_y, offset.z / half_z)).normalized()
        normal = (ball * .55 + face_normal.normalized() * .45).normalized()
        normals.append(normal)
        open_sky = sum(0 if tree.ray_cast(vertex + normal * .1 + ray * .02, ray, 3)[0] else 1 for ray in rays) / len(rays)
        height = (vertex.z - low) / max(.001, high - low)
        patch = .5 + .9 * noise.noise(vertex * 1.25 + Vector((5, 9, hash_name(kind) % 7)))
        light = min(1, max(0, height ** .8 * .5 + open_sky * .4 + (patch - .5) * .5))
        colour = shadow.lerp(bright, light)
        colours.append((colour.x, colour.y, colour.z))
    return normals, colours


def ring(centre, radius, sides, along=Vector((0, 0, 1))):
    side = along.cross(Vector((1, 0, 0)) if abs(along.x) < .9 else Vector((0, 1, 0))).normalized()
    up = along.cross(side).normalized()
    return [centre + (side * math.cos(i * math.tau / sides) + up * math.sin(i * math.tau / sides)) * radius for i in range(sides)]


def tube(part, stations, sides, palette, cap=True):
    """A tapered limb through (point, radius) stations. Its end is buried in what it joins."""
    verts, faces, normals, colours = [], [], [], []
    dark, pale = Vector(palette[0]), Vector(palette[1])
    for i, (point, radius) in enumerate(stations):
        previous = stations[max(0, i - 1)][0]
        following = stations[min(len(stations) - 1, i + 1)][0]
        along = (following - previous).normalized()
        circle = ring(point, radius, sides, along)
        verts += circle
        normals += [(p - point).normalized() for p in circle]
        t = i / (len(stations) - 1)
        c = dark.lerp(pale, min(1, .25 + t * .75))
        colours += [(c.x, c.y, c.z)] * sides
    for i in range(len(stations) - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            faces += [(a, b, b + sides), (a, b + sides, a + sides)]
    part.add(verts, faces, normals, colours)


def distant_level(kind, source):
    """Ten triangles: a five-sided spindle standing on the ground. From altitude only its top faces show."""
    verts = [v.co for v in source.data.vertices]
    top = max(v.z for v in verts)
    reach = max(math.hypot(v.x, v.y) for v in verts) * .92
    waist = sum(v.z for v in verts) / len(verts)
    bright, shadow = (Vector(c) for c in LEAVES[kind])
    part = Part()
    ring_points = [Vector((reach * math.cos(i * math.tau / 5), reach * math.sin(i * math.tau / 5), waist)) for i in range(5)]
    apex, foot = Vector((0, 0, top)), Vector((0, 0, -.05))
    points = ring_points + [apex, foot]
    faces = [(i, (i + 1) % 5, 5) for i in range(5)] + [((i + 1) % 5, i, 6) for i in range(5)]
    normals = [(p - Vector((0, 0, waist * .5))).normalized() for p in ring_points] + [Vector((0, 0, 1)), Vector((0, 0, -1))]
    middle = shadow.lerp(bright, .6)
    colours = [tuple(middle)] * 5 + [tuple(bright), tuple(shadow)]
    part.add(points, faces, normals, colours)
    return part


def tree_level(kind, level, source, tree):
    part = Part()
    sizes = CANOPY[kind]
    if level < len(sizes):
        verts, faces = reduced(source, sizes[level])
    else:
        centre = Vector((0, 0, sum(v.co.z for v in source.data.vertices) / len(source.data.vertices)))
        verts, faces = projected(tree, centre)
    # Decimation can leave faces inside out, which backface culling would turn into holes.
    fixed = []
    middle = sum(verts, Vector()) / len(verts)
    for a, b, c in faces:
        normal = (verts[b] - verts[a]).cross(verts[c] - verts[a])
        mid = (verts[a] + verts[b] + verts[c]) / 3
        fixed.append((a, b, c) if normal.dot(mid - middle) >= 0 else (a, c, b))
    normals, colours = canopy_shading(verts, fixed, kind, tree)
    part.add(verts, fixed, normals, colours)
    canopy_low = min(v.z for v in verts)
    if kind != 'shrub':
        # The coarsest crown is open underneath, so its trunk runs on until it meets the roof.
        roof = None
        if level >= len(sizes):
            roof = BVHTree.FromPolygons(verts, fixed).ray_cast(Vector((0, 0, 20)), Vector((0, 0, -1)))[0].z - .004
        tree_trunk(part, kind, level, canopy_low, roof)
    return part


def tree_trunk(part, kind, level, canopy_low, roof=None):
    # Each trunk runs up inside the crown, so it can never stand clear of it.
    inside = roof if roof is not None else canopy_low + .5
    radius = {'broadleaf': .17, 'round': .13, 'tall': .11}[kind]
    if level == 0:
        lean = {'broadleaf': .14, 'round': -.08, 'tall': .06}[kind]
        tube(part, [(Vector((0, 0, -.25)), radius * 1.45), (Vector((0, 0, .12)), radius * 1.12), (Vector((lean, lean * .4, canopy_low * .7)), radius * .92), (Vector((lean * 1.2, lean * .5, inside)), radius * .55)], 5, BARK)
        reach = {'broadleaf': 1.15, 'round': .6, 'tall': .42}[kind]
        fork = Vector((lean, lean * .4, canopy_low * .62))
        for a in (.6, 2.7, 4.8):
            tube(part, [(fork, radius * .55), (Vector((reach * math.cos(a), reach * math.sin(a), inside + .1)), radius * .24)], 3, BARK)
    elif level == 1:
        tube(part, [(Vector((0, 0, -.25)), radius * 1.15), (Vector((0, 0, inside)), radius * .62)], 4, BARK)
    else:
        tube(part, [(Vector((0, 0, -.25)), radius * 1.2), (Vector((0, 0, inside)), radius * .8)], 3, BARK)


def palm_level(level):
    part = Part()
    sides, rings, fronds, segments = ((6, 5, 11, 3), (4, 3, 6, 2), (3, 2, 4, 1))[level]
    lean = .55
    at = lambda t: Vector((lean * t * t, 0, t * PALM_TOP))
    stations = []
    for i in range(rings + 1):
        t = i / rings
        radius = .2 + .11 * (1 - t) + .24 * math.exp(-t * 16)
        stations.append((at(t) + Vector((0, 0, -.5 * (1 - t) if i == 0 else 0)), radius))
    # The top closes to the point every frond grows from, so the crown is joined to its trunk.
    stations[-1] = (at(.985), stations[-1][1])
    stations.append((at(1), .012))
    tube(part, stations, sides, PALM_BARK)
    crown = at(1)
    dark, pale = Vector(PALM_LEAF[0]), Vector(PALM_LEAF[1])
    for f in range(fronds):
        angle = f * math.tau / fronds + (f % 2) * .2
        young = f % 3 == 0
        length = (4.9 if young else 5.9) + math.sin(f * 2.4) * .4
        rise, droop = (1.55, 1.5) if young else (.85, 3.1)
        dx, dy = math.cos(angle), math.sin(angle)
        verts, faces, normals, colours = [], [], [], []
        width_scale = 1 + (11 / fronds - 1) * .5
        for i in range(segments + 1):
            t = i / segments
            along = t * length
            z = crown.z + rise * math.sin(t * math.pi * .62) - droop * t * t
            width = .74 * width_scale * max(0, math.sin(math.pi * max(t, 0) ** .7)) ** .7
            centre = Vector((crown.x + dx * along, crown.y + dy * along, z))
            side = Vector((-dy, dx, 0)) * width
            sag = Vector((0, 0, -.26 * width))
            verts += [centre - side + sag, centre, centre + side + sag]
            up = Vector((dx * .25, dy * .25, 1)).normalized()
            normals += [up, up, up]
            shade = dark.lerp(pale, .15 + .6 * t)
            colours += [(shade.x * .9, shade.y * .9, shade.z * .9), (shade.x * 1.15, shade.y * 1.1, shade.z), (shade.x * .9, shade.y * .9, shade.z * .9)]
        for i in range(segments):
            a = i * 3
            faces += [(a, a + 3, a + 1), (a + 1, a + 3, a + 4), (a + 1, a + 4, a + 2), (a + 2, a + 4, a + 5)]
        # Zero-width ends leave faces with no area: they cost a draw and show nothing.
        faces = [tri for tri in faces if (verts[tri[1]] - verts[tri[0]]).cross(verts[tri[2]] - verts[tri[0]]).length > 1e-6]
        part.add(verts, faces, normals, colours)
    return part


def as_object(name, part, paint):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in part.verts], [], part.faces)
    mesh.update()
    mesh.polygons.foreach_set('use_smooth', [True] * len(mesh.polygons))
    layer = mesh.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    for i, c in enumerate(part.colours):
        layer.data[i].color = (*c, 1)
    mesh.color_attributes.active_color_index = 0
    mesh.normals_split_custom_set_from_vertices([tuple(n) for n in part.normals])
    mesh.materials.append(paint)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def joined(part):
    """Every loose piece must touch another: the hover-free rule, checked on the finished model."""
    parent = list(range(len(part.verts)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for face in part.faces:
        for i in face[1:]:
            a, b = find(face[0]), find(i)
            if a != b:
                parent[a] = b
    groups = {}
    for i in {v for face in part.faces for v in face}:
        groups.setdefault(find(i), []).append(i)
    if len(groups) < 2:
        return
    # Faces of each piece, as its own tree.
    trees = {}
    for root in groups:
        faces = [f for f in part.faces if find(f[0]) == root]
        trees[root] = BVHTree.FromPolygons(part.verts, faces)
    roots = list(groups)
    reached, frontier = {roots[0]}, [roots[0]]
    while frontier:
        current = frontier.pop()
        for other in roots:
            if other in reached:
                continue
            near = trees[other].overlap(trees[current]) or any((trees[current].find_nearest(part.verts[i])[3] or 9) < .02 for i in groups[other])
            if near:
                reached.add(other)
                frontier.append(other)
    if len(reached) < len(roots):
        raise RuntimeError(f'{len(roots) - len(reached)} piece(s) float')


def review(objects):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    world = bpy.data.worlds.new('sky')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (.62, .74, .86, 1)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    scene.collection.objects.link(sun)
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    kinds = sorted({o.name.split('_')[0] for o in objects}, key=['broadleaf', 'round', 'tall', 'shrub', 'palm'].index)
    for obj in objects:
        kind, level = obj.name.split('_')
        scale = .42 if kind == 'palm' else 1
        obj.scale = (scale, scale, scale)
        obj.location = (kinds.index(kind) * 5.4 - 11, -int(level) * 5.4 + 5, 0)
    # The review shows the plain mesh colours, with no lighting tricks from the game.
    for m in bpy.data.materials:
        if m.use_nodes:
            node = m.node_tree.nodes.new('ShaderNodeVertexColor')
            node.layer_name = 'Color'
            m.node_tree.links.new(node.outputs['Color'], m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
    camera = bpy.data.objects.new('camera', bpy.data.cameras.new('camera'))
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.lens = 45
    camera.location = (0, -28, 13)
    camera.rotation_euler = (Vector((0, 0, 1)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = f'{REVIEW}/levels.png'
    bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(REVIEW, exist_ok=True)
    paint = bpy.data.materials.new('Tree vertex colour')
    paint.use_nodes = True
    built, total = [], 0
    for kind in ('broadleaf', 'round', 'tall', 'shrub'):
        source = hull(kind)
        tree = BVHTree.FromPolygons([v.co for v in source.data.vertices], [p.vertices for p in source.data.polygons])
        for level in range(len(CANOPY[kind]) + 1):
            part = tree_level(kind, level, source, tree)
            joined(part)
            built.append(as_object(f'{kind}_{level}', part, paint))
            total += len(part.faces)
            print('BUILT', f'{kind}_{level}'.ljust(14), len(part.faces), 'triangles', len(part.verts), 'vertices')
        if kind != 'shrub':
            part = distant_level(kind, source)
            joined(part)
            level = len(CANOPY[kind]) + 1
            built.append(as_object(f'{kind}_{level}', part, paint))
            total += len(part.faces)
            print('BUILT', f'{kind}_{level}'.ljust(14), len(part.faces), 'triangles', len(part.verts), 'vertices')
        bpy.data.objects.remove(source, do_unlink=True)
    for level in range(3):
        part = palm_level(level)
        joined(part)
        built.append(as_object(f'palm_{level}', part, paint))
        total += len(part.faces)
        print('BUILT', f'palm_{level}'.ljust(14), len(part.faces), 'triangles', len(part.verts), 'vertices')
    bpy.ops.object.select_all(action='DESELECT')
    for obj in built:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=OUT, use_selection=True, export_format='GLB', export_yup=True, export_normals=True, export_animations=False,
        export_vertex_color='ACTIVE', export_active_vertex_color_when_no_material=True, export_materials='NONE',
    )
    print('EXPORTED', os.path.getsize(OUT), 'bytes', total, 'triangles in all levels')
    if not os.environ.get('POCKET_NO_REVIEW'):
        review(built)


main()
