const encode = async (path: string, mime: string) =>
  `data:${mime};base64,${Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64")}`;
const validation = await Bun.file(
  "assets/finch/cockpit-validation.json",
).json();
const browser = await Bun.file("output/finch-rebuild-browser.json").json();
const native = await Bun.file(
  "output/finch-cockpit-native-evidence.json",
).json();
const image = await encode("output/finch-rebuilt-cockpit.png", "image/png");
const pilot = await encode("output/finch-rebuilt-pilot-view.png", "image/png");
const access = await encode(
  "output/finch-rebuilt-canopy-open.png",
  "image/png",
);
const junction = await encode("output/finch-flush-windshield.png", "image/png");
const rows = Object.entries(validation.clearance_m)
  .map(
    ([name, gap]) =>
      `<tr><td>${name.replaceAll("_", " ")}</td><td>${(Number(gap) * 1000).toFixed(1)} mm</td></tr>`,
  )
  .join("");
await Bun.write(
  "docs/aircraft/FINCH_COCKPIT.html",
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Finch cockpit rebuild</title><style>
body{margin:0;background:#fafaf7;color:#26343a;font:15px/1.65 system-ui,sans-serif}main{max-width:980px;margin:auto;padding:28px 22px}h1{font-size:32px;line-height:1.2}h2{font-size:21px;margin-top:32px}a{color:#225e79}small,figcaption{color:#62747b}figure{margin:22px 0}img,video{display:block;width:100%;border-radius:4px}figcaption{font-size:13px;margin-top:7px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid #d6dedd;padding:9px;text-align:left}pre{background:#eef0ec;padding:14px;overflow:auto}.note{border-left:3px solid #54807b;background:#edf2ef;padding:14px}.links{display:flex;flex-wrap:wrap;gap:14px}@media(max-width:600px){main{padding:20px 15px}}</style></head><body><main>
<small>12 October 2026 · Pocket Flight · Local aircraft rebuild</small><h1>Finch U–2 cockpit rebuilt</h1>
<p>The entire cockpit subtree has been replaced in the runtime aircraft asset. The preserved airframe supplies the wing, body, tail, engine and landing-gear geometry. The new cabin uses a lower panel and glare shield, contoured bucket seats, compact avionics, native dual control sticks, adjustable pedal geometry and a complete rear-hinged canopy.</p>
<div class="links"><a href="http://127.0.0.1:5186/">Open private tester</a><a href="../../assets/finch/Finch-U2-cockpit.blend">Editable Blender model</a><a href="../../public/assets/finch-u2.glb">Runtime GLB</a><a href="../../scripts/build-finch-cockpit.py">Rebuild source</a></div>
<figure><img src="${image}" alt="Rebuilt Finch cockpit with closed canopy, contoured seats, dual sticks and compact instrument panel"><figcaption>Actual browser render, closed canopy, opaque aircraft materials. Static details are batched by material within each articulated parent.</figcaption></figure>
<h2>Canopy fitted to the fuselage</h2><p>The separate round sill rails left exposed capped ends over the nose. They have been removed. A continuous porcelain surround now closes around the glazing and seats against the actual fuselage mesh, with a recessed seal and a thin internal windshield header. The extra free-ended cabin reinforcement rods have also been removed.</p><figure><img src="${junction}" alt="Front inspection of the continuous fitted Finch windshield surround"><figcaption>Current browser render from the front. Independent native-file validation checks ${native.surround_mounting_samples} actual mounting vertices: maximum skin gap ${(native.surround_skin_gap_m*1000).toFixed(2)} mm, ${native.surround_open_edges} open or non-manifold frame edges.</figcaption></figure>
<h2>Design decisions</h2><p>The handbook’s sections 13.1, 13.3, 13.4 and 16.1–16.2 require coherent structure, equipment packaging, pilot clearance and real articulated pivots. The new assembly replaces the old bulky dashboard and generic cockpit additions rather than adding more decorative rods. The canopy moves with its glazing, rails, rear bow and latch handles. Its hinge, clevises and gas-support mounting points are authored in the model and exported as datums.</p>
<p><a href="https://www.diamondaircraft.com/en/private-owners/da20-series/overview/">Diamond’s DA20 cockpit</a> and <a href="https://www.diamondaircraft.com/fileadmin/diamondaircraft/documents/da20/Brochure_DA20-C1_2022_DIGITAL.pdf">manufacturer brochure</a> informed the trainer layout: outward visibility, bucket seats, dual stick controls and restrained instrument packaging. Finch remains an original concept aircraft.</p>
<h2>Pilot-eye inspection</h2><figure><img src="${pilot}" alt="Finch panel and forward visibility from the exported left pilot eye"><figcaption>Actual browser camera at the left pilot-eye datum. The design head envelope has ${(validation.pilot_eyes[0].roof_to_head_m * 1000).toFixed(1)} mm roof clearance. The panel lip is approximately ${(validation.pilot_eyes[0].panel_below_eye_m * 1000).toFixed(0)} mm below eye height.</figcaption></figure>
<h2>Complete canopy motion</h2><figure><img src="${access}" alt="Finch canopy opened as a complete rear-hinged assembly"><figcaption>Current 55° opening; mounted barrel and piston endpoints follow the exported supports. The cabin close-up fits the opening envelope when selected in an open pose.</figcaption></figure>
<h2>Measured packaging</h2><table><thead><tr><th>Assembly</th><th>Minimum measured roof gap</th></tr></thead><tbody>${rows}</tbody></table>
<p>The model checks both signs of pitch and roll at 18 stick poses against the seats, panel, coaming and console. It checks glazing at 12 canopy angles from 0° to 55° against furniture and the fuselage. The outer glazing boundary cell is excluded from the latter test because it contains the intended bonded sill/header contact. All sampled intersection counts are zero.</p>
<h2>Verification</h2><ul><li>113 repository tests passed, 47,257 assertions. Runtime tests include 72 mechanism poses, support endpoints, exported pilot-eye roof clearance, fixed furniture and neutral reset.</li><li>Private tester and game TypeScript/production builds passed.</li><li>${browser.checks.length} dedicated cockpit browser checks passed with zero browser/shader errors. The rebuilt geometry retains all 122 full-span airflow paths.</li><li>The saved Blender file reopened independently: ${native.meshes} editable meshes, ${native.triangles.toLocaleString()} triangles, zero nonfinite vertices, a continuous mounted surround and the expected hinge datum.</li></ul>
<p class="note">The cockpit is an original concept model. Head clearance uses a simple seated-pilot envelope, not a complete anthropometric study. The avionics graphics are illustrative. Private mechanical mode demonstrates controls and access motion; aerodynamic readouts retain the neutral main-wing reference. The shared runtime asset updates Finch’s appearance in the game as well.</p>
<h2>Repeatable workflow</h2><pre>bun run finch:cockpit
bun test tests/aircraft-mechanics.test.ts tests/finch-geometry.test.ts
bun run lab:build
bun run lab:cockpit-check</pre>
<p>The build uses the preserved local <code>assets/finch/Finch-U2-base.blend</code>. It saves the editable cabin before batching the exported static parts. The original runtime asset and previous cockpit screenshot are preserved under <code>output/finch-cockpit-before/</code>.</p>
<div class="links"><a href="../../assets/finch/cockpit-validation.json">Packaging and travel evidence</a><a href="../../output/finch-rebuild-browser.json">Cockpit browser checks</a><a href="../../output/finch-cockpit-native-evidence.json">Native reopen evidence</a><a href="../../output/finch-rebuild-full-tests.log">Full test log</a><a href="../../lab/finch-cockpit.ts">Native mechanism controller</a><a href="PRINCIPLES_OF_MAKING_PLANES.md">Aircraft handbook</a></div>
</main></body></html>`,
);
console.log("Saved docs/aircraft/FINCH_COCKPIT.html");
