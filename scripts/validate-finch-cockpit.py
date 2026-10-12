"""Read-only native-file reopen validation, separate from generation/export."""
import bpy, math, json, bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/finch/Finch-U2-cockpit.blend'))
required=['Cockpit','Canopy','PilotEye_Left','PilotEye_Right','ControlStick_Left',
          'ControlStick_Right','Throttle','Canopy_ram_barrel_Left','Canopy_ram_piston_Right']
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
(ROOT/'output/finch-cockpit-native-evidence.json').write_text(json.dumps(evidence,indent=2))
print('FINCH_NATIVE_REOPEN_OK',json.dumps(evidence),flush=True)
