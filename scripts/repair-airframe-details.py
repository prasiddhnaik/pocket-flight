"""Repair decorative geometry in-place in GLBs; preserve the rig, skin and animations.

Run with background Blender for its geometry library. No Blender scene export is
used: only named detail primitives are replaced in the original glTF document.
"""
import json, math, struct, sys
from pathlib import Path
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/fleet-detail-before'
OUT.mkdir(parents=True, exist_ok=True)


class Asset:
    def __init__(self, path):
        self.path = path
        backup = OUT / path.name
        source = backup.read_bytes() if '--rebuild' in sys.argv and backup.exists() else path.read_bytes()
        length = struct.unpack_from('<I', source, 12)[0]
        self.doc = json.loads(source[20:20+length])
        self.binary = bytearray(source[28+length:])
        self.changed = []
        self.normals = {}
        self.world = {}
        def visit(index, parent):
            node = self.doc['nodes'][index]
            if 'matrix' in node:
                local = Matrix([node['matrix'][i:i+4] for i in range(0, 16, 4)]).transposed()
            else:
                q = node.get('rotation', [0, 0, 0, 1])
                local = Matrix.LocRotScale(Vector(node.get('translation', [0, 0, 0])), Quaternion((q[3], *q[:3])), Vector(node.get('scale', [1, 1, 1])))
            self.world[index] = parent @ local
            for child in node.get('children', []): visit(child, self.world[index])
        for scene in self.doc['scenes']:
            for index in scene['nodes']: visit(index, Matrix.Identity(4))

    def node(self, name):
        return next(i for i, n in enumerate(self.doc['nodes']) if n.get('name') == name)

    def array(self, index):
        a = self.doc['accessors'][index]
        view = self.doc['bufferViews'][a['bufferView']]
        count = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        form = {5126: 'f', 5125: 'I', 5123: 'H', 5121: 'B'}[a['componentType']] * count
        size = struct.calcsize('<'+form)
        start = view.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = view.get('byteStride', size)
        return [struct.unpack_from('<'+form, self.binary, start+i*stride) for i in range(a['count'])]

    def geometry(self, name):
        i = self.node(name)
        p = self.doc['meshes'][self.doc['nodes'][i]['mesh']]['primitives'][0]
        vertices = [self.world[i] @ Vector(v) for v in self.array(p['attributes']['POSITION'])]
        if 'NORMAL' in p['attributes']:
            transform = self.world[i].to_3x3().inverted().transposed()
            self.normals[name] = {tuple(round(c, 7) for c in v): (transform @ Vector(n)).normalized() for v, n in zip(vertices, self.array(p['attributes']['NORMAL']))}
        indices = [v[0] for v in self.array(p['indices'])]
        return vertices, [indices[i:i+3] for i in range(0, len(indices), 3)]

    def append(self, values, kind, integer=False):
        while len(self.binary) % 4: self.binary.append(0)
        start = len(self.binary)
        for value in values: self.binary.extend(struct.pack('<' + ('I' if integer else 'f') * len(value), *value))
        view = len(self.doc['bufferViews'])
        self.doc['bufferViews'].append({'buffer': 0, 'byteOffset': start, 'byteLength': len(self.binary)-start, 'target': 34963 if integer else 34962})
        a = {'bufferView': view, 'componentType': 5125 if integer else 5126, 'count': len(values), 'type': kind}
        if kind == 'VEC3':
            a['min'] = [min(p[i] for p in values) for i in range(3)]
            a['max'] = [max(p[i] for p in values) for i in range(3)]
        self.doc['accessors'].append(a)
        return len(self.doc['accessors'])-1

    def replace(self, name, triangles, detail):
        if not triangles: raise RuntimeError('Empty repair: '+name)
        i = self.node(name)
        mesh = self.doc['meshes'][self.doc['nodes'][i]['mesh']]
        assert len(mesh['primitives']) == 1
        inverse = self.world[i].inverted()
        vertices, normals = [], []
        for tri in triangles:
            normal = (tri[1]-tri[0]).cross(tri[2]-tri[0])
            center = sum(tri,Vector())/3
            if 'window' in detail or 'champagne' in detail:
                rx,rz,zc=body(-center.z)
                outward=Vector((center.x/max(rx*rx,.001),(center.y-zc)/max(rz*rz,.001),0))
                if normal.dot(outward)<0: tri=list(reversed(tri))
            elif 'Flush wing' in detail and normal.y<0:
                tri=list(reversed(tri))
            points = [inverse @ p for p in tri]
            n = (points[1]-points[0]).cross(points[2]-points[0]).normalized()
            vertices.extend([tuple(p) for p in points])
            for world_point in tri:
                original=self.normals.get(name,{}).get(tuple(round(c,7) for c in world_point))
                normals.append(tuple((self.world[i].to_3x3().transposed() @ original).normalized()) if original is not None else tuple(n))
        mesh['primitives'][0] = {
            'attributes': {'POSITION': self.append(vertices, 'VEC3'), 'NORMAL': self.append(normals, 'VEC3')},
            'indices': self.append([(i,) for i in range(len(vertices))], 'SCALAR', True),
            'material': mesh['primitives'][0]['material'],
        }
        self.doc['nodes'][i].setdefault('extras', {})['surface_detail'] = detail
        self.changed.append({'name': name, 'triangles': len(triangles), 'detail': detail})

    def write(self):
        self.doc['buffers'][0]['byteLength'] = len(self.binary)
        self.doc.setdefault('extras', {})['airframe_detail_revision'] = 1
        js = json.dumps(self.doc, separators=(',', ':')).encode()
        js += b' ' * (-len(js) % 4)
        self.binary.extend(b'\0' * (-len(self.binary) % 4))
        output = struct.pack('<III', 0x46546c67, 2, 28+len(js)+len(self.binary))
        output += struct.pack('<II', len(js), 0x4e4f534a) + js
        output += struct.pack('<II', len(self.binary), 0x004e4942) + self.binary
        backup = OUT / self.path.name
        if not backup.exists(): backup.write_bytes(self.path.read_bytes())
        self.path.write_bytes(output)
        return {'asset': self.path.name, 'changed': self.changed, 'animation_clips': len(self.doc.get('animations', []))}

    def orient_closed_airfoils(self):
        for i,node in enumerate(self.doc['nodes']):
            name=node.get('name','')
            if 'mesh' not in node or not name.startswith(('Wing_','Flap_','Aileron_','Tailplane','Elevator_','Rudder')): continue
            mesh=self.doc['meshes'][node['mesh']]
            if len(mesh['primitives'])!=1: continue
            p=mesh['primitives'][0]
            material=self.doc['materials'][p['material']].get('name','')
            if material not in ['Pearl | warm ceramic white','Atlantic blue lacquer']: continue
            vertices,faces=self.geometry(name)
            indices=[tuple(f) for f in faces]; normals=self.array(p['attributes']['NORMAL'])
            flipped=set(); count=0
            for fs in components(vertices,faces):
                ps=[vertices[v] for f in fs for v in f]
                center=sum(ps,Vector())/len(ps)
                volume=sum((vertices[a]-center).dot((vertices[b]-center).cross(vertices[c]-center))/6 for a,b,c in fs)
                if volume>=-1e-8: continue
                # Ignore open surfaces. Their signed volume cannot establish orientation.
                edges={}
                for face in fs:
                    keys=[tuple(round(c,6) for c in vertices[v]) for v in face]
                    if len(set(keys))<3: continue
                    for a,b in zip(keys,keys[1:]+keys[:1]):
                        key=tuple(sorted((a,b)));edges[key]=edges.get(key,0)+1
                if any(n!=2 for n in edges.values()):
                    raise RuntimeError('Airfoil is not closed: '+name)
                face_set={tuple(f) for f in fs}
                for j,f in enumerate(indices):
                    if f in face_set:
                        indices[j]=(f[0],f[2],f[1]);flipped.update(f)
                count+=1
            if count:
                p['indices']=self.append([(v,) for f in indices for v in f],'SCALAR',True)
                p['attributes']['NORMAL']=self.append([tuple(-v for v in n) if j in flipped else n for j,n in enumerate(normals)],'VEC3')
                node.setdefault('extras',{})['surface_orientation']='Outward closed airfoils'
                self.changed.append({'name':name,'detail':'Outward airfoil normals; original positions preserved','components_flipped':count})


def clip(poly, axis, bound, greater):
    result = []
    for a, b in zip(poly, poly[1:]+poly[:1]):
        inside_a = (a[axis] >= bound) if greater else (a[axis] <= bound)
        inside_b = (b[axis] >= bound) if greater else (b[axis] <= bound)
        if inside_a: result.append(a)
        if inside_a != inside_b:
            result.append(a.lerp(b, (bound-a[axis])/(b[axis]-a[axis])))
    return result


def fitted_joints(asset, skin, stations, side, width):
    vertices, faces = asset.geometry(skin)
    triangles = []
    for x, lead, chord, start, end in stations:
        for f in faces:
            poly = [vertices[i] for i in f]
            normal = (poly[1]-poly[0]).cross(poly[2]-poly[0]).normalized()
            if normal.y < .4: continue
            for axis, bound, greater in [(0, side*x-width/2, True), (0, side*x+width/2, False), (2, -lead+chord*start, True), (2, -lead+chord*end, False)]:
                poly = clip(poly, axis, bound, greater)
                if not poly: break
            poly = [v+normal*.0006 for v in poly]
            for j in range(1, len(poly)-1):
                if (poly[j]-poly[0]).cross(poly[j+1]-poly[0]).length > 1e-10:
                    triangles.append([poly[0], poly[j], poly[j+1]])
    return triangles


def tube_centers(asset, name):
    points, _ = asset.geometry(name)
    assert len(points) % 7 == 0, 'Unexpected tube section: '+name
    # Blender's six-sided poly bevel has one duplicated UV seam vertex per ring.
    return [sum(points[i+1:i+7], Vector())/6 for i in range(0, len(points), 7)]


def flange(points, width, depth, arch=False):
    triangles, sections = [], []
    for i, p in enumerate(points):
        tangent = (points[min(i+1, len(points)-1)]-points[max(0, i-1)]).normalized()
        if arch:
            across = Vector((0, 0, 1))
            normal = tangent.cross(across).normalized()
            if normal.y < 0: normal.negate()
        else:
            normal = Vector((0, 1, 0))
            across = normal.cross(tangent).normalized()
        sections.append([p+across*width/2+normal*.001, p-across*width/2+normal*.001,
                         p-across*width/2-normal*depth, p+across*width/2-normal*depth])
    for a, b in zip(sections, sections[1:]):
        for i in range(4):
            j = (i+1) % 4
            triangles.extend([[a[i], b[i], b[j]], [a[i], b[j], a[j]]])
    for section in [sections[0], list(reversed(sections[-1]))]:
        triangles.extend([[section[0], section[1], section[2]], [section[0], section[2], section[3]]])
    return triangles


# Aurelia's authored pressure-body stations, used to fit window and paint edges.
PROFILES = [(16.2,.015,.02,3.35),(15.2,.43,.36,3.42),(13.7,.95,.76,3.59),(12,1.45,1.27,3.74),(10,1.95,1.73,3.84),(7.3,2.25,1.94,3.88),(3,2.36,2.01,3.88),(-2,2.35,2.0,3.88),(-5.4,2.18,1.88,3.91),(-8,1.67,1.51,3.97),(-10.5,1.05,1.06,4.01),(-13,.45,.54,4.04),(-15.3,.035,.065,4.07)]


def body(y):
    for i, (b, c) in enumerate(zip(PROFILES, PROFILES[1:])):
        if c[0] <= y <= b[0]:
            t = (b[0]-y)/(b[0]-c[0]); a = PROFILES[max(0, i-1)]; d = PROFILES[min(len(PROFILES)-1, i+2)]
            return [.5*((2*b[j])+(-a[j]+c[j])*t+(2*a[j]-5*b[j]+4*c[j]-d[j])*t*t+(-a[j]+3*b[j]-3*c[j]+d[j])*t*t*t) for j in range(1, 4)]
    return PROFILES[0][1:] if y > 16.2 else PROFILES[-1][1:]


def skin(y, theta, side, offset=.0006):
    rx, rz, zc = body(y)
    return Vector((side*(rx+offset)*math.cos(theta), zc+(rz+offset)*math.sin(theta), -y))


def strip(rows, cyclic=False):
    result = []
    pairs = list(zip(rows, rows[1:]))
    if cyclic: pairs.append((rows[-1], rows[0]))
    for a, b in pairs:
        result.extend([[a[0], a[1], b[1]], [a[0], b[1], b[0]]])
    return result


def repair_aurelia(asset):
    asset.orient_closed_airfoils()
    stations = [(5,1.15,5.15,.07,.72),(8,-1.05,3.55,.07,.72),(10.7,-3.12,2.4,.07,.239),(10.7,-3.12,2.4,.361,.72),(12.7,-4.7,1.5,.07,.72)]
    for label, side in [('Left', -1), ('Right', 1)]:
        triangles = fitted_joints(asset, f'Wing_{label} | Pearl | warm ceramic white', stations, side, .006)
        asset.replace(f'Wing_{label} | Panel seals | warm graphite', triangles, 'Flush wing panel joints, 0.6 mm skin offset')
        repair_fuel_cap(asset, label, side)
    # Replace the gold piping with an enamel band, preserving all lettering in its batch.
    name = 'Fuselage | Champagne trim'
    vertices, faces = asset.geometry(name)
    retained = keep_small_components(vertices, faces, 20)
    hull_name = next(n['name'] for n in asset.doc['nodes'] if n.get('name','').startswith('Continuous pressure'))
    hv, hf = asset.geometry(hull_name)
    tree = BVHTree.FromPolygons(hv, hf, all_triangles=True)
    def project(p):
        hit, normal, _, distance = tree.find_nearest(p)
        if distance > .03: raise RuntimeError('Gold marking misses its pressure shell')
        return hit + normal*.0006
    for side in [-1, 1]:
        rows = []
        for i in range(400):
            y = 13.5-27.8*i/399; theta = -.105+.15*math.exp(-((y+10)/3.5)**2)
            rx, rz, _ = body(y); radius = math.hypot(rx*math.sin(theta), rz*math.cos(theta))
            rows.append([project(skin(y, theta-.012/radius, side)), project(skin(y, theta+.012/radius, side))])
        retained.extend(strip(rows))
    asset.replace(name, retained, 'Surface-fitted champagne paint band; original lettering retained')
    for node in list(asset.doc['nodes']):
        name = node.get('name', '')
        if not name.endswith(' recessed seal'): continue
        prefix = name[:-len(' recessed seal')]
        centers = tube_centers(asset, name)
        side = 1 if sum(p.x for p in centers) > 0 else -1
        uv = []
        for p in centers[:-1]:
            y = -p.z; rx, rz, zc = body(y)
            uv.append((y, math.atan2((p.y-zc)/(rz+.006), abs(p.x)/(rx+.006))))
        yc = sum(p[0] for p in uv)/len(uv); tc = sum(p[1] for p in uv)/len(uv)
        radius = sum(body(p[0])[1] for p in uv)/len(uv)
        def band(inner, outer, offset):
            rows = []
            for (y0,t0),(y1,t1) in zip(uv,uv[1:]+uv[:1]):
                for step in range(4):
                    y=y0+(y1-y0)*step/4; t=t0+(t1-t0)*step/4
                    dy, dt = y-yc, (t-tc)*radius; length = math.hypot(dy,dt)
                    rows.append([skin(y+dy/length*d, t+dt/length*d/radius, side, offset) for d in [inner, outer]])
            return strip(rows, True)
        asset.replace(name, band(-.007,.011,.008), 'Fitted flat window gasket')
        asset.replace(prefix+' nickel reveal', band(.009,.012,.0085), 'Thin seated window reveal')


def repair_fuel_cap(asset, label, side):
    name=f'Wing_{label} | Machined titanium'
    vertices, faces=asset.geometry(name)
    x,z=side*10.7,3.84
    retained=[[vertices[i] for i in f] for f in faces if not all(abs(vertices[i].x-x)<.2 and abs(vertices[i].z-z)<.2 for i in f)]
    skin_name=f'Wing_{label} | Pearl | warm ceramic white'
    sv,sf=asset.geometry(skin_name); tree=BVHTree.FromPolygons(sv,sf,all_triangles=True)
    def point(dx,dz):
        hit,normal,_,_=tree.ray_cast(Vector((x+dx,20,z+dz)),Vector((0,-1,0)))
        if hit is None: raise RuntimeError('Fuel cap misses wing')
        return hit+normal*.001
    center=point(0,0)
    rim=[point(.127*math.cos(i*math.tau/64),.127*math.sin(i*math.tau/64)) for i in range(64)]
    retained.extend([[center,rim[(i+1)%64],rim[i]] for i in range(64)])
    asset.replace(name,retained,'Closed fuel access cap seated on wing; original hinges retained')
    seam_name=f'Wing_{label} | Panel seals | warm graphite'
    v,f=asset.geometry(seam_name); seams=[[v[i] for i in face] for face in f]
    rows=[[point(r*math.cos(i*math.tau/64),r*math.sin(i*math.tau/64)) for r in [.128,.133]] for i in range(64)]
    seams.extend(strip(rows,True))
    asset.replace(seam_name,seams,'Flush wing joints and fuel cap perimeter, 0.6–1 mm skin offset')


def components(vertices, faces):
    parent = list(range(len(vertices)))
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    by_position = {}
    for i, p in enumerate(vertices):
        key = tuple(round(v, 5) for v in p)
        if key in by_position: parent[root(i)] = root(by_position[key])
        else: by_position[key] = i
    for a,b,c in faces:
        parent[root(b)] = root(a); parent[root(c)] = root(a)
    groups = {}
    for f in faces: groups.setdefault(root(f[0]), []).append(f)
    return list(groups.values())


def keep_small_components(vertices, faces, maximum_extent):
    result = []
    for fs in components(vertices,faces):
        ps = [vertices[i] for f in fs for i in f]
        if max(max(p[j] for p in ps)-min(p[j] for p in ps) for j in range(3)) < maximum_extent:
            result.extend([[vertices[i] for i in f] for f in fs])
    return result


def repair_peregrine(asset):
    stations = [(4.3,1.5,6,.06,.71),(7.9,-2.4,3.25,.06,.71),(9.5,-4.2,1.78,.06,.71)]
    for label, side in [('Left', -1), ('Right', 1)]:
        asset.replace(f'Wing_{label} | Panel seals | graphite', fitted_joints(asset, f'Wing_{label} | Airframe | ceramic blue-grey', stations, side, .008), 'Flush wing panel joints, 0.6 mm skin offset')
    for name in ['Bubble canopy glazing | perimeter rail', 'Bubble canopy glazing | perimeter rail.001']:
        asset.replace(name, flange(tube_centers(asset, name), .042, .012), 'Fitted rectangular canopy sill profile')
    for name in ['Canopy forward arch', 'Windscreen rear arch']:
        asset.replace(name, flange(tube_centers(asset, name), .04, .012, True), 'Flat glazing frame profile')
    name='Cockpit | Duct interiors | carbon'
    vertices,faces=asset.geometry(name); repaired=[]; seals=0
    for fs in components(vertices,faces):
        ids=sorted({i for f in fs for i in f}); points=[vertices[i] for i in ids]
        extent=max(p.z for p in points)-min(p.z for p in points)
        if extent>4.7 and min(p.y for p in points)>4:
            assert len(points)%7==0, 'Unexpected weather seal topology'
            centers=[sum(points[i+1:i+7],Vector())/6 for i in range(0,len(points),7)]
            repaired.extend(flange(centers,.03,.008)); seals+=1
        else: repaired.extend([[vertices[i] for i in f] for f in fs])
    assert seals==2, 'Expected two recessed cockpit weather seals'
    asset.replace(name,repaired,'Recessed flat weather seals; floor and projector retained')


if __name__ == '__main__':
    reports = []
    for filename in ['peregrine-hx27.glb', 'aurelia-flight.glb', 'aurelia-s32.glb']:
        asset = Asset(ROOT/'public/assets'/filename)
        if asset.doc.get('extras', {}).get('airframe_detail_revision') == 1:
            print('Already repaired', filename); continue
        (repair_peregrine if filename.startswith('peregrine') else repair_aurelia)(asset)
        reports.append(asset.write())
    if reports: (ROOT/'output/fleet-detail-repairs.json').write_text(json.dumps(reports, indent=2))
    print('AIRFRAME_DETAILS_REPAIRED', [(r['asset'],len(r['changed'])) for r in reports], flush=True)
