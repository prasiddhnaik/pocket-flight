import { dirname, resolve } from "node:path";

type Stats = { median: number; p95: number; mean: number };
type Result = {
  variant: string;
  view: string;
  samples: number;
  gpuSamples: number;
  drawingBuffer: number[];
  cpuMs: Stats;
  gpuMs: Stats;
  frameIntervalMs: Stats;
  drawCalls: Stats;
  triangles: Stats;
};
const path = resolve(process.argv[2] ?? "output/render-optimization/evidence.json");
const evidence = await Bun.file(path).json() as {
  environment: { gpu: string; userAgent: string; measuredAt: string; terrainMaterialsPatched: number; instancedLightCount: number; instancedLightBatches: number };
  collisionIdentical: boolean;
  errors: string[];
  results: Result[];
};
const variants = ["baseline", "shadow1024", "render85", "terrainLOD", "noShadows", "lightInstances"];
const views = ["forest", "airfield", "overhead", "water"];
const labels: Record<string, string> = {
  baseline: "Current tree LOD baseline",
  shadow1024: "1024 shadow map",
  render85: "85% render resolution",
  terrainLOD: "Terrain detail LOD",
  noShadows: "No shadows (diagnostic)",
  lightInstances: "Instanced runway lights",
  forest: "Low forest", airfield: "Airfield", overhead: "Overhead", water: "Coast and water",
};
if (evidence.results.length !== 72 || evidence.errors.length || !evidence.collisionIdentical || evidence.environment.terrainMaterialsPatched !== 1 || evidence.environment.instancedLightBatches !== 2 || evidence.environment.instancedLightCount !== 52)
  throw new Error("Expected 72 complete trials, one terrain material patched, identical collisions, and no page errors.");
const median = (values: number[]) => [...values].sort((a,b) => a-b)[Math.floor(values.length / 2)];
const summary = views.flatMap(view => variants.map(variant => {
  const rows = evidence.results.filter(row => row.view === view && row.variant === variant);
  if (rows.length !== 3 || rows.some(row => row.samples !== 120 || row.gpuSamples !== 120 || !row.gpuMs))
    throw new Error(`Incomplete CPU/GPU trials: ${view} ${variant}`);
  const expected = variant === "render85" ? [1088,612] : [1280,720];
  if (rows.some(row => JSON.stringify(row.drawingBuffer) !== JSON.stringify(expected))) throw new Error("Unexpected drawing buffer");
  return {
    view, variant,
    cpu: median(rows.map(r => r.cpuMs.median)),
    gpu: median(rows.map(r => r.gpuMs.median)),
    frame: median(rows.map(r => r.frameIntervalMs.median)),
    calls: median(rows.map(r => r.drawCalls.median)),
    triangles: median(rows.map(r => r.triangles.median)),
    cpuTrials: rows.map(r => r.cpuMs.median), gpuTrials: rows.map(r => r.gpuMs.median),
    gpuP95: median(rows.map(r => r.gpuMs.p95)),
  };
}));
const baseline = (view: string) => summary.find(row => row.view === view && row.variant === "baseline")!;
const reduction = (before: number, after: number) => (1 - after / before) * 100;
const averages = variants.slice(1).map(variant => {
  const rows = summary.filter(row => row.variant === variant);
  const gpuChanges = rows.map(row => reduction(baseline(row.view).gpu, row.gpu));
  const cpuChanges = rows.map(row => reduction(baseline(row.view).cpu, row.cpu));
  return {variant, gpuReduction: gpuChanges.reduce((a,b)=>a+b,0)/4, cpuReduction: cpuChanges.reduce((a,b)=>a+b,0)/4,
    gpuMin: Math.min(...gpuChanges), gpuMax: Math.max(...gpuChanges)};
});
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
const ms = (n: number) => n.toFixed(2);
const pct = (n: number) => `${n >= 0 ? "−" : "+"}${Math.abs(n).toFixed(1)}%`;
const aggregateRows = averages.map(row => `<tr><td>${labels[row.variant]}</td><td>${pct(row.gpuReduction)}</td><td>${pct(row.cpuReduction)}</td><td>${pct(row.gpuMin)} to ${pct(row.gpuMax)}</td></tr>`).join("");
const detailRows = summary.map(row => `<tr><td>${labels[row.view]}</td><td>${labels[row.variant]}</td><td>${ms(row.cpu)}</td><td>${ms(row.gpu)}</td><td>${pct(reduction(baseline(row.view).gpu,row.gpu))}</td><td>${ms(row.gpuP95)}</td><td>${row.calls}</td><td>${row.triangles.toLocaleString()}</td><td>${ms(row.frame)}</td></tr>`).join("");
const trialRows = summary.map(row => `<tr><td>${labels[row.view]}</td><td>${labels[row.variant]}</td><td>${row.cpuTrials.map(ms).join(", ")}</td><td>${row.gpuTrials.map(ms).join(", ")}</td></tr>`).join("");
const findings = await Bun.file(resolve(dirname(path),"findings.html")).text();
const images: Record<string, string> = {};
for (const name of [...variants.map(v => `${v}-airfield`), "baseline-overhead", "terrainLOD-overhead"])
  images[name] = `data:image/png;base64,${Buffer.from(await Bun.file(resolve(dirname(path), `${name}.png`)).arrayBuffer()).toString("base64")}`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pocket Flight: other rendering optimizations</title><style>
body{max-width:1200px;margin:32px auto;padding:0 20px 60px;font:16px/1.6 system-ui;color:#222}h1{font-size:28px;line-height:1.3}h2{font-size:21px;margin-top:30px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ccc;padding:8px;text-align:left}th{background:#f3f3f3}.scroll{overflow:auto}.note{border-left:3px solid #666;background:#f5f5f5;padding:12px 18px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:14px}figure{margin:0}img{width:100%;height:auto}pre{white-space:pre-wrap;font-size:13px}code{background:#eee;padding:2px 4px}a{color:#175698}@media(max-width:700px){.pair{grid-template-columns:1fr}}
</style></head><body><h1>Pocket Flight: other rendering optimizations</h1>
<p>Measured ${escape(evidence.environment.measuredAt)}. Local experiments on top of the middle tree LOD and spatial batching.</p>
${findings}
<h2>Comparable rendering work</h2><p>Each number is the median of three trial medians. The overview averages each view’s percentage change with equal weight. Negative changes mean less time; they are not FPS gains. Per-view ranges describe four camera views, not statistical confidence intervals.</p>
<div class="scroll"><table><thead><tr><th>Experiment</th><th>Average GPU time change</th><th>Average CPU time change</th><th>GPU change across views</th></tr></thead><tbody>${aggregateRows}</tbody></table></div>
<h2>What each experiment changes</h2><ul>
<li><strong>1024 shadow map:</strong> 1024² instead of 2048² texels (75% fewer). World coverage, shadow filtering and casters stay the same. The shadow edges can lose definition.</li>
<li><strong>85% render resolution:</strong> 1088 × 612 instead of 1280 × 720, retaining the same camera and CSS display size. This draws 27.75% fewer pixels and makes the entire 3D image softer. A game implementation could keep HTML HUD text at native resolution, but this benchmark does not measure that integration.</li>
<li><strong>Terrain detail LOD:</strong> keeps terrain geometry, broad patches, color, roads and strata. Fine grit fades between 0.4 and 2 world units per pixel; the fine noise and bump noise are skipped beyond 2 units per pixel. It tests shader work reduction where detail is subpixel. This modifies appearance and needs further motion/device validation.</li>
<li><strong>Instanced runway lights:</strong> groups identical runway bulbs into one instanced mesh per airfield, preserving transforms, material and shadow flags. Culling uses each entire runway batch, so submitted triangles can increase even as calls fall.</li>
<li><strong>No shadows:</strong> disables shadow rendering and receiving. This is a diagnostic upper bound on the cost of the current shadow system. It removes visible grounding and is not a proposed default.</li>
</ul>
<h2>Per-view timings and submitted geometry</h2><div class="scroll"><table><thead><tr><th>View</th><th>Experiment</th><th>CPU ms</th><th>GPU ms</th><th>GPU change</th><th>GPU p95 ms</th><th>Draw calls</th><th>Triangles including shadows</th><th>Frame interval ms</th></tr></thead><tbody>${detailRows}</tbody></table></div>
<h2>Visual evidence</h2><p>Captured directly from the same browser renderer at fixed noon and matched camera poses. Resolution screenshots have different native pixel dimensions and are displayed at equal widths here.</p>
${variants.map(variant => `<figure><figcaption>${labels[variant]} — airfield</figcaption><a href="${variant}-airfield.png"><img src="${images[`${variant}-airfield`]}" alt="${labels[variant]} at the airfield" loading="lazy"></a></figure>`).join("")}
<div class="pair"><figure><figcaption>Baseline — overhead</figcaption><img src="${images["baseline-overhead"]}" alt="Baseline overhead" loading="lazy"></figure><figure><figcaption>Terrain detail LOD — overhead</figcaption><img src="${images["terrainLOD-overhead"]}" alt="Terrain shader LOD overhead" loading="lazy"></figure></div>
<h2>Method and limits</h2><ul>
<li>72 trials: six variants × four static views × three rounds. Each trial has 60 warmup frames, 120 measured frames and 20 drain frames: 8,640 measured frames total. Variant order rotates between rounds and reverses on the middle round.</li>
<li>CPU: world.update plus renderer.render submission. GPU: EXT_disjoint_timer_query_webgl2 with disjoint results discarded. All 8,640 timing queries completed. CPU and GPU work overlap, so their times should not be added.</li>
<li>Fixed camera, noon lighting, deterministic object placement and reset cloud drift. Both independently loaded worlds have identical collision obstacles. Fine-noise patch verified on exactly one terrain material. Triangles and draw calls include the shadow pass.</li>
<li>Scenery-only renderer: aircraft, physics, input, audio, HUD and React work are excluded. This is not a full-game FPS benchmark, sustained thermal test, mobile test or production deployment. Browser frame intervals are affected by scheduling and display refresh.</li>
<li>Baseline uses PCFSoft shadows, ACES tone mapping, exposure 1.14, antialiasing and logarithmic depth. 1280 × 720 at DPR 1 deliberately controls pixel count; the game can use a higher device pixel ratio.</li>
<li>One Apple M3/browser configuration; results may change on other GPUs and browsers. Three short repeats characterize local variation but do not establish statistical significance.</li></ul>
<h2>Evidence and reproduction</h2><p><a href="evidence.json">Raw trials and per-frame samples</a> · <a href="summary.json">Machine-readable summary</a> · <a href="verification.txt">Verification log</a> · <a href="source-manifest.json">Source fingerprints</a></p>
<p>Run <code>bun run dev -- --port 5279 --strictPort</code>, open <code>/scripts/render-optimization-benchmark.html</code>, and click “Compare three balanced rounds”. Save the benchmark evidence to <code>output/render-optimization/evidence.json</code>, then run <code>bun scripts/report-render-optimization.ts</code>.</p>
<h2>Workspace boundary</h2><p>The initial prototype run was discarded after its large per-frame JSON display interfered with browser inspection. The final run renders compact summaries and saves full samples only in evidence downloads. The checkout already contains extensive unrelated modifications and relocated untracked files. This experiment adds a separate benchmark and report generator. It leaves production rendering settings, physics, aircraft and the earlier tree LOD implementation unchanged. It does not commit or deploy.</p>
<details><summary>Individual trial medians</summary><div class="scroll"><table><thead><tr><th>View</th><th>Experiment</th><th>CPU trial medians ms</th><th>GPU trial medians ms</th></tr></thead><tbody>${trialRows}</tbody></table></div></details>
<details><summary>Environment</summary><pre>${escape(JSON.stringify(evidence.environment,null,2))}</pre></details>
</body></html>`;
await Bun.write(resolve(dirname(path),"summary.json"),JSON.stringify({averages,views:summary},null,2));
await Bun.write(resolve(dirname(path),"report.html"),html);
console.log(JSON.stringify({averages,report:resolve(dirname(path),"report.html")},null,2));
