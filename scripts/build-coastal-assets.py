"""Rebuild the coastal scenery kit inside Blender (execute through Blender MCP).
Scans: Poly Haven CC0. Architecture: LOC HABS HI-59 / HI-559 references.
Meters, Z up, front +Y. Geometry is consolidated per material on export.
"""
import bpy, math, os, json
from mathutils import Vector, Quaternion
BASE = os.environ.get('POCKET_FLIGHT_ROOT') or (os.path.dirname(os.path.dirname(os.path.abspath(__file__))) if '__file__' in globals() else bpy.path.abspath('//..'))
OUT = BASE + '/public/assets/scenery'
os.makedirs(OUT, exist_ok=True)

def material(name, color, roughness=.8, metallic=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1)
    p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=roughness
    p.inputs['Metallic'].default_value=metallic
    return m

def collection(name):
    c=bpy.data.collections.new(name); bpy.context.scene.collection.children.link(c)
    return c

def cube(c,name,loc,size,mat,rotation=None):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
    o=bpy.context.object; o.name=name; o.scale=size
    if rotation: o.rotation_euler=rotation
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    for old in list(o.users_collection): old.objects.unlink(o)
    c.objects.link(o); o.data.materials.append(mat)
    return o

def beam(c,name,a,b,width,mat):
    a,b=Vector(a),Vector(b); v=b-a
    o=cube(c,name,(a+b)/2,(width,width,v.length),mat)
    o.rotation_euler=v.to_track_quat('Z','Y').to_euler()
    return o

def cylinder(c,name,loc,radius,depth,mat,verts=12):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts,radius=radius,depth=depth,location=loc)
    o=bpy.context.object;o.name=name
    for old in list(o.users_collection): old.objects.unlink(o)
    c.objects.link(o);o.data.materials.append(mat)
    return o

def export(c,name):
    c.hide_viewport=False;c.hide_render=False
    bpy.ops.object.select_all(action='DESELECT')
    for o in c.objects:
        o.hide_set(False);o.select_set(True)
    bpy.context.view_layer.objects.active=next(iter(c.objects))
    bpy.ops.export_scene.gltf(filepath=f'{OUT}/{name}.glb',use_selection=True,export_apply=True,export_image_format='JPEG',export_jpeg_quality=85,export_vertex_color='ACTIVE',export_all_vertex_colors=False)
    print('EXPORTED',name,os.path.getsize(f'{OUT}/{name}.glb'))

def consolidate(c):
    # Keep editable component names in the source collection; export consolidated copies.
    out=collection(c.name+' runtime')
    groups={}
    for o in list(c.objects):
        if o.type!='MESH':continue
        copy=o.copy();copy.data=o.data.copy();out.objects.link(copy)
        groups.setdefault(copy.data.materials[0].name,[]).append(copy)
    for name,objs in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:o.select_set(True)
        bpy.context.view_layer.objects.active=objs[0]
        bpy.ops.object.join(); o=bpy.context.object; o.name=c.name+' '+name
        bpy.context.scene.cursor.location=(0,0,0)
        bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
        # Planar UVs on every component face; exported detail is geometric and vertex colored.
    c.hide_render=True;c.hide_viewport=True
    return out

def build_house():
    c=collection('Plantation cottage editable')
    wall=material('Painted sage timber',(.34,.43,.35))
    trim=material('Sun bleached trim',(.70,.69,.58))
    wood=material('Porch hardwood',(.22,.16,.105))
    metal=material('Oxidised corrugated iron',(.29,.32,.31),.65,.45)
    iron=material('Dark fittings',(.065,.073,.07),.45,.6)
    glass=material('Recessed window glass',(.075,.13,.145),.24,.25)
    stone=material('Concrete foundation piers',(.27,.28,.25))
    # Pier foundation and underfloor framing: 0.9m floor, 3m occupied wall height.
    for x in [-3.55,0,3.55]:
        for y in [-4.55,0,4.55,6.3]:
            cube(c,'Foundation pier',(x,y,-.45),(.45,.45,2.7),stone)
        cube(c,'Underfloor bearer',(x,.75,.66),(.18,12,.30),wood)
    cube(c,'Floor',(0,0,.88),(8,10,.2),wood)
    cube(c,'Wall shell',(0,0,2.48),(7.98,9.98,3),wall)
    # Individual boards and narrow cover battens on all four elevations.
    for side in [-1,1]:
        for i in range(26):
            x=-3.9+i*.30
            cube(c,'Front rear board seam',(x,side*5.01,2.48),(.024,.06,2.98),trim)
        for i in range(33):
            y=-4.8+i*.30
            cube(c,'Side cover batten',(side*4.01,y,2.48),(.06,.024,2.98),trim)
        cube(c,'Corner trim',(side*4.04,5.025,2.5),(.18,.12,3.14),trim)
        cube(c,'Corner trim',(side*4.04,-5.025,2.5),(.18,.12,3.14),trim)
        cube(c,'Eaves fascia',(side*4.47,0,4.05),(.14,11.2,.22),trim)
    # Gable roof with continuous folds, ridge cap, front and rear bargeboards.
    pitch=math.atan2(1.95,4.5)
    length=math.hypot(4.5,1.95)
    for side in [-1,1]:
        cube(c,'Roof sheet',(side*2.25,0,5.01),(length,11.2,.065),metal,(0,side*pitch,0))
        for j in range(47):
            y=-5.48+j*.235
            beam(c,'Corrugation seam',(side*.06,y,5.99),(side*4.5,y,4.07),.045,metal)
        for y in [-5.58,5.58]:
            beam(c,'Barge board',(0,y,6.03),(side*4.53,y,4.04),.16,trim)
    cube(c,'Ridge cap',(0,0,6.05),(.18,11.35,.09),metal)
    # Closed gables, using actual triangle surfaces.
    for y in [-5.0,5.0]:
        mesh=bpy.data.meshes.new('Gable triangle')
        mesh.from_pydata([(-4,y,3.96),(4,y,3.96),(0,y,5.72)],[],[(0,1,2)])
        o=bpy.data.objects.new('Timber gable',mesh);c.objects.link(o);mesh.materials.append(wall)
        for x in [-3,-2,-1,0,1,2,3]:
            height=1.76*(1-abs(x)/4)
            cube(c,'Gable batten',(x,y+(.04 if y>0 else -.04),3.96+height/2),(.035,.06,height),trim)
    # Window surrounds create actual recess/shadow, glazing, mullions, sill, shutter hinges.
    def window(cx,cy,side=False):
        w,h=1.35,1.5;z=2.75
        def part(name,u,v,d,s):
            if side: return cube(c,name,(cx+d,cy+u,z+v),(s[2],s[0],s[1]),s[3])
            return cube(c,name,(cx+u,cy+d*(1 if cy>0 else -1),z+v),(s[0],s[2],s[1]),s[3])
        # shell lies behind the dark recess; frames project ~14 cm, not floating overlays.
        part('Window recess',0,0,.035,(w+.10,h+.10,.07,iron))
        part('Glass pane',0,0,.08,(w,h,.035,glass))
        for u in [-w/2-.055,w/2+.055]:part('Window jamb',u,0,.14,(.11,h+.22,.17,trim))
        for v in [-h/2-.055,h/2+.055]:part('Window lintel sill',0,v,.14,(w+.22,.11,.20,trim))
        part('Window mullion',0,0,.115,(.055,h,.045,trim))
        part('Window transom',0,0,.12,(w,.055,.045,trim))
        for direction in [-1,1]:
            u=direction*(w/2+.4)
            part('Shutter',u,0,.12,(.48,h,.08,wall))
            for i in range(9):part('Shutter louvre',u,-.65+i*.16,.18,(.44,.035,.06,trim))
            for v in [-.55,.55]:part('Shutter hinge',u-direction*.19,v,.20,(.045,.10,.045,iron))
    for x in [-2.55,2.55]:window(x,5.02)
    for y in [-2.6,1.6]:window(4.02,y,True)
    for x in [-2.5,2.5]:window(x,-5.06)
    cube(c,'Door surround',(0,5.09,2.04),(1.16,.17,2.3),trim)
    cube(c,'Panelled timber door',(0,5.20,2.03),(.94,.06,2.10),wood)
    for z in [1.35,2.0,2.7]:cube(c,'Raised door panel',(0,5.245,z),(.72,.055,.45),wall)
    cube(c,'Door handle',(.34,5.29,2.01),(.035,.06,.16),iron)
    # Porch, rain shelter, posts, top and bottom rails, balusters, 5 stairs.
    for j in range(12):cube(c,'Deck plank',(0,5.20+j*.13,.91),(7.8,.122,.14),wood)
    for x in [-3.8,-1.2,1.2,3.8]:
        cube(c,'Porch post',(x,6.64,2.36),(.14,.14,3.00),trim)
        cube(c,'Post footing',(x,6.64,-.55),(.33,.33,2.95),stone)
    for a,b in [(-3.8,-1.2),(1.2,3.8)]:
        for z in [1.04,1.96]:cube(c,'Porch rail',((a+b)/2,6.64,z),(b-a,.09,.09),trim)
        for j in range(12):cube(c,'Baluster',(a+(b-a)*j/11,6.64,1.50),(.045,.045,.90),trim)
    for side in [-1,1]:
        for z in [1.04,1.96]:cube(c,'Side rail',(side*3.8,5.8,z),(.09,1.65,.09),trim)
        for j in range(8):cube(c,'Side baluster',(side*3.8,5.07+j*.22,1.5),(.045,.045,.9),trim)
    for j in range(5):
        cube(c,'Stair tread',(0,6.86+j*.29,.83-j*.18),(2.25,.30,.12),wood)
        for side in [-1,1]:cube(c,'Stair riser',(side*.9,6.86+j*.29,.44-j*.09),(.11,.30,.80-j*.18),wood)
    for side in [-1,1]:beam(c,'Stair handrail',(side*1.13,6.66,1.96),(side*1.13,8.08,1.04),.065,trim)
    cube(c,'Porch roof',(0,5.80,3.99),(8.35,1.8,.07),metal,(-.14,0,0))
    for j in range(32):cube(c,'Porch roof rib',(-4.02+j*.26,5.8,4.035),(.035,1.8,.035),metal,(-.14,0,0))
    # Gutters, downpipes, rain tank, modest utility fixtures.
    for side in [-1,1]:
        beam(c,'Gutter',(side*4.50,-5.5,4.02),(side*4.50,5.5,4.02),.11,metal)
        beam(c,'Downpipe',(side*4.47,-5.37,4),(side*4.47,-5.37,.12),.07,metal)
    cylinder(c,'Rainwater tank',(-4.9,-3.2,1.16),.61,2.35,metal,24)
    for z in [.18,.58,1.03,1.50,1.96,2.25]:
        bpy.ops.mesh.primitive_torus_add(major_segments=24,minor_segments=6,location=(-4.9,-3.2,z),major_radius=.60,minor_radius=.023)
        o=bpy.context.object;o.name='Tank seam'
        for old in list(o.users_collection):old.objects.unlink(o)
        c.objects.link(o);o.data.materials.append(metal)
    beam(c,'Tank inlet',(-4.5,-5.37,2.4),(-4.9,-3.2,2.4),.07,metal)
    for x in [-.8,.8]:cube(c,'Porch lamp',(x,5.24,3.40),(.12,.12,.18),iron)
    print('HOUSE editable components',len(c.objects))
    out=consolidate(c);export(out,'plantation-cottage')
    return out

def prepare_scans():
    result=[]
    # Every linked image path is made absolute before the source file is relocated.
    for i in bpy.data.images:
        if 'reference-scenery/' in i.filepath:
            i.filepath=BASE+'/assets/reference-scenery/'+i.filepath.split('reference-scenery/',1)[1]
            # Relative path starts //reference-scenery (normal case).
            i.reload()
    for source,near_ratio,far_ratio,name in [('island_tree_02_LOD1',.047,.006,'coastal-tree'),('coast_rocks_05_LOD3',.10,.015,'coastal-rock')]:
        original=bpy.data.objects.get(source)
        # Leaf group shader is converted to a glTF-compatible Principled material.
        if name=='coastal-tree':
            m=bpy.data.materials.get('island_tree_02_leaves')
            nodes=m.node_tree.nodes;links=m.node_tree.links
            output=next(n for n in nodes if n.type=='OUTPUT_MATERIAL')
            p=nodes.new('ShaderNodeBsdfPrincipled')
            p.inputs['Roughness'].default_value=.9
            tex={n.image.filepath:n for n in nodes if n.type=='TEX_IMAGE' and n.image}
            for path,node in tex.items():
                if 'leaves_diff' in path:links.new(node.outputs['Color'],p.inputs['Base Color'])
                if 'leaves_alpha' in path:links.new(node.outputs['Color'],p.inputs['Alpha'])
            links.new(p.outputs['BSDF'],output.inputs['Surface'])
            m.use_backface_culling=False
            # Exporter reads alpha clip threshold when supplied via extras / Blender material.
            if hasattr(m,'alpha_threshold'):m.alpha_threshold=.45
            print('leaf surface enums',[i.identifier for i in m.bl_rna.properties['surface_render_method'].enum_items] if 'surface_render_method' in m.bl_rna.properties else [])
            if 'surface_render_method' in m.bl_rna.properties:
                ids=[i.identifier for i in m.bl_rna.properties['surface_render_method'].enum_items]
                m.surface_render_method=next(i for i in ids if 'DITHER' in i)
        for lod,ratio in [('near',near_ratio),('far',far_ratio)]:
            c=collection(name+' '+lod);o=original.copy();o.data=original.data.copy();c.objects.link(o);o.name=name+' '+lod
            # Normalize origin: trunk/rock base touches Z=0; retain scanned natural shape.
            corners=[o.matrix_world@Vector(v) for v in o.bound_box]
            minz=min(v.z for v in corners);center=Vector(((min(v.x for v in corners)+max(v.x for v in corners))/2,(min(v.y for v in corners)+max(v.y for v in corners))/2,minz))
            o.location-=center
            bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
            mod=o.modifiers.new('Browser geometry budget','DECIMATE');mod.ratio=ratio
            bpy.ops.object.modifier_apply(modifier=mod.name)
            bpy.context.scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
            print(name,lod,'faces',len(o.data.polygons),'bounds',tuple(o.dimensions))
            export(c,name+'-'+lod);result.append(c)
        original.hide_render=True;original.hide_set(True)
    bpy.data.objects['coast_rocks_05_LOD2'].hide_render=True
    bpy.data.objects['coast_rocks_05_LOD2'].hide_set(True)
    return result

def build_tree_impostor():
    s=bpy.context.scene
    for c in s.collection.children:c.hide_render=True
    near=collection('Full canopy bake source')
    source=bpy.data.objects['island_tree_02_LOD1'];copy=source.copy();copy.data=source.data.copy();near.objects.link(copy);copy.hide_render=False;copy.hide_set(False)
    corners=[source.matrix_world@Vector(v) for v in source.bound_box]
    copy.location-=Vector(((min(v.x for v in corners)+max(v.x for v in corners))/2,(min(v.y for v in corners)+max(v.y for v in corners))/2,min(v.z for v in corners)))
    near.hide_render=False
    lights=collection('Asset preview lighting')
    light=bpy.data.lights.new('Softbox','AREA');light.energy=900;light.shape='DISK';light.size=5
    lo=bpy.data.objects.new('Softbox',light);lights.objects.link(lo);lo.location=(-3,-4,6)
    lo.rotation_euler=(Vector((0,0,1.5))-lo.location).to_track_quat('-Z','Y').to_euler()
    world=bpy.data.worlds.new('Coastal asset studio');world.use_nodes=True
    bg=next(n for n in world.node_tree.nodes if n.type=='BACKGROUND');bg.inputs['Color'].default_value=(.65,.72,.8,1);bg.inputs['Strength'].default_value=.65;s.world=world
    cam=bpy.data.cameras.new('Tree orthographic bake');co=bpy.data.objects.new('Tree orthographic bake',cam);lights.objects.link(co);cam.type='ORTHO';cam.ortho_scale=4.7;s.camera=co
    s.render.resolution_x=512;s.render.resolution_y=512;s.render.resolution_percentage=100
    s.render.film_transparent=True;s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGBA'
    old=bpy.data.collections.get('coastal-tree impostor')
    if old:
        for obj in list(old.objects):bpy.data.objects.remove(obj,do_unlink=True)
        bpy.data.collections.remove(old)
    cards=collection('coastal-tree impostor');cards.hide_render=True
    for i in range(2):
        angle=i*math.pi/2
        co.location=(math.sin(angle)*8,-math.cos(angle)*8,1.7)
        co.rotation_euler=(Vector((0,0,1.7))-co.location).to_track_quat('-Z','Y').to_euler()
        s.render.filepath=f'{OUT}/tree-impostor-{i}.png';bpy.ops.render.render(write_still=True)
        m=material('Scanned canopy silhouette '+str(i),(1,1,1),1)
        p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(s.render.filepath)
        m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color']);m.node_tree.links.new(tex.outputs['Alpha'],p.inputs['Alpha'])
        m.use_backface_culling=False
        valid=[j.identifier for j in m.bl_rna.properties['surface_render_method'].enum_items];m.surface_render_method=next(j for j in valid if 'DITHER' in j)
        verts=[(-2.35,0,-.65),(2.35,0,-.65),(2.35,0,4.05),(-2.35,0,4.05)]
        mesh=bpy.data.meshes.new('Tree silhouette plane');mesh.from_pydata(verts,[],[(0,1,2,3)]);mesh.uv_layers.new()
        for loop,uv in zip(mesh.uv_layers[0].data,[(0,0),(1,0),(1,1),(0,1)]):loop.uv=uv
        o=bpy.data.objects.new('Scanned tree silhouette '+str(i),mesh);cards.objects.link(o);o.rotation_euler.z=angle;mesh.materials.append(m)
    export(cards,'coastal-tree-far')
    cards.hide_render=True;cards.hide_viewport=True;near.hide_render=True;near.hide_viewport=True
    lights.hide_render=True;lights.hide_viewport=True
    s.render.film_transparent=False
    return cards

def build_hangar():
    c=collection('Coastal hangar editable')
    siding=material('Hangar galvanised siding',(.44,.47,.44),.65,.45)
    roof=material('Hangar salt worn roofing',(.28,.32,.30),.7,.5)
    steel=material('Hangar structural steel',(.12,.15,.14),.5,.6)
    cement=material('Hangar concrete sill',(.33,.34,.30))
    glass=material('Hangar clerestory',(.10,.17,.19),.22,.25)
    light=material('Hangar safety lamps',(.82,.71,.42),.4)
    cube(c,'Slab',(0,0,.12),(24.5,26.5,.24),cement)
    for x in [-12,12]:
        cube(c,'Side wall',(x,0,4.08),(.12,26,7.92),siding)
        for y in range(-13,14):cube(c,'Vertical sheet seam',(x+(.09 if x>0 else -.09),y,4.08),(.035,.07,7.8),roof)
    for y in [-13,13]:
        cube(c,'End wall',(0,y,4.08),(24,.12,7.92),siding)
        for x in range(-12,13):cube(c,'Vertical sheet seam',(x,y+.09,4.08),(.07,.035,7.8),roof)
    # Barrel roof and exposed curved trusses use the same physically continuous profile.
    pts=[(-12*math.cos(i*math.pi/24),8.04+3.2*math.sin(i*math.pi/24)) for i in range(25)]
    verts=[(x,y,z) for y in [-13.6,13.6] for x,z in pts]
    faces=[(i,i+1,i+26,i+25) for i in range(24)]
    me=bpy.data.meshes.new('Continuous curved roof');me.from_pydata(verts,[],faces);o=bpy.data.objects.new('Barrel roof',me);c.objects.link(o);me.materials.append(roof)
    for y in [-13.4,-10,-6,-2,2,6,10,13.4]:
        for i in range(24):beam(c,'Roof seam',(pts[i][0],y,pts[i][1]+.035),(pts[i+1][0],y,pts[i+1][1]+.035),.065,siding)
    for y in [-13,13]:
        for x in [-12,12]:cube(c,'Corner steel post',(x,y,4.1),(.2,.2,8),steel)
        # A continuous end cap closes the barrel profile without stepped gaps.
        me=bpy.data.meshes.new('Closed hangar end cap')
        face=tuple(range(len(pts)))
        if y>0:face=tuple(reversed(face))
        me.from_pydata([(x,y,z) for x,z in pts],[],[face])
        obj=bpy.data.objects.new('Closed hangar end cap',me);c.objects.link(obj);me.materials.append(siding)
    # Door on the apron-facing side, with corrugated panels, guides and latches.
    cube(c,'Sliding door recess',(-12.10,0,3.5),(.10,18,6.7),steel)
    for y in [-4.6,4.6]:
        cube(c,'Sliding door leaf',(-12.20,y,3.5),(.11,8.9,6.45),roof)
        for j in range(18):cube(c,'Door folds',(-12.29,y-4.2+j*.49,3.5),(.045,.045,6.3),siding)
        cube(c,'Door handle',(-12.36,y-(.4 if y>0 else -.4),2.1),(.07,.10,.45),steel)
    cube(c,'Door track',(-12.34,0,6.91),(.16,19,.18),steel)
    for y in [-10,10]:
        cube(c,'Safety light',(-12.35,y,7.4),(.16,.35,.18),light)
        cube(c,'Clerestory',(12.13,y,6.8),(.06,2.3,.85),glass)
    for x in [-12.3,12.3]:
        beam(c,'Eaves gutter',(x,-13.3,8),(x,13.3,8),.12,siding)
        beam(c,'Rain drain',(x,13.15,7.96),(x,13.15,.2),.095,siding)
    for y in [-8,8]:
        cube(c,'Vent hood',(12.30,y,2.9),(.28,1.2,1.25),steel)
        for z in [2.4,2.6,2.8,3,3.2,3.4]:cube(c,'Vent louvre',(12.49,y,z),(.07,1.06,.05),siding)
    out=consolidate(c);export(out,'coastal-hangar');return out

def build_basalt():
    import random
    rng=random.Random(117)
    c=collection('Fractured basalt outcrop')
    rock=material('Weathered basalt',(.19,.20,.17),1)
    # Irregular fracture blocks with horizontal strata, not spheres or decorative cones.
    verts=[];faces=[]
    for block in range(7):
        cx=rng.uniform(-2.6,2.6);cy=rng.uniform(-1.8,1.8)
        radius=rng.uniform(.9,1.7);height=rng.uniform(1.4,4.4);n=7
        start=len(verts);angles=[i*2*math.pi/n+rng.uniform(-.12,.12) for i in range(n)]
        for level in range(4):
            z=height*level/3-.35
            for angle in angles:
                rad=radius*(1-.08*level)*rng.uniform(.90,1.10)
                verts.append((cx+math.cos(angle)*rad+.12*level,cy+math.sin(angle)*rad,z+rng.uniform(-.12,.12)))
        for level in range(3):
            for i in range(n):a=start+level*n+i;b=start+level*n+(i+1)%n;faces.append((a,b,b+n,a+n))
        faces.append(tuple(start+3*n+i for i in range(n)))
    me=bpy.data.meshes.new('Basalt fracture planes');me.from_pydata(verts,[],faces);me.update()
    o=bpy.data.objects.new('Weathered basalt outcrop',me);c.objects.link(o);me.materials.append(rock)
    color=me.color_attributes.new(name='Weathering',type='FLOAT_COLOR',domain='CORNER')
    for polygon in me.polygons:
        t=rng.uniform(.72,1.16)
        for li in polygon.loop_indices:
            z=me.vertices[me.loops[li].vertex_index].co.z
            moss=max(0,min(.16,(z-2)*.05))
            color.data[li].color=(t+moss*.3,t+moss,t*.96,1)
    export(c,'basalt-outcrop');return c

def build_terrain():
    data=json.load(open(BASE+'/assets/island-heightfield.json'));n=data['segments'];size=data['size'];verts=[];faces=[]
    for z in range(n+1):
        for x in range(n+1):verts.append(((x/n-.5)*size,-(z/n-.5)*size,data['heights'][z*(n+1)+x]))
    for z in range(n):
        for x in range(n):
            a=z*(n+1)+x;b=a+n+1;c=a+1;d=b+1
            faces.extend([(a,b,c),(b,d,c)])
    me=bpy.data.meshes.new('Island collision matched terrain');me.from_pydata(verts,[],faces);me.update()
    c=collection('Palm Bay island terrain');o=bpy.data.objects.new('Palm Bay erosion and coastal shelves',me);c.objects.link(o)
    m=material('Island vertex ecology',(1,1,1),1);me.materials.append(m)
    attr=me.color_attributes.new(name='Ecology',type='FLOAT_COLOR',domain='CORNER')
    for p in me.polygons:
        p.use_smooth=True
        for li in p.loop_indices:
            v=me.vertices[me.loops[li].vertex_index];h=v.co.z
            beach=Vector((.65,.52,.30));grass=Vector((.06,.14,.035));forest=Vector((.02,.07,.026));stone=Vector((.08,.09,.075))
            t=max(0,min(1,(h-3)/4));col=beach.lerp(grass,t)
            if h>35:col=col.lerp(forest,min(.65,(h-35)/130))
            steep=1-abs(p.normal.z)
            col=col.lerp(stone,min(.85,max(0,(steep-.13)*2.4)))
            attr.data[li].color=(*col,1)
    node=m.node_tree.nodes.new('ShaderNodeVertexColor');node.layer_name='Ecology'
    p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');m.node_tree.links.new(node.outputs['Color'],p.inputs['Base Color'])
    export(c,'palm-bay-terrain');c.hide_viewport=True;c.hide_render=True
    return c

def weather_kit():
    import random
    rng=random.Random(212)
    for name in ['Plantation cottage editable runtime','Coastal hangar editable runtime','Fractured basalt outcrop']:
        c=bpy.data.collections[name];c.hide_render=False;c.hide_viewport=False
        for o in c.objects:
            me=o.data
            attr=me.color_attributes.get('Weathering') or me.color_attributes.new(name='Weathering',type='FLOAT_COLOR',domain='CORNER')
            for p in me.polygons:
                shade=rng.uniform(.84,1.03)
                for li in p.loop_indices:
                    v=me.vertices[me.loops[li].vertex_index].co
                    runoff=.07*(.5+.5*math.sin(v.x*3.7+v.y*2.1))
                    dirt=.11*max(0,1-v.z/1.8)
                    t=max(.6,shade-runoff-dirt)
                    attr.data[li].color=(t,t,t*.98,1)
            for m in me.materials:
                if not m:continue
                p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
                base=tuple(m.diffuse_color)
                n=m.node_tree.nodes.new('ShaderNodeVertexColor');n.layer_name='Weathering'
                mult=m.node_tree.nodes.new('ShaderNodeMixRGB');mult.blend_type='MULTIPLY';mult.inputs[0].default_value=1;mult.inputs[2].default_value=base

                for link in list(p.inputs['Base Color'].links):m.node_tree.links.remove(link)
                p.inputs['Base Color'].default_value=base
        export(c,{'Plantation cottage editable runtime':'plantation-cottage','Coastal hangar editable runtime':'coastal-hangar','Fractured basalt outcrop':'basalt-outcrop'}[name])

def preserve_canopy():
    import bmesh, random
    rng=random.Random(48)
    src=bpy.data.objects['island_tree_02_LOD1'];me=src.data
    parent=list(range(len(me.vertices)))
    def find(x):
        while parent[x]!=x:parent[x]=parent[parent[x]];x=parent[x]
        return x
    for p in me.polygons:
        if p.material_index==1:
            a=find(p.vertices[0])
            for v in p.vertices[1:]:parent[find(v)]=a
    ids={find(p.vertices[0]) for p in me.polygons if p.material_index==1}
    keep={i for i in sorted(ids) if rng.random()<.22}
    old=bpy.data.collections['coastal-tree near']
    for o in list(old.objects):bpy.data.objects.remove(o,do_unlink=True)
    old.hide_viewport=False;old.hide_render=False
    parts=[]
    for material_index,ratio in [(0,.20),(1,.42),(2,.10)]:
        o=src.copy();o.data=src.data.copy();old.objects.link(o);o.name='Scanned tree '+['trunk','preserved leaves','branches'][material_index]
        bm=bmesh.new();bm.from_mesh(o.data)
        for f in list(bm.faces):
            if f.material_index!=material_index or (material_index==1 and find(f.verts[0].index) not in keep):bm.faces.remove(f)
        bmesh.ops.delete(bm,geom=[v for v in bm.verts if not v.link_faces],context='VERTS')
        bm.to_mesh(o.data);bm.free()
        bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
        mod=o.modifiers.new('Preserve material silhouettes','DECIMATE');mod.ratio=ratio;bpy.ops.object.modifier_apply(modifier=mod.name)
        corners=[src.matrix_world@Vector(v) for v in src.bound_box]
        center=Vector(((min(v.x for v in corners)+max(v.x for v in corners))/2,(min(v.y for v in corners)+max(v.y for v in corners))/2,min(v.z for v in corners)))
        o.location-=center
        bpy.context.scene.cursor.location=(0,0,0);bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
        parts.append(o)
        print(o.name,len(o.data.polygons))
    for o in parts:o.select_set(True)
    bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();bpy.context.object.name='coastal-tree near'
    export(old,'coastal-tree-near')

def rebuild_assets():
    """Rebuild only this kit's generated collections, retaining the GUI draft and other scene content."""
    owned=['Plantation cottage editable','Plantation cottage editable runtime','Coastal hangar editable','Coastal hangar editable runtime','Fractured basalt outcrop','Palm Bay island terrain','coastal-tree near','coastal-tree far','coastal-tree impostor','coastal-rock near','coastal-rock far','Asset preview lighting','Full canopy bake source']
    for c in list(bpy.data.collections):
        if any(c.name==name or c.name.startswith(name+'.') for name in owned):
            for obj in list(c.objects):bpy.data.objects.remove(obj,do_unlink=True)
            bpy.data.collections.remove(c)
    for asset,names in [('island_tree_02',['island_tree_02_LOD1']),('coast_rocks_05',['coast_rocks_05_LOD2','coast_rocks_05_LOD3'])]:
        missing=[name for name in names if not bpy.data.objects.get(name)]
        if missing:
            with bpy.data.libraries.load(f'{BASE}/assets/reference-scenery/{asset}/{asset}.blend',link=False) as (src,dst):dst.objects=missing
            for o in dst.objects:bpy.context.scene.collection.objects.link(o)
    build_house();build_hangar();build_basalt();prepare_scans();preserve_canopy();build_tree_impostor();weather_kit();build_terrain()
    for c in bpy.context.scene.collection.children:c.hide_viewport=True
    bpy.data.collections['Plantation cottage editable runtime'].hide_viewport=False
    bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=BASE+'/assets/palm-bay-coastal-kit.blend',compress=True)
    print('Coastal scenery kit rebuilt, exported and saved.')
