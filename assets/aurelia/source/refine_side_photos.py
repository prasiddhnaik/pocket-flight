"""Remove orthographic under-floor artifacts without changing aircraft geometry."""
import bpy,sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'Aurelia-S32-studio.blend'))
s=bpy.context.scene;c=s.camera
for o in s.objects:
    if o.type=='MESH' and any(m and m.name=='Studio | mist' for m in o.data.materials):o.scale*=20000/o.dimensions.x
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='METAL';prefs.get_devices()
for d in prefs.devices:d.use=d.type=='METAL'
s.cycles.device='GPU';s.cycles.samples=40;c.data.clip_end=5000
views=[('front',(0,50,6),(0,0,4.3),33),('back',(0,-50,6),(0,0,4.3),33),('left',(-50,0,5),(0,0,4.3),37),('right',(50,0,5),(0,0,4.3),37),('top',(0,0,55),(0,0,0),52),('gear',(8,13,3),(0,4,1.4),20)]
selected=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [v[0] for v in views]
for name,pos,target,scale in views:
    if name not in selected:continue
    target=Vector(target);c.location=target+(Vector(pos)-target)*(1 if name=='top' else 20);c.rotation_euler=(target-c.location).to_track_quat('-Z','Y').to_euler();c.data.ortho_scale=scale;s.render.filepath=str(ROOT/'renders'/f'{name}.png');bpy.ops.render.render(write_still=True);print('Photo fixed',name,flush=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'Aurelia-S32-studio.blend'))
