import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

type Photo = {
  id: string;
  sourcePage: string;
  imageUrl: string;
  localPath: string;
  title: string;
  caption: string;
  sha256: string;
  width: number;
  height: number;
  VIRIN?: string | null;
  virin?: string | null;
  sourceMetadata?: Record<string, unknown>;
  [key: string]: unknown;
};

// Collection validation intentionally performs no visual/model comparison.
const total = Number(process.argv[2] ?? 75);
if (total !== 75 && total !== 250) throw new Error('Choose the 75-image or 250-image collection');
const root = resolve(import.meta.dir, '..');
const out = join(root, `output/f15c-reference-${total}`);
const base = join(root, 'output/f15c-reference-75');
const photos: Photo[] = total === 250 ? await Bun.file(join(base, 'manifest.json')).json() : [];
const errors: string[] = [];
for (const [owner, expected] of total === 75 ? [['feynman', 25], ['hopper', 25], ['bernoulli', 25]] as const :
  [['feynman', 60], ['hopper', 60], ['bernoulli', 55]] as const) {
  const file = Bun.file(join(out, owner, 'manifest.json'));
  if (!(await file.exists())) {
    errors.push(`${owner}: manifest not ready`);
    continue;
  }
  const rows: Photo[] = await file.json();
  if (rows.length !== expected) errors.push(`${owner}: expected ${expected} images, received ${rows.length}`);
  photos.push(...rows);
}

const hashes = new Map<string, string>();
const virins = new Map<string, string>();
const identities = new Map<string, string>();
const ids = new Set<string>();
for (const photo of photos) {
  if (ids.has(photo.id)) errors.push(`${photo.id}: duplicate ID`);
  ids.add(photo.id);
  if (!photo.sourcePage || !photo.imageUrl || !photo.caption) errors.push(`${photo.id}: missing provenance`);
  const source = new URL(photo.sourcePage);
  const keys = [`page:${source.hostname}${decodeURIComponent(source.pathname).replace(/_/g, ' ')}`];
  if (photo.commonsPageId) keys.push(`commons:${photo.commonsPageId}`);
  const originalIds = photo.sourcePhotoIdentifiers as { flickrPhotoIds?: string[] } | undefined;
  for (const id of originalIds?.flickrPhotoIds ?? []) keys.push(`flickr:${id}`);
  for (const key of keys) {
    if (identities.has(key) && identities.get(key) !== photo.id)
      errors.push(`${photo.id}: same photograph identity as ${identities.get(key)} (${key})`);
    identities.set(key, photo.id);
  }
  try {
    const bytes = await readFile(photo.localPath);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (photo.sha256 !== hash) errors.push(`${photo.id}: saved image hash mismatch`);
    if (hashes.has(hash)) errors.push(`${photo.id}: duplicate image bytes of ${hashes.get(hash)}`);
    hashes.set(hash, photo.id);
    if (!(photo.width > 0 && photo.height > 0)) errors.push(`${photo.id}: missing decoded dimensions`);
  } catch (error) {
    errors.push(`${photo.id}: cannot read image: ${String(error)}`);
  }
  const virin = String(photo.VIRIN ?? photo.virin ?? photo.sourceMetadata?.VIRIN ?? '').trim().toUpperCase();
  if (virin) {
    if (virins.has(virin)) errors.push(`${photo.id}: same VIRIN as ${virins.get(virin)} (${virin})`);
    virins.set(virin, photo.id);
  }
}
if (photos.length !== total) errors.push(`Expected ${total} photographs; received ${photos.length}`);
const collectedAt = new Date().toISOString();
const gate = { collectedAt, count: photos.length, distinctByteHashes: hashes.size, errors,
  collectionComplete: errors.length === 0,
  instruction: 'Additional visual comparison may begin only after collectionComplete is true; this gate does not claim visual review.' };
await mkdir(out, { recursive: true });
await writeFile(join(out, 'collection-gate.json'), JSON.stringify(gate, null, 2));
console.log(JSON.stringify(gate, null, 2));
if (errors.length) process.exit(1);

await writeFile(join(out, 'manifest.json'), JSON.stringify(photos, null, 2));
const observations = new Map<string, Record<string, unknown>>();
for (const folder of [...(total === 250 ? [base] : []), out]) {
for (const owner of ['feynman', 'hopper', 'bernoulli']) {
  const review = Bun.file(join(folder, owner, 'visual-review.json'));
  if (!(await review.exists())) continue;
  const { records } = await review.json() as { records: (Record<string, unknown> & { id: string })[] };
  for (const row of records) observations.set(row.id, row);
}
}
await writeFile(join(out, 'review-index.json'), JSON.stringify({
  collectedCount: photos.length, reviewedCount: observations.size,
  allReviewed: photos.every(photo => observations.has(photo.id)),
  records: photos.map(photo => observations.get(photo.id) ?? { id: photo.id, pending: true }),
}, null, 2));
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const url = (path: string) => relative(out, path).split('/').map(encodeURIComponent).join('/');
const prose = (value: unknown) => esc(Array.isArray(value) ? value.join(' ') : value);
const cards = photos.map((photo) => {
  const review = observations.get(photo.id);
  return `<article id="${esc(photo.id)}"><a href="${url(photo.localPath)}"><img loading="lazy" src="${url(photo.localPath)}" alt="${esc(photo.id)}: ${esc(photo.title)}"></a><h2>${esc(photo.id)} · ${esc(photo.title)}</h2><p>${prose(review?.actualView)}</p><p>${prose(review?.observations)}</p><details><summary>Caption and review limitations</summary><p>${esc(photo.caption)}</p><p>${prose(review?.limitations)}</p></details><p><a href="${esc(photo.sourcePage)}">Original source</a> · ${photo.width} × ${photo.height}<br>Photo: ${esc(photo.photographer)} · <a href="${esc(photo.licenseUrl ?? photo.sourcePage)}">${esc(photo.license)}</a></p></article>`;
}).join('\n');
await writeFile(join(out, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${total} F-15 reference photographs</title><style>body{font:16px/1.5 system-ui;margin:32px;color:#17212a;background:#fafafa}h1{font-size:30px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px}article{padding:16px;background:white;border:1px solid #ccd2d8}img{width:100%;height:270px;object-fit:contain;background:#eef1f3}h2{font-size:18px}p{font-size:14px}a{color:#165588}</style><h1>${total} F-15 reference photographs</h1><p>All ${total} files have verified provenance and distinct photo identities. The initial 75 were collected before the first review; an expanded collection precedes additional comparison. Latest collection validation: ${esc(collectedAt)}. ${observations.size} individual review records are available. This is a private local research artifact; source credits and license details are retained in <a href="manifest.json">the manifest</a>. <a href="review-index.json">Individual observations and limitations</a>.</p><main class="grid">${cards}</main></html>`);
console.log(`Catalog: ${join(out, 'index.html')}`);
