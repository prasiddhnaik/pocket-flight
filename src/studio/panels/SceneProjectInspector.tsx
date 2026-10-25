import { Music, Trash2 } from "lucide-react";
import { type StudioScene, type SoundLayer } from "../studio-scene";
import { type StudioAsset } from "../studio-assets";
import { NumberField } from "./fields";

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
