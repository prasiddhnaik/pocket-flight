import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const runId =
  process.argv[2] ??
  (await Bun.file(`${repo}output/full-game-uncapped/current-run.json`).json())
    .runId;
if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error("Invalid run id");
const directory = `${repo}output/full-game-uncapped/${runId}`;
type Stats = { mean: number; median: number; p95: number; p99: number };
type Trial = {
  variant: string;
  scenario: string;
  round: number;
  fps: number;
  onePercentLowFps: number;
  frameMs: Stats;
  physicsStepMs: Stats;
  renderCpuMs: Stats;
  gpuMs: Stats | null;
  calls: Stats;
  hiddenFrames: number;
  invalidFrames: number;
  hudVisible: boolean;
  aircraftVisible: boolean;
};
type Control = {
  blankMedianFps: number;
  animatedDom: { fps: number };
  webgl: { fps: number };
  gpu: string;
  hardware: boolean;
};
type Evidence = {
  results: Trial[];
  errors: string[];
  browserErrors: string[];
  changedSources: string[];
  uncapped: boolean;
  controlHeadroom: number;
  browserControl: Control;
  browserControlAfter: Control;
  environment: {
    measuredAt: string;
    measurementMs: number;
    warmupMs: number;
    gameDpr: number;
    devicePixelRatio: number;
    gpu: string;
    variants: string[];
  };
};
const collision: Evidence = await Bun.file(
  `${directory}/collision/full-game.json`,
).json();
const render: Evidence = await Bun.file(
  `${directory}/render/full-game.json`,
).json();
for (const [name, evidence, expected] of [
  ["collision", collision, 12],
  ["render", render, 36],
] as const) {
  if (
    !evidence.uncapped ||
    evidence.results.length !== expected ||
    evidence.errors.length ||
    evidence.browserErrors.length ||
    evidence.changedSources.length ||
    evidence.controlHeadroom < 1.5 ||
    evidence.results.some(
      (t) =>
        t.hiddenFrames ||
        t.invalidFrames ||
        !t.hudVisible ||
        !t.aircraftVisible,
    )
  )
    throw new Error(`Invalid ${name} evidence`);
}
const median = (values: number[]) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
const fixed = (value: number) => value.toFixed(2);
const percent = (value: number) => `${value >= 0 ? "+" : ""}${fixed(value)}%`;
const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const scenarios = ["airfield", "forest"] as const;
const labels: Record<string, string> = {
  baseline: "Baseline",
  spatialIndex: "Spatial collision grid",
  shadow1024: "1024 shadow map",
  render85: "85% render resolution",
  terrainLOD: "Terrain detail LOD",
  lightInstances: "Instanced runway lights",
  noShadows: "No shadows (diagnostic)",
};
const costs: Record<string, string> = {
  baseline: "Current graphics",
  shadow1024: "Lower shadow resolution",
  render85: "27.75% fewer rendered pixels",
  terrainLOD: "Changes distant terrain detail",
  lightInstances: "Same light geometry and materials",
  noShadows: "Removes shadows",
};
function compare(evidence: Evidence, scenario: string, variant: string) {
  const rows = evidence.results.filter(
    (t) => t.scenario === scenario && t.variant === variant,
  );
  const baseline = evidence.results.filter(
    (t) => t.scenario === scenario && t.variant === "baseline",
  );
  if (rows.length !== baseline.length || !rows.length)
    throw new Error(`Missing comparison ${scenario}/${variant}`);
  const fps = median(rows.map((t) => t.fps)),
    low = median(rows.map((t) => t.onePercentLowFps));
  const medianFpsChange = (fps / median(baseline.map((t) => t.fps)) - 1) * 100;
  const roundGains = rows.map(
    (t) => (t.fps / baseline.find((b) => b.round === t.round)!.fps - 1) * 100,
  );
  const gain = median(roundGains);
  const lowGain = median(rows.map(t => (t.onePercentLowFps / baseline.find(b => b.round === t.round)!.onePercentLowFps - 1) * 100));
  return {
    scenario,
    variant,
    fps,
    low,
    gain,
    medianFpsChange,
    lowGain,
    roundGains,
    positiveRounds: roundGains.filter((g) => g > 0).length,
    rounds: rows.length,
    physicsMs: median(rows.map((t) => t.physicsStepMs.mean)),
    renderCpuMs: median(rows.map((t) => t.renderCpuMs.mean)),
    gpuMs: median(rows.map((t) => t.gpuMs?.mean ?? NaN)),
    calls: median(rows.map((t) => t.calls.mean)),
    qualifies: gain >= 5 && roundGains.every((g) => g > 0) && lowGain >= -5,
  };
}
const collisionSummary = scenarios.map((s) => ({
  baseline: compare(collision, s, "baseline"),
  after: compare(collision, s, "spatialIndex"),
}));
const renderSummary = render.environment.variants.map((variant) => ({
  variant,
  views: scenarios.map((s) => compare(render, s, variant)),
}));
const candidates = scenarios.map((scenario) => ({
  scenario,
  candidates: renderSummary
    .filter((r) => r.variant !== "noShadows" && r.variant !== "baseline")
    .map((r) => r.views.find((v) => v.scenario === scenario)!)
    .filter((r) => r.qualifies)
    .sort((a, b) => b.gain - a.gain),
}));
const confirmationFile = Bun.file(`${directory}/confirmation-render85/full-game.json`);
const confirmation: Evidence | null = await confirmationFile.exists() ? await confirmationFile.json() : null;
if (confirmation && (confirmation.results.length !== 12 || confirmation.errors.length || confirmation.browserErrors.length
  || confirmation.changedSources.length || !confirmation.browserControlAfter || confirmation.controlHeadroom < 1.5
  || confirmation.results.some(t => t.hiddenFrames || t.invalidFrames || !t.hudVisible || !t.aircraftVisible)))
  throw new Error("Invalid confirmation evidence");
const confirmationSummary = confirmation ? scenarios.map(s => ({baseline:compare(confirmation,s,"baseline"),after:compare(confirmation,s,"render85")})) : [];
const summary = {
  runId,
  collision: collisionSummary,
  render: renderSummary,
  candidates,
  confirmation: confirmationSummary,
};
await Bun.write(`${directory}/summary.json`, JSON.stringify(summary, null, 2));
const imageData = async (name: string) =>
  `data:image/png;base64,${Buffer.from(await Bun.file(`${directory}/collision/${name}.png`).arrayBuffer()).toString("base64")}`;
const images = await Promise.all(scenarios.map(imageData));
const date = new Date(render.environment.measuredAt).toLocaleString("en-GB", {
  timeZone: "Asia/Calcutta",
});
const sharedUnchanged =
  (await Bun.file(`${directory}/shared-browser-config-before.json`).text()) ===
  (await Bun.file(`${repo}.playwright/cli.config.json`).text());
const controls = (
  [
    ["Collision before", collision.browserControl],
    ["Collision after", collision.browserControlAfter],
    ["Rendering before", render.browserControl],
    ["Rendering after", render.browserControlAfter],
  ] as const
)
  .map(
    ([name, c]) =>
      `<tr><td>${name}</td><td>${fixed(c.blankMedianFps)}</td><td>${fixed(c.animatedDom.fps)}</td><td>${fixed(c.webgl.fps)}</td><td>${escape(c.gpu)}</td></tr>`,
  )
  .join("");
const winners = candidates
  .map(
    ({ scenario, candidates }) =>
      `<li><strong>${scenario}:</strong> ${candidates.length ? candidates.map((c) => `${labels[c.variant]} (${percent(c.gain)} FPS; ${c.positiveRounds}/${c.rounds} positive rounds)`).join("; ") : "No variant passed the initial repeatability criteria."}</li>`,
  )
  .join("");
const confirmationSection = confirmation ? `<h2>Longer confirmation: 85% resolution</h2><p>Three alternating baseline/85% pairs in each view, using 2-second warmup and 10-second measurement. Every trial keeps the same real game and initial flight path. Percentages are medians of the matching pair gains.</p><div class="scroll"><table><tr><th>View</th><th>Baseline median FPS</th><th>85% median FPS</th><th>Median paired gain</th><th>Paired gain range</th><th>Positive pairs</th><th>p99 low-FPS paired gain</th></tr>${confirmationSummary.map(({baseline:b,after:a}) => `<tr><td>${a.scenario}</td><td>${fixed(b.fps)}</td><td>${fixed(a.fps)}</td><td>${percent(a.gain)}</td><td>${percent(Math.min(...a.roundGains))} to ${percent(Math.max(...a.roundGains))}</td><td>${a.positiveRounds}/${a.rounds}</td><td>${percent(a.lowGain)}</td></tr>`).join("")}</table></div><p>Tradeoff: 85% width and height means 27.75% fewer rendered pixels. The cockpit/HUD layout remains at the same CSS size. <a href="confirmation-render85/full-game.json">Raw confirmation evidence</a>. Hardware WebGL controls provided ${fixed(confirmation.controlHeadroom)}× headroom above the fastest confirmation trial.</p>` : "";
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Uncapped Pocket Flight benchmark</title>
<style>body{max-width:1180px;margin:36px auto;padding:0 20px;color:#222;font:16px/1.55 system-ui}h1,h2{line-height:1.2}h2{margin-top:32px}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #ccc;padding:9px;text-align:left;vertical-align:top}th{background:#f2f2f2}code{background:#f2f2f2;padding:2px 4px}img{max-width:100%;border:1px solid #ccc}li{margin:8px 0}.muted{color:#555}</style></head><body>
<h1>Uncapped Pocket Flight benchmark</h1><p>${escape(date)} IST · Run ${escape(runId)} · ${48 + (confirmation?.results.length ?? 0)} valid full-game trials</p>
<h2>What changed in the test browser</h2><p>A dedicated Chromium configuration adds <code>--disable-frame-rate-limit</code> and retains Metal hardware rendering. The shared browser configuration is ${sharedUnchanged ? "unchanged" : "different from the saved pre-run copy"}. Chromium documents this switch as disabling scheduler frame limits and also implying GPU-vsync disabling: <a href="https://chromium.googlesource.com/chromium/src/+/HEAD/components/viz/common/switches.cc">primary source</a>.</p>
<p>The blank page can be paced differently when it causes no drawing. Active DOM and WebGL controls verify rendering headroom; both must exceed 90 FPS before trials start. The real forest flight smoke test also exceeded the old 30 FPS ceiling.</p>
<div class="scroll"><table><tr><th>Control</th><th>Blank median FPS</th><th>Animated DOM FPS</th><th>WebGL FPS</th><th>Renderer</th></tr>${controls}</table></div><p>WebGL control headroom above the fastest measured game trial: ${fixed(collision.controlHeadroom)}× for collision and ${fixed(render.controlHeadroom)}× for rendering.</p>
${confirmationSection}
<h2>Initial rendering candidates</h2><p>A candidate requires at least 5% median FPS gain, a positive gain in every initial paired round and no more than 5% regression in the p99-based low FPS. No shadows is a diagnostic and is excluded from candidates.</p><ul>${winners}</ul>
<h2>Initial rendering FPS</h2><p>FPS values are medians of trial averages. Percentage gains below compare matching baseline/variant rounds, then take the median. Baseline drift means these paired percentages can differ from a ratio of the displayed FPS medians.</p><div class="scroll"><table><tr><th>Variant</th><th>Airfield median FPS / paired gain</th><th>Forest median FPS / paired gain</th><th>Airfield positive rounds</th><th>Forest positive rounds</th><th>Visual effect</th></tr>${renderSummary.map((r) => `<tr><td>${labels[r.variant]}</td>${r.views.map((v) => `<td>${fixed(v.fps)} / ${percent(v.gain)}</td>`).join("")}${r.views.map((v) => `<td>${v.positiveRounds}/${v.rounds}</td>`).join("")}<td>${costs[r.variant]}</td></tr>`).join("")}</table></div>
<h2>Frame consistency and rendering cost</h2><div class="scroll"><table><tr><th>Variant / view</th><th>p99-based low FPS</th><th>Render CPU ms</th><th>GPU query ms</th><th>Draw calls</th></tr>${renderSummary.flatMap((r) => r.views.map((v) => `<tr><td>${labels[r.variant]} / ${v.scenario}</td><td>${fixed(v.low)} (${percent(v.lowGain)})</td><td>${fixed(v.renderCpuMs)}</td><td>${fixed(v.gpuMs)}</td><td>${fixed(v.calls)}</td></tr>`)).join("")}</table></div>
<h2>Collision grid</h2><div class="scroll"><table><tr><th>View</th><th>FPS: exhaustive → grid</th><th>Physics CPU ms: exhaustive → grid</th><th>CPU reduction</th><th>Positive FPS rounds</th></tr>${collisionSummary.map(({ baseline: b, after: a }) => `<tr><td>${a.scenario}</td><td>${fixed(b.fps)} → ${fixed(a.fps)} (${percent(a.gain)})</td><td>${fixed(b.physicsMs)} → ${fixed(a.physicsMs)}</td><td>${fixed((1 - a.physicsMs / b.physicsMs) * 100)}%</td><td>${a.positiveRounds}/${a.rounds}</td></tr>`).join("")}</table></div>
<h2>Method and limits</h2><p>Actual App, Finch, active fixed-step physics, React HUD, VFX, replay recording and muted audio pipeline. Three alternating or rotating rounds. Airfield: 1280 × 720 CSS pixels; forest: 1920 × 1080. Device pixel ratio ${render.environment.devicePixelRatio}; baseline game pixel ratio ${render.environment.gameDpr}. ${render.environment.warmupMs / 1000}-second warmup, ${render.environment.measurementMs / 1000}-second measurement and 0.5-second GPU drain per trial.</p>
<p>Tables use medians of the trial averages. Paired gains compare matching round and scenario. The low-FPS statistic is 1000 divided by the 99th-percentile frame interval. GPU query duration is retained as a diagnostic. These are uncapped throughput measurements of the local development build on this Mac, with other host activity possible. They do not establish mobile performance or a universal FPS improvement.</p>
<p>Both datasets have complete coverage, visible aircraft/HUD, advancing physics and HUD updates, zero hidden/invalid frames, zero browser errors/warnings and stable measured source hashes. Controls passed before and after each comparison. Engine correctness and graphics defaults were not changed for this run.</p>
<h2>Evidence and workflow</h2><ul><li><a href="collision/full-game.json">12-trial collision evidence</a> · <a href="collision/control-before.json">before control</a> · <a href="collision/control-after.json">after control</a></li><li><a href="render/full-game.json">36-trial rendering evidence</a> · <a href="render/control-before.json">before control</a> · <a href="render/control-after.json">after control</a></li><li><a href="summary.json">Summary JSON</a> · <a href="../../../docs/planning/2026-10-24-uncapped-full-game-benchmark.html">Plan prepared before implementation</a></li></ul>
<p>Repeat with <code>bun run engine:uncapped --run-id=&lt;new-id&gt;</code>, then <code>bun run engine:render-uncapped --run-id=&lt;same-id&gt;</code>. Generate this report with <code>bun scripts/report-uncapped-benchmark.ts &lt;id&gt;</code>. A fresh id preserves prior evidence.</p>
<h2>Visual verification</h2><p>Captured full-game flights after the collision measurements.</p><img src="${images[0]}" alt="Airfield flight and HUD"><img src="${images[1]}" alt="Forest flight and HUD"></body></html>`;
await Bun.write(`${directory}/report.html`, html);
console.log(
  JSON.stringify(
    { runId, report: `${directory}/report.html`, candidates },
    null,
    2,
  ),
);
