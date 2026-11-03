"""Check the F-15C Blender skin in the exported game model.

  Blender --background --python scripts/check-f15c-skin.py

Exits non-zero on a missing part, a floating part, left/right mismatch or over budget.
"""
import bpy, os, re, sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLB = os.environ.get('POCKET_F15C_GLB') or BASE + '/public/assets/f15c-eagle.glb'
BUDGET = 506380
TOUCHING = .012   # Fixed parts overlap or sit on their parent.
RUNNING_GAP = .05  # Moving surfaces may clear their parent by this much.
REQUIRED = [
    'Fuselage', 'Radome', 'Wing_fixed_Left', 'Wing_fixed_Right', 'Flap_Left_skin', 'Flap_Right_skin',
    'Aileron_Left_skin', 'Aileron_Right_skin', 'Fin_Left', 'Fin_Right', 'Rudder_Left_skin', 'Rudder_Right_skin',
    'Stabilator_Left_skin', 'Stabilator_Right_skin', 'Stabilator_shaft_Left_skin', 'Stabilator_shaft_Right_skin',
    'Fin_tip_fairing_Left', 'Fin_tip_fairing_Right', 'Canopy_glass', 'Windshield_glass', 'Airbrake_panel', 'Panel_lines',
    'Door_Nose_Forward_skin', 'Door_Nose_Aft_skin', 'Door_Left_Forward_skin', 'Door_Left_Inner_skin', 'Door_Left_Aft_skin',
    'Door_Right_Forward_skin', 'Door_Right_Inner_skin', 'Door_Right_Aft_skin', 'Upper_beacon',
    *[f'Wing_fuel_cell_{side}_{n}' for side in ('Left', 'Right') for n in (1, 2, 3)],
    *[f'Wing_fuel_line_{side}_{n}' for side in ('Left', 'Right') for n in (1, 2)],
    'Wing_fuel_feed_Left', 'Wing_fuel_feed_Right', 'Pylon_Left', 'Pylon_Right',
    'Pylon_arm_Left_inner', 'Pylon_arm_Left_outer', 'Pylon_arm_Right_inner', 'Pylon_arm_Right_outer',
    'Pylon_rail_Left_inner', 'Pylon_rail_Left_outer', 'Pylon_rail_Right_inner', 'Pylon_rail_Right_outer',
    'Launcher_Left_fwd', 'Launcher_Left_aft', 'Launcher_Right_fwd', 'Launcher_Right_aft',
    'Mount_Left', 'Mount_Right', 'Mount_Nose',
]
# Part: what it must touch, and how closely. Anything skin-side not listed touches the fuselage.
PARENTS = {
    'Flap_(Left|Right)_skin': ('Wing_fixed_{}', RUNNING_GAP),
    'Aileron_(Left|Right)_skin': ('Wing_fixed_{}', RUNNING_GAP),
    'Rudder_(Left|Right)_skin': ('Fin_{}', RUNNING_GAP),
    'Fin_tip_fairing_(Left|Right)': ('Fin_{}', TOUCHING),
    'Stabilator_(Left|Right)_skin': ('Stabilator_shaft_{}_skin', RUNNING_GAP),
    'Canopy_glass': ('Windshield_glass', RUNNING_GAP),
    'Door_.*_skin': ('Fuselage', RUNNING_GAP),
    'Airbrake_panel': ('Fuselage', RUNNING_GAP),
    # The cell sits inside the wing skin, by design not touching it.
    'Wing_fuel_cell_(Left|Right)_\\d': ('Wing_fixed_{}', .12),
    'Wing_fuel_line_(Left|Right)_1': ('Wing_fuel_cell_{}_1', TOUCHING),
    'Wing_fuel_line_(Left|Right)_2': ('Wing_fuel_cell_{}_2', TOUCHING),
    'Wing_fuel_feed_(Left|Right)': ('Fuselage', TOUCHING),
    'Pylon_(Left|Right)': ('Wing_fixed_{}', TOUCHING),
    'Pylon_arm_(Left|Right)_(?:inner|outer)': ('Pylon_{}', TOUCHING),
    'Pylon_rail_(Left|Right)_(inner|outer)': ('Pylon_arm_{}_{}', TOUCHING),
}
MIRRORED = ['Wing_fixed', 'Flap', 'Aileron', 'Fin', 'Rudder', 'Stabilator']

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
depsgraph = bpy.context.evaluated_depsgraph_get()
errors, trees, meshes, tris = [], {}, {}, 0


def tree(name):
    if name not in trees:
        o = bpy.data.objects[name]
        verts = [o.matrix_world @ v.co for v in o.data.vertices]
        trees[name] = BVHTree.FromPolygons(verts, [p.vertices for p in o.data.polygons])
    return trees[name]


def clearance(name, parent):
    """Zero when the parts overlap, otherwise the nearest sampled distance."""
    a, b = tree(name), tree(parent)
    if a.overlap(b):
        return 0
    o = bpy.data.objects[name]
    step = max(1, len(o.data.vertices) // 1500)
    return min((b.find_nearest(o.matrix_world @ v.co)[3] for v in o.data.vertices[::step]), default=9)


for o in bpy.data.objects:
    if o.type == 'MESH':
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
for name in REQUIRED:
    if name not in bpy.data.objects:
        errors.append('missing ' + name)
if tris > BUDGET:
    errors.append(f'{tris} triangles over {BUDGET}')
if not errors:
    for name in REQUIRED:
        if name == 'Fuselage':
            continue
        parent, limit = 'Fuselage', TOUCHING
        for pattern, (target, gap) in PARENTS.items():
            match = re.fullmatch(pattern, name)
            if match:
                parent, limit = target.format(*match.groups()), gap
        gap = clearance(name, parent)
        if gap > limit:
            errors.append(f'{name} floats {gap:.3f} m from {parent}')
    for stem in MIRRORED:
        suffix = '_skin' if stem in ('Flap', 'Aileron', 'Rudder', 'Stabilator') else ''
        left, right = bpy.data.objects[f'{stem}_Left{suffix}'], bpy.data.objects[f'{stem}_Right{suffix}']
        box = lambda o: [o.matrix_world @ Vector(c) for c in o.bound_box]
        l, r = box(left), box(right)
        for axis in range(3):
            a = (min(c[axis] for c in l), max(c[axis] for c in l))
            b = (min(c[axis] for c in r), max(c[axis] for c in r))
            if axis == 0:
                b = (-b[1], -b[0])
            if abs(a[0] - b[0]) > .01 or abs(a[1] - b[1]) > .01:
                errors.append(f'{stem} is not mirrored on axis {axis}')
print('TRIANGLES', tris)
print('\n'.join(errors) or 'SKIN CHECK PASSED')
sys.exit(1 if errors else 0)
