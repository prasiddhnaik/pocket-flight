"""Read-only native-file reopen validation, separate from generation/export."""
import bpy, math, json, bmesh, sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from pathlib import Path
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from finch_wing_markings import validate_wing_markings
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/finch/Finch-U2-cockpit.blend'))
required=['Cockpit','Canopy','PilotEye_Left','PilotEye_Right','ControlStick_Left',
          'ControlStick_Right','Throttle','Canopy_ram_barrel_Left','Canopy_ram_piston_Right',
          'RearCabinBulkhead','InternalSystems','BellyFuelBay','AftEquipmentBay',
          'Fitted rear cabin partition','Conformal belly fuel cell','Battery enclosure',
          'Avionics equipment enclosure','Fuel pickup strainer','Fuel sump drain']
for name in required:
    if name not in bpy.data.objects:raise RuntimeError('Missing '+name)
bpy.context.view_layer.update()
nonfinite=0;triangles=0;meshes=0
for o in bpy.data.objects:
    if o.type!='MESH':continue
    meshes+=1;o.data.calc_loop_triangles();triangles+=len(o.data.loop_triangles)
    for v in o.data.vertices:
        if not all(math.isfinite(x) for x in o.matrix_world@v.co):nonfinite+=1
if nonfinite:raise RuntimeError('Nonfinite native vertices')
hinge=bpy.data.objects['Canopy'].matrix_world.translation
if (hinge.x**2+(hinge.y+.87)**2+(hinge.z-.63)**2)**.5>.00001:
    raise RuntimeError('Canopy hinge changed during save')
body=bpy.data.objects['Fuselage • Paint']
body.data.calc_loop_triangles()
surface=BVHTree.FromPolygons([body.matrix_world@v.co for v in body.data.vertices],
    [t.vertices for t in body.data.loop_triangles],all_triangles=True)
surround=bpy.data.objects['Canopy flush perimeter']
points=[Vector(p) for p in surround['mounting_edge_blender_m']]
actual=[surround.matrix_world@v.co for v in surround.data.vertices]
if any(min((p-v).length for v in actual)>.00001 for p in points):
    raise RuntimeError('Saved surround lost its mounting vertices')
gaps=[surface.find_nearest(p)[3] for p in points]
if max(gaps)>.003:raise RuntimeError('Saved surround stands off fuselage')
bm=bmesh.new();bm.from_mesh(surround.data)
open_edges=sum(not e.is_manifold for e in bm.edges);bm.free()
if open_edges:raise RuntimeError('Canopy surround has loose or open ends')
evidence={'native_reopened':True,'nonfinite_vertices':nonfinite,'meshes':meshes,
          'triangles':triangles,'canopy_hinge_blender_m':list(hinge),'required_parts':required,
          'surround_mounting_samples':len(points),'surround_skin_gap_m':max(gaps),
          'surround_open_edges':open_edges}
evidence['wing_markings'] = validate_wing_markings()

def object_surface(o):
    o.data.calc_loop_triangles()
    return BVHTree.FromPolygons([o.matrix_world@v.co for v in o.data.vertices],
        [t.vertices for t in o.data.loop_triangles], all_triangles=True)

# Check the saved meshes, independently of the builder's intended coordinates.
fascia = object_surface(bpy.data.objects['Instrument panel fascia'])
mounts = [o for o in bpy.data.objects if o.name.startswith('Switch mounting')]
keys = [o for o in bpy.data.objects if o.name.startswith('Display softkey')]
knobs = [o for o in bpy.data.objects if o.name.startswith('Avionics rotary knob')]
legends = [o for o in bpy.data.objects if o.name.startswith('Switch legend')]
if (len(mounts), len(keys), len(knobs), len(legends)) != (6, 10, 4, 6):
    raise RuntimeError('Incomplete panel controls')
for o in mounts:
    if not fascia.overlap(object_surface(o)):
        raise RuntimeError('Switch mounting floats off fascia: '+o.name)
for o in keys + knobs:
    bezel = bpy.data.objects[('PFD' if o.matrix_world.translation.x < 0 else 'MAP')+' display bezel']
    if not object_surface(bezel).overlap(object_surface(o)):
        raise RuntimeError('Display control floats off bezel: '+o.name)
legend_gaps = [fascia.find_nearest(o.matrix_world@v.co)[3] for o in legends for v in o.data.vertices]
if max(legend_gaps) > .001:
    raise RuntimeError('Switch legends stand off panel')
evidence['panel_controls'] = {'seated_switch_bases':len(mounts),
    'seated_softkeys':len(keys), 'seated_rotary_knobs':len(knobs),
    'legends_on_fascia':len(legends), 'maximum_legend_skin_gap_m':max(legend_gaps)}

tank=bpy.data.objects['Conformal belly fuel cell']
bm=bmesh.new();bm.from_mesh(tank.data)
if any(not e.is_manifold for e in bm.edges):raise RuntimeError('Fuel cell is not closed')
litres=abs(bm.calc_volume(signed=True))*1000;bm.free()
if abs(litres-tank['envelope_litres'])>.01:raise RuntimeError('Fuel volume changed on save')
intersections=[]
for group_name in ['BellyFuelBay','AftEquipmentBay','RearCabinBulkhead']:
    for o in bpy.data.objects[group_name].children_recursive:
        if o.type=='MESH' and surface.overlap(object_surface(o)):
            intersections.append(o.name)
if intersections:raise RuntimeError('Internal parts intersect fuselage: '+', '.join(intersections))
if object_surface(tank).overlap(object_surface(bpy.data.objects['Cabin floor'])):
    raise RuntimeError('Fuel cell intersects cabin floor')
skin_gap=min(surface.find_nearest(tank.matrix_world@v.co)[3] for v in tank.data.vertices)
if skin_gap<.012:raise RuntimeError('Fuel cell insufficient skin separation')
evidence['internal_systems']={'closed_fuel_cell':True,'envelope_litres':litres,
    'minimum_tank_skin_gap_m':skin_gap,'fuel_floor_intersections':0,
    'bay_fuselage_intersections':0,'rear_bulkhead_present':True,
    'fuel_centroid_glTF_m':list(bpy.data.objects['BellyFuelBay']['fuel_centroid_glTF'])}
(ROOT/'output/finch-cockpit-native-evidence.json').write_text(json.dumps(evidence,indent=2))
print('FINCH_NATIVE_REOPEN_OK',json.dumps(evidence),flush=True)
