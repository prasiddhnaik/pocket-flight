"""Fit painted wingtip bands to the actual skin; no tubular decoration."""
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def wing_surface(side):
    skin = bpy.data.objects[f'Wing_{side} • Paint']
    skin.data.calc_loop_triangles()
    return BVHTree.FromPolygons(
        [skin.matrix_world @ v.co for v in skin.data.vertices],
        [t.vertices for t in skin.data.loop_triangles], all_triangles=True)


def fit_wing_markings():
    bpy.context.view_layer.update()
    for side, sign in [('Left', -1), ('Right', 1)]:
        obj = bpy.data.objects[f'Wing_{side} • Livery']
        surface = wing_surface(side)
        vertices, faces = [], []
        # Two slim bands follow the cambered upper skin, 0.6 mm above paint.
        for center in [4.78, 4.9]:
            offset = len(vertices)
            for row in range(48):
                y = -.30 + .69 * row / 47
                for column in range(5):
                    x = sign * (center + (column - 2) * .00875)
                    hit, normal, _, _ = surface.ray_cast(Vector((x, y, 3)), Vector((0, 0, -1)))
                    if hit is None: raise RuntimeError('Wing band extends beyond skin')
                    if normal.z < 0: normal.negate()
                    vertices.append(obj.matrix_world.inverted() @ (hit + normal * .0006))
            for row in range(47):
                for column in range(4):
                    a = offset + row * 5 + column
                    face = (a, a+5, a+6, a+1)
                    faces.append(face if sign < 0 else tuple(reversed(face)))
        mesh = bpy.data.meshes.new(f'Wing_{side} painted bands')
        mesh.from_pydata(vertices, [], faces)
        mat = obj.data.materials[0].copy()
        mat.name = f'Livery • coastal teal wing paint {side}'
        shader = mat.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Metallic'].default_value = 0
        shader.inputs['Roughness'].default_value = .4
        mesh.materials.append(mat)
        obj.data = mesh
        obj['detail_type'] = 'Surface-fitted painted bands'
        obj['skin_offset_m'] = .0006


def validate_wing_markings():
    evidence = []
    for side in ['Left', 'Right']:
        obj = bpy.data.objects[f'Wing_{side} • Livery']
        if obj.get('detail_type') != 'Surface-fitted painted bands':
            raise RuntimeError('Tubular wing markings returned')
        surface = wing_surface(side)
        gaps = [surface.find_nearest(obj.matrix_world @ v.co)[3] for v in obj.data.vertices]
        gaps.extend(surface.find_nearest(obj.matrix_world @ p.center)[3] for p in obj.data.polygons)
        if max(gaps) > .001: raise RuntimeError('Wing markings stand off the skin')
        if any((obj.matrix_world.to_3x3() @ p.normal).z < .8 for p in obj.data.polygons):
            raise RuntimeError('Wing paint faces point away from the top surface')
        evidence.append({'side': side, 'vertices': len(obj.data.vertices), 'surface_samples': len(gaps), 'maximum_skin_gap_m': max(gaps)})
    return evidence
