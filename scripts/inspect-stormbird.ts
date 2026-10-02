// Static CAD inspection only. This never launches or flies the game aircraft.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const bundled = resolve(root, "../.venv-cad312/bin/python");
const python =
  process.env.STORMBIRD_PYTHON ?? (existsSync(bundled) ? bundled : "python3");
const step = "assets/stormbird/STEP/Stormbird-HX40.step";
const tasks = [
  ["assets/stormbird/checks/aft_airframe_fit.py"],
  ["assets/stormbird/checks/compressor_fit.py"],
  ["assets/stormbird/checks/gear_fit.py"],
  ["assets/stormbird/checks/door_fit.py"],
  ["assets/stormbird/src/inspect_seats.py"],
  [
    "-m", "cadgen.cli", "step", "snapshot", step,
    "assets/stormbird/renders/aft-rear-corrected.png",
    "--camera", '{"direction":[0,-1,0],"zoom":1.4}',
    "--display", '{"mode":"solid","edges":{"enabled":false}}',
    "--width", "1600", "--height", "1000",
  ],
  [
    "-m", "cadgen.cli", "step", "snapshot", step,
    "assets/stormbird/renders/intake-front-corrected.png",
    "--camera", '{"direction":[0,1,0],"zoom":2.1}',
    "--display", '{"mode":"solid","edges":{"enabled":false}}',
    "--width", "1600", "--height", "1200",
  ],
  [
    "-m",
    "cadgen.cli",
    "step",
    "snapshot",
    step,
    "assets/stormbird/renders/mechanisms-canopy-open.png",
    "--animation",
    "canopy",
    "--time",
    "3.3",
    "--camera",
    '{"direction":[1,1,0.4]}',
  ],
  [
    "-m",
    "cadgen.cli",
    "step",
    "snapshot",
    step,
    "assets/stormbird/renders/mechanisms-gear-stowed.png",
    "--animation",
    "gear",
    "--time",
    "5.2",
    "--camera",
    '{"direction":[1,1,-0.5]}',
  ],
];
for (const args of tasks) {
  const result = Bun.spawnSync([python, ...args], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode) process.exit(result.exitCode);
}
