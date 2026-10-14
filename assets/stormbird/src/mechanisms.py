"""Mechanical datums in CAD metres; rigid pivots, pinned links, telescopic rams."""
import math

CANOPY = {'name': 'Canopy', 'point': [0, 2.80, 2.548], 'axis': [1, 0, 0], 'angle': 55}
LEGS = [
    {'name': 'Nose_gear', 'point': [0, 5.30, 1.50], 'axis': [1, 0, 0], 'angle': -90,
     'radius': .275, 'brace_length': .265, 'brace_lead': -.25,
     'brace_height': .78, 'brace_branch': -1, 'start': .20, 'end': .86},
    *[{'name': 'Main_gear_'+label, 'point': [side*1.80, -1.20, 1.525],
       'axis': [1, 0, 0], 'angle': -90, 'radius': .37, 'brace_length': .40, 'brace_lead': .25,
       'brace_x':side*.12, 'start': .15, 'end': .82,
       'swivel':{'name':'Main_gear_'+label+'_swivel','point':[side*1.8,-1.2,.50],
                 'axis':[0,0,1],'angle':side*90}}
      for side, label in [(-1, 'Left'), (1, 'Right')]],
]
DOORS = [
    *[{'name': 'Nose_door_'+label, 'point': [side*.31, 4.55, 1.18],
       'axis': [0, 1, 0], 'open_angle': -side*85}
      for side, label in [(-1, 'Left'), (1, 'Right')]],
    *[{'name': f'Main_door_{label}_{door}',
       'point': [side*1.80+door_side*.28, -1.91, 1.28],
       'axis': [0, 1, 0], 'open_angle': -door_side*85}
      for side, label in [(-1, 'Left'), (1, 'Right')]
      for door_side, door in [(-1, 'Left'), (1, 'Right')]],
]


def rotate(point, pivot, angle):
    x, y, z = [point[i]-pivot[i] for i in range(3)]
    c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    return [x+pivot[0], y*c-z*s+pivot[1], y*s+z*c+pivot[2]]


def brace(leg, angle=0):
    x, y, top = leg['point']
    bx=x+leg.get('brace_x',.13)
    a = [bx, y+leg['brace_lead'], top]
    c = rotate([bx, y, leg['radius']+leg.get('brace_height',.64)], leg['point'], angle)
    dy, dz = c[1]-a[1], c[2]-a[2]
    d = math.hypot(dy, dz)
    length = leg['brace_length']
    if d > 2*length: raise ValueError('Unreachable drag brace: '+leg['name'])
    h = math.sqrt(length*length-d*d/4)*leg.get('brace_branch',1)
    elbow = [a[0], (a[1]+c[1])/2-dz*h/d, (a[2]+c[2])/2+dy*h/d]
    return a, elbow, c


def segments(canopy_angle=0, gear_angles=None):
    gear_angles = gear_angles or {}
    result = {}
    def ram(name, a, c, barrel, rod):
        length = math.dist(a, c)
        direction = [(c[i]-a[i])/length for i in range(3)]
        result[name+'_barrel'] = [a, [a[i]+direction[i]*barrel for i in range(3)]]
        result[name+'_piston'] = [[c[i]-direction[i]*rod for i in range(3)], c]
    for side, label in [(-1, 'Left'), (1, 'Right')]:
        a = [side*.30, 3.39, 2.33]
        c = rotate([side*.30, 4.03, 2.575], CANOPY['point'], canopy_angle)
        ram('Canopy_actuator_'+label, a, c, .60, .68)
    for leg in LEGS:
        angle = gear_angles.get(leg['name'], 0)
        a, elbow, c = brace(leg, angle)
        result[leg['name']+'_brace_upper'] = [a, elbow]
        result[leg['name']+'_brace_lower'] = [elbow, c]
        x, y, top = leg['point']
        nose = leg['name']=='Nose_gear'
        rx=x-.15 if nose else x+math.copysign(.16,x)
        a = [rx, y+.24, top+.09] if nose else [rx,y-1.55,top-.155]
        c = rotate([rx, y, top-.25], leg['point'], angle)
        ram(leg['name']+'_actuator', a, c, .35 if nose else .80, .32 if nose else .90)
    return result

MECHANISMS = {'canopy': CANOPY, 'legs': LEGS, 'doors': DOORS, 'segments': segments()}

# Existing torque-link geometry also drives the runtime oleo-compression linkage.
for leg in LEGS:
    x,y,z=leg['point']; r=leg['radius']; name=leg['name']
    tx=1 if name=='Nose_gear' else math.copysign(1,x)
    torque={'a':[x+tx*.075,y,r+.65], 'elbow':[x+tx*.12,y+.07,r+.40],
            'b':[x+tx*.075,y,r+.16], 'pin':name+'_scissor_pin'}
    leg['torque']=torque
    MECHANISMS['segments'][name+'_torque_link_upper']=[torque['a'],torque['elbow']]
    MECHANISMS['segments'][name+'_torque_link_lower']=[torque['elbow'],torque['b']]
