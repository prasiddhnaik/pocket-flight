import { solveWing, type WingGeometry, type Solution } from "../lab/solver";
import {
  convergenceCheck,
  experimentRecord,
  runSweep,
} from "../lab/experiments";
import { zeroLiftEstimate } from "../lab/aircraft";
import baseline from "../lab/heron-baseline.json";
import measured from "../src/aircraft/heron/geometry.json";

const original: WingGeometry = {
  name: "Heron before aerodynamic revision",
  revision: baseline.revision,
  stations: baseline.stations,
  assumptions: baseline.assumptions,
};

const conditions = { speed: 65, density: 1.225, alpha: 4 };
function candidate(washout: number): WingGeometry {
  return {
    name: `Utility wing with ${washout} degrees washout`,
    revision: `${measured.revision}:washout-${washout}`,
    assumptions: [
      "14% thickness, 2% sinusoidal camber; conceptual wing only.",
      "Incidence changes linearly from 2.5 degrees at the root; quarter-chord height from CAD design stations.",
    ],
    stations: measured.stations.map((s) => {
      const { x } = s,
        oldPitch = (s.incidence * Math.PI) / 180;
      const chord = s.chord / Math.cos(oldPitch);
      const hinge = -s.leading - 0.72 * s.chord;
      const quarterHeight = s.y - 0.47 * chord * Math.sin(oldPitch);
      const incidence =
        2.5 - washout * Math.max(0, Math.min(1, (x - 0.52) / (7.45 - 0.52)));
      const a = (incidence * Math.PI) / 180;
      return {
        x,
        leading: -(hinge + 0.72 * chord * Math.cos(a)),
        chord: chord * Math.cos(a),
        y: quarterHeight + 0.47 * chord * Math.sin(a),
        incidence,
        zeroLiftAlpha: zeroLiftEstimate(0.02),
      };
    }),
  };
}
function atLift(wing: WingGeometry, target: number): Solution {
  let low = -8,
    high = 8;
  for (let i = 0; i < 18; i++) {
    const alpha = (low + high) / 2,
      result = solveWing(wing, { ...conditions, alpha }, 144);
    if (result.cl < target) low = alpha;
    else high = alpha;
  }
  return solveWing(wing, { ...conditions, alpha: (low + high) / 2 }, 144);
}
function summary(wing: WingGeometry) {
  const zero = solveWing(wing, { ...conditions, alpha: 0 }, 96),
    four = solveWing(wing, conditions, 96);
  const matched = atLift(wing, 0.7),
    q = matched.dynamicPressure;
  const levelFlight = atLift(wing, (3995 * 9.81) / (q * four.area));
  const sections = matched.panels.map((p) => ({
    x: p.x,
    cl: p.liftPerSpan / (q * p.chord),
  }));
  const peak = (lo: number, hi: number) =>
    Math.max(
      ...sections
        .filter((p) => Math.abs(p.x) >= lo && Math.abs(p.x) <= hi)
        .map((p) => p.cl),
    );
  return {
    name: wing.name,
    area: four.area,
    aspectRatio: four.aspectRatio,
    cl0: zero.cl,
    liftSlope: (four.cl - zero.cl) / ((4 * Math.PI) / 180),
    alphaAtCl07: matched.conditions.alpha,
    spanEfficiencyAtCl07: matched.efficiency,
    cdiAtCl07: matched.cdi,
    inboardPeakSectionCl: peak(0.6, 4.7),
    aileronPeakSectionCl: peak(4.86, 7.45),
    sectionLoadingAtCl07: sections,
    sameWeightFlight: {
      massKg: 3995,
      speed: conditions.speed,
      density: conditions.density,
      alpha: levelFlight.conditions.alpha,
      cl: levelFlight.cl,
      liftN: levelFlight.lift,
      inducedDragN: levelFlight.inducedDrag,
      spanEfficiency: levelFlight.efficiency,
    },
    convergence: convergenceCheck(wing, conditions),
    record: experimentRecord(runSweep(wing, conditions)),
  };
}
const result = {
  solver: "private wind tunnel",
  scope:
    "Linear attached-flow main-wing comparison; no viscous drag, stall onset, tail or fuselage interference prediction. Section-loading comparisons use CL 0.7; drag-force comparisons use equal weight, speed and density.",
  baseline: summary(original),
  candidates: [0, 1.5, 2, 2.5, 3].map((w) => summary(candidate(w))),
};
await Bun.write(
  "output/heron-realism/wing-study.json",
  JSON.stringify(result, null, 2),
);
for (const row of [result.baseline, ...result.candidates])
  console.log(JSON.stringify({ ...row, record: undefined }));
