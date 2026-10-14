"""Stormbird HX-40 precision exterior assembly. Metres in source, BREP in mm.
X starboard, +Y forward, +Z up; wheel contact plane Z=0.
All external parts have mounting geometry; hinge datums also drive the game export.
This is a designed game asset, not an airworthy construction drawing.
"""
import math
from mechanisms import CANOPY, LEGS, DOORS, segments
from animation_data import ANIMATION
from cadgen import build123d as b, step, glb, srgb, report

MM = 1000
LENGTH, SPAN = 17.2, 13.4
PAINT, WING_PAINT, GRAPHITE = '#8c9ca6', '#b3bfc5', '#293b47'
ORANGE, METAL, RUBBER, GLASS = '#d76d38', '#a2acb4', '#1b2227', '#698b98'
ENGINE_X, ENGINE_Z = 1.28, 1.90
COMPRESSOR_BLADES = 24
# Radius, chord, stagger, circumferential sweep and axial datum, in metres/degrees.
# Concept geometry: these sections are not a validated compressor aerodynamic design.
COMPRESSOR_SECTIONS = [(.102,.026,50,-7,.105),(.245,.082,37,0,.095),
                       (.401,.115,29,9,.080)]
TURBINE_BLADES = 48
TURBINE_SECTIONS = [(.148,.065,58,0,-6.01),(.265,.120,63,3,-6.00),
                    (.398,.130,68,6,-5.99)]
CANOPY_BASE = 2.55
COCKPIT_DROP = .28
HINGES = {
    'Canopy': {'point': CANOPY['point'], 'axis': CANOPY['axis']},
    'Nose_steering': {'point': [0, 5.3, .475], 'axis': [0, 0, 1]},
}
for side, label in [(-1, 'Left'), (1, 'Right')]:
    for kind, x, y, z in [('Flap', 2.7, -3.30, 2.05), ('Aileron', 5.0, -3.30, 2.05),
                           ('Elevator', 2.4, -6.42, 1.61)]:
        HINGES[kind+'_'+label] = {'point': [side*x, y, z], 'axis': [1, 0, 0]}
    HINGES['Rudder_'+label] = {'point': [side*1.52, -6.20, 2.55], 'axis': [side*.62, 0, 1.95]}
    HINGES['Compressor_'+str(side)] = {'point': [side*1.40, .08, 1.92], 'axis': [0, 1, 0]}

for datum in [*LEGS, *DOORS]:
    HINGES[datum['name']] = {'point': datum['point'], 'axis': datum['axis']}
for leg in LEGS:
    x,y,_=leg['point']; nose=leg['name']=='Nose_gear'
    if not nose: HINGES[leg['swivel']['name']]={k:leg['swivel'][k] for k in ['point','axis']}
    for side in ([-1,1] if nose else [-1 if x<0 else 1]):
        HINGES[leg['name']+f'_wheel_{side}']={
            'point':[x+side*(.155 if nose else .185),y,leg['radius']], 'axis':[1,0,0]}


def v(p): return b.Vector(*(q*MM for q in p))


def mark(s, name, color=PAINT):
    if isinstance(s, (b.ShapeList, list, tuple)):
        s = s[0] if len(s) == 1 else b.Compound(children=list(s))
    s.label, s.color = name, srgb(color)
    return s


def box(name, p, size, color=PAINT, radius=0):
    s = b.Box(*(q*MM for q in size))
    if radius: s = b.fillet(s.edges(), radius*MM)
    return mark(b.Pos(*v(p))*s, name, color)


def tube(name, a, c, radius, inner=0, color=METAL):
    d = v(c)-v(a)
    plane = b.Plane(origin=v(a), z_dir=d)
    s = b.Solid.make_cylinder(radius*MM, d.length, plane)
    if inner:
        s = s.cut(b.Solid.make_cylinder(inner*MM, d.length+2,
                        b.Plane(origin=v(a)-d.normalized(), z_dir=d)))
    return mark(s, name, color)


def hose(name, points, radius=.009):
    path = b.Edge.make_spline([v(p) for p in points])
    ring = b.Wire.make_circle(radius*MM, b.Plane(origin=v(points[0]),
                                   z_dir=v(points[1])-v(points[0])))
    return mark(b.Solid.sweep(ring, path), name, RUBBER)


def seat_parts(y, label):
    """Compact empty crew seat: 10-degree recline, fitted cushions and restraints.
    Author above the cockpit drop datum, like the adjacent instruments.
    """
    parts=[]
    pivot=(0,y-.185,2.46)
    axis=b.Axis(v(pivot),(1,0,0))
    cushion, webbing='#485149', '#aaa084'

    def add(name, p, size, color=GRAPHITE, radius=0, reclined=False):
        shape=box(name+'_'+label,p,size,color,radius)
        if reclined: shape=shape.rotate(axis,10)
        parts.append(shape)
        return shape

    def back(name, z, width, depth, height, color, radius=.012, offset=.055):
        return add(name,(0,pivot[1]+offset,pivot[2]+z),
                   (width,depth,height),color,radius,True)

    for side in [-1,1]:
        x=side*.18
        add('Seat_rail_'+str(side),(x,y-.015,2.2475),(.048,.64,.055),METAL,.004)
        add('Seat_carriage_'+str(side),(x,y-.025,2.295),(.072,.47,.06),GRAPHITE,.008)
        # Rear rails and crossmembers are structural, underneath the seat shell.
        frame=tube('Seat_back_rail_'+str(side)+'_'+label,
                   (side*.19,pivot[1]-.04,2.39),
                   (side*.19,pivot[1]-.04,3.13),.021,color=METAL).rotate(axis,10)
        parts.append(frame)
        for yy in [y-.265,y+.235]:
            add('Seat_floor_bolt_'+str(side)+'_'+str(yy),(x,yy,2.279),(.020,.020,.013),METAL,.002)
    add('Seat_pan',(0,y,2.36),(.50,.63,.13),GRAPHITE,.025)
    add('Seat_cushion',(0,y+.015,2.446),(.414,.51,.065),cushion,.025)
    for side in [-1,1]:
        add('Seat_thigh_bolster_'+str(side),(side*.222,y-.005,2.456),
            (.048,.51,.085),cushion,.018)
        add('Seat_hip_guard_'+str(side),(side*.237,y-.13,2.49),
            (.026,.30,.18),GRAPHITE,.012)
    # Tapered shell follows the shoulder silhouette instead of a rectangular chair.
    wires=[]
    for z,width,depth in [(-.045,.47,.10),(.17,.48,.095),(.47,.44,.082),(.62,.36,.075)]:
        plane=b.Plane(origin=v((0,pivot[1],pivot[2]+z)))
        wires.append((plane*b.RectangleRounded(width*MM,depth*MM,12)).faces()[0].outer_wire())
    parts.append(mark(b.Solid.make_loft(wires,ruled=True).rotate(axis,10),'Seat_back_'+label,GRAPHITE))
    back('Back_lumbar',.145,.385,.066,.25,cushion,.023,.065)
    back('Back_cushion',.414,.365,.062,.275,cushion,.022,.061)
    for side in [-1,1]:
        add('Seat_back_bolster_'+str(side),(side*.197,pivot[1]+.045,pivot[2]+.27),
            (.052,.095,.42),cushion,.019,True)
    back('Seat_headbox',.69,.32,.14,.20,GRAPHITE,.023,-.016)
    back('Headrest',.695,.264,.050,.158,cushion,.021,.073)
    # Shoulder straps lie on the empty backrest, turn onto the pan and meet the QRB.
    def belt(name, x, z, width, height, offset):
        return add('Harness_'+name,(x,pivot[1]+offset,pivot[2]+z),
                   (width,.008,height),webbing,.002,True)
    for side in [-1,1]:
        belt('shoulder_'+str(side),side*.116,.355,.042,.455,.095)
        belt('shoulder_anchor_'+str(side),side*.116,.59,.048,.039,.057)
        # A webbing loft bends from the lumbar pad to the pan without a detached strip.
        sections=[]
        theta=math.radians(10)
        bent=[(pivot[1]+.095*math.cos(theta)-z*math.sin(theta),
               pivot[2]+.095*math.sin(theta)+z*math.cos(theta),side*.116)
              for z in [.133,.040]]
        for yy,zz,x in [*bent,(y-.04,2.4805,side*.075),(y+.03,2.4805,side*.022)]:
            plane=b.Plane(origin=v((x,yy,zz)),x_dir=(1,0,0),z_dir=(0,1,0))
            sections.append((plane*b.Rectangle(.041*MM,.008*MM)).faces()[0].outer_wire())
        parts.append(mark(b.Solid.make_loft(sections,ruled=True),'Harness_return_'+str(side)+'_'+label,webbing))
        add('Harness_lap_anchor_'+str(side),(side*.241,y+.035,2.456),(.018,.037,.046),METAL,.004)
        for x in [side*.20,side*.11]:
            add('Harness_lap_'+str(x),(x,y+.035,2.4805),(.11,.040,.008),webbing,.002)
        add('Harness_adjuster_'+str(side),(side*.116,pivot[1]+.103,pivot[2]+.39),
            (.049,.012,.035),METAL,.003,True)
    add('Harness_buckle',(0,y+.035,2.488),(.068,.062,.024),METAL,.008)
    add('Harness_release',(0,y+.035,2.500),(.030,.033,.012),GRAPHITE,.004)
    # Handle feet enter the pan; the curved grip remains connected to those feet.
    for side in [-1,1]:
        parts.append(tube('Seat_handle_foot_'+str(side)+'_'+label,
                          (side*.046,y+.273,2.399),(side*.046,y+.273,2.475),.009,color=GRAPHITE))
    grip=hose('Seat_firing_handle_'+label,
              [(-.046,y+.273,2.469),(-.04,y+.286,2.505),(0,y+.294,2.52),
               (.04,y+.286,2.505),(.046,y+.273,2.469)],.009)
    grip.color=srgb('#c69b38'); parts.append(grip)
    return parts


def ellipse(y, w, lo, hi, x=0):
    plane = b.Plane(origin=v((x, y, (lo+hi)/2)), x_dir=(1,0,0), z_dir=(0,1,0))
    # Four matched arcs avoid the long periodic loft seam failing underside cuts.
    return b.Wire([b.Edge.make_ellipse(w*MM,(hi-lo)*MM/2,plane,
                   start_angle=i*90,end_angle=(i+1)*90) for i in range(4)])


def hull(stations, x=0):
    return b.Solid.make_loft([ellipse(*p, x=x) for p in stations])


def intake_section(side, y, x, width, height, radius, rake=0):
    """Rounded intake contour; the outboard leading edge sweeps rearward."""
    plane=b.Plane(origin=v((side*x,y,1.92)),
                  x_dir=(1,-side*rake,0), z_dir=(side*rake,1,0))
    return (plane*b.RectangleRounded(width*MM,height*MM,radius*MM)).faces()[0].outer_wire()


def canopy_section(y, width, height, base=CANOPY_BASE):
    points = [v((width*math.cos(math.pi*i/32), y,
                 base+height*math.sin(math.pi*i/32))) for i in range(33)]
    return b.Wire([b.Edge.make_spline(points), b.Edge.make_line(points[-1], points[0])])


def canopy_loft(stations, inset=0):
    return b.Solid.make_loft([canopy_section(y, w-inset, h-2*inset,
                             CANOPY_BASE+inset) for y,w,h in stations])


def airfoil(x, leading, chord, z, side, thickness=.085, camber=.004):
    upper, lower = [], []
    for i in range(33):
        u = (1-math.cos(math.pi*i/32))/2
        t = 5*thickness*chord*(.2969*math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1015*u**4)
        c = camber*chord*math.sin(math.pi*u)
        upper.append(v((side*x, leading-chord*u, z+c+t)))
        lower.append(v((side*x, leading-chord*u, z+c-t)))
    return b.Wire([b.Edge.make_spline(upper), b.Edge.make_line(upper[-1],lower[-1]),
                   b.Edge.make_spline(list(reversed(lower)))])


def wing(stations, side, thickness=.085):
    return b.Solid.make_loft([airfoil(*p,side,thickness) for p in stations], ruled=True)


def radial_blade(index,count,sections,center,label,color=METAL):
    """A closed cambered foil loft, rooted inside the hub, with matched rails."""
    wires=[]
    for radius,chord,stagger,sweep,y in sections:
        angle=index*math.tau/count+math.radians(sweep)
        stagger=math.radians(stagger)
        upper,lower=[],[]
        for i in range(25):
            u=(1-math.cos(math.pi*i/24))/2
            thickness=5*.08*chord*(.2969*math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1015*u**4)
            camber=.035*chord*math.sin(math.pi*u)
            along=(.5-u)*chord
            for sign,points in [(1,upper),(-1,lower)]:
                normal=camber+sign*thickness
                tangential=along*math.sin(stagger)+normal*math.cos(stagger)
                axial=y+along*math.cos(stagger)-normal*math.sin(stagger)
                points.append(v((center[0]+radius*math.sin(angle)+tangential*math.cos(angle),
                                 axial,center[1]+radius*math.cos(angle)-tangential*math.sin(angle))))
        wires.append(b.Wire([b.Edge.make_spline(upper),b.Edge.make_line(upper[-1],lower[-1]),
                             b.Edge.make_spline(list(reversed(lower)))]))
    return mark(b.Solid.make_loft(wires),label+'_'+str(index),color)


def compressor_blade(side,index):
    return radial_blade(index,COMPRESSOR_BLADES,COMPRESSOR_SECTIONS,
                        (side*1.40,1.92),'Compressor_blade')


def turbine_stage(side):
    x=side*ENGINE_X
    parts=[tube('Turbine_hub',(x,-5.90,ENGINE_Z),(x,-6.51,ENGINE_Z),.170)]
    parts += [radial_blade(j,TURBINE_BLADES,TURBINE_SECTIONS,(x,ENGINE_Z),
                          'Turbine_blade','#746f68') for j in range(TURBINE_BLADES)]
    return group('Turbine_stage_'+('Left' if side<0 else 'Right'),parts)


def engine_center(side,y):
    fraction=(-.02-y)/6.08
    return (side*(1.40-.12*fraction),y,1.92-.02*fraction)


def engine_case(side):
    """Six-millimetre casing, mating with the compressor ring and exhaust liner."""
    def ring(y,radius):
        x,_,z=engine_center(side,y)
        return ellipse(y,radius,z-radius,z+radius,x)
    outer=b.Solid.make_loft([ring(y,.443) for y in [-.02,-6.10]])
    inner=b.Solid.make_loft([ring(y,.437) for y in [.01,-6.13]])
    return mark(outer.cut(inner),'Engine_core_case_'+('Left' if side<0 else 'Right'),GRAPHITE)


def fin_section(side,z,x,leading,chord):
    # Airfoil's span axis is mapped to Z, thickness axis to the canted X plane.
    points_top, points_bottom = [], []
    for i in range(33):
        u=(1-math.cos(math.pi*i/32))/2
        t=5*.065*chord*(.2969*math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1015*u**4)
        points_top.append(v((side*x+t,leading-u*chord,z)))
        points_bottom.append(v((side*x-t,leading-u*chord,z)))
    return b.Wire([b.Edge.make_spline(points_top), b.Edge.make_line(points_top[-1],points_bottom[-1]),
                   b.Edge.make_spline(list(reversed(points_bottom)))])


def prism(points, low, high):
    w=b.Wire.make_polygon([v((x,y,low)) for x,y in points],close=True)
    return b.Solid.extrude(b.Face(w),(0,0,(high-low)*MM))


def group(name,parts): return b.Compound(children=parts,label=name)


def skin_height(shape,x,y):
    hits=shape.intersect(b.Edge.make_line(v((x,y,-1)),v((x,y,6))))
    z=[p.Z/MM for p in hits.vertices()]
    if not z: raise ValueError(f'Missing skin beneath {x}, {y}')
    return max(z)


def seated_box(base,name,x,y,width,length,height,color=GRAPHITE):
    # Bottom is below the lowest sampled skin point, so the feature has contact.
    z=min(skin_height(base,x+dx,y+dy) for dx in [-width/2,0,width/2]
                                  for dy in [-length/2,0,length/2])
    return box(name,(x,y,z+height/2-.006),(width,length,height),color)


def gear(name,x,y,radius,top):
    axle_z=radius
    nose=name=='Nose_gear'
    outboard=-1 if x<0 else 1
    fork_sides=[-1,1] if nose else [outboard]
    parts=[tube(name+'_upper_oleo',(x,y,radius+.57),(x,y,top),.082 if nose else .068,.047),
           tube(name+'_piston',(x,y,radius+.12),(x,y,radius+.77),.046),
           tube(name+'_lower_collar',(x,y,radius+.11),(x,y,radius+.20),.087 if nose else .072),
           tube(name+'_upper_collar',(x,y,radius+.61),(x,y,radius+.70),.098 if nose else .072),
           tube(name+'_axle',(x-(.24 if nose else outboard*.035),y,axle_z),
                (x+(.24 if nose else outboard*.31),y,axle_z),.044),
           tube(name+'_trunnion',(x-(.16 if nose else outboard*.10),y,top),
                (x+(.12 if nose else outboard*.12),y,top),.085 if nose else .055)]
    for side in fork_sides:
        parts.append(tube(name+f'_fork_{side}',(x+side*(.045 if nose else .025),y,radius),
                          (x+side*.035,y,radius+.16),.035 if nose else .052))
        parts.append(tube(name+f'_fork_bridge_{side}',(x+side*.035,y,radius+.16),
                          (x,y,radius+.20),.035 if nose else .052))
    tx=1 if nose else outboard
    for a,c,tag in [((x+tx*.075,y,radius+.65),(x+tx*.12,y+.07,radius+.40),'upper'),
                    ((x+tx*.12,y+.07,radius+.40),(x+tx*.075,y,radius+.16),'lower')]:
        parts.append(tube(name+'_torque_link_'+tag,a,c,.024,color=GRAPHITE))
    parts.append(tube(name+'_scissor_pin',(x+tx*.09,y+.07,radius+.40),
                      (x+tx*.15,y+.07,radius+.40),.034))
    hs=-1 if nose else outboard
    parts.append(hose(name+'_hydraulic_line',[(x+hs*.078,y,top-.02),(x+hs*.10,y-.05,radius+.65),
                       (x+hs*.09,y-(.08 if nose else .06),radius+.43),(x+hs*.065,y-.06,radius+.16)]))
    for sign in ([-1,1] if nose else [outboard]):
        cx=x+sign*(.155 if nose else .185)
        width=.13 if nose else .21
        # Rounded shoulder and a flat tread crown; aircraft tires are not donuts.
        profile=[(-.5,.56),(-.5,.79),(-.37,.95),(-.22,1),(.22,1),
                 (.37,.95),(.5,.79),(.5,.56)]
        wire=b.Wire.make_polygon([v((cx+u*width,y,radius+r*radius)) for u,r in profile],close=True)
        face=b.Face(wire)
        face=b.fillet(face.vertices(),.004*MM).faces()[0]
        tire=b.Solid.revolve(face,360,b.Axis(v((cx,y,radius)),(1,0,0)))
        # Three real circumferential tread grooves, not painted bars.
        for dx in [-radius*.10,0,radius*.10]:
            groove=b.Solid.make_torus((radius-.004)*MM,.006*MM,
                      b.Plane(origin=v((cx+dx,y,radius)),z_dir=(1,0,0)))
            tire=tire.cut(groove)
        rim=tube('Rim',(cx-width*.43,y,radius),(cx+width*.43,y,radius),radius*.58,.049)
        # Vent holes are genuinely cut through the wheel center disc.
        for j in range(8):
            angle=j*math.tau/8
            yy=y+radius*.34*math.sin(angle); zz=radius+radius*.34*math.cos(angle)
            rim=rim.cut(tube('Rim_hole',(cx-width*.65,yy,zz),(cx+width*.65,yy,zz),radius*.073))
        hub=tube(name+f'_hub_{sign}',(cx-width*.49,y,radius),(cx+width*.49,y,radius),.063)
        parts.append(group(name+f'_wheel_{sign}',[mark(tire,name+f'_tire_{sign}',RUBBER),
                          mark(rim,name+f'_rim_{sign}',METAL),hub]))
        if not nose:
            parts.append(tube(name+f'_brake_{sign}',(cx-sign*.127,y,radius),
                              (cx-sign*.094,y,radius),radius*.43,.049,GRAPHITE))
    if name=='Nose_gear':
        steering=[p for p in parts if any(k in p.label for k in ['_piston','_lower_collar','_axle','_fork','_wheel_','_brake_'])]
        parts=[p for p in parts if p not in steering]+[group('Nose_steering',steering)]
    else:
        swivel=[p for p in parts if any(k in p.label for k in ['_axle','_fork','_wheel_','_brake_'])]
        parts=[p for p in parts if p not in swivel]+[group(name+'_swivel',swivel)]
    return group(name,parts)


@step(out='../STEP/Stormbird-HX40.step',animation=ANIMATION)
@glb(out='../GLB/Stormbird-HX40.glb',mesh_tolerance=.0005,mesh_angular_tolerance=.18)
def stormbird():
    parts=[]
    def add(s): parts.append(s); return s
    report('continuous fuselage, cockpit pressure tub and wing carry-through')
    stations=[(-8.10,.13,1.65,2.04),(-7.4,.79,1.29,2.40),(-6.0,1.56,1.18,2.63),
              (-4.2,1.72,1.13,2.72),(-1.5,1.65,1.12,2.78),(1.0,1.31,1.24,2.76),
              (3.2,.88,1.18,2.70),(5.4,.74,1.20,2.66),(6.95,.60,1.74,2.45)]
    body=hull(stations)
    raw_body=body
    cockpit_outline=[(.075,3.09),(.375,3.35),(.475,4.03),(.475,5.20),(.35,6.12),(.075,6.46),
                     (-.075,6.46),(-.35,6.12),(-.475,5.20),(-.475,4.03),(-.375,3.35),(-.075,3.09)]
    aperture=prism(cockpit_outline,2.20-COCKPIT_DROP,4.50)
    body=body.cut(aperture)
    radome=hull([(6.95,.60,1.74,2.45),(8.2,.30,1.99,2.26),(9.10,.018,2.105,2.15)])
    add(mark(radome,'Radome',GRAPHITE))
    add(tube('Nose_probe',(0,9.08,2.127),(0,9.48,2.127),.013))
    add(box('Cockpit_pressure_floor',(0,4.65,2.16),(1.08,3.14,.12),GRAPHITE))
    canopy_stations=[(2.92,.045,.045),(3.35,.425,.40),(4.03,.53,.64),
                     (5.20,.525,.65),(6.12,.405,.42),(6.65,.045,.045)]
    outline=[(.04,6.75),(.45,6.12),(.575,5.20),(.58,4.03),(.475,3.35),(.37,3.10),(.21,2.95),(.04,2.82),
             (-.04,2.82),(-.21,2.95),(-.37,3.10),(-.475,3.35),(-.58,4.03),(-.575,5.20),(-.45,6.12),(-.04,6.75)]
    seat_outline=[(x+math.copysign(.050,x),y) for x,y in outline]
    body=body.cut(prism(seat_outline,CANOPY_BASE-.027,4.50))
    body=body.cut(box('Rear_canopy_hinge_relief',(0,2.93,2.70),(.82,.50,.36)))
    hinge_pocket=box('Canopy_hinge_running_clearance',(0,2.83,2.55),(.40,.16,.08))
    fairing=prism(outline,2.17-COCKPIT_DROP,CANOPY_BASE-.005).cut(aperture).cut(hinge_pocket)
    add(mark(fairing,'Canopy_coaming'))
    seal=prism(outline,CANOPY_BASE-.004,CANOPY_BASE-.002).cut(aperture).cut(hinge_pocket)
    add(mark(seal,'Canopy_seal',RUBBER))
    bottom_tool=box('Canopy_open_bottom_tool',(0,4.75,0),(4,8,5.15))
    # Glazing is an open-bottom shell: no pane across the cockpit opening.
    canopy_parts=[mark(canopy_loft(canopy_stations).cut(canopy_loft(canopy_stations,.008)).cut(bottom_tool),
                       'Canopy_glazing',GLASS)]
    # Frame strips are clipped out of the same canopy shell, preserving curvature.
    frame_shell=canopy_loft(canopy_stations).cut(canopy_loft(canopy_stations,.022)).cut(bottom_tool)
    for y in [3.35,6.12]:
        strip=frame_shell.intersect(box('Frame_tool',(0,y,3.0),(2,.047,2)))
        canopy_parts.append(mark(strip,'Canopy_bow_'+str(y),GRAPHITE))
    canopy_parts.append(mark(prism(outline,CANOPY_BASE-.001,CANOPY_BASE+.025).cut(aperture),
                             'Canopy_lower_frame',GRAPHITE))
    add(box('Canopy_hinge_seat',(0,2.89,2.505),(.46,.34,.030),GRAPHITE))
    for sign,label in [(-1,'Left'),(1,'Right')]:
        canopy_parts.append(tube('Canopy_hinge_lug_'+label,(sign*.055,2.84,2.564),
                                (sign*.14,2.80,2.548),.018, color=GRAPHITE))
        canopy_parts.append(tube('Canopy_ram_eye_'+label,(sign*.29,4.03,2.575),
                                (sign*.53,4.03,2.575),.029,color=METAL))
        add(tube('Canopy_hinge_'+label,(sign*.095,2.80,2.548),
                 (sign*.20,2.80,2.548),.022))
        add(tube('Canopy_hinge_mount_'+label,(sign*.17,2.80,2.548),
                 (sign*.17,2.98,2.48),.035,color=GRAPHITE))
        add(tube('Canopy_ram_mount_'+label,(sign*.30,3.39,2.33),
                 (sign*.40,3.39,2.40),.040,color=GRAPHITE))
    add(group('Canopy',canopy_parts))
    for y,label in [(3.93,'Rear'),(5.51,'Pilot')]:
        for part in seat_parts(y,label): add(part)
        console=box('Instrument_pedestal_'+label,(0,y+.49,2.47),(.83,.20,.61),GRAPHITE,.025)
        add(console)
        for sx in [-.19,.19]:
            add(box(f'Display_bezel_{label}_{sx}',(sx,y+.381,2.71),(.31,.026,.255),RUBBER,.01))
            add(box(f'Display_glass_{label}_{sx}',(sx,y+.365,2.71),(.269,.009,.208),'#315863'))
            for j in range(4):
                add(box(f'Display_key_{label}_{sx}_{j}',(sx-.105+j*.07,y+.365,2.587),(.021,.009,.012),METAL))
        for sign in [-1,1]:
            add(box(f'Side_console_{label}_{sign}',(sign*.465,y,2.43),(.12,.91,.46),GRAPHITE,.018))
            for j in range(5):
                add(tube(f'Switch_{label}_{sign}_{j}',(sign*.46,y-.30+j*.10,2.66),
                         (sign*.46,y-.30+j*.10,2.678),.009))
        add(tube('Stick_pedestal_'+label,(0,y+.36,2.22),(0,y+.36,2.41),.026))
        add(tube('Stick_shaft_'+label,(0,y+.36,2.40),(0,y+.31,2.65),.014, color=METAL))
        add(box('Stick_grip_'+label,(0,y+.31,2.65),(.052,.069,.13),RUBBER,.012))
        for sign in [-1,1]:
            add(tube(f'Pedal_link_{label}_{sign}',(sign*.14,y+.28,2.20),(sign*.14,y+.67,2.26),.018))
            add(box(f'Rudder_pedal_{label}_{sign}',(sign*.14,y+.67,2.29),(.18,.075,.08),METAL,.012))
    # Lower the entire cockpit as a unit: rails, seats and controls keep their mounts.
    interior=('Cockpit_pressure','Seat_','Back_','Headrest_','Harness_',
              'Instrument_','Display_','Side_console_','Switch_','Stick_','Pedal_','Rudder_pedal_')
    for i,part in enumerate(parts):
        if part.label.startswith(interior):
            lowered=part.moved(b.Pos(0,0,-COCKPIT_DROP*MM))
            parts[i]=(mark(lowered.intersect(raw_body),part.label,GRAPHITE)
                      if part.label=='Cockpit_pressure_floor' else lowered)
    # Continuous shoulders and engine nacelles are bored together with the body.
    report('continuous intake ducts, nacelles and connected variable nozzle assemblies')
    nacelles=[]; ducts=[]
    for side,label in [(-1,'Left'),(1,'Right')]:
        x=side*ENGINE_X
        nacelle=hull([(-7.36,.62,1.28,2.52),(-6.90,.65,1.25,2.55),
                      (-5.6,.67,1.21,2.59),(-3.6,.70,1.17,2.64),(-1.1,.75,1.12,2.66),
                      (1.65,.67,1.24,2.58),(2.90,.49,1.44,2.35)],x=x)
        nacelles.append(nacelle)
        # The lip becomes a curved shoulder, then disappears inside the nacelle.
        # Matching section topology avoids a box-to-cylinder discontinuity.
        inlet_outer=b.Solid.make_loft([intake_section(side,*p) for p in
                          [(3.15,1.40,.98,.78,.075,.18),
                           (2.75,1.39,1.08,1.02,.14,.12),
                           (1.65,1.35,1.30,1.34,.35,.04),
                           (.45,1.30,1.42,1.45,.56,0),
                           (-1.05,1.28,1.34,1.38,.60,0)]])
        inlet_sections=[(3.23,1.40,.924,.724,.047,.18),
                           (2.75,1.39,.97,.91,.10,.12),
                           (1.65,1.35,.99,1.03,.32,.04),
                           (.42,1.40,.85,.85,.395,0)]
        inlet_inner=b.Solid.make_loft([intake_section(side,*p) for p in inlet_sections])
        aft_duct=tube('Inlet_duct_tool',(side*1.40,.025,1.92),(side*1.40,.85,1.92),.43)
        duct=inlet_inner.fuse(aft_duct)
        core_tool=tube('Engine_core_bore',engine_center(side,.15),engine_center(side,-6.60),.449)
        # Recess the overlapping wing material by 2 mm so only the fuselage owns
        # the duct wall. Identical cutters on both parts leave coincident skins.
        wing_inner=b.Solid.make_loft([intake_section(side,y,x,w+.004,h+.004,r+.002,rake)
                                     for y,x,w,h,r,rake in inlet_sections])
        wing_aft=tube('Wing_duct_clearance',(side*1.40,.025,1.92),
                      (side*1.40,.85,1.92),.432)
        mouth_clearance=b.Solid.make_loft([intake_section(side,y,1.40,.924,.724,.047,.18)
                                          for y in [3.12,6.50]],ruled=True)
        # The wing root also crosses the engine envelope; cut the full path from it.
        # Its leading edge must also stay outside the opening ahead of the lip.
        ducts.extend([wing_inner,wing_aft,core_tool,mouth_clearance])
        fairing=inlet_outer.cut(duct)
        front_edges=[e for e in fairing.edges()
                     if abs(e.center().Y+side*.18*(e.center().X-side*1.40*MM)-3.15*MM)<.01
                     and any(max(abs(p.X-side*1.40*MM)/490,
                                 abs(p.Z-1.92*MM)/390)>.977 for p in e.vertices())]
        if not front_edges: raise ValueError('No leading lip edges selected')
        fairing=b.fillet(front_edges,3.0)
        nacelle=nacelle.fuse(fairing)
        nozzle_bore=tube('Engine_bore',(x,-8.15,ENGINE_Z),(x,-3.4,ENGINE_Z),.449)
        nacelle=nacelle.cut(nozzle_bore)
        body=body.fuse(nacelle).cut(duct).cut(nozzle_bore)
        # Compressor is upstream, linked to a shaft; nothing fan-like at the exhaust.
        rotor=[tube('Compressor_hub',(side*1.40,.04,1.92),(side*1.40,.18,1.92),.115)]
        rotor += [compressor_blade(side,j) for j in range(COMPRESSOR_BLADES)]
        rotor.append(mark(hull([(y,r,1.92-r,1.92+r) for y,r in
                               [(.15,.115),(.24,.101),(.35,.048),(.385,.007)]],x=side*1.40),
                          'Compressor_spinner',METAL))
        add(group('Compressor_'+str(side),rotor))
        add(tube('Compressor_case_'+label,(side*1.40,-.02,1.92),(side*1.40,.25,1.92),.443,.409,GRAPHITE))
        add(engine_case(side))
        add(tube('Engine_shaft_'+label,(side*1.40,.04,1.92),(x,-6.52,ENGINE_Z),.056))
        # The rear turbine is distinct from the inlet compressor. Its staggered
        # blades obscure the upstream fan while leaving passages between vanes.
        add(turbine_stage(side))
        add(tube('Turbine_case_'+label,(x,-5.87,ENGINE_Z),(x,-6.10,ENGINE_Z),.443,.404,GRAPHITE))
        # A supported spool drum and annular combustor liners occupy the core.
        add(tube('Engine_spool_'+label,engine_center(side,-.30),engine_center(side,-5.92),.140))
        add(tube('Combustor_outer_liner_'+label,engine_center(side,-3.00),engine_center(side,-4.65),.398,.392,GRAPHITE))
        add(tube('Combustor_inner_liner_'+label,engine_center(side,-3.00),engine_center(side,-4.65),.235,.229,GRAPHITE))
        for j in range(12):
            angle=j*math.tau/12
            cx,yy,zz=engine_center(side,-3.05)
            add(tube(f'Combustor_dome_support_{label}_{j}',
                     (cx+.135*math.sin(angle),yy,zz+.135*math.cos(angle)),
                     (cx+.237*math.sin(angle),yy,zz+.237*math.cos(angle)),.018,color=GRAPHITE))
        for yy in [-3.20,-4.50]:
            cx,_,zz=engine_center(side,yy)
            for j in range(6):
                angle=j*math.tau/6
                add(tube(f'Combustor_outer_mount_{label}_{yy}_{j}',
                         (cx+.395*math.sin(angle),yy,zz+.395*math.cos(angle)),
                         (cx+.441*math.sin(angle),yy,zz+.441*math.cos(angle)),.014,color=GRAPHITE))
        add(tube('Exhaust_liner_'+label,(x,-7.91,ENGINE_Z),(x,-6.10,ENGINE_Z),.447,.404,GRAPHITE))
        add(tube('Nozzle_actuator_ring_'+label,(x,-7.56,ENGINE_Z),(x,-7.32,ENGINE_Z),.509,.442))
        add(tube('Nozzle_exit_ring_'+label,(x,-7.94,ENGINE_Z),(x,-7.88,ENGINE_Z),.462,.405,GRAPHITE))
        # Thin overlapping petal sectors physically meet both nozzle support rings.
        for j in range(18):
            a=j*math.tau/18
            def petal_wire(y,r):
                d=.184
                points=[]
                for rr,angles in [(r,[a-d,a,a+d]),(r-.025,[a+d,a,a-d])]:
                    points += [v((x+rr*math.sin(t),y,ENGINE_Z+rr*math.cos(t))) for t in angles]
                return b.Wire.make_polygon(points,close=True)
            petal=b.Solid.make_loft([petal_wire(-7.44,.505),petal_wire(-7.92,.463)],ruled=True)
            add(mark(petal,f'Nozzle_petal_{label}_{j}',METAL))
            aa=(x+.515*math.sin(a),-7.40,ENGINE_Z+.515*math.cos(a))
            cc=(x+.484*math.sin(a),-7.73,ENGINE_Z+.484*math.cos(a))
            add(tube(f'Nozzle_actuator_{label}_{j}',aa,cc,.013))
        # Tail cone is supported by three turbine struts and the central shaft.
        add(mark(b.Solid.make_cone(.15*MM,.035*MM,.47*MM,
                      b.Plane(origin=v((x,-6.50,ENGINE_Z)),z_dir=(0,-1,0))),
                      'Turbine_tail_cone_'+label,GRAPHITE))
        for j in range(3):
            a=j*math.tau/3
            add(tube(f'Turbine_support_{label}_{j}',(x,-6.5,ENGINE_Z),
                        (x+.407*math.sin(a),-6.5,ENGINE_Z+.407*math.cos(a)),.027, color=GRAPHITE))
    report('moderately swept wing, seated controls and canted tail with real hinge pins')
    wings=[]; door_skins={}; bay_roofs=[]
    for side,label in [(-1,'Left'),(1,'Right')]:
        air=wing([(.65,1.95,6.22,2.03),(1.85,1.30,5.49,2.03),
                  (6.70,-2.33,1.36,2.03)],side,.09)
        # OCCT's optional same-domain cleanup loops on the recessed duct faces.
        # Keep the valid Boolean topology; saved-artifact inspection checks it.
        with b.SkipClean():
            for duct in ducts: air=air.cut(duct)
            controls=[]
            for kind,x0,x1 in [('Flap',1.99,3.40),('Aileron',3.56,6.40)]:
                cut=box('Control_tool',(side*(x0+x1)/2,-4.0,2.03),(x1-x0,1.4,2))
                controls.append(mark(air.intersect(cut),kind+'_'+label,WING_PAINT))
                gap=box('Control_gap',(side*(x0+x1)/2,-4.0,2.03),(x1-x0+.006,1.406,2))
                air=air.cut(gap)
                for x in [x0+.14,x1-.14]:
                    add(tube(f'{kind}_hinge_{label}_{x}',(side*(x-.05),-3.3,2.05),
                             (side*(x+.05),-3.3,2.05),.023,color=GRAPHITE))
            chine=wing([(.38,4.55,8.72,2.05),(.80,4.16,8.38,2.05),
                        (1.89,1.36,5.55,2.03)],side,.075)
            for duct in ducts: chine=chine.cut(duct)
            wings.append(air)
            wing_parts=[mark(air,'Wing_skin_'+label,WING_PAINT),mark(chine,'Wing_root_fairing_'+label),*controls]
            tip_tool=box('Tip_tool',(side*6.54,-2.94,2.03),(.32,2.0,1))
            tip=air.intersect(tip_tool)
            wing_parts[0]=mark(air.cut(tip_tool),'Wing_skin_'+label,WING_PAINT)
            wing_parts.append(mark(tip,'Wingtip_identification_'+label,ORANGE))
        add(group('Wing_'+label,wing_parts))
        # Tail roots mount outside the engine bore, below the main wing.
        # The moving elevator starts outboard of the nacelle skin.
        tail=wing([(1.80,-4.35,3.12,1.60),(3.85,-5.62,1.42,1.60)],side,.085)
        mask=box('Elevator_tool',(side*3.015,-7.5,1.60),(2.07,2.16,2))
        add(mark(tail.intersect(mask),'Elevator_'+label,WING_PAINT))
        add(mark(tail.cut(b.Pos(0,3,0)*mask),'Tailplane_'+label,WING_PAINT))
        for x in [2.08,2.65,3.49]:
            add(tube(f'Elevator_hinge_{label}_{x}',(side*(x-.055),-6.42,1.61),
                     (side*(x+.055),-6.42,1.61),.021,color=GRAPHITE))
        fin=b.Solid.make_loft([fin_section(side,*p) for p in
                     [(2.55,1.52,-3.86,3.26),(4.50,2.14,-5.10,1.25)]],ruled=True)
        # A fixed heel and a 3 mm root gap clear the nacelle skin below the rudder.
        mask=box('Rudder_tool',(side*1.85,-7.1,3.559),(2,1.8,2.0))
        add(mark(fin.intersect(mask),'Rudder_'+label,PAINT))
        add(mark(fin.cut(b.Pos(0,3,-3)*mask),'Fin_'+label))
        add(tube('Rudder_hinge_'+label,(side*1.52,-6.20,2.55),(side*2.14,-6.20,4.50),.019,color=GRAPHITE))
        # A narrow root boss blends into the fuselage above the horizontal tail.
        # The former wing-shaped slab intersected the tailplane and engine bore.
        root_boss=hull([(-3.60,.018,2.45,2.51),(-4.05,.14,2.43,2.71),
                        (-5.0,.18,2.40,2.74),(-5.90,.17,2.40,2.72),
                        (-6.18,.018,2.44,2.51)],x=side*1.48)
        body=body.fuse(root_boss)
        # Lamps are embedded in a wingtip fairing, with a visible bezel and lens.
        x=side*6.58; y=-3.01
        add(seated_box(air,'Navigation_light_mount_'+label,x,y,.16,.24,.038,GRAPHITE))
        z=skin_height(air,x,y)
        add(box('Navigation_lens_'+label,(x,y,z+.025),(.09,.13,.025), '#a94436' if side<0 else '#4d9b77',.01))
    report('gear bays, structural mounts, attached doors and cockpit fittings')
    # The mains attach directly to the lower fuselage. Wheels swivel flat below
    # the engines; a narrow channel receives each strut and retraction ram.
    main_tools={}
    for side,label in [(-1,'Left'),(1,'Right')]:
        x=side*1.8
        shoulder=b.Solid.make_loft([ellipse(*p,x=x) for p in
                       [(-3.08,.10,1.60,1.73),(-2.90,.44,1.16,1.76),
                        (-2.40,.49,1.13,1.77),(-.90,.46,1.17,1.75),
                        (-.55,.26,1.33,1.76),(-.35,.08,1.60,1.72)]],ruled=True)
        body=body.fuse(shoulder)
        belly=shoulder.cut(shoulder.moved(b.Pos(0,0,.006*MM)))
        for door_side,door_label in [(-1,'Left'),(1,'Right')]:
            mask=box('Main_door_skin_tool',(x+door_side*.205,-1.91,1.35),(.404,1.90,.90))
            door_skins[f'Main_door_{label}_{door_label}']=belly.intersect(mask)
        chamber=box('Main_wheel_chamber',(x,-1.91,.6925),(.824,1.924,1.595))
        channel=box('Main_strut_channel',(side*1.8875,-1.82,.755),(.325,2.06,1.71))
        engine_clearance=tube('Engine_bay_clearance',(side*1.40,.04,1.92),(side*1.28,-6.52,1.90),.454)
        main_tools[label]=mark(chamber.fuse(channel).cut(engine_clearance),'Main_bay_tool_'+label)
        roof=box('Main_wheel_roof',(x,-1.91,1.502),(.86,1.96,.024),GRAPHITE).cut(channel,engine_clearance)
        roof=roof.cut(tube('Main_roof_pivot_clearance',(x-side*.12,-1.2,1.525),
                          (x+side*.30,-1.2,1.525),.0552))
        roof=mark(roof,'Main_bay_roof_Main_gear_'+label,GRAPHITE)
        channel_roof=box('Main_bay_roof_channel_'+label,(side*1.8875,-1.82,1.608),(.345,2.10,.004),GRAPHITE)
        bay_roofs.extend([roof,mark(channel_roof.cut(engine_clearance),channel_roof.label,GRAPHITE)])
    body=b.Compound(list(body.solids()))
    for side,label in [(-1,'Left'),(1,'Right')]:
        body=body.cut(main_tools[label])
        body=body.cut(tube('Main_trunnion_clearance',(side*1.8-side*.12,-1.2,1.525),
                           (side*1.8+side*.30,-1.2,1.525),.0552))
    # Aft-folding nose wheels occupy the lower fuselage, below the pressure floor.
    body=b.Compound(list(body.solids()))
    # Ruled belly tooling keeps the thin door Boolean well conditioned.
    door_envelope=b.Solid.make_loft([ellipse(*p) for p in stations],ruled=True)
    belly=door_envelope.cut(door_envelope.moved(b.Pos(0,0,.006*MM)))
    for side,label in [(-1,'Left'),(1,'Right')]:
        door_skins['Nose_door_'+label]=belly.intersect(
            box('Nose_door_skin_tool',(side*.155,4.55,1.30),(.303,2.08,.55)))
    nose_bay=box('Nose_bay_tool',(0,4.55,.90),(.62,2.12,1.79))
    body=body.cut(nose_bay)
    # Apply the continuous bores last, to owned solids rather than an assembly wrapper.
    # Later unions must not refill these passages or retain uncut child geometry.
    for side in [-1,1]:
        tool=tube('Engine_final_core_bore',engine_center(side,.15),engine_center(side,-6.60),.449)
        body=b.Compound([solid for source in body.solids() for solid in source.cut(tool).solids()])
        if body.is_inside(v((side*1.65,-.10,1.92))):
            raise ValueError('Engine annular passage was not opened')
    add(mark(body,'Fuselage'))
    add(box('Nose_bay_roof_rear',(0,4.55,1.807),(.64,2.14,.024),GRAPHITE))
    for roof in bay_roofs: add(roof)
    gear_parts=[]
    for leg in LEGS:
        name=leg['name']; x,y,top=leg['point']
        nose=name=='Nose_gear'
        moving=gear(name,x,y,leg['radius'],top)
        if nose:
            moving.children=[*moving.children,
                tube('Landing_light_bracket',(0,y,1.42),(0,y+.01,1.42),.032,color=GRAPHITE),
                tube('Landing_light_bezel',(0,y-.06,1.42),(0,y+.02,1.42),.072,color=GRAPHITE),
                tube('Landing_light_lens',(0,y+.018,1.42),(0,y+.032,1.42),.056,color=WING_PAINT)]
        gear_parts.append(moving)
        # Bearing blocks stay fixed. The pin turns without translating its trunnion.
        for sign in [-1,1]:
            outboard=math.copysign(1,x) if not nose else 0
            start=.14 if nose else .105 if sign==outboard else .08
            end=.405 if nose else .28 if sign==outboard else .10
            add(tube(name+f'_bearing_{sign}',(x+sign*start,y,top),
                     (x+sign*end,y,top),.10 if nose else .065,.0852 if nose else .0552,color=PAINT))
        brace_x=x+leg.get('brace_x',.13)
        brace_wall=.405 if nose else x+math.copysign(.32,x)
        add(tube(name+'_brace_mount',(brace_x,y+leg['brace_lead'],top),
                 (brace_wall,y+leg['brace_lead'],top),.035,color=PAINT))
        fixed=segments()[name+'_actuator_barrel'][0]
        mount_z=1.807 if nose else 1.622
        add(tube(name+'_actuator_mount',fixed,
                 (fixed[0],fixed[1],mount_z),.035,color=PAINT))
        # Brace lower clevis rides with the leg.
        moving.children=[*moving.children,
            tube(name+'_brace_lower_pin',(brace_x-.03,y,leg['radius']+leg.get('brace_height',.64)),
                 (brace_x+.03,y,leg['radius']+leg.get('brace_height',.64)),.034),
            tube(name+'_actuator_lower_pin',(fixed[0]-.03,y,top-.25),(fixed[0]+.03,y,top-.25),.028),
            tube(name+'_actuator_lower_bridge',(x,y,top-.25),(fixed[0],y,top-.25),.028)]
    for door in DOORS:
        name=door['name']; hx,y,z=door['point']
        sign=-1 if name.endswith('Left') else 1
        length=1.90 if name.startswith('Main') else 2.08
        half_width=.41 if name.startswith('Main') else .31
        if not door_skins[name]: raise ValueError('Missing underside door skin: '+name)
        skin=mark(door_skins[name],name+'_skin',PAINT)
        panel=mark(b.Compound(list(skin.solids())),name+'_skin',PAINT)
        # The reinforcement follows the actual panel surface rather than floating.
        strip=mark(panel.intersect(box('Door_rib_mask',(hx-sign*half_width*.5,y,z),
                            (.042,length-.15,1.0))),name+'_rib',GRAPHITE)
        rib=b.Compound(list(strip.solids())).moved(b.Pos(0,0,.004*MM))
        rib=mark(rib,name+'_rib',GRAPHITE)
        loc=b.Pos(*v((hx,y,z)))*b.Rot(0,door['open_angle'],0)*b.Pos(*v((-hx,-y,-z)))
        moving_door=[mark(loc*panel,name+'_skin'),mark(loc*rib,name+'_rib',GRAPHITE)]
        hinge_span=length*(.38 if name.startswith('Nose') else .47)
        for yy in [y-hinge_span,y+hinge_span]:
            pz=skin_height(panel,hx-sign*.015,yy)
            ear=tube(name+'_ear_'+str(yy),(hx,yy,z),(hx-sign*.015,yy,pz),.020,color=GRAPHITE)
            moving_door.append(mark(loc*ear,ear.label,GRAPHITE))
            add(tube(name+'_hinge_'+str(yy),(hx,yy-.04,z),(hx,yy+.04,z),.024))
            host=body
            mount_x=hx+sign*(.055 if name.startswith('Nose') else .020)
            hits=host.intersect(b.Edge.make_line(v((mount_x,yy,0)),v((mount_x,yy,4))))
            mount_z=min(p.Z/MM for p in hits.vertices())+.035
            mount=tube(name+'_mount_'+str(yy),(hx,yy,z),(mount_x,yy,mount_z),.027,color=PAINT)
            if name.startswith('Main'):
                engine_side=-1 if name.startswith('Main_door_Left_') else 1
                core=tube('Door_mount_engine_clearance',(engine_side*1.40,.04,1.92),
                          (engine_side*1.28,-6.52,1.90),.450)
                mount=mark(mount.cut(core),mount.label,PAINT)
            add(mount)
        gear_parts.append(group(name,moving_door))
    # Independent pinned segments: exported in their own local axial frames.
    for name,(a,c) in segments().items():
        radius=.039 if name.endswith('barrel') else .019 if name.endswith('piston') else .024
        link_parts=[tube(name+'_tube',a,c,radius,inner=.021 if name.endswith('barrel') else 0,color=METAL if name.endswith('piston') else GRAPHITE)]
        if name.endswith('brace_lower'):
            link_parts.append(tube(name+'_elbow_pin',(a[0]-.037,a[1],a[2]),
                                   (a[0]+.037,a[1],a[2]),.033))
        gear_parts.append(group(name,link_parts))
    add(group('LandingGear',gear_parts))
    add(tube('Tail_light_bezel',(0,-8.10,1.85),(0,-8.035,1.85),.032,color=GRAPHITE))
    add(tube('Tail_light_lens',(0,-8.109,1.85),(0,-8.095,1.85),.022,color=WING_PAINT))
    # Skin-following inspection panels are cut from a 2.2 mm contour layer.
    report('flush skin details and surface-referenced avionics housings')
    envelope=raw_body.fuse(*nacelles)
    skin=envelope.moved(b.Pos(0,0,.7)).cut(envelope.moved(b.Pos(0,0,-1.5)))
    for side,label in [(-1,'Left'),(1,'Right')]:
        outer=box('Panel_tool',(side*1.28,-2.52,3),(.58,1.17,1.5))
        inner=box('Panel_inset_tool',(side*1.28,-2.52,3),(.574,1.164,1.5))
        patch=mark(skin.intersect(outer),'Service_panel_blank_'+label)
        add(mark(patch.intersect(inner),'Flush_service_panel_'+label,'#82939e'))
        add(mark(patch.cut(inner),'Service_panel_gasket_'+label,GRAPHITE))
        for yy in [-2.96,-2.06]:
            for xx in [side*1.09,side*1.47]:
                zz=skin_height(envelope,xx,yy)
                add(tube(f'Panel_fastener_{label}_{xx}_{yy}',(xx,yy,zz-.002),(xx,yy,zz+.002),.006))
        # A slim attached upper formation-light bezel, seated against actual skin.
        add(seated_box(raw_body,'Formation_bezel_'+label,side*.63,1.25,.055,.75,.025,GRAPHITE))
        zz=skin_height(raw_body,side*.63,1.25)
        add(box('Formation_lens_'+label,(side*.63,1.25,zz+.009),(.035,.65,.012),'#d6bb83'))
    add(seated_box(raw_body,'Antenna_foot',0,-.6,.10,.43,.032,GRAPHITE))
    zz=skin_height(raw_body,0,-.6)
    add(box('Dorsal_antenna',(0,-.60,zz+.088),(.025,.31,.17),GRAPHITE,.009))
    add(seated_box(raw_body,'Beacon_mount',0,-1.2,.11,.13,.035,GRAPHITE))
    zz=skin_height(raw_body,0,-1.2)
    add(box('Beacon_lens',(0,-1.2,zz+.029),(.071,.084,.04),'#a94436',.012))
    assembly=group('Stormbird_HX40',parts)
    leaves=[]
    def check(s):
        if s.children:
            for child in s.children: check(child)
        else:
            if not s.is_valid or s.volume<=0: raise ValueError(f'Invalid solid {s.label}: {s.volume}')
            leaves.append(s)
    check(assembly)
    report(f'{len(leaves)} closed named solids in the precision assembly')
    return assembly


if __name__=='__main__': stormbird()
