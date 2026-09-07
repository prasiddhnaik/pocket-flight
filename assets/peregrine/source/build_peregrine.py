"""Peregrine HX-27: reference-led original fighter/transport aircraft, metres."""
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
collection=bpy.data.collections.new('Peregrine HX-27 | aircraft');scene.collection.children.link(collection)
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
paint=mat('Airframe | ceramic blue-grey','#80898D',.48,.2)
light=mat('Panels | pale titanium-grey','#929DA2',.42,.25)
shade=mat('Panels | lower graphite-grey','#616E76',.48,.22)
radome=mat('Radome | satin graphite','#606A70',.54,.05)
seam=mat('Panel seals | graphite','#344149',.68,.04)
black=mat('Duct interiors | carbon','#131D24',.7,.15)
metal=mat('Hardware | brushed titanium','#A5ACAB',.3,.8)
bright=mat('Oleos | polished steel','#CCD2CF',.2,.95)
nozzle=mat('Nozzles | heat-aged titanium','#726F69',.36,.82)
inner=mat('Turbines | dark nickel','#394247',.5,.8)
rubber=mat('Tires | graphite rubber','#20282D',.9)
seat=mat('Seats | charcoal textile','#273337',.9)
cushion=mat('Seats | olive-grey cushions','#646D5E',.88)
belt=mat('Harness | pale sand','#B3B4A1',.88)
white=mat('Markings | soft off-white','#D9DFDA',.6)
amber=mat('Markings | muted rescue ochre','#D8AD58',.6)
red=mat('Safety | red oxide','#B2584B',.5)
green=mat('Avionics | phosphor green','#75BDA6',.3)
bs=green.node_tree.nodes.get('Principled BSDF');bs.inputs['Emission Color'].default_value=(*rgb('#75BDA6'),1);bs.inputs['Emission Strength'].default_value=.7
glass=mat('Glass | smoked blue canopy','#A1C4C8',.07,.05)
bs=glass.node_tree.nodes.get('Principled BSDF');bs.inputs['Transmission Weight'].default_value=.95;bs.inputs['IOR'].default_value=1.45;bs.inputs['Alpha'].default_value=.3;bs.inputs['Coat Weight'].default_value=.45
glass.diffuse_color=(*rgb('#A1C4C8'),.3);glass.surface_render_method='DITHERED'

def empty(n,parent=None,pos=(0,0,0)):
    o=bpy.data.objects.new(n,None);collection.objects.link(o);o.location=pos
    if parent:o.parent=parent
    return o
root=empty('Peregrine_HX27');root['design']='Original F-16-reference / C-5-reference hybrid';root['forward']='Blender +Y / glTF -Z';root['units']='metres'
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
profiles=[(15,.035,.035,3.68),(13.6,.48,.37,3.59),(11.8,1.04,.75,3.44),(9.8,1.46,1.13,3.27),(7.2,1.91,1.47,3.04),(4,2.38,1.69,2.88),(0,2.58,1.76,2.79),(-4,2.46,1.64,2.78),(-7.5,2.05,1.37,2.89),(-10.8,1.87,1.08,2.99),(-12,1.84,1.00,2.92),(-12.85,1.80,.94,2.88)]
def body(y):
    for i in range(len(profiles)-1):
        b,c=profiles[i:i+2]
        if c[0]<=y<=b[0]:
            t=(b[0]-y)/(b[0]-c[0]);a=profiles[max(0,i-1)];d=profiles[min(len(profiles)-1,i+2)]
            return tuple(cat(a[j],b[j],c[j],d[j],t) for j in range(1,4))
    return profiles[0][1:] if y>15 else profiles[-1][1:]
def skinpoint(y,theta,offset=0):
    rx,rz,zc=body(y)
    # Flatter cargo barrel and smooth upper shoulder fillets; no pasted-on pods.
    co,si=math.cos(theta),math.sin(theta)
    barrel=1-math.exp(-((y-11)/5)**2)
    exponent=1-.10*barrel
    x=(rx+offset)*math.copysign(abs(co)**exponent,co)
    z=zc+(rz+offset)*math.copysign(abs(si)**exponent,si)
    fillet=.62*math.exp(-((y+.3)/4.7)**4)*math.exp(-((si-.55)/.28)**2)
    return (x+math.copysign(fillet,co),y,z)
# Hand-shaped, continuously varying full barrel; a fighter nose transitioning to transport mass.
ys=[15-27.85*i/144 for i in range(145)];N=80;verts=[skinpoint(y,j*math.tau/N) for y in ys for j in range(N)]
faces=[]
for i in range(len(ys)-1):
    for j in range(N):a=i*N+j;b=i*N+(j+1)%N;faces.append((a,b,b+N,a+N))
faces.extend([tuple(reversed(range(N))),tuple((len(ys)-1)*N+j for j in range(N))])
hull=mesh('Sculpted pressure fuselage',verts,faces,paint,fuse)
# Cockpit recess: closed volume removed from the hull, rather than seats embedded in paint.
bpy.ops.mesh.primitive_uv_sphere_add(segments=96,ring_count=64,location=(0,8.7,4.95));cut=bpy.context.object;cut.scale=(1.10,2.6,1.7)
bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
bpy.context.view_layer.objects.active=hull;mod=hull.modifiers.new('Recessed cockpit tub','BOOLEAN');mod.operation='DIFFERENCE';mod.object=cut
bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cut,do_unlink=True)
# Fighter radome, complete separate forward shell.
N=64;v=[];f=[]
for i in range(25):
    y=15-(15-11.9)*i/24
    v += [skinpoint(y,j*math.tau/N,.006) for j in range(N)]
for i in range(24):
    for j in range(N):a=i*N+j;b=i*N+(j+1)%N;f.append((a,b,b+N,a+N))
f.extend([tuple(reversed(range(N))),tuple(24*N+j for j in range(N))]);mesh('Pointed graphite radome',v,f,radome,fuse)
line('Radome break seam',[skinpoint(11.89,j*math.tau/100,.01) for j in range(100)],.012,seam,fuse,True)
cyl('Nose air-data probe',(0,14.9,3.75),(0,15.65,3.77),.019,metal,fuse,r2=.004)
# Longitudinal and circumferential service seams follow the loft exactly.
for y in [10.5,5.4,1.5,-3.6,-7.1,-10.2]:
    points=[skinpoint(y,j*math.tau/120,.012) for j in range(121)]
    if y>6:points=[p for p in points if abs(p[0])>1.08 or p[2]<3.6]
    line('Pressure shell frame seam',points,.007,seam,fuse)
for theta in [math.radians(a) for a in [15,165,205,335,270]]:
    points=[]
    for i in range(101):
        point=skinpoint(11.8-23*i/100,theta,.012)
        if 4.9<point[1]<8.5 and point[2]<2.85:
            if len(points)>1:line('Longitudinal skin join',points,.008,seam,fuse)
            points=[]
        else:points.append(point)
    if len(points)>1:line('Longitudinal skin join',points,.008,seam,fuse)
# Broad side cargo/service doors, with inset seal, six latches and reinforced hinge leaves.
for side in [-1,1]:
    for y0,length in [(0,3.1),(-5.3,1.5)]:
        corners=[]
        for ya,yb,aa,ab in [(y0-length/2,y0+length/2,-.12,-.12),(y0+length/2,y0+length/2,-.12,.54),(y0+length/2,y0-length/2,.54,.54),(y0-length/2,y0-length/2,.54,-.12)]:
            for j in range(17):
                t=j/16;yy=ya+(yb-ya)*t;angle=aa+(ab-aa)*t
                point=skinpoint(yy,angle,.012);corners.append((side*point[0],point[1],point[2]))
        line('Cargo hatch | perimeter seal',corners,.008,seam,fuse,True)
        for yy in [y0-length*.34,y0,y0+length*.34]:
            rx,rz,zc=body(yy)
            for a in [-.12,.54]:
                x=side*(rx*math.cos(a)+.018);z=zc+rz*math.sin(a)
                box('Flush quarter-turn cargo latch',(x,yy,z),(.025,.16,.08),metal,fuse,.01)
        for yy in [y0-length*.35,y0+length*.35]:
            rx,rz,zc=body(yy);box('Cargo hinge leaf',(side*(rx+.018),yy,zc-.23),(.035,.23,.12),shade,fuse,.02)
    # Low-contrast identification on the full barrel makes its scale legible.
    rx,rz,zc=body(-1.5)
    text('Side serial','HX–27', (side*(rx+.025),-1.5,zc+.2),.43,white,fuse,(math.pi/2,0,side*math.pi/2))
# Hollow intake lofts with thick rounded lips, dark passages and compressor depth.
def ringloft(n,stations,m,parent,N=56,caps=False):
    v=[];f=[]
    for x,y,z,rx,rz in stations:
        for j in range(N):a=j*math.tau/N;v.append((x+rx*math.cos(a),y,z+rz*math.sin(a)))
    for i in range(len(stations)-1):
        for j in range(N):a=i*N+j;b=i*N+(j+1)%N;f.append((a,a+N,b+N,b))
    if caps:f.extend([tuple(reversed(range(N))),tuple((len(stations)-1)*N+j for j in range(N))])
    return mesh(n,v,f,m,parent)
def intake_ring(stations):
    v=[];f=[];N=80
    for y,rx,rz,zc in stations:
        for j in range(N):
            a=j*math.tau/N;co,si=math.cos(a),math.sin(a)
            v.append((rx*math.copysign(abs(co)**.72,co),y,zc+rz*math.copysign(abs(si)**.72,si)))
    for i in range(len(stations)-1):
        for j in range(N):a=i*N+j;b=i*N+(j+1)%N;f.append((a,b,b+N,a+N))
    return v,f
chin=empty('Integrated_chin_intake',fuse)
v,f=intake_ring([(8.05,1.55,.67,2.12),(7.8,1.65,.72,2.17),(6.7,1.93,.85,2.30),(5.1,2.15,.93,2.39),(3.5,2.24,1.01,2.42)])
outer=mesh('Continuous chin-intake fairing',v,f,paint,chin)
# A closed cutter opens the forward belly and gives the duct genuine depth.
v,f=intake_ring([(8.45,1.44,.55,2.12),(7.8,1.47,.58,2.15),(5.0,1.36,.64,2.15)])
f.extend([tuple(reversed(range(80))),tuple(160+j for j in range(80))]);cutter=mesh('Intake cavity cutter',v,f,None)
for target_obj in [hull]:
    bpy.context.view_layer.objects.active=target_obj;mod=target_obj.modifiers.new('Open chin duct','BOOLEAN');mod.operation='DIFFERENCE';mod.object=cutter
    bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.data.objects.remove(cutter,do_unlink=True)
v,f=intake_ring([(8.01,1.55,.67,2.12),(8.12,1.54,.65,2.12),(8.13,1.47,.57,2.12),(8.02,1.44,.55,2.12)])
mesh('Soft painted inlet lip',v,f,shade,chin)
v,f=intake_ring([(8.02,1.44,.55,2.12),(7.75,1.43,.56,2.13),(6.5,1.37,.59,2.15),(5.2,1.32,.62,2.17)])
mesh('Recessed carbon inlet duct',v,f,black,chin)
v,f=intake_ring([(5.18,1.32,.62,2.17),(5.16,1.32,.62,2.17)]);f.extend([tuple(reversed(range(80))),tuple(80+j for j in range(80))]);mesh('Intake shadow bulkhead',v,f,black,chin)
for side in [-1,1]:
    x=side*.62;rotor=empty('Compressor_'+str(side),chin,(x,5.27,2.17));rotor['axis']='glTF Z'
    for i in range(24):
        a=i*math.tau/24
        vv=[(x+r*math.cos(a+d),5.28+dy,2.17+r*math.sin(a+d)) for r,d,dy in [(.12,0,0),(.49,.06,0),(.49,.15,-.05),(.12,.19,-.05)]]
        mesh('Internal compressor blade',vv,[(0,1,2,3)],inner,rotor)
    cyl('Compressor spinner',(x,5.26,2.17),(x,5.50,2.17),.15,inner,chin,r2=.035)
engines={}
for side,label in [(-1,'Left'),(1,'Right')]:
    eng=empty('Engine_'+label,root);engines[side]=eng
    # Deep twin exhausts, petal rims, interior rings and stator.
    x=side*.91;z=2.88
    ringloft('Blended engine shoulder',[(x,-11.65,z,.94,.88),(x,-12.05,z,.89,.85),(x,-12.45,z,.84,.82),(x,-12.83,z,.802,.802)],paint,eng)
    ringloft('Engine mounting seal',[(x,-12.68,z,.81,.81),(x,-12.82,z,.805,.805)],shade,eng)
    cutter=ringloft('Exhaust passage cutter',[(x,-14.5,z,.74,.74),(x,-13.2,z,.74,.74),(x,-12.4,z,.69,.69),(x,-11.7,z,.55,.55)],None,root,caps=True)
    bpy.context.view_layer.objects.active=hull
    mod=hull.modifiers.new('Open exhaust passage','BOOLEAN');mod.operation='DIFFERENCE';mod.object=cutter
    bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)
    ringloft('Nozzle outer barrel',[(x,-12.2,z,.78,.78),(x,-12.6,z,.80,.80),(x,-13.15,z,.77,.77),(x,-13.72,z,.69,.69)],nozzle,eng)
    ringloft('Nozzle inner refractory liner',[(x,-13.73,z,.64,.64),(x,-13.2,z,.67,.67),(x,-12.5,z,.62,.62),(x,-11.9,z,.48,.48)],black,eng)
    for yy,r in [(-13.5,.65),(-13.2,.67),(-12.8,.65),(-12.35,.59)]:torus('Exhaust cooling ring',(x,yy,z),r,.024,inner,eng)
    for i in range(18):
        a=i*math.tau/18;da=math.tau/18*.46;v=[]
        for y,r in [(-12.8,.79),(-13.74,.70)]:
            v.extend([(x+r*math.cos(a-da),y,z+r*math.sin(a-da)),(x+r*math.cos(a+da),y,z+r*math.sin(a+da))])
        petal=mesh('Nozzle petal',v,[(0,1,3,2)],nozzle if i%3 else metal,eng,False)
        line('Nozzle petal seam',[v[0],v[2]],.009,seam,eng)
    cyl('Turbine depth stop',(x,-11.84,z),(x,-11.80,z),.53,black,eng)
    cyl('Exhaust centrebody',(x,-11.8,z),(x,-12.66,z),.32,inner,eng,r2=.04)
# Aerodynamic wings: actual closed upper and lower airfoil skins.
def airfoil(u,chord,t=.07):
    u=max(0,min(1,u));return 5*t*chord*(.2969*math.sqrt(u)-.126*u-.3516*u*u+.2843*u**3-.1015*u**4)
def wing(n,stations,m,parent,umin=0,umax=1):
    steps=26;v=[];f=[]
    for x,lead,ch,z in stations:
        for j in range(steps*2):
            angle=j*math.pi/steps;u=umin+(umax-umin)*(1-math.cos(angle))/2
            v.append((x,lead-ch*u,z+.015*ch*math.sin(math.pi*u)+airfoil(u,ch)* (1 if j<=steps else -1)))
    N=steps*2
    for i in range(len(stations)-1):
        for j in range(N):a=i*N+j;b=i*N+(j+1)%N;f.append((a,b,b+N,a+N))
    f.extend([tuple(reversed(range(N))),tuple((len(stations)-1)*N+j for j in range(N))])
    return mesh(n,v,f,m,parent)
for side,label in [(-1,'Left'),(1,'Right')]:
    g=empty('Wing_'+label,root)
    stations=[(side*x,y,c,z) for x,y,c,z in [(1.5,3.5,8.0,3.90),(2.6,3.0,7.5,3.94),(4.3,1.5,6.0,3.97),(5.9,-.25,4.65,4.00),(7.9,-2.4,3.25,4.04),(9.5,-4.2,1.78,4.07),(9.85,-4.57,1.40,4.08),(9.92,-4.83,.87,4.08)]]
    wing('Swept airfoil | main skin',stations,paint,g,0,.74)
    # Trailing sections kept separate with small hinge gaps.
    for kind,lo,hi in [('Flap',1,3),('Aileron',3,6)]:
        sts=stations[lo:hi+1];pivot=(sts[0][0],sts[0][1]-sts[0][2]*.76,sts[0][3]);control=empty(kind+'_'+label,g,pivot);control['axis']='local X';control['range_degrees']=[-22,22] if kind=='Aileron' else [0,32]
        wing(kind+' airfoil',sts,light,control,.765,1)
        for x,y,c,z in sts[1:]:cyl('Hinge barrel',(x-.07,y-c*.76,z),(x+.07,y-c*.76,z),.045,metal,g)
    wing('Wing root trailing closure',stations[:2],paint,g,.745,1)
    wing('Rounded outer wing tip',stations[6:],paint,g,.745,1)
    # Fighter-inspired chine/leading-edge extension rises into the wing shoulder.
    wing('Blended leading edge extension',[(side*.97,8.6,4.0,4.02),(side*1.65,6.9,4.2,3.95),(side*2.7,3.6,2.5,3.94),(side*3.4,2.8,1.25,3.96)],shade,g)
    for i in [2,4,5]:
        x,y,c,z=stations[i];line('Wing chord service break',[(x,y-c*u,z+.015*c*math.sin(math.pi*u)+airfoil(u,c)+.012) for u in [.06+j*.65/25 for j in range(26)]],.008,seam,g)
    x,y,c,z=stations[5]
    cyl('Wingtip light fairing',(x,y-.35,z+.035),(x,y-.70,z+.035),.09,shade,g,r2=.045)
    nav=mat('Navigation '+label,'#C6534E' if side<0 else '#74BCA0',.2)
    cyl('Navigation lens',(x,y-.33,z+.035),(x,y-.40,z+.035),.07,nav,g)
    # A slender wingtip fairing follows the approved fighter silhouette.
    tipx=side*9.78
    ringloft('Wingtip equipment fairing',[(tipx,-3.94,4.08,.025,.025),(tipx,-4.25,4.08,.13,.105),(tipx,-5.9,4.08,.13,.105),(tipx,-6.2,4.08,.035,.035)],shade,g,N=24,caps=True)
# Muscular swept tail and separately rigged elevators/rudder.
for side,label in [(-1,'Left'),(1,'Right')]:
    g=empty('Tailplane_'+label,tail)
    stations=[(side*x,y,c,z) for x,y,c,z in [(1.15,-8.8,4.6,3.85),(2.5,-9.8,3.5,3.91),(4.5,-11.7,1.75,4.02),(4.73,-12.05,1.15,4.04)]]
    wing('Tailplane airfoil',stations,paint,g,0,.69)
    elevator=empty('Elevator_'+label,g,(side*1.15,-12.06,3.85));elevator['axis']='local X'
    wing('Elevator skin',stations,light,elevator,.71,1)
# Fin is a swept airfoil rotated into the vertical plane.
finstations=[(3.9,-6.8,6.6,0),(4.55,-8.1,5.4,0),(6.0,-9.5,3.9,0),(7.7,-11.55,2.0,0),(7.88,-11.77,1.76,0)]
# Re-map wing x to height and its airfoil thickness to body x.
def finpart(name,umin,umax,parent,material):
    o=wing(name,finstations,material,parent,umin,umax)
    for v in o.data.vertices:v.co=(v.co.z,v.co.y,v.co.x)
    o.data.update();return o
finpart('Swept vertical stabilizer',0,.68,tail,paint)
rud=empty('Rudder',tail,(0,-11.3,4.0));rud['axis']='glTF Y';finpart('Rudder airfoil',.70,1,rud,light)
# Flush dorsal antennas, static dischargers and low-visibility fin emblem.
box('Dorsal antenna base',(0,-3.6,4.51),(.42,1.3,.13),shade,fuse,.06)
wing('Swept dorsal aerial',[(0,-3.0,.85,4.54),(.06,-3.3,.40,5.10)],shade,fuse)
for side in [-1,1]:
    text('Fin serial','027',(side*.15,-11.7,6.55),.66,white,tail,(math.pi/2,0,side*math.pi/2))
    text('Fin type','HX / PEREGRINE',(side*.15,-10.45,5.15),.16,white,tail,(math.pi/2,0,side*math.pi/2))
# Tandem cockpit, recessed floor, two finished seats, harnesses and instrumentation.
box('Cockpit structural tub',(0,8.6,3.8),(1.95,4.5,.16),black,cockpit,.10)
for idx,y in enumerate([9.45,7.45]):
    s=empty('Seat_'+str(idx+1),cockpit)
    box('Seat shell',(0,y-.25,4.46),(.78,.38,1.10),seat,s,.12)
    box('Seat pan',(0,y+.06,4.00),(.75,.83,.15),seat,s,.10)
    box('Seat cushion',(0,y+.06,4.11),(.65,.70,.16),cushion,s,.07)
    box('Back cushion',(0,y-.02,4.51),(.62,.16,.68),cushion,s,.06)
    box('Ejection headrest',(0,y-.27,5.02),(.49,.31,.28),seat,s,.07)
    for side in [-1,1]:
        line('Shoulder restraint',[(side*.20,y-.05,4.85),(side*.21,y+.09,4.43),(side*.07,y+.28,4.2)],.033,belt,s)
        line('Lap restraint',[(side*.33,y+.06,4.22),(side*.07,y+.31,4.21)],.033,belt,s)
        cyl('Ejection seat rail',(side*.34,y-.48,3.87),(side*.34,y-.48,4.99),.035,metal,s)
    box('Harness buckle',(0,y+.3,4.22),(.14,.06,.09),metal,s,.015)
    line('Ejection handle',[(-.14,y+.39,4.15),(-.14,y+.46,4.28),(.14,y+.46,4.28),(.14,y+.39,4.15)],.023,amber,s)
    cyl('Control stick',(0,y+.48,4.10),(0,y+.44,4.50),.037,black,s)
    box('Stick grip',(0,y+.44,4.56),(.095,.095,.17),seat,s,.035)
    for side in [-1,1]:box('Rudder pedal',(side*.21,y+.73,3.98),(.21,.11,.16),metal,s,.025)
    # Instrument binnacle in front of each seat, below the pilot eye line.
    yy=y+(.60 if idx==0 else .82);panel=empty('Instrument_panel_'+str(idx+1),cockpit)
    box('Instrument panel',(0,yy,4.30),(1.02,.16,.54),seat,panel,.08)
    box('Dashboard glare shield',(0,yy,4.61),(1.05,.28,.07),black,panel,.035)
    for x in [-.33,0,.33]:
        box('MFD bezel',(x,yy-.10,4.32),(.28,.03,.24),black,panel,.025)
        box('MFD glass',(x,yy-.119,4.32),(.228,.008,.184),green,panel,.006)
        for k in range(4):
            line('MFD symbology',[(x-.08,yy-.125,4.26+k*.035),(x+.045+(k%2)*.03,yy-.125,4.26+k*.035)],.003,white,panel)
    for side in [-1,1]:
        box('Side console',(side*.70,y+.06,4.1),(.30,1.14,.27),seat,cockpit,.05)
        for k in range(6):
            cyl('Console switch',(side*.70,y-.35+k*.13,4.25),(side*.70,y-.35+k*.13,4.28),.018,metal,cockpit,vertices=8)
        cyl('Throttle lever',(side*.70,y+.21,4.25),(side*.70,y+.21,4.44),.025,metal,cockpit)
        box('Throttle handle',(side*.70,y+.21,4.46),(.11,.08,.065),black,cockpit,.02)
# Fitted glazing: perimeter follows the actual cockpit cut, with a fixed windscreen.
def hull_top(x,y):
    lo,hi=0,math.pi/2
    for _ in range(36):
        mid=(lo+hi)/2
        if skinpoint(y,mid)[0]>abs(x):lo=mid
        else:hi=mid
    return skinpoint(y,(lo+hi)/2)[2]
def opening_equation(x,y):return (x/1.1)**2+((y-8.7)/2.6)**2+((hull_top(x,y)-4.95)/1.7)**2-1
def end_root(a,b):
    fa=opening_equation(0,a)
    for _ in range(40):
        m=(a+b)/2
        if opening_equation(0,m)*fa>0:a=m
        else:b=m
    return (a+b)/2
rear_edge=end_root(6.0,6.5);front_edge=end_root(10.8,11.4)
def rim(y):
    lo,hi=0,1.1
    for _ in range(36):
        mid=(lo+hi)/2
        if opening_equation(mid,y)<0:lo=mid
        else:hi=mid
    x=(lo+hi)/2;return x,hull_top(x,y)+.015
canopy=empty('Canopy',cockpit);canopy['axis']='glTF X';canopy['hinge_glTF']=[0,hull_top(0,rear_edge)+.03,-rear_edge]
windshield=empty('Windscreen',cockpit)
span=front_edge-rear_edge
# A smooth crown clears both headrests while staying low at the nose and tail.
def crown(y):
    t=max(0,min(1,(y-rear_edge)/span))
    return 1.42*math.sin(math.pi*t)**.72

def glass_section(name,a,b,parent):
    count=max(12,int((b-a)*24));cross=56;v=[];f=[]
    for i in range(count+1):
        y=a+(b-a)*i/count;x,z=rim(y);h=crown(y)
        for j in range(cross+1):
            theta=j*math.pi/cross
            v.append((x*math.cos(theta),y,z+h*math.sin(theta)))
    for i in range(count):
        for j in range(cross):
            k=i*(cross+1)+j;f.append((k,k+1,k+cross+2,k+cross+1))
    if a<rear_edge+.01:
        cap=len(v);v.append((0,rear_edge,hull_top(0,rear_edge)+.015))
        f.extend([(cap,j+1,j) for j in range(cross)])
    if b>front_edge-.01:
        cap=len(v);v.append((0,front_edge,hull_top(0,front_edge)+.015));base=count*(cross+1)
        f.extend([(cap,base+j,base+j+1) for j in range(cross)])
    obj=mesh(name,v,f,glass,parent)
    shell=obj.modifiers.new('Laminated optical edge','SOLIDIFY');shell.thickness=.006;shell.offset=0
    for side in [-1,1]:
        points=[(side*rim(a+(b-a)*i/count)[0],a+(b-a)*i/count,rim(a+(b-a)*i/count)[1]) for i in range(count+1)]
        if a<rear_edge+.01:points.insert(0,(0,rear_edge,hull_top(0,rear_edge)+.015))
        if b>front_edge-.01:points.append((0,front_edge,hull_top(0,front_edge)+.015))
        line(name+' | perimeter rail',points,.042,black,parent)
    return obj
split=10.05
main_glass=glass_section('Bubble canopy glazing',rear_edge+.004,split,canopy)
glass_section('Fixed windscreen glazing',split+.032,front_edge-.004,windshield)
for y,parent,label in [(split,canopy,'Canopy forward arch'),(split+.032,windshield,'Windscreen rear arch')]:
    x,z=rim(y);line(label,[(x*math.cos(j*math.pi/80),y,z+crown(y)*math.sin(j*math.pi/80)) for j in range(81)],.032,shade,parent)
# Fixed gasket and coaming bridge the cut skin to the moving canopy rails.
for side in [-1,1]:
    pts=[];inner_pts=[]
    for i in range(121):
        y=rear_edge+.003+(span-.006)*i/120;x,z=rim(y)
        pts.append((side*x,y,z-.018));inner_pts.append((side*(x-.032),y,z-.07))
    line('Cockpit weather seal',pts,.037,black,cockpit)
    vv=[]
    for p,q in zip(pts,inner_pts):vv.extend([p,q])
    mesh('Cockpit fitted inner coaming',vv,[(2*i,2*i+1,2*i+3,2*i+2) for i in range(120)],seat,cockpit)
    hinge_y=rear_edge+.06;hinge_z=hull_top(0,rear_edge)+.035
    cyl('Canopy rear hinge pin',(side*.11,hinge_y,hinge_z),(side*.25,hinge_y,hinge_z),.038,metal,cockpit)
    box('Canopy hinge clevis',(side*.19,hinge_y,hinge_z-.04),(.12,.19,.12),shade,cockpit,.025)
    for yy in [7.0,8.7,9.6]:
        x,z=rim(yy);box('Canopy recessed latch',(side*(x-.025),yy,z-.075),(.07,.18,.065),metal,cockpit,.012)

# Forward HUD and clear combiner.
box('HUD projector',(0,10.33,4.43),(.35,.35,.14),black,cockpit,.04)
hud=box('HUD combiner',(0,10.40,4.68),(.42,.016,.25),glass,cockpit,.02)
line('HUD flight ladder',[(-.12,10.38,4.68),(.12,10.38,4.68)],.005,green,cockpit)
# Approved six-wheel layout: twin nose tires and one twin-wheel main strut per side.
steer=empty('Nose_steering',gear,(0,7.05,.78));steer['axis']='glTF Y'
cyl('Nose upper oleo',(0,7.05,1.72),(0,7.05,.98),.12,shade,steer)
cyl('Nose polished piston',(0,7.05,1.16),(0,7.05,.49),.076,bright,steer)
line('Nose torque scissors',[(0,6.94,1.40),(0,6.70,1.04),(0,6.96,.76)],.038,metal,steer)
for side in [-1,1]:cyl('Nose fork',(0,7.05,.70),(side*.24,7.05,.42),.059,metal,steer)
# Angled, contoured gear-door skins meet the bay lip; no floating rectangular boards.
def gear_door(name,x,y,z,length,height,parent):
    door=empty(('Nose_door_' if name.startswith('Nose') else 'Main_door_')+('Left' if x<0 else 'Right'),None,(x,y,z));parent_world(door,parent);parent=door
    pts=[(x,y-length*.5,z),(x,y+length*.5,z),(x,y+length*.37,z-height*.86),(x,y-length*.39,z-height)]
    o=mesh(name,pts,[(0,1,2,3)],shade,parent,False)
    sol=o.modifiers.new('Door skin thickness','SOLIDIFY');sol.thickness=.035;bevel(o,.022,3)
    line('Bay door perimeter',pts,.01,paint,parent,True)
    for yy in [y-length*.30,y+length*.30]:cyl('Door hinge pin',(x,yy-.06,z),(x,yy+.06,z),.026,metal,parent)
for side in [-1,1]:gear_door('Nose bay door',side*.40,7.08,1.57,1.34,.34,gear)

def wheel(n,x,y,r,parent):
    z=r;g=empty(n,None,(x,y,z));parent_world(g,parent);g['axis']='local X'
    torus('Tire',(x,y,z),r*.73,r*.27,rubber,g,'X')
    for dx in [-.055,.055]:torus('Tread channel',(x+dx,y,z),r*.985,.009,seam,g,'X')
    cyl('Axle',(x-.17,y,z),(x+.17,y,z),r*.46,metal,g,32)
    for side in [-1,1]:
        xx=x+side*.18;torus('Forged wheel rim',(xx,y,z),r*.47,.026,bright,g,'X',32)
        cyl('Hub cap',(xx,y,z),(xx+side*.035,y,z),r*.16,shade,g,24)
        for j in range(8):
            a=j*math.tau/8;cyl('Wheel hub fastener',(xx,y+math.sin(a)*r*.31,z+math.cos(a)*r*.31),(xx+side*.025,y+math.sin(a)*r*.31,z+math.cos(a)*r*.31),.022,metal,g,8)
    return g
for side in [-1,1]:wheel('Nose_wheel_'+str(side),side*.24,7.05,.42,steer)
for side,label in [(-1,'Left'),(1,'Right')]:
    x=side*2.05;y=-2.45
    bogie=empty('Main_gear_'+label,gear,(x,y,.62));bogie['axis']='local X'
    cyl('Main gear upper leg',(side*1.25,y+.30,2.16),(x,y,1.06),.17,shade,bogie)
    cyl('Main polished oleo',(side*1.87,y+.06,1.35),(x,y,.65),.11,bright,bogie)
    cyl('Twin-wheel axle',(x-.48,y,.62),(x+.48,y,.62),.13,metal,bogie)
    line('Main gear drag brace',[(side*1.35,y+.83,1.91),(side*1.68,y+.48,1.10),(x,y,.75)],.071,shade,bogie)
    line('Main torque scissors',[(x,y-.14,1.42),(x,y-.35,1.0),(x,y-.14,.78)],.042,metal,bogie)
    line('Brake hydraulic loop',[(x+.10,y-.05,1.54),(x+.17,y-.18,.93),(x+.23,y-.08,.62)],.016,black,bogie)
    for tire in [-1,1]:wheel('Main_wheel_'+label+'_'+str(tire),x+tire*.34,y,.62,bogie)
    gear_door('Main outboard bay door',side*2.56,y,1.65,1.73,.38,gear)
# Small inspection covers and intentionally sparse manufactured fasteners.
for side in [-1,1]:
    for y in [3.4,2.8,2.2,1.6]:
        rx,rz,zc=body(y);line('Cooling louvre',[(side*(rx+.015),y,zc+.65),(side*(rx-.10),y-.12,zc+1.0)],.045,black,fuse)
    for y in [-8.8,-8.3,-7.8]:
        rx,rz,zc=body(y);line('Avionics outlet',[(side*(rx+.018),y,zc+.08),(side*(rx+.016),y,zc+.4)],.029,black,fuse)
    for yy in [10.7,10.15,9.6]:
        rx,rz,zc=body(yy);cyl('Forward access fastener',(side*(rx+.007),yy,zc+.1),(side*(rx+.02),yy,zc+.1),.018,metal,fuse,8)
# Small service annotations set into visible shoulder areas.
for side in [-1,1]:
    text('Rescue stencil','RESCUE →',(side*1.7,8.7,3.85),.14,amber,fuse,(math.pi/2,0,side*math.pi/2))
    text('Intake warning','DANGER  INTAKE',(side*2.2,6.5,3.5),.11,white,engines[side],(math.pi/2,0,side*math.pi/2))
# Save asset separately from studio. Apply export-safe modifiers and curves once.
print('PEREGRINE: geometry built',flush=True)
bpy.ops.object.select_all(action='DESELECT')
for o in list(collection.objects):
    if o.type in {'CURVE','FONT'}:
        bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False)
    if o.type=='MESH':
        bpy.context.view_layer.objects.active=o
        for mod in list(o.modifiers):
            try:bpy.ops.object.modifier_apply(modifier=mod.name)
            except RuntimeError:pass
# Wrap service markings onto their actual supporting skins to prevent clipping.
def world_tree(objects):
    vs=[];fs=[]
    for obj in objects:
        off=len(vs);vs.extend([obj.matrix_world@v.co for v in obj.data.vertices]);fs.extend([tuple(off+i for i in p.vertices) for p in obj.data.polygons])
    return BVHTree.FromPolygons(vs,fs)
body_tree=world_tree([hull])
fin_tree=world_tree([o for o in collection.objects if o.type=='MESH' and o.name in ['Swept vertical stabilizer','Rudder airfoil']])
for obj in collection.objects:
    if obj.type!='MESH' or not obj.name.startswith(('Fin serial','Fin type','Side serial','Rescue stencil','Intake warning')):continue
    tree=fin_tree if obj.name.startswith('Fin') else body_tree
    inverse=obj.matrix_world.inverted()
    for vertex in obj.data.vertices:
        p=obj.matrix_world@vertex.co;side=1 if p.x>0 else -1
        hit,normal,index,distance=tree.ray_cast(Vector((side*40,p.y,p.z)),Vector((-side,0,0)))
        if hit is not None:
            hit.x+=side*.006;vertex.co=inverse@hit
for obj in collection.objects:
    if obj.type=='MESH':
        bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free()
# Join small fixed pieces by material and parent, preserving every articulated group.
from collections import defaultdict
batches=defaultdict(list)
for o in list(collection.objects):
    if o.type=='MESH' and len(o.data.materials)==1 and not o.name.startswith(('Bubble canopy','Sculpted pressure','Pointed graphite')):
        batches[(o.parent,o.data.materials[0])].append(o)
for (parent,material),objects in batches.items():
    if len(objects)<2:continue
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();objects[0].name=parent.name+' | '+material.name
# Inspection facts from evaluated export geometry.
verts=[];triangles=0;meshes=[]
for o in collection.objects:
    if o.type!='MESH':continue
    o.data.calc_loop_triangles();triangles+=len(o.data.loop_triangles);verts.extend([o.matrix_world@v.co for v in o.data.vertices]);meshes.append(o.name)
low=[min(v[i] for v in verts) for i in range(3)];high=[max(v[i] for v in verts) for i in range(3)]
facts={'name':'Peregrine HX-27','bounds_m':{'min':low,'max':high,'dimensions':[high[i]-low[i] for i in range(3)]},'triangles':triangles,'mesh_count':len(meshes),'parts':[o.name for o in collection.objects if o.type=='EMPTY'],'references':['references/A-fighter.png','references/B-transport.png','references/approved-six-wheel-study.png'],'wheel_count':6,'iteration':2}
(ROOT/'validation/model-facts.json').write_text(json.dumps(facts,indent=2))
# Export only aircraft, with meters preserved and rig parents intact.
bpy.ops.object.select_all(action='DESELECT')
for o in collection.objects:o.select_set(True)
scene.world.color=(.18,.18,.18)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'Peregrine-HX27.blend'))
bpy.ops.export_scene.gltf(filepath=str(PROJECT/'public/assets/peregrine-hx27.glb'),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_cameras=False,export_lights=False)
print('PEREGRINE: exported',triangles,'triangles',len(meshes),'meshes',flush=True)
# Studio presentation, kept in its own blend so the asset stays clean.
world=bpy.data.worlds.new('Soft blue studio');scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs['Color'].default_value=(.19,.24,.29,1);world.node_tree.nodes['Background'].inputs['Strength'].default_value=.45
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.02));floor=bpy.context.object;floor.name='Studio floor';floor.data.materials.append(mat('Studio | warm neutral','#C5C9C5',.85))
def area(n,pos,power,size,color):
    data=bpy.data.lights.new(n,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color;o=bpy.data.objects.new(n,data);scene.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector((0,0,2.5))-o.location).to_track_quat('-Z','Y').to_euler()
area('Key softbox',(12,12,25),6500,15,(1,.94,.83));area('Cool fill',(-15,3,13),4500,13,(.78,.89,1));area('Rim strip',(5,-19,20),7500,11,(.92,.96,1))
scene.render.engine='CYCLES';scene.cycles.samples=args.samples;scene.cycles.use_denoising=True
scene.render.resolution_x=1600;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
data=bpy.data.cameras.new('Presentation camera');camera=bpy.data.objects.new('Presentation camera',data);scene.collection.objects.link(camera);scene.camera=camera;data.type='ORTHO';data.lens=55
views={'beauty':((28,35,22),(0,0,3),38),'side':((42,1,8),(0,0,3.4),36),'front':((0,44,9),(0,0,3.3),30),'rear':((26,-36,16),(0,-2,3),37),'top':((0,0,55),(0,0,0),37),'cockpit':((8,18,10),(0,8.5,4.4),11)}
for view in args.views.split(','):
    if view not in views:continue
    pos,target,scale=views[view];camera.location=pos;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();data.ortho_scale=scale
    scene.render.filepath=str(ROOT/'renders'/f'{view}.png');bpy.ops.render.render(write_still=True);print('PEREGRINE: rendered',view,flush=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'Peregrine-HX27-studio.blend'))
print('PEREGRINE_DONE',flush=True)
