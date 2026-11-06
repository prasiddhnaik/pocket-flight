import { useEffect, useState } from "react";
import { Diamond } from "lucide-react";
import {
  sampleTransform,
  type SceneObject,
  type Transform,
  type Ease,
  type Vec3,
} from "../studio-scene";
import { type StudioAsset } from "../studio-assets";
import type { PlacementAction } from "../studio-placement";
import { NumberField, VectorFields, XIcon } from "./fields";
import { seconds } from "../studio-format";

export function SceneObjectInspector({
  object,
  asset,
  time,
  disabled,
  dimensions,
  placementDisabled,
  onPlace,
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
  dimensions: Vec3 | null;
  placementDisabled: boolean;
  onPlace: (action: PlacementAction, meters?: number) => void;
  onUpdate: (v: Partial<SceneObject>) => void;
  onPose: (pose: Transform) => void;
  onKey: (ease: Ease) => void;
  onRemoveKey: (t: number) => void;
  onSeek: (t: number) => void;
}) {
  const pose = sampleTransform(object, time);
  const [targetSize, setTargetSize] = useState("");
  useEffect(() => setTargetSize(""), [object.id]);
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
      <h3 className="scene-subtitle">Placement</h3>
      <div className="scene-placement-dimensions" aria-live="polite">
        {dimensions
          ? `W ${dimensions[0]} · H ${dimensions[1]} · D ${dimensions[2]} m`
          : "Select a visible, loaded model to measure its size."}
      </div>
      <p className="studio-hint">
        Dimensions at this pose, in{" "}
        {object.anchor === "world" ? "world" : "aircraft-local"} axes.
      </p>
      <div className="scene-pair scene-placement-actions">
        <button disabled={placementDisabled} onClick={() => onPlace("beside")}>
          Place beside aircraft
        </button>
        <button
          disabled={placementDisabled || object.anchor !== "world"}
          onClick={() => onPlace("ground")}
        >
          Place on ground
        </button>
      </div>
      <label>
        Largest dimension · meters
        <input
          aria-label="Target object size in meters"
          type="number"
          min="0.001"
          step="0.1"
          placeholder={dimensions ? String(Math.max(...dimensions)) : "Size"}
          value={targetSize}
          disabled={placementDisabled}
          onChange={(e) => setTargetSize(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (targetSize.trim() && Number(targetSize) > 0)
                onPlace("size", Number(targetSize));
            }
          }}
        />
      </label>
      <button
        className="scene-wide"
        disabled={
          placementDisabled ||
          !targetSize.trim() ||
          !Number.isFinite(Number(targetSize)) ||
          Number(targetSize) <= 0
        }
        onClick={() => onPlace("size", Number(targetSize))}
      >
        Apply size · keep proportions
      </button>
      <p className="studio-hint">
        {object.anchor === "world"
          ? "Ground placement samples terrain and runway height beneath the object's bounds."
          : "Ground placement is available for World-anchored objects."}
        {object.keys.length ? " Placement updates a key at the playhead." : ""}
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
