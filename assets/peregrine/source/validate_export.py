import bpy, json, math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
root=Path(__file__).resolve().parents[1]
project=root.parents[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(project/'public/assets/peregrine-hx27.glb'))
objects=list(bpy.context.scene.objects)
wheels=[o for o in objects if o.type=='EMPTY' and o.name.startswith(('Main_wheel_','Nose_wheel_'))]
assert len(wheels)==6, [o.name for o in wheels]
required=['Canopy','Windscreen','LandingGear','Nose_steering','Rudder']+[part+'_'+side for part in ['Wing','Aileron','Flap','Elevator','Engine'] for side in ['Left','Right']]
assert all(bpy.data.objects.get(n) for n in required)
vertices=[o.matrix_world@v.co for o in objects if o.type=='MESH' for v in o.data.vertices]
assert all(math.isfinite(c) for v in vertices for c in v)
contacts={}
for wheel in wheels:
    verts=[o.matrix_world@v.co for o in wheel.children_recursive if o.type=='MESH' for v in o.data.vertices]
    assert verts
    contacts[wheel.name]=min(v.z for v in verts)
    assert -.01<contacts[wheel.name]<.04,contacts
exhaust_depths={}
for side in [-1,1]:
    origin=Vector((side*.91,-16,2.88))
    hit,location,normal,index,obj,matrix=bpy.context.scene.ray_cast(bpy.context.evaluated_depsgraph_get(),origin,Vector((0,1,0)))
    assert hit
    depth=(location-origin).length
    assert depth>3.2,('Blocked exhaust',side,depth,obj.name)
    exhaust_depths[str(side)]=depth
glass_vertices=[];glass_faces=[]
for obj in objects:
    if obj.type!='MESH' or not obj.name.startswith(('Bubble canopy glazing','Fixed windscreen glazing')):continue
    offset=len(glass_vertices);glass_vertices.extend(obj.matrix_world@v.co for v in obj.data.vertices)
    glass_faces.extend(tuple(offset+i for i in p.vertices) for p in obj.data.polygons)
assert glass_vertices
roof=BVHTree.FromPolygons(glass_vertices,glass_faces)
clearances=[]
for y in [7.025,7.335,9.025,9.335]:
    for x in [-.245,.245]:
        point=Vector((x,y,5.16));hit,normal,index,distance=roof.ray_cast(point,Vector((0,0,1)))
        assert hit is not None,('Headrest outside canopy',x,y)
        assert distance>.035,('Insufficient headrest clearance',x,y,distance)
        clearances.append(distance)
report={'canopy_min_headrest_clearance_m':min(clearances),'status':'passed','wheel_count':len(wheels),'wheel_lowest_z_m':contacts,'exhaust_depth_from_y_minus_16_m':exhaust_depths,'articulation_groups':required,'finite_vertices':len(vertices),'mesh_count':sum(o.type=='MESH' for o in objects)}
(root/'validation/roundtrip.json').write_text(json.dumps(report,indent=2))
print('ROUNDTRIP_VERIFIED',json.dumps(report))
