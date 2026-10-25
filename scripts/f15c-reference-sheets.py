"""Prepare labeled review sheets only after all 75 reference files are gathered."""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

total = int(sys.argv[1]) if len(sys.argv) > 1 else 75
ROOT = Path(__file__).resolve().parents[1] / f'output/f15c-reference-{total}'
gate = json.loads((ROOT / 'collection-gate.json').read_text())
assert gate['collectionComplete'] and gate['count'] == total, 'Collection gate is still closed'
photos = json.loads((ROOT / 'manifest.json').read_text())
sheet_dir = ROOT / 'review-sheets'
sheet_dir.mkdir(exist_ok=True)
sheets = []
for start in range(0, len(photos), 5):
    sheet = Image.new('RGB', (1440, 1350), '#f7f8fa')
    draw = ImageDraw.Draw(sheet)
    rows = photos[start:start + 5]
    for index, photo in enumerate(rows):
        x, y = (index % 2) * 720, (index // 2) * 450
        with Image.open(photo['localPath']) as source:
            image = ImageOps.contain(ImageOps.exif_transpose(source).convert('RGB'), (700, 405))
        sheet.paste(image, (x + 10 + (700 - image.width) // 2, y + 30 + (405 - image.height) // 2))
        draw.text((x + 12, y + 10), photo['id'], fill='#142737')
    path = sheet_dir / f'sheet-{start // 5 + 1:02}.jpg'
    sheet.save(path, quality=93)
    sheets.append({'path': str(path), 'ids': [row['id'] for row in rows]})
(sheet_dir / 'index.json').write_text(json.dumps(sheets, indent=2))
print(json.dumps(sheets, indent=2))
