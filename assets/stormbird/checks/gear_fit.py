"""Read-only measurements of the saved CAD artifact. Never starts the game."""
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from cadgen import read_scene, build123d as b
from stormbird import v, tube
from mechanisms import LEGS, DOORS, segments

root=Path(__file__).resolve().parents[1]
scene=read_scene(root/'STEP/Stormbird-HX40.step')
occurrences={}
nodes={}
def visit(node):
    occurrences[node.label]=node.ref
    nodes[node.label]=node
    for child in node.children: visit(child)
for node in scene.roots: visit(node)
cache={}
def shape(name):
    if name not in cache: cache[name]=scene.resolve(occurrences[name]).shape()
    return cache[name]
def flat(s): return b.Compound(list(s.solids()))
def bounds(s):
    bb=s.bounding_box(optimal=False)
    return list(bb.min),list(bb.max)
def overlaps_bounds(a,c):
    amin,amax=bounds(a); cmin,cmax=bounds(c)
    return all(amin[i]<=cmax[i] and cmin[i]<=amax[i] for i in range(3))
def common_volume(a,c):
    if not overlaps_bounds(a,c): return 0
    common=a.intersect(flat(c))
    return sum(p.volume for p in common) if common else 0
def rotate(s,point,angle,axis=(1,0,0)):
    return flat(s).rotate(b.Axis(v(point),axis),angle)

report={'document_hash':scene.document_hash,'units':'mm','interference_threshold_mm3':.1,
        'wheels':[],'mounts':[],'poses':[],'solids':{}}
invalid=[]; solid_count=0
for leaf in scene.leaves():
    s=scene.resolve(leaf.ref).shape()
    if not s.is_valid or any(p.volume<=0 for p in s.solids()): invalid.append(leaf.label)
    solid_count+=len(s.solids())
report['solids']={'count':solid_count,'invalid':invalid}
obstacles=['Fuselage','Radome','Wing_Left','Wing_Right','Cockpit_pressure_floor',
           *[n for n in occurrences if '_bay_roof' in n],
           *[n for n in occurrences if '_door_' in n and ('_mount_' in n or '_hinge_' in n)]]
# Reserve the modeled engine-case radius along each shaft, even where the
# fictional asset omits hidden engine internals.
for side,label in [(-1,'Left'),(1,'Right')]:
    name='Engine_core_reservation_'+label
    cache[name]=tube(name,(side*1.40,.04,1.92),(side*1.28,-6.52,1.90),.449)
    obstacles.append(name)
report['engine_bay_roof_overlaps_mm3']={}
for roof in [n for n in occurrences if 'Main_bay_roof' in n]:
    for engine in ['Engine_core_reservation_Left','Engine_core_reservation_Right']:
        volume=common_volume(shape(roof),shape(engine))
        if volume>.1:report['engine_bay_roof_overlaps_mm3'][roof+' / '+engine]=round(volume,3)
report['door_mounts']=[]
for name in [n for n in occurrences if n.startswith('Main_door_') and '_mount_' in n]:
    engine='Engine_core_reservation_'+('Left' if name.startswith('Main_door_Left_') else 'Right')
    report['door_mounts'].append({'name':name,'fuselage_embedding_mm3':round(common_volume(shape(name),shape('Fuselage')),3),
                                 'engine_overlap_mm3':round(common_volume(shape(name),shape(engine)),3)})
for leg in LEGS:
    name=leg['name']
    for tire in [n for n in occurrences if n.startswith(name+'_tire_')]:
        bb=shape(tire).bounding_box(optimal=True)
        report['wheels'].append({'name':tire,'ground_gap_mm':round(bb.min.Z,4),'diameter_mm':round(bb.size.Z,3)})
    for mount in [n for n in occurrences if n.startswith(name) and ('_bearing_' in n or n.endswith(('_brace_mount','_actuator_mount')))]:
        hosts=['Fuselage']
        embedding={host:round(common_volume(shape(mount),shape(host)),3) for host in hosts}
        host=max(embedding,key=embedding.get)
        report['mounts'].append({'name':mount,'host':host,'embedded_mm3':embedding[host],
                                'airframe_contacts_mm3':embedding})
    for fraction in [0,.25,.5,.75,1]:
        def smooth(a,c,t):
            u=max(0,min(1,(t-a)/(c-a))); return u*u*(3-2*u)
        angle=leg['angle']*smooth(leg['start'],leg['end'],fraction)
        components=[]
        for child in nodes[name].children:
            item=scene.resolve(child.ref).shape()
            if leg.get('swivel') and child.label==leg['swivel']['name']:
                swivel=leg['swivel']
                item=rotate(item,swivel['point'],swivel['angle']*smooth(.30,.75,fraction),(0,0,1))
            components.extend(rotate(item,leg['point'],angle).solids())
        posed=b.Compound(components)
        moving=[(name,posed)]
        for segment,(a,c) in segments(gear_angles={name:angle}).items():
            if not segment.startswith(name+'_'): continue
            if '_torque_link_' in segment: continue  # rides with the rigid leg
            ra,rc=segments()[segment]
            u,w=v(rc)-v(ra),v(c)-v(a); cross=u.cross(w)
            item=flat(shape(segment))
            if cross.length>1e-8: item=item.rotate(b.Axis(v(ra),cross),u.get_angle(w))
            item=item.moved(b.Pos(v(a)-v(ra)))
            moving.append((segment,item))
        obs=[(n,shape(n)) for n in obstacles]
        if fraction==1:
            obs.extend((d['name'],rotate(shape(d['name']),d['point'],-d['open_angle'],(0,1,0)))
                       for d in DOORS if d['name'].startswith('Nose')==(name=='Nose_gear'))
        collisions={}
        for part,s in moving:
            for obstacle,o in obs:
                vol=common_volume(s,o)
                if vol>.1: collisions[part+' / '+obstacle]=round(vol,3)
        report['poses'].append({'leg':name,'phase':fraction,'degrees':angle,'collisions_mm3':collisions})
        print(name,angle,collisions,flush=True)
target=root/'validation/gear-rebuild.json'
target.write_text(json.dumps(report,indent=2))
print(target,flush=True)
if invalid or report['engine_bay_roof_overlaps_mm3'] or any(p['collisions_mm3'] for p in report['poses']) or any(m['embedded_mm3']<=.1 for m in report['mounts']) or any(m['engine_overlap_mm3']>.1 or m['fuselage_embedding_mm3']<=.1 for m in report['door_mounts']):
    raise SystemExit('CAD attachment or gear clearance requires correction')
