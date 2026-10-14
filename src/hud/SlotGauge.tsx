import { clamp01 } from "./geometry";
import { useSpring } from "./useSpring";
import { needleSpring } from "./spring";

export function SlotGauge({ label, position, readout }: { label: string; position: number; readout: string }) {
  const marker = useSpring<HTMLDivElement>(clamp01(position), (el, v) => {
    el.style.top = `${clamp01(v) * 100}%`;
  }, needleSpring);
  return (
    <div className="hud-slot" role="img" aria-label={`${label} ${readout}`}>
      <div className="hud-slot-track">
        <div ref={marker} className="hud-slot-marker" />
      </div>
      <span className="hud-label">{label}</span>
      <b className="hud-value">{readout}</b>
    </div>
  );
}
