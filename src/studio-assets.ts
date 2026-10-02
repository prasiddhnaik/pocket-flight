import { validateProject, type StudioProject } from "./studio-model";
import { sceneAssetIds } from "./studio-scene";
export type AssetKind = "glb" | "gltf" | "obj" | "stl" | "image" | "audio";
export type StudioAsset = {
  schemaVersion: 1;
  id: string;
  name: string;
  kind: AssetKind;
  createdAt: number;
  files: { name: string; type: string; data: ArrayBuffer }[];
  animations: string[];
  duration?: number;
};
const MAX_BYTES = 128 * 1024 * 1024;
export function validateAsset(value: unknown): value is StudioAsset {
  if (!value || typeof value !== "object") return false;
  const a = value as StudioAsset;
  return (
    a.schemaVersion === 1 &&
    typeof a.id === "string" &&
    a.id.length > 0 &&
    typeof a.name === "string" &&
    ["glb", "gltf", "obj", "stl", "image", "audio"].includes(a.kind) &&
    Number.isFinite(a.createdAt) &&
    Array.isArray(a.animations) &&
    a.animations.every((n) => typeof n === "string") &&
    (a.duration === undefined ||
      (Number.isFinite(a.duration) && a.duration > 0)) &&
    Array.isArray(a.files) &&
    a.files.length > 0 &&
    a.files.length < 200 &&
    a.files.every(
      (f) =>
        f &&
        typeof f.name === "string" &&
        typeof f.type === "string" &&
        f.data instanceof ArrayBuffer &&
        f.data.byteLength > 0,
    ) &&
    a.files.reduce((n, f) => n + f.data.byteLength, 0) <= MAX_BYTES
  );
}
const extension = (name: string) => name.toLowerCase().split(".").at(-1);
const kindFor = (name: string): AssetKind | null => {
  const ext = extension(name);
  return ext === "glb" || ext === "gltf" || ext === "obj" || ext === "stl"
    ? ext
    : ["png", "jpg", "jpeg", "webp"].includes(ext ?? "")
      ? "image"
      : ["wav", "mp3", "ogg", "m4a", "aac", "flac"].includes(ext ?? "")
        ? "audio"
        : null;
};
export async function readAssets(files: File[]): Promise<StudioAsset[]> {
  if (files.reduce((n, f) => n + f.size, 0) > MAX_BYTES)
    throw new Error("Import at most 128 MB at a time.");
  const loaded = await Promise.all(
    files.map(async (file) => ({
      name: file.webkitRelativePath || file.name,
      type: file.type,
      data: await file.arrayBuffer(),
    })),
  );
  const roots = loaded.filter((f) =>
    ["glb", "gltf", "obj", "stl"].includes(extension(f.name) ?? ""),
  );
  const entries = roots.length
    ? [
        ...roots,
        ...loaded.filter(
          (f) =>
            kindFor(f.name) === "audio" ||
            (kindFor(f.name) === "image" &&
              !roots.some((r) => kindFor(r.name) === "gltf")),
        ),
      ]
    : loaded.filter((f) => kindFor(f.name));
  if (!entries.length)
    throw new Error(
      "Choose GLB, glTF, OBJ, STL, PNG/JPEG/WebP, or audio files.",
    );
  return Promise.all(
    entries.map(async (main) => {
      const kind = kindFor(main.name)!,
        bundle =
          kind === "gltf"
            ? [main, ...loaded.filter((f) => f !== main)]
            : [main];
      const all = new Uint8Array(
        bundle.reduce(
          (n, f) =>
            n + f.data.byteLength + new TextEncoder().encode(f.name).length,
          0,
        ),
      );
      let offset = 0;
      for (const f of bundle) {
        const name = new TextEncoder().encode(f.name);
        all.set(name, offset);
        offset += name.length;
        all.set(new Uint8Array(f.data), offset);
        offset += f.data.byteLength;
      }
      const hash = await crypto.subtle.digest("SHA-256", all);
      const id = Array.from(new Uint8Array(hash))
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
      return {
        schemaVersion: 1,
        id,
        name: main.name
          .split("/")
          .at(-1)!
          .replace(/\.[^.]+$/, ""),
        kind,
        createdAt: Date.now(),
        files: bundle,
        animations: [],
      };
    }),
  );
}
function encode(data: ArrayBuffer) {
  const bytes = new Uint8Array(data);
  let text = "";
  for (let i = 0; i < bytes.length; i += 32768)
    text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
function decode(value: string) {
  if (value.length > MAX_BYTES * 1.4)
    throw new Error("Asset backup is too large.");
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0)).buffer;
}
export async function packProject(
  project: StudioProject,
  assets: StudioAsset[],
) {
  const ids = sceneAssetIds(project.scene);
  const selected = ids.map((id) => {
    const a = assets.find((a) => a.id === id);
    if (!a) throw new Error(`Project asset ${id} is missing.`);
    return {
      ...a,
      files: a.files.map((f) => ({ ...f, data: encode(f.data) })),
    };
  });
  return JSON.stringify({
    type: "pocket-flight-studio-bundle",
    version: 1,
    project,
    assets: selected,
  });
}
export function unpackProject(text: string): {
  project: StudioProject;
  assets: StudioAsset[];
} {
  const bundle = JSON.parse(text);
  if (
    bundle?.type !== "pocket-flight-studio-bundle" ||
    bundle.version !== 1 ||
    !validateProject(bundle.project) ||
    !Array.isArray(bundle.assets)
  )
    throw new Error("This is not a valid scene project backup.");
  if (bundle.assets.some((a: unknown) => !a || typeof a !== "object"))
    throw new Error("A backup asset is invalid.");
  const assets = bundle.assets.map((a: StudioAsset) => ({
    ...a,
    files: Array.isArray(a.files)
      ? a.files.map((f) => ({
          ...f,
          data: typeof f.data === "string" ? decode(f.data) : null,
        }))
      : null,
  }));
  if (!assets.every(validateAsset))
    throw new Error("A backup asset is invalid.");
  if (
    sceneAssetIds(bundle.project.scene).some(
      (id) => !assets.some((a: StudioAsset) => a.id === id),
    )
  )
    throw new Error("A project asset is missing from this backup.");
  return { project: bundle.project, assets };
}
export function downloadProject(text: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[^\w-]+/g, "-") || "film"}.studio.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
