import { createHash } from "node:crypto";
import manifest from "./coastal-reference-manifest.json";
// Reusable, checksum-verified download of the original CC0 Blender sources.
for (const source of manifest.sources) {
  const files = {
    [`${source.id}.blend`]: source.files,
    ...source.files.include,
  };
  for (const [name, file] of Object.entries(files)) {
    const path = new URL(
      `../assets/reference-scenery/${source.id}/${name}`,
      import.meta.url,
    );
    const existing = Bun.file(path);
    if (await existing.exists()) {
      const digest = createHash("md5")
        .update(new Uint8Array(await existing.arrayBuffer()))
        .digest("hex");
      if (digest === file.md5) continue;
    }
    const response = await fetch(file.url);
    if (!response.ok)
      throw new Error(`${source.id}/${name}: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (createHash("md5").update(new Uint8Array(bytes)).digest("hex") !== file.md5)
      throw new Error(`Checksum mismatch: ${name}`);
    await Bun.write(path, bytes);
    console.log(`Saved ${source.id}/${name}`);
  }
}
