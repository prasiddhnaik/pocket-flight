import { type StudioScene } from "../studio-scene";

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
