import type { PointerEvent } from "react";
import type { AircraftId } from "../aircraft";
import type { PocketFlight } from "../game";

const clampAxis = (v: number) => Math.max(-1, Math.min(1, v));

export function TouchControls({ game, aircraftId, automaticConfiguration, beginnerAssist }: {
  game: PocketFlight | null;
  aircraftId: AircraftId;
  automaticConfiguration: boolean;
  beginnerAssist: boolean;
}) {
  const steer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (game)
      game.touch = {
        roll: clampAxis((e.clientX - rect.x - rect.width / 2) / (rect.width / 2)),
        pitch: clampAxis((e.clientY - rect.y - rect.height / 2) / (rect.height / 2)),
        yaw: 0,
      };
  };
  const release = () => {
    if (game) game.touch = { pitch: 0, roll: 0, yaw: 0 };
  };
  return (
    <div className="touch-controls">
      <div
        className="touch-stick"
        role="group"
        aria-label="Flight stick: drag to pitch and roll"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          steer(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) steer(e);
        }}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <span>+</span>
        <small>FLY</small>
      </div>
      <button
        className="touch-brake"
        onPointerDown={() => game?.keys.add("KeyB")}
        onPointerUp={() => game?.keys.delete("KeyB")}
        onPointerLeave={() => game?.keys.delete("KeyB")}
        onPointerCancel={() => game?.keys.delete("KeyB")}
      >
        BRAKE
      </button>
      {aircraftId !== "finch" && !automaticConfiguration && (
        <div className="touch-configuration">
          <button onClick={() => game?.toggleGear()} aria-label="Toggle landing gear">GEAR</button>
          <button onClick={() => game?.cycleFlaps()} aria-label="Cycle flaps">FLAPS</button>
        </div>
      )}
      {!beginnerAssist && (
        <div className="touch-configuration">
          <button onClick={() => game?.adjustTrim(-0.02)} aria-label="Decrease elevator trim">TRIM −</button>
          <button onClick={() => game?.adjustTrim(0.02)} aria-label="Increase elevator trim">TRIM +</button>
        </div>
      )}
    </div>
  );
}
