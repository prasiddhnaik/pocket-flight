"""Heron UT-9: CAD utility turboprop, inspired by Grand Caravan proportions.

Metres in parameters, millimetres in BREP. +X right, +Y forward, +Z up;
ground Z=0, simulation datum Z=2.05. Original game asset, not construction data.
Every leaf is a closed solid and must have a measured contact path to Fuselage.
"""
import math
from cadgen import build123d as b, glb, report, srgb, step

MM = 1000
SPAN, LENGTH, HEIGHT, DATUM = 15.87, 12.67, 4.70, 2.05
WHITE, NAVY, COPPER = '#f1f3f2', '#19344b', '#bd8655'
GLASS, RUBBER, METAL, DARK = '#20313c', '#202427', '#a6b0b5', '#253039'
HINGES = {
    'Propeller': (0, 4.22, 2.28),
    'Aileron_Left': (-5.95, -.25, 3.10),
    'Aileron_Right': (5.95, -.25, 3.10),
    'Flap_Left': (-2.9, -.25, 3.10),
    'Flap_Right': (2.9, -.25, 3.10),
    'Elevator': (0, -7.32, 2.27),
    'Rudder': (0, -7.72, 3.35),
    'Front_Wheel_Steering': (0, 2.7, .47),
    'Wheel_Front': (0, 2.7, .34),
    'Wheel_Main_Left': (-1.62, -.75, .43),
    'Wheel_Main_Right': (1.62, -.75, .43),
    'Suspension_Main_Left': (-1.62, -.75, .43),
    'Suspension_Main_Right': (1.62, -.75, .43),
    'Suspension_Nose': (0, 2.7, .34),
}


def v(point):
    return b.Vector(*(n * MM for n in point))


def mark(shape, name, color=WHITE):
    if isinstance(shape, (list, tuple, b.ShapeList)):
        shape = shape[0] if len(shape) == 1 else b.Compound(children=list(shape))
    shape.label, shape.color = name, srgb(color)
    return shape


def group(name, parts):
    return b.Compound(label=name, children=parts)


def box(name, center, size, color=WHITE, radius=0):
    shape = b.Box(*(n * MM for n in size))
    if radius:
        shape = b.fillet(shape.edges(), radius * MM)
    return mark(b.Pos(*v(center)) * shape, name, color)


def rod(name, start, end, radius, color=METAL):
    direction = v(end) - v(start)
    return mark(b.Solid.make_cylinder(radius * MM, direction.length,
                b.Plane(origin=v(start), z_dir=direction)), name, color)


def section(y, width, low, high):
    plane = b.Plane(origin=v((0, y, (low + high) / 2)),
                    x_dir=(1, 0, 0), z_dir=(0, 1, 0))
    # Four matching quadrants keep the seam fixed as the ellipse changes from
    # tall cabin to wide cowling; a one-edge ellipse changes its major-axis seam.
    return b.Wire([b.Edge.make_ellipse(width*MM,(high-low)*MM/2,plane,a,a+90)
                   for a in [0,90,180,270]])


def hull_section(y, width, low, high):
    # The Caravan reference has flat cabin sides and a defined floor line.
    # Four lines and four rounded corners retain matching topology at every
    # station. Scaling the arcs makes the cowling and tail sections nearly oval.
    fullness = min(1, max(0, (y+6.1)/2.7), max(0, (2.9-y)/1.25))
    radius = .96 - .59*fullness
    wire = b.RectangleRounded(2000,2000,radius*MM).faces()[0].outer_wire()
    return wire.transform_geometry(b.Matrix([
        [width,0,0,0], [0,0,-1,y*MM],
        [0,(high-low)/2,0,(low+high)*MM/2], [0,0,0,1]]))


def fair_loft(wires):
    from OCP.BRepOffsetAPI import BRepOffsetAPI_ThruSections
    loft = BRepOffsetAPI_ThruSections(True,False,1e-6)
    loft.CheckCompatibility(False)
    loft.SetMaxDegree(3)
    for wire in wires:
        loft.AddWire(wire.wrapped)
    loft.Build()
    return b.Solid(loft.Shape())


def inlet_tool():
    plane=b.Plane(origin=v((0,4.19,1.98)),x_dir=(1,0,0),z_dir=(0,-1,0))
    return b.Solid.extrude((plane*b.Ellipse(180,110)).faces()[0],v((0,-.24,0)))


STATIONS = [
    (-8.17, .025, 2.09, 2.23), (-7.80, .11, 2.00, 2.39),
    (-7.0, .24, 1.90, 2.62), (-6.0, .40, 1.72, 2.80),
    (-5.0, .58, 1.50, 2.94), (-4.20, .73, 1.33, 3.00),
    (-3.50, .85, 1.30, 3.02), (-2.50, .87, 1.30, 3.02),
    (-1.0, .88, 1.30, 3.02), (1.0, .87, 1.31, 3.02),
    (1.75, .84, 1.36, 3.00), (2.15, .76, 1.49, 2.82),
    (2.65, .62, 1.73, 2.60), (3.05, .53, 1.82, 2.62),
    (3.65, .47, 1.83, 2.61),
    (4.15, .27, 2.01, 2.55),
]

# Gross planform stations are exported with the mesh so the game measures the
# actual design instead of keeping a second, potentially stale wing definition.
WING_STATIONS = [(.52,1.15,1.95,3.08), (4.80,.90,1.70,3.23),
                 (7.45,.62,1.31,3.36), (7.68,.53,1.18,3.37),
                 (7.84,.42,.95,3.39), (SPAN/2,.30,.70,3.40)]
TAIL_STATIONS = [(.08,-6.00,1.98),(1.95,-6.45,1.38),(2.48,-6.76,1.08),(2.66,-6.99,.80)]
WING_ROOT_INCIDENCE, WING_WASHOUT, CONTROL_CHORD = 2.5, 2.5, .28
CONTROL_SPANS = {'Flap':(1.03,4.72),'Aileron':(4.86,7.45)}


def wing_station(x):
    for i,station in enumerate(WING_STATIONS):
        if x<=station[0]:
            if not i: return station[1:]
            before=WING_STATIONS[i-1];t=(x-before[0])/(station[0]-before[0])
            return tuple(a+(bb-a)*t for a,bb in zip(before[1:],station[1:]))
    return WING_STATIONS[-1][1:]


def wing_incidence(x):
    return WING_ROOT_INCIDENCE-WING_WASHOUT*max(0,min(1,(x-.52)/(7.45-.52)))


def wing_hinge(side,x):
    leading,chord,z=wing_station(x)
    return side*x,leading-(1-CONTROL_CHORD)*chord,z


def skin_point(shape, origin, direction):
    """Find the nearest forward hit on the real curved skin, in metres."""
    from OCP.BRepIntCurveSurface import BRepIntCurveSurface_Inter
    from OCP.gce import gce_MakeLin
    ray=b.Axis(v(origin),direction)
    hits=BRepIntCurveSurface_Inter()
    hits.Init(shape.wrapped,gce_MakeLin(ray.wrapped).Value(),1e-5)
    points=[]
    while hits.More():
        point=b.Vector(hits.Pnt())
        if (point-v(origin)).dot(b.Vector(direction))>=0:
            points.append(point)
        hits.Next()
    if not points: raise ValueError('No skin attachment at '+str(origin))
    return min(points,key=lambda p:(p-v(origin)).length)/MM


def side_face(points, radius=0):
    face=b.Face(b.Wire.make_polygon([v((0,y,z)) for y,z in points],close=True))
    return face.fillet_2d(radius*MM,face.vertices()) if radius else face


def side_recess(outer, side, face, name, width=.005, depth=.007):
    """A shallow groove with a recessed gasket joined through its back face."""
    tool=b.Solid.extrude(face,v((side*1.3,0,0)))
    if width:
        inside=b.Face(face.outer_wire().offset_2d(-width*MM))
        tool=mark(tool.cut(b.Solid.extrude(inside,v((side*1.3,0,0)))),'recess_tool')
    floor=outer.moved(b.Pos(-side*depth*MM,0,0))
    gasket=mark(tool.intersect(outer.moved(b.Pos(-side*2,0,0))),'gasket')
    gasket=gasket.cut(outer.moved(b.Pos(-side*(depth+.002)*MM,0,0)))
    return tool.cut(floor),mark(gasket,name,DARK)


def fuselage_details(shell, outer):
    details=[]
    for side,label in [(-1,'Left'),(1,'Right')]:
        panels=[('Pilot_door',[(.86,1.51),(1.88,1.51),(1.88,2.46),
                              (1.44,2.87),(.86,2.87)]),
                ('Cabin_door',[(-3.70,1.44),(-2.45,1.44),(-2.45,2.86),(-3.70,2.86)]),
                ('Cowling_panel',[(2.76,2.13),(3.79,2.13),(3.79,2.48),(2.76,2.48)])]
        for name,points in panels:
            cut,gasket=side_recess(outer,side,side_face(points,.04),name+'_seal_'+label)
            shell=mark(shell.cut(cut),'shell');details.append(gasket)
        # Actual recessed cooling slots; dark bottoms overlap the intact skin.
        for i,y in enumerate([2.45,2.54,2.63],1):
            face=side_face([(y,2.18),(y+.014,2.18),(y+.055,2.39),(y+.041,2.39)],.004)
            cut,gasket=side_recess(outer,side,face,f'Cooling_slot_{label}_{i}',width=0,depth=.010)
            shell=mark(shell.cut(cut),'shell');details.append(gasket)
        for door,y in [('Pilot',1.84),('Cabin',-3.66)]:
            for i,z in enumerate([1.75,2.19],1):
                x=skin_point(outer,(side*2,y,z),(-side,0,0)).X+side*.004
                details.append(rod(f'{door}_door_hinge_{label}_{i}',(x,y,z-.035),(x,y,z+.035),.012))
        for i,(y,z) in enumerate([(2.83,2.20),(3.68,2.20),(2.83,2.41),(3.68,2.41)],1):
            p=skin_point(outer,(side*2,y,z),(-side,0,0))
            details.append(rod(f'Cowling_fastener_{label}_{i}',
                (p.X-side*.004,y,z),(p.X+side*.003,y,z),.008))
    return shell,details


HINGE_AXES = {}
for side,label in [(-1,'Left'),(1,'Right')]:
    for kind,(lo,hi) in CONTROL_SPANS.items():
        a,bb=sorted([wing_hinge(side,lo),wing_hinge(side,hi)])
        name=kind+'_'+label
        HINGES[name]=tuple((c+d)/2 for c,d in zip(a,bb))
        HINGE_AXES[name]=tuple(d-c for c,d in zip(a,bb))


def fuselage():
    outer = fair_loft([hull_section(*s) for s in STATIONS])
    inner = fair_loft([hull_section(y, w-.055, lo+.065, hi-.065)
                              for y,w,lo,hi in STATIONS if -4.0 <= y <= 2.65])
    shell = outer.cut(inner)
    windows = []
    # Overlapping perimeter lips meet the shell instead of floating on its skin.
    for side, label in [(-1, 'Left'), (1, 'Right')]:
        for i,y in enumerate([1.4, .52, -.36, -1.24, -2.12, -3.0]):
            if i == 0:
                # The pilot's side window follows the windshield rake.
                def pilot_window(extra):
                    points=[(.99,2.23),(1.76,2.23),(1.76,2.45),(1.40,2.69),(.99,2.69)]
                    wire=b.Wire.make_polygon([v((side*.50,1.38+(yy-1.38)*(1+extra),
                                                   2.45+(zz-2.45)*(1+extra))) for yy,zz in points],close=True)
                    solid=b.Solid.extrude(b.Face(wire),v((side*.70,0,0)))
                    return b.fillet(solid.edges(),.025*MM)
                tool,lip=pilot_window(0),pilot_window(.016)
            else:
                tool = box('window_tool', (side*.86,y,2.42), (.6,.54,.42), radius=.055)
                lip = box('glazing_lip', (side*.86,y,2.42), (.6,.548,.428), radius=.055)
            shell = mark(shell.cut(tool), 'shell')
            windows.append(mark(mark(outer.intersect(lip), 'patch').cut(inner),
                                f'Cabin_window_{label}_{i+1}', GLASS))
        # Sloping, split windshield; the center post remains part of the shell.
        axis=b.Axis(v((0,2.17,2.81)),(1,0,0))
        tool = box('windshield_tool', (side*.34,2.17,2.81), (.61,.84,.22), radius=.025).rotate(axis,-25)
        lip = box('windshield_lip', (side*.34,2.17,2.81), (.618,.848,.228), radius=.025).rotate(axis,-25)
        shell = mark(shell.cut(tool), 'shell')
        windows.append(mark(mark(outer.intersect(lip), 'patch').cut(inner), f'Windshield_{label}', GLASS))
    # Partition the existing shell at paint boundaries. Adjacent colored solids
    # share their mating faces and never duplicate the visible exterior skin.
    shell=mark(shell.cut(inlet_tool()),'shell')
    shell,details=fuselage_details(shell,outer)
    windows.extend(details)
    for side,label in [(-1,'Left'),(1,'Right')]:
        band = box('band_tool',(side*.88,-.73,2.04),(.75,5.70,.026))
        band = band.rotate(b.Axis(v((0,-.73,2.04)),(1,0,0)),-1.2)
        windows.append(mark(shell.intersect(band),'Cabin_cheatline_'+label,COPPER))
        shell=mark(shell.cut(band),'shell')
    belly=box('belly_paint_tool',(0,0,.66),(3,20,2))
    windows.append(mark(shell.intersect(belly),'Curved_belly_livery',NAVY))
    return mark(shell.cut(belly), 'Fuselage'), windows, outer


def airfoil_wire(leading, chord, center, thickness, position, camber=.02):
    # Closed NACA-style section with finite trailing-edge thickness.
    def height(u):
        return 5*thickness*(.2969*math.sqrt(u)-.1260*u-.3516*u*u+.2843*u**3-.1015*u**4)
    values = [(1-math.cos(math.pi*i/32))/2 for i in range(33)]
    upper = [v(position(leading-u*chord,center+chord*(camber*math.sin(math.pi*u)+height(u)))) for u in values]
    lower = [v(position(leading-u*chord,center+chord*(camber*math.sin(math.pi*u)-height(u)))) for u in values]
    return b.Wire([b.Edge.make_spline(upper),b.Edge.make_line(upper[-1],lower[-1]),
                   b.Edge.make_spline(list(reversed(lower)))])


def foil_wire(x, leading, chord, z, thickness=.14, camber=.02, incidence=0):
    wire=airfoil_wire(leading,chord,z,thickness,lambda y,h:(x,y,h),camber=camber)
    return wire.rotate(b.Axis(v((x,leading-(1-CONTROL_CHORD)*chord,z)),(1,0,0)),incidence)


def streamlined_strut(name,start,end,chord=.22,thickness=.065,color=WHITE):
    direction=v(end)-v(start)
    plane=b.Plane(origin=v(start),x_dir=(0,1,0),z_dir=direction)
    face=(plane*b.Ellipse(chord*MM/2,thickness*MM/2)).faces()[0]
    return mark(b.Solid.extrude(face,direction),name,color)


def wing(side, label):
    full = b.Solid.make_loft([foil_wire(side*x,le,c,z,incidence=wing_incidence(x))
                            for x,le,c,z in WING_STATIONS], ruled=True)
    pieces = []
    x=side*1.72;leading,chord,_=wing_station(abs(x))
    y=leading-.35*chord
    cap_point=skin_point(full,(x,y,4),(0,0,-1))
    cap=rod('fuel_cap',(x,y,cap_point.Z-.012),(x,y,cap_point.Z+.003),.058,METAL)
    slot=box('fuel_cap_slot',(x,y,cap_point.Z+.003),(.045,.007,.007),DARK)
    pieces.append(mark(cap.cut(slot),'Fuel_cap_'+label,METAL))
    if side<0:
        x=-2.80;leading,chord,_=wing_station(abs(x));y=leading-.12*chord
        p=skin_point(full,(x,y,2.5),(0,0,1))
        pieces.append(streamlined_strut('Pitot_mast',(x,y,p.Z+.012),(x,y,p.Z-.16),.085,.035,METAL))
        probe=rod('pitot',(x,y-.035,p.Z-.155),(x,y+.25,p.Z-.155),.010,METAL)
        bore=rod('pitot_bore',(x,y+.20,p.Z-.155),(x,y+.26,p.Z-.155),.004)
        pieces.append(mark(probe.cut(bore),'Pitot_probe',METAL))
    fixed = full
    for kind,(lo,hi) in CONTROL_SPANS.items():
        a,bb=wing_hinge(side,lo),wing_hinge(side,hi)
        # The hinge follows the real tapered, dihedral wing. A recessed circular
        # nose leaves clearance for deflection instead of intersecting the skin.
        direction=(v(bb)-v(a)).normalized();length=(v(bb)-v(a)).length
        forward=b.Vector(0,1,0);forward=(forward-direction*forward.dot(direction)).normalized()
        plane=b.Plane(origin=(v(a)+v(bb))/2,x_dir=direction,z_dir=direction.cross(forward))
        cut=plane*(b.Pos(0,-1025,0)*b.Box(length,2000,2000))
        nose=rod('control_nose',a,bb,.10)
        moving_tool=mark(cut.fuse(nose),'moving_tool')
        control=mark(full.intersect(moving_tool),'control')
        clearance=plane*(b.Pos(0,-1025,0)*b.Box(length+12,2000,2000))
        pocket_start=(v(a)-direction*6)/MM;pocket_end=(v(bb)+direction*6)/MM
        pocket=rod('control_clearance',pocket_start,pocket_end,.13)
        fixed=mark(mark(fixed.cut(clearance),'fixed').cut(pocket),'fixed')
        pieces.append(mark(control, kind+'_'+label, WHITE))
        pin_start=(v(a)-direction*35)/MM;pin_end=(v(bb)+direction*35)/MM
        pieces.append(rod(kind+'_hinge_'+label,pin_start,pin_end,.027))
    light_tool=box('wingtip_light_tool',(side*7.925,.08,3.40),(.09,.30,.5))
    pieces.append(mark(full.intersect(light_tool),'Navigation_light_'+label,
                       '#d64e43' if side<0 else '#65cba7'))
    fixed=mark(fixed.cut(light_tool),'fixed')
    # Blend into the actual wing section and unite the overlapping solids. The
    # old separate, thicker root produced a raised cushion around the cabin.
    root_sections = [(0,1.17,1.98,3.08),(.52,*wing_station(.52)),(1.0,*wing_station(1.0))]
    root = fair_loft([foil_wire(side*x,le,c,z,incidence=wing_incidence(x))
                      for x,le,c,z in root_sections])
    fixed=mark(fixed.fuse(root),'fixed')
    cap=box('wingtip_paint_tool',(side*7.85,.1,3.4),(.55,3,1))
    pieces.append(mark(fixed.intersect(cap),'Wingtip_cap_'+label,NAVY))
    pieces.append(mark(fixed.cut(cap), 'Wing_skin_'+label))
    pieces.append(streamlined_strut('Wing_strut_'+label, (side*.58,.15,1.44),
                                    (side*4.55,.14,wing_station(4.55)[2])))
    for x in [.68,4.50]:
        z = 1.44+(x-.58)/(4.55-.58)*(wing_station(4.55)[2]-1.44)
        pieces.append(rod('Strut_attach_'+label+'_'+str(x), (side*x,.09,z),
                          (side*x,.20,z), .075))
    return group('Wing_'+label, pieces)


def tail():
    halves, elevators = [], []
    for side,label in [(-1,'Left'),(1,'Right')]:
        full = b.Solid.make_loft([foil_wire(side*x,le,c,2.27,.10,camber=0)
                for x,le,c in TAIL_STATIONS], ruled=True)
        tool = box('elevator_cut',(side*1.45,-7.85,2.27),(2.70,1.06,.6))
        halves.append(mark(full.cut(tool),'Tailplane_'+label))
        elevators.append(mark(full.intersect(tool),'Elevator_skin_'+label,WHITE))
        halves.append(rod('Elevator_hinge_'+label,(side*.12,-7.32,2.27),
                          (side*2.59,-7.32,2.27),.023))
    fin_wires=[]
    for z,front,rear in [(2.15,-5.50,-8.17),(2.55,-5.92,-8.17),
                          (3.15,-6.35,-8.16),(4.25,-6.99,-8.08),
                          (4.60,-7.28,-8.02),(HEIGHT,-7.30,-8.01)]:
        fin_wires.append(airfoil_wire(front,front-rear,0,.12,lambda y,h:(h,y,z),camber=0))
    full = b.Solid.make_loft(fin_wires,ruled=True)
    tool = box('rudder_cut',(0,-8.08,3.5),(.6,.72,2.6))
    fixed=mark(full.cut(tool),'fixed_fin')
    cap=box('fin_tip_paint',(0,-7.6,4.45),(1,3,.60))
    halves.append(group('Vertical_stabilizer',[
        mark(fixed.cut(cap),'Fin_skin',WHITE),mark(fixed.intersect(cap),'Fin_cap',NAVY)]))
    halves.append(rod('Rudder_hinge',(0,-7.72,2.20),(0,-7.72,4.65),.027))
    halves.append(mark(full.intersect(tool),'Rudder',WHITE))
    halves.append(group('Elevator',elevators))
    return halves


def gear():
    pieces=[]
    for side,label in [(-1,'Left'),(1,'Right')]:
        pieces.append(mark(fair_loft([foil_wire(side*x,y+.15,.30,z,.20)
            for x,y,z in [(.55,-.47,1.48),(.88,-.55,1.20),(1.25,-.68,.66),(1.52,-.75,.43)]]),
            'Main_gear_leg_'+label,WHITE))
        pieces.append(rod('Main_gear_axle_'+label,(side*1.40,-.75,.43),
                          (side*1.75,-.75,.43),.085))
        wheel=rod('Main_tire_'+label,(side*1.49,-.75,.43),(side*1.75,-.75,.43),.43,RUBBER)
        wheel=mark(b.fillet(wheel.edges().filter_by(b.GeomType.CIRCLE),.085*MM), 'Main_tire_'+label, RUBBER)
        for x in [1.585,1.62,1.655]:
            groove=b.Solid.make_torus(429,3.5,b.Plane(origin=v((side*x,-.75,.43)),z_dir=(1,0,0)))
            wheel=mark(wheel.cut(groove),'Main_tire_'+label,RUBBER)
        hub=rod('Main_hub_'+label,(side*1.47,-.75,.43),(side*1.765,-.75,.43),.19,METAL)
        for angle in range(0,360,60):
            y=-.75+.123*math.cos(math.radians(angle));z=.43+.123*math.sin(math.radians(angle))
            recess=rod('hub_recess',(side*1.735,y,z),(side*1.79,y,z),.026)
            hub=mark(hub.cut(recess),'Main_hub_'+label,METAL)
        hubcap=rod('Main_hubcap_'+label,(side*1.75,-.75,.43),(side*1.79,-.75,.43),.078,DARK)
        disc=rod('brake_disc',(side*1.445,-.75,.43),(side*1.477,-.75,.43),.24,METAL)
        disc=disc.cut(rod('disc_bore',(side*1.43,-.75,.43),(side*1.49,-.75,.43),.10))
        caliper=box('Brake_caliper_'+label,(side*1.46,-.98,.47),(.09,.12,.15),DARK,.014)
        bracket=rod('Brake_mount_'+label,(side*1.45,-.76,.48),(side*1.45,-.98,.48),.026,METAL)
        # Flexible line stays with the fixed caliper and leg, not the spinning hub.
        points=[(side*1.46,-1.0,.52),(side*1.40,-.96,.62),
                (side*1.26,-.79,.72),(side*1.18,-.68,.77)]
        path=b.Edge.make_spline([v(p) for p in points])
        profile=b.Plane(origin=v(points[0]),z_dir=path.tangent_at(0))*b.Circle(7)
        hose=b.sweep(profile,path=path)
        pieces.append(group('Suspension_Main_'+label,[
            group('Wheel_Main_'+label,[wheel,hub,hubcap,mark(disc,'Brake_disc_'+label,METAL)]),
            caliper,bracket,mark(hose,'Brake_hose_'+label,RUBBER)]))
    pieces.append(rod('Nose_oleo',(0,2.70,1.85),(0,2.70,1.04),.085,WHITE))
    pieces.append(rod('Nose_oleo_piston',(0,2.70,1.06),(0,2.70,.59),.050,METAL))
    pieces.append(rod('Nose_torque_link_upper',(0,2.70,1.12),(0,2.50,.88),.023,METAL))
    pieces.append(rod('Nose_torque_link_lower',(0,2.50,.88),(0,2.70,.65),.023,METAL))
    nose=[rod('Nose_fork_'+str(side),(side*.15,2.7,.65),(side*.15,2.7,.34),.042,WHITE)
          for side in [-1,1]]
    nose.append(rod('Nose_axle',(-.19,2.7,.34),(.19,2.7,.34),.065))
    nose.append(rod('Nose_fork_bridge',(-.15,2.7,.63),(.15,2.7,.63),.065,WHITE))
    tire=rod('Nose_tire',(-.125,2.7,.34),(.125,2.7,.34),.34,RUBBER)
    tire=mark(b.fillet(tire.edges().filter_by(b.GeomType.CIRCLE),.07*MM),'Nose_tire',RUBBER)
    for x in [-.035,0,.035]:
        groove=b.Solid.make_torus(339,3,b.Plane(origin=v((x,2.7,.34)),z_dir=(1,0,0)))
        tire=mark(tire.cut(groove),'Nose_tire',RUBBER)
    nose.append(group('Wheel_Front',[
        tire,
        rod('Nose_hub',(-.145,2.7,.34),(.145,2.7,.34),.14,METAL)]))
    pieces.append(group('Suspension_Nose',[group('Front_Wheel_Steering',nose)]))
    lamp=rod('lamp_housing',(0,2.74,1.15),(0,2.86,1.15),.065,DARK)
    lamp=lamp.cut(rod('lamp_recess',(0,2.82,1.15),(0,2.88,1.15),.052))
    pieces.append(mark(lamp,'Taxi_lamp_housing',DARK))
    pieces.append(rod('Taxi_lamp_lens',(0,2.831,1.15),(0,2.855,1.15),.054,'#e9edf0'))
    return group('LandingGear',pieces)


def propeller():
    pieces=[rod('Propeller_shaft',(0,3.98,2.28),(0,4.35,2.28),.11),
            mark(fair_loft([section(y,r,2.28-r,2.28+r)
                 for y,r in [(4.16,.24),(4.27,.23),(4.41,.13),(4.50,.012)]]),'Spinner',WHITE)]
    axis=b.Axis(v(HINGES['Propeller']),(0,1,0))
    for i in range(4):
        wires=[]
        for radius,width,sweep,pitch in [(.12,.12,0,.07),(.32,.24,0,.06),
                                        (.80,.22,.04,.035),(1.23,.15,.12,.022),(1.32,.075,.16,.015)]:
            plane=b.Plane(origin=v((sweep,4.23,2.28+radius)),
                          x_dir=(1,pitch/width,0),z_dir=(0,0,1))
            wires.append((plane*b.Ellipse(width*MM/2,9)).faces()[0].outer_wire())
        blade=fair_loft(wires).rotate(axis,i*90+45)
        pieces.append(mark(blade,'Propeller_Blade_'+str(i+1),DARK))
    return group('Propeller',pieces)


def cargo_pod():
    # A constant rounded-rectangle center gives the pod a true flat bottom and
    # usable side panels; its end fairings rise into the cabin floor structure.
    def profile(y,width,low,high):
        plane=b.Plane(origin=v((0,y,(low+high)/2)),x_dir=(1,0,0),z_dir=(0,1,0))
        radius=min(width*.24,(high-low)*.20)
        return (plane*b.RectangleRounded(2*width*MM,(high-low)*MM,radius*MM)).faces()[0].outer_wire()
    center=profile(-2.8,.60,.70,1.42)
    pod=b.Solid.extrude(b.Face(center),v((0,4.0,0)))
    rear=fair_loft([profile(*s) for s in [(-4.25,.06,1.33,1.42),(-3.85,.29,1.10,1.42),
        (-3.3,.51,.80,1.42),(-2.9,.60,.70,1.42),(-2.8,.60,.70,1.42)]])
    front=fair_loft([profile(*s) for s in [(1.2,.60,.70,1.42),(1.3,.60,.70,1.42),
        (1.65,.50,.85,1.46),(1.88,.28,1.12,1.50),(1.96,.06,1.38,1.52)]])
    pod=mark(pod.fuse(rear,front),'pod')
    fittings=[]
    for side,label in [(-1,'Left'),(1,'Right')]:
        for i,y in enumerate([-2.15,-.80,.55],1):
            plane=b.Plane(origin=v((side*.592,y,1.07)),x_dir=(0,1,0),z_dir=(side,0,0))
            outer=(plane*b.RectangleRounded(1200,430,25)).faces()[0]
            inner=(plane*b.RectangleRounded(1188,418,19)).faces()[0]
            ring=b.Solid.extrude(outer,v((side*.04,0,0))).cut(b.Solid.extrude(inner,v((side*.04,0,0))))
            # An 8 mm recessed outline leaves every door joined through its back.
            pod=mark(pod.cut(ring),'pod')
            fittings.append(box(f'Cargo_latch_{label}_{i}',(side*.608,y+.40,1.07),
                                (.025,.085,.055),METAL,.007))
            for j,dy in enumerate([-.36,.36],1):
                fittings.append(rod(f'Cargo_hinge_{label}_{i}_{j}',
                    (side*.60,y+dy-.055,1.275),(side*.60,y+dy+.055,1.275),.012,METAL))
    return [mark(pod,'Cargo_pod',NAVY),*fittings]


@step(out='../STEP/heron-ut9.step')
@glb(out='../GLB/heron-cad.glb', mesh_tolerance=.001, mesh_angular_tolerance=.20)
def heron():
    report('Lofted airframe and fitted glazing')
    shell,windows,outer=fuselage()
    pieces=[shell,*windows]
    # The floor and crossmembers stay entirely inside the softened cabin skin.
    # Avoid a hull-clipped slab: shared exterior faces cause paint z-fighting.
    pieces.append(box('Cabin_floor',(0,-.81,1.48),(1.18,5.18,.11),DARK))
    for station,width in [(-2.6,1.40),(-1.3,1.44),(0,1.44),(1.3,1.36)]:
        pieces.append(box('Floor_crossmember_'+str(station),(0,station,1.48),(width,.10,.06),METAL))
    pieces.append(box('Wing_carry_through_spar',(0,.25,3.05),(2.15,.25,.18),METAL))
    report('Cambered wings, attached controls and braced roots')
    pieces.extend([wing(-1,'Left'),wing(1,'Right'),*tail(),gear(),propeller()])
    report('Flat-bottom cargo pod and fitted access hardware')
    pieces.extend(cargo_pod())
    chin = fair_loft([section(*s) for s in
        [(3.05,.25,1.60,2.22),(3.65,.30,1.64,2.20),(4.16,.24,1.78,2.18)]])
    pieces.append(mark(chin.cut(inlet_tool()),'Chin_cowling',WHITE))
    inlet_plane=b.Plane(origin=v((0,3.951,1.98)),x_dir=(1,0,0),z_dir=(0,-1,0))
    pieces.append(mark(b.Solid.extrude((inlet_plane*b.Ellipse(182,112)).faces()[0],v((0,-.012,0))),
                       'Engine_inlet',DARK))
    for side,label in [(-1,'Left'),(1,'Right')]:
        start,end=(side*.27,3.50,2.02),(side*.66,3.25,1.91)
        exhaust=rod('exhaust',start,end,.095,METAL)
        axis=(v(end)-v(start)).normalized()
        bore=rod('exhaust_bore',(v(end)-axis*180)/MM,(v(end)+axis*10)/MM,.075)
        pieces.append(mark(exhaust.cut(bore),'Exhaust_'+label,METAL))
        for y in [1.55,-2.88]:
            pieces.append(box('Door_handle_'+label+str(y),(side*.87,y,2.10),(.08,.22,.035),METAL,.01))
        pieces.append(rod('Step_bracket_'+label,(side*.55,1.5,1.45),(side*1.10,1.5,.89),.028,NAVY))
        pieces.append(box('Entry_step_'+label,(side*1.08,1.5,.88),(.26,.57,.055),DARK,.02))
    # Two pilot seats and six passenger seats are anchored to the cabin floor.
    for row,y in enumerate([1.70,.37,-.98,-2.33]):
        for side in [-1,1]:
            x=side*.40
            pieces.append(box(f'Seat_pedestal_{row}_{side}',(x,y,1.62),(.18,.30,.30),METAL,.015))
            pieces.append(box(f'Seat_cushion_{row}_{side}',(x,y,1.82),(.46,.48,.14),DARK,.045))
            pieces.append(box(f'Seat_back_{row}_{side}',(x,y-.20,2.15),(.46,.10,.67),NAVY,.04))
    pieces.append(box('Instrument_panel',(0,2.20,2.15),(1.32,.23,.40),DARK,.04))
    for x in [-.61,.61]:
        pieces.append(rod('Panel_support_'+str(x),(x*.82,1.75,1.48),(x,2.20,2.05),.035,DARK))
    for x in [-.40,.40]:
        pieces.append(rod('Yoke_column_'+str(x),(x,2.14,2.04),(x,1.80,2.04),.022,METAL))
        pieces.append(rod('Yoke_crossbar_'+str(x),(x-.12,1.80,2.04),(x+.12,1.80,2.04),.020,DARK))
        for side in [-1,1]:
            pieces.append(rod('Yoke_grip_'+str(x)+'_'+str(side),
                              (x+side*.12,1.80,2.025),(x+side*.12,1.80,2.17),.025,DARK))
    pieces.append(box('Throttle_pedestal',(0,1.68,1.46),(.17,.52,.51),DARK,.025))
    pieces.append(rod('Throttle_lever',(0,1.78,1.69),(0,1.73,1.94),.014,METAL))
    pieces.append(box('Throttle_handle',(0,1.73,1.94),(.09,.07,.06),COPPER,.015))
    for x in [-.42,0,.42]:
        pieces.append(box('Display_bezel_'+str(x),(x,2.06,2.20),(.35,.065,.27),METAL,.02))
    pieces.append(rod('Dorsal_antenna',(0,-1.8,2.99),(0,-1.95,3.48),.022,DARK))
    pieces.append(rod('Beacon_base',(0,-2.70,3.01),(0,-2.70,3.065),.057,METAL))
    beacon=rod('beacon',(0,-2.70,3.052),(0,-2.70,3.12),.047,'#d64e43')
    pieces.append(mark(b.fillet(beacon.edges().filter_by(b.GeomType.CIRCLE),10),'Beacon_lens','#d64e43'))
    return group('Heron_UT9',pieces)


if __name__ == '__main__':
    heron()
