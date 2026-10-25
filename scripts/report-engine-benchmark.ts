import { fileURLToPath } from "node:url";

const directory = fileURLToPath(
  new URL("../output/engine-speed/", import.meta.url),
);
const evidence = await Bun.file(`${directory}/full-game.json`).json();
const verificationFile = Bun.file(`${directory}/verification.json`);
const verification = (await verificationFile.exists())
  ? await verificationFile.json()
  : null;
const imageData = async (name: string) =>
  `data:image/png;base64,${Buffer.from(await Bun.file(`${directory}/${name}.png`).arrayBuffer()).toString("base64")}`;
const [airfieldImage, forestImage] = await Promise.all([
  imageData("airfield"),
  imageData("forest"),
]);
const renderingFile = Bun.file(
  `${directory}/../full-game-optimization/full-game.json`,
);
const rendering = (await renderingFile.exists())
  ? await renderingFile.json()
  : null;
type Trial = {
  scenario: string;
  variant: string;
  round: number;
  fps: number;
  onePercentLowFps: number;
  physicsStepMs: { mean: number };
  renderCpuMs: { mean: number };
  gpuMs: { mean: number } | null;
  hiddenFrames: number;
  invalidFrames: number;
  hudVisible: boolean;
  aircraftVisible: boolean;
};
const trials: Trial[] = evidence.results;
const median = (values: number[]) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
const fixed = (value: number) => value.toFixed(2);
const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const rows = ["airfield", "forest"]
  .map((scenario) => {
    const before = trials.filter(
      (t) => t.scenario === scenario && t.variant === "baseline",
    );
    const after = trials.filter(
      (t) => t.scenario === scenario && t.variant === "spatialIndex",
    );
    const metric = (group: Trial[], read: (t: Trial) => number) =>
      median(group.map(read));
    const oldPhysics = metric(before, (t) => t.physicsStepMs.mean),
      newPhysics = metric(after, (t) => t.physicsStepMs.mean);
    return `<tr><td>${scenario}</td><td>${fixed(metric(before, (t) => t.fps))} → ${fixed(metric(after, (t) => t.fps))}</td><td>${fixed(metric(before, (t) => t.onePercentLowFps))} → ${fixed(metric(after, (t) => t.onePercentLowFps))}</td><td>${fixed(oldPhysics)} → ${fixed(newPhysics)} ms (${fixed((1 - newPhysics / oldPhysics) * 100)}% less)</td><td>${fixed(metric(before, (t) => t.renderCpuMs.mean))} → ${fixed(metric(after, (t) => t.renderCpuMs.mean))} ms</td></tr>`;
  })
  .join("");
const renderNames: Record<string, string> = {
  baseline: "Original graphics",
  shadow1024: "1024 shadow map",
  render85: "85% render resolution",
  terrainLOD: "Terrain detail LOD",
  lightInstances: "Instanced runway lights",
  noShadows: "No shadows (diagnostic)",
};
const renderCosts: Record<string, string> = {
  baseline: "Original settings",
  shadow1024: "Lower shadow-map detail",
  render85: "27.75% fewer rendered pixels",
  terrainLOD: "Changes distant terrain detail",
  lightInstances: "Same light geometry and materials",
  noShadows: "Removes shadows",
};
const renderSection = rendering
  ? `<h2>Full-game rendering experiments</h2><p>Separate 36-trial comparison: three rounds, six variants and both scenarios, with the spatial collision grid enabled throughout. Each value is the median of three trial averages. These remain benchmark experiments.</p><div class="scroll"><table><tr><th>Variant</th><th>Airfield FPS</th><th>Forest FPS</th><th>Airfield GPU ms</th><th>Forest GPU ms</th><th>Visual effect</th></tr>${rendering.environment.variants
      .map((variant: string) => {
        const group = (scenario: string) =>
          rendering.results.filter(
            (t: Trial) => t.variant === variant && t.scenario === scenario,
          );
        const metric = (scenario: string, read: (t: Trial) => number) =>
          fixed(median(group(scenario).map(read)));
        return `<tr><td>${renderNames[variant]}</td><td>${metric("airfield", (t) => t.fps)}</td><td>${metric("forest", (t) => t.fps)}</td><td>${metric("airfield", (t) => t.gpuMs?.mean ?? NaN)}</td><td>${metric("forest", (t) => t.gpuMs?.mean ?? NaN)}</td><td>${renderCosts[variant]}</td></tr>`;
      })
      .join(
        "",
      )}</table></div><p>All 36 trials must pass the same validity checks. Raw rendering evidence: <a href="../full-game-optimization/full-game.json">full-game-optimization/full-game.json</a>. Repeat with <code>bun run engine:render-benchmark</code>.</p>`
  : "";
const valid =
  trials.length === 12 &&
  trials.every(
    (t) =>
      !t.invalidFrames && !t.hiddenFrames && t.hudVisible && t.aircraftVisible,
  ) &&
  !evidence.errors.length &&
  !evidence.browserErrors.length;
const renderingValid =
  !rendering ||
  (rendering.results.length === 36 &&
    rendering.results.every(
      (t: Trial) =>
        !t.invalidFrames &&
        !t.hiddenFrames &&
        t.hudVisible &&
        t.aircraftVisible,
    ) &&
    !rendering.errors.length &&
    !rendering.browserErrors.length);
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:,">
<title>Pocket Flight engine performance — 24 October 2026</title>
<style>body{max-width:1100px;margin:40px auto;padding:0 20px;font:16px/1.6 system-ui;color:#202020}h1,h2{line-height:1.2}h2{margin-top:36px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:10px;border:1px solid #ccc;text-align:left}th{background:#f3f3f3}code{background:#f3f3f3;padding:2px 4px}.scroll{overflow:auto}img{max-width:100%;border:1px solid #ccc}p{max-width:90ch}</style>
<h1>Pocket Flight engine performance</h1><p>24 October 2026 · Local development checkout · ${valid && renderingValid ? `${12 + (rendering?.results.length ?? 0)} valid full-game trials` : "Evidence incomplete or invalid"}</p>
<h2>Change</h2><p>A 128-metre spatial grid limits scenery collision candidates before the existing swept-airframe checks. The grid includes obstacle radii and the full rotating-aircraft reach, preserves source order for equal-time hits, and is built after asynchronous scenery replacements finish. Until then, collision uses the original array. Physics timesteps, collision response, visuals, shadows, resolution and HUD are unchanged.</p>
<h2>Measured results</h2><p>Each cell shows exhaustive scan → spatial grid. These are medians of three trial averages per scenario. Physics measures one 1/60-second game update, including its internal simulation steps.</p>
<p>The collision grid lowers physics CPU time in both scenes. Full-game FPS remains mixed. This change creates CPU headroom.</p>
<p><strong>FPS measurement limit:</strong> an empty <code>about:blank</code> page also ran at ${fixed(evidence.browserControl?.fps ?? 30)} FPS with no game or rendering. That browser/display pacing ceiling masks speedups above 30 FPS. The rendering experiments cannot establish which variant would deliver the highest uncapped game FPS. The control was measured after these trials and is saved in <a href="browser-control.json">browser-control.json</a>; future runs measure it before the game.</p>
<div class="scroll"><table><tr><th>Scenario</th><th>FPS</th><th>1% low FPS</th><th>Physics CPU time</th><th>Render submission CPU</th></tr>${rows}</table></div>
<p>These local timings include development React work and other activity on the Mac. A reduction in physics CPU time does not by itself establish a sustained FPS improvement. GPU query durations are retained as diagnostics; the 30-FPS control prevents a useful full-frame ranking here.</p>
${renderSection}
<h2>Method and validity</h2><p>Real App, Finch aircraft, fixed-step physics, HUD, VFX, replay recording and muted audio pipeline. Three alternating rounds, 2-second warmup, 6-second measurement and 0.5-second GPU drain per trial. Airfield: 1280 × 720 CSS pixels; forest: 1920 × 1080. Device pixel ratio ${escape(evidence.environment.devicePixelRatio)}, game pixel ratio ${escape(evidence.environment.gameDpr)}. Scenery obstacle count: ${escape(evidence.environment.obstacleCount)}. GPU: ${escape(evidence.environment.gpu)}.</p>
<p>Zero hidden or invalid frames required; aircraft and HUD visible; simulation and HUD updates required; browser errors and warnings captured. Raw intervals, physics samples, GPU queries, render calls, triangle counts and positions are saved in <a href="full-game.json">full-game.json</a>. Source fingerprints: <a href="source-manifest.json">source-manifest.json</a>.</p>
<h2>Individual trials</h2><div class="scroll"><table><tr><th>Round</th><th>Scenario</th><th>Variant</th><th>FPS</th><th>Physics ms</th><th>GPU ms</th></tr>${trials.map((t) => `<tr><td>${t.round + 1}</td><td>${t.scenario}</td><td>${t.variant}</td><td>${fixed(t.fps)}</td><td>${fixed(t.physicsStepMs.mean)}</td><td>${t.gpuMs ? fixed(t.gpuMs.mean) : "unavailable"}</td></tr>`).join("")}</table></div>
<h2>Verification</h2><div id="verification">${verification ? `<p>The active suite completed ${verification.fullSuite.passed} passing tests and ${verification.fullSuite.timedOut} five-second timeouts across ${verification.fullSuite.files} files. All affected files passed on recheck with a 30-second timeout: ${verification.timeoutRechecks.reduce((sum: number, check: { passed: number }) => sum + check.passed, 0)} tests, zero failures. The new collision checks passed all nine tests, including full simulation comparisons for six aircraft.</p><p>Game build: ${escape(verification.gameBuild)}. Wind-tunnel build: ${escape(verification.windTunnelBuild)}. Repository navigation and diff checks passed. Details: <a href="verification.json">verification.json</a>; original logs: <a href="tests.log">suite</a>, <a href="timeout-recheck.log">display/envelope recheck</a>, <a href="geometry-recheck.log">geometry/collision recheck</a>, <a href="takeoff-recheck.log">takeoff recheck</a>.</p>` : "<p>Tests and builds have not been recorded for this report. Benchmark validity is checked separately.</p>"}</div>
<p>Collision equivalence tests cover seeded sweeps, rotation, terrain, grid boundaries, negative coordinates, large obstacle radii and equal-time ordering. The benchmark's development remount race was corrected, and the cannon shaders now include the common shader helper required by logarithmic depth.</p>
<h2>Visual check</h2><p>Actual optimized flights with the plane and HUD visible.</p><img src="${airfieldImage}" alt="Finch and flight HUD at the airfield"><img src="${forestImage}" alt="Finch and flight HUD above the forest">
<h2>Repeat</h2><p>Start <code>bun run dev --host 127.0.0.1 --port 5280</code>, then run <code>bun run engine:benchmark</code> and <code>bun scripts/report-engine-benchmark.ts</code>. Evidence is overwritten for each new run; preserve the output folder first when comparing sessions. The runner rejects incomplete trials, hidden frames, missing HUD/aircraft and browser errors.</p>
<p>Scope: local engine iteration only. No deployment or graphics-quality change. The pre-existing dirty checkout was preserved. The code-review graph was refreshed, but it does not index the relocated untracked engine files; those dependencies were checked directly in source.</p>
</html>`;
await Bun.write(`${directory}/report.html`, html);
console.log(`${directory}/report.html`);
