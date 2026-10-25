import assert from "node:assert/strict";
import { resolve } from "node:path";
import { otherAircraft } from "./fleet-attachment-model";

const out = resolve("output/fleet-attachment-repair"),
  verified = resolve(out, "verified");
const data = [];
for (const id of otherAircraft) {
  const base = await Bun.file(resolve(verified, id + ".json")).json(),
    lab = await Bun.file(resolve(verified, id + "-lab.json")).json();
  assert(
    base.pass && base.maximumDisconnectedGroups === 0 && base.steps === 100,
    id + " aircraft sweep has unresolved flags",
  );
  assert(
    lab.pass && lab.poses === 38 && lab.maximumDisconnectedGroups === 0,
    id + " viewer sweep has unresolved flags",
  );
  assert.equal(base.sha256, lab.sha256, "Mismatched model revisions");
  const previous = await Bun.file(
    resolve("output/fleet-attachment-check", id + ".json"),
  ).json();
  data.push({ id, base, lab, previous });
}
const preservation = await Bun.file(resolve(out, "preservation.json")).json();
assert(preservation.pass);
const browser = await Bun.file(resolve(out, "browser.json")).json();
assert.equal(browser.shots.length, 36);
assert.equal(browser.errors.length, 0);
const tests = await Bun.file(resolve(out, "final-tests.log")).text();
const passes = tests.match(/(?:^|\n)\s*(\d+) pass/),
  fails = tests.match(/(?:^|\n)\s*(\d+) fail/);
assert(passes && fails, "Full suite is incomplete");
const failed = [
  ...new Set(
    [...tests.matchAll(/^\(fail\) (.+?)(?: \[[\d.]+ms\])?$/gm)].map(
      (m) => m[1],
    ),
  ),
];
const escape = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const poses = data.reduce((n, r) => n + r.base.poses + r.lab.poses, 0);
assert.equal(poses, 2414);
for (const file of ["build.log", "lab-build.log"]) {
  const log = await Bun.file(resolve(out, file)).text();
  assert(/built in/.test(log), file + " does not confirm a build");
}
const photos = await Promise.all(
  data.map(
    async ({ id }) =>
      `<figure><img alt="${id} repair review views" src="data:image/png;base64,${Buffer.from(await Bun.file(resolve(out, id + "-review-sheet.png")).arrayBuffer()).toString("base64")}"><figcaption>${escape(id)} — six exterior angles, cockpit and gear close-ups, and four mechanism poses. <a href="${id}-gear.png">Gear close-up</a> · <a href="${id}-cockpit.png">Cockpit close-up</a></figcaption></figure>`,
  ),
);
const rows = data
  .map(
    ({ id, base, lab, previous }) =>
      `<tr><th>${escape(base.name)}</th><td>${previous.neutralDisconnectedGroups}</td><td>${base.poses}</td><td>${lab.poses}</td><td><strong>0</strong></td><td><a href="verified/${id}.json">Aircraft evidence</a> · <a href="verified/${id}-lab.json">Viewer evidence</a></td></tr>`,
  )
  .join("");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fleet connection repairs</title><style>body{margin:0;background:#fafaf8;color:#233039;font:16px/1.6 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:30px 24px 60px}h1{font-size:30px;line-height:1.2}h2{font-size:22px;margin-top:32px}h3{font-size:18px}section{border-top:1px solid #cdd5d5;margin-top:26px;padding-top:8px}.status{border-left:4px solid #28744c;background:#eef7ef;padding:12px 16px}.note{border-left:4px solid #987323;padding:12px 16px;background:#fff8e8}table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:10px;border:1px solid #cdd5d5;text-align:left;vertical-align:top}th{background:#eff2f0}.table{overflow:auto}a{color:#145b70}code{font:13px ui-monospace,monospace;overflow-wrap:anywhere}li{margin:6px 0}figure{margin:20px 0}img{width:100%;height:auto;border:1px solid #d6dddd}figcaption,small{font-size:13px;color:#526169}</style><main><h1>Finch, Peregrine and Stormbird connection repairs</h1><p>18 October 2026 · Pocket Flight · local checkout <code>codex/private-wind-tunnel</code></p><p class="status"><strong>All three aircraft pass the attachment rule in all ${poses.toLocaleString()} tested poses.</strong> The aircraft and viewer sweeps report zero disconnected groups or surfaces. Aurelia assets and source are unchanged.</p><h2>Results</h2><div class="table"><table><thead><tr><th>Aircraft</th><th>Disconnected groups in previous neutral audit</th><th>Aircraft poses</th><th>Viewer poses</th><th>Maximum disconnected groups after repair</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table></div><p>The previous counts describe triangle surface groups, including trim, markings and enclosed equipment; they are not a count of separate repair jobs.</p><section><h2>Repairs</h2><ul><li><strong>Finch:</strong> seated trim and instrument details, mounted the main gear and internal equipment, connected the canopy frame and ram eyelets, and installed pedal guide rails.</li><li><strong>Peregrine:</strong> seated its equipment, wing, engine and wheel details; added coaxial door and elevator hinge pins with fixed and moving lugs; supported the viewer's suspension collars on fixed guides.</li><li><strong>Stormbird:</strong> mounted service equipment and fixed frame details; assigned articulated supports to their actual moving carriers; added the nose-gear hinge support and actuator guide glands.</li><li>Generated viewer actuators now have local structural anchor seats. These additions are explicitly skipped for Aurelia. Supports are batched by rigid owner and material to limit added draw calls.</li><li>Corrected a near-coplanar ray calculation that could report an impossible zero distance between tiny text triangles. The 0.01 mm contact tolerance was retained.</li></ul></section><section><h2>Verification</h2><ol><li>Rest geometry: split actual meshes into triangle surface islands and require a contact path to the primary body.</li><li>Individual movement: 101 positions per supported channel, including controls, gear, suspension, canopy and rotor phase.</li><li>Combined movement: 25 combinations per aircraft, then an exact return to the original neutral contact inventory.</li><li>Viewer hardware: the full 36-second inspection programme sampled each second, including every active instanced part.</li></ol><p>Thirty-six rendered views cover front, left, right, rear, top, underside, gear and cockpit views plus mechanism poses. The temporary browser was closed after capture. Geometry checks use actual production pose code; these finite samples do not prove every possible combination or flight dynamics.</p><p>Application and lab builds passed with the existing large-chunk warning. Repository navigation and formatting checks passed. Focused geometry, mounting, distance-regression and preservation checks passed.</p><p class="note"><strong>Full game suite: ${passes[1]} passed, ${fails[1]} failed.</strong> The full suite is not green. Its remaining failures are recorded below and are separate from the passing connection sweeps; no flight tuning or Aurelia repair was included.</p><details><summary>Full suite failures</summary><ul>${failed.map((f) => `<li>${escape(f)}</li>`).join("")}</ul></details><p><a href="final-tests.log">Full suite log</a> · <a href="checker-tests.log">Focused checker log</a> · <a href="build.log">Application build</a> · <a href="lab-build.log">Lab build</a> · <a href="browser.json">Rendered view inventory</a></p></section><section><h2>Preservation</h2><p>${preservation.filesChecked} preexisting files were checked against the fresh task baseline. ${preservation.protectedFilesUnchanged} remain byte-for-byte unchanged. All 610 original aircraft nodes and 442 original mesh definitions retain their geometry, materials and transforms; the mounts were appended under their rigid owners. Original binary buffers and native authoring files were preserved.</p><p>Only the three selected model documents, their new mount buffers, the viewer's mount hook, audit/measurement tools and the three selected asset-revision hashes changed. Compatibility tests now verify the appended mount layer and every external buffer while retaining the rebuild rejection guard. Fuel, mass and flight numbers were retained. The existing checkout was dirty before this work; no resets, commits or deletion of user files occurred.</p><p><a href="preservation.json">Preservation evidence</a></p></section><section><h2>Rendered review</h2>${photos.join("")}</section><section><h2>Repeat checks</h2><p><code>bun scripts/run-fleet-attachment-check.ts</code> runs the complete fleet attachment audit in separate processes. <code>bun scripts/check-fleet-repair-preservation.ts</code> checks this repair baseline. Repair authoring lives in <code>scripts/repair-fleet-attachments.ts</code>; it rejects an asset or mount buffer changed since the recorded baseline.</p></section></main></html>`;
await Bun.write(resolve(out, "report.html"), html);
assert(html.includes("Preservation") && html.includes("2,414"));
console.log("FLEET_REPAIR_REPORT", resolve(out, "report.html"));
