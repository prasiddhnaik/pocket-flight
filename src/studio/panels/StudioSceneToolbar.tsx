import {
  Move3D,
  Rotate3D,
  Scaling,
  Focus,
  Magnet,
  Diamond,
  Camera,
} from "lucide-react";
import type { SceneEditorOptions } from "../replay-preview";
export function StudioSceneToolbar({
  editingMode,
  busy,
  tool,
  snap,
  autoKey,
  setEditingMode,
  stop,
  setTool,
  frameObject,
  setSnap,
  setAutoKey,
  setView,
  captureCamera,
}: {
  editingMode: boolean;
  busy: boolean;
  tool: SceneEditorOptions["tool"];
  snap: boolean;
  autoKey: boolean;
  setEditingMode: (value: boolean) => void;
  stop: () => void;
  setTool: (tool: SceneEditorOptions["tool"]) => void;
  frameObject: () => void;
  setSnap: (value: boolean) => void;
  setAutoKey: (value: boolean) => void;
  setView: (view: "front" | "side" | "top") => void;
  captureCamera: () => void;
}) {
  return (
    <>
      <div className="scene-toolbar">
        <div className="scene-tabs">
          <button
            aria-pressed={!editingMode}
            disabled={busy}
            onClick={() => setEditingMode(false)}
          >
            Rendered preview
          </button>
          <button
            aria-pressed={editingMode}
            disabled={busy}
            onClick={() => {
              stop();
              setEditingMode(true);
            }}
          >
            Scene mode
          </button>
        </div>
        <div className="studio-button-row">
          {(
            [
              { value: "translate", icon: Move3D, label: "Move (G)" },
              { value: "rotate", icon: Rotate3D, label: "Rotate (R)" },
              { value: "scale", icon: Scaling, label: "Scale (S)" },
            ] as const
          ).map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              aria-label={label}
              aria-pressed={tool === value && editingMode}
              disabled={busy}
              onClick={() => {
                setTool(value);
                setEditingMode(true);
              }}
            >
              <Icon size={15} />
            </button>
          ))}
          <button
            aria-label="Frame selected object (F)"
            disabled={busy}
            onClick={() => {
              setEditingMode(true);
              frameObject();
            }}
          >
            <Focus size={16} />
          </button>
          <button
            aria-label="Toggle transform snapping"
            aria-pressed={snap}
            disabled={busy}
            onClick={() => setSnap(!snap)}
          >
            <Magnet size={15} />
          </button>
          <button
            aria-label="Toggle auto keyframes"
            aria-pressed={autoKey}
            disabled={busy}
            onClick={() => setAutoKey(!autoKey)}
          >
            <Diamond size={14} />
          </button>
        </div>
      </div>
      {editingMode && (
        <div className="scene-view-tools">
          <span>Orbit: drag · Pan: right-drag · Zoom: wheel</span>
          <button disabled={busy} onClick={() => setView("front")}>
            Front
          </button>
          <button disabled={busy} onClick={() => setView("side")}>
            Side
          </button>
          <button disabled={busy} onClick={() => setView("top")}>
            Top
          </button>
          <button disabled={busy} onClick={captureCamera}>
            <Camera size={13} />
            Camera key
          </button>
        </div>
      )}
    </>
  );
}
