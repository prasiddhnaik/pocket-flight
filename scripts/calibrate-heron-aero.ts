import { solveWing, SOLVER_VERSION } from "../lab/solver";
import measured from "../src/aircraft/heron/geometry.json";
import baseline from "../lab/heron-baseline.json";

const transfer = await Bun.file(
  new URL("../assets/heron/GLB/cad-transfer.json", import.meta.url),
).json();
const conditions = { speed: 65, density: 1.225, alpha: 0 };
const zero = solveWing(measured, conditions, 96);
const four = solveWing(measured, { ...conditions, alpha: 4 }, 96);
const liftSlope = (four.cl - zero.cl) / ((4 * Math.PI) / 180);
const tail = [
  { ...transfer.tailStations[0], x: 0 },
  ...transfer.tailStations,
] as {
  x: number;
  leading: number;
  chord: number;
}[];
let tailArea = 0,
  tailChordSquared = 0,
  tailQuarterMoment = 0;
for (let i = 1; i < tail.length; i++) {
  const a = tail[i - 1],
    b = tail[i],
    dx = b.x - a.x;
  const qa = a.leading + a.chord / 4,
    qb = b.leading + b.chord / 4;
  tailArea += dx * (a.chord + b.chord);
  tailChordSquared +=
    (2 * dx * (a.chord ** 2 + a.chord * b.chord + b.chord ** 2)) / 3;
  tailQuarterMoment +=
    (dx / 3) *
    (2 * qa * a.chord + qa * b.chord + qb * a.chord + 2 * qb * b.chord);
}
const tailSpan = 2 * tail.at(-1)!.x,
  tailAspectRatio = tailSpan ** 2 / tailArea;
const tailLiftSlope =
  (2 * Math.PI * tailAspectRatio) / (2 + Math.sqrt(4 + tailAspectRatio ** 2));
const tailQuarterChordZ = tailQuarterMoment / tailArea;
// Preliminary tail model: finite-wing slope, estimated downwash and tail pressure.
// These are geometry-informed stability estimates, not a coupled wing/body/tail VLM.
const tailPressureRatio = 0.9,
  downwashGradient = (2 * liftSlope) / (Math.PI * four.aspectRatio);
const wingWeight = liftSlope * measured.wingArea;
const tailWeight =
  tailPressureRatio * tailLiftSlope * tailArea * (1 - downwashGradient);
const bodyDestabilization = 0.03 * measured.meanAerodynamicChord;
const neutralPointZ =
  (wingWeight * measured.quarterChordZ + tailWeight * tailQuarterChordZ) /
    (wingWeight + tailWeight) -
  bodyDestabilization;
const tailArm = tailQuarterChordZ - measured.quarterChordZ;
const tailVolume =
  (tailArea * tailArm) / (measured.wingArea * measured.meanAerodynamicChord);
const pitchDamping =
  ((-2 * tailPressureRatio * tailLiftSlope * tailArea) / measured.wingArea) *
  (tailArm / measured.meanAerodynamicChord) ** 2;
const elevator =
  tailPressureRatio *
  tailLiftSlope *
  tailVolume *
  0.65 *
  ((25 * Math.PI) / 180);
// Preserve the prior estimated parasite drag area as wing reference area changes.
// Wing-only VLM cannot establish a reduction in fuselage, gear or strut drag.
const estimatedDragArea = 0.036 * solveWing(baseline, conditions, 24).area;
const result = {
  geometryRevision: measured.revision,
  solver: SOLVER_VERSION,
  panelCount: 96,
  cl0: zero.cl,
  liftSlope,
  neutralPointZ,
  pitchDamping,
  elevator,
  cd0: estimatedDragArea / measured.wingArea,
  estimatedDragArea,
  tail: {
    area: tailArea,
    span: tailSpan,
    meanAerodynamicChord: tailChordSquared / tailArea,
    quarterChordZ: tailQuarterChordZ,
    aspectRatio: tailAspectRatio,
    liftSlope: tailLiftSlope,
    volumeCoefficient: tailVolume,
    pressureRatio: tailPressureRatio,
    downwashGradient,
    bodyDestabilization,
  },
  assumptions: [
    "Main-wing CL0 and lift slope use the private lab's attached-flow VLM at fuselage angles 0 and 4 degrees. CAD incidence and washout are included once.",
    "Neutral point and pitch damping use an analytical finite-wing tail model. Tail pressure ratio 0.90, downwash 2a/(pi AR), body destabilization 3% MAC, elevator effectiveness 0.65 and maximum travel 25 degrees are estimates.",
    "Whole-aircraft profile drag, Oswald efficiency, CL limits, flap increments and post-stall behavior remain game estimates. No viscous CFD, propwash or measured flight calibration.",
    "Estimated parasite drag area is held at the previous 0.036 coefficient times 31.6804 square metres. Renormalizing by the smaller current wing area avoids claiming an unmeasured airframe drag reduction.",
  ],
};
await Bun.write(
  new URL("../src/aircraft/heron/aerodynamics.json", import.meta.url),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result));
