"""Inspect saved compressor geometry and empty airframe passages; no simulator."""
import json
import math
from pathlib import Path
from cadgen import read_scene, build123d as b
from cadgen.geometry import closest_points
from OCP.BRepClass3d import BRepClass3d_SolidClassifier
from OCP.TopAbs import TopAbs_IN, TopAbs_ON
from OCP.gp import gp_Pnt

root=Path(__file__).resolve().parents[1]
scene=read_scene(root/'STEP/Stormbird-HX40.step')
nodes={}
def visit(node):
    nodes[node.label]=node
    for child in node.children:visit(child)
for node in scene.roots:visit(node)
def shape(name):return scene.resolve(nodes[name].ref).shape()
def volume(a,c):
    common=a.intersect(c)
    return sum(s.volume for s in common) if common else 0
body=shape('Fuselage')
airframe=[body,*[shape(name) for name in nodes if name.startswith(('Wing_skin_','Wing_root_fairing_'))]]
classifiers=[BRepClass3d_SolidClassifier(solid.wrapped) for part in airframe for solid in part.solids()]
def blocked(point):
    for classifier in classifiers:
        classifier.Perform(gp_Pnt(*(p*1000 for p in point)),1e-5)
        if classifier.State() in (TopAbs_IN,TopAbs_ON):return True
    return False
report={'document_hash':scene.document_hash,'units':'mm','overlap_threshold_mm3':.1,
        'engines':[],'passage_samples':0,'blocked_passage_samples':[],
        'scope':'Static geometry and mounting only; no airflow, engine-performance or flight simulation.'}
invalid=[];solid_count=0
for leaf in scene.leaves():
    part=scene.resolve(leaf.ref).shape()
    solids=list(part.solids());solid_count+=len(solids)
    if not part.is_valid or any(s.volume<=0 for s in solids):invalid.append(leaf.label)
report['solids']={'count':solid_count,'invalid':invalid}
assert not invalid,invalid
for side,label in [(-1,'Left'),(1,'Right')]:
    rotor=nodes['Compressor_'+str(side)]
    parts={child.label:scene.resolve(child.ref).shape() for child in rotor.children}
    blades=[s for name,s in parts.items() if name.startswith('Compressor_blade_')]
    assert len(blades)==24 and all(s.is_valid and s.volume>0 for s in parts.values())
    hub=parts['Compressor_hub'];spinner=parts['Compressor_spinner']
    case=shape('Compressor_case_'+label);core=shape('Engine_core_case_'+label)
    first=blades[0];second=blades[1]
    rotor_solids=b.Compound([solid for part in parts.values() for solid in part.solids()])
    data={'name':label,'blade_count':len(blades),'rotor_parts_valid':True,
          'root_embed_mm3':volume(first,hub),
          'neighbor_overlap_mm3':volume(first,second),
          'neighbor_gap_mm':closest_points(first,second).distance,
          'tip_case_gap_mm':closest_points(first,case).distance,
          'spinner_hub_embed_mm3':volume(spinner,hub),
          'rotor_airframe_overlap_mm3':sum(volume(rotor_solids,part) for part in airframe),
          'compressor_case_airframe_embed_mm3':volume(case,body),
          'core_front_contact_gap_mm':closest_points(core,case).distance,
          'core_aft_contact_gap_mm':closest_points(core,shape('Exhaust_liner_'+label)).distance,
          'core_case_valid':core.is_valid}
    data['core_airframe_overlap_mm3']=volume(core,body)
    data['core_wing_overlap_mm3']=sum(volume(core,part) for part in airframe[1:])
    report['engines'].append(data)
    print(json.dumps(data),flush=True)
    for y in [3.7,3.4,3.25,3.0,2.6,1.5,.7,.03,.02,-.1,-.5,-1,-2,-3.4,-4.5,-6.05]:
        fraction=max(0,(-.02-y)/6.08)
        cx=side*(1.40-.12*fraction);cz=1.92-.02*fraction
        for radius in [.18,.28,.32]:
            for degrees in range(0,360,30):
                angle=math.radians(degrees)
                point=[cx+radius*math.cos(angle),y,cz+radius*math.sin(angle)]
                report['passage_samples']+=1
                if blocked(point):
                    report['blocked_passage_samples'].append({'engine':label,'point_m':point})
target=root/'validation/compressor-fit.json'
target.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'report':str(target),'passage_samples':report['passage_samples'],
                  'blocked_samples':len(report['blocked_passage_samples'])}),flush=True)
assert not report['blocked_passage_samples']
for d in report['engines']:
    assert d['root_embed_mm3']>.1 and d['spinner_hub_embed_mm3']>.1
    assert d['neighbor_overlap_mm3']<.1 and d['tip_case_gap_mm']>1
    assert d['rotor_airframe_overlap_mm3']<.1 and d['compressor_case_airframe_embed_mm3']>.1
    assert d['core_case_valid'] and d['core_front_contact_gap_mm']<.01 and d['core_aft_contact_gap_mm']<.01
    assert d['core_airframe_overlap_mm3']<.1
    assert d['core_wing_overlap_mm3']<.1
