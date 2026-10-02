import { useEffect, useState } from "react";
import {
  Box,
  Image,
  Music,
  Upload,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Copy,
  Trash2,
  Diamond,
  Camera,
  Plus,
} from "lucide-react";
import {
  sampleTransform,
  sampleCamera,
  type SceneObject,
  type StudioScene,
  type Transform,
  type Vec3,
  type ObjectKind,
  type CameraKey,
  type SoundLayer,
  type Ease,
} from "./studio-scene";
import type { StudioAsset } from "./studio-assets";
import type { StudioClip } from "./studio-model";
const seconds = (n: number) => `${n.toFixed(2)}s`;
export function NumberField({
  label,
  value,
  onChange,
  min = -100000,
  max = 100000,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [text, setText] = useState(String(+value.toFixed(3)));
  useEffect(() => setText(String(+value.toFixed(3))), [value]);
  return (
    <label>
      {label}
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const number = Number(text);
          if (text.trim() && Number.isFinite(number))
            onChange(Math.min(max, Math.max(min, number)));
          else setText(String(value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
function VectorFields({
  name,
  value,
  onChange,
  min = -100000,
  step = 0.1,
}: {
  name: string;
  value: Vec3;
  onChange: (v: Vec3) => void;
  min?: number;
  step?: number;
}) {
  return (
    <div className="scene-vector">
      <span>{name}</span>
      <div>
        {["X", "Y", "Z"].map((axis, i) => (
          <NumberField
            key={axis}
            label={`${name} ${axis}`}
            value={value[i]}
            min={min}
            step={step}
            onChange={(n) => {
              const next = [...value] as Vec3;
              next[i] = n;
              onChange(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}
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
export function SceneOutliner({
  scene,
  selected,
  disabled,
  onSelect,
  onUpdate,
  onDuplicate,
  onRemove,
}: {
  scene: StudioScene;
  selected: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onUpdate: (id: string, v: Partial<SceneObject>) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <>
      <div className="studio-section-heading">
        <h2>Scene collection</h2>
        <span>{scene.objects.length}</span>
      </div>
      <p className="studio-hint">
        Select in the viewport or outliner. G move · R rotate · S scale · F
        frame · I keyframe.
      </p>
      {!scene.objects.length && (
        <p className="scene-empty">
          Add a primitive or import an asset to assemble your scene.
        </p>
      )}
      <div className="scene-outliner">
        {scene.objects.map((object) => (
          <div
            className={object.id === selected ? "selected" : ""}
            key={object.id}
          >
            <button
              className="scene-object-select"
              disabled={disabled}
              aria-pressed={object.id === selected}
              onClick={() => onSelect(object.id)}
            >
              <Box size={14} />
              <span>{object.name}</span>
              {!!object.keys.length && <Diamond size={10} />}
            </button>
            <button
              aria-label={`${object.visible ? "Hide" : "Show"} ${object.name}`}
              disabled={disabled}
              onClick={() => onUpdate(object.id, { visible: !object.visible })}
            >
              {object.visible ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
            <button
              aria-label={`${object.locked ? "Unlock" : "Lock"} ${object.name}`}
              disabled={disabled}
              onClick={() => onUpdate(object.id, { locked: !object.locked })}
            >
              {object.locked ? <Lock size={13} /> : <Unlock size={13} />}
            </button>
          </div>
        ))}
      </div>
      {selected && (
        <div className="studio-button-row">
          <button disabled={disabled} onClick={() => onDuplicate(selected)}>
            <Copy size={13} />
            Duplicate
          </button>
          <button disabled={disabled} onClick={() => onRemove(selected)}>
            <Trash2 size={13} />
            Remove
          </button>
        </div>
      )}
    </>
  );
}
export function SceneObjectInspector({
  object,
  asset,
  time,
  disabled,
  onUpdate,
  onPose,
  onKey,
  onRemoveKey,
  onSeek,
}: {
  object: SceneObject;
  asset?: StudioAsset;
  time: number;
  disabled: boolean;
  onUpdate: (v: Partial<SceneObject>) => void;
  onPose: (pose: Transform) => void;
  onKey: (ease: Ease) => void;
  onRemoveKey: (t: number) => void;
  onSeek: (t: number) => void;
}) {
  const pose = sampleTransform(object, time);
  return (
    <fieldset className="scene-fields" disabled={disabled || object.locked}>
      <label>
        Object name
        <input
          aria-label="Scene object name"
          value={object.name}
          maxLength={80}
          onChange={(e) => onUpdate({ name: e.target.value })}
        />
      </label>
      <label>
        Anchor
        <select
          aria-label="Object anchor"
          value={object.anchor}
          onChange={(e) =>
            onUpdate({ anchor: e.target.value as SceneObject["anchor"] })
          }
        >
          <option value="world">World · fixed in the scene</option>
          <option value="aircraft">Aircraft · follows the flight</option>
        </select>
      </label>
      <VectorFields
        name="Position"
        value={pose.position}
        onChange={(position) => onPose({ ...pose, position })}
      />
      <VectorFields
        name="Rotation"
        value={pose.rotation}
        step={1}
        onChange={(rotation) => onPose({ ...pose, rotation })}
      />
      <VectorFields
        name="Scale"
        value={pose.scale}
        min={0.001}
        onChange={(scale) => onPose({ ...pose, scale })}
      />
      <p className="studio-hint">
        Position in meters · rotation in degrees · Y points up.
      </p>
      <div className="scene-key-header">
        <h3>Transform keyframes</h3>
        <button onClick={() => onKey("smooth")}>
          <Diamond size={12} />
          Key at playhead
        </button>
      </div>
      <div className="scene-key-list">
        {object.keys.map((key) => (
          <div key={key.t}>
            <button onClick={() => onSeek(key.t)}>{seconds(key.t)}</button>
            <select
              aria-label={`Key easing at ${key.t}`}
              value={key.ease}
              onChange={(e) =>
                onUpdate({
                  keys: object.keys.map((k) =>
                    k.t === key.t ? { ...k, ease: e.target.value as Ease } : k,
                  ),
                })
              }
            >
              <option value="linear">Linear</option>
              <option value="smooth">Smooth</option>
              <option value="hold">Hold</option>
            </select>
            <button
              aria-label={`Remove key at ${key.t}`}
              onClick={() => onRemoveKey(key.t)}
            >
              <XIcon />
            </button>
          </div>
        ))}
      </div>
      <h3 className="scene-subtitle">Appearance</h3>
      <label>
        Color / tint
        <input
          aria-label="Object tint"
          type="color"
          value={object.color}
          onChange={(e) => onUpdate({ color: e.target.value })}
        />
      </label>
      <NumberField
        label="Opacity"
        value={object.opacity}
        min={0}
        max={1}
        step={0.05}
        onChange={(opacity) => onUpdate({ opacity })}
      />
      {object.kind === "light" ? (
        <NumberField
          label="Light intensity"
          value={object.intensity}
          min={0}
          max={10000}
          step={10}
          onChange={(intensity) => onUpdate({ intensity })}
        />
      ) : (
        <div className="scene-pair">
          <NumberField
            label="Roughness"
            value={object.roughness}
            min={0}
            max={1}
            onChange={(roughness) => onUpdate({ roughness })}
          />
          <NumberField
            label="Metalness"
            value={object.metalness}
            min={0}
            max={1}
            onChange={(metalness) => onUpdate({ metalness })}
          />
        </div>
      )}
      <h3 className="scene-subtitle">Visibility range</h3>
      <div className="scene-pair">
        <NumberField
          label="Object starts at"
          value={object.start}
          min={0}
          onChange={(start) =>
            onUpdate({
              start,
              end:
                object.end === null ? null : Math.max(start + 0.01, object.end),
            })
          }
        />
        {object.end !== null && (
          <NumberField
            label="Object ends at"
            value={object.end}
            min={object.start + 0.01}
            onChange={(end) => onUpdate({ end })}
          />
        )}
      </div>
      <label className="scene-checkbox">
        <input
          type="checkbox"
          checked={object.end === null}
          onChange={(e) =>
            onUpdate({
              end: e.target.checked
                ? null
                : Math.max(object.start + 0.1, time + 1),
            })
          }
        />
        Visible until film ends
      </label>
      {!!asset?.animations.length && (
        <>
          <h3 className="scene-subtitle">Embedded animation</h3>
          <select
            aria-label="Asset animation"
            value={object.animation}
            onChange={(e) => onUpdate({ animation: +e.target.value })}
          >
            <option value={-1}>None</option>
            {asset.animations.map((name, i) => (
              <option key={i} value={i}>
                {name || `Animation ${i + 1}`}
              </option>
            ))}
          </select>
          <NumberField
            label="Animation speed"
            value={object.animationSpeed}
            min={0.1}
            max={4}
            onChange={(animationSpeed) => onUpdate({ animationSpeed })}
          />
          <label className="scene-checkbox">
            <input
              type="checkbox"
              checked={object.loop}
              onChange={(e) => onUpdate({ loop: e.target.checked })}
            />
            Loop animation
          </label>
        </>
      )}
      {object.keys.length > 0 && (
        <p className="studio-hint">
          Changing an animated transform updates a key at the playhead.
        </p>
      )}
    </fieldset>
  );
}
function XIcon() {
  return <span aria-hidden="true">×</span>;
}
export function SceneCameraInspector({
  clip,
  sourceTime,
  disabled,
  current,
  onCapture,
  onChange,
  onSeek,
}: {
  clip: StudioClip;
  sourceTime: number;
  disabled: boolean;
  current: CameraKey;
  onCapture: () => void;
  onChange: (patch: Partial<StudioClip>) => void;
  onSeek: (source: number) => void;
}) {
  const keys = clip.cameraKeys ?? [],
    pose = sampleCamera(keys, sourceTime) ?? current;
  function change(patch: Partial<CameraKey>) {
    const key = { t: sourceTime, ...pose, ease: "smooth" as const, ...patch };
    onChange({
      camera: "custom",
      cameraKeys: [
        ...keys.filter((k) => Math.abs(k.t - sourceTime) > 0.001),
        key,
      ].sort((a, b) => a.t - b.t),
    });
  }
  return (
    <fieldset className="scene-fields" disabled={disabled}>
      <p className="studio-hint">
        Orbit the viewport in Scene mode, then capture the view. Camera keys use
        the recorded flight's source seconds.
      </p>
      <button className="scene-wide" onClick={onCapture}>
        <Camera size={15} />
        Capture camera key
      </button>
      <label>
        Camera anchor
        <select
          aria-label="Camera anchor"
          value={clip.cameraAnchor ?? "aircraft"}
          onChange={(e) =>
            onChange({ cameraAnchor: e.target.value as "world" | "aircraft" })
          }
        >
          <option value="aircraft">Track the aircraft</option>
          <option value="world">Fixed in the world</option>
        </select>
      </label>
      <NumberField
        label="Camera field of view"
        value={pose.fov}
        min={10}
        max={120}
        step={1}
        onChange={(fov) => change({ fov })}
      />
      <VectorFields
        name="Camera position"
        value={pose.position}
        onChange={(position) => change({ position })}
      />
      <VectorFields
        name="Camera target"
        value={pose.target}
        onChange={(target) => change({ target })}
      />
      <h3 className="scene-subtitle">Camera keys</h3>
      <div className="scene-key-list">
        {keys.map((key) => (
          <div key={key.t}>
            <button onClick={() => onSeek(key.t)}>{seconds(key.t)}</button>
            <select
              aria-label={`Camera key easing at ${key.t}`}
              value={key.ease}
              onChange={(e) =>
                onChange({
                  cameraKeys: keys.map((k) =>
                    k.t === key.t ? { ...k, ease: e.target.value as Ease } : k,
                  ),
                })
              }
            >
              <option value="smooth">Smooth</option>
              <option value="linear">Linear</option>
              <option value="hold">Hold</option>
            </select>
            <button
              aria-label={`Remove camera key at ${key.t}`}
              onClick={() =>
                onChange({
                  cameraKeys: keys.filter((k) => k.t !== key.t),
                  camera: keys.length === 1 ? "orbit" : clip.camera,
                })
              }
            >
              <XIcon />
            </button>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
export function SceneProjectInspector({
  scene,
  assets,
  disabled,
  onChange,
}: {
  scene: StudioScene;
  assets: StudioAsset[];
  disabled: boolean;
  onChange: (s: StudioScene) => void;
}) {
  const updateSound = (id: string, v: Partial<SoundLayer>) =>
    onChange({
      ...scene,
      sounds: scene.sounds.map((a) => (a.id === id ? { ...a, ...v } : a)),
    });
  return (
    <fieldset className="scene-fields" disabled={disabled}>
      <h3 className="scene-subtitle">Render settings</h3>
      <label>
        Resolution
        <select
          aria-label="Export resolution"
          value={scene.render.size}
          onChange={(e) =>
            onChange({
              ...scene,
              render: {
                ...scene.render,
                size: e.target.value as "720p" | "1080p",
              },
            })
          }
        >
          <option value="1080p">1920 × 1080 · Full HD</option>
          <option value="720p">1280 × 720 · HD</option>
        </select>
      </label>
      <label>
        Frame rate
        <select
          aria-label="Export frame rate"
          value={scene.render.fps}
          onChange={(e) =>
            onChange({
              ...scene,
              render: { ...scene.render, fps: +e.target.value as 30 | 60 },
            })
          }
        >
          <option value={30}>30 fps</option>
          <option value={60}>60 fps</option>
        </select>
      </label>
      <NumberField
        label="Exposure"
        value={scene.exposure}
        min={0.1}
        max={4}
        step={0.1}
        onChange={(exposure) => onChange({ ...scene, exposure })}
      />
      <label>
        Lighting
        <select
          aria-label="Scene lighting"
          value={scene.lighting}
          onChange={(e) =>
            onChange({
              ...scene,
              lighting: e.target.value as StudioScene["lighting"],
            })
          }
        >
          <option value="recorded">As recorded</option>
          <option value="day">Daylight</option>
          <option value="night">Night</option>
        </select>
      </label>
      <h3 className="scene-subtitle">Soundtrack layers</h3>
      {!scene.sounds.length && (
        <p className="studio-hint">
          Import audio in the Asset library to add a music or sound layer.
        </p>
      )}
      {scene.sounds.map((layer) => (
        <div className="scene-audio-layer" key={layer.id}>
          <b>
            <Music size={13} />
            {layer.name}
          </b>
          <small>
            {assets.find((a) => a.id === layer.assetId)?.duration?.toFixed(1)}{" "}
            seconds of source audio
          </small>
          <div className="scene-pair">
            <NumberField
              label={`Audio start ${layer.name}`}
              value={layer.start}
              min={0}
              onChange={(start) =>
                updateSound(layer.id, {
                  start,
                  end:
                    layer.end === null
                      ? null
                      : Math.max(start + 0.01, layer.end),
                })
              }
            />
            <NumberField
              label={`Audio offset ${layer.name}`}
              value={layer.offset}
              min={0}
              onChange={(offset) => updateSound(layer.id, { offset })}
            />
          </div>
          <label>
            Volume
            <input
              aria-label={`Audio volume ${layer.name}`}
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={layer.volume}
              onChange={(e) =>
                updateSound(layer.id, { volume: +e.target.value })
              }
            />
          </label>
          <div className="scene-pair">
            <NumberField
              label={`Fade in ${layer.name}`}
              value={layer.fadeIn}
              min={0}
              max={60}
              onChange={(fadeIn) => updateSound(layer.id, { fadeIn })}
            />
            <NumberField
              label={`Fade out ${layer.name}`}
              value={layer.fadeOut}
              min={0}
              max={60}
              onChange={(fadeOut) => updateSound(layer.id, { fadeOut })}
            />
          </div>
          <label className="scene-checkbox">
            <input
              type="checkbox"
              checked={layer.loop}
              onChange={(e) =>
                updateSound(layer.id, { loop: e.target.checked })
              }
            />
            Loop audio
          </label>
          <label className="scene-checkbox">
            <input
              type="checkbox"
              checked={layer.end === null}
              onChange={(e) =>
                updateSound(layer.id, {
                  end: e.target.checked
                    ? null
                    : Math.max(layer.start + 0.1, layer.start + 5),
                })
              }
            />
            Play until film ends
          </label>
          {layer.end !== null && (
            <NumberField
              label={`Audio end ${layer.name}`}
              value={layer.end}
              min={layer.start + 0.01}
              onChange={(end) => updateSound(layer.id, { end })}
            />
          )}
          <button
            onClick={() =>
              onChange({
                ...scene,
                sounds: scene.sounds.filter((a) => a.id !== layer.id),
              })
            }
          >
            <Trash2 size={12} />
            Remove layer
          </button>
        </div>
      ))}
    </fieldset>
  );
}
export function SceneKeyTimeline({
  scene,
  duration,
  selected,
  onSelect,
  onSeek,
}: {
  scene: StudioScene;
  duration: number;
  selected: string | null;
  onSelect: (id: string) => void;
  onSeek: (t: number) => void;
}) {
  const max = Math.max(0.1, duration);
  return (
    <div className="scene-tracks">
      <div className="scene-track-heading">
        Scene tracks <small>Keys & visibility</small>
      </div>
      {scene.objects.map((object) => (
        <div
          className={`scene-track ${object.id === selected ? "selected" : ""}`}
          key={object.id}
        >
          <button onClick={() => onSelect(object.id)}>{object.name}</button>
          <div className="scene-track-lane">
            <span
              className="scene-track-range"
              style={{
                left: `${Math.min(100, (object.start / max) * 100)}%`,
                width: `${Math.max(0, Math.min(100, ((object.end ?? max) / max) * 100) - (object.start / max) * 100)}%`,
              }}
            />
            {object.keys
              .filter((k) => k.t <= max)
              .map((key) => (
                <button
                  key={key.t}
                  className="scene-key-dot"
                  aria-label={`${object.name} keyframe at ${key.t} seconds`}
                  style={{ left: `${(key.t / max) * 100}%` }}
                  onClick={() => {
                    onSelect(object.id);
                    onSeek(key.t);
                  }}
                >
                  ◆
                </button>
              ))}
          </div>
        </div>
      ))}
      {scene.sounds.map((layer) => (
        <div className="scene-track audio" key={layer.id}>
          <span>{layer.name}</span>
          <div className="scene-track-lane">
            <span
              className="scene-track-range"
              style={{
                left: `${Math.min(100, (layer.start / max) * 100)}%`,
                width: `${Math.max(0, Math.min(100, ((layer.end ?? max) / max) * 100) - (layer.start / max) * 100)}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
