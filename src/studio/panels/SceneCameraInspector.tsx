import { Camera } from "lucide-react";
import { sampleCamera, type CameraKey, type Ease } from "../studio-scene";
import { type StudioClip } from "../studio-model";
import { NumberField, VectorFields, XIcon } from "./fields";
import { seconds } from "../studio-format";

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
