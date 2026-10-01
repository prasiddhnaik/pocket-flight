"""Saved CAD fit and rear visibility checks; never launches the aircraft."""
import hashlib
import json
import math
from pathlib import Path
import numpy as np
from cadgen import read_scene, build123d as b
from cadgen.geometry import closest_points

root=Path(__file__).resolve().parents[1]
scene=read_scene(root/'STEP/Stormbird-HX40.step')
nodes={}
def visit(node):
    nodes[node.label]=node
    for child in node.children:visit(child)
for node in scene.roots:visit(node)
def shape(name):return scene.resolve(nodes[name].ref).shape()
def overlap(a,c):
    aa=a.bounding_box();cc=c.bounding_box()
    amn,amx,cmn,cmx=map(list,[aa.min,aa.max,cc.min,cc.max])
    if any(amx[i]<cmn[i] or cmx[i]<amn[i] for i in range(3)):return 0
    with b.SkipClean():
        common=b.Compound(list(a.solids())).intersect(b.Compound(list(c.solids())))
    return sum(s.volume for s in common) if common else 0

report={'document_hash':scene.document_hash,'units':'mm','threshold_mm3':.1,
        'pairs':[],'engines':[],'solids':{},
        'scope':'Static native fit and projected rear-view occlusion only; no flight, airflow or runtime aircraft tests.'}
invalid=[];count=0
for leaf in scene.leaves():
    part=scene.resolve(leaf.ref).shape();solids=list(part.solids());count+=len(solids)
    if not part.is_valid or any(s.volume<=0 for s in solids):invalid.append(leaf.label)
report['solids']={'count':count,'invalid':invalid}
assert not invalid,invalid
assert not any(n.startswith('Fin_root_fillet_') for n in nodes)
body=shape('Fuselage')
for side in ['Left','Right']:
    pairs=[('Wing_skin_',p) for p in ['Flap_','Aileron_','Wingtip_identification_','Elevator_','Tailplane_']]
    pairs += [('Tailplane_','Elevator_'),('Fin_','Rudder_')]
    for a,c in pairs:
        report['pairs'].append({'parts':[a+side,c+side],'overlap_mm3':overlap(shape(a+side),shape(c+side))})
    for name in ['Flap_','Aileron_','Elevator_','Rudder_']:
        report['pairs'].append({'parts':[name+side,'Fuselage'],'overlap_mm3':overlap(shape(name+side),body)})
    for tail in ['Tailplane_','Elevator_','Fin_','Rudder_']:
        for case in ['Engine_core_case_','Exhaust_liner_','Turbine_case_']:
            report['pairs'].append({'parts':[tail+side,case+side],'overlap_mm3':overlap(shape(tail+side),shape(case+side))})
    root_embed=overlap(shape('Tailplane_'+side),body)
    fin_embed=overlap(shape('Fin_'+side),body)
    stage=nodes['Turbine_stage_'+side]
    rotor={c.label:scene.resolve(c.ref).shape() for c in stage.children}
    blade=rotor['Turbine_blade_0'];neighbor=rotor['Turbine_blade_1']
    data={'name':side,'blade_count':sum(n.startswith('Turbine_blade_') for n in rotor),
          'blade_root_embed_mm3':overlap(blade,rotor['Turbine_hub']),
          'blade_neighbor_overlap_mm3':overlap(blade,neighbor),
          'blade_neighbor_gap_mm':closest_points(blade,neighbor).distance,
          'blade_case_gap_mm':closest_points(blade,shape('Turbine_case_'+side)).distance,
          'tail_root_embed_mm3':root_embed,'fin_root_embed_mm3':fin_embed}
    spool=shape('Engine_spool_'+side)
    data['spool_shaft_embed_mm3']=overlap(spool,shape('Engine_shaft_'+side))
    data['combustor_mounts']=[]
    for name in nodes:
        if name.startswith('Combustor_dome_support_'+side):
            mount=shape(name)
            data['combustor_mounts'].append({'name':name,
                'inner_liner_embed_mm3':overlap(mount,shape('Combustor_inner_liner_'+side)),
                'spool_embed_mm3':overlap(mount,spool)})
        if name.startswith('Combustor_outer_mount_'+side):
            mount=shape(name)
            data['combustor_mounts'].append({'name':name,
                'outer_liner_embed_mm3':overlap(mount,shape('Combustor_outer_liner_'+side)),
                'core_case_embed_mm3':overlap(mount,shape('Engine_core_case_'+side))})
    report['engines'].append(data)
    print(json.dumps({k:v for k,v in data.items() if k!='combustor_mounts'}),flush=True)

# The transfer uses game metres: X across, Y up, Z aft. Project turbine triangles
# onto X/Y; all lie between the rear observer and the upstream compressor.
transfer_path=root/'GLB/cad-transfer.json'
report['transfer_sha256']=hashlib.sha256(transfer_path.read_bytes()).hexdigest()
transfer=json.loads(transfer_path.read_text())
report['rear_visibility']={'samples':0,'unblocked':[],'radii_m':[.08,.16,.22,.30,.38]}
for sign,side in [(-1,'Left'),(1,'Right')]:
    triangles=[]
    for part in transfer['parts']:
        if 'Turbine_stage_'+side in part['parents']:
            vertices=np.asarray(part['vertices'])
            assert np.all(vertices[:,2]>5.8)
            triangles.append(vertices[np.asarray(part['faces']),:2])
    triangles=np.concatenate(triangles)
    a=triangles[:,0];u=triangles[:,1]-a;v=triangles[:,2]-a
    determinant=u[:,0]*v[:,1]-u[:,1]*v[:,0]
    valid=np.abs(determinant)>1e-12
    a,u,v,determinant=a[valid],u[valid],v[valid],determinant[valid]
    for radius in report['rear_visibility']['radii_m']:
        for degrees in range(0,360,10):
            angle=math.radians(degrees)
            point=np.array([sign*1.28+radius*math.cos(angle),1.90+radius*math.sin(angle)])
            delta=point-a
            s=(delta[:,0]*v[:,1]-delta[:,1]*v[:,0])/determinant
            t=(u[:,0]*delta[:,1]-u[:,1]*delta[:,0])/determinant
            report['rear_visibility']['samples']+=1
            if not np.any((s>=-1e-8)&(t>=-1e-8)&(s+t<=1+1e-8)):
                report['rear_visibility']['unblocked'].append({'engine':side,'radius_m':radius,'angle_degrees':degrees})
target=root/'validation/aft-airframe-fit.json'
target.write_text(json.dumps(report,indent=2)+'\n')
assert all(p['overlap_mm3']<.1 for p in report['pairs']),report['pairs']
assert not report['rear_visibility']['unblocked'],report['rear_visibility']
for engine in report['engines']:
    assert engine['blade_count']==48 and engine['blade_root_embed_mm3']>.1
    assert engine['blade_neighbor_overlap_mm3']<.1 and engine['blade_case_gap_mm']>1
    assert engine['tail_root_embed_mm3']>.1 and engine['fin_root_embed_mm3']>.1
    assert engine['spool_shaft_embed_mm3']>.1 and len(engine['combustor_mounts'])==24
    assert all(value>.1 for mount in engine['combustor_mounts'] for key,value in mount.items() if key!='name')
print(json.dumps({'report':str(target),'solids':count,'pair_count':len(report['pairs']),
                  'rear_samples':report['rear_visibility']['samples'],'unblocked':len(report['rear_visibility']['unblocked'])}),flush=True)
