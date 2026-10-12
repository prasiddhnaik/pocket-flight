"""Independent GLB import, editable native save and reopen validation."""
import bpy, json, math
from pathlib import Path

root=Path(__file__).resolve().parents[1]
required=['Wing_Left','Wing_Right','LandingGear','Aileron_Left','Flap_Right','Rudder']
evidence=[]
for source,destination in [
    ('peregrine-hx27.glb','assets/peregrine/Peregrine-HX27-detail-fixed.blend'),
    ('aurelia-flight.glb','assets/aurelia/Aurelia-S32-flight-detail-fixed.blend'),
]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(root/'public/assets'/source))
    assert all(name in bpy.data.objects for name in required), 'Missing imported rig node'
    assert all(math.isfinite(c) for o in bpy.data.objects if o.type=='MESH' for v in o.data.vertices for c in v.co)
    bpy.context.preferences.filepaths.save_version=0
    path=root/destination
    bpy.ops.wm.save_as_mainfile(filepath=str(path))
    bpy.ops.wm.open_mainfile(filepath=str(path))
    assert all(name in bpy.data.objects for name in required), 'Rig missing after native reopen'
    assert all(math.isfinite(c) for o in bpy.data.objects if o.type=='MESH' for v in o.data.vertices for c in v.co)
    evidence.append({'source':source,'saved':destination,'native_reopened':True,'meshes':sum(o.type=='MESH' for o in bpy.data.objects),'actions':len(bpy.data.actions),'required_nodes':required})
(root/'output/fleet-native-reopen.json').write_text(json.dumps(evidence,indent=2))
print('REPAIRED_AIRCRAFT_NATIVE_OK',json.dumps(evidence),flush=True)
