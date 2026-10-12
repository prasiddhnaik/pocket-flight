"""Fitted concept-trainer internal packaging; authoring metres, +Y forward."""
import math
import bpy
import bmesh
from mathutils import Vector


def build_internal_systems(group, box, mesh, tube, cylinder, label, cockpit,
                           surface, interp, frame, metal, rubber, ivory, red):
    # Fixed partition behind the seat/headrest envelope, below the moving canopy.
    rear = group('RearCabinBulkhead', parent=cockpit)
    rear['purpose'] = 'Separates occupants from aft dry equipment bay'
    y = -.94
    arch = []
    for i in range(49):
        a = math.pi*i/48
        direction = Vector((math.cos(a),0,math.sin(a)))
        hit = surface.ray_cast(Vector((0,y,.02)),direction)
        if hit[0] is None: raise RuntimeError('Rear bulkhead has no closed fuselage section')
        p = hit[0]-direction*.016
        arch.append((p.x,p.z))
    profile = [(-.457, -.191), (.449, -.191)] + arch
    n = len(profile)
    verts = [(x, yy, z) for yy in [y-.012, y+.012] for x, z in profile]
    faces = [tuple(reversed(range(n))), tuple(n+i for i in range(n))]
    faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
    wall = mesh('Fitted rear cabin partition', verts, faces, frame, rear, False)
    wall['seat_back_clearance_m'] = .53
    tube('Rear partition perimeter seal', [(x,y+.014,z) for x,z in profile]+[(profile[0][0],y+.014,profile[0][1])], .008, rubber, rear)
    # Service hatch faces the cabin. All fasteners are flush, not exposed rods.
    box('Rear service hatch', (0,y+.016,.21), (.43,.011,.39), metal, rear, .017)
    box('Rear service hatch inset', (0,y+.023,.21), (.395,.006,.35), frame, rear, .012)
    for x in [-.193,.193]:
        for z in [.055,.365]:
            cylinder('Rear hatch captive screw', (x,y+.027,z), (x,y+.030,z), .004, metal, rear, 12)
    legend = label('Rear hatch legend', 'SERVICE ACCESS', (0,y+.031,.29), .012, ivory, rear)
    legend.rotation_euler.z = math.pi  # This hatch faces forward, opposite the instrument panel.
    for x in [-.32,.32]:
        box('Rear trim inset', (x,y+.016,.17), (.10,.014,.27), rubber, rear, .018)
    box('Baggage shelf lip', (0,y+.027,-.14), (.88,.052,.065), frame, rear, .01)
    box('Rear cabin floor extension', (0,-.842,-.232), (.78,.194,.066), rubber, rear, .012)

    systems = group('InternalSystems', parent=cockpit)
    systems['mechanical'] = True  # Remain opaque when the inspection shell is ghosted.
    systems['inspection_bounds_glTF'] = [[-.54,-.50,-.95],[.54,.42,1.75]]
    systems['packaging_scope'] = 'Original concept installation, not a certified fuel-system design'
    fuel = group('BellyFuelBay', parent=systems)
    fuel['purpose'] = 'Shaped underfloor fuel cell, supported away from cabin and dry electrics'

    def inner_bottom(x, yy):
        p = Vector((x, yy, -2))
        direction = Vector((0,0,1))
        outer = surface.ray_cast(p, direction)
        if outer[0] is None:
            raise RuntimeError('No fuselage under fuel bay')
        inner = surface.ray_cast(outer[0]+direction*.00001, direction)
        if inner[0] is None:
            raise RuntimeError('No inner fuselage under fuel bay')
        return inner[0].z

    # A broad shallow cell follows the shell, rather than a box through the belly.
    # 18 mm skin gap; 16 mm separation below the existing structural floor.
    xs = [-.37 + .74*i/16 for i in range(17)]
    ys = [-.64 + 1.57*i/24 for i in range(25)]
    top = -.299
    bottoms = [inner_bottom(x,yy)+.018 for yy in ys for x in xs]
    if max(bottoms) >= top-.008:
        raise RuntimeError('Fuel cell has insufficient depth at fuselage edge')
    verts = [(x,yy,bottoms[j*17+i]) for j,yy in enumerate(ys) for i,x in enumerate(xs)]
    verts += [(x,yy,top) for yy in ys for x in xs]
    offset = 17*25
    faces = []
    for j in range(24):
        for i in range(16):
            k = j*17+i
            faces += [(k,k+1,k+18,k+17), (k+offset,k+17+offset,k+18+offset,k+1+offset)]
    boundary = list(range(17))+[j*17+16 for j in range(1,25)]+list(range(423,407,-1))+[j*17 for j in range(23,0,-1)]
    for a,b in zip(boundary,boundary[1:]+boundary[:1]):
        faces.append((a,b,b+offset,a+offset))
    tank = mesh('Conformal belly fuel cell', verts, faces, metal, fuel, False)
    bm = bmesh.new(); bm.from_mesh(tank.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    volume = abs(bm.calc_volume(signed=True)); bm.to_mesh(tank.data); bm.free()
    tank.data.calc_loop_triangles()
    signed_volume = 0
    moment = Vector((0,0,0))
    for t in tank.data.loop_triangles:
        a,b,c = [tank.data.vertices[i].co for i in t.vertices]
        v = a.dot(b.cross(c))/6
        signed_volume += v
        moment += (a+b+c)*(v/4)
    centroid = moment/signed_volume
    # Export the measured geometric capacity; flight fuel mass stays with the physics owner.
    tank['envelope_litres'] = volume*1000
    tank['usable_fuel_litres'] = volume*1000*.94
    tank['nominal_fuel_density_kg_per_l'] = .72
    fuel['envelope_litres'] = volume*1000
    fuel['usable_fuel_litres'] = volume*1000*.94
    fuel['physics_mass_updated'] = False
    fuel['fuel_centroid_glTF'] = [centroid.x, centroid.z, -centroid.y]
    # Tank straps and elastomer isolators stay entirely under the structural floor.
    for yy in [-.45,.12,.70]:
        pts = [(x,yy,top+.004) for x in xs]
        tube('Fuel cell retaining strap', pts, .005, frame, fuel)
        for x in [-.34,.34]:
            box('Fuel tray isolator', (x,yy,top+.008), (.045,.09,.012), rubber, fuel, .003)
    for yy in [-.32,.32]:
        # Low baffles model the real anti-slosh partition envelope inside the cell.
        bottom = max(inner_bottom(x,yy)+.024 for x in [-.30,.30])
        box('Fuel anti-slosh baffle', (0,yy,(top+bottom)/2), (.60,.006,top-bottom-.008), frame, fuel, .002)
    sump = inner_bottom(0,.05)+.025
    cylinder('Fuel pickup strainer', (0,.05,sump), (0,.05,sump+.035), .018, frame, fuel)
    tube('Protected fuel feed', [(0,.05,sump+.028),(.08,.05,top-.02),(.08,.80,top-.02)], .004, rubber, fuel)
    # The drain is at the cell low point, reachable through a belly service panel.
    cylinder('Fuel sump drain', (0,.05,sump-.008), (0,.05,sump+.012), .009, metal, fuel)
    box('Fuel shutoff valve', (.08,.80,top-.02), (.05,.045,.035), metal, fuel, .004)
    tube('Fuel vent riser', [(-.30,-.54,top-.018),(-.30,-.56,-.12),(-.37,-.80,.12)], .003, metal, systems)
    box('Fuel filler neck mounting', (-.37,-.80,.12), (.055,.06,.045), frame, systems, .006)
    cylinder('Fuel filler cap', (-.37,-.81,.12), (-.37,-.82,.12), .024, metal, systems)

    dry = group('AftEquipmentBay', parent=systems)
    dry['purpose'] = 'Dry electrical and control installation isolated from the underfloor fuel cell'
    box('Dry equipment tray', (0,-1.02,-.13), (.56,.54,.024), metal, dry, .008)
    for x in [-.27,.27]:
        box('Equipment tray bearer', (x,-1.02,-.155), (.035,.55,.035), frame, dry, .005)
    box('Battery enclosure', (-.17,-1.00,-.025), (.24,.28,.17), rubber, dry, .015)
    for yy in [-1.09,-.91]:
        box('Battery hold-down strap', (-.17,yy,.064), (.26,.019,.011), metal, dry, .003)
    for x,mat in [(-.23,red),(-.11,rubber)]:
        cylinder('Battery terminal boot', (x,-1,.059), (x,-1,.076), .012, mat, dry, 16)
    box('Avionics equipment enclosure', (.17,-1.01,-.007), (.25,.31,.20), frame, dry, .012)
    for i in range(6):
        box('Avionics cooling fin', (.17,-1.14+i*.045,.102), (.23,.008,.020), metal, dry, .002)
    box('Electrical contactor', (-.17,-.77,-.023), (.13,.08,.08), metal, dry, .006)
    box('Fuse and distribution block', (.17,-.77,.016), (.19,.075,.095), rubber, dry, .006)
    for i in range(5):
        box('Protected fuse cover', (.105+i*.032,-.728,.035), (.019,.01,.032), red, dry, .003)
    tube('Protected power loom', [(-.23,-1,.08),(-.32,-1,.08),(-.32,-.76,.08),(-.14,-.76,.025)], .006, rubber, dry)
    tube('Avionics shielded harness', [(.29,-1,.10),(.36,-1,.10),(.36,-.72,.06),(.24,-.72,.02)], .004, rubber, dry)
    for x in [-.32,.36]:
        for yy in [-.96,-.84]:
            cylinder('Harness retaining clamp', (x,yy,.073), (x,yy,.090), .009, metal, dry, 12)
    # Compact internal elevator-control torque tube, kept away from both bay trays.
    cylinder('Aft control torque tube', (0,-.73,.16), (0,-1.30,.16), .009, metal, dry)
    for yy in [-.77,-1.26]:
        box('Control bearing support', (0,yy,.14), (.07,.04,.09), frame, dry, .005)
    label('Dry bay service legend', 'DRY EQUIPMENT', (.17,-.847,.058), .009, ivory, dry)
    dry.location.y = -.35
    return {'tank_envelope_litres':volume*1000, 'tank_usable_litres':volume*940,
            'fuel_centroid_glTF_m':[centroid.x,centroid.z,-centroid.y],
            'tank_skin_gap_m':.018, 'tank_floor_gap_m':.016,
            'rear_partition_blender_y_m':y, 'fuel_mass_physics_changed':False,
            'references':['https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_23-10.pdf'],
            'scope':'Geometry packaging and separation; fuel calibration remains a physics integration task'}
