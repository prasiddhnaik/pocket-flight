import { Play, Pause, RotateCcw } from "lucide-react";
import { clock } from "../studio-format";

export function StudioTransport({
  busy,
  playing,
  loading,
  sceneLoading,
  hasClips,
  time,
  duration,
  seek,
  play,
}: {
  busy: boolean;
  playing: boolean;
  loading: boolean;
  sceneLoading: boolean;
  hasClips: boolean;
  time: number;
  duration: number;
  seek: (time: number) => void;
  play: () => Promise<void>;
}) {
  return (
    <div className="studio-transport">
      <button
        aria-label="Back to start"
        disabled={busy}
        onClick={() => seek(0)}
      >
        <RotateCcw size={17} />
      </button>
      <button
        className="studio-play"
        aria-label={playing ? "Pause preview" : "Play preview"}
        disabled={busy || loading || sceneLoading || !hasClips}
        onClick={() => void play()}
      >
        {playing ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <span>
        {clock(time)} <small>/ {clock(duration)}</small>
      </span>
      <input
        aria-label="Replay playhead"
        type="range"
        min={0}
        max={Math.max(0.1, duration)}
        step={0.01}
        value={time}
        disabled={busy || !hasClips}
        onChange={(e) => seek(+e.target.value)}
      />
    </div>
  );
}
