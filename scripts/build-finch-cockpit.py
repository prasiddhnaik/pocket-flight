"""Rebuild Finch's cabin from its preserved airframe in a background Blender process.

Authoring metres: X right, +Y forward, +Z up. Rebuild the Cockpit subtree and fit wing paint bands.
Handbook: 13.1, 13.3, 13.4, 16.1, 16.2. This is an original concept trainer cabin.
"""
import bpy, bmesh, math, json, sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from finch_wing_markings import fit_wing_markings
from finch_internal_systems import build_internal_systems
from finch_airframe_details import fit_airframe_details

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/finch'
bpy.ops.wm.open_mainfile(filepath=str(OUT / 'Finch-U2-base.blend'))
bpy.context.preferences.filepaths.save_version = 0
fit_wing_markings()
airframe_details = fit_airframe_details()
old = bpy.data.objects['Cockpit']
for o in list(old.children_recursive) + [old]:
    bpy.data.objects.remove(o, do_unlink=True)
collection = bpy.data.collections['Finch U-2 • aircraft']
created = []


def material(name, color, rough=.5, metal=0, alpha=1, emission=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    rgb = tuple(((int(color[i:i+2], 16) / 255 + .055) / 1.055)**2.4 for i in (1, 3, 5))
    m.diffuse_color = (*rgb, alpha)
    bs = m.node_tree.nodes.get('Principled BSDF')
    for key, value in [('Base Color', (*rgb, alpha)), ('Roughness', rough), ('Metallic', metal), ('Alpha', alpha)]:
        bs.inputs[key].default_value = value
    if emission:
        bs.inputs['Emission Color'].default_value = (*rgb, 1)
        bs.inputs['Emission Strength'].default_value = emission
    return m


frame = material('Cabin • satin graphite', '#283238', .5, .18)
shell_trim = material('Cabin • porcelain canopy surround', '#E7E4D8', .36, .14)
rubber = material('Cabin • rubber seals', '#161D21', .86)
seat = material('Seats • charcoal upholstery', '#3C474C', .88)
insert = material('Seats • woven teal', '#667C7D', .9)
stitch = material('Seats • fine stitching', '#A4B4AD', .88)
belt = material('Seats • graphite harness webbing', '#526167', .94)
metal = material('Cabin • brushed aluminium', '#929FA4', .38, .86)
chrome = material('Cabin • piston stainless', '#B4BEC1', .23, .94)
ivory = material('Cabin • ivory legends', '#D9DDD5', .75)
red = material('Cabin • mixture coral', '#B64B37', .6)
screen = material('Avionics • screen black', '#0A171C', .58, emission=.3)
sky = material('Avionics • attitude sky', '#317EAA', .7, emission=.6)
earth = material('Avionics • attitude earth', '#795B3C', .8, emission=.45)
cyan = material('Avionics • display cyan', '#8ED8DB', .75, emission=.7)
green = material('Avionics • map terrain', '#365C4E', .8, emission=.4)
glass = material('Glass • Finch clear acrylic', '#CCDFE0', .09, .02, .22)
bs = glass.node_tree.nodes.get('Principled BSDF')
bs.inputs['IOR'].default_value = 1.46
bs.inputs['Coat Weight'].default_value = .45
glass.surface_render_method = 'DITHERED'


def own(o, parent):
    for c in list(o.users_collection): c.objects.unlink(o)
    collection.objects.link(o)
    if parent:
        bpy.context.view_layer.update()
        world = o.matrix_world.copy()
        o.parent = parent
        o.matrix_world = world
    created.append(o)
    return o


def group(name, p=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None)
    collection.objects.link(o)
    o.location = p
    if parent:
        o.parent = parent
    created.append(o)
    return o


cockpit = group('Cockpit', parent=bpy.data.objects['Fuselage'])
cockpit['revision'] = 'Finch cockpit 2026-10-14 seated panel controls'
cockpit['handbook_sections'] = '13.1 / 13.3 / 13.4 / 16.1 / 16.2'
cockpit['inspection_bounds_glTF'] = [[-.67,-.25,-1.64],[.67,1.22,.91]]
hinge = (0, -.87, .63)
canopy = group('Canopy', hinge, cockpit)
canopy['hinge_glTF'] = [0, .63, .87]
canopy['opening_radians'] = math.radians(55)
canopy['supports'] = [
    {'fixed': [s*.49, .28, .57], 'moving': [s*.5, -.01, -.57]}
    for s in [-1, 1]
]


def finish(o, mat, bevel=0, smooth=True):
    o.data.materials.append(mat)
    if bevel:
        mod = o.modifiers.new('Manufactured edge', 'BEVEL')
        mod.width = bevel
        mod.segments = 3
        o.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    if o.type == 'MESH':
        for p in o.data.polygons: p.use_smooth = smooth
    return o


def box(name, p, size, mat, parent=cockpit, bevel=.01):
    bpy.ops.mesh.primitive_cube_add(size=1, location=p)
    o = bpy.context.object
    o.name = name
    o.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return own(finish(o, mat, bevel), parent)


def mesh(name, vertices, faces, mat, parent=cockpit, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    o = bpy.data.objects.new(name, data)
    collection.objects.link(o)
    finish(o, mat, smooth=smooth)
    return own(o, parent)


def tube(name, points, radius, mat, parent=cockpit):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.resolution_u = 1
    data.bevel_depth = radius
    data.bevel_resolution = 2
    data.resolution_u = 2
    data.use_fill_caps = True
    spline = data.splines.new('POLY')
    spline.points.add(len(points)-1)
    for v, p in zip(spline.points, points): v.co = (*p, 1)
    o = bpy.data.objects.new(name, data)
    collection.objects.link(o)
    data.materials.append(mat)
    return own(o, parent)


def cylinder(name, a, b, radius, mat, parent=cockpit, vertices=24):
    a, b = Vector(a), Vector(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=(b-a).length, location=(a+b)/2)
    o = bpy.context.object
    o.name = name
    o.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    return own(finish(o, mat), parent)


def label(name, value, p, size=.011, mat=ivory, parent=cockpit):
    data = bpy.data.curves.new(name, 'FONT')
    data.body = value
    data.size = size
    data.align_x = 'CENTER'
    data.align_y = 'CENTER'
    data.extrude = .0001
    o = bpy.data.objects.new(name, data)
    collection.objects.link(o)
    o.location = p
    o.rotation_euler = (math.pi/2, 0, 0)
    data.materials.append(mat)
    return own(o, parent)


def bucket_back(name,x,parent):
    # Closed upholstered shell: lumbar contour, tapered shoulders, raised bolsters.
    profiles=[(.21,.18,-.43),(.30,.208,-.42),(.49,.205,-.45),
              (.65,.185,-.485),(.735,.16,-.50)]
    vertices=[]
    for layer in range(2):
        for z,width,y in profiles:
            for i in range(17):
                u=i/8-1
                vertices.append((x+width*u,y+.07*abs(u)**3-layer*.085,z))
    faces=[]
    for layer in range(2):
        for row in range(4):
            for col in range(16):
                k=layer*85+row*17+col
                face=(k,k+1,k+18,k+17)
                faces.append(face if layer==0 else tuple(reversed(face)))
    for row in range(4):
        for col in [0,16]:
            k=row*17+col;faces.append((k,k+17,k+102,k+85))
    for col in range(16):
        faces.extend([(col,col+85,col+86,col+1),(68+col,69+col,154+col,153+col)])
    return mesh(name,vertices,faces,seat,parent)


# Monotone Hermite station interpolation avoids exaggerated dome bulges.
stations = [(-.84,.41,.20,.43),(-.66,.53,.70,.32),(-.3,.61,.94,.27),
            (.18,.637,.94,.25),(.64,.621,.80,.27),(1.04,.55,.57,.32),
            (1.38,.43,.25,.40),(1.62,.31,.02,.45)]


def interp(y, k):
    xs, vs = [a[0] for a in stations], [a[k] for a in stations]
    h = [xs[i+1]-xs[i] for i in range(len(xs)-1)]
    d = [(vs[i+1]-vs[i])/h[i] for i in range(len(h))]
    slopes = [d[0]]
    for i in range(1,len(xs)-1):
        if d[i-1]*d[i] <= 0: slopes.append(0)
        else:
            w1, w2 = 2*h[i]+h[i-1], h[i]+2*h[i-1]
            slopes.append((w1+w2)/(w1/d[i-1]+w2/d[i]))
    slopes.append(d[-1])
    i = next((i for i in range(len(xs)-1) if y<=xs[i+1]),len(xs)-2)
    t = max(0,min(1,(y-xs[i])/h[i]))
    return ((2*t**3-3*t*t+1)*vs[i]+(t**3-2*t*t+t)*h[i]*slopes[i]
            +(-2*t**3+3*t*t)*vs[i+1]+(t**3-t*t)*h[i]*slopes[i+1])


body = bpy.data.objects['Fuselage • Paint']
body.data.calc_loop_triangles()
body_surface = BVHTree.FromPolygons(
    [body.matrix_world@v.co for v in body.data.vertices],
    [t.vertices for t in body.data.loop_triangles], all_triangles=True)
Y_REAR, Y_FRONT = -.831, 1.617


def raw_point(y, angle):
    return Vector((interp(y,1)*math.cos(angle),y,
                   interp(y,3)+interp(y,2)*math.sin(angle)))


def seated_edge(p):
    # The preserved fuselage includes its manufactured cabin shoulders.
    # Seat the glazing on that actual skin instead of a second guessed sill.
    if p.y>1.38:
        location, normal, _, _ = body_surface.ray_cast(Vector((p.x,p.y,2)),Vector((0,0,-1)),3)
        distance = (location-p).length if location else math.inf
    else:
        location, normal, _, distance = body_surface.find_nearest(p)
    if distance > .15:
        raise RuntimeError('Canopy mounting edge misses body: '+str(tuple(p)))
    return location+normal*.002


def point(y, angle, offset=0):
    p = raw_point(y, angle)
    # Conform all four boundary edges; fade the correction into the glazing.
    end = max(0, min(1, 1-min(y-Y_REAR, Y_FRONT-y)/.13))
    end = end*end*(3-2*end)
    side = abs(math.cos(angle))**12
    side_angle = 0 if math.cos(angle)>=0 else math.pi
    edge = raw_point(y, side_angle)
    p += (seated_edge(edge)-edge)*side
    if end:
        end_y = Y_REAR if y-Y_REAR < Y_FRONT-y else Y_FRONT
        edge = raw_point(end_y, angle)
        corner = raw_point(end_y, side_angle)
        # Subtract the common corner correction: continuous at each junction.
        p += ((seated_edge(edge)-edge)
              -(seated_edge(corner)-corner)*side)*end
    if y>1.38 and end<.999 and side<.999:
        # The convex foredeck must remain beneath the bonded windshield.
        skin, _, _, _ = body_surface.ray_cast(Vector((p.x,p.y,2)),Vector((0,0,-1)),3)
        if skin and skin.z>0:p.z=max(p.z,skin.z+.004)
    p += Vector((math.cos(angle),0,math.sin(angle)))*offset
    return tuple(p)


def patch(name, y0, y1, a0, a1, mat, parent):
    n, m = 32, 24
    vertices = [point(y0+(y1-y0)*i/n,a0+(a1-a0)*j/m) for i in range(n+1) for j in range(m+1)]
    faces = [(i*(m+1)+j,i*(m+1)+j+1,(i+1)*(m+1)+j+1,(i+1)*(m+1)+j)
             for i in range(n) for j in range(m)]
    o = mesh(name, vertices, faces, mat, parent)
    if mat == glass:
        o['transparent_cockpit'] = True
        o['glazing_grid_rows'] = n
        o['glazing_grid_cols'] = m
    return o


# One complete rear-hinged canopy, sealed to a fixed structural sill.
patch('Glass_Windshield',.70,Y_FRONT,0,math.pi,glass,canopy)
for s, side in [(-1,'Left'),(1,'Right')]:
    a0,a1 = (0,math.pi/2-.07) if s==1 else (math.pi/2+.07,math.pi)
    patch('Glass_Cabin_'+side,Y_REAR,.68,a0,a1,glass,canopy)


def perimeter(inset=0):
    lo, hi = Y_REAR+inset, Y_FRONT-inset
    a = inset*2
    return ([point(lo+(hi-lo)*i/64,a) for i in range(64)]
            +[point(hi,a+(math.pi-2*a)*i/48) for i in range(48)]
            +[point(hi-(hi-lo)*i/64,math.pi-a) for i in range(64)]
            +[point(lo,math.pi-a-(math.pi-2*a)*i/48) for i in range(48)])


# A single closed, formed surround, with no capped rods on the nose.
outer, inner = perimeter(), perimeter(.022)
n = len(outer)
surround = mesh('Canopy flush perimeter',outer+inner,
    [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],shell_trim,canopy)
skin = surround.modifiers.new('Bonded surround thickness','SOLIDIFY')
skin.thickness = .004
skin.offset = -1
surround['closed_perimeter'] = True
surround['mounting_edge_blender_m'] = outer
seal_points = [tuple(Vector(p)-body_surface.find_nearest(Vector(p))[1]*.001) for p in outer]
seal = tube('Recessed continuous canopy seal',seal_points,.0015,rubber)
seal.data.splines[0].use_cyclic_u = True
seal.data.use_fill_caps = False
header = patch('Internal windshield header',.675,.705,0,math.pi,frame,canopy)
for v in header.data.vertices:
    # A formed band bonded beneath the acrylic, with no round exposed ends.
    angle = math.atan2((v.co.z-interp(v.co.y,3))/interp(v.co.y,2),v.co.x/interp(v.co.y,1))
    v.co -= Vector((math.cos(angle),0,math.sin(angle)))*.012
patch('Canopy roof spine',-.833,.69,math.pi/2-.07,math.pi/2+.07,frame,canopy)
tube('Canopy rear safety bow',[point(-.64,math.pi*i/64,-.07) for i in range(65)],.028,frame,canopy)
for s, side in [(-1,'Left'),(1,'Right')]:
    cylinder('Rear canopy hinge '+side,(s*.36-.035,-.87,.63),(s*.36+.035,-.87,.63),.024,metal)
    box('Hinge mounting foot '+side,(s*.36,-.87,.57),(.085,.11,.08),frame,bevel=.015)
    fixed, moving = Vector((s*.49,-.57,.28)), Vector((s*.5,-.30,.62))
    mid = fixed.lerp(moving,.64)
    cylinder('Canopy_ram_barrel_'+side,fixed,mid,.015,frame)
    cylinder('Canopy_ram_piston_'+side,mid,moving,.007,chrome)
    for p, parent in [(fixed,cockpit),(moving,canopy)]:
        box('Canopy strut clevis '+side,p,(.035,.045,.035),metal,parent,.006)
        cylinder('Canopy strut eye pin '+side,(p.x-.025,p.y,p.z),(p.x+.025,p.y,p.z),.008,chrome,parent)
    box('Canopy latch receiver '+side,(s*.57,.56,.28),(.045,.065,.035),metal,bevel=.008)
    tube('Canopy latch handle '+side,[(s*.55,.55,.32),(s*.49,.55,.32),(s*.49,.59,.32)],.009,frame,canopy)

# Fitted tub, footwells, seats, rails and restrained interior upholstery.
box('Cabin floor',(0,.20,-.24),(1.04,1.90,.085),rubber,bevel=.025)
for s, side in [(-1,'Left'),(1,'Right')]:
    x = s*.29
    box('Inner sidewall '+side,(s*.53,.04,.075),(.075,1.43,.35),seat,bevel=.025)
    box('Armrest '+side,(s*.49,-.02,.27),(.075,.46,.075),frame,bevel=.027)
    box('Side pocket '+side,(s*.485,-.29,-.005),(.026,.28,.12),rubber,bevel=.014)
    for dx in [-.13,.13]:
        box('Seat rail '+side,(x+dx,-.22,-.17),(.024,.59,.035),metal,bevel=.004)
    g = group('Seat_'+side,parent=cockpit)
    box('Seat pedestal '+side,(x,-.23,-.08),(.32,.42,.16),frame,g,.03)
    box('Seat cushion '+side,(x,-.20,.115),(.40,.52,.17),seat,g,.053)
    box('Seat cushion insert '+side,(x,-.16,.205),(.315,.40,.026),insert,g,.012)
    bucket_back('Contoured bucket back '+side,x,g)
    panel = box('Seat back insert '+side,(x,-.416,.49),(.315,.028,.41),insert,g,.017)
    panel.rotation_euler.x = math.radians(-9)
    for dx in [-.09,.09]:
        cylinder('Headrest support '+side,(x+dx,-.51,.72),(x+dx,-.51,.79),.007,metal,g)
    box('Headrest '+side,(x,-.515,.81),(.22,.125,.145),seat,g,.035)
    for dx in [-.155,.155]:
        tube('Seat perimeter stitching '+side,[(x+dx,-.406,.29),(x+dx,-.416,.50),(x+dx,-.447,.72)],.0016,stitch,g)
    for dx in [-.11,.11]:
        box('Harness shoulder strap '+side,(x+dx,-.392,.53),(.032,.009,.39),belt,g,.002)
    box('Harness lap strap '+side,(x,-.02,.217),(.35,.045,.011),belt,g,.003)
    box('Harness buckle '+side,(x,-.04,.235),(.045,.05,.012),metal,g,.003)
    # Datums allow a real pilot-eye camera and a checked seated head volume.
    g.location.y = .18
    eye = group('PilotEye_'+side,(x,-.03,.94),cockpit)
    eye['head_radius_m'] = .09
    eye['occupant_concept'] = 'Seated design envelope; not certified anthropometry'
    # Center sticks sit between the knees, ahead of the cushion edge.
    controls = group('ControlStick_'+side,(x,.38,-.10),cockpit)
    controls['pitch_radians'] = .20
    controls['roll_radians'] = .18
    box('Stick flexible boot '+side,(x,.38,-.10),(.10,.10,.095),rubber,controls,.025)
    tube('Control stick shaft '+side,[(x,.38,-.10),(x,.38,.13),(x,.42,.32)],.012,metal,controls)
    box('Control stick grip '+side,(x,.42,.38),(.037,.045,.12),rubber,controls,.016)
    cylinder('Stick push-to-talk '+side,(x,.395,.42),(x,.388,.42),.008,red,controls)
    for foot in [-1,1]:
        xx = x+foot*.11
        pedal = group('RudderPedal_'+side+'_'+str(foot),(xx,.93,-.10),cockpit)
        plate = box('Pedal face',(xx,.93,-.065),(.145,.045,.13),metal,pedal,.012)
        plate.rotation_euler.x = math.radians(15)
        for zz in [-.10,-.065,-.03]:
            tube('Pedal rubber tread',[(xx-.052,.902,zz),(xx+.052,.902,zz)],.004,rubber,pedal)
        cylinder('Pedal pivot',(xx-.08,.96,-.14),(xx+.08,.96,-.14),.009,frame,pedal)

panel = group('InstrumentPanel',parent=cockpit)
box('Instrument panel fascia',(0,.81,.415),(1.015,.048,.39),frame,panel,.045)
housing = group('DashboardHousing',parent=cockpit)
# Short low-profile coaming; its upper surface tapers into the windshield base.
profiles = [(.795,.505,.20,.63),(.86,.497,.21,.63),(1.04,.46,.23,.61),
            (1.23,.40,.25,.54),(1.42,.32,.29,.44),(1.54,.25,.32,.39)]
verts, faces = [], []
for yy,w,lo,hi in profiles:
    for j in range(48):
        a = math.tau*j/48
        verts.append((w*math.copysign(abs(math.cos(a))**.45,math.cos(a)),yy,
                      (hi+lo)/2+(hi-lo)/2*math.copysign(abs(math.sin(a))**.5,math.sin(a))))
for i in range(len(profiles)-1):
    for j in range(48):
        k=i*48+j; n=i*48+(j+1)%48
        faces.append((k,n,n+48,k+48))
faces.extend([tuple(reversed(range(48))),tuple((len(profiles)-1)*48+j for j in range(48))])
mesh('Low dashboard coaming',verts,faces,frame,housing)
tube('Glare shield padded edge',[(-.48+.96*i/40,.785,.625-.02*(abs(-.48+.96*i/40)/.48)**8) for i in range(41)],.012,rubber,housing)


def rectangle(name,x,z,w,h,mat,y=.781):
    return mesh(name,[(x-w/2,y,z-h/2),(x+w/2,y,z-h/2),(x+w/2,y,z+h/2),(x-w/2,y,z+h/2)],[(0,1,2,3)],mat,panel,False)


# Small displays, tactile knobs, standby instruments and labelled switch groups.
for x, kind in [(-.295,'PFD'),(.295,'MAP')]:
    box(kind+' display bezel',(x,.770,.455),(.292,.035,.234),rubber,panel,.013)
    rectangle(kind+' display',x,.46,.250,.183,screen,.750)
    if kind=='PFD':
        rectangle('Attitude sky',x,.505,.134,.080,sky,.748)
        rectangle('Attitude earth',x,.425,.134,.080,earth,.748)
        rectangle('Attitude horizon',x,.465,.134,.0025,ivory,.746)
        for i in range(-3,4):
            rectangle('Pitch ladder',x,.465+i*.015,.035 if i%2==0 else .019,.0013,ivory,.746)
        label('Airspeed tape','072',(x-.10,.744,.465),.017,cyan,panel)
        label('Altitude tape','1250',(x+.099,.744,.465),.013,cyan,panel)
        label('Heading','HDG  090',(x,.744,.39),.011,ivory,panel)
    else:
        rectangle('Moving map field',x,.46,.24,.17,green,.748)
        tube('Map coastline',[(x-.105,.746,.51),(x-.045,.746,.49),(x-.01,.746,.46),(x+.10,.746,.40)],.0019,cyan,panel)
        tube('Map route',[(x-.08,.744,.43),(x,.744,.46),(x+.07,.744,.50)],.0018,ivory,panel)
        label('Map title','PALM BAY',(x,.743,.535),.012,ivory,panel)
        label('Map distance','12.4 NM',(x,.743,.395),.011,ivory,panel)
    for dx in [-.116,.116]:
        cylinder('Avionics rotary knob',(x+dx,.756,.354),(x+dx,.736,.354),.011,rubber,panel)
    for i in range(5):
        box('Display softkey',(x-.077+i*.038,.751,.354),(.022,.013,.006),metal,panel,.0015)
    label('Display name',kind,(x,.744,.58),.010,ivory,panel)
box('Centre avionics stack',(0,.770,.425),(.12,.035,.28),rubber,panel,.007)
rectangle('Radio face',0,.5,.099,.065,screen,.748)
label('Radio frequency','118.700',(0,.745,.505),.012,cyan,panel)
label('Radio mode','COM 1',(0,.745,.48),.009,ivory,panel)
for z, title in [(.405,'ATT'),(.305,'RPM')]:
    cylinder('Standby '+title,(0,.755,z),(0,.736,z),.042,metal,panel,32)
    cylinder('Standby dial '+title,(0,.734,z),(0,.732,z),.036,screen,panel,32)
    for i in range(12):
        a=math.tau*i/12
        tube('Standby tick',[(.027*math.sin(a),.730,z+.027*math.cos(a)),(.032*math.sin(a),.730,z+.032*math.cos(a))],.0008,ivory,panel)
    tube('Standby needle',[(0,.729,z),(.021,.729,z+.016)],.0015,ivory,panel)
for x, title in [(-.38,'MASTER'),(-.28,'AVIONICS'),(-.18,'LIGHTS'),(.18,'PUMP'),(.28,'PITOT'),(.38,'FLAPS')]:
    # The washer intersects the fascia at Y=.786; the retaining nut and lever
    # form a continuous assembly instead of floating in front of the panel.
    cylinder('Switch mounting',(x,.789,.285),(x,.7845,.285),.0085,metal,panel,24)
    cylinder('Switch retaining nut',(x,.785,.285),(x,.781,.285),.0065,metal,panel,6)
    tube('Toggle switch',[(x,.782,.285),(x,.769,.295)],.0018,metal,panel)
    cylinder('Toggle grip',(x,.773,.292),(x,.768,.296),.0025,rubber,panel,12)
    label('Switch legend',title,(x,.7854,.316),.009,ivory,panel)
for s in [-1,1]:
    cylinder('Fresh air vent',(s*.457,.779,.445),(s*.457,.755,.445),.027,rubber,panel,24)
    for dx in [-.012,0,.012]:
        tube('Vent vane',[(s*.457+dx,.752,.429),(s*.457+dx,.752,.46)],.002,metal,panel)
label('Panel identity','FINCH  U-2',(0,.743,.595),.012,ivory,panel)

box('Centre console',(0,.34,-.045),(.13,.78,.35),frame,bevel=.025)
box('Throttle quadrant',(0,.40,.145),(.12,.29,.055),metal,bevel=.013)
for x, name, mat in [(-.035,'Throttle',frame),(.035,'Mixture',red)]:
    g = group(name,(x,.43,.16),cockpit)
    cylinder(name+' lever',(x,.43,.16),(x,.40,.32),.007,metal,g)
    box(name+' grip',(x,.40,.33),(.032,.046,.04),mat,g,.014)
    tube(name+' travel slot',[(x,.29,.178),(x,.50,.178)],.006,rubber)
label('Power legends','THR   MIX',(0,.275,.172),.008,ivory)
box('Trim wheel',(0,.14,.09),(.08,.07,.105),rubber,bevel=.024)
box('Console stowage',(0,-.02,.10),(.10,.19,.022),rubber,bevel=.01)

internal_systems = build_internal_systems(group, box, mesh, tube, cylinder, label,
    cockpit, body_surface, interp, frame, metal, rubber, ivory, red)

# Convert and apply modifiers without changing any of the preserved airframe.
for o in created:
    if o.type in {'CURVE','FONT'}:
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active=o
        bpy.ops.object.convert(target='MESH')
    if o.type=='MESH':
        bpy.context.view_layer.objects.active=o
        for mod in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=mod.name)
        bm=bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bm.to_mesh(o.data); bm.free()
bpy.context.view_layer.update()


def vertices(group):
    return [o.matrix_world@v.co for o in group.children_recursive if o.type=='MESH' for v in o.data.vertices]


clearance={}
for name in ['Seat_Left','Seat_Right','ControlStick_Left','ControlStick_Right','InstrumentPanel','DashboardHousing']:
    minimum=100
    for p in vertices(bpy.data.objects[name]):
        if -.83 <= p.y <= 1.62 and p.z>.25:
            roof=interp(p.y,3)+interp(p.y,2)*math.sqrt(max(0,1-(p.x/interp(p.y,1))**2))
            minimum=min(minimum,roof-p.z)
    clearance[name]=minimum
if min(clearance.values()) < .025:
    raise RuntimeError('Cabin geometry exceeds canopy clearance: '+str(clearance))
eyes=[]
for side in ['Left','Right']:
    p=bpy.data.objects['PilotEye_'+side].matrix_world.translation
    roof=interp(p.y,3)+interp(p.y,2)*math.sqrt(max(0,1-(p.x/interp(p.y,1))**2))
    eyes.append({'side':side,'eye_blender_m':list(p),'roof_to_head_m':roof-p.z-.09,
                 'panel_below_eye_m':p.z-.638})
    if roof-p.z-.09 < .025: raise RuntimeError('Pilot head envelope exceeds canopy')

# Sample actual mesh intersections through both signs of stick travel.
def bvh(objects, clear_glazing=False):
    vs,fs=[],[]
    for o in objects:
        if o.type!='MESH':continue
        offset=len(vs);vs.extend([o.matrix_world@v.co for v in o.data.vertices])
        for index,f in enumerate(o.data.polygons):
            if clear_glazing and o.name.startswith('Glass_'):
                rows,cols=o['glazing_grid_rows'],o['glazing_grid_cols']
                # Boundary cells contain the intended bonded sill/header contact.
                if index//cols in (0,rows-1) or index%cols in (0,cols-1):continue
            fs.append(tuple(offset+i for i in f.vertices))
    return BVHTree.FromPolygons(vs,fs)
obstacles=[]
for name in ['Seat_Left','Seat_Right','InstrumentPanel','DashboardHousing']:
    obstacles.extend(bpy.data.objects[name].children_recursive)
obstacles.extend([bpy.data.objects['Centre console'],bpy.data.objects['Throttle quadrant']])
obstacles.extend(bpy.data.objects['RearCabinBulkhead'].children_recursive)
fixed=bvh(obstacles);travel=[]
for side in ['Left','Right']:
    node=bpy.data.objects['ControlStick_'+side]
    for pitch in [-.20,0,.20]:
        for roll in [-.18,0,.18]:
            node.rotation_euler=(pitch,roll,0)
            bpy.context.view_layer.update()
            count=len(fixed.overlap(bvh(node.children_recursive)))
            travel.append({'side':side,'pitch_rad':pitch,'roll_rad':roll,'intersections':count})
    node.rotation_euler=(0,0,0)
if any(p['intersections'] for p in travel):
    raise RuntimeError('Control travel intersects cabin furniture: '+str(travel))
bpy.context.view_layer.update()
fixed_canopy=bvh(obstacles+[bpy.data.objects['Fuselage • Paint']])
canopy_travel=[]
for degrees in range(0,56,5):
    canopy.rotation_euler.x=math.radians(degrees)
    bpy.context.view_layer.update()
    count=len(fixed_canopy.overlap(bvh([o for o in canopy.children_recursive if o.name.startswith('Glass_')],clear_glazing=True)))
    if count:
        for fixed_part in obstacles+[body]:
            for moving_part in [o for o in canopy.children_recursive if o.name.startswith('Glass_')]:
                hits=bvh([fixed_part]).overlap(bvh([moving_part],clear_glazing=True))
                if hits:print('CANOPY_CONTACT',fixed_part.name,moving_part.name,hits,flush=True)
    canopy_travel.append({'opening_degrees':degrees,'glass_furniture_intersections':count})
canopy.rotation_euler.x=0
bpy.context.view_layer.update()
if any(p['glass_furniture_intersections'] for p in canopy_travel):
    raise RuntimeError('Opening glazing intersects fixed cabin: '+str(canopy_travel))

manifest={'revision':cockpit['revision'],'frame':'Blender metres X right +Y forward +Z up',
          'airframe_details':airframe_details,
          'internal_systems':internal_systems,
          'clearance_m':clearance,'pilot_eyes':eyes,'control_travel':travel,
          'canopy_travel':canopy_travel,
          'canopy_collision_scope':'Clear glazing versus furniture and fuselage; outer bonded boundary cell excluded',
          'canopy_hinge_blender_m':list(hinge),'canopy_opening_degrees':55,
          'scope':'Cockpit subtree replacement; preserved airframe and flight datums',
          'reference':'https://www.diamondaircraft.com/en/private-owners/da20-series/overview/'}
mounting_gaps = [body_surface.find_nearest(Vector(p))[3] for p in outer]
if max(mounting_gaps) > .003:
    raise RuntimeError('Canopy perimeter stands off body: '+str(max(mounting_gaps)))
manifest['canopy_mounting'] = {'closed_loop_samples':len(outer),
    'maximum_skin_gap_m':max(mounting_gaps),
    'frame':'Continuous formed porcelain surround; internal header; recessed seal'}
(OUT/'cockpit-validation.json').write_text(json.dumps(manifest,indent=2))

# Keep source parts editable; export a compact native hierarchy for runtime batching.
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'Finch-U2-cockpit.blend'))
# Compact only the new static details inside each native articulated parent.
# The saved Blender file retains individual editable parts and labels.
groups={}
for o in created:
    if o.type!='MESH' or o.name.startswith(('Glass_','Canopy_ram_')):continue
    key=(o.parent.name,o.data.materials[0].name)
    groups.setdefault(key,[]).append(o)
for (parent,mat),objects in groups.items():
    if len(objects)<2:continue
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.join()
    objects[0].name=parent+' • '+mat
bpy.ops.object.select_all(action='DESELECT')
for o in collection.objects:o.select_set(True)
bpy.context.view_layer.objects.active=bpy.data.objects['Finch_U2']
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/assets/finch-u2.glb'),export_format='GLB',
    use_selection=True,export_yup=True,export_apply=True,export_extras=True,
    export_cameras=False,export_lights=False,export_materials='EXPORT')
print('FINCH_COCKPIT_REBUILT',json.dumps(manifest),flush=True)
