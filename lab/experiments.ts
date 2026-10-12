import {
  LIMITS,
  SOLVER_VERSION,
  cachedSolveWing,
  type Conditions,
  type Solution,
  type WingGeometry,
} from "./solver";

export function runSweep(
  geometry: WingGeometry,
  conditions: Conditions,
  range = { min: -8, max: 8, step: 1, panelCount: 96 },
) {
  const { min, max, step, panelCount } = range;
  if (
    ![min, max, step].every(Number.isFinite) ||
    min > max ||
    step <= 0 ||
    min < LIMITS.minAlpha ||
    max > LIMITS.maxAlpha ||
    (max - min) / step > 128
  )
    throw new Error(
      "Sweep must stay within −8° to +8°, with a positive step and at most 129 cases.",
    );
  const angles = Array.from(
    { length: Math.ceil((max - min) / step) + 1 },
    (_, i) => Math.min(max, min + i * step),
  );
  return angles.map((alpha) =>
    cachedSolveWing(geometry, { ...conditions, alpha }, panelCount),
  );
}

export function convergenceCheck(
  geometry: WingGeometry,
  conditions: Conditions,
) {
  const solutions = [24, 48, 96, 144].map((count) =>
    cachedSolveWing(geometry, conditions, count),
  );
  const a = solutions[2],
    b = solutions[3];
  const change = (x: number, y: number) =>
    (Math.abs(x - y) / Math.max(Math.abs(y), 1e-9)) * 100;
  return {
    rows: solutions.map((s) => ({
      panelCount: s.panels.length,
      cl: s.cl,
      cdi: s.cdi,
      residual: s.residual,
    })),
    liftChangePercent: change(a.cl, b.cl),
    dragChangePercent: change(a.cdi, b.cdi),
  };
}

export function experimentRecord(solutions: Solution[]) {
  if (!solutions.length)
    throw new Error("Run a condition or sweep before exporting.");
  if (
    solutions.some(
      (s) => s.geometry.revision !== solutions[0].geometry.revision,
    )
  )
    throw new Error(
      "Cannot combine different geometry revisions into one experiment.",
    );
  return {
    schemaVersion: 1,
    solver: SOLVER_VERSION,
    generatedAt: new Date().toISOString(),
    aircraft: solutions[0].geometry.name,
    geometryRevision: solutions[0].geometry.revision,
    assumptions: solutions[0].geometry.assumptions,
    geometry: solutions[0].geometry,
    units: {
      speed: "m/s",
      density: "kg/m³",
      angle: "degrees",
      lift: "N",
      inducedDrag: "N",
      spanPosition: "m",
      spanLoading: "N/m",
      circulation: "m²/s",
    },
    reference: {
      area: solutions[0].area,
      span: solutions[0].span,
      aspectRatio: solutions[0].aspectRatio,
    },
    results: solutions.map((s) => ({
      conditions: s.conditions,
      panelCount: s.panels.length,
      cl: s.cl,
      cdi: s.cdi,
      lift: s.lift,
      inducedDrag: s.inducedDrag,
      dynamicPressure: s.dynamicPressure,
      residual: s.residual,
      efficiency: s.efficiency,
      spanLoading: s.panels.map((p) => ({
        x: p.x,
        gamma: p.gamma,
        liftPerSpan: p.liftPerSpan,
      })),
    })),
  };
}

export function exportCSV(solutions: Solution[]) {
  const record = experimentRecord(solutions);
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return [
    `solver,${record.solver}`,
    `geometry_revision,${record.geometryRevision}`,
    `aircraft,${quote(record.aircraft)}`,
    ...record.assumptions.map((a) => `assumption,${quote(a)}`),
    `reference_area_m2,${record.reference.area}`,
    `reference_span_m,${record.reference.span}`,
    "alpha_deg,speed_m_s,density_kg_m3,CL,CDi,lift_N,induced_drag_N,panel_count,residual",
    ...record.results.map((r) =>
      [
        r.conditions.alpha,
        r.conditions.speed,
        r.conditions.density,
        r.cl,
        r.cdi,
        r.lift,
        r.inducedDrag,
        r.panelCount,
        r.residual,
      ].join(","),
    ),
  ].join("\n");
}
