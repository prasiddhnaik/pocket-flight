import { useEffect, useRef, useState } from "react";
import type { AircraftId } from "../src/aircraft/aircraft";
import { aircraftDesign, type Loading } from "../src/aircraft/aircraft-design";
import calibration from "../src/aircraft/fuel-mass-calibration.json";
import { aircraftCatalog } from "./aircraft";
import { aircraftSystems, hydraulicPumpWatts } from "../src/aircraft/aircraft-systems";
import { loadingSnapshot, type LoadingValidation } from "./loading-validation";
const f = (n: number, digits = 1) => n.toFixed(digits);

export function LoadingBench({ aircraft }: { aircraft: AircraftId }) {
  const design = aircraftDesign(aircraft);
  const hardware = aircraftSystems[aircraft];
  const [loadingState, setLoadingState] = useState({
    aircraft,
    loading: design.defaultLoading as Loading,
  });
  const loading =
    loadingState.aircraft === aircraft
      ? loadingState.loading
      : design.defaultLoading;
  const setLoading = (loading: Loading) =>
    setLoadingState({ aircraft, loading });
  const [results, setResults] = useState<
    Partial<Record<AircraftId, LoadingValidation>>
  >({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const worker = useRef<Worker | null>(null);
  useEffect(() => {
    setLoadingState({
      aircraft,
      loading: aircraftDesign(aircraft).defaultLoading,
    });
  }, [aircraft]);
  useEffect(() => () => worker.current?.terminate(), []);
  const snapshot = loadingSnapshot(aircraft, loading),
    result = results[aircraft];
  const run = () => {
    worker.current?.terminate();
    setResults({});
    setError("");
    setBusy(true);
    const w = new Worker(
      new URL("./loading-validation.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = w;
    w.onmessage = ({
      data,
    }: {
      data: { result?: LoadingValidation; error?: string; done?: boolean };
    }) => {
      if (data.result) {
        const r = data.result;
        setResults((old) => ({ ...old, [r.id]: r }));
      }
      if (data.error) setError((old) => `${old} ${data.error}`);
      if (data.done) {
        setBusy(false);
        w.terminate();
        worker.current = null;
      }
    };
    w.onerror = (e) => {
      setError(e.message);
      setBusy(false);
      w.terminate();
      worker.current = null;
    };
    w.postMessage({ run: true });
  };
  const exportEvidence = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ calibration, results }, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "fleet-weight-balance.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section
      className="panel validation-bench"
      aria-label="Weight and balance bench"
    >
      {aircraft === "aurelia" && <p className="help">Fuel and loading results use the game's earlier Aurelia calibration. The tunnel view and wing solver use the new Phenom model.</p>}
      <div className="experiment-head">
        <div>
          <p className="eyebrow">PRIVATE / MASS CALIBRATION</p>
          <h2>Fuel, weight & balance</h2>
        </div>
        <button onClick={run} disabled={busy}>
          {busy
            ? `Checking fuel · ${Object.keys(results).length}/${Object.keys(aircraftCatalog).length}`
            : "Check fleet fuel"}
        </button>
      </div>
      <p className="help">
        {aircraft === "f15c"
          ? design.fuel.validity
          : <>Tank volume and settled-liquid moments come from the actual model at
            game scale. Parts consume the existing empty-mass budget; unusable fuel
            stays aboard at zero usable fuel. Mass allowances and limits remain
            concept estimates.</>}
      </p>
      <div className="validation-tabs">
        <button
          className="secondary"
          onClick={() => setLoading(design.defaultLoading)}
        >
          Dispatch load
        </button>
        <button
          className="secondary"
          onClick={() => setLoading({ fuel: 1, payload: 1 })}
        >
          Full tanks
        </button>
        <button
          className="secondary"
          onClick={() => setLoading({ fuel: 0, payload: 1 })}
        >
          Usable fuel empty
        </button>
        <button
          className="secondary"
          onClick={() => setLoading({ fuel: 1, payload: 0 })}
        >
          No payload / full tanks
        </button>
        <button
          className="secondary"
          disabled={busy || !Object.keys(results).length}
          onClick={exportEvidence}
        >
          Export weight & balance
        </button>
      </div>
      <div className="loading-controls">
        <label>
          Usable fuel · {f((snapshot.fuelKg / design.fuel.usableFuelKg) * 100)}%
          <input
            aria-label="Usable fuel fraction"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={loading.fuel}
            onChange={(e) =>
              setLoading({
                ...loading,
                fuel: +e.target.value,
                tanks: undefined,
              })
            }
          />
        </label>
        <label>
          Payload · {f(loading.payload * 100)}%
          <input
            aria-label="Payload fraction"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={loading.payload}
            onChange={(e) =>
              setLoading({ ...loading, payload: +e.target.value })
            }
          />
        </label>
      </div>
      <p className="loading-status" data-testid="loading-status">
        {snapshot.massAllowed && snapshot.cgAllowed
          ? "WITHIN CONCEPT LIMITS"
          : "REJECTED LOAD"}{" "}
        ·{" "}
        {!snapshot.massAllowed
          ? `Over takeoff limit by ${f(snapshot.mass - design.maxTakeoffMass)} kg. `
          : ""}
        {!snapshot.cgAllowed ? "CG outside the declared envelope. " : ""}
        {!snapshot.trim ? "Trim unavailable. " : ""}
      </p>
      <div className="validation-table">
        <table>
          <tbody>
            <tr>
              <th>Aircraft</th>
              <td>{aircraftCatalog[aircraft].name}</td>
              <th>Total mass / takeoff limit</th>
              <td data-testid="loading-mass">
                {f(snapshot.mass)} / {f(design.maxTakeoffMass)} kg
              </td>
            </tr>
            <tr>
              <th>Usable fuel / capacity</th>
              <td data-testid="loading-fuel">
                {f(snapshot.fuelKg)} / {f(design.fuel.usableFuelKg)} kg
              </td>
              <th>Unusable fuel retained</th>
              <td>{f(snapshot.unusableFuelKg, 2)} kg</td>
            </tr>
            <tr>
              <th>CG · right / up / aft</th>
              <td data-testid="loading-cg">
                {snapshot.cg.map((n) => f(n, 4)).join(" / ")} m
              </td>
              <th>Longitudinal CG limits</th>
              <td>
                {design.cgEnvelope.map((n) => f(n, 4)).join(" to ")} m aft
              </td>
            </tr>
            <tr>
              <th>Pitch / yaw / roll inertia</th>
              <td>
                {[0, 4, 8].map((i) => f(snapshot.inertia[i])).join(" / ")} kg·m²
              </td>
              <th>Static margin / clean stall TAS</th>
              <td>
                {f(snapshot.staticMargin * 100, 2)}% MAC /{" "}
                {f(snapshot.stallSpeed)} m/s
              </td>
            </tr>
            <tr>
              <th>Trim elevator / aileron / rudder</th>
              <td>
                {snapshot.trim
                  ? [snapshot.trim.pitch, snapshot.trim.roll, snapshot.trim.yaw]
                      .map((n) => f(n, 4))
                      .join(" / ")
                  : "Unavailable"}
              </td>
              <th>Trim power / bank</th>
              <td>
                {snapshot.trim
                  ? `${f(snapshot.trim.throttle * 100)}% / ${f((snapshot.trim.bank * 180) / Math.PI, 3)}°`
                  : snapshot.trimError}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3>Tank loading & capacity</h3>
      <p className="help">
        Refuel wings first; burn the centre cell first. Paired wings drain
        proportionally. Individual sliders deliberately allow imbalance for
        testing.
      </p>
      <div className="validation-table">
        <table>
          <thead>
            <tr>
              <th>Tank</th>
              <th>Usable / unusable</th>
              <th>Expansion / hardware allowance</th>
              <th>Loaded fuel</th>
              <th>Individual fill</th>
            </tr>
          </thead>
          <tbody>
            {design.fuel.tanks.map((t) => {
              const fraction =
                snapshot.fuelByTank[t.id] /
                (t.usableLitres * t.densityKgPerLitre);
              return (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>
                    {f(t.usableLitres)} / {f(t.unusableLitres)} L
                  </td>
                  <td>
                    {f(t.expansionLitres)} / {f(t.displacementLitres)} L
                  </td>
                  <td>{f(snapshot.fuelByTank[t.id])} kg</td>
                  <td>
                    <input
                      aria-label={`${t.name} fill`}
                      type="range"
                      min="0"
                      max="1"
                      step=".01"
                      value={fraction}
                      onChange={(e) =>
                        setLoading({
                          ...loading,
                          tanks: {
                            ...Object.fromEntries(
                              design.fuel.tanks.map((tank) => [
                                tank.id,
                                snapshot.fuelByTank[tank.id] /
                                  (tank.usableLitres * tank.densityKgPerLitre),
                              ]),
                            ),
                            [t.id]: +e.target.value,
                          },
                        })
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <p role="alert">{error}</p>}
      {result && (
        <>
          <h3>Actual integrator checks · {result.version}</h3>
          <ul data-testid="fuel-checks">
            {result.checks.map((c) => (
              <li key={c.name}>
                {c.pass ? "PASS" : "FAIL"} · {c.name}
              </li>
            ))}
          </ul>
          <p>
            30 s powered flight:{" "}
            {f(result.powered.before.fuel - result.powered.after.fuel, 3)} kg
            burned · mass accounting difference{" "}
            {f(result.powered.massLossError, 6)} kg · height{" "}
            {f(result.powered.height)} m · health {result.powered.health}%.
            Balance refreshes four times per second.
          </p>
          <p data-testid="gear-check-summary">
            Gear: {result.gear.cases.length} overlap cases across both runways
            at 30 / 60 / 120 Hz, {result.gear.touchdowns.length} routine
            touchdowns, plus four seconds of settled contact. Sampled tire
            clearance {f(result.gear.minimumClearance * 1000, 3)} to{" "}
            {f(result.gear.maximumClearance * 1000, 3)} mm.
          </p>
          {result.emptyCabin.map((c) => (
            <p key={c.loading.fuel}>
              Empty cabin · {f(c.loading.fuel * 100, 0)}% usable fuel: static
              margin {f(c.staticMargin * 100, 2)}% MAC · 30 s unassisted flight
              height {f(c.height)} m · health {c.health}%.
            </p>
          ))}
          <div className="validation-table">
            <table>
              <thead>
                <tr>
                  <th>Loading case</th>
                  <th>Mass</th>
                  <th>Aft CG</th>
                  <th>Static margin</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {result.cases.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td>{f(c.mass)} kg</td>
                    <td>{f(c.cg[2], 4)} m</td>
                    <td>{f(c.staticMargin * 100, 2)}%</td>
                    <td>
                      {!c.massAllowed ? "Overweight " : ""}
                      {!c.cgAllowed ? "CG rejected" : ""}
                      {c.massAllowed && c.cgAllowed
                        ? "Within concept limits"
                        : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <details>
        <summary>Installed mass & calibration assumptions</summary>
        <p data-testid="hardware-profile">
          {hardware.model} · {hardware.architecture}
        </p>
        <p>
          Concept electrical allowance: {hardware.busVolts} V bus ·{" "}
          {hardware.batteryCount} × {hardware.batteryVolts} V /{" "}
          {hardware.batteryAh} Ah batteries · {hardware.generatorCount} ×{" "}
          {hardware.generatorWatts / 1000} kW generation. Essential / peak loads{" "}
          {hardware.essentialWatts / 1000} / {hardware.peakWatts / 1000} kW.
        </p>
        <p>
          {hardware.hydraulicCircuits
            ? `${hardware.hydraulicCircuits} primary hydraulic circuit(s) · ${hardware.pressureMPa} MPa · ${hardware.pumpLitresPerMinute} L/min per primary pump · ${f(hydraulicPumpWatts(aircraft) / 1000, 2)} kW shaft allowance per pump.`
            : "Manual flight controls and local brake hydraulics; no central powered hydraulic system."}{" "}
          These ratings are concept estimates. Electrical and hydraulic power
          draw is not yet simulated.
        </p>
        <p>
          Dry empty mass includes unusable fuel:{" "}
          {f(design.fuel.emptyMassIncludingResidual)} kg. System allocations
          below replace mass in their parent budgets, so the same structure is
          not counted twice.
        </p>
        <div className="validation-table">
          <table>
            <thead>
              <tr>
                <th>System</th>
                <th>Allocated mass</th>
                <th>Measured station · X/Y/Z</th>
                <th>From budget</th>
              </tr>
            </thead>
            <tbody>
              {design.fuel.installations.map((p) => (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td>{p.mass} kg</td>
                  <td>{p.center.map((n) => f(n, 3)).join(" / ")} m</td>
                  <td>{p.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {calibration.limitations.map((l) => (
          <p className="help" key={l}>
            {l}
          </p>
        ))}
        <p className="help">
          Nominal density at 15°C: Finch avgas 0.72 kg/L; jet fuel 0.80 kg/L.
          Temperature-dependent density and slosh are not simulated. Aft CG
          limits retain the original neutral point and require at least 3% MAC
          static margin; forward limits are a concept loading bound, not a
          flight-tested elevator-authority limit.
        </p>
        {calibration.references.map((r) => (
          <p key={r.url}>
            <a href={r.url} target="_blank" rel="noreferrer">
              {r.use}
            </a>
          </p>
        ))}
      </details>
    </section>
  );
}
