import bpy, json, math
from pathlib import Path
from mathutils import Vector
root=Path(__file__).resolve().parents[1]
project=root.parents[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(project/'public/assets/peregrine-hx27.glb'))
objects=list(bpy.context.scene.objects)
wheels=[o for o in objects if o.type=='EMPTY' and o.name.startswith(('Main_wheel_','Nose_wheel_'))]
assert len(wheels)==6, [o.name for o in wheels]
required=['Canopy','LandingGear','Nose_steering','Rudder']+[part+'_'+side for part in ['Wing','Aileron','Flap','Elevator','Engine'] for side in ['Left','Right']]
assert all(bpy.data.objects.get(n) for n in required)
vertices=[o.matrix_world@v.co for o in objects if o.type=='MESH' for v in o.data.vertices]
assert all(math.isfinite(c) for v in vertices for c in v)
contacts={}
for wheel in wheels:
    verts=[o.matrix_world@v.co for o in wheel.children_recursive if o.type=='MESH' for v in o.data.vertices]
    assert verts
    contacts[wheel.name]=min(v.z for v in verts)
    assert -.01<contacts[wheel.name]<.04,contacts
report={'status':'passed','wheel_count':len(wheels),'wheel_lowest_z_m':contacts,'articulation_groups':required,'finite_vertices':len(vertices),'mesh_count':sum(o.type=='MESH' for o in objects)}
(root/'validation/roundtrip.json').write_text(json.dumps(report,indent=2))
print('ROUNDTRIP_VERIFIED',json.dumps(report))
