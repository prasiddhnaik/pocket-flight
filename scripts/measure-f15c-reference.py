"""Measure the F-15C's outline against the reference drawing, view by view.

Run after compare-f15c-reference.py. Writes overlays to assets/f15c/review/reference/:
white where both agree, red where only the model is, cyan where only the drawing is.
Numbers are metres at the model's length. The drawing's missiles and pylons are thin,
so they are opened out of its outline before scoring. Exits non-zero below the targets.
Set POCKET_F15C_REVIEW to measure renders in another folder.
"""
import json
import os
import sys
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as nd

Image.MAX_IMAGE_PIXELS = None
BASE = Path(__file__).resolve().parents[1]
OUT = Path(os.environ['POCKET_F15C_REVIEW']) if os.environ.get('POCKET_F15C_REVIEW') else BASE / 'assets/f15c/review/reference'
TARGETS = {'top': .95, 'side': .93, 'front': .90}
REFS = BASE / 'assets/f15c/references'
PPM = 100
# Sheet crops at 3x: left, top, right, bottom.
CROPS = {'side': (1590, 60, 5720, 1060), 'top': (1590, 1290, 5720, 4085), 'front': (345, 1290, 1290, 4085)}
sheet = np.asarray(Image.open(BASE / 'assets/f15c/references/f15-three-view-drawing.png').convert('L'))


def drawing(view):
    left, top, right, bottom = CROPS[view]
    lines = sheet[top:bottom, left:right] < 110
    closed = nd.binary_dilation(lines, iterations=4)
    outside, count = nd.label(~closed)
    border = set(np.unique(np.r_[outside[0], outside[-1], outside[:, 0], outside[:, -1]])) - {0}
    shape = ~np.isin(outside, list(border))
    # Thinner ghost marks and stray dimension lines are not the aircraft.
    # Back out the dilation, then half the 6-pixel ink line the outline is drawn with.
    shape = nd.binary_erosion(shape, iterations=4 + 3)
    parts, count = nd.label(shape)
    sizes = nd.sum(shape, parts, range(1, count + 1))
    shape = parts == 1 + int(np.argmax(sizes))
    shape = nd.binary_fill_holes(shape)
    return np.rot90(shape, -1) if view == 'front' else shape


def trim(a):
    ys, xs = np.where(a)
    return a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def model(view):
    return trim(np.asarray(Image.open(OUT / f'model-{view}.png').convert('RGBA'))[..., 3] > 128)


models = {view: model(view) for view in CROPS}
length = max(models['top'].shape[1], models['side'].shape[1])
raw = {view: trim(drawing(view)) for view in CROPS}
# One scale for the whole sheet: the plan view's nose-to-tail length.
scale = length / raw['top'].shape[1]


def without_stores(view, shape):
    """Removes what is thinner than the airframe. The front view keeps its long, thin
    wings and fins by opening along their lengths; other views use a disc."""
    if view == 'front':
        # The inner-wing pylons and their missiles fill the gap between wing and tail plane.
        height, width = shape.shape
        centre = width // 2
        rows = slice(height - round(1.05 * PPM), height - round(.83 * PPM))
        for side in (-1, 1):
            a, b = sorted((centre + side * round(1.98 * PPM), centre + side * round(3.05 * PPM)))
            shape[rows, a:b] = False
        length = PPM
        along = nd.binary_opening(shape, np.ones((1, length), bool)) | nd.binary_opening(shape, np.ones((length, 1), bool))
        return nd.binary_propagation(along, mask=along)
    radius = 18 if view == 'top' else 12
    disc = np.hypot(*np.ogrid[-radius:radius + 1, -radius:radius + 1]) <= radius
    return nd.binary_opening(shape, disc)


drawings = {view: without_stores(view, nd.zoom(raw[view].astype(float), scale, order=1) > .5) for view in CROPS}


def align(a, b):
    """Pads both to one canvas and slides b to where they overlap most."""
    h, w = max(a.shape[0], b.shape[0]) + 80, max(a.shape[1], b.shape[1]) + 80
    A = np.zeros((h, w), bool)
    A[40:40 + a.shape[0], 40:40 + a.shape[1]] = a
    best = (-1, None, 0, 0)

    def search(ys, xs):
        nonlocal best
        for dy in ys:
            for dx in xs:
                if dy < 0 or dx < 0 or dy + b.shape[0] > h or dx + b.shape[1] > w:
                    continue
                B = np.zeros((h, w), bool)
                B[dy:dy + b.shape[0], dx:dx + b.shape[1]] = b
                score = (A & B).sum()
                if score > best[0]:
                    best = (score, B, dy, dx)

    search(range(0, h - b.shape[0], 4), range(0, w - b.shape[1], 4))
    # A centimetre of slide matters on parts this thin.
    _, _, y, x = best
    search(range(y - 4, y + 5), range(x - 4, x + 5))
    return A, best[1]


placed = {}
report = {'scale_note': 'Drawing scaled so plan-view length equals the model length', 'views': {}}
for view in CROPS:
    A, B = align(models[view], drawings[view])
    both, only_model, only_drawing = A & B, A & ~B, B & ~A
    overlay = np.full(A.shape + (3,), 24, np.uint8)
    overlay[both] = (232, 232, 226)
    overlay[only_model] = (235, 60, 50)
    overlay[only_drawing] = (40, 205, 225)
    Image.fromarray(overlay).save(OUT / f'overlay-{view}.png')
    ys, xs = np.where(A)
    by, bx = np.where(B)
    # Line art of this view alone, cropped to its outline, for the Blender scene.
    left, top, right, bottom = CROPS[view]
    art = Image.fromarray(sheet[top:bottom, left:right])
    if view == 'front':
        art = art.rotate(-90, expand=True)
    shape = drawing(view)
    sy, sx = np.where(shape)
    art = art.crop((sx.min(), sy.min(), sx.max() + 1, sy.max() + 1)).convert('RGB')
    art.save(REFS / f'f15-drawing-{view}.png')
    placed[view] = {
        'file': f'f15-drawing-{view}.png',
        'width_m': round(float(bx.max() - bx.min() + 1) / PPM, 3),
        'offset_m': [
            round(float((bx.min() + bx.max()) - (xs.min() + xs.max())) / 2 / PPM, 3),
            round(float((ys.min() + ys.max()) - (by.min() + by.max())) / 2 / PPM, 3),
        ],
    }
    x0, x1 = xs.min(), xs.max()
    y0, y1 = ys.min(), ys.max()
    entry = {
        'overlap': round(float(both.sum() / (A | B).sum()), 3),
        'model_size_m': [round((x1 - x0 + 1) / PPM, 2), round((y1 - y0 + 1) / PPM, 2)],
    }
    dy, dx = np.where(B)
    entry['drawing_size_m'] = [round((dx.max() - dx.min() + 1) / PPM, 2), round((dy.max() - dy.min() + 1) / PPM, 2)]
    # Largest bands of mismatch, along the image's horizontal axis.
    columns = []
    for label, mask in (('model only', only_model), ('drawing only', only_drawing)):
        thick = nd.binary_opening(mask, iterations=6)
        parts, count = nd.label(thick)
        for index, box in enumerate(nd.find_objects(parts), 1):
            area = (parts[box] == index).sum() / PPM ** 2
            if area < .06:
                continue
            py, px = box
            columns.append({
                'kind': label,
                'area_m2': round(float(area), 2),
                'from_left_m': [round((px.start - x0) / PPM, 2), round((px.stop - x0) / PPM, 2)],
                'from_top_m': [round((py.start - y0) / PPM, 2), round((py.stop - y0) / PPM, 2)],
                'thickest_m': round(float(nd.distance_transform_edt(parts[box] == index).max() * 2 / PPM), 2),
            })
    entry['largest_differences'] = sorted(columns, key=lambda c: -c['area_m2'])[:10]
    report['views'][view] = entry
(OUT / 'report.json').write_text(json.dumps(report, indent=2))
if not os.environ.get('POCKET_F15C_REVIEW'):
    (REFS / 'f15-drawing-views.json').write_text(json.dumps(placed, indent=2))
# Photo beside the matching render.
for name, suffix in (('f15c-above-front-44fs', 'jpg'), ('f15c-side-144fw', 'jpg'), ('f15-below-rear', 'jpg')):
    if not (OUT / f'match-{name}.png').exists():
        continue
    photo = Image.open(REFS / f'{name}.{suffix}').convert('RGB')
    render = Image.open(OUT / f'match-{name}.png').convert('RGB')
    height = 760
    photo = photo.resize((round(photo.width * height / photo.height), height))
    render = render.resize((round(render.width * height / render.height), height))
    sheet_out = Image.new('RGB', (photo.width + render.width + 16, height), (24, 24, 24))
    sheet_out.paste(photo, (0, 0))
    sheet_out.paste(render, (photo.width + 16, 0))
    sheet_out.save(OUT / f'side-by-side-{name}.png')
print(json.dumps({view: entry['overlap'] for view, entry in report['views'].items()}))
failed = [f"{view} {report['views'][view]['overlap']} < {target}" for view, target in TARGETS.items() if report['views'][view]['overlap'] < target]
if failed:
    sys.exit('Below target: ' + ', '.join(failed))
