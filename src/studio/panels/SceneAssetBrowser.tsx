import { Box, Image, Music, Upload, Plus } from "lucide-react";
import { type ObjectKind } from "../studio-scene";
import { type StudioAsset } from "../studio-assets";

export function SceneAssetBrowser({
  assets,
  disabled,
  onImport,
  onAdd,
  onPrimitive,
}: {
  assets: StudioAsset[];
  disabled: boolean;
  onImport: (files: File[]) => void;
  onAdd: (asset: StudioAsset) => void;
  onPrimitive: (kind: ObjectKind) => void;
}) {
  return (
    <>
      <div className="studio-section-heading">
        <h2>Asset library</h2>
        <span>{assets.length}</span>
      </div>
      <label className="scene-import">
        <Upload size={17} />
        <b>Import your assets</b>
        <small>GLB / glTF · OBJ / STL · images · audio</small>
        <input
          aria-label="Import scene assets"
          type="file"
          multiple
          accept=".glb,.gltf,.bin,.obj,.stl,.png,.jpg,.jpeg,.webp,.wav,.mp3,.ogg,.m4a,.aac,.flac"
          disabled={disabled}
          onChange={(e) => {
            onImport(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </label>
      <p className="studio-hint">
        Drop files anywhere in the editor. For glTF, select its textures and
        .bin files too. Blender models work best as GLB.
      </p>
      <h3 className="scene-subtitle">Add a primitive</h3>
      <div className="scene-primitives">
        {(
          [
            "cube",
            "sphere",
            "cylinder",
            "torus",
            "plane",
            "light",
          ] as ObjectKind[]
        ).map((kind) => (
          <button
            key={kind}
            disabled={disabled}
            onClick={() => onPrimitive(kind)}
          >
            <Box size={13} />
            {kind[0].toUpperCase() + kind.slice(1)}
          </button>
        ))}
      </div>
      <div className="scene-asset-list">
        {assets.map((asset) => (
          <article className="scene-asset" key={asset.id}>
            {asset.kind === "audio" ? (
              <Music size={17} />
            ) : asset.kind === "image" ? (
              <Image size={17} />
            ) : (
              <Box size={17} />
            )}
            <div>
              <b>{asset.name}</b>
              <small>
                {asset.kind.toUpperCase()} ·{" "}
                {(
                  asset.files.reduce((n, f) => n + f.data.byteLength, 0) /
                  1024 /
                  1024
                ).toFixed(1)}{" "}
                MB
                {asset.animations.length
                  ? ` · ${asset.animations.length} animations`
                  : ""}
              </small>
            </div>
            <button
              aria-label={`Add asset ${asset.name}`}
              disabled={disabled}
              onClick={() => onAdd(asset)}
            >
              <Plus size={15} />
            </button>
          </article>
        ))}
      </div>
      <p className="studio-hint">
        Imported assets stay in this browser. Project backups include every
        asset used in the film.
      </p>
    </>
  );
}
