import { resolve, dirname } from "node:path";

type Stats = { median: number; p95: number; mean: number };
type Result = {
  variant: "baseline" | "optimized";
  view: string;
  samples: number;
  gpuSamples: number;
  cpuMs: Stats;
  gpuMs: Stats | null;
  frameIntervalMs: Stats;
  drawCalls: Stats;
  triangles: Stats;
};
const path = resolve(process.argv[2] ?? "output/tree-lod/evidence.json");
const evidence = (await Bun.file(path).json()) as {
  environment: Record<string, unknown>;
  collisionIdentical: boolean;
  errors: string[];
  results: Result[];
};
if (
  evidence.results.length !== 24 ||
  evidence.errors.length ||
  !evidence.collisionIdentical
)
  throw new Error(
    "Expected 24 successful measurements and identical collision obstacles.",
  );
const median = (values: number[]) =>
  values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summarize = (view: string, variant: Result["variant"]) => {
  const rows = evidence.results.filter(
    (result) => result.view === view && result.variant === variant,
  );
  if (rows.length !== 3 || rows.some((row) => row.samples !== 180))
    throw new Error(`Incomplete measurements: ${variant} ${view}`);
  return {
    cpuMs: median(rows.map((row) => row.cpuMs.median)),
    gpuMs: rows.every((row) => row.gpuMs)
      ? median(rows.map((row) => row.gpuMs!.median))
      : null,
    frameIntervalMs: median(rows.map((row) => row.frameIntervalMs.median)),
    triangles: median(rows.map((row) => row.triangles.median)),
    drawCalls: median(rows.map((row) => row.drawCalls.median)),
    cpuTrials: rows.map((row) => row.cpuMs.median),
    gpuTrials: rows.map((row) => row.gpuMs?.median ?? null),
  };
};
const labels: Record<string, string> = {
  forest: "Low forest",
  treetops: "Treetops",
  overhead: "Overhead",
  approach: "Moving forest approach",
};
const summary = Object.entries(labels).map(([view, label]) => ({
  view,
  label,
  before: summarize(view, "baseline"),
  after: summarize(view, "optimized"),
}));
const change = (before: number, after: number) =>
  `${Math.abs((1 - after / before) * 100).toFixed(1)}% ${after < before ? "less" : after > before ? "more" : "change"}`;
const ms = (value: number | null) =>
  value === null ? "unavailable" : value.toFixed(2);
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
const timingRows = summary
  .map(
    ({ label, before, after }) =>
      `<tr><td>${label}</td><td>${ms(before.cpuMs)} → ${ms(after.cpuMs)}</td><td>${change(before.cpuMs, after.cpuMs)}</td><td>${ms(before.gpuMs)} → ${ms(after.gpuMs)}</td><td>${before.gpuMs && after.gpuMs ? change(before.gpuMs, after.gpuMs) : "—"}</td><td>${ms(before.frameIntervalMs)} → ${ms(after.frameIntervalMs)}</td></tr>`,
  )
  .join("");
const geometryRows = summary
  .map(
    ({ label, before, after }) =>
      `<tr><td>${label}</td><td>${before.triangles.toLocaleString()} → ${after.triangles.toLocaleString()}</td><td>${change(before.triangles, after.triangles)}</td><td>${before.drawCalls} → ${after.drawCalls}</td></tr>`,
  )
  .join("");
const trialRows = summary
  .map(
    ({ label, before, after }) =>
      `<tr><td>${label}</td><td>${before.cpuTrials.map(ms).join(", ")}</td><td>${after.cpuTrials.map(ms).join(", ")}</td><td>${before.gpuTrials.map(ms).join(", ")}</td><td>${after.gpuTrials.map(ms).join(", ")}</td></tr>`,
  )
  .join("");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pocket Flight tree LOD performance results</title><style>body{max-width:1100px;margin:36px auto;padding:0 20px 60px;font:16px/1.6 system-ui;color:#222}h1{font-size:29px;line-height:1.3}h2{font-size:21px;margin-top:32px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #ccc;padding:10px;text-align:left}th{background:#f4f4f4}.scroll{overflow:auto}.note{background:#f5f5f5;border-left:3px solid #555;padding:12px 18px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:14px}figure{margin:0}img{width:100%;height:auto}pre{white-space:pre-wrap;font-size:13px}a{color:#175698}code{background:#eee;padding:2px 4px}li{margin:8px 0}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style></head><body>
<h1>Pocket Flight: middle tree LOD and spatial batching</h1>
<p>Measured 21 October 2026. Local implementation; no deployment. The timings below are from a controlled scenery-rendering benchmark on this machine.</p>
<p><strong>Outcome:</strong> CPU frame work decreased in ${summary.filter(({ before, after }) => after.cpuMs < before.cpuMs).length} of four views. The low forest view submits ${change(summary[0].before.triangles, summary[0].after.triangles)} geometry. GPU timing changes are mixed; all four views remain approximately 60 FPS in both variants. This does not establish an overall game FPS increase.</p>
<p class="note"><strong>Scope:</strong> This measures the island renderer with game-equivalent rendering settings. It excludes the aircraft, flight physics and HUD, so these percentages are not a promise of the same improvement in complete-game FPS.</p>
<h2>What changed</h2><ul>
<li>Added a middle tree model with 15,288 triangles, versus 31,295 in the near tree and four in the distant model. It reuses the near model's materials and textures. The additional GLB is about 974 KiB and contains no duplicate images.</li>
<li>Kept the far switch at 45 world units from each existing 50-unit cell's center, with the middle tier starting at 24. Near/middle switching has hysteresis. Camera zoom is included consistently in the distant-canopy shader.</li>
<li>Split the distant forest into 1,024-unit spatial batches so ordinary frustum culling can reject portions of the forest. A finer 512-unit experiment added more draw calls and was replaced with this coarser split.</li>
<li>Cached static grove transforms, recalculating them when the grove or its parent moves. This avoids repeating matrix work for the additional middle-tier nodes. The cache also applies to static rock groves using the shared helper.</li>
</ul>
<h2>Timing results</h2><p>Values are medians of three trial medians, in milliseconds. Each trial records 180 frames after 90 warmup frames. Before/after order alternates between rounds. CPU time covers world update and render submission; GPU elapsed time comes from WebGL timer queries. Frame interval includes browser scheduling and presentation limits.</p>
<div class="scroll"><table><thead><tr><th>View</th><th>CPU ms: before → after</th><th>CPU change</th><th>GPU ms: before → after</th><th>GPU change</th><th>Frame interval ms: before → after</th></tr></thead><tbody>${timingRows}</tbody></table></div>
<h2>Submitted geometry and draw calls</h2><p>These counts include shadow passes. Spatial batching can increase draw calls while allowing off-screen batches to be skipped. The middle model replaces geometry inside the existing detailed-tree range.</p><div class="scroll"><table><thead><tr><th>View</th><th>Triangles: before → after</th><th>Triangle change</th><th>Draw calls: before → after</th></tr></thead><tbody>${geometryRows}</tbody></table></div>
<h2>Visual comparisons</h2><p>Matched camera positions, a fixed world time and the same cloud positions. These are actual 1280 × 720 browser canvas captures, not generated mockups.</p>
${["forest", "treetops", "overhead"].map((view) => `<h3>${labels[view]}</h3><div class="pair"><figure><figcaption>Before</figcaption><img src="before-${view}.png" alt="Original ${labels[view]} view"></figure><figure><figcaption>After</figcaption><img src="after-${view}.png" alt="Optimized ${labels[view]} view"></figure></div>`).join("")}
<h2>Trial medians and limits</h2><div class="scroll"><table><thead><tr><th>View</th><th>Before CPU ms</th><th>After CPU ms</th><th>Before GPU ms</th><th>After GPU ms</th></tr></thead><tbody>${trialRows}</tbody></table></div>
<ul><li>One machine/browser; mobile and other GPUs were not benchmarked. Normal operating-system and browser scheduling variation remains.</li><li>The initial, more aggressive 9,209-triangle asset was replaced with a less aggressive model to retain the overall silhouette more closely.</li><li>The first batching attempt added CPU work. Static-transform caching and texture sharing were added before the final measurement. These results measure the combined change; they do not isolate the contribution of each technique.</li><li>Visual checks covered low forest, treetops, overhead views and a scripted moving approach. This is sampled inspection, not exhaustive visual acceptance.</li><li>Baseline and optimized collision-obstacle records are identical: <strong>${evidence.collisionIdentical}</strong>. No flight model or collision behavior was changed.</li></ul>
<h2>Validation</h2><p>The full active suite passed 417 tests with zero failures before the last batch-size adjustment. After that adjustment, all 12 focused tree/scenery tests passed, and the game build, wind-tunnel build, and repository-layout check passed again. Six new tests cover tier transitions in both directions and with zoom, instance transforms across negative and positive spatial cells, unchanged rock LOD, cached transforms when moved/reparented, shared textures, and asset geometry/UV/material/bounds. A live Finch free flight also started without browser errors. Builds retain the existing large-chunk warnings.</p>
<h2>Reproduce and inspect</h2><ol><li>Rebuild the middle model with <code>bun run scenery:tree-lod</code>.</li><li>Run the local Vite server, then open <code>/scripts/tree-lod-benchmark.html</code>.</li><li>The comparison loads the preserved pre-change module at <code>output/tree-lod/environment-assets-before.ts</code>. Keep that capture with this evidence; it records the actual dirty-worktree starting point.</li><li>Click “Compare three alternating rounds”, then “Save benchmark evidence”.</li><li>Copy that JSON to <code>output/tree-lod/evidence.json</code> and run <code>bun scripts/report-tree-lod.ts</code>.</li></ol>
<p><a href="evidence.json">Raw evidence</a> · <a href="summary.json">Computed summary</a> · <a href="source-manifest.json">Source fingerprints</a> · <a href="tests.log">Full test log</a> · <a href="focused-tests.log">Final focused test log</a> · <a href="build.log">Game build log</a> · <a href="lab-build.log">Lab build log</a></p>
<h2>Environment</h2><pre>${escape(JSON.stringify(evidence.environment, null, 2))}</pre>
</body></html>`;
const directory = dirname(path);
await Bun.write(
  resolve(directory, "summary.json"),
  JSON.stringify(summary, null, 2),
);
await Bun.write(resolve(directory, "report.html"), html);
console.log(JSON.stringify(summary, null, 2));
console.log(`Report: ${resolve(directory, "report.html")}`);
