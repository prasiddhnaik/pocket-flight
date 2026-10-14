"""Replace Finch's floating cowling ornaments with surface-fitted details.

Concept geometry, using the DA20's smooth composite construction as reference.
Blender metres: X right, Y forward, Z up. Never alters wing or gear geometry.
"""
import bpy, bmesh, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def surface(obj):
    obj.data.calc_loop_triangles()
    return BVHTree.FromPolygons([obj.matrix_world@v.co for v in obj.data.vertices],
        [t.vertices for t in obj.data.loop_triangles], all_triangles=True)


def strip_components(obj, predicate):
    bm = bmesh.new(); bm.from_mesh(obj.data)
    remaining = set(bm.verts); removed = []
    while remaining:
        group = {remaining.pop()}; pending = list(group)
        while pending:
            for edge in pending.pop().link_edges:
                for vertex in edge.verts:
                    if vertex in remaining:
                        remaining.remove(vertex); group.add(vertex); pending.append(vertex)
        points = [obj.matrix_world@v.co for v in group]
        lo = Vector(tuple(min(p[k] for p in points) for k in range(3)))
        hi = Vector(tuple(max(p[k] for p in points) for k in range(3)))
        if predicate(lo, hi): removed.extend(group)
    bmesh.ops.delete(bm, geom=removed, context='VERTS')
    bm.to_mesh(obj.data); bm.free()
    return len(removed)


def fit_airframe_details():
    bpy.context.view_layer.update()
    objects = bpy.data.objects
    # Connected components are selected by measured bounds, not mesh indices.
    slat = lambda lo,hi: lo.y>1.8 and hi.y<2.4 and lo.z>-.09 and hi.z<.12 and hi.x-lo.x<.07
    text = lambda lo,hi: lo.y>2.3 and hi.y<2.49 and lo.z>-.19 and hi.z<-.15
    pipe = lambda lo,hi: lo.y>2 and hi.y<2.4 and lo.z<-.5 and hi.z<-.2 and hi.x-lo.x>.1
    cap = lambda lo,hi: lo.y>1.99 and hi.y<2.05 and hi.z<-.45
    removed = {}
    for name,predicate in [
        ('Fuselage • Paint', slat),
        ('Fuselage • Frame', lambda lo,hi: slat(lo,hi) or text(lo,hi) or cap(lo,hi)),
        ('Fuselage • Hardware', pipe),
        ('Fuselage • Seals', lambda lo,hi: (lo.y>2 and hi.y<2.8) or (hi.y< -1.5 and hi.y-lo.y<.01)),
    ]:
        removed[name] = strip_components(objects[name], predicate)
    if any(count==0 for count in removed.values()):
        raise RuntimeError('Missing expected obsolete Finch details: '+str(removed))
    body = surface(objects['Fuselage • Paint'])
    collection = objects['Fuselage • Paint'].users_collection[0]
    parent = objects['Fuselage']
    graphite = objects['Fuselage • Frame'].data.materials[0].copy()
    graphite.name = 'Finch • recessed cooling slots'
    shader = graphite.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (.015,.021,.025,1)
    shader.inputs['Metallic'].default_value = 0
    shader.inputs['Roughness'].default_value = .8
    steel = objects['Fuselage • Hardware'].data.materials[0].copy()
    steel.name = 'Finch • brushed exhaust stainless'
    shader = steel.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Metallic'].default_value = .72
    shader.inputs['Roughness'].default_value = .48

    def mesh(name, vs, fs, mat):
        data=bpy.data.meshes.new(name); data.from_pydata(vs,[],fs); data.update()
        obj=bpy.data.objects.new(name,data); collection.objects.link(obj)
        obj.data.materials.append(mat); obj.parent=parent
        obj.matrix_world.identity()
        for p in data.polygons: p.use_smooth=True
        return obj

    def skin_point(sign, y, z, gap):
        hit,normal,_,_=body.ray_cast(Vector((sign*3,y,z)),Vector((-sign,0,0)))
        if hit is None: raise RuntimeError('Cooling slot outside cowling')
        if normal.x*sign<0: normal.negate()
        return hit+normal*gap

    gaps=[]
    for sign,side in [(-1,'Left'),(1,'Right')]:
        vs=[]; fs=[]
        for y in [1.94,2.033,2.126,2.219,2.312]:
            start=len(vs)
            # Dense rows prevent a large flat face cutting through curved skin.
            for row in range(25):
                dz=-.0649+.1298*row/24
                cap=max(0,abs(dz)-.049)
                half=math.sqrt(.016**2-cap**2)
                for col in range(5):
                    p=skin_point(sign,y+half*(col/2-1),.009+dz,.0006)
                    gaps.append(body.find_nearest(p)[3]); vs.append(p)
            for row in range(24):
                for col in range(4):
                    a=start+row*5+col
                    face=(a,a+1,a+6,a+5)
                    fs.append(face if sign>0 else tuple(reversed(face)))
        obj=mesh('Cowling cooling slots '+side,vs,fs,graphite)
        obj['detail_type']='Skin-fitted cooling outlet visualization'
        obj['skin_offset_m']=.0006

    # A short 52 mm tube with a visible 46 mm bore, without a solid end cap.
    mount,normal,_,_=body.ray_cast(Vector((.29,2.44,-2)),Vector((0,0,1)))
    if mount is None: raise RuntimeError('Exhaust mounting outside belly')
    centers=[mount+Vector((.005*t,-.025*t,.01-.095*t)) for t in [i/12 for i in range(13)]]
    tangent=(centers[-1]-centers[0]).normalized()
    u=tangent.cross(Vector((0,1,0))).normalized(); v=tangent.cross(u).normalized()
    vs=[]; fs=[]; rings=32
    for center in centers:
        for radius in [.026,.023]:
            for j in range(rings):
                a=math.tau*j/rings
                vs.append(center+(u*math.cos(a)+v*math.sin(a))*radius)
    for i in range(len(centers)-1):
        for j in range(rings):
            n=(j+1)%rings; a=i*64; b=(i+1)*64
            fs.extend([(a+j,a+n,b+n,b+j),(a+32+n,a+32+j,b+32+j,b+32+n)])
    for i in [0,len(centers)-1]:
        a=i*64
        for j in range(rings): fs.append((a+j,a+(j+1)%rings,a+32+(j+1)%rings,a+32+j))
    obj=mesh('Finch short hollow exhaust',vs,fs,steel)
    bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free()
    obj['outer_diameter_m']=.052;obj['bore_diameter_m']=.046
    obj['exposed_length_m']=(centers[-1]-mount).length
    obj['outlet_center_blender_m']=list(centers[-1])
    obj['outlet_direction_blender']=list(tangent)
    obj['reference']='DA20 smooth composite finish and stainless exhaust; concept dimensions'
    return {'removed_vertices':removed,'cooling_slots':10,'cooling_skin_gap_m':max(gaps),
        'exhaust_outer_diameter_m':.052,'exhaust_bore_diameter_m':.046,
        'exhaust_exposed_length_m':obj['exposed_length_m'],'decorative_tail_rings':0}
