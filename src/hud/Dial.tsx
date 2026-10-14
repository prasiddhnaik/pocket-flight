import { activeBand, arcPath, polar, ticks, valueAngle, type Band, type Scale } from "./geometry";
import { RollingDigits } from "./RollingDigits";
import { useSpring } from "./useSpring";
import { needleSpring } from "./spring";

const C = 100;
const R = 86;

export type DialProps = {
  label: string;
  min: number;
  max: number;
  value: number;
  start?: number;
  sweep?: number;
  majorStep: number;
  minorStep: number;
  tickLabel?: (value: number) => string;
  bands?: Band[];
  redline?: number;
  readout: string;
  unit?: string;
  size: "large" | "small";
  className?: string;
};

export function Dial({
  label, min, max, value, start = 135, sweep = 270, majorStep, minorStep,
  tickLabel = String, bands = [], redline, readout, unit, size, className = "",
}: DialProps) {
  const scale: Scale = { min, max, start, sweep };
  const needle = useSpring<SVGGElement>(valueAngle(scale, value), (el, angle) =>
    el.setAttribute("transform", `rotate(${angle.toFixed(2)} ${C} ${C})`),
    needleSpring,
  );
  const lit = activeBand(bands, value);
  const major = new Set(ticks(min, max, majorStep));
  const line = (v: number, inner: number, outer: number) => {
    const a = valueAngle(scale, v);
    const [x1, y1] = polar(C, C, inner, a);
    const [x2, y2] = polar(C, C, outer, a);
    return { x1, y1, x2, y2 };
  };
  return (
    <div className={`hud-dial hud-dial-${size} ${className}`} role="img" aria-label={`${label} ${readout}${unit ? ` ${unit}` : ""}`}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle className="hud-rim" cx={C} cy={C} r={96} pathLength={1} />
        <circle className="hud-rim-inner" cx={C} cy={C} r={R + 3} />
        {bands.map((b, i) => (
          <path
            key={i}
            className={`hud-band hud-band-${b.tone} ${i === lit ? "lit" : ""}`}
            d={arcPath(C, C, R - 4, valueAngle(scale, b.from), valueAngle(scale, b.to))}
          />
        ))}
        {ticks(min, max, minorStep).map((v) => {
          const big = major.has(v);
          const mid = !big && (v - min) % (minorStep * 2) === 0;
          return <line key={v} className={`hud-tick ${big ? "major" : mid ? "mid" : ""}`} {...line(v, R - (big ? 15 : mid ? 10 : 7), R)} />;
        })}
        {[...major].map((v) => {
          const [x, y] = polar(C, C, R - 30, valueAngle(scale, v));
          return <text key={v} className="hud-tick-label" x={x} y={y}>{tickLabel(v)}</text>;
        })}
        {redline !== undefined && <line className="hud-redline" {...line(redline, R - 15, R + 4)} />}
        <g ref={needle} className="hud-needle">
          <path d={`M${C - 16} ${C - 2.2} L${C + R - 10} ${C - 0.8} L${C + R - 4} ${C} L${C + R - 10} ${C + 0.8} L${C - 16} ${C + 2.2} Z`} />
        </g>
        <circle className="hud-hub" cx={C} cy={C} r={7} />
        <circle className="hud-hub-cap" cx={C} cy={C} r={3} />
      </svg>
      <div className="hud-readout">
        <RollingDigits value={readout} />
        {unit && <small>{unit}</small>}
      </div>
      <span className="hud-label">{label}</span>
    </div>
  );
}
