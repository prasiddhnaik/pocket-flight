import { createHash } from "node:crypto";
import {
  aircraftDesign,
  massProperties,
} from "../src/aircraft/aircraft-design";
import measured from "../src/aircraft/heron/geometry.json";
import calibrated from "../src/aircraft/heron/aerodynamics.json";
import fuel from "../src/aircraft/heron/fuel-geometry.json";

const read = (name: string) => Bun.file(`output/heron-realism/${name}`).json();
const study = await read("wing-study.json"),
  flight = await read("flight-validation.json");
const browser = await read("browser-lab.json"),
  game = await read("browser-game.json");
const worker = await read("worker-comparison.json");
const cad = await Bun.file("public/assets/heron-ut9.cad.json").json();
const motion = await Bun.file("assets/heron/checks/motion.json").json();
const validation = await read("cad-validation.json");
const testLog = await Bun.file("output/heron-realism/full-tests.log").text();
const tests = Number(testLog.match(/\n (\d+) pass\n/)?.[1]);
if (
  !tests ||
  !testLog.includes("\n 0 fail\n") ||
  !validation.ok ||
  motion.failureCount
)
  throw Error("Complete passing evidence is required before reporting");
const design = aircraftDesign("heron"),
  built = study.candidates[3],
  untwisted = study.candidates[0];
const f = (value: number, places = 2) => value.toFixed(places);
const escape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const table = (headers: string[], rows: string[][]) =>
  `<div class="table"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const picture = async (name: string, caption: string) =>
  `<figure><img src="data:image/png;base64,${Buffer.from(await Bun.file(`output/heron-realism/${name}`).arrayBuffer()).toString("base64")}" alt="${escape(caption)}"><figcaption>${caption}</figcaption></figure>`;
const images = await Promise.all([
  picture(
    "cad-iso.png",
    "Native STEP snapshot of the built aircraft. Curved fuselage and cowling, cambered tapered wing, struts, fixed gear and the fitted cargo pod share the same CAD master used for the game export.",
  ),
  picture(
    "wing-study.png",
    "Geometry and attached-flow study. The right plot compares the new planform with and without washout at matched total CL = 0.7. It does not predict the location or timing of stall.",
  ),
  picture(
    "lab-airframe.png",
    "Heron loaded in the existing private aerodynamic lab. Flow paths are illustrative; the inviscid main-wing solver supplies the numerical wing results.",
  ),
  picture(
    "lab-stability.png",
    "Actual browser worker output for Heron: four loading cases, thirty-second disturbances, zero wind and beginner assistance disabled.",
  ),
  picture(
    "game-departure.png",
    "Keyboard-controlled departure in the actual game. At 25 seconds the aircraft remains airborne and undamaged; beginner assistance and automatic configuration are active for this gameplay check.",
  ),
]);
const comparison = table(
  ["Measurement", "Before this revision", "Built aircraft"],
  [
    [
      "Projected wing area",
      `${f(study.baseline.area)} m²`,
      `${f(measured.wingArea)} m²`,
    ],
    [
      "Span / aspect ratio",
      `15.87 m / ${f(study.baseline.aspectRatio)}`,
      `15.87 m / ${f(built.aspectRatio)}`,
    ],
    [
      "Root / outer incidence",
      "0° / 0°",
      "2.5° / 0°; washout ends at 7.45 m semispan",
    ],
    [
      "Wing CL at zero fuselage angle",
      f(study.baseline.cl0, 4),
      f(calibrated.cl0, 4),
    ],
    [
      "Wing lift slope",
      `${f(study.baseline.liftSlope, 4)} rad⁻¹`,
      `${f(calibrated.liftSlope, 4)} rad⁻¹`,
    ],
    [
      "Level main-wing lift: 3,995 kg at 65 m/s, ρ = 1.225",
      `${f(study.baseline.sameWeightFlight.alpha)}° body AOA`,
      `${f(built.sameWeightFlight.alpha)}° body AOA`,
    ],
    [
      "Wing induced drag at the same weight and speed",
      `${f(study.baseline.sameWeightFlight.inducedDragN, 1)} N`,
      `${f(built.sameWeightFlight.inducedDragN, 1)} N`,
    ],
    [
      "Estimated parasite drag area",
      "1.1405 m²",
      `1.1405 m²; CD₀ renormalized to ${f(calibrated.cd0, 5)}`,
    ],
  ],
);
const candidates = table(
  [
    "Washout",
    "Wing area",
    "Inboard peak section CL",
    "Aileron-region peak section CL",
    "Induced drag at equal weight",
  ],
  study.candidates.map((r: typeof built, i: number) => [
    `${[0, 1.5, 2, 2.5, 3][i]}°${i === 3 ? " — built" : ""}`,
    `${f(r.area)} m²`,
    f(r.inboardPeakSectionCl, 3),
    f(r.aileronPeakSectionCl, 3),
    `${f(r.sameWeightFlight.inducedDragN, 1)} N`,
  ]),
);
const loading = table(
  [
    "Fuel / payload",
    "Mass",
    "CG aft",
    "Estimated static margin",
    "Pitch / roll / yaw final-to-initial RMS",
  ],
  flight.cgChecks.map((c: (typeof flight.cgChecks)[number], i: number) => [
    `${c.loading.fuel} / ${c.loading.payload}`,
    `${f(c.mass, 1)} kg`,
    `${f(c.cg[2], 4)} m`,
    `${f(c.staticMargin * 100)}% MAC`,
    flight.disturbances
      .slice(i * 3, i * 3 + 3)
      .map((d: { ratio: number }) => f(d.ratio, 3))
      .join(" / "),
  ]),
);
const generatedAt = new Date().toISOString();
const sourcePaths = [
  "assets/heron/src/heron.py",
  "assets/heron/src/heron_wing_cells.py",
  "assets/heron/src/export_game.py",
  "assets/heron/checks/motion.py",
  "lab/solver.ts",
  "lab/validation.ts",
  "lab/validation.worker.ts",
  "lab/loading-validation.ts",
  "lab/loading-validation.worker.ts",
  "src/aircraft/heron/design.ts",
  "src/aircraft/heron/fuel.ts",
  "src/aircraft/heron/geometry.json",
  "src/aircraft/heron/fuel-geometry.json",
  "src/aircraft/heron/aerodynamics.json",
  "src/aircraft/aircraft-design.ts",
  "scripts/calibrate-heron-aero.ts",
  "scripts/study-heron.ts",
];
const sourceHashes = Object.fromEntries(
  await Promise.all(
    sourcePaths.map(async (path) => [
      path,
      createHash("sha256")
        .update(new Uint8Array(await Bun.file(path).arrayBuffer()))
        .digest("hex"),
    ]),
  ),
);
await Bun.write(
  "output/heron-realism/evidence.json",
  JSON.stringify(
    {
      generatedAt,
      sourceHashes,
      assetSha256: measured.revision,
      tests,
      cad,
      motion,
      worker,
      browserErrors: browser.errors,
      gameErrors: game.errors,
    },
    null,
    2,
  ),
);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Heron UT-9 — aerodynamic revision</title><style>
body{max-width:1100px;margin:40px auto;padding:0 22px;font:16px/1.65 system-ui,sans-serif;color:#222;background:#fff}h1{font-size:32px;line-height:1.2}h2{font-size:22px;margin-top:35px}p{max-width:95ch}a{color:#126969}code{font-size:13px;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:10px;border:1px solid #ccc;text-align:left;vertical-align:top}th{background:#f1f1ef}.table{overflow:auto}figure{margin:25px 0}img{display:block;width:100%;height:auto}figcaption,.meta{font-size:13px;color:#555}.note{border-left:3px solid #126969;padding:10px 16px;background:#f4f6f4}li{margin:7px 0}@media(max-width:700px){body{margin:24px auto}table{min-width:650px}}
</style></head><body><p class="meta">Pocket Flight · ${generatedAt} · Local build on codex/private-wind-tunnel</p><h1>Heron UT-9: aerodynamic revision</h1>
<p class="note">The existing Heron now has a slimmer wing with defined incidence, washout and dihedral, a symmetric horizontal tail, controls that turn on their actual three-dimensional hinges, CAD-contained fuel cells, and flight coefficients tied to the private lab. All ${cad.solidCount} solids have a contact path to the fuselage. ${tests} tests pass.</p>
<p><a href="http://127.0.0.1:5194/heron.html">Inspect the aircraft</a> · <a href="http://127.0.0.1:5194/?aircraft=heron">Fly locally</a> · <a href="http://127.0.0.1:5186/">Private aerodynamic lab</a> · <a href="http://127.0.0.1:3245/?file=STEP/heron-ut9.step">Native CAD viewer</a> · <a href="../../assets/heron/STEP/heron-ut9.step">STEP master</a> · <a href="../../public/assets/heron-ut9.glb">Game GLB</a></p>
${images[0]}<h2>Research translated into design choices</h2>
<p><a href="https://cessna.txtav.com/en/turboprop/grand-caravan-ex">Textron’s Grand Caravan EX specifications</a> provide a class reference: 15.9 m span, 12.7 m length, 4.7 m height, 25.96 m² wing area, 3,995 kg takeoff mass, and 867 shp. Heron remains an original utility aircraft. Its 15.87 m span and revised 26.69 m² wing area are consistent with that role; the reference does not establish Heron’s performance.</p>
<p><a href="https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-coefficient/">NASA’s drag-coefficient treatment</a> requires a consistent reference area. The smaller wing now uses a correspondingly larger estimated CD₀ so the fixed fuselage, gear, struts and pod do not gain an unmeasured drag reduction. The old equivalent parasite drag area is retained. Induced-drag comparisons use equal weight, speed and density because a higher aspect ratio obtained only by reducing area does not by itself reduce induced drag at fixed span and lift.</p>
<p><a href="https://ntrs.nasa.gov/citations/19930091780">NACA Report 703</a> studies how taper, thickness, Reynolds number and washout influence stall characteristics. I tested five twist choices and selected 2.5° washout to move attached-flow loading away from the aileron region. This is a design rationale and a measured VLM trend; the lab does not solve viscous separation or establish root-first stall.</p>
<p><a href="https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/00-80T-80.pdf">Aerodynamics for Naval Aviators, hosted by the FAA</a> describes how tail contribution, downwash and CG affect longitudinal stability. Heron’s neutral point and pitch damping now depend on its tail area and arm, with explicit estimated tail pressure and downwash allowances. They replace a generic fixed offset from the mass model.</p>
<h2>What changed in the plane</h2><ul>
<li>The wing retains a rounded leading edge, 14% NACA-style thickness and 2% sinusoidal camber. Root chord is 1.95 m; the outer control station is 1.31 m, followed by a rounded tapered tip. Root incidence is 2.5° and reduces to 0° across the outer wing. The existing curved fuselage, cowling, glazing, cargo pod and twisted four-blade propeller are retained.</li>
<li>The horizontal tail uses a symmetric 10% section. Wing-root fairings and strut attachment heights follow the revised wing. The fuselage remains 12.67 m long and the aircraft remains 4.70 m high.</li>
<li>Flaps and ailerons have rounded noses, recessed fixed-wing pockets, pins and 6 mm end clearances. Their end planes and runtime pivots follow each swept, inclined hinge. The game’s local control rotation therefore follows the same axis as the CAD model.</li>
<li>The lab solver now accepts station incidence, interpolates twist and positions its quarter-chord vortices and three-quarter-chord control points consistently. Existing zero-incidence wings retain their previous numerical behavior. Runtime Heron CL₀ and lift slope come from the lab at 0° and 4° fuselage AOA; incidence is included once.</li>
<li>Fuel geometry, settled-liquid centroids and inertia now come from two shaped volumes enclosed by the wing. Crew/passenger, cargo and wing mass stations follow the model’s layout. Component masses remain engineering estimates.</li></ul>
${comparison}${images[1]}<h2>Why this washout was selected</h2><p>Each section-loading comparison uses total CL = 0.7 at 144 panels. Inboard means 0.6–4.7 m semispan; aileron region means 4.86–7.45 m. The built wing lowers peak aileron-region section CL from ${f(untwisted.aileronPeakSectionCl, 3)} to ${f(built.aileronPeakSectionCl, 3)}, approximately ${f((1 - built.aileronPeakSectionCl / untwisted.aileronPeakSectionCl) * 100, 1)}%, against the new planform without washout. It increases inboard loading. A 1.5° twist candidate has the lowest computed induced drag; 2.5° was selected for more outer-wing unloading, with a small drag cost.</p>${candidates}
<p>The equal-weight drag column balances 3,995 × 9.81 N at 65 m/s and 1.225 kg/m³. Differences are main-wing VLM estimates. Span-efficiency outputs slightly above 1 use projected span for a nonplanar, discretized wing; they are not adopted as whole-aircraft Oswald efficiency. The game retains an estimated efficiency of 0.78.</p>
<h2>Fuel packaging and balance</h2><p>Each analysis envelope occupies semispan 1.10–5.80 m and the 15–60% chord region, ahead of the control recess. Exact CAD containment is checked against the wing envelope. Each encloses ${f(fuel.tanks[0].exactEnvelopeLitres, 1)} L before allowances. Three percent structure displacement, three percent trapped fuel and two percent expansion relative to fill capacity are estimates. Settled-liquid geometry produces ${f(fuel.usableFuelKg, 1)} kg usable fuel and ${f(fuel.unusableFuelKg, 2)} kg retained unusable fuel at 0.80 kg/L. The mesh-integrated envelope agrees with exact CAD volume within 0.1%.</p>
<p>Default loading is 65% usable fuel and 100% payload, totaling ${f(design.nominal.mass, 1)} kg against the 3,995 kg takeoff limit. Full tanks plus full payload total ${f(massProperties(design.massBudget, { fuel: 1, payload: 1 }).mass, 1)} kg and are rejected by the lab’s dispatch check. Fuel settling moves the liquid centroid inboard as the level falls. These are conceptual analysis volumes; tank walls, baffles, structural load paths and fuel-feed behavior are not designed here.</p>
<h2>Private-lab results</h2><p>The actual browser ran a 17-point −8° to +8° angle sweep and the 24/48/96/144-panel convergence check. At 65 m/s and 4° AOA, 96 to 144 panels change CL by ${f(browser.wing.convergence.liftChangePercent, 3)}% and CDi by ${f(browser.wing.convergence.dragChangePercent, 3)}%. This establishes numerical refinement for that case. The lab’s illustrative full-aircraft flow is separate from its wing-force calculation.</p>${images[2]}
<p>Both flight-validation and fuel-validation workers now include Heron as the fifth aircraft. Engine-map evidence explicitly labels its turboprop map as estimated. Browser export includes all five planes; Heron’s exported numerical result reproduces the current Bun model with a maximum relative/absolute normalized difference of ${worker.maximumRelativeDifference.toExponential(2)}, within the 1e−8 comparison tolerance.</p>
${loading}<p>The tail model estimates a neutral point ${f(calibrated.neutralPointZ, 4)} m aft of the body datum. Across these four dispatch/low-fuel/payload cases the static margin is ${f(Math.min(...flight.cgChecks.map((c: { staticMargin: number }) => c.staticMargin)) * 100)}–${f(Math.max(...flight.cgChecks.map((c: { staticMargin: number }) => c.staticMargin)) * 100)}% MAC. Twelve 30-second disturbance runs use zero wind and no beginner assistance; the largest final-to-initial RMS ratio is ${f(Math.max(...flight.disturbances.map((d: { ratio: number }) => d.ratio)), 3)}. Four powered stall-recovery probes finish undamaged with at least ${f(Math.min(...flight.poweredRecoveries.map((r: { terminalStallFreeSeconds: number }) => r.terminalStallFreeSeconds)))} s clear of stall at the end of each ten-second run. These check the implemented model and the declared test-pilot policy.</p>${images[3]}
<h2>CAD, export and gameplay verification</h2>${table(
  ["Check", "Observed result"],
  [
    [
      "Native STEP",
      `${validation.occurrenceCount} occurrences; zero geometry failures. Self-intersection checking uses the validator’s first-placement policy.`,
    ],
    [
      "Connections",
      `${cad.connectedSolids}/${cad.solidCount} connected solids, zero floating, exact-distance graph tolerance 0.5 mm; enclosed cabin floor.`,
    ],
    [
      "Control motion",
      `${motion.checks.length} sampled poses, zero failures. Checks include attachment distance and flap/aileron intersection with fixed wing skins. This is sampled travel, not a continuous all-airframe collision proof.`,
    ],
    [
      "Game export",
      `Same CAD solids, 1.6 mm mesh deflection, BREP-derived normals, ${cad.collisionProbes} collision probes; 15.87 × 4.70 × 12.67 m runtime bounds.`,
    ],
    [
      "Tests",
      `${tests} passing / zero failures across 62 files. Focused checks cover incidence sign, cache invalidation, lab/runtime agreement, washout loading, control axes, fuel mass/centroids, loading trim and unassisted cruise.`,
    ],
    [
      "Builds and repository check",
      "Game and lab TypeScript/Vite production builds pass. Import/navigation check passes. Vite reports the existing large-chunk warnings.",
    ],
    [
      "Browser lab",
      "Sweep, convergence, five-plane flight worker/export, Heron’s nine fuel checks and overweight rejection pass; zero captured page/console errors or worker alerts.",
    ],
    [
      "Keyboard departure",
      `Takeoff at ${f(game.result.takeoff.time)} s / ${f(game.result.takeoff.knots, 1)} kt in this run. At ${f(game.result.time)} s: ${f(game.result.climb, 1)} m above starting height, gear fixed down, health 100%, no crash. Default beginner assistance and automatic configuration are active.`,
    ],
    [
      "Unassisted cruise",
      "Separate 20-second trim test at 65 m/s and 600 m stays within 0.5 m altitude and 0.1 m/s speed, with no damage.",
    ],
  ],
)}${images[4]}
<h2>Evidence boundary</h2><p>CAD geometry, containment, connectivity, sampled control motion, export consistency and the reported simulations were checked. Main-wing VLM is steady, inviscid and limited to attached flow. Whole-aircraft profile drag, CL limits, flap increments, post-stall behavior, component masses, tail pressure/downwash, propulsion lapse and yaw/roll derivatives remain estimates. This pass does not predict local stall progression, propwash, structural strength, continuous mechanism clearance or real aircraft performance.</p>
<h2>Rebuild and inspect</h2><p><code>bun run heron:build</code> builds the CAD, connection and motion checks, runtime export, fuel geometry and aerodynamic calibration. <code>bun run heron:check</code> runs the 25 focused asset/realism/envelope tests. <code>bun run heron:study</code> repeats the five-candidate wing study. <code>bun scripts/report-heron-aerodynamics.ts</code> regenerates this report from the saved passing evidence. Start the private lab with <code>bun run lab:dev</code> and select Heron.</p>
<p><a href="../../assets/heron/src/heron.py">CAD source</a> · <a href="../../assets/heron/src/heron_wing_cells.py">Fuel analysis source</a> · <a href="../../src/aircraft/heron/aerodynamics.json">Calibration and assumptions</a> · <a href="../../output/heron-realism/wing-study.json">Wing study evidence</a> · <a href="../../output/heron-realism/evidence.json">Source fingerprints and validation evidence</a></p>
<p class="meta">The checkout already contained extensive unrelated edits and source moves. A before/after SHA-256 audit found no missing baseline files and changes only to Heron’s model/definitions, its build/measurement workflow, the shared incidence support and the lab/test integration described here. No staging, commits or publication were performed. Authoring assets follow the existing ignored-assets convention. Runtime GLB SHA-256: <code>${measured.revision}</code>.</p>
</body></html>`;
await Bun.write("docs/aircraft/HERON_AERODYNAMICS.html", html);
console.log(
  `Heron aerodynamic report: ${tests} passing tests, ${cad.connectedSolids} connected solids.`,
);
