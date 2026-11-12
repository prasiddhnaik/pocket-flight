import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

// One approved vector source owns the menu logo, emblem, app icons and favicon.
// Run with `bun run branding:build` after updating the source SVG.
const root = join(import.meta.dir, "..");
const publicRoot = join(root, "public");
const branding = join(publicRoot, "branding");
const icons = join(publicRoot, "icons");
await mkdir(icons, { recursive: true });

const source = await Bun.file(join(branding, "pocket-flight.svg")).text();
const paths = [...source.matchAll(/<path\b[^>]*\/>/gs)].map(match => match[0]);
if (paths.length !== 13) throw new Error("Expected the approved emblem and twelve outlined letters.");
const blue = "#0000FF";
const svg = (viewBox: string, title: string, content: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-labelledby="title"><title id="title">${title}</title>${content}</svg>\n`;
const recolor = (content: string, color: string) => content.replace(/fill="[^"]*"/g, `fill="${color}"`);

async function bounds(content: string) {
  const { data, info } = await sharp(Buffer.from(svg("0 0 1774 887", "", content))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = 0, bottom = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      right = Math.max(right, x + 1);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y + 1);
    }
  }
  return { left, top, width: right - left, height: bottom - top };
}

const logoBounds = await bounds(paths.join(""));
const emblemBounds = await bounds(paths[0]);
const viewBox = (box: typeof logoBounds) => `${box.left - 2} ${box.top - 2} ${box.width + 4} ${box.height + 4}`;

for (const [suffix, color] of [["", blue], ["-white", "#FFFFFF"]] as const) {
  await Bun.write(join(branding, `logo${suffix}.svg`), svg(viewBox(logoBounds), "Pocket Flight", recolor(paths.join(""), color)));
  await Bun.write(join(branding, `emblem${suffix}.svg`), svg(viewBox(emblemBounds), "Pocket Flight emblem", recolor(paths[0], color)));
}

function tile(size: number, rounded = false) {
  const scale = size / Math.max(emblemBounds.width, emblemBounds.height);
  const x = (512 - emblemBounds.width * scale) / 2;
  const y = (512 - emblemBounds.height * scale) / 2;
  return svg("0 0 512 512", "Pocket Flight", `<rect width="512" height="512"${rounded ? ' rx="100"' : ""} fill="${blue}"/><g transform="translate(${x} ${y}) scale(${scale}) translate(${-emblemBounds.left} ${-emblemBounds.top})">${recolor(paths[0], "#FFFFFF")}</g>`);
}

const appIcon = tile(392);
const favicon = tile(408, true);
await Bun.write(join(icons, "icon.svg"), appIcon);
await Bun.write(join(publicRoot, "favicon.svg"), favicon);
for (const size of [192, 512]) {
  await sharp(Buffer.from(appIcon)).resize(size, size).png().toFile(join(icons, `icon-${size}.png`));
}
// The entire emblem fits inside the central safe circle of a maskable icon.
await sharp(Buffer.from(tile(280))).resize(512, 512).png().toFile(join(icons, "icon-maskable-512.png"));
await sharp(Buffer.from(appIcon)).resize(180, 180).png().toFile(join(publicRoot, "apple-touch-icon.png"));
await sharp(Buffer.from(favicon)).resize(32, 32).png().toFile(join(publicRoot, "favicon-32.png"));

// ICO directory with lossless PNG frames for browsers that need the fallback.
const sizes = [16, 32, 48];
const frames = await Promise.all(sizes.map(size => sharp(Buffer.from(favicon)).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach((frame, index) => {
  const entry = 6 + 16 * index;
  header[entry] = header[entry + 1] = sizes[index];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
await Bun.write(join(publicRoot, "favicon.ico"), Buffer.concat([header, ...frames]));
console.log("Built the original logo, emblem, app icons, Apple touch icon and favicons.");
