import { Download } from "lucide-react";
import type { ExportState } from "../../replay/replay-export";
import type { StudioScene } from "../studio-scene";

export function StudioExportStatus({
  exportBusy,
  preparingExport,
  exportState,
  time,
  duration,
  scene,
  cancelExport,
}: {
  exportBusy: boolean;
  preparingExport: boolean;
  exportState: ExportState;
  time: number;
  duration: number;
  scene: StudioScene;
  cancelExport: () => void;
}) {
  return (
    <>
      {(exportBusy ||
        exportState.phase === "ready" ||
        exportState.phase === "error") && (
        <div className="studio-export-status" role="status">
          {exportBusy ? (
            <>
              <span>
                {preparingExport
                  ? "Preparing aircraft…"
                  : exportState.phase === "finishing"
                    ? "Finishing video…"
                    : `Exporting ${Math.round((time / Math.max(0.1, duration)) * 100)}% · keep this tab visible`}
              </span>
              <button onClick={() => cancelExport()}>Cancel export</button>
            </>
          ) : exportState.phase === "ready" ? (
            <>
              <span>
                Video exported · {scene.render.size} · {scene.render.fps} fps
              </span>
              <details className="studio-render-review">
                <summary>Watch export</summary>
                <video
                  controls
                  preload="metadata"
                  src={exportState.url}
                  aria-label="Exported film preview"
                />
              </details>
              <a href={exportState.url} download={exportState.filename}>
                <Download size={15} />
                Save video again
              </a>
            </>
          ) : (
            <span>{exportState.message}</span>
          )}
        </div>
      )}
    </>
  );
}
