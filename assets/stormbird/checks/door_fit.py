"""Inspect saved door panels through static poses, without starting the game."""
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from cadgen import read_scene, build123d as b
from stormbird import v
from mechanisms import DOORS

root=Path(__file__).resolve().parents[1]
scene=read_scene(root/'STEP/Stormbird-HX40.step')
refs={n.label:n.ref for n in scene.leaves()}
body=scene.resolve(refs['Fuselage']).shape()
report={'document_hash':scene.document_hash,'units':'mm','threshold_mm3':.1,'poses':[]}
for door in DOORS:
    for suffix in ['_skin','_rib']:
        source=scene.resolve(refs[door['name']+suffix]).shape()
        axis=b.Axis(v(door['point']),door['axis'])
        for fraction in [0,.25,.5,.75,1]:
            posed=b.Compound(list(source.solids())).rotate(axis,(fraction-1)*door['open_angle'])
            common=posed.intersect(b.Compound(list(body.solids())))
            volume=sum(s.volume for s in common.solids()) if common else 0
            record={'part':door['name']+suffix,'open_fraction':fraction,'airframe_overlap_mm3':round(volume,4)}
            if volume>.1:
                bb=b.Compound(list(common.solids())).bounding_box(optimal=True)
                record['overlap_bounds']=[list(bb.min),list(bb.max)]
            report['poses'].append(record)
            if volume>.1:print(record,flush=True)
target=root/'validation/door-fit.json'
target.write_text(json.dumps(report,indent=2))
print(target,flush=True)
if any(p['airframe_overlap_mm3']>.1 for p in report['poses']):raise SystemExit('Door running clearance requires correction')
