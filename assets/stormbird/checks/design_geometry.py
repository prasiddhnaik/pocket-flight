"""Derive runtime contacts and ground envelopes from the saved CAD mesh transfer.
Static geometry only: no simulator, flight physics or aircraft operation.
"""
import ast
import hashlib
import json
from pathlib import Path
import numpy as np
from scipy.spatial import ConvexHull

root = Path(__file__).resolve().parents[1]
transfer_path = root / 'GLB/cad-transfer.json'
transfer = json.loads(transfer_path.read_text())
parts = transfer['parts']
fixed = np.concatenate([p['vertices'] for p in parts if 'LandingGear' not in p['parents']])
hull = fixed[ConvexHull(fixed).vertices]
wheels = []
for name, datum in transfer['hinges'].items():
    if '_wheel_' not in name:
        continue
    center = np.array(datum['point'])
    tire = next(p for p in parts if p['name'] == name.replace('_wheel_', '_tire_'))
    vertices = np.array(tire['vertices']) - center
    profile = np.column_stack((np.abs(vertices[:, 0]), np.linalg.norm(vertices[:, 1:], axis=1)))
    profile = np.unique(np.round(profile, 7), axis=0)
    profile = profile[ConvexHull(profile).vertices]
    wheels.append({'name': name, 'leg': name.split('_wheel_')[0], 'center': center.tolist(),
                   'radius': round(float(profile[:, 1].max()), 7),
                   'width': round(float(profile[:, 0].max()) * 2, 7), 'profile': profile.tolist()})
assert len(wheels) == 4

# Body + main-tire support on a level plane, including the actual flat tire profile.
def clearance(angle, compression, bank=False):
    c, s = np.cos(angle), np.sin(angle)
    matrix = np.array([[c,-s,0],[s,c,0],[0,0,1]]) if bank else np.array([[1,0,0],[0,c,-s],[0,s,c]])
    body = hull @ matrix.T
    height = -np.inf
    for wheel in wheels:
        if not bank and wheel['leg'] == 'Nose_gear': continue
        point = np.array(wheel['center']); point[1] += compression
        axial = abs(matrix[1, 0]); radial = np.sqrt(1-axial**2)
        support = max(a*axial+r*radial for a,r in wheel['profile'])
        height = max(height, support-(matrix@point)[1])
    index = int(np.argmin(body[:,1]))
    return float(body[index,1]+height), hull[index].tolist()

envelopes = []
for compression in [0, .08, .16]:
    item = {'compression_m': compression}
    for bank, key in [(False,'pitch'), (True,'bank')]:
        low, high = 0, np.deg2rad(35)
        for _ in range(40):
            middle = (low+high)/2
            if clearance(middle, compression, bank)[0] > 0: low = middle
            else: high = middle
        item[key+'_contact_degrees'] = round(float(np.rad2deg(high)), 4)
        item[key+'_limiting_point'] = clearance(high, compression, bank)[1]
    envelopes.append(item)

# Explicit planform convention, excluding the overlapping root fairing.
source = ast.parse((root/'src/stormbird.py').read_text())
stations = next(ast.literal_eval(n.args[0]) for n in ast.walk(source)
                if isinstance(n,ast.Call) and isinstance(n.func,ast.Name)
                and n.func.id=='wing' and isinstance(n.args[0],ast.List))
exposed_area = 2*sum((b[0]-a[0])*(a[2]+b[2])/2 for a,b in zip(stations,stations[1:]))
reference_area = exposed_area+2*stations[0][0]*stations[0][2]
chord_squared = 2*(stations[0][0]*stations[0][2]**2+sum(
    (b[0]-a[0])*(a[2]**2+a[2]*b[2]+b[2]**2)/3 for a,b in zip(stations,stations[1:])))
planform = {'mainWingStationsCAD':stations, 'exposedArea_m2':exposed_area,
    'referenceArea_m2':reference_area, 'span_m':2*stations[-1][0],
    'aspectRatio':(2*stations[-1][0])**2/reference_area,
    'meanAerodynamicChord_m':chord_squared/reference_area,
    'convention':'Main wing only; constant root chord across centerline strip; root fairings excluded.',
    'section':'Custom 9 percent thickness section with 0.4 percent sinusoidal camber; no validated polar.'}
geometry = {'units':'metres', 'up':'Y', 'forward':'-Z', 'centerOffsetY':2,
            'transferSha256':hashlib.sha256(transfer_path.read_bytes()).hexdigest(),
            'bounds': {'min':fixed.min(axis=0).tolist(), 'max':fixed.max(axis=0).tolist()},
            'wheels':wheels, 'legs':transfer['mechanisms']['legs'],
            'bodyHull':np.round(hull,7).tolist(),
            'groundEnvelopes':envelopes,
            'planform':planform,
            'groundPitchLimit':float(np.deg2rad(envelopes[-1]['pitch_contact_degrees']-1))}
target = root.parents[1] / 'src/stormbird-geometry.json'
target.write_text(json.dumps(geometry,separators=(',',':'))+'\n')
report = {k:v for k,v in geometry.items() if k not in ['bodyHull','legs']}
report['bodyHullVertices'] = len(hull)
report['limitations'] = ['Mesh tolerance 0.5 mm; neutral controls and closed canopy.',
    'Ground envelopes use a flat plane and rigid tires, not tire deflection.',
    'No mass, CG, inertia, loads or aerodynamic validity inferred from geometry.']
(root/'validation/design-geometry.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'wheels':len(wheels), 'hullVertices':len(hull), 'envelopes':envelopes, 'output':str(target)}))
