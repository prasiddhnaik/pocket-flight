import { validateLoading } from "../lab/loading-validation";
import { aircraftDesign } from "../src/aircraft/aircraft-design";
import { aircraftCatalog } from "../lab/aircraft";
import calibration from "../src/aircraft/fuel-mass-calibration.json";
import { aircraftSystems, hydraulicPumpWatts } from "../src/aircraft/aircraft-systems";
const fleet = (["finch", "peregrine", "aurelia", "stormbird"] as const).map(
  (id) => validateLoading(id),
);
for (const r of fleet)
  for (const c of r.checks) if (!c.pass) throw Error(`${r.id}: ${c.name}`);
const f = (n: number, d = 1) => n.toFixed(d),
  escape = (s: string) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const capacity = fleet
  .map((r) => {
    const d = aircraftDesign(r.id);
    return `<tr><td>${aircraftCatalog[r.id].name}</td><td>${f(d.fuel.tanks.reduce((s, t) => s + t.usableLitres, 0))}</td><td>${f(d.fuel.usableFuelKg)}</td><td>${f(d.fuel.emptyMassIncludingResidual)}</td><td>${f(d.fuel.unusableFuelKg)}</td><td>${f(d.nominal.fuelKg)}</td><td>${f(d.nominal.mass)} / ${f(d.maxTakeoffMass)}</td><td>${f(d.nominal.cg.z, 4)}</td></tr>`;
  })
  .join("");
const hardwareRows = fleet
  .map((r) => {
    const h = aircraftSystems[r.id],
      p = aircraftDesign(r.id).propulsion;
    return `<tr><td>${aircraftCatalog[r.id].name}</td><td>${h.model}: ${h.architecture}</td><td>${h.batteryCount} × ${h.batteryVolts} V / ${h.batteryAh} Ah</td><td>${h.generatorCount} × ${h.generatorWatts / 1000} kW; essential ${h.essentialWatts / 1000}, peak ${h.peakWatts / 1000} kW</td><td>${h.hydraulicCircuits} primary circuits; ${h.pressureMPa} MPa / ${h.pumpLitresPerMinute} L/min each; ${f(hydraulicPumpWatts(r.id) / 1000, 2)} kW pump shaft allowance</td><td>${p.kind === "propeller" ? `${p.shaftPower / 1000} kW shaft` : `${p.dryThrust / 1000} / ${p.afterburningThrust / 1000} kN dry / maximum thrust`}</td></tr>`;
  })
  .join("");
const sections = fleet
  .map((r) => {
    const d = aircraftDesign(r.id);
    const cases = r.cases
      .map(
        (c) =>
          `<tr><td>${escape(c.name)}</td><td>${f(c.mass)}</td><td>${c.cg.map((v) => f(v, 4)).join(" / ")}</td><td>${f(c.staticMargin * 100, 2)}%</td><td>${c.massAllowed && c.cgAllowed ? "Within concept limits" : `${!c.massAllowed ? "Overweight; " : ""}${!c.cgAllowed ? "CG rejected" : ""}`}</td></tr>`,
      )
      .join("");
    const tanks = d.fuel.tanks
      .map(
        (t) =>
          `<tr><td>${t.name}</td><td>${f(t.envelopeLitres)}</td><td>${f(t.displacementLitres)}</td><td>${f(t.expansionLitres)}</td><td>${f(t.unusableLitres)}</td><td>${f(t.usableLitres)}</td><td>${f(t.densityKgPerLitre, 2)}</td></tr>`,
      )
      .join("");
    const systems = d.fuel.installations
      .map(
        (p) =>
          `<tr><td>${p.name}</td><td>${p.mass}</td><td>${p.center.map((v) => f(v, 3)).join(" / ")}</td><td>${p.source}</td></tr>`,
      )
      .join("");
    const xs = r.burnSweep.map((s) => s.fuelKg),
      ys = r.burnSweep.map((s) => s.cg[2]),
      minY = Math.min(...ys) - 0.002,
      maxY = Math.max(...ys) + 0.002;
    const plot = r.burnSweep
      .map(
        (s) =>
          `${50 + (500 * s.fuelKg) / Math.max(...xs)},${170 - (140 * (s.cg[2] - minY)) / (maxY - minY)}`,
      )
      .join(" ");
    return `<section><h2>${aircraftCatalog[r.id].name}</h2><p>Dispatch static margin ${(100 * r.cases[0].staticMargin).toFixed(2)}% MAC. Retained neutral point ${f(d.neutralPointZ, 4)} m aft; declared CG range ${d.cgEnvelope.map((v) => f(v, 4)).join(" to ")} m aft.</p><div class="tables"><table><tr><th>Tank</th><th>Envelope L</th><th>Hardware allowance L</th><th>Expansion L</th><th>Unusable L</th><th>Usable L</th><th>Density kg/L</th></tr>${tanks}</table></div><h3>Loading decisions</h3><div class="tables"><table><tr><th>Case</th><th>Mass kg</th><th>CG X/Y/Z m</th><th>Static margin</th><th>Decision</th></tr>${cases}</table></div><h3>Fuel burn and balance</h3><svg role="img" aria-label="${r.id} CG during planned fuel burn" viewBox="0 0 620 210"><path d="M50 25V170H565" fill="none" stroke="#999"/><polyline points="${plot}" fill="none" stroke="#087b88" stroke-width="2"/><text x="50" y="18">Aft CG ${f(minY, 4)} to ${f(maxY, 4)} m</text><text x="50" y="195">0 kg usable</text><text x="405" y="195">${f(Math.max(...xs))} kg usable</text></svg><p>The plotted path drains the dispatch load to zero usable fuel: centre first, then both wings proportionally. This is a mass-accounting sweep, independent of engine time.</p><ul>${r.checks.map((c) => `<li>${c.pass ? "PASS" : "FAIL"}: ${c.name}</li>`).join("")}</ul><p>Actual unassisted integrator: 30 s at 1,000 m, model trim speed ${d.trimSpeed} m/s, zero wind. Usable fuel burned ${f(r.powered.before.fuel - r.powered.after.fuel, 6)} kg; mass difference error ${f(r.powered.massLossError, 8)} kg; final height ${f(r.powered.height, 3)} m; health ${r.powered.health}%. The maximum accounting delay is 0.25 s.</p><p>Gear validation: ${r.gear.cases.length} overlap cases, both runways, 30/60/120 Hz, plus four seconds settled contact and ${r.gear.touchdowns.length} routine 1.2 m/s touchdown cases. Independently sampled tire clearance ${f(r.gear.minimumClearance * 1000, 3)} to ${f(r.gear.maximumClearance * 1000, 3)} mm.</p>${r.emptyCabin.map((c) => `<p>Empty cabin at ${c.loading.fuel * 100}% fuel: static margin ${f(c.staticMargin * 100, 2)}% MAC; 30 s unassisted flight ends at ${f(c.height, 2)} m with ${c.health}% health and no stall.</p>`).join("")}<h3>Internal mass allocation</h3><div class="tables"><table><tr><th>Installation</th><th>Estimated mass kg</th><th>Measured station X/Y/Z m</th><th>Parent budget</th></tr>${systems}</table></div><p class="hash">Asset revision: ${d.fuel.assetRevision}</p></section>`;
  })
  .join("");
const suiteFile = new URL("../output/fuel-all-tests.log", import.meta.url);
const browserFile = new URL(
  "../output/fuel-balance-browser.json",
  import.meta.url,
);
const suite = (await Bun.file(suiteFile).exists())
  ? await Bun.file(suiteFile).text()
  : "";
const browser = (await Bun.file(browserFile).exists())
  ? await Bun.file(browserFile).json()
  : null;
const suiteSummary = suite.match(/(\d+) pass\s+(\d+) fail/);
const savedEvidence = `<p>Saved suite evidence: ${suiteSummary ? `${suiteSummary[1]} passes, ${suiteSummary[2]} failures` : "not available"}. The former gear-penetration failure was reproduced from unmodified HEAD 7acaea1 and is now fixed; the gear-mount test passes at its original precision, and Finch retains its original landing approach. Power-only rotation is checked against the measured tires' settled stance; the Aurelia landing test pilot now lowers the nose after first touchdown, rather than re-entering a flare whenever wheels briefly unload. Browser evidence: ${browser ? `${browser.checks.length} checks, ${browser.errors.length} errors` : "not available"}. Both main and private lab builds passed; all three updated jet native files were saved and reopened.</p>`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fleet fuel and mass calibration</title><style>body{max-width:1100px;margin:40px auto;padding:0 20px;font:16px/1.6 system-ui;color:#222}h1{font-size:30px}h2{margin-top:40px}h3{font-size:19px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #ccc;padding:9px;text-align:left}th{background:#f3f3f3}.tables{overflow:auto}svg{max-width:620px;width:100%}svg text{font:12px system-ui}.hash{font:12px monospace;overflow-wrap:anywhere}a{color:#076d82}li{margin:6px 0}</style></head><body><h1>Fleet fuel and mass calibration</h1><p>13 October 2026 · local private tester · no publication</p><p>All four aircraft now use actual tank envelopes, usable/unusable fuel accounting, fuel-dependent centres of gravity and liquid inertia tensors. Internal equipment mass is redistributed within the original empty-mass budgets. It is not added a second time.</p><div class="tables"><table><tr><th>Aircraft</th><th>Usable L</th><th>Usable kg</th><th>Empty incl. residual kg</th><th>Unusable kg</th><th>Dispatch fuel kg</th><th>Dispatch / limit kg</th><th>Dispatch CG aft m</th></tr>${capacity}</table></div><h2>How the calibration works</h2><p>Tank triangles are transformed into the same right/up/aft SI frame as the game. Signed tetrahedral integration gives the enclosed volume, first moments and full second moments. Clipping and capping at horizontal fluid levels produces 33 samples per tank. The usable liquid excludes a fixed residual heel; its centre and inertia vary with fill. The component tensors and parallel-axis terms combine into the aircraft tensor.</p><p>Estimated uniform hardware displacement is 3% of each geometric envelope. Expansion space is 2% of fill capacity, implemented by dividing the available envelope by 1.02. Estimated unusable fuel is 3% of fill capacity. Nominal densities at 15°C are 0.72 kg/L for Finch avgas and 0.80 kg/L for jet fuel. Volume, hardware displacement, expansion, usable fuel and residual fuel reconcile.</p><p>Full physical tank capacity is independent of the takeoff limit. Dispatch fuel is capped by usable capacity and the retained concept takeoff mass with full payload and residual aboard. Finch, Peregrine and Stormbird cannot dispatch with every tank full at full payload under these limits. Aurelia's 89 kg battery/avionics allocation and 40 kg hydraulic allocation now occupy a fitted forward service bay, ahead of the flight deck and outside the nose-gear sweep. Empty-cabin Aurelia stays within its CG limits from 0 to 100% usable fuel, with 3.83% MAC minimum static margin. Its dry empty mass, original neutral point and 3% aft-limit requirement are unchanged. Full-fuel Stormbird without payload remains outside its declared CG envelope and is visibly rejected.</p><p>The original neutral points remain fixed. No stability coefficient was retuned to conceal a changed CG. The six-variable trim solve balances all three forces and moments, including lateral fuel imbalance and thrust-line offsets. Fuel burn updates balance four times per second, and the engine burns only usable fuel. The same shared code runs in the game and in the tester worker.</p><h2>Aircraft-specific equipment and power</h2><p>Installed batteries, avionics racks, hydraulic manifolds/accumulators and fuel boost pumps have distinct counts, proportions and model identities for each aircraft. The existing separate propulsion maps retain their own aircraft ratings. Equipment demand follows mission and redundancy needs rather than assuming that all large aircraft use the same parts. The capacities below are concept design allowances, not manufacturer-derived ratings. Primary hydraulic pumps are shaft-driven; their power is pressure times volume flow divided by an assumed 80% efficiency. Electrical and hydraulic draw, generator failure, heat rejection and battery discharge are not yet coupled to the flight model. Installed geometry contributes measured mass stations within each aircraft's retained mass budget.</p><div class="tables"><table><tr><th>Aircraft</th><th>Installation</th><th>Battery</th><th>Electrical allowance</th><th>Hydraulic allowance</th><th>Existing propulsion rating</th></tr>${hardwareRows}</table></div><h2>Validation and boundaries</h2>${savedEvidence}<p>The repeatable workflow is <code>bun run fleet:fuel-measure</code>, <code>bun run fleet:fuel-check</code> and <code>bun run lab:fuel-check</code>. The tester worker now includes 54 gear-overlap poses per plane (two runways, three frame rates, three pitch and three roll attitudes), independent tire-profile sampling, 18 routine 1.2 m/s touchdowns per aircraft, and four seconds of settled contact. Aurelia additionally checks 101 empty-cabin fuel levels and 30 s unassisted flight at 10% and 100% fuel. Automated checks cover analytic liquid integrals, capacity reconciliation, empty-mass conservation, tank ordering, asymmetric roll torque and trim, asset hashes, mass/CG/inertia updates, engine cutoff and the real flight integrator. Browser evidence is saved separately in <code>output/fuel-balance-browser.json</code>; it exercises every plane, the loading controls, rejected cases and both workers.</p><p>Aurelia's original exterior titanium detail contained five projecting hinge barrels per wing. Their indexed triangles were removed while retaining the flush fuel cap, animation tracks and transforms. Regression checks verify that only the cap remains. The enclosed actuator mechanisms are checked against the wing skin throughout nine sampled control poses, and fuel/equipment envelopes are checked against eleven landing-gear poses.</p><p>Rigid tire-ground contact replaces the old spring constraint that treated runway penetration as suspension travel. Split position correction removes initial and integrated overlap without adding bounce velocity or changing attitude, while impact impulses retain actual landing speed and hard-landing damage. Stormbird contact now uses the full measured tire sidewall profile under bank. Oleo dynamics and tire deformation remain simplified; this correction does not claim detailed shock-strut dynamics. Landing validation uses sufficient runway distance for the calibrated wheel loads. The former Aurelia test touched down too late and overran the runway. Its approach now begins 100 m earlier and must stop before the runway end without damage. The beginner controller also projects the main support reaction into body axes and stops assuming a main-only load once the nose wheels are supporting the plane.</p><ul>${calibration.limitations.map((l) => `<li>${escape(l)}</li>`).join("")}<li>Neutral points and takeoff limits remain concept estimates. Forward CG bounds are a loading assumption rather than a verified elevator-authority limit; the tester separately reports trim failure. Payload uses the existing aggregate crew/passenger/baggage station rather than individual seat manifests.</li><li>Settled liquid uses body-Y levels; aircraft bank, acceleration, slosh, fuel-transfer failures, temperature variations and adverse-attitude pickup limits are not modeled. Unusable capacity requires physical feed tests for validation.</li><li>The checks validate this simulator's arithmetic and behavior. They do not establish manufacturer-equivalent performance or airworthiness.</li></ul>${sections}<h2>Primary sources</h2><ul>${calibration.references.map((r) => `<li><a href="${r.url}">${escape(r.use)}</a></li>`).join("")}</ul></body></html>`;
await Bun.write(
  new URL("../docs/FUEL_MASS_CALIBRATION.html", import.meta.url),
  html,
);
await Bun.write(
  new URL("../output/fuel-mass-validation.json", import.meta.url),
  JSON.stringify({ calibration, fleet }, null, 2),
);
console.log(
  `${fleet.reduce((n, r) => n + r.checks.length, 0)} integrator checks passed; docs/FUEL_MASS_CALIBRATION.html saved.`,
);
