import { ValidationBench } from "./ValidationBench";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  aircraftCatalog,
  zeroLiftEstimate,
  type LabAircraftId,
} from "./aircraft";
import { fleetMeasurements, wingForAircraft } from "./catalog";
import {
  convergenceCheck,
  experimentRecord,
  exportCSV,
  runSweep,
} from "./experiments";
import { initialLayers, TunnelScene, type Layers } from "./scene";
import { cachedSolveWing, type Conditions, type Solution } from "./solver";
import type { MechanismProgramme } from "./mechanics";

const fmt = (n: number, digits = 2) =>
  n.toLocaleString("en", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
const ids = Object.keys(aircraftCatalog) as LabAircraftId[];
type Convergence = ReturnType<typeof convergenceCheck>;
type Comparison = { id: LabAircraftId; solution: Solution }[];

function Chart({ rows, kind }: { rows: Solution[]; kind: "span" | "polar" }) {
  const width = 600,
    height = 185,
    left = 58,
    right = 16,
    top = 18,
    bottom = 34;
  const points =
    kind === "span"
      ? rows[0].panels.map((p) => [p.x, p.liftPerSpan])
      : rows.map((s) => [s.conditions.alpha, s.cl]);
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const xmin = Math.min(...xs),
    xmax = Math.max(...xs),
    ymin = Math.min(0, ...ys),
    ymax = Math.max(0.001, ...ys);
  const x = (v: number) =>
    left + ((v - xmin) / (xmax - xmin || 1)) * (width - left - right);
  const y = (v: number) =>
    top + ((ymax - v) / (ymax - ymin || 1)) * (height - top - bottom);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={
        kind === "span"
          ? "Main wing span loading in newtons per metre"
          : "Lift coefficient versus angle of attack"
      }
    >
      {[0, 0.5, 1].map((f) => {
        const v = ymin + (ymax - ymin) * f;
        return (
          <g key={f}>
            <line
              x1={left}
              x2={width - right}
              y1={y(v)}
              y2={y(v)}
              className="gridline"
            />
            <text x={left - 8} y={y(v) + 4} textAnchor="end">
              {fmt(v, kind === "span" ? 0 : 2)}
            </text>
          </g>
        );
      })}
      <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} className="zero" />
      <polyline
        points={points.map(([a, b]) => `${x(a)},${y(b)}`).join(" ")}
        className="curve"
      />
      {[xmin, (xmin + xmax) / 2, xmax].map((v) => (
        <text key={v} x={x(v)} y={height - 16} textAnchor="middle">
          {fmt(v, 1)}
        </text>
      ))}
      <text x={left} y={12}>
        {kind === "span" ? "N/m" : "CL"}
      </text>
      <text x={width - right} y={height - 2} textAnchor="end">
        {kind === "span" ? "span position · m" : "angle of attack · degrees"}
      </text>
    </svg>
  );
}
function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function MechanismScrubber({
  scene,
  paused,
  onScrub,
}: {
  scene: { current: TunnelScene | null };
  paused: boolean;
  onScrub: (time: number) => void;
}) {
  const [time, setTime] = useState(0);
  useEffect(() => {
    const update = () =>
      setTime(Math.min(35.9, (scene.current?.getMechanismTime() ?? 0) % 36));
    update();
    if (paused) return;
    const timer = setInterval(update, 200);
    return () => clearInterval(timer);
  }, [scene, paused]);
  return (
    <label className="mechanism-scrub">
      Cycle · {time.toFixed(1)} s · drag to pause
      <input
        aria-label="Mechanism cycle"
        type="range"
        min={0}
        max={35.9}
        step={0.1}
        value={time}
        onKeyDown={(e) => {
          if (e.key !== "Home" && e.key !== "End") return;
          e.preventDefault();
          const t = e.key === "Home" ? 0 : 35.9;
          setTime(t);
          onScrub(t);
        }}
        onChange={(e) => {
          const t = Number(e.target.value);
          setTime(t);
          onScrub(t);
        }}
      />
    </label>
  );
}

export default function App() {
  const [id, setId] = useState<LabAircraftId>("finch");
  const [conditions, setConditions] = useState<Conditions>({
    speed: 30,
    density: 1.225,
    alpha: 4,
  });
  const [panelCount, setPanelCount] = useState(96);
  const [override, setOverride] = useState(false),
    [alpha0, setAlpha0] = useState(-1.53);
  const [layers, setLayers] = useState<Layers>(initialLayers),
    [paused, setPaused] = useState(false);
  const [mechanical, setMechanical] = useState(false);
  const [programme, setProgramme] = useState<MechanismProgramme>("all");
  const [revealMechanisms, setRevealMechanisms] = useState(false);
  const [status, setStatus] = useState("Preparing chamber…"),
    [assetError, setAssetError] = useState(false);
  const [sweep, setSweep] = useState<Solution[]>([]),
    [convergence, setConvergence] = useState<Convergence | null>(null);
  const [comparison, setComparison] = useState<Comparison>([]),
    [busy, setBusy] = useState(false),
    [operationError, setOperationError] = useState("");
  const host = useRef<HTMLDivElement>(null),
    scene = useRef<TunnelScene | null>(null);
  const geometry = useMemo(() => {
    const source = wingForAircraft(id);
    if (!override) return source;
    return {
      ...source,
      revision: `${source.revision}:alpha0=${alpha0}`,
      stations: source.stations.map((s) => ({ ...s, zeroLiftAlpha: alpha0 })),
      assumptions: [
        ...source.assumptions,
        `Section zero-lift angle manually overridden to ${alpha0} degrees.`,
      ],
    };
  }, [id, override, alpha0]);
  const result = useMemo(() => {
    try {
      return {
        solution: cachedSolveWing(geometry, conditions, panelCount),
        error: "",
      };
    } catch (error) {
      return {
        solution: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [geometry, conditions, panelCount]);
  const solution = result.solution;
  useEffect(() => {
    if (!host.current) return;
    let current: TunnelScene;
    try {
      current = new TunnelScene(host.current, (message, error = false) => {
        setStatus(message);
        setAssetError(error);
      });
      scene.current = current;
    } catch (error) {
      setStatus(`3D renderer unavailable: ${String(error)}`);
      setAssetError(true);
      return;
    }
    return () => {
      current.dispose();
      scene.current = null;
    };
  }, []);
  useEffect(() => {
    void scene.current?.loadAircraft(id);
  }, [id]);
  useEffect(() => {
    scene.current?.setSolution(solution);
  }, [solution]);
  useEffect(() => {
    scene.current?.setLayers(layers);
  }, [layers]);
  useEffect(() => {
    scene.current?.setPaused(paused);
  }, [paused]);
  useEffect(() => {
    scene.current?.setMechanics(mechanical, programme);
    scene.current?.setRevealMechanisms(revealMechanisms);
  }, [mechanical, programme, revealMechanisms]);
  useEffect(() => {
    setSweep([]);
    setConvergence(null);
    setComparison([]);
    setOperationError("");
  }, [geometry, conditions, panelCount]);
  useEffect(() => {
    // Read-only diagnostics for local acceptance checks and reproducible experiments.
    const state = {
      aircraft: id,
      conditions,
      geometryRevision: geometry.revision,
      solution: solution ? experimentRecord([solution]) : null,
      error: result.error,
      status,
      paused,
      mechanical,
      programme,
      layers,
      sweepCases: sweep.length,
      convergence,
      comparison: comparison.map((r) => ({
        id: r.id,
        cl: r.solution.cl,
        cdi: r.solution.cdi,
      })),
    };
    Object.assign(window, {
      windTunnel: {
        getState: () => ({
          ...state,
          airflow: scene.current?.getAirflowDiagnostics() ?? null,
          performance: scene.current?.getPerformanceDiagnostics() ?? null,
        }),
      },
    });
    return () => {
      delete (window as Window & { windTunnel?: unknown }).windTunnel;
    };
  }, [
    id,
    conditions,
    geometry,
    solution,
    result.error,
    status,
    paused,
    mechanical,
    programme,
    layers,
    sweep,
    convergence,
    comparison,
  ]);

  const changeAircraft = (next: LabAircraftId) => {
    setId(next);
    setOverride(false);
    setAlpha0(zeroLiftEstimate(aircraftCatalog[next].camber));
  };
  const run = (action: () => void) => {
    setBusy(true);
    setOperationError("");
    setTimeout(() => {
      try {
        action();
      } catch (e) {
        setOperationError(String(e));
      } finally {
        setBusy(false);
      }
    }, 0);
  };
  const exportRows = sweep.length ? sweep : solution ? [solution] : [];
  const metric = (label: string, value: string, unit: string, accent = "") => (
    <div className={`metric ${accent}`}>
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
    </div>
  );

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">PALM BAY · ENGINEERING</p>
          <h1>
            Aerodynamics lab<span className="badge">PRIVATE / LOCAL</span>
          </h1>
        </div>
        <div className="model-status">
          <i className={assetError ? "error-dot" : ""} />
          <span role="status">{status}</span>
        </div>
      </header>
      <section
        className={`mechanics-toolbar panel ${mechanical ? "active" : ""}`}
        aria-label="Aircraft mechanisms"
      >
        <div>
          <strong>Aircraft mechanisms</strong>
          <span>Hydraulics, gear, controls and propulsion</span>
        </div>
        <button
          className={mechanical ? "secondary" : ""}
          onClick={() => {
            setMechanical(!mechanical);
            setPaused(false);
            scene.current?.seekMechanics(0);
          }}
        >
          {mechanical ? "Return to aerodynamics" : "Run mechanical showcase"}
        </button>
        {mechanical && (
          <>
            <label className="programme">
              Systems programme
              <select
                value={programme}
                onChange={(e) => {
                  setProgramme(e.target.value as MechanismProgramme);
                  setPaused(false);
                }}
              >
                <option value="all">All systems</option>
                <option value="gear">Gear & suspension</option>
                <option value="controls">Flight controls</option>
                <option value="power">Propulsion</option>
                <option value="cockpit">Cockpit & access</option>
              </select>
            </label>
            <MechanismScrubber
              scene={scene}
              paused={paused}
              onScrub={(t) => {
                setPaused(true);
                scene.current?.seekMechanics(t);
              }}
            />
            <div className="mechanism-cameras">
              {(
                [
                  ["gear", "Gear close-up"],
                  ["controls", "Control linkages"],
                  ["power", "Engine close-up"],
                  ["cockpit", "Cockpit close-up"],
                ] as const
              ).map(([key, title]) => (
                <button
                  className="secondary"
                  key={key}
                  onClick={() => {
                    if (key === "gear" || key === "cockpit")
                      setRevealMechanisms(true);
                    scene.current?.focusMechanism(key);
                  }}
                >
                  {title}
                </button>
              ))}
              {id === "finch" && (
                <button
                  className="secondary"
                  onClick={() => {
                    setRevealMechanisms(false);
                    scene.current?.rearCabinView();
                  }}
                >
                  Rear bulkhead
                </button>
              )}
              {id === "finch" && (
                <button
                  className="secondary"
                  onClick={() => {
                    setRevealMechanisms(true);
                    setLayers((previous) => ({ ...previous, chamber: false }));
                    scene.current?.internalSystemsView();
                  }}
                >
                  Internal systems
                </button>
              )}
              {id === "finch" && (
                <button
                  className="secondary"
                  onClick={() => {
                    setRevealMechanisms(false);
                    scene.current?.pilotView();
                  }}
                >
                  Pilot view
                </button>
              )}
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={revealMechanisms}
                onChange={(e) => setRevealMechanisms(e.target.checked)}
              />{" "}
              Reveal mechanisms through shell
            </label>
            <p className="mechanics-note">
              Slow mechanical demonstration. Airflow and force overlays are
              hidden; readouts retain the neutral-wing reference.{" "}
              {id === "finch"
                ? "Finch’s gear is fixed. Rear bulkhead shows the closed cabin partition. Internal systems reveals the underfloor fuel cell and separate aft equipment bay. Wing pushrods stay inside the skin."
                : "Retractable gear, doors and pressure linkages cycle together."}
            </p>
          </>
        )}
      </section>
      <div className="workspace">
        <aside className="controls panel">
          <p className="eyebrow">01 / TEST CONDITIONS</p>
          <label className="field">
            Aircraft
            <select
              aria-label="Aircraft"
              value={id}
              onChange={(e) => changeAircraft(e.target.value as LabAircraftId)}
              disabled={busy}
            >
              {ids.map((key) => (
                <option key={key} value={key}>
                  {aircraftCatalog[key].name}
                </option>
              ))}
            </select>
          </label>
          <label className="slider">
            Airspeed{" "}
            <output>
              {fmt(conditions.speed, 0)} <small>m/s</small>
            </output>
            <input
              aria-label="Airspeed"
              type="range"
              min={5}
              max={80}
              step={1}
              value={conditions.speed}
              disabled={busy}
              onChange={(e) =>
                setConditions({ ...conditions, speed: +e.target.value })
              }
            />
            <span className="range-label">
              <span>5 m/s</span>
              <span>80 m/s</span>
            </span>
          </label>
          <label className="slider">
            Angle of attack <output>{fmt(conditions.alpha, 1)}°</output>
            <input
              aria-label="Angle of attack"
              type="range"
              min={-12}
              max={12}
              step={0.5}
              value={conditions.alpha}
              disabled={busy}
              onChange={(e) =>
                setConditions({ ...conditions, alpha: +e.target.value })
              }
            />
            <span className="range-label">
              <span>−12°</span>
              <span>+12°</span>
            </span>
          </label>
          <p className="help">
            Solver range: −8° to +8°. Beyond that, results are withheld.
          </p>
          <div className="paired">
            <label className="field">
              Density · kg/m³
              <input
                aria-label="Air density"
                type="number"
                min={0.5}
                max={1.4}
                step={0.025}
                value={conditions.density}
                disabled={busy}
                onChange={(e) =>
                  setConditions({
                    ...conditions,
                    density: e.target.value === "" ? 0 : +e.target.value,
                  })
                }
              />
            </label>
            <label className="field">
              Panels
              <select
                aria-label="Panel count"
                value={panelCount}
                disabled={busy}
                onChange={(e) => setPanelCount(+e.target.value)}
              >
                {[24, 48, 96, 144].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>
          <details className="section-input">
            <summary>Section assumption</summary>
            <p>{aircraftCatalog[id].section}</p>
            <label className="toggle">
              <input
                type="checkbox"
                checked={override}
                disabled={busy}
                onChange={(e) => setOverride(e.target.checked)}
              />
              Override zero-lift angle
            </label>
            {override && (
              <label className="field">
                Zero-lift angle · degrees
                <input
                  aria-label="Zero-lift angle"
                  type="number"
                  min={-4}
                  max={4}
                  step={0.1}
                  value={alpha0}
                  disabled={busy}
                  onChange={(e) => setAlpha0(+e.target.value)}
                />
              </label>
            )}
            <p className="help">
              Current α₀: {fmt(geometry.stations[0].zeroLiftAlpha, 3)}°. This
              controls the section intercept; it is not a measured airfoil
              polar.
            </p>
          </details>
          <div className="layers">
            <p className="eyebrow">VIEW LAYERS</p>
            {(
              [
                ["flow", "Surface-aware airflow"],
                ["lattice", "Analysis lattice"],
                ["wingOnly", "Wing surfaces only"],
                ["forces", "Force directions"],
                ["chamber", "Chamber structure"],
              ] as [keyof Layers, string][]
            ).map(([key, label]) => (
              <label key={key} className="toggle">
                <input
                  type="checkbox"
                  checked={layers[key]}
                  onChange={(e) =>
                    setLayers({ ...layers, [key]: e.target.checked })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <button
            className="secondary pause"
            onClick={() => setPaused(!paused)}
          >
            {mechanical
              ? paused
                ? "Resume mechanisms"
                : "Pause mechanisms"
              : paused
                ? "Resume flow animation"
                : "Pause flow animation"}
          </button>
        </aside>
        <section className="viewport panel">
          <div className="viewport-head">
            <div>
              <span className="eyebrow">
                02 / {mechanical ? "MECHANICAL INSPECTION" : "TEST SECTION"}
              </span>
              <h2>{aircraftCatalog[id].name}</h2>
            </div>
            <span
              className={`validity ${solution || mechanical ? "" : "invalid"}`}
            >
              {mechanical
                ? "SYSTEMS SHOWCASE"
                : solution
                  ? "ATTACHED FLOW"
                  : "OUTSIDE MODEL RANGE"}
            </span>
          </div>
          <div ref={host} className="canvas-host" />
          {!mechanical && (
            <div className="flow-direction">
              <span>FLOW: NOSE TO TAIL</span> · DOWNSTREAM EXTRACTION FAN · SLOW
              MOTION ×0.18
            </div>
          )}
          <div className="camera-bar">
            <button
              onClick={() => {
                setRevealMechanisms(false);
                scene.current?.displayView();
              }}
            >
              Instrument displays
            </button>
            {(
              [
                ["test", "Inspect"],
                ["side", "Flow close-up"],
                ["top", "Plan view"],
                ["rear", "Downstream"],
                ["chamber", "Full chamber"],
              ] as const
            ).map(([key, title]) => (
              <button key={key} onClick={() => scene.current?.view(key)}>
                {title}
              </button>
            ))}
          </div>
          <div className="viewport-foot">
            <span>Drag to orbit · scroll to zoom</span>
            <span>
              <i className="legend lift" />
              Lift <i className="legend drag" />
              Induced drag
            </span>
          </div>
          {!solution && !mechanical && (
            <div className="invalid-overlay" role="alert">
              <strong>No aerodynamic result</strong>
              <p>{result.error}</p>
              <span>Return to a supported condition to resume analysis.</span>
            </div>
          )}
        </section>
        <aside className="readouts panel">
          <p className="eyebrow">03 / MAIN-WING RESULTS</p>
          {metric(
            "Lift",
            solution ? fmt(solution.lift, 0) : "—",
            "N",
            "lift-metric",
          )}
          {metric(
            "Induced drag",
            solution ? fmt(solution.inducedDrag, 1) : "—",
            "N",
            "drag-metric",
          )}
          <div className="coefficients">
            {metric("CL", solution ? fmt(solution.cl, 4) : "—", "")}
            {metric("CDi", solution ? fmt(solution.cdi, 5) : "—", "")}
          </div>
          <dl className="facts">
            <div>
              <dt>Wing area</dt>
              <dd>{solution ? fmt(solution.area) : "—"} m²</dd>
            </div>
            <div>
              <dt>Wing span</dt>
              <dd>{solution ? fmt(solution.span) : "—"} m</dd>
            </div>
            <div>
              <dt>Aspect ratio</dt>
              <dd>{solution ? fmt(solution.aspectRatio, 3) : "—"}</dd>
            </div>
            <div>
              <dt>Dynamic pressure</dt>
              <dd>{solution ? fmt(solution.dynamicPressure, 1) : "—"} Pa</dd>
            </div>
            <div>
              <dt>Solver residual</dt>
              <dd>{solution ? solution.residual.toExponential(1) : "—"}</dd>
            </div>
          </dl>
          <div className="boundary">
            <strong>What this measures</strong>
            <p>
              Steady, inviscid main-wing lift and induced drag in freestream.
              The force readouts use the wing vortex solution.
            </p>
            <p>
              Body, tails, engines, viscous drag, stall, walls and rig
              interference are excluded. The fan is a visual model. Force-arrow
              lengths are illustrative. Full-aircraft airflow uses
              mesh-clearance routing and an approximate circulation-based wake;
              it is a visualization, not a CFD result.
            </p>
          </div>
        </aside>
      </div>
      <ValidationBench aircraft={id} />
      <div className="analysis-grid">
        <section className="panel plot">
          <p className="eyebrow">04 / SPAN LOADING</p>
          <h2>Where the wing carries lift</h2>
          {solution ? (
            <Chart rows={[solution]} kind="span" />
          ) : (
            <p className="empty">
              Choose a supported condition to see wing loading.
            </p>
          )}
          <p className="help">
            Neutral control surfaces included in the planform. The yellow
            lattice shows the lifting surface used by the solver.
          </p>
        </section>
        <section className="panel experiments">
          <div className="experiment-head">
            <div>
              <p className="eyebrow">05 / EXPERIMENTS</p>
              <h2>Test, refine, export</h2>
            </div>
            <span className="help">
              {busy
                ? "Calculating…"
                : sweep.length
                  ? `${sweep.length} cases ready`
                  : "Live condition"}
            </span>
          </div>
          <div className="actions">
            <button
              disabled={!solution || busy}
              onClick={() =>
                run(() =>
                  setSweep(
                    runSweep(geometry, conditions, {
                      min: -8,
                      max: 8,
                      step: 1,
                      panelCount,
                    }),
                  ),
                )
              }
            >
              Run angle sweep
            </button>
            <button
              className="secondary"
              disabled={!solution || busy}
              onClick={() =>
                run(() =>
                  setConvergence(convergenceCheck(geometry, conditions)),
                )
              }
            >
              Check convergence
            </button>
            <button
              className="secondary"
              disabled={!solution || busy || override}
              onClick={() =>
                run(() =>
                  setComparison(
                    ids.map((key) => ({
                      id: key,
                      solution: cachedSolveWing(
                        wingForAircraft(key),
                        conditions,
                        panelCount,
                      ),
                    })),
                  ),
                )
              }
            >
              Compare fleet
            </button>
          </div>
          <p className="help">
            Sweep: −8° to +8° in 1° steps. Compare fleet uses identical
            airspeed, density and angle with each plane’s default section
            assumption.
          </p>
          <div className="exports">
            <button
              className="secondary"
              disabled={!solution || busy}
              onClick={() =>
                download(
                  `${id}-wind-tunnel.csv`,
                  exportCSV(exportRows),
                  "text/csv",
                )
              }
            >
              Export CSV
            </button>
            <button
              className="secondary"
              disabled={!solution || busy}
              onClick={() =>
                download(
                  `${id}-wind-tunnel.json`,
                  JSON.stringify(experimentRecord(exportRows), null, 2),
                  "application/json",
                )
              }
            >
              Export JSON
            </button>
            <span>
              {sweep.length ? "Exports sweep" : "Exports current condition"}
            </span>
          </div>
          {operationError && (
            <p role="alert" className="error-text">
              {operationError}
            </p>
          )}
        </section>
        {sweep.length > 0 && (
          <section className="panel sweep">
            <p className="eyebrow">ANGLE SWEEP / {aircraftCatalog[id].name}</p>
            <div className="sweep-grid">
              <Chart rows={sweep} kind="polar" />
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>α °</th>
                      <th>CL</th>
                      <th>CDi</th>
                      <th>Lift N</th>
                      <th>Induced N</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sweep.map((s) => (
                      <tr key={s.conditions.alpha}>
                        <td>{s.conditions.alpha}</td>
                        <td>{fmt(s.cl, 4)}</td>
                        <td>{fmt(s.cdi, 5)}</td>
                        <td>{fmt(s.lift, 0)}</td>
                        <td>{fmt(s.inducedDrag, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
        {convergence && (
          <section className="panel">
            <p className="eyebrow">PANEL REFINEMENT / CURRENT CONDITION</p>
            <h2>Does the result settle?</h2>
            <p className="help">
              96 → 144 panels: CL changes{" "}
              {fmt(convergence.liftChangePercent, 3)}%; CDi changes{" "}
              {fmt(convergence.dragChangePercent, 3)}%. Convergence measures
              numerical stability; it does not validate omitted physics.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Panels</th>
                  <th>CL</th>
                  <th>CDi</th>
                  <th>Residual</th>
                </tr>
              </thead>
              <tbody>
                {convergence.rows.map((r) => (
                  <tr key={r.panelCount}>
                    <td>{r.panelCount}</td>
                    <td>{fmt(r.cl, 5)}</td>
                    <td>{fmt(r.cdi, 6)}</td>
                    <td>{r.residual.toExponential(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {comparison.length > 0 && (
          <section className="panel">
            <p className="eyebrow">FLEET / MATCHED TEST CONDITIONS</p>
            <h2>Four aircraft, four wing geometries</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Aircraft</th>
                    <th>Area m²</th>
                    <th>CL</th>
                    <th>CDi</th>
                    <th>Lift N</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.map(({ id: key, solution: s }) => (
                    <tr key={key}>
                      <td>{aircraftCatalog[key].name}</td>
                      <td>{fmt(s.area)}</td>
                      <td>{fmt(s.cl, 4)}</td>
                      <td>{fmt(s.cdi, 5)}</td>
                      <td>{fmt(s.lift, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
      <details className="panel assumptions">
        <summary>Geometry provenance and model assumptions</summary>
        <p>
          Revision: <code>{geometry.revision}</code>
        </p>
        <p>
          Aircraft source dimensions:{" "}
          {fleetMeasurements
            .find((g) => g.id === id)
            ?.dimensions.map((n) => fmt(n, 3))
            .join(" × ")}{" "}
          m (span × height × length).
        </p>
        <ul>
          {geometry.assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
        <p>
          Horseshoe vortex lattice, one chordwise row, cosine span spacing,
          straight fixed wake and Trefftz-plane induced drag. This lab is a
          design comparison tool; high sweep, interference and compressibility
          require a richer model.
        </p>
        <p>
          Method references:{" "}
          <a
            href="https://web.mit.edu/drela/Public/web/avl/"
            target="_blank"
            rel="noreferrer"
          >
            MIT AVL
          </a>{" "}
          ·{" "}
          <a
            href="https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/induced-drag-coefficient/"
            target="_blank"
            rel="noreferrer"
          >
            NASA induced drag
          </a>
          .
        </p>
      </details>
      <footer>
        PRIVATE ENGINEERING TOOL · Geometry based · Solver v1 · Separate from
        Pocket Flight
      </footer>
    </main>
  );
}
