import { fileURLToPath } from "node:url";
import { Vector3 } from "three";
import { FlightPhysics } from "../src/flight/physics";
import { aircraftDesign, massProperties } from "../src/aircraft/aircraft-design";
import { solveTrim } from "../src/flight/flight-trim";
import { aircraftStallSpeed } from "../src/flight/aerodynamics";
import { runways } from "../src/world/terrain";

const root = fileURLToPath(new URL("../", import.meta.url));
const ids = ["finch", "peregrine", "aurelia", "stormbird"] as const;
const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };
const check = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};
async function command(args: string[], name: string) {
  const p = Bun.spawn(args, { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  await Bun.write(`${root}output/fleet-${name}.log`, out + err);
  if (code) throw new Error(`${name} failed; see output/fleet-${name}.log`);
  return out + err;
}
const reportOnly = process.argv.includes("--report-only");
const tests = reportOnly
  ? await Bun.file(`${root}output/fleet-all-tests.log`).text()
  : await command(["bun", "test", "./tests"], "all-tests");
if (!reportOnly) {
  await command(["bun", "run", "build"], "dynamics-main-build");
  await command(["bun", "run", "lab:build"], "dynamics-lab-build");
} else {
  for (const name of ["dynamics-main-build", "dynamics-lab-build"])
    check(
      (await Bun.file(`${root}output/fleet-${name}.log`).text()).includes(
        "built in",
      ),
      "Missing passing build evidence",
    );
}
if (process.argv.includes("--browser"))
  await command(
    ["bun", "scripts/run-fleet-dynamics-browser.ts"],
    "browser-run",
  );
const rows = [];
for (const id of ids) {
  const d = aircraftDesign(id);
  const trims = [];
  for (const loading of [
    d.defaultLoading,
    { fuel: 0.1, payload: 1 },
    { fuel: d.defaultLoading.fuel, payload: 0.9 },
    { fuel: 0.1, payload: 0.9 },
  ])
    for (const altitude of [600, 1500]) {
      const balance = massProperties(d.massBudget, loading);
      const trim = solveTrim(
        d,
        balance,
        d.trimSpeed,
        altitude,
        id === "finch" ? 1 : 0,
      );
      const p = new FlightPhysics();
      p.aircraftId = id;
      p.configureLoading(loading);
      p.reset(true);
      p.position.set(0, altitude, 700);
      p.velocity.set(0, 0, -d.trimSpeed);
      p.pitch = trim.alpha;
      p.elevatorTrim = trim.pitch;
      p.roll = trim.bank;
      p.rollTrim = trim.roll;
      p.yawTrim = trim.yaw;
      p.throttle = p.enginePower = trim.throttle;
      p.beginnerAssist = false;
      p.windOverride = new Vector3();
      for (let n = 0; n < 1200; n++) p.step(1 / 60, neutral);
      const drift = p.position.y - altitude,
        speedDrift = p.airspeed - d.trimSpeed;
      check(
        trim.forceResidual < 1e-6 && trim.momentResidual < 1e-6,
        `${id}: trim residual`,
      );
      check(
        Math.abs(drift) < 1 && Math.abs(speedDrift) < 0.2 && p.health === 100,
        `${id}: unassisted trim drift ${drift}, ${speedDrift}`,
      );
      trims.push({
        loading,
        altitude,
        mass: balance.mass,
        cg: balance.cg.toArray(),
        trim,
        drift,
        speedDrift,
      });
    }
  const p = new FlightPhysics();
  p.aircraftId = id;
  p.reset();
  let takeoff = null;
  for (let n = 0; n < 1200; n++) {
    p.step(1 / 60, {
      ...neutral,
      throttle: 1,
      pitch: p.airspeed * 1.943844 >= p.profile.rotationKnots ? 1 : 0,
    });
    if (!takeoff && p.events.some((e) => e.type === "takeoff"))
      takeoff = {
        time: p.flightTime,
        knots: p.airspeed * 1.943844,
        distance: 459 - p.position.z,
        z: p.position.z,
      };
  }
  check(
    !!takeoff && p.health === 100 && !p.grounded && !p.stall,
    `${id}: departure`,
  );
  const departure = { ...takeoff, heightAfter20Seconds: p.position.y };
  p.reset(true);
  p.position.set(-260, 13, id === "aurelia" ? 510 : 410);
  p.gearPosition = 1;
  p.flapPosition = p.jet ? 0.65 : 0;
  const speed = p.stallSpeed * 1.35,
    a = d.aerodynamics;
  const alpha =
    ((p.loadedMass * 9.80665) /
      (0.5 * 1.225 * speed ** 2 * d.geometry.wingArea) -
      a.cl0 -
      a.flapLift * p.flapPosition) /
    a.liftSlope;
  p.velocity.set(0, -1.2, -speed);
  p.pitch = alpha - Math.atan2(1.2, speed);
  p.throttle = p.enginePower = 0.08;
  let touchdown = null;
  for (let n = 0; n < 1200; n++) {
    p.step(1 / 60, {
      ...neutral,
      pitch: p.grounded
        ? 0
        : ((p.position.y < 11 ? alpha + 0.015 : alpha - 0.04) - p.pitch) * 4,
      throttle: p.grounded ? -1 : 0,
      brake: p.grounded,
    });
    touchdown ??= p.events.find((e) => e.type === "landing");
  }
  check(
    !!touchdown &&
      p.health === 100 &&
      p.grounded &&
      p.velocity.length() < 1 &&
      p.position.z > runways[0].z - runways[0].length / 2,
    `${id}: landing or stopping distance`,
  );
  const landing = {
    touchdown,
    approachKnots: speed * 1.943844,
    stopPosition: p.position.toArray(),
    health: p.health,
  };
  p.reset(true);
  p.position.set(0, 600, 700);
  p.velocity.set(0, 0, -60);
  p.pitch = 0.7;
  p.beginnerAssist = false;
  p.engineOut = true;
  let stalled = false;
  for (let n = 0; n < 1200; n++) {
    p.step(1 / 60, neutral);
    stalled ||= p.stall;
  }
  check(
    stalled && !p.stall && p.health === 100 && p.position.y > 100,
    `${id}: natural stall recovery`,
  );
  rows.push({
    id,
    mass: d.nominal.mass,
    cg: d.nominal.cg.toArray(),
    inertia: d.nominal.inertia.toArray(),
    area: d.geometry.wingArea,
    cl0: a.cl0,
    liftSlope: a.liftSlope,
    cleanStallKnots: aircraftStallSpeed(d) * 1.943844,
    thrustNewtons: d.propulsion.dryThrust,
    shaftPowerWatts: d.propulsion.shaftPower,
    departure,
    landing,
    trims,
    stallRecovery: {
      height: p.position.y,
      alpha: p.aerodynamics!.alpha,
      assistance: false,
    },
  });
}
const browserFile = Bun.file(`${root}output/fleet-dynamics-browser.json`);
const browser =
  process.argv.includes("--browser-evidence") ||
  process.argv.includes("--browser")
    ? await browserFile.json()
    : null;
if (browser)
  check(
    browser.results.length === 4 && browser.errors.length === 0,
    "Browser evidence failed",
  );
const match = tests.match(/(\d+) pass\s+(\d+) fail\s+(\d+) expect\(\) calls/);
check(!!match && match[2] === "0", "Tests did not pass");
const evidence = {
  generatedAt: new Date().toISOString(),
  method:
    "Numerical checks of the current conceptual model, not flight-test calibration.",
  units:
    "SI, knots for indicated operational speeds; speeds use modeled true airspeed, not a pitot instrument simulation.",
  tests: { pass: Number(match![1]), assertions: Number(match![3]) },
  builds: { main: true, privateTester: true },
  rows,
  browser,
};
await Bun.write(
  `${root}output/fleet-dynamics-validation.json`,
  JSON.stringify(evidence, null, 2),
);
const f = (v: number) => v.toFixed(2);
const table = rows
  .map(
    (r) =>
      `<tr><td>${r.id}</td><td>${r.mass}</td><td>${f(r.area)}</td><td>${f(r.cleanStallKnots)}</td><td>${r.thrustNewtons ? `${r.thrustNewtons / 1000} kN` : `${r.shaftPowerWatts / 1000} kW`}</td><td>${f(r.departure.time!)} s / ${f(r.departure.distance!)} m</td><td>${f(r.landing.approachKnots)} kn / ${f(r.landing.touchdown!.sink!)} m/s</td></tr>`,
  )
  .join("");
const trimRows = rows
  .flatMap((r) =>
    r.trims.map(
      (t) =>
        `<tr><td>${r.id}</td><td>${t.loading.fuel} / ${t.loading.payload}</td><td>${t.altitude}</td><td>${f(t.mass)}</td><td>${f(t.cg[2])}</td><td>${f((t.trim.alpha * 180) / Math.PI)}</td><td>${f(t.trim.throttle * 100)}%</td><td>${f(t.drift)} m / ${f(t.speedDrift)} m/s</td></tr>`,
    ),
  )
  .join("");
const images = browser
  ? (
      await Promise.all(
        ids.map(
          async (id) =>
            `<figure><img alt="${id} actual keyboard departure" src="data:image/png;base64,${Buffer.from(await Bun.file(`${root}output/fleet-dynamics-${id}-departure.png`).arrayBuffer()).toString("base64")}"><figcaption>${id} · keyboard departure in the local game</figcaption></figure>`,
        ),
      )
    ).join("")
  : "<p>Browser checks were not included in this run. Use the --browser flag with the local server running.</p>";
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Fleet flight dynamics validation</title><style>body{max-width:1100px;margin:40px auto;padding:0 20px;color:#222;font:16px/1.6 system-ui}h1{font-size:29px}h2{font-size:22px;margin-top:34px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ccc;padding:9px;text-align:left}th{background:#eee}code{overflow-wrap:anywhere}img{width:100%;display:block}figure{margin:20px 0}figcaption{font-size:13px}.tables{overflow:auto}@media(max-width:700px){table{min-width:800px}}</style><h1>Fleet flight dynamics validation</h1><p>12 October 2026 · local implementation · no publication</p><p>All four aircraft now share force-based aerodynamics and rigid-body rotation. The former jet acceleration shortcuts and direct attitude-rate integration were replaced. The beginner controller commands rate-limited control surfaces; it adds no free lift or thrust.</p><h2>Implemented model</h2><ul><li>Measured main-wing area, span and mean chord. Attached-flow lift intercept/slope fit to the private tester’s 96-panel solution at 0° and 4°.</li><li>Declared component budgets for airframe, engines, gear, tail, equipment, payload and fuel. CG is mass-weighted; full cuboid and parallel-axis inertia tensors update with fuel loading.</li><li>ISA density, lift, induced/profile/configuration drag, sideslip, continuous post-stall estimates, estimated stability/damping/control moments, thrust-line moments and CG displacement.</li><li>Rotational equation I·omegaDot = moment − omega×(I·omega), midpoint quaternion integration, and center-of-mass translation with the render datum recovered from CG.</li><li>Bounded shaft-power propeller thrust, estimated installed jet maps, engine spool, fuel use, flap and gear actuation. Ground support moments prevent power-only rotation; touchdown requires deployed gear.</li><li>The same physical actuator positions drive visible flight-control, flap and gear animations. Flight hints use aircraft-specific speeds.</li></ul><h2>Departure and landing checks</h2><p>Sea-level nominal loading, Palm Bay’s existing 660 m runway, default wind, assisted departure and a controlled 20-second approach/stop exercise. Climb inputs remain inside the estimated AOA envelope. Speeds are true airspeeds in knots.</p><div class="tables"><table><tr><th>Aircraft</th><th>Mass kg</th><th>Wing m²</th><th>Clean stall kn</th><th>Installed estimate</th><th>Takeoff time / roll</th><th>Approach / touchdown sink</th></tr>${table}</table></div><p>Aurelia’s conceptual installation is sized at two 25 kN engines against its measured wing, 5.66 t loading and Palm Bay departure. This replaces an undersized initial 38 kN estimate. It is an explicit original-design assumption, not a manufacturer rating. Aircraft-specific pitch limits preserve the default departure’s terrain clearance without changing gravity, weight or airfield geometry.</p><h2>Unassisted trim across loading and density</h2><p>32 conditions: four fuel/payload combinations and two altitudes per aircraft. The trim solver balances longitudinal force and pitch moment within 10⁻⁶ N and N·m. The actual simulation then runs for 20 seconds with assistance disabled and constant zero wind; altitude drift must stay below 1 m and speed drift below 0.2 m/s. Fuel consumption remains enabled.</p><div class="tables"><table><tr><th>Aircraft</th><th>Fuel / payload fraction</th><th>Altitude m</th><th>Mass kg</th><th>CG aft m</th><th>Trim AOA °</th><th>Power</th><th>20 s drift height / speed</th></tr>${trimRows}</table></div><h2>Verification</h2><p>${evidence.tests.pass} tests and ${evidence.tests.assertions.toLocaleString()} assertions passed. Main game and private tester production builds passed. Tests cover mass response, CG limits, tensor inversion, angular momentum/energy, force/control signs, geometric lift fit, trim, actuator limits, fuel, natural stall recovery, runway contact, takeoff, touchdown, and 30/60/120 Hz consistency.</p><p>${browser ? "Four real keyboard departures and four deterministic seeded landings passed in the actual browser game, with zero page/console errors. Rendered gear and control surfaces matched the physical state. The approach checks are seeded simulations, not complete human-flown landing sequences." : "No browser evidence included."}</p>${images}<h2>Model validity</h2><p>These are original concept aircraft with numerically verified behavior. Component densities/envelopes, CLmax/post-stall behavior, viscous drag, tail/stability derivatives, neutral points, engine maps and fuel rates remain engineering estimates. The main-wing vortex solution excludes fuselage, tail interference, viscosity, stall and chamber-wall effects. It is not full-aircraft CFD or measured validation.</p><p>Ground contact for Finch and the two legacy jet rigs remains an approximation; Stormbird uses the authored tire profiles and measured body hull. Tire/structure loads, flutter, detailed swept-volume clearance, icing, transonic/supersonic flow and certification are outside these checks. Estimated drag rise does not validate high-Mach performance. Strong gusts, extreme loading and inverted/post-stall flight require a broader flight-test envelope.</p><h2>Repeatable workflow</h2><p><code>bun scripts/validate-fleet-dynamics.ts --browser</code> runs the test suite, both builds, the live local browser checks and this matrix. Start the game locally on port 5175 first; <code>FLIGHT_CHECK_URL</code> selects another local server. A geometry change that disagrees with the private solver fails the regression rather than silently keeping stale lift curves.</p><h2>References</h2><p><a href="../aircraft/PRINCIPLES_OF_MAKING_PLANES.md">Project aircraft handbook</a>; <a href="https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/lift-equation/">NASA lift equation</a>; <a href="https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-equation/">NASA drag equation</a>; <a href="https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/trimmed-aircraft/">NASA force and torque trim</a>; <a href="https://jsbsim-team.github.io/jsbsim/classJSBSim_1_1FGMassBalance.html">JSBSim mass and inertia conventions</a>.</p></html>`;
await Bun.write(`${root}docs/validation/FLEET_DYNAMICS_VALIDATION.html`, html);
console.log(
  `${rows.length} aircraft, 32 unassisted trim conditions and departure/landing/stall checks passed. Saved docs/FLEET_DYNAMICS_VALIDATION.html.`,
);
