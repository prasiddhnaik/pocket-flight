import { useRef } from "react";
import { headingReadout } from "../flight-ui";
import { polar, unwrapHeading } from "./geometry";
import { RollingDigits } from "./RollingDigits";
import { useSpring } from "./useSpring";
import { needleSpring } from "./spring";

const C = 100;
const R = 86;
const cardinals: Record<number, string> = { 0: "N", 90: "E", 180: "S", 270: "W" };
const marks = Array.from({ length: 72 }, (_, i) => i * 5);

export function CompassRose({ heading }: { heading: number }) {
  const unwrapped = useRef(heading);
  unwrapped.current = unwrapHeading(unwrapped.current, heading);
  const ring = useSpring<SVGGElement>(-unwrapped.current, (el, a) => el.setAttribute("transform", `rotate(${a.toFixed(2)} ${C} ${C})`), needleSpring);
  const { degrees, cardinal } = headingReadout(heading);
  return (
    <div className="hud-compass" role="img" aria-label={`Heading ${degrees} degrees ${cardinal}`}>
      <div className="hud-heading-box">
        <RollingDigits value={degrees} />°
      </div>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle className="hud-rim" cx={C} cy={C} r={96} pathLength={1} />
        <g ref={ring}>
          {marks.map((d) => {
            const big = d % 30 === 0;
            const mid = d % 10 === 0;
            const [x1, y1] = polar(C, C, R - (big ? 14 : mid ? 9 : 5), d - 90);
            const [x2, y2] = polar(C, C, R, d - 90);
            return <line key={d} className={`hud-tick ${big ? "major" : mid ? "mid" : ""}`} x1={x1} y1={y1} x2={x2} y2={y2} />;
          })}
          {marks.filter((d) => d % 30 === 0).map((d) => {
            const [x, y] = polar(C, C, R - 29, d - 90);
            const label = cardinals[d] ?? String(d / 10);
            return (
              <text key={d} x={x} y={y} transform={`rotate(${d} ${x} ${y})`} className={`hud-compass-label ${cardinals[d] ? "cardinal" : ""} ${d === 0 ? "north" : ""}`}>
                {label}
              </text>
            );
          })}
        </g>
        <path className="hud-lubber" d={`M${C - 7} 1 L${C + 7} 1 L${C} 13 Z`} />
        <path className="hud-aircraft" transform={`translate(${C} ${C}) scale(1.7)`} d="M0 -13 L2.6 -2 L14 4 L14 6.5 L2.6 3.5 L2 10 L5.5 12.5 L5.5 14 L0 12.8 L-5.5 14 L-5.5 12.5 L-2 10 L-2.6 3.5 L-14 6.5 L-14 4 L-2.6 -2 Z" />
      </svg>
    </div>
  );
}
