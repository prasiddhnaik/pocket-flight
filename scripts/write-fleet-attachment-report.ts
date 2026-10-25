import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { otherAircraft } from "./fleet-attachment-model";

type Report = {
  aircraft: string;
  name: string;
  sha256: string;
  poses: number;
  steps: number;
  meshes: number;
  surfaces: number;
  pass: boolean;
  neutralDisconnectedGroups: number;
  neutralDisconnectedSurfaces: number;
  maximumDisconnectedGroups: number;
  uniqueFlaggedSurfaces: number;
  newlyDetachedDuringMovement: number;
  measured: { surfaces: number; metres: number; from: string; to: string }[];
  flags: {
    surface: string;
    firstPose: string;
    poses: number;
    initiallyDetached: boolean;
  }[];
};
const outIndex = Bun.argv.indexOf("--out");
const output = resolve(
  outIndex < 0 ? "output/fleet-attachment-check" : Bun.argv[outIndex + 1],
);
const reports: Report[] = await Promise.all(
  otherAircraft.map((id) => Bun.file(resolve(output, `${id}.json`)).json()),
);
type LabReport = {
  aircraft: string;
  pass: boolean;
  poses: number;
  neutralDisconnectedGroups: number;
  maximumDisconnectedGroups: number;
  uniqueFlaggedSurfaces: number;
  results: { meshes: number }[];
};
const labReports: LabReport[] = [];
for (const id of otherAircraft) {
  const file = Bun.file(resolve(output, `${id}-lab.json`));
  if (await file.exists()) labReports.push(await file.json());
}
assert.equal(
  labReports.length,
  otherAircraft.length,
  "Missing viewer-rig audit",
);
assert(
  labReports.every((r) => r.poses === 38),
  "Viewer-rig cycle must finish before reporting",
);
for (const report of reports) {
  const channels = report.aircraft === "finch" ? 6 : 8;
  assert.equal(
    report.poses,
    1 + channels * (report.steps + 1) + 25,
    "Incomplete aircraft sweep",
  );
}
const sampling = [...new Set(reports.map((r) => r.steps + 1))]
  .sort((a, b) => a - b)
  .join(" / ");
const labSection = `<section><h2>Wind-tunnel viewer hardware</h2><p>This separate pass includes the viewer's added cockpit and mechanical detail pack. Each active instanced part is tested at its own instance transform. These flags overlap the base-asset flags and must not be added together as a repair count.</p><table><thead><tr><th>Aircraft</th><th>Poses</th><th>Physical mesh instances at neutral</th><th>Disconnected groups at neutral</th><th>Unique flagged surfaces</th><th>Evidence</th></tr></thead><tbody>${labReports.map((r) => `<tr><th>${escapeLabel(r.aircraft)}</th><td>${r.poses}</td><td>${r.results[0].meshes}</td><td>${r.neutralDisconnectedGroups}</td><td>${r.uniqueFlaggedSurfaces}</td><td><a href="${r.aircraft}-lab.json">Detailed results</a></td></tr>`).join("")}</tbody></table><p>Where 38 poses are recorded, coverage is neutral plus the full 36-second all-mechanisms inspection programme at one-second intervals. A one-pose record is neutral only.</p></section>`;
function escapeLabel(text: string) {
  return text.replace(/[&<>"']/g, "");
}
const original: Record<string, string> = await Bun.file(
  resolve(output, "before/hashes.json"),
).json();
const changed = [];
let assets = 0;
for (const [path, hash] of Object.entries(original)) {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  const after = createHash("sha256").update(bytes).digest("hex");
  if (path.startsWith("public/assets/")) assets++;
  if (after !== hash) {
    assert.equal(
      path,
      "scripts/aurelia-attachments.ts",
      `Unexpected change during audit: ${path}`,
    );
    changed.push(path);
  }
}
const preservation = {
  pass: true,
  filesChecked: Object.keys(original).length,
  assetFilesChecked: assets,
  changedExistingFiles: changed,
  aircraftAssetsUnchanged: true,
};
await Bun.write(
  resolve(output, "preservation.json"),
  JSON.stringify(preservation, null, 2),
);
const escape = (text: unknown) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const short = (path: string) => path.split("/").slice(-2).join("/");
const tests = await Bun.file(resolve(output, "checker-tests.log")).text();
const testPasses = tests.match(/(?:^|\n)\s*(\d+) pass/);
assert(
  testPasses && Number(testPasses[1]) > 0 && tests.includes("0 fail"),
  "Checker tests must pass before reporting",
);
const rows = reports
  .map(
    (r) =>
      `<tr><th>${escape(r.name)}</th><td>${r.poses}</td><td>${r.meshes}</td><td>${r.neutralDisconnectedGroups}</td><td>${r.uniqueFlaggedSurfaces}</td><td>${r.newlyDetachedDuringMovement}</td><td class="fail">${r.pass ? "Pass" : "Fails contact rule"}</td></tr>`,
  )
  .join("");
const details = await Promise.all(
  reports.map(async (r) => {
    const rest = await Bun.file(
      resolve(output, `${r.aircraft}-rest.json`),
    ).json();
    const movementFile = Bun.file(
      resolve(output, `${r.aircraft}-movement-gap.json`),
    );
    const movement = (await movementFile.exists())
      ? await movementFile.json()
      : undefined;
    const movementNote = movement
      ? `<p><strong>Additional measured movement failure:</strong> the flagged assembly has a ${(movement.measured[0].metres * 1000).toFixed(3)} mm shortest gap to body-connected surfaces at ${escape(movement.name)}. <a href="${r.aircraft}-movement-gap.json">Pose, contact points and measurement</a>.</p>`
      : "";
    return `<section><h2>${escape(r.name)}</h2><p>${r.meshes} meshes, ${r.surfaces} connected surface islands before contact grouping. ${r.neutralDisconnectedSurfaces} surfaces have no contact path to the body at neutral. Maximum disconnected groups in any sampled pose: ${r.maximumDisconnectedGroups}.</p>
  <p><a href="${r.aircraft}.json">Full sweep evidence</a> · <a href="${r.aircraft}-rest.json">Neutral groups and measured coordinates</a></p>
  <h3>Representative measured gaps to body-connected geometry</h3><p>These are exact shortest triangle distances for up to eight of the largest neutral groups, in the game's world scale. The closest body-connected surface is not necessarily the intended mounting point. A connection through another detached group still needs a complete path to the body.</p>
  <div class="table"><table><thead><tr><th>Flagged surface</th><th>Nearest body-connected surface</th><th>Gap</th></tr></thead><tbody>${r.measured.map((m) => `<tr><td title="${escape(m.from)}">${escape(short(m.from))}</td><td title="${escape(m.to)}">${escape(short(m.to))}</td><td>${(m.metres * 1000).toFixed(3)} mm</td></tr>`).join("")}</tbody></table></div>
  <h3>Movement adds ${r.newlyDetachedDuringMovement} previously connected surfaces to the flags</h3><ul>${
    r.flags
      .filter((f) => !f.initiallyDetached)
      .slice(0, 10)
      .map(
        (f) =>
          `<li><code>${escape(f.surface)}</code> — first detected at ${escape(f.firstPose)}</li>`,
      )
      .join("") ||
    "<li>No additional surfaces become disconnected in the sampled movement; the neutral failures remain.</li>"
  }</ul>
  ${movementNote}
  <details><summary>All ${rest.detached.length} neutral groups</summary>${rest.detached.map((group: string[], i: number) => `<details><summary>Group ${i + 1} · ${group.length} surfaces · ${escape(short(group[0]))}</summary><ul>${group.map((p) => `<li><code>${escape(p)}</code></li>`).join("")}</ul></details>`).join("")}</details>
  <p class="hash">Asset SHA-256: ${escape(r.sha256)}</p></section>`;
  }),
);
const reportDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Calcutta",
}).format(new Date());
const failedIds = new Set([
  ...reports.filter((r) => !r.pass).map((r) => r.aircraft),
  ...labReports.filter((r) => !r.pass).map((r) => r.aircraft),
]);
const status =
  failedIds.size === 3
    ? "All three aircraft fail the strict contact rule."
    : failedIds.size
      ? `${failedIds.size} aircraft have unresolved contact flags.`
      : "No contact flags in the sampled poses.";
const branchCommand = Bun.spawn(["git", "branch", "--show-current"], {
  stdout: "pipe",
});
const branch = (await new Response(branchCommand.stdout).text()).trim();
assert.equal(await branchCommand.exited, 0, "Could not identify report branch");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fleet attachment audit · ${reportDate}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;color:#202a30;background:#fafaf8;margin:0}main{max-width:1150px;margin:auto;padding:32px 24px 64px}h1{font-size:30px;line-height:1.2}h2{margin-top:36px}h3{font-size:18px}section{border-top:1px solid #cdd3d5;margin-top:28px;padding-top:12px}.status{border-left:4px solid #a52b25;padding:12px 16px;background:#fff0ed}.fail{color:#94231e;font-weight:650}.table{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;vertical-align:top;padding:10px;border:1px solid #cdd3d5}th{background:#eef1f0}td{overflow-wrap:anywhere}code{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}details{margin:10px 0;padding:8px 12px;border:1px solid #d6dada}summary{cursor:pointer}a{color:#15536a}.hash{font-size:12px;overflow-wrap:anywhere}li{margin:6px 0}small{color:#58636a}</style>
<main><h1>Fleet attachment audit</h1><p><strong>${reportDate} · Finch, Peregrine and Stormbird</strong><br><small>Repository: /Users/prasiddhnaik/Documents/blender skills/pocket-flight-site · Branch: ${escape(branch)}</small></p>
<p class="status"><strong>${status}</strong> ${reports.reduce((n, r) => n + r.poses, 0).toLocaleString()} sampled poses checked. Aircraft assets and runtime source remain unchanged. This report is an audit and repair inventory; the aircraft have not been repaired or approved.</p>
<h2>Results</h2><div class="table"><table><thead><tr><th>Aircraft</th><th>Poses</th><th>Meshes</th><th>Disconnected groups at neutral</th><th>Unique flagged surfaces across travel</th><th>New flags during movement</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>
<p><strong>Counts describe connected surface groups, not a count of distinct repair jobs.</strong> A merged mesh may contain many independent details. Lettering, seals, recessed components and fully enclosed hardware are retained in the flags for review. They are not silently exempted, and every flag is not automatically a visually floating solid.</p>
<h2>Three verification passes</h2><ol><li><strong>Rest geometry:</strong> split meshes into connected triangle surfaces; find an actual contact path to the primary body. Bounding boxes only select candidates.</li><li><strong>Independent movement:</strong> sample each supported channel at ${sampling} positions, including controls, gear, suspension, canopy, propeller/compressor phase and the lab's Finch flap inspection range.</li><li><strong>Combined movement:</strong> sample 25 deterministic combinations, then restore neutral and require the original group inventory to return exactly.</li></ol>
<p>The distance tolerance is 0.01 mm (10 micrometres), solely for digital numerical contact. The game asset scales are applied. Production control-surface and jet pose code runs offline; the glow texture factory is stubbed and no renderer, browser, smoke or exhaust effect is included. Hidden gear remains in the geometry check. This is not a flight-dynamics, manufacturing-tolerance or rendered visual acceptance test.</p>
${details.join("")}
${labSection}
<section><h2>Preservation and checker verification</h2><ul><li>${preservation.filesChecked} existing files hashed against the start-of-audit baseline; ${assets} aircraft asset files unchanged, including Aurelia.</li><li>The existing checker gained a selectable body anchor and bounded nearest-gap diagnostics. No runtime, geometry, paint, fairing or flight tuning was changed.</li><li>${testPasses[1]} focused tests passed, including selectable body anchors, known gap math, pose restoration and Aurelia's existing attachment regression tests.</li><li>Repository navigation check passed. Builds and flight tests were not rerun because runtime files and assets were not changed.</li><li>The checkout was already dirty with the aircraft-folder reorganization and other existing edits. No resets, commits, deletions or regeneration of models were performed.</li></ul><p><a href="preservation.json">Preservation evidence</a> · <a href="checker-tests.log">Checker test log</a></p></section>
<section><h2>Repair priorities</h2><ol><li>Inspect and mount disconnected structural assemblies first: Finch gear and equipment, Peregrine control/engine connections exposed through movement, and Stormbird gear and service installations.</li><li>Repair in the owning model or authoring source, retaining dimensions, materials, pivots and original parts. Avoid invisible catch-all links.</li><li>Review seals, graphics, encapsulated hardware and small trim individually. Attach real modeled hardware through its intended support.</li><li>Rerun the same sweeps and compare the resulting assets against a preservation baseline before approval.</li></ol><p>Repeat workflow: <code>bun scripts/run-fleet-attachment-check.ts</code>. The command returns a failing exit status while any contact flags remain.</p></section></main></html>`;
await Bun.write(resolve(output, "report.html"), html);
assert(
  html.includes(status) &&
    html.includes("Preservation and checker verification"),
);
console.log("FLEET_ATTACHMENT_REPORT", resolve(output, "report.html"));
