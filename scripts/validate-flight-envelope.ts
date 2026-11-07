import { envelopeFingerprint as fingerprint } from "./envelope-source";
import { validateAircraft } from "../lab/validation";
import { aircraftDesign } from "../src/aircraft/aircraft-design";
import { references } from "../src/flight/flight-reference-data";
const ids = ["finch", "peregrine", "aurelia", "stormbird"] as const;
async function command(args: string[], name: string) {
  const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  await Bun.write(`output/envelope-${name}.log`, out + err);
  if (code) throw Error(`${name} failed: output/envelope-${name}.log`);
  return out + err;
}
const start = await fingerprint();
const tests = await command(["bun", "test", "./tests"], "tests");
await command(["bun", "run", "build"], "main-build");
await command(["bun", "run", "lab:build"], "lab-build");
if (process.argv.includes("--browser"))
  await command(["bun", "scripts/run-envelope-browser.ts"], "browser-run");
const results = ids.map(validateAircraft);
const browser = await Bun.file("output/envelope-browser.json").json();
const exported = await Bun.file("output/envelope-browser-export.json").json();
// Require the browser worker to reproduce this exact current model. Never reuse
// prior run results just because the version label still happens to match.
let maximumRelativeDifference = 0;
function compareWorker(a: unknown, b: unknown, path: string) {
  if (a === b) return;
  if (typeof a === "number" && typeof b === "number") {
    const difference = Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));
    maximumRelativeDifference = Math.max(maximumRelativeDifference, difference);
    if (Number.isFinite(difference) && difference < 1e-8) return;
  } else if (a && b && typeof a === "object" && typeof b === "object") {
    if (JSON.stringify(Object.keys(a)) !== JSON.stringify(Object.keys(b)))
      throw Error(`${path}: worker schema mismatch`);
    for (const key of Object.keys(a))
      compareWorker(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
    return;
  }
  throw Error(`${path}: stale or mismatched worker evidence; rerun --browser`);
}
if (JSON.stringify(browser.sourceHashes) !== JSON.stringify(start))
  throw Error("Browser source fingerprint is stale; rerun --browser.");
for (const r of results) compareWorker(exported.results[r.id], r, r.id);
if (JSON.stringify(start) !== JSON.stringify(await fingerprint()))
  throw Error("Source changed during validation; rerun on the new source.");
const verification = {
  tests: Number(tests.match(/(\d+) pass/)?.[1]),
  assertions: Number(tests.match(/(\d+) expect\(\) calls/)?.[1]),
  browser,
  maximumRelativeDifference,
};
const evidence = {
  generatedAt: new Date().toISOString(),
  sourceHashes: start,
  verification,
  results,
};
await Bun.write(
  "output/flight-envelope-validation.json",
  JSON.stringify(evidence, null, 2),
);
const fmt = (n: number, d = 2) => n.toFixed(d);
const table = (headers: string[], rows: string[][]) =>
  `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const summary = table(
  [
    "Aircraft",
    "Positive stall onset / clean TAS at 1,000 m",
    "Worst disturbance RMS ratio",
    "Powered recovery clear time",
    "Hands-off engine-out restalls",
  ],
  results.map((r) => [
    r.id,
    `${fmt((((aircraftDesign(r.id).aerodynamics.clMax - aircraftDesign(r.id).aerodynamics.cl0) / aircraftDesign(r.id).aerodynamics.liftSlope) * 180) / Math.PI)}° / ${fmt(r.stallSpeeds[0].clean)} m/s`,
    fmt(Math.max(...r.disturbances.map((d) => d.ratio)), 3),
    `${fmt(Math.min(...r.poweredRecoveries.map((s) => s.terminalStallFreeSeconds)))} s of 10 s`,
    `${r.stalls.filter((s) => s.stalledAtEnd).length} / 8 at 10 s`,
  ]),
);
const cg = table(
  [
    "Aircraft",
    "Fuel / payload",
    "Mass kg",
    "CG aft m",
    "Static margin",
    "Cmα / Cmq",
    "Pitch / roll / yaw RMS ratio",
  ],
  results.flatMap((r) =>
    r.cgChecks.map((c, i) => [
      r.id,
      `${c.loading.fuel} / ${c.loading.payload}`,
      fmt(c.mass, 1),
      fmt(c.cg[2], 4),
      `${fmt(c.staticMargin * 100)}% MAC`,
      `${fmt(c.cmAlpha, 3)} / ${fmt(c.cmQ, 3)}`,
      r.disturbances
        .slice(i * 3, i * 3 + 3)
        .map((d) => fmt(d.ratio, 3))
        .join(" / "),
    ]),
  ),
);
const images = await Promise.all(
  ids.map(
    async (id) =>
      `<figure><img src="data:image/png;base64,${Buffer.from(await Bun.file(`output/envelope-${id}-stall.png`).arrayBuffer()).toString("base64")}" alt="${id} stall validation in the private tester"><figcaption>${id}: actual local tester worker results and controls, independently exported and numerically compared to the current model.</figcaption></figure>`,
  ),
);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Fleet stall, stability and engine reference validation</title><style>body{max-width:1100px;margin:40px auto;padding:0 20px;font:16px/1.6 system-ui;color:#222}h1{font-size:29px}h2{margin-top:34px;font-size:22px}table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:9px;border:1px solid #ccc;text-align:left}th{background:#eee}.table-wrap{overflow:auto}code{overflow-wrap:anywhere}img{width:100%;display:block}figure{margin:24px 0}figcaption{font-size:13px}li{margin:8px 0}@media(max-width:650px){table{min-width:800px}}</style></head><body><h1>Fleet stall, stability and engine reference validation</h1><p>${evidence.generatedAt} · Local only · Publication held</p><p>All four aircraft were checked in the private tester's new flight-validation bench. The bench uses the shared flight model and game integrator; the separate inviscid main-wing vortex solver remains limited to attached flow. A worker runs these experiments away from rendering.</p><h2>What changed</h2><ul><li>Finch altitude power now interpolates Lycoming's published normally aspirated engine table instead of multiplying by density. Rated shaft power, propeller efficiency, static thrust and throttle-power relation remain concept estimates.</li><li>Peregrine and Stormbird thrust now interpolates the NASA TP-1538 altitude/Mach deck. Its dry and maximum branches are independently scaled to existing concept ratings; dry rated command is 0.88, with a continuous afterburner transition. The source is a published simulator deck, not independently verified engine-test measurements. Below M=0.2 the first row is held; outside the source grid boundaries are held. This is not a manufacturer match to either fictional engine.</li><li>Aurelia's civil engine map remains estimated. The JT15D NASA research found in this pass concerns an instrumented inlet/noise installation and does not provide a matching installed engine deck for Aurelia. Its military afterburner branch remains absent.</li><li>Post-stall lift now transfers the approximate NACA 0012 experimental loss shape from Figure 2 of NASA TM-101413, normalized about each concept's own peak and critical angle. This is a shape surrogate, not measured CLmax or critical AOA for our planes. Deep-angle lift blends into the prior flat-plate estimate; negative-alpha symmetry is assumed.</li><li>Finch pitch damping uses the published Cessna 172 model value −11.4. The military jets use the angle-dependent Cmq table from NASA TP-1538. These are transfers across different geometry, CG, inertias and installations. The civil jet's pitch damping and all yaw/roll derivatives remain estimated. Separated flow reduces control effectiveness by an explicit estimated factor; it is not a measured tail-wake model.</li></ul><h2>Fleet results</h2>${summary}<p>Onset and stall TAS above are model predictions, not reference-aircraft measurements. Nominal TAS is at 1,000 m, full fuel/payload, clean flaps; fixed Finch gear remains down. Flapped curves and 2 g TAS are also exported. The 2 g clean stall-speed ratio is √2.</p><h2>Stability checks</h2><p>Sixteen loading conditions each received pitch +2°, roll rate +5°/s and yaw +3° disturbances at trimmed speed and 1,000 m: 48 runs, 30 seconds each, zero wind, beginner assist disabled. The first and last five seconds of AOA/pitch-rate, roll-rate or sideslip/yaw-rate are compared by RMS. Every run stayed finite, damage-free and showed decay. This verifies these perturbations of the implemented model; it does not establish all phugoid, spiral, Dutch-roll or high-AOA modes from aircraft measurements.</p>${cg}<h2>Stall checks and the repeated-stall finding</h2><p>Thirty-two engine-out hands-off probes start at trim speed with imposed AOA 10° beyond positive or negative stall onset, across four loading cases per aircraft. All exit the initial stall, but three Aurelia probes are stalled again at ten seconds. These are high-AOA release experiments, not one-g deceleration tests or proof of deep stall. A brief first exit is recorded separately from terminal state.</p><p>Sixteen powered positive-stall recoveries start at 1.1×clean stall TAS and 10° above onset. A declared test-pilot policy feeds bounded pitch commands (−0.25 to +0.15) toward 60% of critical AOA with pitch-rate damping and advances power. The game's beginner assist stays disabled. Every ten-second run recovers and stays clear of stall for at least ${fmt(Math.min(...results.flatMap((r) => r.poweredRecoveries.map((s) => s.terminalStallFreeSeconds))))} seconds at the end, with no damage. Existing automatic gear/flaps remain active; this is not a manual fixed-configuration certification test.</p><p>Longer exploratory powered runs hit the existing 1,800 m position/vertical-velocity clamp in <code>src/flight/physics.ts</code>, which can alter airflow and create apparent restalls. The reported recovery window ends before that boundary (maximum height ${fmt(Math.max(...results.flatMap((r) => r.poweredRecoveries.map((s) => s.maximumHeight))), 0)} m). The clamp requires separate engine-architecture work; do not use boundary-contaminated trajectories as aerodynamic evidence.</p><h2>Engine checks</h2><p>480 fleet samples cover 0/1,000/3,000/6,000 m, M=0/0.1/0.2/0.4/0.6/0.8, and commands 0/0.25/0.5/0.88/1. Monotonic command, finite non-negative output, zero-command cutoff, altitude loss and reference grid anchors/intermediate interpolation pass. The 3,000/6,000 m samples are static engine-map inspections beyond the game's flight ceiling, not flights at those altitudes. Propeller efficiency at high Mach, civil installed thrust, fuel flow, engine transients and idle net drag remain unvalidated.</p><h2>Primary sources and applicability</h2>${Object.values(
  references,
)
  .map(
    (r) =>
      `<p><a href="${r.url}">${r.title}</a><br>${r.location}<br>${r.kind}</p>`,
  )
  .join(
    "",
  )}<p><a href="https://ntrs.nasa.gov/api/citations/19720002382/downloads/19720002382.pdf?attachment=true">NASA TN D-6573: full-scale unpowered executive T-tail jet</a> provides measured configuration-dependent high-AOA pitch-up, buffet and possible deep-stall trim. Its different sweep, airfoil, high-lift devices and tail installation prevent direct transfer to Aurelia. It establishes a missing test requirement; it does not prove our current repeated stall is that phenomenon.</p><h2>Verification and saved evidence</h2><p>${verification.tests} tests / ${verification.assertions.toLocaleString()} assertions passed, with both production builds. The local private tester ran and exported all four models, with ${browser.errors.length} page/console errors and no 390 px document overflow. The exported worker results matched this run's model within a 1e-8 relative/absolute tolerance (actual maximum difference ${maximumRelativeDifference.toExponential(2)}); the browser source fingerprints matched. Four aircraft each have 422 polar samples, 12 disturbance histories, eight engine-out probes, four powered recovery cases and 120 engine points.</p>${images.join("")}<h2>Integration notes for the parallel physics-engine work</h2><p>This pass changes only shared coefficient evaluation/data and the private bench. It does not rewrite state ownership, rigid-body integration, contacts, crashes, controls or wheel reactions. Keep <code>src/flight/engine-map.ts</code> and <code>src/flight/flight-reference-data.ts</code> with <code>src/flight/aerodynamics.ts</code>; the integration boundary remains <code>aircraftAerodynamics</code>/<code>aircraftThrust</code>. Preserve the reference provenance and keep the same force model in manual/assisted modes. The observed ceiling artifact belongs to engine boundary handling.</p><p>Snapshot hashes for model/bench sources are stored in <code>output/flight-envelope-validation.json</code>. No publication was performed. No other chat was messaged. The other chat was read to understand ownership; its planning document was left untouched.</p><h2>Repeatable workflow</h2><p>With the private tester running on port 5186: <code>bun scripts/validate-flight-envelope.ts --browser</code> runs tests, both builds, browser checks, numerical worker/model and exact source-fingerprint comparison and regenerates this report. Source changes during the run cause an explicit failure. <code>bun scripts/validate-fleet-dynamics.ts --browser</code> separately checks the main game's keyboard departures and seeded landings.</p><p>JSON evidence: <code>output/flight-envelope-validation.json</code>, downloaded <code>output/envelope-browser-export.json</code>, UI checks <code>output/envelope-browser.json</code>. Limitations remain explicit: unknown whole-aircraft section polars, local stall progression, unsteady hysteresis, spins, actual neutral points, civil engine performance and structural/certification data.</p></body></html>`;
await Bun.write("docs/validation/FLEET_ENVELOPE_VALIDATION.html", html);
console.log(
  `${verification.tests} tests; 48 disturbances, 32 hands-off probes, 16 powered recoveries, 480 engine points. Report saved.`,
);
