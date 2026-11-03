"""Stand the F-15C next to its reference images in Blender and render it for measuring.

  Blender --background --python scripts/compare-f15c-reference.py
  assets/f15c/.venv/bin/python scripts/measure-f15c-reference.py
  Blender --background --python scripts/compare-f15c-reference.py

Saves assets/f15c-reference.blend: the model with each view of the drawing lined up with
it, and the photos standing beside it. Measuring writes the lined-up crops, so the first
run only places the photos. Renders go to assets/f15c/review/reference/.
Set POCKET_F15C_GLB to compare another export, such as the Blender skin, and
POCKET_F15C_REVIEW for its own output folder.
"""
import bpy, json, math, os
from mathutils import Matrix, Vector

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLB = os.environ.get('POCKET_F15C_GLB') or BASE + '/public/assets/f15c-eagle.glb'
REF = BASE + '/assets/f15c/references'
OUT = os.environ.get('POCKET_F15C_REVIEW') or BASE + '/assets/f15c/review/reference'
os.makedirs(OUT, exist_ok=True)
PIXELS_PER_METRE = 100
EXTENT = 24

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
scene = bpy.context.scene
root = bpy.data.objects['F15C_Eagle']


def family(o):
    yield o
    for child in o.children:
        yield from family(child)


# Stores and gear are not in the drawing's outline; the gear folds away for comparison.
gear = list(family(bpy.data.objects['LandingGear'])) if 'LandingGear' in bpy.data.objects else []
# The drawing's pylons are masked out of its outline, so the model's come out of its outline too.
stores = [o for o in bpy.data.objects if o.name.startswith(('Pylon_', 'Launcher_'))]


def camera(name, look, up, ortho=None, position=None, lens=50):
    cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
    scene.collection.objects.link(cam)
    look, up = Vector(look).normalized(), Vector(up).normalized()
    right = look.cross(up).normalized()
    up = right.cross(look)
    rotation = Matrix((right, up, -look)).transposed().to_4x4()
    cam.matrix_world = Matrix.Translation(position if position else -look * 60) @ rotation
    cam.data.clip_end = 400
    if ortho:
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = ortho
    else:
        cam.data.lens = lens
    return cam


VIEWS = {
    'top': camera('Ref top', (0, 0, -1), (-1, 0, 0), EXTENT),
    'side': camera('Ref side', (-1, 0, 0), (0, 0, 1), EXTENT),
    'front': camera('Ref front', (0, -1, 0), (0, 0, 1), EXTENT),
}


def silhouettes():
    for o in gear + stores:
        o.hide_render = True
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'FLAT'
    scene.display.shading.color_type = 'SINGLE'
    scene.display.shading.single_color = (1, 1, 1)
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.resolution_x = scene.render.resolution_y = EXTENT * PIXELS_PER_METRE
    for name, cam in VIEWS.items():
        scene.camera = cam
        scene.render.filepath = f'{OUT}/model-{name}.png'
        bpy.ops.render.render(write_still=True)
    for o in gear + stores:
        o.hide_render = False


def add_light():
    world = bpy.data.worlds.new('Ref sky')
    scene.world = world
    world.node_tree.nodes['Background'].inputs[0].default_value = (.62, .72, .82, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = .8
    sun = bpy.data.objects.new('Ref sun', bpy.data.lights.new('Ref sun', 'SUN'))
    scene.collection.objects.link(sun)
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(40), 0, math.radians(30))


PHOTOS = [
    # File, then a camera near the photographer's for the side-by-side render.
    ('f15c-above-front-44fs', (13, 33, 26), 70),
    ('f15c-side-144fw', (44, 9, 2), 70),
    ('f15-below-rear', (24, -7, -26), 70),
]


def shaded():
    add_light()
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.film_transparent = False
    scene.render.resolution_x, scene.render.resolution_y = 1400, 930
    centre = Vector((0, 0, .5))
    for o in gear:
        o.hide_render = True
    for name, position, lens in PHOTOS:
        position = Vector(position)
        cam = camera('Match ' + name, centre - position, (0, 0, 1), position=position, lens=lens)
        scene.camera = cam
        scene.render.filepath = f'{OUT}/match-{name}.png'
        bpy.ops.render.render(write_still=True)
    for o in gear:
        o.hide_render = False


def reference_empty(name, path, location, rotation, size, crop=None):
    image = bpy.data.images.load(path)
    image.pack()
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_type = 'IMAGE'
    empty.data = image
    empty.empty_display_size = size
    empty.location = location
    empty.rotation_euler = rotation
    empty.color[3] = .55
    empty.use_empty_image_alpha = True
    scene.collection.objects.link(empty)
    return empty


def place_references():
    # Each view lines up with the model in Blender's matching view: press numpad 7, 3 or 1.
    corners = [o.matrix_world @ Vector(c) for o in family(root) if o.type == 'MESH' and o not in gear for c in o.bound_box]
    low = Vector(min(c[i] for c in corners) for i in range(3))
    high = Vector(max(c[i] for c in corners) for i in range(3))
    centre = (low + high) / 2
    placed = REF + '/f15-drawing-views.json'
    views = json.load(open(placed)) if os.path.exists(placed) else {}
    for view, spec in views.items():
        path = f"{REF}/{spec['file']}"
        # Offsets are drawing minus model, in the view's right and up directions, in metres.
        right, up = spec['offset_m']
        if view == 'top':
            location, rotation = (-up, centre.y + right, low.z - 3), (0, 0, math.pi / 2)
        elif view == 'side':
            location, rotation = (low.x - 3, centre.y + right, centre.z + up), (math.pi / 2, 0, math.pi / 2)
        else:
            location, rotation = (centre.x + right, low.y - 3, centre.z + up), (math.pi / 2, 0, 0)
        reference_empty('Reference drawing ' + view, path, location, rotation, spec['width_m'])
    for i, (name, _, _) in enumerate(PHOTOS):
        path = f'{REF}/{name}.jpg'
        reference_empty('Reference photo ' + name, path, (24, -18 + i * 18, 0), (math.pi / 2, 0, math.pi / 2), 16)


silhouettes()
shaded()
place_references()
scene.camera = VIEWS['side']
bpy.ops.wm.save_as_mainfile(filepath=OUT + '/reference.blend' if os.environ.get('POCKET_F15C_REVIEW') else BASE + '/assets/f15c-reference.blend')
