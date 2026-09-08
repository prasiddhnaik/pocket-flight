"""Aurelia S32: original wide-cabin executive aircraft, metres."""
import bpy, bmesh, math, json, sys, argparse
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[1]
PROJECT=ROOT.parents[1]
for directory in [ROOT/'renders',ROOT/'validation',PROJECT/'public/assets']:
    directory.mkdir(parents=True,exist_ok=True)
p=argparse.ArgumentParser();p.add_argument('--views',default='beauty,side,front,rear');p.add_argument('--samples',type=int,default=24)
args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.unit_settings.system='METRIC'
collection=bpy.data.collections.new('Aurelia S32 | aircraft');scene.collection.children.link(collection)
def collect(o):
    for c in list(o.users_collection):c.objects.unlink(o)
    collection.objects.link(o)
def rgb(h):
    v=[int(h[i:i+2],16)/255 for i in (1,3,5)]
    return tuple(x/12.92 if x<.04045 else ((x+.055)/1.055)**2.4 for x in v)
def mat(n,c,r=.4,m=0):
    a=bpy.data.materials.new(n);a.use_nodes=True;a.diffuse_color=(*rgb(c),1)
    bs=a.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=a.diffuse_color;bs.inputs['Roughness'].default_value=r;bs.inputs['Metallic'].default_value=m
    return a
paint=mat('Pearl | warm ceramic white','#E5E6E1',.26,.28)
light=mat('Titanium silver panels','#BFC9CA',.32,.65)
shade=mat('Atlantic blue lacquer','#183A48',.24,.5)
radome=mat('Radome | porcelain','#D6DBD9',.34,.05)
seam=mat('Panel seals | warm graphite','#526368',.58,.15)
black=mat('Engine duct | carbon','#142229',.66,.25)
metal=mat('Machined titanium','#8C9EA3',.28,.86)
bright=mat('Polished nickel','#DDE6E3',.17,.95)
nozzle=mat('Exhaust | brushed nickel','#687B80',.32,.8)
inner=mat('Fan blades | graphite titanium','#455C66',.33,.7)
rubber=mat('Tire rubber','#1D272B',.88)
seat=mat('Cockpit | graphite leather','#334247',.65)
cushion=mat('Cabin | warm ivory leather','#C6BCAE',.54)
belt=mat('Harness | woven sand','#9F9586',.85)
white=paint
amber=mat('Champagne trim','#B6A17A',.24,.7)
red=mat('Navigation | port ruby','#D63130',.17)
green=mat('Navigation | starboard jade','#42CB9A',.17)
screen=mat('Avionics displays','#3BABB6',.3)
bs=screen.node_tree.nodes.get('Principled BSDF');bs.inputs['Emission Color'].default_value=(*rgb('#3BABB6'),1);bs.inputs['Emission Strength'].default_value=.6
glass=mat('Glass | neutral blue glazing','#365964',.07,.08)
bs=glass.node_tree.nodes.get('Principled BSDF');bs.inputs['Transmission Weight'].default_value=.8;bs.inputs['IOR'].default_value=1.45;bs.inputs['Alpha'].default_value=.58;bs.inputs['Coat Weight'].default_value=.65
glass.diffuse_color=(*rgb('#365964'),.58);glass.surface_render_method='DITHERED'

def empty(n,parent=None,pos=(0,0,0)):
    o=bpy.data.objects.new(n,None);collection.objects.link(o);o.location=pos
    if parent:o.parent=parent
    return o
root=empty('Aurelia_S32');root['design']='Original civilian wide-cabin executive aircraft';root['forward']='Blender +Y / glTF -Z';root['units']='metres'
fuse=empty('Fuselage',root);cockpit=empty('Cockpit',root);tail=empty('Empennage',root);gear=empty('LandingGear',root)
def parent_world(o,parent):
    bpy.context.view_layer.update();w=o.matrix_world.copy();o.parent=parent;o.matrix_world=w

def mesh(n,v,f,m,parent=root,smooth=True):
    data=bpy.data.meshes.new(n);data.from_pydata(v,[],f);data.update();o=bpy.data.objects.new(n,data);collection.objects.link(o)
    if m:data.materials.append(m)
    for poly in data.polygons:poly.use_smooth=smooth
    parent_world(o,parent);return o

def bevel(o,width=.03,segments=3):
    mod=o.modifiers.new('Manufactured edge radius','BEVEL');mod.width=width;mod.segments=segments
    mod=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL');mod.keep_sharp=True
    return o

def box(n,pos,scale,m,parent=root,rounding=.04):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.name=n;collect(o);o.dimensions=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(m);bevel(o,rounding);parent_world(o,parent);return o

def cyl(n,a,b,r,m,parent=root,vertices=24,r2=None):
    a=Vector(a);b=Vector(b);d=b-a
    bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=r,radius2=r if r2 is None else r2,depth=d.length,location=(a+b)/2)
    o=bpy.context.object;o.name=n;collect(o);o.rotation_euler=d.to_track_quat('Z','Y').to_euler();o.data.materials.append(m)
    for face in o.data.polygons:face.use_smooth=len(face.vertices)==4
    bevel(o,min(.012,r*.08),2);parent_world(o,parent);return o

def torus(n,pos,major,minor,m,parent=root,axis='Y',segments=48):
    bpy.ops.mesh.primitive_torus_add(major_radius=major,minor_radius=minor,major_segments=segments,minor_segments=10,location=pos)
    o=bpy.context.object;o.name=n;collect(o)
    if axis=='Y':o.rotation_euler.x=math.pi/2
    if axis=='X':o.rotation_euler.y=math.pi/2
    o.data.materials.append(m)
    for p in o.data.polygons:p.use_smooth=True
    parent_world(o,parent);return o

def line(n,points,r,m,parent=root,cyclic=False):
    data=bpy.data.curves.new(n,'CURVE');data.dimensions='3D';data.bevel_depth=r;data.bevel_resolution=1;data.resolution_u=2
    poly=data.splines.new('POLY');poly.points.add(len(points)-1)
    for a,b in zip(poly.points,points):a.co=(*b,1)
    poly.use_cyclic_u=cyclic;o=bpy.data.objects.new(n,data);collection.objects.link(o);data.materials.append(m);parent_world(o,parent);return o

def text(n,s,pos,size,m,parent=root,rot=(math.pi/2,0,0)):
    data=bpy.data.curves.new(n,'FONT');data.body=s;data.size=size;data.extrude=.0005;data.align_x='CENTER';data.align_y='CENTER'
    o=bpy.data.objects.new(n,data);collection.objects.link(o);o.location=pos;o.rotation_euler=rot;data.materials.append(m);parent_world(o,parent);return o

def cat(a,b,c,d,t):return .5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t)
# Hand-controlled pressure-body stations: nose, flight deck, broad passenger barrel, tapered tail.
profiles=[(16.2,.015,.02,3.35),(15.2,.43,.36,3.42),(13.7,.95,.76,3.59),(12,1.45,1.27,3.74),(10,1.95,1.73,3.84),(7.3,2.25,1.94,3.88),(3,2.36,2.01,3.88),(-2,2.35,2.0,3.88),(-5.4,2.18,1.88,3.91),(-8,1.67,1.51,3.97),(-10.5,1.05,1.06,4.01),(-13,.45,.54,4.04),(-15.3,.035,.065,4.07)]
def body(y):
    for i in range(len(profiles)-1):
        b,c=profiles[i:i+2]
        if c[0]<=y<=b[0]:
            t=(b[0]-y)/(b[0]-c[0]);a=profiles[max(0,i-1)];d=profiles[min(len(profiles)-1,i+2)]
            return tuple(cat(a[j],b[j],c[j],d[j],t) for j in range(1,4))
    return profiles[0][1:] if y>16.2 else profiles[-1][1:]
def skin(y,theta,off=0):
    rx,rz,zc=body(y);return ((rx+off)*math.cos(theta),y,zc+(rz+off)*math.sin(theta))
def loft(n,ys,material,parent,off=0,N=96):
    v=[skin(y,j*math.tau/N,off) for y in ys for j in range(N)];f=[]
    for i in range(len(ys)-1):
        for j in range(N):a=i*N+j;b=i*N+(j+1)%N;f.append((a,b,b+N,a+N))
    f += [tuple(reversed(range(N))),tuple((len(ys)-1)*N+j for j in range(N))]
    return mesh(n,v,f,material,parent)
def normals(o):
    bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
def subtract(target,cut):
    normals(cut);normals(target);bpy.context.view_layer.objects.active=target
    mod=target.modifiers.new('Machined apertures','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cut;bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cut,do_unlink=True)
hull=loft('Continuous pressure shell',[16.2-31.5*i/168 for i in range(169)],paint,fuse)
inside=loft('Pressure cabin hollow',[11.8-21.4*i/116 for i in range(117)],None,fuse,-.14)
subtract(hull,inside)
# Glazing and seals share the actual shell shape, avoiding floating window decals.
cutters=[]
def window(n,side,y0,t0,ry,rt,rect=False):
    g=empty(n,cockpit if y0>9 else fuse);N=48;boundary=[]
    for j in range(N):
        a=j*math.tau/N
        # Rounded rectangular/superellipse apertures for executive cabin windows.
        co,si=math.cos(a),math.sin(a);power=.5 if rect else .72
        y=y0+ry*math.copysign(abs(co)**power,co);t=t0+rt*math.copysign(abs(si)**power,si)
        boundary.append((y,t))
    def point(y,t,off):
        v=skin(y,t,off);return (v[0]*side,v[1],v[2])
    v=[point(y,t,d) for d in [-.30,.4] for y,t in boundary]
    faces=[tuple(reversed(range(N))),tuple(N+j for j in range(N))]+[(j,(j+1)%N,(j+1)%N+N,j+N) for j in range(N)]
    cutters.append(mesh(n+' cutter',v,faces,None,g))
    verts=[point(y0,t0,-.018)]+[point(y,t,-.018) for y,t in boundary]
    pane=mesh(n+' curved glazing',verts,[(0,j+1,(j+1)%N+1) for j in range(N)],glass,g)
    line(n+' recessed seal',[point(y,t,.006) for y,t in boundary],.026,black,g,True)
    line(n+' nickel reveal',[point(y,t,.012) for y,t in boundary],.009,bright,g,True)
for side in [-1,1]:
    for i,y in enumerate([7.0,5.48,3.96,2.44,.92,-.60,-2.12,-3.64]):window('Cabin window '+str(side)+' '+str(i+1),side,y,.31,.43,.175)
    window('Forward windshield '+str(side),side,11.5,1.095,1.05,.30,True)
    window('Flight deck side window '+str(side),side,9.65,.66,.64,.24,True)
bpy.ops.object.select_all(action='DESELECT')
for o in cutters:o.select_set(True)
bpy.context.view_layer.objects.active=cutters[0];bpy.ops.object.join();subtract(hull,cutters[0])
# Curved lower blue hull paint and a restrained champagne sweep, integral to the body.
def band(n,ys,tlo,thi,material):
    N=36;v=[skin(y,tlo+(thi-tlo)*j/N,.008) for y in ys for j in range(N+1)];f=[]
    for i in range(len(ys)-1):
        for j in range(N):a=i*(N+1)+j;f.append((a,a+1,a+N+2,a+N+1))
    return mesh(n,v,f,material,fuse)
band('Atlantic lower fuselage',[13.5-27.8*i/140 for i in range(141)],math.pi+.11,math.tau-.11,shade)
for side in [-1,1]:
    points=[]
    for i in range(130):
        y=13.5-27.8*i/129;t=-.105+.15*math.exp(-((y+10)/3.5)**2);v=skin(y,t,.022);points.append((v[0]*side,v[1],v[2]))
    line('Champagne sweep',points,.025,amber,fuse)
# Nose cone and sparse manufacturing breaks.
loft('Satin dielectric nose cap',[16.2-2.8*i/24 for i in range(25)],radome,fuse,.009)
line('Radome perimeter seal',[skin(13.4,j*math.tau/128,.012) for j in range(128)],.008,seam,fuse,True)
for y in [-5.1,-9.1,-12.8]:line('Pressure frame seam',[skin(y,j*math.tau/128,.014) for j in range(128)],.006,seam,fuse,True)
def sidepoint(side,y,z,off=.02):
    rx,rz,zc=body(y);return (side*(rx*math.sqrt(max(.001,1-((z-zc)/rz)**2))+off),y,z)
def hatch(n,side,y,z,w,h):
    points=[]
    for j in range(80):
        a=j*math.tau/80;co,si=math.cos(a),math.sin(a)
        points.append(sidepoint(side,y+w/2*math.copysign(abs(co)**.4,co),z+h/2*math.copysign(abs(si)**.4,si)))
    line(n+' seal',points,.013,seam,fuse,True)
    box(n+' recessed latch',sidepoint(side,y+w*.28,z),(.025,.22,.065),bright,fuse,.02)
hatch('Passenger entry door',-1,8.2,3.8,1.16,2.6)
hatch('Rear service hatch',1,-5.8,3.62,.9,1.6)
hatch('Baggage access',-1,-5.0,2.72,1.55,.83)
for side in [-1,1]:
    for y in [-10.2,10.0]:
        pos=sidepoint(side,y,3.15);cyl('Flush static port',pos,(pos[0]+side*.014,pos[1],pos[2]),.043,metal,fuse)
# Aerodynamic closed wing sections, complete underside and independently hinged trailing surfaces.
def airfoil(u,ch,t=.095):return 5*t*ch*(.2969*math.sqrt(max(0,u))-.126*u-.3516*u*u+.2843*u**3-.1036*u**4)
def wing(n,stations,m,parent,umin=0,umax=1):
    steps=32;v=[];f=[]
    for x,lead,ch,z in stations:
        for j in range(steps*2):
            a=j*math.pi/steps;u=umin+(umax-umin)*(1-math.cos(a))/2
            v.append((x,lead-ch*u,z+.012*ch*math.sin(math.pi*u)+airfoil(u,ch)*(1 if j<=steps else -1)))
    N=steps*2
    for i in range(len(stations)-1):
        for j in range(N):a=i*N+j;b=i*N+(j+1)%N;f.append((a,b,b+N,a+N))
    f += [tuple(reversed(range(N))),tuple((len(stations)-1)*N+j for j in range(N))]
    return mesh(n,v,f,m,parent)
for side,label in [(-1,'Left'),(1,'Right')]:
    g=empty('Wing_'+label,root)
    st=[(side*x,y,c,z) for x,y,c,z in [(1.35,3.0,7.1,2.72),(2.6,2.6,6.75,2.8),(5,1.15,5.15,2.97),(8,-1.05,3.55,3.24),(10.7,-3.12,2.4,3.52),(12.7,-4.7,1.5,3.79),(13.3,-5.22,1.12,4.0),(13.55,-5.6,.85,4.5),(13.62,-6.0,.59,5.35),(13.57,-6.38,.16,5.9)]]
    wing('Swept supercritical wing',st,paint,g,0,.74)
    for kind,lo,hi in [('Flap',1,3),('Aileron',3,6)]:
        sts=st[lo:hi+1];pivot=(sts[0][0],sts[0][1]-sts[0][2]*.765,sts[0][3]);control=empty(kind+'_'+label,g,pivot);control['hinge_axis']='local X';control['travel_degrees']=[-22,22] if kind=='Aileron' else [0,34]
        wing(kind+' skin',sts,paint,control,.765,1)
        for x,y,c,z in sts[1:]:cyl('Control hinge',(x-.09,y-c*.75,z),(x+.09,y-c*.75,z),.037,metal,g)
    wing('Wing root trailing closure',st[:2],paint,g,.75,1);wing('Swept winglet trailing closure',st[6:],shade,g,.75,1)
    # Root fillets, blended into the pressure body at the low wing shoulder.
    # The root airfoil enters the pressure shell directly; no overlapping fairing skin.
    for x,y,c,z in st[2:6]:
        line('Wing inspection joint',[(x,y-c*u,z+.012*c*math.sin(math.pi*u)+airfoil(u,c)+.009) for u in [.07+j*.65/28 for j in range(29)]],.005,seam,g)
    x,y,c,z=st[4];torus('Fuel cap',(x,y-.72,z+airfoil(.72/c,c)+.023),.13,.013,metal,g,'Z',32)
    for x,y,c,z in st[2:4]:
        cyl('Flap track fairing',(x,y-c*.7,z-.12),(x,y-c-0.28,z-.12),.12,shade,g,r2=.035)
    x,y,c,z=st[6];cyl('Navigation housing',(x,y-.12,z),(x,y-.4,z),.07,bright,g,r2=.045)
    cyl('Navigation lens',(x,y-.105,z),(x,y-.14,z),.058,red if side<0 else green,g)
# High swept tail: robust dorsal fillet with a clean cruciform stabilizer.
st=[(4.05,-8.0,6.8,0),(5.25,-8.65,5.85,0),(7.5,-10.3,4.1,0),(9.1,-11.62,2.4,0),(9.55,-12.06,1.85,0)]
def fin(n,lo,hi,material,parent):
    o=wing(n,st,material,parent,lo,hi)
    bpy.context.view_layer.update();inv=o.matrix_world.inverted()
    for v in o.data.vertices:
        p=o.matrix_world@v.co;v.co=inv@Vector((p.z,p.y,p.x))
    o.data.update();return o
fin('Swept vertical fin',0,.72,shade,tail);rud=empty('Rudder',tail,(0,-12.6,4.4));rud['hinge_axis']='glTF Y';fin('Rudder airfoil',.74,1,paint,rud)
for side,label in [(-1,'Left'),(1,'Right')]:
    stail=[(side*x,y,c,z) for x,y,c,z in [(.12,-10.3,4.0,7.45),(1.1,-10.45,3.75,7.49),(3.5,-11.7,2.35,7.65),(5.4,-13.0,1.18,7.83),(5.6,-13.3,.66,7.87)]]
    g=empty('Tailplane_'+label,tail);wing('Horizontal stabilizer',stail,paint,g,0,.69)
    elevator=empty('Elevator_'+label,g,(side*.12,-13.12,7.45));elevator['hinge_axis']='local X';wing('Elevator airfoil',stail,paint,elevator,.71,1)
# Separate rear turbofans with rounded lips, deep ducts and individually twisted fan blades.
def ringloft(n,stations,m,parent,N=72,caps=False):
    v=[(x+rx*math.cos(j*math.tau/N),y,z+rz*math.sin(j*math.tau/N)) for x,y,z,rx,rz in stations for j in range(N)];f=[]
    for i in range(len(stations)-1):
        for j in range(N):a=i*N+j;b=i*N+(j+1)%N;f.append((a,b,b+N,a+N))
    if caps:f.extend([tuple(reversed(range(N))),tuple((len(stations)-1)*N+j for j in range(N))])
    return mesh(n,v,f,m,parent)
for side,label in [(-1,'Left'),(1,'Right')]:
    x=side*3.26;z=4.25;eng=empty('Engine_'+label,root)
    # Pylon has an airfoil profile and penetrates both mounts with no daylight gaps.
    wing('Engine structural pylon',[(side*1.55,-5.45,4.4,4.00),(side*2.25,-5.65,4.35,4.13),(side*3.25,-6.0,3.75,4.22)],shade,eng)
    ringloft('Sculpted nacelle',[(x,y,z,r,r) for y,r in [(-4.75,1.01),(-4.88,1.095),(-5.18,1.13),(-5.8,1.145),(-7.25,1.10),(-8.55,.95),(-9.4,.75),(-9.9,.61),(-10.0,.59)]],paint,eng)
    ringloft('Rounded intake lip',[(x,y,z,r,r) for y,r in [(-5.25,.92),(-4.98,.92),(-4.80,.95),(-4.73,1.0),(-4.79,1.055),(-4.91,1.09)]],bright,eng)
    ringloft('Dark intake passage',[(x,-4.98,z,.92,.92),(x,-5.8,z,.89,.89),(x,-6.4,z,.87,.87)],black,eng)
    rotor=empty('Fan_'+label,eng,(x,-5.75,z));rotor['rotation_axis']='glTF Z'
    cyl('Fan backplate',(x,-6.01,z),(x,-5.97,z),.885,black,eng)
    for j in range(26):
        a=j*math.tau/26;v=[]
        for r in [.21,.38,.65,.88]:
            twist=.20*(r/.88)**1.3
            for w in [-.036,.075]:
                aa=a+twist+w;v.append((x+r*math.cos(aa),-5.90+.19*(r/.88)**1.5+w*.35,z+r*math.sin(aa)))
        o=mesh('Swept fan blade',v,[(0,1,3,2),(2,3,5,4),(4,5,7,6)],metal,rotor);sol=o.modifiers.new('Blade gauge','SOLIDIFY');sol.thickness=.012
    cyl('Fan spinner',(x,-5.94,z),(x,-5.17,z),.23,shade,rotor,r2=.025)
    ringloft('Exhaust annulus',[(x,-9.55,z,.70,.70),(x,-10.03,z,.60,.60),(x,-10.10,z,.55,.55),(x,-9.6,z,.52,.52)],nozzle,eng)
    cyl('Exhaust centrebody',(x,-9.3,z),(x,-10.55,z),.34,inner,eng,r2=.04)
    for y,r in [(-5.45,1.14),(-8.2,1.0)]:torus('Cowling panel break',(x,y,z),r,.009,seam,eng)
    for a in [.2,1.1,2.2,3.3,4.4,5.5]:
        pos=(x+1.14*math.cos(a),-5.46,z+1.14*math.sin(a));cyl('Cowling fastener',pos,(pos[0]*1.001,pos[1]-.02,pos[2]),.023,metal,eng)
# Civilian flight deck and luxury passenger seating behind actual apertures.
floorv=[];floorys=[8.3-14.6*i/48 for i in range(49)]
for z in [2.38,2.51]:
    for y in floorys:
        rx,rz,zc=body(y);w=(rx-.19)*math.sqrt(max(.01,1-((2.38-zc)/(rz-.16))**2))
        floorv.extend([(-w,y,z),(w,y,z)])
floorf=[];N=len(floorys)*2
for i in range(len(floorys)-1):
    a=i*2;floorf.extend([(a,a+1,a+3,a+2),(N+a,N+a+2,N+a+3,N+a+1),(a,a+2,N+a+2,N+a),(a+1,N+a+1,N+a+3,a+3)])
floorf.extend([(0,N,N+1,1),(N-2,N-1,2*N-1,2*N-2)])
mesh('Cabin floor fitted inside shell',floorv,floorf,shade,fuse)
box('Cabin aisle carpet',(0,1.0,2.55),(.72,14.4,.055),seat,fuse,.025)
for side in [-1,1]:
    for i,y in enumerate([6.9,4.65,2.4,.15,-2.1,-4.35]):
        g=empty('Passenger seat '+str(side)+' '+str(i+1),fuse);x=side*1.03
        box('Seat plinth',(x,y,2.77),(.57,.68,.48),shade,g,.07)
        box('Leather seat cushion',(x,y,3.09),(.78,.83,.20),cushion,g,.10)
        o=box('Contoured seat back',(x,y-.33,3.62),(.77,.24,1.02),cushion,g,.12);o.rotation_euler.x=-.10
        for xx in [x-.43,x+.43]:box('Armrest',(xx,y,3.42),(.12,.73,.16),cushion,g,.055)
        line('Seat belt',[(x-.29,y+.18,3.20),(x,y+.1,3.22),(x+.3,y-.13,3.20)],.018,belt,g)
for side in [-1,1]:
    x=side*.58;g=empty('Pilot seat '+str(side),cockpit);y=10.0
    box('Pilot seat pan',(x,y,3.81),(.68,.72,.2),seat,g,.09)
    box('Pilot seat back',(x,y-.26,4.25),(.66,.20,.85),seat,g,.10)
    box('Pilot headrest',(x,y-.27,4.76),(.40,.20,.24),cushion,g,.07)
    for dx in [-.2,.2]:line('Shoulder restraint',[(x+dx,y-.12,4.57),(x+dx*.75,y+.05,4.2),(x,y+.22,3.94)],.027,belt,g)
    cyl('Yoke column',(x,y+.56,3.38),(x,y+.65,4.05),.036,metal,cockpit)
    line('Control yoke',[(x-.17,y+.65,4.16),(x-.22,y+.65,4.02),(x,y+.65,3.94),(x+.22,y+.65,4.02),(x+.17,y+.65,4.16)],.032,seat,cockpit)
    for dx in [-.16,.16]:box('Rudder pedal',(x+dx,y+.97,3.28),(.2,.13,.12),metal,cockpit,.02)
box('Flight deck dashboard',(0,11.12,4.0),(2.4,.35,.67),seat,cockpit,.11)
box('Glare shield',(0,11.05,4.40),(2.48,.52,.10),black,cockpit,.05)
for x in [-.87,-.3,.3,.87]:
    box('Avionics screen bezel',(x,10.92,4.04),(.47,.04,.36),black,cockpit,.025)
    box('Flight display',(x,10.893,4.04),(.405,.014,.29),screen,cockpit,.015)
    for k in range(4):line('Display symbology',[(x-.15,10.882,3.95+k*.05),(x+.1,10.882,3.95+k*.05)],.005,paint,cockpit)
box('Centre pedestal',(0,10.13,3.54),(.30,1.36,.69),seat,cockpit,.065)
for x in [-.075,.075]:cyl('Throttle lever',(x,10.25,3.9),(x,10.32,4.08),.02,metal,cockpit);box('Throttle grip',(x,10.32,4.12),(.09,.14,.08),black,cockpit,.025)
# Six-wheel retractable gear, conventional hydraulic oleos and brake assemblies.
def wheel(n,x,y,r,parent):
    g=empty(n,None,(x,y,r));parent_world(g,parent);g['rotation_axis']='local X'
    torus('Tire carcass',(x,y,r),r*.75,r*.25,rubber,g,'X',40)
    for dx in [-.045,.045]:torus('Tread groove',(x+dx,y,r),r*.989,.007,seam,g,'X',40)
    for sign in [-1,1]:
        cyl('Brake disc',(x+sign*.13,y,r),(x+sign*.16,y,r),r*.51,metal,g,32)
        torus('Wheel rim',(x+sign*.175,y,r),r*.48,.023,bright,g,'X',32)
        cyl('Hub cap',(x+sign*.17,y,r),(x+sign*.19,y,r),r*.20,shade,g,24)
    return g
for side,label in [(-1,'Left'),(1,'Right')]:
    x=side*2.15;y=-1.1;leg=empty('Main_gear_'+label,gear,(x,y,1.1));leg['hinge_axis']='glTF Z'
    cyl('Main upper oleo',(side*1.7,y+.3,2.26),(x,y,1.14),.13,metal,leg)
    cyl('Main polished piston',(x,y,1.3),(x,y,.51),.08,bright,leg)
    cyl('Axle',(x-.43,y,.51),(x+.43,y,.51),.09,metal,leg)
    line('Torque scissors',[(x,y-.14,1.4),(x,y-.35,.95),(x,y-.12,.67)],.045,shade,leg)
    cyl('Drag brace',(side*1.6,y+.85,2.06),(x,y,.93),.055,metal,leg)
    for dx in [-.27,.27]:wheel('Main_wheel_'+label+'_'+str(dx),x+dx,y,.51,leg)
    box('Main gear bay door',(side*1.65,y,1.90),(.55,1.9,.075),shade,leg,.06)
nose=empty('Nose_gear',gear,(0,10.65,1.5));nose['hinge_axis']='local X';steer=empty('Nose_steering',nose)
cyl('Nose upper strut',(0,10.65,2.6),(0,10.65,1.01),.095,metal,steer)
cyl('Nose piston',(0,10.65,1.22),(0,10.65,.37),.058,bright,steer)
for side in [-1,1]:
    cyl('Nose fork',(side*.11,10.65,.83),(side*.20,10.65,.37),.043,metal,steer);wheel('Nose_wheel_'+str(side),side*.20,10.65,.37,steer)
line('Nose torque link',[(0,10.5,1.25),(0,10.32,.90),(0,10.50,.65)],.03,shade,steer)
# Discreet civilian identifiers, antennas and inspection accents.
for side in [-1,1]:
    text('Civil registration','N • 32AU',(side*2.0,-2.5,3.36),.22,paint,fuse,(math.pi/2,0,side*math.pi/2))
    text('Aurelia wordmark','A U R E L I A',(side*2.29,2.0,3.48),.25,amber,fuse,(math.pi/2,0,side*math.pi/2))
    for y in [6.1,-3.1]:
        pos=sidepoint(side,y,3.05);hatch('Service panel',side,y,3.05,.46,.33)
# Low-profile communications fairing on the crown.
ringloft('Dorsal communications fairing',[(0,y,z,r,rz) for y,z,r,rz in [(-3.8,5.82,.02,.02),(-4.1,5.92,.28,.15),(-5.0,5.85,.33,.18),(-5.6,5.70,.03,.025)]],paint,fuse,caps=True,N=32)
print('AURELIA: geometry complete',flush=True)
# Convert and normalize all derived geometry before export.
for o in list(collection.objects):
    if o.type in {'CURVE','FONT'}:
        bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH')
    if o.type=='MESH':
        bpy.context.view_layer.objects.active=o
        for mod in list(o.modifiers):
            try:bpy.ops.object.modifier_apply(modifier=mod.name)
            except RuntimeError:pass
        normals(o)
# Analytic shell normals retain a smooth manufactured skin across boolean aperture topology.
def radialnormal(v):
    x,y,z=v;rx,rz,zc=body(y);e=.01
    def field(yy):
        a,b,c=body(yy);return (x/max(.001,a))**2+((z-c)/max(.001,b))**2
    return Vector((2*x/max(.001,rx*rx),(field(y+e)-field(y-e))/(2*e),2*(z-zc)/max(.001,rz*rz))).normalized()
loopnormals=[None]*len(hull.data.loops)
for poly in hull.data.polygons:
    for index in poly.loop_indices:
        n=radialnormal(hull.data.vertices[hull.data.loops[index].vertex_index].co)
        dot=poly.normal.dot(n)
        loopnormals[index]=n if dot>.45 else -n if dot<-.45 else poly.normal
hull.data.normals_split_custom_set(loopnormals)
# Project the two civilian side markings exactly onto the shaped pressure shell.
vs=[hull.matrix_world@v.co for v in hull.data.vertices];fs=[tuple(p.vertices) for p in hull.data.polygons];tree=BVHTree.FromPolygons(vs,fs)
for o in list(collection.objects):
    if o.type=='MESH' and o.name.startswith(('Civil registration','Aurelia wordmark')):
        inv=o.matrix_world.inverted()
        for v in o.data.vertices:
            p=o.matrix_world@v.co;side=1 if p.x>0 else -1;hit,_,_,_=tree.ray_cast(Vector((side*20,p.y,p.z)),Vector((-side,0,0)))
            if hit:hit.x+=side*.01;v.co=inv@hit
# Consolidate fixed detail by parent/material; movable parts remain independent.
from collections import defaultdict
batches=defaultdict(list)
for o in list(collection.objects):
    if o.type=='MESH' and len(o.data.materials)==1 and not o.name.startswith('Continuous pressure'):
        batches[(o.parent,o.data.materials[0])].append(o)
for (parent,material),objects in batches.items():
    if len(objects)<2:continue
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();objects[0].name=parent.name+' | '+material.name
verts=[];triangles=0;count=0
for o in collection.objects:
    if o.type=='MESH':
        o.data.calc_loop_triangles();triangles+=len(o.data.loop_triangles);verts.extend([o.matrix_world@v.co for v in o.data.vertices]);count+=1
facts={'name':'Aurelia S32','triangles':triangles,'meshes':count,'dimensions_m':[max(v[i] for v in verts)-min(v[i] for v in verts) for i in range(3)],'cabin_windows':16,'cockpit_panes':4,'passenger_seats':12,'pilot_seats':2,'wheels':6,'parts':[o.name for o in collection.objects if o.type=='EMPTY']}
assert all(math.isfinite(c) for v in verts for c in v)
(ROOT/'validation/model-facts.json').write_text(json.dumps(facts,indent=2))
bpy.ops.object.select_all(action='DESELECT')
for o in collection.objects:o.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'Aurelia-S32.blend'))
bpy.ops.export_scene.gltf(filepath=str(PROJECT/'public/assets/aurelia-s32.glb'),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_cameras=False,export_lights=False)
print('AURELIA exported',facts,flush=True)
# Separate photographic studio and a full 360-degree inspection orbit.
world=bpy.data.worlds.new('Aurelia soft studio');scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs['Color'].default_value=(.25,.30,.33,1);world.node_tree.nodes['Background'].inputs['Strength'].default_value=.5
bpy.ops.mesh.primitive_plane_add(size=20000,location=(0,0,-.018));floor=bpy.context.object;floor.data.materials.append(mat('Studio | mist','#B6C0BF',.8))
def area(n,pos,power,size,color):
    data=bpy.data.lights.new(n,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color;o=bpy.data.objects.new(n,data);scene.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector((0,0,3))-o.location).to_track_quat('-Z','Y').to_euler()
area('Warm key',(12,15,25),8500,14,(1,.94,.85));area('Cool fill',(-18,4,18),7000,16,(.85,.94,1));area('Engine rim',(4,-22,18),10000,12,(1,.97,.91))
scene.render.engine='CYCLES';scene.cycles.samples=args.samples;scene.cycles.use_denoising=True
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='METAL';prefs.get_devices()
for device in prefs.devices:device.use=device.type=='METAL'
scene.cycles.device='GPU'
scene.render.resolution_x=1600;scene.render.resolution_y=1100;scene.render.resolution_percentage=100;scene.view_settings.view_transform='AgX'
data=bpy.data.cameras.new('Inspection camera');camera=bpy.data.objects.new('Inspection camera',data);scene.collection.objects.link(camera);scene.camera=camera;data.type='ORTHO'
views={'beauty':((32,38,22),(0,0,3.8),40),'front_right':((32,38,16),(0,0,3.8),40),'front_left':((-32,38,16),(0,0,3.8),40),'rear_right':((32,-38,18),(0,-1,4),40),'rear_left':((-32,-38,18),(0,-1,4),40),'front':((0,50,6),(0,0,4.3),33),'back':((0,-50,6),(0,0,4.3),33),'left':((-50,0,5),(0,0,4.3),37),'right':((50,0,5),(0,0,4.3),37),'top':((0,0,55),(0,0,0),52),'cockpit':((8,19,10),(0,10.5,4.4),11),'engine':((10,3,7),(3.26,-6,4.25),12),'gear':((8,13,3),(0,4,1.4),20)}
for a in range(0,360,30):views['orbit_'+str(a).zfill(3)]=((45*math.sin(math.radians(a)),45*math.cos(math.radians(a)),18),(0,0,3.8),40)
for view in args.views.split(','):
    if view not in views:continue
    pos,target,scale=views[view]
    if view in {'front','back','left','right','gear'}:pos=Vector(target)+(Vector(pos)-Vector(target))*20
    camera.data.clip_end=5000;camera.location=pos;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();data.ortho_scale=scale
    scene.render.filepath=str(ROOT/'renders'/f'{view}.png');bpy.ops.render.render(write_still=True);print('AURELIA rendered',view,flush=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'Aurelia-S32-studio.blend'))
print('AURELIA_DONE',flush=True)
