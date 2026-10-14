import type { KeyboardEvent, PointerEvent } from "react";
import { clamp01 } from "./geometry";
import { useSpring } from "./useSpring";
import { needleSpring } from "./spring";

type BarGaugeProps = {
  label: string;
  fraction: number;
  readout: string;
  tone?: "cyan" | "green" | "amber" | "red";
  segments?: number;
  pulse?: boolean;
  onDrag?: (fraction: number) => void;
  className?: string;
};

export function BarGauge({ label, fraction, readout, tone = "green", segments, pulse = false, onDrag, className = "" }: BarGaugeProps) {
  const value = clamp01(fraction);
  const fill = useSpring<HTMLDivElement>(value, (el, v) => {
    el.style.transform = `scaleY(${clamp01(v)})`;
  }, needleSpring);
  const setFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onDrag?.(clamp01((r.bottom - e.clientY) / r.height));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowUp" || e.key === "ArrowRight" ? 0.05 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -0.05 : 0;
    if (!step) return;
    e.preventDefault();
    onDrag?.(clamp01(value + step));
  };
  const lit = segments ? Math.round(value * segments) : 0;
  return (
    <div className={`hud-bar tone-${tone} ${pulse ? "pulse" : ""} ${onDrag ? "draggable" : ""} ${className}`}>
      <div
        className="hud-bar-track"
        aria-label={label}
        {...(onDrag
          ? {
              role: "slider",
              tabIndex: 0,
              "aria-valuemin": 0,
              "aria-valuemax": 100,
              "aria-valuenow": Math.round(value * 100),
              onKeyDown: onKey,
              onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setFromPointer(e);
              },
              onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromPointer(e);
              },
            }
          : { role: "img" })}
      >
        {segments ? (
          Array.from({ length: segments }, (_, i) => <i key={i} className={i < lit ? "on" : ""} />)
        ) : (
          <div ref={fill} className="hud-bar-fill" />
        )}
      </div>
      <span className="hud-label">{label}</span>
      <b className="hud-value">{readout}</b>
    </div>
  );
}
