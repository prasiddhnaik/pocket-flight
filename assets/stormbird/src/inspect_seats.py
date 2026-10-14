"""Static crew-seat fit and attachment measurements; never operates the game."""
import json
from pathlib import Path
from cadgen import build123d as b
from stormbird import stormbird, v, tube
from mechanisms import CANOPY, segments

root=Path(__file__).resolve().parents[1]
master=stormbird()
parts={s.label:s for s in master.children}
prefixes=('Seat_','Back_','Headrest_','Harness_')
seats=[p for n,p in parts.items() if n.startswith(prefixes)]
report={'design':{'recline_degrees':10,'pan_width_mm':500},'seats':[],
        'canopy_poses':[],'actuator_poses':[],'fixed_clearances':[]}
bbox_cache={}

def box_gap(a,c):
    for p in [a,c]:
        if id(p) not in bbox_cache: bbox_cache[id(p)]=(p,p.bounding_box(optimal=True))
    aa,cc=bbox_cache[id(a)][1],bbox_cache[id(c)][1]
    return sum(max(lo-hi,other_lo-other_hi,0)**2
               for lo,hi,other_lo,other_hi in zip(aa.min,cc.max,cc.min,aa.max))**.5

def volume(a,c):
    common=a.intersect(b.Compound(list(c.solids())))
    return sum(p.volume for p in common) if common else 0

def clearance(obstacles):
    overlap=0
    for p in seats:
        for obstacle in obstacles:
            if box_gap(p,obstacle)>.001: continue
            overlap+=volume(p,obstacle)
    return round(overlap,3)

for label in ['Rear','Pilot']:
    crew=[p for p in seats if p.label.endswith('_'+label)]
    # Connect every component to the pressure floor using actual BREP distances.
    connected=[parts['Cockpit_pressure_floor']]
    remaining=crew.copy(); links=[]
    while remaining:
        attached=[]
        for p in remaining:
            for mount in connected:
                if box_gap(p,mount)>.2: continue
                gap=p.distance_to(mount)
                if gap<=.2:
                    links.append({'part':p.label,'mount':mount.label,'gap_mm':round(gap,6)})
                    attached.append(p); break
        if not attached: break
        connected.extend(attached)
        remaining=[p for p in remaining if p not in attached]
    bounds=b.Compound([s for p in crew for s in p.solids()]).bounding_box(optimal=True)
    head=parts['Headrest_'+label]
    glazing=parts['Canopy'].children[0]
    report['seats'].append({'name':label,'parts':len(crew),'size_mm':list(bounds.size),
        'headrest_glazing_gap_mm':round(head.distance_to(glazing),3),
        'unmounted':[p.label for p in remaining],'links':links})
    print(label,'unmounted',[p.label for p in remaining],flush=True)

for angle in [0,5,15,30,45,55]:
    canopy=[b.Compound(list(c.solids())).rotate(b.Axis(v(CANOPY['point']),(1,0,0)),angle)
            for c in parts['Canopy'].children]
    overlap=clearance(canopy)
    report['canopy_poses'].append({'degrees':angle,'overlap_mm3':overlap})
    print('Canopy',angle,'overlap',overlap,flush=True)

for angle in [0,30,55]:
    for name,(a,c) in segments(canopy_angle=angle).items():
        if not name.startswith('Canopy_'): continue
        barrel=name.endswith('barrel')
        shape=tube(name,a,c,.039 if barrel else .019,inner=.021 if barrel else 0)
        overlap=clearance([shape])
        report['actuator_poses'].append({'name':name,'degrees':angle,'overlap_mm3':overlap})
for name,p in parts.items():
    if not name.startswith(('Instrument_','Side_console_','Stick_')): continue
    overlap=clearance([p])
    report['fixed_clearances'].append({'name':name,'overlap_mm3':overlap})

target=root/'validation/seat-fit.json'
target.write_text(json.dumps(report,indent=2))
print(target,flush=True)
if any(s['unmounted'] for s in report['seats']) or any(row['overlap_mm3']>.1
       for key in ['canopy_poses','actuator_poses','fixed_clearances'] for row in report[key]):
    raise SystemExit('Seat attachment or clearance requires correction')
