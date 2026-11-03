"""Check the exported Heron: every part joined to the body, inside budget, and mirrored.

  Blender --background --python-exit-code 1 --python scripts/check-heron-skin.py

Writes assets/heron/checks/skin-connectivity.json, which measure-heron.ts folds into the model's
report. Parts are walked outward from the fuselage, so a part only counts if a chain of real
contact reaches it. Decals (panel lines, frames) only need to lie close against what they mark.
"""
import bpy, json, os, sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLB = BASE + '/public/assets/heron-ut9.glb'
REPORT = BASE + '/assets/heron/checks/skin-connectivity.json'
BUDGET = 479176
TOUCHING = .012
# Hinged surfaces keep a real gap, so they may sit this far from what carries them.
HINGE_GAP = .06
DECALS = ('Panel_lines', 'Window_frames', 'Windshield_post')
MOVING = ('Flap_', 'Aileron_', 'Elevator_skin', 'Rudder_skin')
REQUIRED = ['Fuselage', 'Curved_belly_livery', 'Cabin_cheatline', 'Cabin_liner', 'Cargo_pod', 'Chin_cowling', 'Engine_inlet', 'Exhaust_Right',
            'Windshield', 'Crew_window_Left', 'Crew_window_Right', 'Fin_skin', 'Rudder_skin', 'Tailplane_Left', 'Tailplane_Right',
            'Elevator_skin_Left', 'Elevator_skin_Right', 'Wing_skin_Left', 'Wing_skin_Right', 'Wing_strut_Left', 'Wing_strut_Right',
            'Wing_boot_Left', 'Wing_boot_Right', 'Panel_lines', 'Window_frames']
REQUIRED += [f'Cabin_window_{side}_{i}' for side in ('Left', 'Right') for i in range(1, 8)]
MIRRORED = ['Tailplane', 'Elevator_skin', 'Wing_skin', 'Wing_strut', 'Wing_boot', 'Crew_window']

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
meshes = {o.name: o for o in bpy.data.objects if o.type == 'MESH'}
errors, tris = [], 0
for o in meshes.values():
    o.data.calc_loop_triangles()
    tris += len(o.data.loop_triangles)
for name in REQUIRED:
    if name not in meshes:
        errors.append('missing ' + name)
if tris > BUDGET:
    errors.append(f'{tris} triangles over {BUDGET}')


def world_points(o):
    return [o.matrix_world @ v.co for v in o.data.vertices]


trees = {name: BVHTree.FromPolygons(world_points(o), [p.vertices for p in o.data.polygons]) for name, o in meshes.items() if o.data.polygons}
samples = {}
for name, o in meshes.items():
    points = world_points(o)
    samples[name] = points[:: max(1, len(points) // 800)]


def touches(a, b, limit):
    if trees[a].overlap(trees[b]):
        return True
    return any(trees[b].find_nearest(p)[3] is not None and trees[b].find_nearest(p)[3] <= limit for p in samples[a])


if not errors:
    allowance = lambda name: HINGE_GAP if name.startswith(MOVING) else TOUCHING
    centres = {name: sum(samples[name], Vector()) / len(samples[name]) for name in trees}
    paths = {'Fuselage': ['Fuselage']}
    frontier = ['Fuselage']
    waiting = [name for name in trees if name != 'Fuselage']
    while frontier:
        current = frontier.pop()
        for name in list(waiting):
            limit = allowance(name) if name in meshes else TOUCHING
            if touches(name, current, limit):
                paths[name] = paths[current] + [name]
                waiting.remove(name)
                frontier.append(name)
    for name in waiting:
        errors.append(f'{name} floats: nothing joins it to the body')
    # Every loose piece of a part must itself be against something, not just the part as a whole.
    for name, o in meshes.items():
        if name in waiting or not o.data.polygons:
            continue
        parent = list(range(len(o.data.vertices)))

        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i
        for e in o.data.edges:
            a, b = find(e.vertices[0]), find(e.vertices[1])
            if a != b:
                parent[a] = b
        # Import splits vertices at sharp edges, so points in the same place count as joined.
        seen = {}
        for v in o.data.vertices:
            key = tuple(round(c, 4) for c in v.co)
            if key in seen:
                a, b = find(v.index), find(seen[key])
                if a != b:
                    parent[a] = b
            else:
                seen[key] = v.index
        islands = {}
        for i in range(len(parent)):
            islands.setdefault(find(i), []).append(i)
        if len(islands) < 2:
            continue
        others = [t for n, t in trees.items() if n != name]
        for members in islands.values():
            point = o.matrix_world @ o.data.vertices[members[0]].co
            nearest = min((d for d in (t.find_nearest(point)[3] for t in others) if d is not None), default=9)
            within = [o.matrix_world @ o.data.vertices[i].co for i in members[:: max(1, len(members) // 8)]]
            nearest = min(nearest, *[min((d for d in (t.find_nearest(p)[3] for t in others) if d is not None), default=9) for p in within])
            if nearest > .03:
                errors.append(f'a piece of {name} floats {nearest:.3f} m from everything')
    for stem in MIRRORED:
        left, right = meshes.get(f'{stem}_Left'), meshes.get(f'{stem}_Right')
        if not left or not right:
            continue
        span = lambda o, axis: (min(p[axis] for p in samples[o.name]), max(p[axis] for p in samples[o.name]))
        for axis in range(3):
            a, b = span(left, axis), span(right, axis)
            if axis == 0:
                b = (-b[1], -b[0])
            if abs(a[0] - b[0]) > .02 or abs(a[1] - b[1]) > .02:
                errors.append(f'{stem} is not mirrored on axis {axis}')
    # The floor has skin around it in every direction.
    floor = meshes['Cabin_floor']
    centre = sum(world_points(floor), Vector()) / len(floor.data.vertices)
    enclosing = [trees[n] for n in ('Fuselage', 'Curved_belly_livery', 'Cabin_cheatline', 'Cabin_liner')]
    directions = [Vector(d) for d in ((1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1))]
    enclosed = all(any(t.ray_cast(centre, d)[0] is not None for t in enclosing) for d in directions)
    if not enclosed:
        errors.append('the cabin floor is not enclosed')
    with open(REPORT, 'w') as f:
        json.dump({
            'solidCount': len(trees),
            'connectedSolids': len(paths),
            'floating': waiting,
            'floorEnclosed': enclosed,
            'pathsToBody': {f'{name}#0': [f'{p}#0' for p in path] for name, path in paths.items()},
        }, f, indent=1)
print('TRIANGLES', tris)
print('\n'.join(errors) or 'SKIN CHECK PASSED')
sys.exit(1 if errors else 0)
