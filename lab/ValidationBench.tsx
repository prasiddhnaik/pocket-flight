import { useEffect, useRef, useState } from "react";
import type { AircraftId } from "../src/aircraft/aircraft";
import type { Validation } from "./validation";
import { aircraftCatalog } from "./aircraft";
import { references } from "../src/flight/flight-reference-data";
const fmt = (n: number, d = 2) => n.toFixed(d);
function Plot({
  points,
  label,
  xLabel,
  yLabel,
}: {
  points: number[][];
  label: string;
  xLabel: string;
  yLabel: string;
}) {
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]),
    minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(0, ...ys),
    maxY = Math.max(...ys, 0.001);
  const x = (n: number) => 52 + ((n - minX) / (maxX - minX || 1)) * 508,
    y = (n: number) => 160 - ((n - minY) / (maxY - minY || 1)) * 142;
  return (
    <svg viewBox="0 0 590 200" role="img" aria-label={label}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line
            className="gridline"
            x1="52"
            x2="560"
            y1={y(minY + (maxY - minY) * f)}
            y2={y(minY + (maxY - minY) * f)}
          />
          <text x="45" y={y(minY + (maxY - minY) * f) + 4} textAnchor="end">
            {fmt(minY + (maxY - minY) * f)}
          </text>
        </g>
      ))}
      <polyline
        className="curve"
        points={points.map((p) => `${x(p[0])},${y(p[1])}`).join(" ")}
      />
      {[minX, (minX + maxX) / 2, maxX].map((n) => (
        <text key={n} x={x(n)} y="179" textAnchor="middle">
          {fmt(n, 1)}
        </text>
      ))}
      <text x="52" y="12">
        {yLabel}
      </text>
      <text x="560" y="197" textAnchor="end">
        {xLabel}
      </text>
    </svg>
  );
}
export function ValidationBench({ aircraft }: { aircraft: AircraftId }) {
  const [results, setResults] = useState<
      Partial<Record<AircraftId, Validation>>
    >({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [view, setView] = useState<"stall" | "stability" | "engine">("stall");
  const [axis, setAxis] = useState<"pitch" | "roll" | "yaw">("pitch");
  const [loading, setLoading] = useState(0),
    [altitude, setAltitude] = useState(0);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  const result = results[aircraft],
    completed = Object.keys(results).length;
  const run = () => {
    worker.current?.terminate();
    setResults({});
    setError("");
    setBusy(true);
    const w = new Worker(new URL("./validation.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.onmessage = ({
      data,
    }: {
      data: {
        result?: Validation;
        error?: string;
        id?: string;
        done?: boolean;
      };
    }) => {
      if (data.result) {
        const r = data.result;
        setResults((old) => ({ ...old, [r.id]: r }));
      }
      if (data.error) setError((old) => `${old} ${data.id}: ${data.error}`);
      if (data.done) {
        setBusy(false);
        w.terminate();
        worker.current = null;
      }
    };
    w.onerror = (e) => {
      setError(e.message || "Validation worker failed");
      setBusy(false);
      w.terminate();
      worker.current = null;
    };
    w.postMessage({ run: true });
  };
  const save = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            { generatedAt: new Date().toISOString(), results },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "fleet-envelope-validation.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const trace =
    result?.disturbances.filter((d) => d.axis === axis)[loading]?.trace ?? [];
  return (
    <section
      className="panel validation-bench"
      aria-label="Flight validation bench"
    >
      <div className="experiment-head">
        <div>
          <p className="eyebrow">PRIVATE / FLIGHT VALIDATION</p>
          <h2>Stalls, stability & engine maps</h2>
        </div>
        <button onClick={run} disabled={busy}>
          {busy
            ? `Checking fleet · ${completed}/${Object.keys(aircraftCatalog).length}`
            : "Validate fleet"}
        </button>
      </div>
      <p className="help">
        Separate from the attached-flow wing solver. Runs the actual flight
        model with beginner assist disabled. Published reference transfer and
        simulation checks do not establish measured aircraft performance.
      </p>
      {aircraft === "aurelia" && <p className="help">This bench uses the game's earlier Aurelia calibration. The tunnel view and wing solver use the new Phenom model.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="validation-tabs">
        {(["stall", "stability", "engine"] as const).map((v) => (
          <button
            key={v}
            className={view === v ? "" : "secondary"}
            onClick={() => setView(v)}
          >
            {v === "stall"
              ? "Stall behavior"
              : v === "stability"
                ? "Stability"
                : "Engine maps"}
          </button>
        ))}
        <button
          className="secondary"
          disabled={!completed || busy}
          onClick={save}
        >
          Export fleet evidence
        </button>
      </div>
      {!result ? (
        <p className="empty">
          {busy
            ? "Running worker experiments…"
            : "Run the bench to inspect every aircraft. The aircraft selector above also selects these results."}
        </p>
      ) : (
        <>
          <p>
            <strong>{aircraftCatalog[aircraft].name}</strong> · {result.version}{" "}
            · ISA · zero wind · four admissible dispatch / low-fuel / payload cases
          </p>
          {view === "stall" && (
            <>
              <div className="validation-plots">
                <div>
                  <h3>Clean lift through stall</h3>
                  <Plot
                    label="Whole aircraft model lift coefficient through stall"
                    points={result.polars[0].rows.map((r) => [r.alpha, r.cl])}
                    xLabel="AOA · degrees"
                    yLabel="CL"
                  />
                </div>
                <div>
                  <h3>Separation & control loss</h3>
                  <Plot
                    label="Estimated control effectiveness through stall"
                    points={result.polars[0].rows.map((r) => [
                      r.alpha,
                      r.controlEffectiveness,
                    ])}
                    xLabel="AOA · degrees"
                    yLabel="Control fraction"
                  />
                </div>
              </div>
              <p className="help">
                Attached slope comes from wing geometry. Post-stall lift loss
                transfers an approximate measured NACA 0012 section shape; peak
                lift, angle, negative stall and control attenuation remain
                assumptions. Spin, dynamic stall and T-tail deep stall are
                unvalidated.
              </p>
              <div className="validation-table">
                <table>
                  <thead>
                    <tr>
                      <th>Fuel / payload</th>
                      <th>Clean / flap TAS</th>
                      <th>2 g TAS</th>
                      <th>Powered recovery: first exit</th>
                      <th>Terminal clear time</th>
                      <th>Height loss</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.stallSpeeds.map((s, i) => (
                      <tr key={i}>
                        <td>
                          {s.loading.fuel} / {s.loading.payload}
                        </td>
                        <td>
                          {fmt(s.clean)} / {fmt(s.flapped)} m/s
                        </td>
                        <td>{fmt(s.twoG)} m/s</td>
                        <td>
                          {fmt(result.poweredRecoveries[i].firstExit ?? NaN)} s
                        </td>
                        <td>
                          {fmt(
                            result.poweredRecoveries[i]
                              .terminalStallFreeSeconds,
                          )}{" "}
                          s
                        </td>
                        <td>
                          {fmt(result.poweredRecoveries[i].lossOfHeight)} m
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="help">
                Powered case: start at 1.1×clean stall TAS, AOA 10° above onset;
                bounded test-pilot pitch feedback targets 60% of critical AOA,
                with pitch-rate damping, and advances power. Run duration: 10 s.
                Gear/flaps follow the existing automatic system. A first exit is
                not sustained recovery.
              </p>
              <p data-testid="hands-off-stall">
                Engine-out hands-off probes:{" "}
                {result.stalls.filter((s) => s.stalledAtEnd).length}/8 stalled
                again at 10 s. First exits range{" "}
                {fmt(
                  Math.min(...result.stalls.map((s) => s.recoveryTime ?? 10)),
                )}
                –
                {fmt(
                  Math.max(...result.stalls.map((s) => s.recoveryTime ?? 10)),
                )}{" "}
                s. These start at trim speed and imposed high AOA, not a one-g
                deceleration.
              </p>
            </>
          )}
          {view === "stability" && (
            <>
              <div className="validation-tabs">
                <label>
                  Disturbance{" "}
                  <select
                    aria-label="Disturbance axis"
                    value={axis}
                    onChange={(e) => setAxis(e.target.value as typeof axis)}
                  >
                    <option value="pitch">Pitch +2°</option>
                    <option value="roll">Roll rate +5°/s</option>
                    <option value="yaw">Yaw +3°</option>
                  </select>
                </label>
                <label>
                  Loading{" "}
                  <select
                    aria-label="Validation loading"
                    value={loading}
                    onChange={(e) => setLoading(+e.target.value)}
                  >
                    {result.cgChecks.map((c, i) => (
                      <option key={i} value={i}>
                        Fuel {c.loading.fuel} / payload {c.loading.payload}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Plot
                label="Unassisted disturbance response over thirty seconds"
                points={trace.map((r) => [
                  r.time,
                  ((axis === "pitch"
                    ? r.alpha - result.cgChecks[loading].trim.alpha
                    : axis === "yaw"
                      ? r.beta
                      : r.rates[2]) *
                    180) /
                    Math.PI,
                ])}
                xLabel="Time · seconds"
                yLabel={
                  axis === "roll"
                    ? "Roll rate · deg/s"
                    : `${axis === "pitch" ? "AOA perturbation" : "Sideslip"} · degrees`
                }
              />
              <div className="validation-table">
                <table>
                  <thead>
                    <tr>
                      <th>Fuel / payload</th>
                      <th>Static margin</th>
                      <th>Cmα / Cmq</th>
                      <th>Pitch / roll / yaw final-to-initial RMS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.cgChecks.map((c, i) => (
                      <tr key={i}>
                        <td>
                          {c.loading.fuel} / {c.loading.payload}
                        </td>
                        <td>{fmt(c.staticMargin * 100)}% MAC</td>
                        <td>
                          {fmt(c.cmAlpha)} / {fmt(c.cmQ)}
                        </td>
                        <td>
                          {result.disturbances
                            .slice(i * 3, i * 3 + 3)
                            .map((d) => fmt(d.ratio, 3))
                            .join(" / ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="help">
                Each response uses a force-and-moment trim solution, 30 s of the
                game integrator and no assist. RMS compares first versus last 5
                s of AOA/rate or sideslip/rate. Decay checks these disturbances;
                it does not establish every mode, maneuver or flight condition.
              </p>
            </>
          )}
          {view === "engine" && (
            <>
              <label>
                Altitude{" "}
                <select
                  aria-label="Engine map altitude"
                  value={altitude}
                  onChange={(e) => setAltitude(+e.target.value)}
                >
                  {[0, 1000, 3000, 6000].map((h) => (
                    <option key={h} value={h}>
                      {h} m
                    </option>
                  ))}
                </select>
              </label>
              <Plot
                label="Full power installed thrust model versus Mach"
                points={result.engine
                  .filter((e) => e.altitude === altitude && e.throttle === 1)
                  .map((e) => [e.mach, e.thrust / 1000])}
                xLabel="Mach"
                yLabel="Thrust · kN"
              />
              <div className="validation-table">
                <table>
                  <thead>
                    <tr>
                      <th>Mach</th>
                      <th>25% / 50% / 88% / full thrust</th>
                      <th>Provenance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[0, 0.1, 0.2, 0.4, 0.6, 0.8].map((mach) => {
                      const rows = result.engine.filter(
                        (e) => e.altitude === altitude && e.mach === mach,
                      );
                      return (
                        <tr key={mach}>
                          <td>{mach}</td>
                          <td>
                            {rows
                              .filter((e) => e.throttle > 0)
                              .map((e) => fmt(e.thrust / 1000))
                              .join(" / ")}{" "}
                            kN
                          </td>
                          <td>{rows[0].referenceStatus}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="help">
                Finch: manufacturer altitude power table, estimated propeller
                conversion. Military jets: NASA simulator deck normalized at
                M=0.2, scaled to concept ratings; low-Mach boundary held.
                Aurelia: estimated civil deck, no afterburner. Zero command is
                the existing cutoff convention; idle drag, fuel flow and spool
                dynamics are not calibrated.
              </p>
            </>
          )}
        </>
      )}
      <details>
        <summary>Reference data & validity limits</summary>
        {Object.values(references).map((r) => (
          <p key={r.title}>
            <a href={r.url} target="_blank" rel="noreferrer">
              {r.title}
            </a>{" "}
            · {r.location}
            <br />
            {r.kind}
          </p>
        ))}
        {result?.limitations.map((l) => (
          <p key={l}>{l}</p>
        ))}
      </details>
    </section>
  );
}
