"""Static detail exports clipped from the master; no remodeled diagnostic parts."""
from cadgen import step
from stormbird import stormbird, b, box, mark, group

def detail(nose):
    parts={p.label:p for p in stormbird().children}
    mask=box('Context_clip',(0,4.8,1.5),(1.9,3.0,3.0)) if nose else box('Context_clip',(1.8,-1.95,1.5),(1.5,3.1,3.0))
    host=parts['Fuselage']
    context=mark(b.Compound(list(host.solids())).intersect(mask),'Clipped_airframe_context')
    prefix='Nose_' if nose else 'Main_gear_Right'
    selected=[p.moved(b.Location()) for p in parts['LandingGear'].children
              if p.label.startswith(prefix) or (not nose and p.label.startswith('Main_door_Right_'))]
    selected.extend(p.moved(b.Location()) for n,p in parts.items()
                    if n.startswith(prefix) or (not nose and n.startswith('Main_door_Right_')))
    return group('Nose_gear_detail' if nose else 'Main_gear_detail',[context,*selected])

@step(out='../STEP/inspection/NoseGearContext.step')
def nose_gear_detail(): return detail(True)

@step(out='../STEP/inspection/MainGearContext.step')
def main_gear_detail(): return detail(False)

if __name__=='__main__':
    nose_gear_detail(); main_gear_detail()
