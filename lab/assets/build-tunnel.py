"""Premium private aerodynamic chamber; rebuild in a factory-startup Blender process.
Runtime frame: metres, X right, Y up, Z downstream. Aircraft datums remain fixed.
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public'
OUT.mkdir(exist_ok=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def mat(name, color, metal=0, rough=.4, alpha=1, emission=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, alpha)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    for key, value in [('Base Color', (*color, alpha)), ('Metallic', metal), ('Roughness', rough), ('Alpha', alpha)]:
        p.inputs[key].default_value = value
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    if 'glass' in name.lower():
        p.inputs['IOR'].default_value = 1.48
        p.inputs['Coat Weight'].default_value = .55
        p.inputs['Coat Roughness'].default_value = .1
    return m

ink = mat('Housing • satin graphite', (.015, .026, .033), .25, .5)
frame = mat('Portal • titanium graphite', (.11, .145, .16), .7, .26)
titanium = mat('Hardware • brushed titanium', (.32, .37, .39), .86, .24)
ceramic = mat('Ceramic • warm mineral', (.46, .47, .43), .18, .32)
deck = mat('Deck • dark precision panels', (.015, .025, .032), .14, .6)
recess = mat('Recess • matte carbon', (.009, .015, .019), .08, .72)
bronze = mat('Trim • champagne anodized', (.42, .29, .13), .78, .26)
glass = mat('Observation glass', (.15, .32, .35), .08, .1, .12)
light = mat('Light • opal architectural white', (.77, .88, .86), .05, .25, emission=2.4)
cyan = mat('Light • quiet instrument cyan', (.06, .48, .51), .18, .28, emission=1.3)
amber = mat('Light • amber status', (.7, .31, .065), .15, .3, emission=1.5)
white = mat('Markings • ivory', (.58, .64, .63), .05, .65)
screen = mat('Display • smoked black', (.01, .035, .043), .25, .2)


def xyz(p): return (p[0], -p[2], p[1])

def group(name, p=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.location = xyz(p)
    bpy.context.view_layer.update()
    return o

near_wall = group('Cutaway_NearWall')
roof = group('Cutaway_Roof')


def parent_to(o, parent):
    if parent:
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()
    return o


def finish(o, material, bevel=0, smooth=False):
    o.data.materials.append(material)
    if bevel:
        b = o.modifiers.new('Machined edge radius', 'BEVEL')
        b.width = bevel
        b.segments = 3
        o.modifiers.new('Weighted surface normals', 'WEIGHTED_NORMAL')
    if smooth:
        for f in o.data.polygons: f.use_smooth = True
    return o


def box(name, p, size, material, bevel=.035, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(p))
    o = bpy.context.object
    o.name = name
    o.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return parent_to(finish(o, material, bevel), parent)


def cylinder(name, p, radius, depth, material, axis='Y', parent=None, vertices=40):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=xyz(p))
    o = bpy.context.object
    o.name = name
    if axis == 'Z': o.rotation_euler.x = math.pi / 2
    if axis == 'X': o.rotation_euler.y = math.pi / 2
    return parent_to(finish(o, material, .014, True), parent)


def cone(name, p, bottom, top, depth, material):
    bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=bottom, radius2=top, depth=depth, location=xyz(p))
    o = bpy.context.object
    o.name = name
    return finish(o, material, .015, True)


def ring(name, p, radius, tube, material, axis='Z', parent=None):
    bpy.ops.mesh.primitive_torus_add(major_segments=80, minor_segments=10, major_radius=radius, minor_radius=tube, location=xyz(p))
    o = bpy.context.object
    o.name = name
    if axis == 'Z': o.rotation_euler.x = math.pi / 2
    if axis == 'X': o.rotation_euler.y = math.pi / 2
    return parent_to(finish(o, material, smooth=True), parent)


def mesh(name, vertices, faces, material, parent=None, bevel=0, smooth=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata([xyz(v) for v in vertices], [], faces)
    data.update()
    o = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(o)
    return parent_to(finish(o, material, bevel, smooth), parent)


def text(name, value, p, size=.18, rotation=(math.pi/2, 0, math.pi), material=white, parent=None):
    data = bpy.data.curves.new(name, 'FONT')
    data.body = value
    data.size = size
    data.extrude = .0008
    data.align_x = 'CENTER'
    data.space_character = 1.12
    o = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(o)
    o.location = xyz(p)
    o.rotation_euler = rotation
    data.materials.append(material)
    return parent_to(o, parent)


def outline(width, height, radius, center_y=6, steps=8):
    points = []
    for cx, cy, start in [(width/2-radius, height/2-radius, 0), (-width/2+radius, height/2-radius, 90),
                           (-width/2+radius, -height/2+radius, 180), (width/2-radius, -height/2+radius, 270)]:
        for i in range(steps):
            angle = math.radians(start + i * 90 / (steps-1))
            points.append((cx + radius * math.cos(angle), center_y + cy + radius * math.sin(angle)))
    return points


def portal(name, z, inner=(16, 12, .85), outer=(17.2, 13.2, 1.45), depth=.6, material=frame):
    a, b = outline(*inner, steps=16), outline(*outer, steps=16)
    n = len(a)
    vertices = [(x, y, plane) for plane in [z-depth/2, z+depth/2] for ring_points in [a,b] for x,y in ring_points]
    sections = {}
    for i in range(n):
        j = (i+1) % n
        x, y = (a[i][0]+a[j][0])/2, (a[i][1]+a[j][1])/2
        key = 'near' if x > 7.4 else 'roof' if y > 11.1 else 'fixed'
        sections.setdefault(key, set()).add(i)
    for key, indices in sections.items():
        faces = []
        for i in indices:
            j = (i+1) % n
            faces.extend([(i,n+i,n+j,j),(2*n+i,2*n+j,3*n+j,3*n+i),
                          (i,j,2*n+j,2*n+i),(n+i,3*n+i,3*n+j,n+j)])
            if (i-1)%n not in indices: faces.append((i,2*n+i,3*n+i,n+i))
            if j not in indices: faces.append((j,n+j,3*n+j,2*n+j))
        parent = near_wall if key == 'near' else roof if key == 'roof' else None
        mesh(name, vertices, faces, material, parent, .018)


def annulus(name, p, inner, outer, depth, material, parent=None):
    vertices = []
    for z in [-depth/2, depth/2]:
        for r in [inner, outer]:
            for i in range(80):
                a = math.tau * i / 80
                vertices.append((p[0]+r*math.cos(a), p[1]+r*math.sin(a), p[2]+z))
    faces = []
    for i in range(80):
        j = (i+1) % 80
        faces.extend([(i,j,80+j,80+i), (160+i,240+i,240+j,160+j),
                      (i,160+i,160+j,j), (80+i,80+j,240+j,240+i)])
    return mesh(name, vertices, faces, material, parent, .035, True)


# Substantial layered deck, recessed panel joints and flush light channels.
box('Foundation structural raft', (0,-.62,-1), (20.8,1.15,51), ink, .24)
box('Foundation titanium reveal', (0,-.13,-1), (20.2,.11,50.4), titanium, .035)
box('Continuous service deck', (0,-.06,0), (16.4,.16,29), recess, .07)
for x in [-6,-2,2,6]:
    for z in [-11.2,-5.6,0,5.6,11.2]:
        box('Precision deck cassette', (x,.015,z), (3.955,.075,5.555), deck, .018)
for side in [-1,1]:
    box('Perimeter service curb', (side*8.25,.1,0), (.44,.28,29), ink, .05)
    box('Flush light housing', (side*7.7,.065,0), (.21,.095,27.4), recess, .018)
    box('Deck opal guide', (side*7.7,.116,0), (.062,.016,27.1), light, .005)
    box('Anodized deck pinstripe', (side*7.48,.067,0), (.025,.022,27.1), bronze, .003)
    for z in [-11,-7,7,11]:
        box('Recessed service socket', (side*7.1,.067,z), (.33,.018,.43), ink, .025)
        cylinder('Socket machined core', (side*7.1,.085,z), .085,.015,titanium,vertices=24)

# Rounded portal frames: a distinct silhouette, machined reveals and bolted feet.
for z in [-14,-7,7,14]:
    portal('Structural portal', z)
    portal('Portal ceramic inset', z-.31, inner=(16.1,12.1,.92), outer=(16.83,12.83,1.27), depth=.055, material=ceramic)
    portal('Portal champagne reveal', z-.349, inner=(16.86,12.86,1.3), outer=(16.94,12.94,1.34), depth=.025, material=bronze)
    for side in [-1,1]:
        parent = near_wall if side > 0 else None
        box('Portal foundation shoe', (side*8.45,.13,z), (.92,.46,1.02), ink, .09, parent)
        for dz in [-.33,.33]:
            cylinder('Foundation exposed fastener', (side*8.72,.38,z+dz), .063,.055,titanium,parent=parent,vertices=16)
        box('Portal edge light', (side*7.98,6,z-.34), (.032,8.2,.025), light, .005,parent)

# Continuous observation bays, solid acoustic lower walls, and restrained detailing.
for side in [-1,1]:
    parent = near_wall if side > 0 else None
    for z, length in [(-10.5,6.3),(0,13.3),(10.5,6.3)]:
        box('Observation bay glass', (side*8.04,6.7,z), (.06,9.25,length), glass, .008,parent)
        box('Lower acoustic cladding', (side*8.17,1.15,z), (.24,2.2,length), ink, .05,parent)
        box('Wall brushed cap', (side*7.99,2.3,z), (.22,.12,length), titanium, .02,parent)
        box('Wall high-level cap', (side*8,11.37,z), (.20,.16,length), titanium, .018,parent)
        box('Wall champagne detail', (side*7.97,2.13,z), (.035,.028,length), bronze, .004,parent)
    for z in [-10.5,0,10.5]:
        for dz in [-1.2,-.9,-.6,-.3,0,.3,.6,.9,1.2]:
            box('Acoustic panel flute', (side*7.995,.92,z+dz), (.015,1.12,.018), titanium, .003,parent)
    box('Upper integrated light channel', (side*7.65,11.4,0), (.28,.22,27.1), ink, .035,parent)
    box('Upper opal task light', (side*7.63,11.27,0), (.16,.018,26.9), light, .006,parent)
for z in [-10.5,0,10.5]:
    box('Roof acoustic cassette', (0,12.26,z), (16,.34,6.4 if z else 13.4), ink, .08,roof)
for x in [-5.8,0,5.8]:
    box('Roof light recess', (x,12.06,0), (.3,.08,27), recess, .015,roof)
    box('Roof opal line', (x,12.015,0), (.15,.022,26.8), light,.005,roof)

# Inlet: tapered, curved-corner collector with deep throat and inset straightener.
profiles = [outline(20-4*t*t*(3-2*t),14-2*t*t*(3-2*t),1.4-.55*t,steps=16) for t in [0,.2,.4,.6,.8,1]]
n = len(profiles[0])
vertices = [(x,y,-24+10*k/(len(profiles)-1)) for k, points in enumerate(profiles) for x,y in points]
sections = {}
for i in range(n):
    x = sum(points[i][0] for points in profiles)/len(profiles)
    y = sum(points[i][1] for points in profiles)/len(profiles)
    key = 'near' if x > 7 else 'roof' if y > 11.1 else 'fixed'
    sections.setdefault(key, []).append(i)
for key, indices in sections.items():
    faces = [(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(len(profiles)-1) for i in indices]
    parent = near_wall if key == 'near' else roof if key == 'roof' else None
    o = mesh('Collector formed shell',vertices,faces,ink,parent,smooth=True)
    solid=o.modifiers.new('Collector skin','SOLIDIFY');solid.thickness=.16
portal('Collector intake lip',-24,inner=(20,14,1.4),outer=(21.1,15.1,1.9),depth=.5,material=frame)
box('Inlet deck', (0,.01,-19), (18,.16,10), deck,.05)
for x in range(-7,8): box('Straightener vertical',(x,6,-15.1),(.022,10.8,.18),frame,0)
for y in range(1,12): box('Straightener horizontal',(0,y,-15.1),(15.6,.022,.18),frame,0)
text('Collector identifier','PALM BAY  /  AERODYNAMICS',(0,12.56,-24.29),.3)

# Sculpted extraction pod with deep barrel, concentric machined lips and swept blades.
box('Diffuser deck',(0,.01,17),(16,.16,6),deck,.05)
for side in [-1,1]:
    box('Diffuser acoustic flank',(side*8.1,5.8,17),(.32,11.6,6),ink,.09,near_wall if side>0 else None)
annulus('Extraction outer nacelle',(0,6,20),5.42,6.05,2.15,ink)
annulus('Nacelle ceramic bezel',(0,6,18.9),5.42,5.99,.24,ceramic)
annulus('Brushed inlet lip',(0,6,18.75),5.24,5.48,.16,titanium)
ring('Nacelle champagne ring',(0,6,18.78),5.78,.025,bronze)
ring('Nacelle luminous reveal',(0,6,18.9),5.51,.022,light)
annulus('Inner duct acoustic liner',(0,6,20),5.1,5.25,2.5,frame)
for side in [-1,1]:
    box('Extractor structural pylon',(side*6.15,2.8,20),(.76,5.6,1.65),frame,.13)
    box('Extractor isolated mount',(side*6.15,.28,20),(1.35,.56,2.5),ink,.12)
box('Extractor foundation bridge',(0,.4,20),(13.7,.8,2.9),ink,.14)
rotor=group('Fan_Rotor',(0,6,20))
cylinder('Fan machined hub',(0,6,20),.68,1.05,titanium,'Z',rotor)
cylinder('Fan black nose',(0,6,19.46),.49,.18,ink,'Z',rotor)
ring('Fan hub trim',(0,6,19.35),.45,.025,bronze,parent=rotor)
for blade in range(9):
    vertices=[]
    for radial in range(13):
        t=radial/12;radius=.67+4.38*t;center=math.tau*blade/9+.30*t*t
        for edge in range(5):
            u=edge/4-.5;angle=center+u*(.7-.37*t)
            depth=20+.3*u*(1-t*.4)+.14*math.sin(math.pi*t)
            vertices.append((radius*math.cos(angle),6+radius*math.sin(angle),depth))
    faces=[(r*5+c,r*5+c+1,(r+1)*5+c+1,(r+1)*5+c) for r in range(12) for c in range(4)]
    o=mesh('Swept extraction blade',vertices,faces,titanium,rotor,smooth=True)
    solid=o.modifiers.new('Blade formed skin','SOLIDIFY');solid.thickness=.045
for radius in [1.6,3.3,5.05]: ring('Front safety guard',(0,6,18.62),radius,.024,frame)
for i in range(8):
    angle=math.tau*i/8
    v=[(.75*math.cos(angle),6+.75*math.sin(angle),18.62),(5.15*math.cos(angle+.035),6+5.15*math.sin(angle+.035),18.62)]
    a,b=Vector(xyz(v[0])),Vector(xyz(v[1]));direction=b-a
    o=cylinder('Safety guard radial',tuple((v[0][k]+v[1][k])/2 for k in range(3)),.025,direction.length,frame)
    o.rotation_euler=direction.to_track_quat('Z','Y').to_euler()
text('Extractor marking','EXTRACTION  /  09',(0,11.72,18.61),.2)

# The fixed test datum is retained; supporting hardware gains real depth and finish.
box('Balance isolated foot',(0,.16,0),(2.8,.32,3.1),recess,.12)
box('Balance lower titanium reveal',(0,.36,0),(2.6,.10,2.9),titanium,.06)
box('Balance sculpted plinth',(0,.77,0),(2.45,.74,2.65),ink,.18)
box('Balance upper crown',(0,1.15,0),(1.65,.16,1.8),frame,.07)
box('Balance anodized reveal',(0,1.245,0),(1.37,.035,1.55),bronze,.02)
cone('Tapered instrument pylon',(0,2.67,0),.29,.16,2.83,titanium)
box('Pylon rear cable channel',(0,2.69,.24),(.18,2.8,.11),ink,.035)
box('Pylon instrument status',(0,2.65,-.245),(.07,1.45,.015),cyan,.008)
cylinder('Pylon top collar',(0,4.12,0),.25,.25,frame)
box('Machined balance crosshead',(0,4.3,0),(1.95,.22,.52),titanium,.05)
for side in [-1,1]:
    box('Bearing clevis',(side*.82,4.74,0),(.18,.84,.38),frame,.04)
    ring('Pitch bearing outer race',(side*.82,5.25,0),.33,.064,titanium,'X')
    ring('Pitch bearing anodized seal',(side*.91,5.25,0),.26,.016,bronze,'X')
    cylinder('Crosshead fastener',(side*.7,4.43,0),.055,.06,ink,vertices=20)
rig=group('Pitch_Rig',(0,5.25,0))
for side in [-1,1]: cylinder('Pitch axle',(side*.82,5.25,0),.084,.22,ink,'X',rig)
box('Balance front instrument inset',(0,.77,-1.328),(1.25,.31,.017),screen,.025)
text('Balance instrument type','MULTI-AXIS  /  BALANCE',(0,.85,-1.35),.086)
text('Balance instrument status','LOCAL   -   READY',(0,.70,-1.351),.075,material=cyan)
for x in [-1.07,1.07]:
    for z in [-1.11,1.11]: cylinder('Balance mounting fastener',(x,1.135,z),.048,.035,titanium,vertices=16)

# Side console and unobtrusive technical markings give the room an authored identity.
box('Service console pedestal',(9.5,.72,-5),(1.75,1.4,2.8),ink,.16)
box('Console titanium plinth',(9.5,.065,-5),(2,.12,3),titanium,.05)
box('Service console worktop',(9.5,1.47,-5),(1.87,.16,2.86),ceramic,.06)
box('Console monitor surround',(8.55,2,-5),(.18,.85,1.65),frame,.06)
box('Console smoked display',(8.44,2,-5),(.018,.66,1.4),screen,.035)
for z in [-5.48,-5.1,-4.72]: box('Console graph bar',(8.42,2,z),(.018,.24,.09),cyan,.005)
for z in [-5.45,-4.95,-4.45]: cylinder('Console tactile dial',(8.42,1.49,z),.065,.065,bronze,'X',vertices=24)
for z, label in [(-10.5,'01   /   FLOW CONDITIONING'),(0,'02   /   TEST SECTION'),(10.5,'03   /   EXTRACTION')]:
    # Labels lie on the floor, inside the far service rail.
    text('Deck section marking',label,(-6.78,.066,z),.16,rotation=(0,0,math.pi/2))
text('Deck centreline marker','PALM BAY  /  PRIVATE TEST FACILITY',(-4.9,.067,-5.3),.18,rotation=(0,0,math.pi/2))

# Export geometry only. Complete architecture stays editable and can be shown in full.
for o in list(bpy.context.scene.objects):
    if o.type == 'FONT':
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True);bpy.context.view_layer.objects.active=o
        bpy.ops.object.convert(target='MESH')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(OUT/'tunnel.glb'),export_format='GLB',use_selection=True,
                          export_yup=True,export_apply=True,export_extras=True,export_cameras=False,export_lights=False)

# Review scene: authored model under soft architectural lighting.
def area(name,p,target,power,size,color):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);o.location=xyz(p)
    o.rotation_euler=(Vector(xyz(target))-o.location).to_track_quat('-Z','Y').to_euler()
area('Large front softbox',(9,16,-14),(0,4,0),5500,12,(.85,.94,1))
area('Warm architectural rim',(-10,10,9),(0,4,5),6500,10,(1,.82,.61))
area('Roof diffuse source',(0,18,-3),(0,0,0),6500,12,(.92,.98,1))
scene=bpy.context.scene
scene.world.use_nodes=True
scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.075,.095,.11,1)
scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.35
camera_data=bpy.data.cameras.new('Architecture review camera')
camera=bpy.data.objects.new('Architecture review camera',camera_data);bpy.context.collection.objects.link(camera)
camera.location=xyz((34,20,-38));camera.rotation_euler=(Vector(xyz((0,4,-.5)))-camera.location).to_track_quat('-Z','Y').to_euler()
camera_data.lens=34;scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_x=1600;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ROOT/'assets/tunnel-preview.png')
scene.view_settings.view_transform='AgX'
# Save the complete enclosure; render its inspection cutaway so the interior is legible.
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/tunnel.blend'))
for section in [near_wall, roof]:
    for o in section.children_recursive: o.hide_render=True
bpy.ops.render.render(write_still=True)
facts={'units':'metres','designVersion':'premium-chamber-2','runtimeAxes':'X right, Y up, Z downstream',
       'testSection':{'width':16,'height':12,'length':28},'aircraftPivot':[0,5.25,0],'fanPivot':[0,6,20],
       'meshObjects':sum(o.type=='MESH' for o in scene.objects),'cutawayGroups':['Cutaway_NearWall','Cutaway_Roof'],
       'note':'Concept chamber. Rounded-corner enclosure, structural portals and instrument hardware are visual; solver remains freestream and excludes walls/support interference.'}
(ROOT/'assets/tunnel-manifest.json').write_text(json.dumps(facts,indent=2))
print('TUNNEL_EXPORTED',json.dumps(facts))
