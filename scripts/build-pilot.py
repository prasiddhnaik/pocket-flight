"""Builds the pilot who sits in every aircraft: public/assets/pilot/fighter-pilot.glb and src/aircraft/pilot-rig.json.

Run with: blender --background --factory-startup --python scripts/build-pilot.py -- <folder holding scene.gltf>
Pack the atlas first with: python3 -I scripts/build-pilot-atlas.py <same folder>

Based on "Fighter Pilot Character" (https://sketchfab.com/3d-models/fighter-pilot-character-9c53b42d13994cefa8916729021b3104)
by SoftNote (https://sketchfab.com/softnote), licensed under CC-BY-4.0. Modified here: reduced to about a third of its
triangles, textures packed into one atlas, scaled to 1.83 m, turned to face forward and given a skeleton.
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public/assets/pilot/fighter-pilot.glb"
RIG = ROOT / "src/aircraft/pilot-rig.json"
HEIGHT = 1.83
KEEP = 0.3
# Joints measured on the source, in its own units: 6.709 tall, facing -Y, his left at +X.
SPINE = [
    ("hips", (0, 0.05, 3.40), (0, 0.04, 3.90), None),
    ("spine", (0, 0.04, 3.90), (0, 0.0, 4.55), "hips"),
    ("chest", (0, 0.0, 4.55), (0, 0.0, 5.42), "spine"),
    ("neck", (0, 0.0, 5.42), (0, -0.02, 5.72), "chest"),
    ("head", (0, -0.02, 5.72), (0, -0.05, 6.45), "neck"),
]
LIMB = [
    # The shoulder joint sits inside the deltoid, on the line of the upper arm.
    ("clavicle", (0.12, 0.02, 5.28), (0.71, 0.07, 5.27), "chest"),
    ("upperarm", (0.71, 0.07, 5.27), (1.45, 0.12, 4.30), "clavicle"),
    ("forearm", (1.45, 0.12, 4.30), (1.98, -0.05, 3.45), "upperarm"),
    ("hand", (1.98, -0.05, 3.45), (2.32, -0.15, 3.08), "forearm"),
    ("thigh", (0.36, 0.05, 3.38), (0.36, 0.0, 1.83), "hips"),
    ("shin", (0.36, 0.0, 1.83), (0.42, 0.15, 0.33), "thigh"),
    ("foot", (0.42, 0.15, 0.33), (0.48, -0.50, 0.08), "shin"),
]
EYE = (0.0, -0.17, 5.97)
ARMS, LEGS = ("upperarm", "forearm", "hand"), ("thigh", "shin", "foot")
# The flotation collar, neck wrap and mask hose ride on the neck: from the seat they fold away with the head.
COLLAR = ("C-LIFEVEST", "C-NECKWRAP", "H-PIPECABLE")
COLLAR_ABOVE = 5.0
# Helmet, mask and visor: wholly on the head, so nothing is left smeared in front of the camera when it folds.
HEAD_ABOVE = 5.66


def bones():
    out = list(SPINE)
    for side, sign in (("L", 1), ("R", -1)):
        for name, head, tail, parent in LIMB:
            mirror = lambda p: (sign * p[0], p[1], p[2])
            out.append((f"{name}_{side}", mirror(head), mirror(tail), parent if parent in ("chest", "hips") else f"{parent}_{side}"))
    return out


def select(objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def atlas_material():
    material = bpy.data.materials.new("Pilot")
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes["Principled BSDF"]

    def image(name, colour):
        node = nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(str(ROOT / f"assets/pilot/atlas-{name}.jpg"))
        node.image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
        return node

    links.new(image("color", True).outputs["Color"], shader.inputs["Base Color"])
    split = nodes.new("ShaderNodeSeparateColor")
    links.new(image("orm", False).outputs["Color"], split.inputs["Color"])
    links.new(split.outputs["Green"], shader.inputs["Roughness"])
    links.new(split.outputs["Blue"], shader.inputs["Metallic"])
    bump = nodes.new("ShaderNodeNormalMap")
    links.new(image("normal", False).outputs["Color"], bump.inputs["Color"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return material


def visor_material():
    material = bpy.data.materials.new("Pilot_visor")
    material.use_nodes = True
    shader = material.node_tree.nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = (0.05, 0.06, 0.08, 1.0)
    shader.inputs["Roughness"].default_value = 0.08
    shader.inputs["Alpha"].default_value = 0.4
    material.surface_render_method = "BLENDED"
    return material


def segment_distance(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def allowed(name, p, s):
    """Keeps sleeves off the torso, legs off the hands and so on; p is in metres, s metres per source unit."""
    side = name[-1] if name[-2:] in ("_L", "_R") else ""
    if side and abs(p.x) > 0.03 and (p.x < 0) != (side == "L"):
        return False
    base = name[:-2] if side else name
    if base in ARMS:
        return abs(p.x) > 0.70 * s and p.z > 2.9 * s
    if base in LEGS:
        return p.z < 3.6 * s and abs(p.x) < 0.85 * s
    if base in ("hips", "spine", "chest", "clavicle"):
        return abs(p.x) < 1.0 * s or p.z > 5.1 * s
    return p.z > 5.3 * s


def weigh(obj, segments, s, head_z):
    groups = {name: obj.vertex_groups.new(name=name) for name in segments}
    collar = obj.vertex_groups.get("collar")
    for v in obj.data.vertices:
        p = v.co
        if collar and any(g.group == collar.index for g in v.groups):
            groups["neck"].add([v.index], 1.0, "REPLACE")
            continue
        if p.z > head_z:
            groups["head"].add([v.index], 1.0, "REPLACE")
            continue
        scored = sorted(((1.0 / (segment_distance(p, a, b) + 0.01) ** 4, name) for name, (a, b) in segments.items() if allowed(name, p, s)), reverse=True)[:3]
        total = sum(w for w, _ in scored)
        for w, name in scored:
            groups[name].add([v.index], w / total, "REPLACE")


def main(source):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source / "scene.gltf"))
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for obj in meshes:
        obj.data.transform(obj.matrix_world)
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
    for obj in [o for o in bpy.context.scene.objects if o.type != "MESH"]:
        bpy.data.objects.remove(obj)
    points = [v.co for o in meshes for v in o.data.vertices]
    low = min(p.z for p in points)
    s = HEIGHT / (max(p.z for p in points) - low)
    # Soles on the ground, facing +Y (forward in the game once exported), in metres.
    place = Matrix.Translation((0, 0, -low * s)) @ Matrix.Rotation(math.pi, 4, "Z") @ Matrix.Scale(s, 4)
    cells = json.loads((ROOT / "assets/pilot/atlas.json").read_text())["cells"]
    body, visor = atlas_material(), visor_material()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    opaque = []
    for obj in meshes:
        obj.data.transform(place)
        name = obj.material_slots[0].material.name
        decimate = obj.modifiers.new("Decimate", "DECIMATE")
        decimate.ratio, decimate.use_collapse_triangulate = KEEP, True
        depsgraph.update()
        old = obj.data
        obj.data = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
        obj.modifiers.clear()
        bpy.data.meshes.remove(old)
        obj.data.shade_smooth()
        obj.data.materials.clear()
        if name not in cells:
            obj.data.materials.append(visor)
            obj.name = "Pilot_visor"
            continue
        # Each material's UVs sit in whole tiles of one wrapping texture: move each face's tile into its cell.
        u0, v0, u1, v1 = cells[name]
        uv = obj.data.uv_layers.active.data
        for face in obj.data.polygons:
            loops = list(face.loop_indices)
            tu = math.floor(sum(uv[i].uv.x for i in loops) / len(loops))
            tv = math.floor(sum(uv[i].uv.y for i in loops) / len(loops))
            for i in loops:
                fu, fv = uv[i].uv.x - tu, uv[i].uv.y - tv
                uv[i].uv = (u0 + fu * (u1 - u0), v0 + fv * (v1 - v0))
        obj.data.materials.append(body)
        if name in COLLAR:
            obj.vertex_groups.new(name="collar").add([v.index for v in obj.data.vertices if v.co.z > (COLLAR_ABOVE - low) * s], 1.0, "REPLACE")
        opaque.append(obj)
    select(opaque)
    bpy.ops.object.join()
    figure = opaque[0]
    figure.name = "Pilot_body"
    parts = [figure, bpy.data.objects["Pilot_visor"]]
    # Skeleton.
    armature = bpy.data.objects.new("Pilot", bpy.data.armatures.new("Pilot"))
    bpy.context.scene.collection.objects.link(armature)
    select([armature])
    bpy.ops.object.mode_set(mode="EDIT")
    edit = armature.data.edit_bones
    for name, head, tail, parent in bones():
        bone = edit.new(name)
        bone.head, bone.tail = place @ Vector(head), place @ Vector(tail)
        if parent:
            bone.parent = edit[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    segments = {name: (place @ Vector(head), place @ Vector(tail)) for name, head, tail, _ in bones()}
    for obj in parts:
        weigh(obj, segments, s, (HEAD_ABOVE - low) * s)
        if "collar" in obj.vertex_groups:
            obj.vertex_groups.remove(obj.vertex_groups["collar"])
        obj.parent = armature
        obj.modifiers.new("Skeleton", "ARMATURE").object = armature
    triangles = sum(len(p.vertices) - 2 for obj in parts for p in obj.data.polygons)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    select([armature, *parts])
    bpy.ops.export_scene.gltf(
        filepath=str(OUT), export_format="GLB", use_selection=True, export_yup=True, export_apply=False, export_skins=True,
        export_animations=False, export_morph=False, export_normals=True, export_tangents=False, export_materials="EXPORT",
        export_image_format="AUTO", export_cameras=False, export_lights=False, export_extras=False,
    )
    eye = place @ Vector(EYE)
    # Game axes: x right, y up, z aft.
    RIG.write_text(json.dumps({"eye": [round(eye.x, 4), round(eye.z, 4), round(-eye.y, 4)], "height": HEIGHT, "triangles": triangles}, indent=1) + "\n")
    print("PILOT", json.dumps({"triangles": triangles, "bones": len(bones()), "metresPerUnit": round(s, 5), "bytes": OUT.stat().st_size}))


if __name__ == "__main__":
    main(Path(sys.argv[sys.argv.index("--") + 1]))
