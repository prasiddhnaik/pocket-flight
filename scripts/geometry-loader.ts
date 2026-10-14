import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createHash } from "node:crypto";

// Pack external buffers into a temporary geometry-only GLB. No network fetch,
// DOM image decoding or texture changes to the original files are involved.
export async function loadGeometryOnly(
  url: URL,
  keepAnimations = false,
  bufferBase = url,
) {
  const source = new Uint8Array(await Bun.file(url).arrayBuffer());
  const isGLB = url.pathname.endsWith(".glb");
  const jsonLength = isGLB
    ? new DataView(source.buffer).getUint32(12, true)
    : 0;
  const data = JSON.parse(
    new TextDecoder().decode(
      isGLB ? source.slice(20, 20 + jsonLength) : source,
    ),
  );
  const buffers: Uint8Array[] = await Promise.all(
    data.buffers.map(async (b: { uri?: string }, index: number) =>
      isGLB && index === 0 && !b.uri
        ? source.slice(28 + jsonLength)
        : new Uint8Array(
            await Bun.file(new URL(b.uri!, bufferBase)).arrayBuffer(),
          ),
    ),
  );
  const offsets: number[] = [];
  let length = 0;
  for (const b of buffers) {
    offsets.push(length);
    length += Math.ceil(b.length / 4) * 4;
  }
  for (const view of data.bufferViews) {
    view.byteOffset = (view.byteOffset ?? 0) + offsets[view.buffer];
    view.buffer = 0;
  }
  data.buffers = [{ byteLength: length }];
  delete data.images;
  delete data.textures;
  delete data.samplers;
  delete data.materials;
  if (!keepAnimations) delete data.animations;
  for (const mesh of data.meshes)
    for (const p of mesh.primitives) delete p.material;
  const json = new TextEncoder().encode(JSON.stringify(data));
  const paddedLength = Math.ceil(json.length / 4) * 4;
  const output = new Uint8Array(28 + paddedLength + length),
    header = new DataView(output.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, output.length, true);
  header.setUint32(12, paddedLength, true);
  header.setUint32(16, 0x4e4f534a, true);
  output.fill(32, 20, 20 + paddedLength);
  output.set(json, 20);
  header.setUint32(20 + paddedLength, length, true);
  header.setUint32(24 + paddedLength, 0x004e4942, true);
  for (let i = 0; i < buffers.length; i++)
    output.set(buffers[i], 28 + paddedLength + offsets[i]);
  const hash = createHash("sha256").update(source);
  buffers.forEach((b, index) => {
    if (!isGLB || index > 0) hash.update(b);
  });
  const { scene, animations } = await new GLTFLoader().parseAsync(
    output.buffer,
    "",
  );
  return { scene, animations, sha256: hash.digest("hex") };
}
