import {
  Box,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Copy,
  Trash2,
  Diamond,
} from "lucide-react";
import { type SceneObject, type StudioScene } from "../studio-scene";

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
